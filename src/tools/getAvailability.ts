import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerAppTool } from '@modelcontextprotocol/ext-apps/server';
import { db } from '../lib/supabase.js';
import { fail, guard, ok } from '../lib/results.js';
import { languageInput } from '../lib/language.js';
import { WINDOW_DAYS, buildWeek } from '../lib/availability.js';
import { WIDGET_URI } from '../widget.js';
import { TZ_LABEL, addDays, isRealDate, qatarDayRange, todayInQatar } from '../lib/time.js';

const slotOut = z.object({
  slot_id: z.string(),
  start: z.string(),
  end: z.string(),
  start_label: z.string(),
  spots_left: z.number()
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
        'Only future slots with space left are returned; spots_left is how many places remain. ' +
        'Present times to the user using start_label. Use slot_id from this result when calling create_booking. ' +
        'The user can also book directly in the card; if the card reports a booking through model context, it is already done: do not call create_booking again.',
      inputSchema: {
        business_id: z.uuid('business_id must be the id returned by search_businesses')
          .describe('business_id from search_businesses.'),
        service_id: z.uuid('service_id must be the id returned by search_businesses')
          .describe('service_id from search_businesses; must belong to this business.'),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be in YYYY-MM-DD format, e.g. 2026-10-05')
          .describe('The day to check, as YYYY-MM-DD in Qatar time.'),
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
    async ({ business_id, service_id, date }) => guard('get_availability', async () => {
      if (!isRealDate(date)) return fail(`${date} is not a real calendar date. Please use YYYY-MM-DD.`);

      const today = todayInQatar();
      if (date < today) return fail(`${date} is in the past. Today in Qatar is ${today}; please pick today or a later date.`);

      const [biz, svc] = await Promise.all([
        db().from('businesses').select('id,name_en,name_ar').eq('id', business_id).eq('is_active', true).maybeSingle(),
        db().from('services').select('id,name_en,name_ar,duration_min,price,business_id')
          .eq('id', service_id).eq('is_active', true).maybeSingle()
      ]);
      if (biz.error) throw biz.error;
      if (svc.error) throw svc.error;

      if (!biz.data) return fail('No bookable business has that business_id. Use search_businesses to find the business again.');
      if (!svc.data || svc.data.business_id !== business_id) {
        return fail(`That service is not offered by ${biz.data.name_en}. Use search_businesses to see its current services and their service_ids.`);
      }

      /* the whole week in one query: the card switches days without asking again */
      const from = qatarDayRange(date).from;
      const to = qatarDayRange(addDays(date, WINDOW_DAYS - 1)).to;
      const { data, error } = await db()
        .from('availability')
        .select('id,starts_at,capacity,booked_count')
        .eq('business_id', business_id)
        .eq('service_id', service_id)
        .gte('starts_at', from.toISOString())
        .lt('starts_at', to.toISOString())
        .order('starts_at', { ascending: true })
        .limit(1000);
      if (error) throw error;

      const week = buildWeek(data ?? [], date, Number(svc.data.duration_min), Date.now());
      const svcName = svc.data.name_en;
      const bizName = biz.data.name_en;

      let note: string | undefined;
      if (!week.slots.length) {
        note = `No open times for ${svcName} at ${bizName} in the ${WINDOW_DAYS} days from ${date}. Offer to check a later date.`;
      } else if (week.date !== date) {
        note = `No open times on ${date}; showing the next available day, ${week.date}.`;
      }

      /* what the model reads: the same keys as before, for the day shown */
      const answer = {
        business_name: bizName,
        service_name: svcName,
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
        duration_min: Number(svc.data.duration_min),
        requested_date: date,
        days: week.days
      }, answer);
    })
  );
}
