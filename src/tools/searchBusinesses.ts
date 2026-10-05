import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerAppTool } from '@modelcontextprotocol/ext-apps/server';
import { db } from '../lib/supabase.js';
import { cleanText, guard, ok } from '../lib/results.js';
import { coverImage } from '../lib/images.js';
import { languageInput } from '../lib/language.js';
import { categoryOf, resolveCategory } from '../lib/category.js';
import { cancellationText, paymentNote, priceText } from '../lib/payment.js';
import { WIDGET_URI } from '../widget.js';

const serviceOut = z.object({
  service_id: z.string(),
  name: z.string(),
  name_ar: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  duration_min: z.number(),
  price_qar: z.number(),
  price_label: z.string().optional(),
  ladies_only: z.boolean().optional(),
  pay_at_venue: z.boolean().optional()
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
  name_ar: z.string().nullable().optional(),
  category: z.string(),
  area: z.string(),
  address: z.string(),
  description: z.string().nullable().optional(),
  maps_url: z.string().nullable().optional(),
  payment: z.string().nullable().optional(),
  cancellation_policy: z.string().nullable().optional(),
  first_visit: z.string().nullable().optional(),
  image_url: z.string().nullable().optional(),
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
  ladies_only: boolean;
  bookable: boolean;
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
        'Use this first, for any request to find, browse or compare places, and to look up a business the user named. ' +
        'All filters are optional. Use the returned business_id and service_id with get_availability. ' +
        'Quote prices with price_label: when it says "pay at the gym", the customer pays there and Orrbi only reserves the spot. ' +
        'other_services are for information only and cannot be booked through Orrbi. ' +
        'Never invent ids, prices or businesses. If nothing matches, say so and offer to search with fewer filters. ' +
        'After showing results, ask which business and service the user wants; do not check availability for every business or service.',
      inputSchema: {
        category: z.string().trim().min(1).max(50).optional()
          .describe('Kind of business, e.g. "gym", "barber", "salon", "spa", "clinic". Fitness, studio, CrossFit, workout and training all mean "gym". Omit to search all.'),
        area: z.string().trim().min(1).max(80).optional()
          .describe('Neighbourhood or district in Qatar, e.g. "Al Sadd", "The Pearl", "West Bay".'),
        query: z.string().trim().min(1).max(100).optional()
          .describe('Free text matched against business names and descriptions, e.g. a business the user named.'),
        ladies_only: z.boolean().optional()
          .describe('true to return only ladies-only (women-only) classes, e.g. when the user asks for classes for women. Omit otherwise.'),
        limit: z.number().int().min(1).max(10).default(5)
          .describe('How many businesses to return. Default 5, max 10.'),
        language: languageInput
      },
      outputSchema: {
        businesses: z.array(businessOut),
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
    async ({ category, area, query, ladies_only, limit }) => guard('search_businesses', async () => {
      let q = db()
        .from('businesses')
        .select('id,name_en,name_ar,category,area,address,description_en,maps_url,pay_at_venue,cancellation_hours,' +
          'first_visit_note_en,images,' +
          'services(id,name_en,name_ar,description_en,duration_min,price,ladies_only,bookable,price_note_en)')
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

      /* bookable services become `services`; info-only ones `other_services`.
         With ladies_only, only ladies-only classes count, and a business
         without any drops out. */
      const rows = ((data ?? []) as unknown as Row[]).map((b) => {
        const all = (b.services ?? []).slice().sort((x, y) => Number(x.ladies_only) - Number(y.ladies_only) || x.name_en.localeCompare(y.name_en));
        return {
          b,
          bookable: all.filter((s) => s.bookable && (!ladies_only || s.ladies_only)),
          info: ladies_only ? [] : all.filter((s) => !s.bookable)
        };
      }).filter((r) => !ladies_only || r.bookable.length);

      const businesses = rows.map(({ b, bookable, info }) => ({
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
        services: bookable.map((s) => ({
          service_id: s.id,
          name: s.name_en,
          description: s.description_en,
          duration_min: Number(s.duration_min),
          price_qar: Number(s.price),
          price_label: priceText({ price_qar: Number(s.price), pay_at_venue: b.pay_at_venue, category: b.category }),
          ladies_only: s.ladies_only
        })),
        ...(info.length ? {
          other_services: info.map((s) => ({
            name: s.name_en,
            price: s.price_note_en || priceText({ price_qar: Number(s.price), pay_at_venue: b.pay_at_venue, category: b.category }),
            description: s.description_en
          }))
        } : {})
      }));

      const note = businesses.length ? {} : {
        note: ladies_only
          ? 'No ladies-only classes matched. Tell the user, and offer to search mixed classes or with fewer filters.'
          : 'No businesses matched. Tell the user, and offer to search again with fewer filters (for example without the area or category).'
      };

      /* the UI also gets Arabic names, the cover photo and what it needs to
         label prices; the model's text answer stays lean */
      const forUi = businesses.map((b, i) => ({
        ...b,
        name_ar: rows[i].b.name_ar || null,
        image_url: coverImage(rows[i].b.images),
        services: b.services.map((s, j) => ({
          ...s,
          name_ar: rows[i].bookable[j]?.name_ar || null,
          pay_at_venue: rows[i].b.pay_at_venue
        }))
      }));

      return ok(
        { businesses: forUi, count: businesses.length, ...note },
        { businesses, count: businesses.length, ...note }
      );
    }, { category, area, query, ladies_only, limit })
  );
}
