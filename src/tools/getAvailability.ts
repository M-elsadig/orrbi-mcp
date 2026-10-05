import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerAppTool } from '@modelcontextprotocol/ext-apps/server';
import { db } from '../lib/supabase.js';
import { fail, guard, ok } from '../lib/results.js';
import { languageInput } from '../lib/language.js';
import { WINDOW_DAYS, buildWeek } from '../lib/availability.js';
import { cancellationText, paymentNote, priceText } from '../lib/payment.js';
import { WIDGET_URI } from '../widget.js';
import { TZ_LABEL, addDays, isRealDate, qatarDayRange, todayInQatar } from '../lib/time.js';

const slotOut = z.object({
  slot_id: z.string(),
  start: z.string(),
  end: z.string(),
  start_label: z.string(),
  ladies_only: z.boolean()
});

export function registerGetAvailability(server: McpServer) {
  registerAppTool(
    server,
    'get_availability',
    {
      title: 'Get available times',
      description:
        'List the open booking times for one service at one business, in Qatar time (UTC+3). ' +
        'If the user has not said which service they want, ask them first; do not check every service. ' +
        'Then call this ONCE for that service, with the date the user asked for (or today). ' +
        'Never call it in a loop over services or dates: the card shown to the user already covers the next 7 days and lets them switch days and pick a time. ' +
        'If the requested date has no open times, the result shows the next day that has some, and note says so. ' +
        'Call it again only for a different service, or for one specific date to get the slot_id of a time the user picked. ' +
        'Only times the business can still confirm are returned (nothing inside its cancellation window). ' +
        'Do not tell the user how many places are left: Orrbi does not know, and every booking is a request the business confirms. ' +
        'Ladies-only is a property of each time, not of the class: the same class can be ladies-only at 8:30 AM and mixed at 5:15 PM. ' +
        'If the user asked for ladies-only or women-only classes, pass ladies_only: true. If they asked for mixed classes, pass ladies_only: false. ' +
        'Otherwise omit it, and when you mention a time whose ladies_only is true, say it is ladies-only (start_label already ends with "Ladies only"). ' +
        'Present times to the user using start_label. Use slot_id from this result when calling create_booking. ' +
        'The user can also book directly in the card; if the card reports a booking through model context, it is already done: do not call create_booking again.',
      inputSchema: {
        business_id: z.uuid('business_id must be the id returned by search_businesses')
          .describe('business_id from search_businesses.'),
        service_id: z.uuid('service_id must be the id returned by search_businesses')
          .describe('service_id from search_businesses; must belong to this business.'),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be in YYYY-MM-DD format, e.g. 2026-10-05')
          .describe('The day to check, as YYYY-MM-DD in Qatar time.'),
        ladies_only: z.boolean().optional()
          .describe('true: only ladies-only times. false: only mixed times. Omit to get both (ladies-only ones are marked).'),
        language: languageInput
      },
      outputSchema: {
        business_name: z.string(),
        business_name_ar: z.string().nullable().optional(),
        business_id: z.string().optional(),
        service_name: z.string(),
        service_name_ar: z.string().nullable().optional(),
        service_id: z.string().optional(),
        price_qar: z.number().optional(),
        price_label: z.string().optional(),
        payment: z.string().optional(),
        cancellation_policy: z.string().optional(),
        pay_at_venue: z.boolean().optional(),
        category: z.string().optional(),
        ladies_only: z.boolean().optional(),
        cutoff_hours: z.number().optional(),
        duration_min: z.number().optional(),
        date: z.string(),
        requested_date: z.string().optional(),
        timezone: z.string(),
        slots: z.array(slotOut),
        days: z.array(z.object({ date: z.string(), slots: z.array(slotOut) })).optional(),
        note: z.string().optional()
      },
      annotations: {
        title: 'Get available times',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      },
      _meta: { ui: { resourceUri: WIDGET_URI } }
    },
    async ({ business_id, service_id, date, ladies_only }) => guard('get_availability', async () => {
      if (!isRealDate(date)) return fail(`${date} is not a real calendar date. Please use YYYY-MM-DD.`);

      const today = todayInQatar();
      if (date < today) return fail(`${date} is in the past. Today in Qatar is ${today}; please pick today or a later date.`);

      const [biz, svc] = await Promise.all([
        db().from('businesses').select('id,name_en,name_ar,category,pay_at_venue,cancellation_hours')
          .eq('id', business_id).eq('is_active', true).maybeSingle(),
        db().from('services').select('id,name_en,name_ar,duration_min,price,business_id,bookable')
          .eq('id', service_id).eq('is_active', true).maybeSingle()
      ]);
      if (biz.error) throw biz.error;
      if (svc.error) throw svc.error;

      if (!biz.data) return fail('No bookable business has that business_id. Use search_businesses to find the business again.');
      if (!svc.data || svc.data.business_id !== business_id) {
        return fail(`That service is not offered by ${biz.data.name_en}. Use search_businesses to see its current services and their service_ids.`);
      }
      if (!svc.data.bookable) {
        return fail(`${svc.data.name_en} at ${biz.data.name_en} can't be booked through Orrbi yet. ` +
          `Tell the user to arrange it with ${biz.data.name_en} directly, or offer one of its classes instead.`);
      }

      const pay = { price_qar: Number(svc.data.price), pay_at_venue: biz.data.pay_at_venue, category: biz.data.category };

      /* the whole week in one query: the card switches days without asking again */
      const from = qatarDayRange(date).from;
      const to = qatarDayRange(addDays(date, WINDOW_DAYS - 1)).to;
      const { data, error } = await db()
        .from('availability')
        .select('id,starts_at,capacity,booked_count,ladies_only')
        .eq('business_id', business_id)
        .eq('service_id', service_id)
        .gte('starts_at', from.toISOString())
        .lt('starts_at', to.toISOString())
        .order('starts_at', { ascending: true })
        .limit(1000);
      if (error) throw error;

      const cutoffHours = Number(biz.data.cancellation_hours ?? 0);
      const week = buildWeek(data ?? [], date, Number(svc.data.duration_min), Date.now(), {
        ladiesOnly: ladies_only,
        minLeadMs: cutoffHours * 3_600_000
      });
      const kind = ladies_only === true ? 'ladies-only ' : ladies_only === false ? 'mixed ' : '';
      const svcName = svc.data.name_en;
      const bizName = biz.data.name_en;

      let note: string | undefined;
      if (!week.slots.length) {
        note = `No open ${kind}times for ${svcName} at ${bizName} in the ${WINDOW_DAYS} days from ${date}. ` +
          (ladies_only !== undefined ? 'Check the class schedule in search_businesses (weekly_times) for when it runs, or offer another class.' : 'Offer to check a later date.');
      } else if (week.date !== date) {
        note = `No open ${kind}times on ${date}; showing the next available day, ${week.date}.`;
      }

      /* what the model reads: the same keys as before, for the day shown */
      const answer = {
        business_name: bizName,
        service_name: svcName,
        price_label: priceText(pay),
        ...(paymentNote(pay) ? { payment: paymentNote(pay)! } : {}),
        ...(cancellationText(biz.data.cancellation_hours) ? { cancellation_policy: cancellationText(biz.data.cancellation_hours)! } : {}),
        date: week.date,
        timezone: TZ_LABEL,
        slots: week.slots,
        ...(note ? { note } : {})
      };

      /* the card also gets the other six days, ids and Arabic names */
      return ok({
        ...answer,
        business_id,
        business_name_ar: biz.data.name_ar || null,
        service_id,
        service_name_ar: svc.data.name_ar || null,
        price_qar: Number(svc.data.price),
        pay_at_venue: Boolean(biz.data.pay_at_venue),
        category: biz.data.category,
        cutoff_hours: cutoffHours,
        duration_min: Number(svc.data.duration_min),
        requested_date: date,
        days: week.days
      }, answer);
    }, { business_id, service_id, date })
  );
}
