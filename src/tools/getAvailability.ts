import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { db } from '../lib/supabase.js';
import { fail, guard, ok } from '../lib/results.js';
import { TZ_LABEL, isRealDate, qatarDayRange, qatarLabel, todayInQatar, toQatarIso } from '../lib/time.js';

const slotOut = z.object({
  slot_id: z.string(),
  start: z.string(),
  end: z.string(),
  start_label: z.string(),
  spots_left: z.number()
});

export function registerGetAvailability(server: McpServer) {
  server.registerTool(
    'get_availability',
    {
      title: 'Get available times',
      description:
        'List the open booking times for one service at one business on one day, in Qatar time (UTC+3). ' +
        'Call this before offering or promising any specific time, using business_id and service_id from search_businesses. ' +
        'Only future slots with space left are returned; spots_left is how many places remain. ' +
        'Present times to the user using start_label. Use slot_id from this result when calling create_booking.',
      inputSchema: {
        business_id: z.uuid('business_id must be the id returned by search_businesses')
          .describe('business_id from search_businesses.'),
        service_id: z.uuid('service_id must be the id returned by search_businesses')
          .describe('service_id from search_businesses; must belong to this business.'),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be in YYYY-MM-DD format, e.g. 2026-10-05')
          .describe('The day to check, as YYYY-MM-DD in Qatar time.')
      },
      outputSchema: {
        business_name: z.string(),
        service_name: z.string(),
        date: z.string(),
        timezone: z.string(),
        slots: z.array(slotOut),
        note: z.string().optional()
      },
      annotations: {
        title: 'Get available times',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    },
    async ({ business_id, service_id, date }) => guard('get_availability', async () => {
      if (!isRealDate(date)) return fail(`${date} is not a real calendar date. Please use YYYY-MM-DD.`);

      const today = todayInQatar();
      if (date < today) return fail(`${date} is in the past. Today in Qatar is ${today}; please pick today or a later date.`);

      const [biz, svc] = await Promise.all([
        db().from('businesses').select('id,name_en').eq('id', business_id).eq('is_active', true).maybeSingle(),
        db().from('services').select('id,name_en,duration_min,business_id')
          .eq('id', service_id).eq('is_active', true).maybeSingle()
      ]);
      if (biz.error) throw biz.error;
      if (svc.error) throw svc.error;

      if (!biz.data) return fail('No bookable business has that business_id. Use search_businesses to find the business again.');
      if (!svc.data || svc.data.business_id !== business_id) {
        return fail(`That service is not offered by ${biz.data.name_en}. Use search_businesses to see its current services and their service_ids.`);
      }

      const { from, to } = qatarDayRange(date);
      const { data, error } = await db()
        .from('availability')
        .select('id,starts_at,capacity,booked_count')
        .eq('business_id', business_id)
        .eq('service_id', service_id)
        .gte('starts_at', from.toISOString())
        .lt('starts_at', to.toISOString())
        .order('starts_at', { ascending: true })
        .limit(200);
      if (error) throw error;

      const now = Date.now();
      const durationMs = Number(svc.data.duration_min) * 60_000;
      const slots = (data ?? [])
        .filter((s) => new Date(s.starts_at).getTime() > now && Number(s.booked_count) < Number(s.capacity))
        .map((s) => {
          const start = new Date(s.starts_at);
          return {
            slot_id: s.id as string,
            start: toQatarIso(start),
            end: toQatarIso(new Date(start.getTime() + durationMs)),
            start_label: qatarLabel(start),
            spots_left: Number(s.capacity) - Number(s.booked_count)
          };
        });

      return ok({
        business_name: biz.data.name_en,
        service_name: svc.data.name_en,
        date,
        timezone: TZ_LABEL,
        slots,
        ...(slots.length ? {} : {
          note: `No open times for ${svc.data.name_en} at ${biz.data.name_en} on ${date}. Offer to check another date.`
        })
      });
    })
  );
}
