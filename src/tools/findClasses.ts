import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerAppTool } from '@modelcontextprotocol/ext-apps/server';
import { cleanText, fail, guard, ok } from '../lib/results.js';
import { languageInput } from '../lib/language.js';
import { categoryOf, resolveCategory } from '../lib/category.js';
import { type PartOfDay, forModel, parseClock } from '../lib/classes.js';
import { NEXT_DAYS, type Where, openSlots } from '../lib/openSlots.js';
import { DONT_REPEAT, cardsForSlots, gymCardOut } from '../lib/cards.js';
import { TZ_LABEL, isRealDate, todayInQatar } from '../lib/time.js';
import { WIDGET_URI } from '../widget.js';

/* Answer-first: "gym class tonight", "ladies class tomorrow morning",
   "HYCROSS Tuesday 6pm" → the open class times themselves, across every
   gym and class, in one call. */

const MODEL_MAX = 10;    // slots in the model's text answer

export function registerFindClasses(server: McpServer) {
  registerAppTool(
    server,
    'find_classes',
    {
      title: 'Find class times',
      description:
        'Find open class times across all gyms on Orrbi for a request with a time in it: "gym class tonight", ' +
        '"ladies class tomorrow morning", "HYCROSS on Tuesday at 6pm", "something after work this week". ' +
        'Call this ONCE instead of search_businesses + get_availability whenever the user mentions a day or time; ' +
        'use search_businesses only to browse places or answer questions about a gym. ' +
        'The card shows one compact card per gym with its next times, and the user books by tapping one. ' +
        'Do not list the gyms, classes or times again in your reply; slots (time order) are there so you can answer follow-up questions. ' +
        'Ladies-only times end with "Ladies only" in start_label; say so if you mention one. ' +
        'Pass ladies_only: true for ladies or women classes, false for mixed. ' +
        'If nothing matches, the result lists the next open times instead and note says so. ' +
        'Never say how many places are left. Use slot_id, business_id and service_id with create_booking.',
      inputSchema: {
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD').optional()
          .describe('First day to look at, YYYY-MM-DD in Qatar time. Default: today. "Tonight" is today.'),
        days: z.number().int().min(1).max(7).default(1)
          .describe('How many days from date. 1 for "tonight"/"tomorrow"/"Tuesday", 7 for "this week".'),
        part_of_day: z.enum(['morning', 'afternoon', 'evening', 'any']).optional()
          .describe('morning 5 AM–12, afternoon 12–5 PM, evening 5 PM–midnight ("tonight", "after work" = evening).'),
        around_time: z.string().regex(/^\d{1,2}:\d{2}$/, 'around_time must be HH:MM (24h)').optional()
          .describe('A specific time the user named, 24h HH:MM in Qatar time, e.g. "18:00" for 6pm. Matches within 90 minutes.'),
        ladies_only: z.boolean().optional()
          .describe('true: only ladies-only times. false: only mixed. Omit to get both (ladies-only ones are marked).'),
        query: z.string().trim().min(1).max(80).optional()
          .describe('A class or gym the user named, e.g. "HYCROSS", "handstand", "Aflete".'),
        area: z.string().trim().min(1).max(80).optional()
          .describe('Neighbourhood, e.g. "West Bay".'),
        category: z.string().trim().min(1).max(50).optional()
          .describe('Kind of business; fitness, crossfit, workout etc. all mean "gym". Omit to search all.'),
        business_id: z.uuid().optional()
          .describe('Only this business (business_id from search_businesses).'),
        language: languageInput
      },
      outputSchema: {
        date: z.string(),
        days: z.number(),
        timezone: z.string(),
        gyms: z.array(gymCardOut),
        count: z.number(),
        next: z.boolean().optional(),
        note: z.string().optional()
      },
      annotations: { title: 'Find class times', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      _meta: { ui: { resourceUri: WIDGET_URI } }
    },
    async (args) => guard('find_classes', async () => {
      const today = todayInQatar();
      const date = args.date ?? today;
      if (!isRealDate(date)) return fail(`${date} is not a real calendar date. Please use YYYY-MM-DD.`);
      if (date < today) return fail(`${date} is in the past. Today in Qatar is ${today}.`);
      if (args.around_time && parseClock(args.around_time) === null) return fail('around_time must be a real 24h time, e.g. 18:00.');

      /* a query that is only a category word ("gym") is a category, not a name */
      const queryCat = args.query ? categoryOf(args.query) : null;
      const where: Where = {
        business_id: args.business_id,
        area: args.area ? cleanText(args.area) : undefined,
        category: args.category ? cleanText(resolveCategory(args.category)) : queryCat ?? undefined,
        text: args.query && !queryCat ? cleanText(args.query).toLowerCase() : undefined
      };
      const filter = { part: args.part_of_day as PartOfDay | undefined, around: args.around_time, ladiesOnly: args.ladies_only };
      const { slots, next } = await openSlots(date, args.days, where, filter, Date.now(), !args.business_id);

      const kind = args.ladies_only === true ? 'ladies-only ' : args.ladies_only === false ? 'mixed ' : '';
      const notes: string[] = [];
      if (next) notes.push(`No open ${kind}classes matched the time asked for; these are the next open ${kind}times. Say so.`);
      else if (!slots.length) notes.push(`No open ${kind}classes in the next ${NEXT_DAYS} days for this. Say so, and offer to look without filters.`);
      if (slots.length) notes.push(DONT_REPEAT);

      const answer = {
        date, days: args.days, timezone: TZ_LABEL,
        slots: slots.slice(0, MODEL_MAX).map(forModel),
        count: slots.length,
        ...(next ? { next } : {}),
        ...(notes.length ? { note: notes.join(' ') } : {})
      };
      /* the card: one compact card per gym, its next 3 times in the window */
      const gyms = await cardsForSlots(slots);
      return ok({
        date, days: args.days, timezone: TZ_LABEL, gyms, count: gyms.length,
        part_of_day: args.part_of_day ?? null, around_time: args.around_time ?? null, ladies_filter: args.ladies_only ?? null,
        ...(next ? { next } : {}), ...(notes.length ? { note: notes.join(' ') } : {})
      }, answer);
    }, args)
  );
}
