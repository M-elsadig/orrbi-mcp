import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerAppTool } from '@modelcontextprotocol/ext-apps/server';
import { db } from '../lib/supabase.js';
import { cleanText, fail, guard, ok } from '../lib/results.js';
import { languageInput } from '../lib/language.js';
import { categoryOf, resolveCategory } from '../lib/category.js';
import { cancellationText, paymentNote, priceText } from '../lib/payment.js';
import { type TemplateRow, appointmentHours, weeklyTimes } from '../lib/schedule.js';
import { REQUIREMENTS_NOTE, type Requirement, forService, loadRequirements, requirementOut } from '../lib/requirements.js';
import { requirementSchema } from './getAvailability.js';
import { type PartOfDay, parseClock } from '../lib/classes.js';
import { openSlots } from '../lib/openSlots.js';
import { DONT_REPEAT, type GymRow, gymCard, gymCardOut } from '../lib/cards.js';
import { TZ_LABEL, isRealDate, todayInQatar } from '../lib/time.js';
import { WIDGET_URI } from '../widget.js';

const serviceOut = z.object({
  service_id: z.string(),
  name: z.string(),
  description: z.string().nullable().optional(),
  duration_min: z.number(),
  price_qar: z.number(),
  price_label: z.string().optional(),
  /* "Sun 8:30 AM (ladies only), 5:15 PM; Tue …" from the weekly timetable */
  weekly_times: z.string().optional(),
  has_ladies_only_times: z.boolean().optional(),
  /* 1:1 appointments: one trainer per booking, times every 30 min */
  appointment: z.boolean().optional(),
  trainers: z.array(z.string()).optional(),
  appointment_hours: z.string().optional(),
  requirements: z.array(requirementSchema).optional()
});

/* listed so the model can answer "how much is a PT session?", never booked */
const infoServiceOut = z.object({
  name: z.string(),
  price: z.string(),
  description: z.string().nullable().optional()
});

const businessOut = z.object({
  business_id: z.string(),
  name: z.string(),
  category: z.string(),
  area: z.string(),
  address: z.string(),
  description: z.string().nullable().optional(),
  maps_url: z.string().nullable().optional(),
  payment: z.string().nullable().optional(),
  cancellation_policy: z.string().nullable().optional(),
  first_visit: z.string().nullable().optional(),
  next_times: z.array(z.string()).optional(),
  services: z.array(serviceOut),
  other_services: z.array(infoServiceOut).optional()
});

type ServiceRow = {
  id: string;
  name_en: string;
  name_ar: string | null;
  description_en: string | null;
  duration_min: number;
  price: number | string;
  bookable: boolean;
  short_name_en: string | null;
  short_name_ar: string | null;
  price_note_en: string | null;
};

type Row = {
  id: string;
  name_en: string;
  name_ar: string | null;
  category: string;
  area: string;
  address: string | null;
  description_en: string | null;
  maps_url: string | null;
  pay_at_venue: boolean;
  cancellation_hours: number | null;
  first_visit_note_en: string | null;
  images: string[] | null;
  image_focus: Record<string, unknown> | null;
  services: ServiceRow[] | null;
};

export function registerSearchBusinesses(server: McpServer) {
  registerAppTool(
    server,
    'search_businesses',
    {
      title: 'Search businesses',
      description:
        'Find local businesses in Qatar that can be booked through Orrbi (gyms, barbers, salons, spas, clinics, etc.), ' +
        'with the services each one offers, their duration and price in QAR. ' +
        'Use this to find, browse or compare places, and to look up a business the user named. ' +
        'The card shows one compact card per business with its next open times; when the user names a day or time, pass date, part_of_day or around_time so the card shows only those times. ' +
        'For a specific class at a time across gyms ("HYCROSS Tuesday 6pm") use find_classes. ' +
        'Do not list the businesses, classes or times again in your reply: the card shows them. ' +
        'All filters are optional. Use the returned business_id and service_id with get_availability. ' +
        'Quote prices with price_label: when it says "pay at the gym", the customer pays there and Orrbi only reserves the spot. ' +
        'other_services are for information only and cannot be booked through Orrbi. ' +
        'weekly_times is the regular timetable of each class (Qatar time), so you can tell which class runs on which day; ladies-only is per time, marked "(ladies only)". ' +
        'appointment: true marks a private 1:1 session with a trainer the user picks (trainers); appointment_hours gives the first to last start time per day. ' +
        'requirements (e.g. a health screening) must be answered by the user before create_booking. ' +
        'Never invent ids, prices or businesses. If nothing matches, say so and offer to search with fewer filters. ' +
        'After the card, ask in one short sentence which place or time suits them; do not check availability for every business or service.',
      inputSchema: {
        category: z.string().trim().min(1).max(50).optional()
          .describe('Kind of business, e.g. "gym", "barber", "salon", "spa", "clinic". Fitness, studio, CrossFit, workout and training all mean "gym". Omit to search all.'),
        area: z.string().trim().min(1).max(80).optional()
          .describe('Neighbourhood or district in Qatar, e.g. "Al Sadd", "The Pearl", "West Bay".'),
        query: z.string().trim().min(1).max(100).optional()
          .describe('Free text matched against business names and descriptions, e.g. a business the user named.'),
        ladies_only: z.boolean().optional()
          .describe('true to return only classes that have ladies-only (women-only) times, with only those times in weekly_times. Use when the user asks for ladies or women classes. Omit otherwise.'),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/,'date must be YYYY-MM-DD').optional()
          .describe('Day the user asked about, YYYY-MM-DD in Qatar time ("tonight" is today). Omit when no day was named.'),
        days: z.number().int().min(1).max(7).optional()
          .describe('How many days from date. Default 1 when a date or time is given, else the next 7 days.'),
        part_of_day: z.enum(['morning', 'afternoon', 'evening', 'any']).optional()
          .describe('morning 5 AM–12, afternoon 12–5 PM, evening 5 PM–midnight ("tonight", "after work" = evening).'),
        around_time: z.string().regex(/^\d{1,2}:\d{2}$/,'around_time must be HH:MM (24h)').optional()
          .describe('A time the user named, 24h HH:MM Qatar time, e.g. "18:00". Matches within 90 minutes.'),
        limit: z.number().int().min(1).max(10).default(5)
          .describe('How many businesses to return. Default 5, max 10.'),
        language: languageInput
      },
      outputSchema: {
        gyms: z.array(gymCardOut),
        count: z.number(),
        note: z.string().optional()
      },
      annotations: {
        title: 'Search businesses',
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      },
      _meta: { ui: { resourceUri: WIDGET_URI } }
    },
    async (args) => guard('search_businesses', async () => {
      const { category, area, query, ladies_only, limit } = args;
      const today = todayInQatar();
      if (args.date && !isRealDate(args.date)) return fail(`${args.date} is not a real calendar date. Please use YYYY-MM-DD.`);
      if (args.date && args.date < today) return fail(`${args.date} is in the past. Today in Qatar is ${today}.`);
      if (args.around_time && parseClock(args.around_time) === null) return fail('around_time must be a real 24h time, e.g. 18:00.');

      let q = db()
        .from('businesses')
        .select('id,name_en,name_ar,category,area,address,description_en,maps_url,pay_at_venue,cancellation_hours,' +
          'first_visit_note_en,images,image_focus,' +
          'services(id,name_en,name_ar,short_name_en,short_name_ar,description_en,duration_min,price,bookable,price_note_en)')
        .eq('is_active', true)
        .eq('services.is_active', true)
        .order('name_en', { ascending: true })
        .limit(limit);

      /* "fitness", "crossfit", "جيم" all mean the stored category gym. A
         query that is only a category word ("gym near me") searches by
         category too, since no business name or description would match. */
      const queryCategory = !category && query ? categoryOf(query) : null;
      const cat = category ? cleanText(resolveCategory(category)) : queryCategory ?? '';
      const where = area ? cleanText(area) : '';
      const text = query && !queryCategory ? cleanText(query) : '';

      if (cat) q = q.ilike('category', cat);
      if (where) q = q.ilike('area', `%${where}%`);
      if (text) q = q.or(`name_en.ilike.%${text}%,name_ar.ilike.%${text}%,description_en.ilike.%${text}%`);

      const { data, error } = await q;
      if (error) throw error;

      const found = (data ?? []) as unknown as Row[];

      /* the weekly timetable of every class found, in one query */
      type Template = TemplateRow & { service_id: string; staff: { name: string; is_active: boolean } | null };
      const timetable = new Map<string, Template[]>();
      let requirements = new Map<string, Requirement[]>();
      if (found.length) {
        const ids = found.map((b) => b.id);
        const [t, reqs] = await Promise.all([
          db().from('schedule_templates')
            .select('service_id,weekday,start_time,ladies_only,bookable,staff(name,is_active)')
            .in('business_id', ids)
            .eq('is_active', true),
          loadRequirements(ids)
        ]);
        if (t.error) throw t.error;
        requirements = reqs;
        for (const r of (t.data ?? []) as unknown as Template[]) {
          if (r.staff && !r.staff.is_active) continue;
          timetable.set(r.service_id, [...(timetable.get(r.service_id) ?? []), r]);
        }
      }
      const hasLadies = (serviceId: string) => (timetable.get(serviceId) ?? []).some((r) => r.bookable && r.ladies_only);
      /* a service whose timetable has trainers is a 1:1 appointment */
      const trainersOf = (serviceId: string) =>
        [...new Set((timetable.get(serviceId) ?? []).filter((r) => r.bookable && r.staff).map((r) => r.staff!.name))].sort();

      /* bookable services become `services`; info-only ones `other_services`.
         Ladies-only is per time, not per class: with ladies_only, a class
         counts if it has ladies-only times, and a business without any
         drops out. */
      const rows = found.map((b) => {
        const all = (b.services ?? []).slice().sort((x, y) => x.name_en.localeCompare(y.name_en));
        return {
          b,
          bookable: all.filter((s) => s.bookable && (!ladies_only || hasLadies(s.id))),
          info: ladies_only ? [] : all.filter((s) => !s.bookable)
        };
      }).filter((r) => !ladies_only || r.bookable.length);

      /* Answer first: the times that fit what was asked ("tonight" → only
         tonight's), else simply the next open ones. Same rules as
         find_classes: never within the business's booking cutoff, never full. */
      const timed = !!(args.date || args.around_time || (args.part_of_day && args.part_of_day !== 'any'));
      const date = args.date ?? today;
      const days = args.days ?? (timed ? 1 : 7);
      const { slots, next } = rows.length
        ? await openSlots(date, days, { business_ids: rows.map((r) => r.b.id) },
          { part: args.part_of_day as PartOfDay | undefined, around: args.around_time, ladiesOnly: ladies_only }, Date.now(), timed)
        : { slots: [], next: false };

      const gyms = rows.map(({ b, bookable }) => gymCard({ ...b, services: bookable } as GymRow, slots));

      const businesses = rows.map(({ b, bookable, info }, i) => ({
        business_id: b.id,
        name: b.name_en,
        category: b.category,
        area: b.area,
        address: b.address?.trim() || `${b.area}, Doha, Qatar`,
        description: b.description_en,
        maps_url: b.maps_url,
        payment: paymentNote({ pay_at_venue: b.pay_at_venue, category: b.category }),
        cancellation_policy: cancellationText(b.cancellation_hours),
        first_visit: b.first_visit_note_en,
        next_times: gyms[i].next_times.map((t) => t.start_label),
        services: bookable.map((s) => {
          const trainers = trainersOf(s.id);
          const reqs = forService(requirements.get(b.id) ?? [], s.id).map(requirementOut);
          return {
            service_id: s.id,
            name: s.name_en,
            description: s.description_en,
            duration_min: Number(s.duration_min),
            price_qar: Number(s.price),
            price_label: priceText({ price_qar: Number(s.price), pay_at_venue: b.pay_at_venue, category: b.category }),
            ...(trainers.length ? {
              appointment: true,
              trainers,
              appointment_hours: appointmentHours(timetable.get(s.id)!) ?? undefined
            } : timetable.has(s.id) ? {
              weekly_times: weeklyTimes(timetable.get(s.id)!, ladies_only ? true : undefined) ?? undefined,
              has_ladies_only_times: hasLadies(s.id)
            } : {}),
            ...(reqs.length ? { requirements: reqs } : {})
          };
        }),
        ...(info.length ? {
          other_services: info.map((s) => ({
            name: s.name_en,
            price: s.price_note_en || priceText({ price_qar: Number(s.price), pay_at_venue: b.pay_at_venue, category: b.category }),
            description: s.description_en
          }))
        } : {})
      }));

      const notes: string[] = [];
      if (!businesses.length) {
        notes.push(ladies_only
          ? 'No ladies-only classes matched. Tell the user, and offer to search mixed classes or with fewer filters.'
          : 'No businesses matched. Tell the user, and offer to search again with fewer filters (for example without the area or category).');
      } else {
        if (next) notes.push('Nothing is open at the time asked for; next_times are the next open times instead. Say so in one sentence.');
        else if (timed && !slots.length) notes.push('Nothing is open at the time asked for. Say so, and offer another day.');
        notes.push(DONT_REPEAT);
        if (businesses.some((b) => b.services.some((s) => s.requirements))) notes.push(REQUIREMENTS_NOTE);
      }
      const note = notes.length ? { note: notes.join(' ') } : {};

      /* the card gets only what the compact card shows; the gym page loads
         the rest itself (get_business). The model gets the details it may
         need to answer questions. */
      return ok(
        {
          gyms, count: gyms.length, timezone: TZ_LABEL, date, days, timed,
          part_of_day: args.part_of_day ?? null, around_time: args.around_time ?? null, ladies_filter: ladies_only ?? null,
          ...(next ? { next } : {}), ...note
        },
        { businesses, count: businesses.length, ...note }
      );
    }, args)
  );
}
