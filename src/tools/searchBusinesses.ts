import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerAppTool } from '@modelcontextprotocol/ext-apps/server';
import { db } from '../lib/supabase.js';
import { cleanText, guard, ok } from '../lib/results.js';
import { coverImage } from '../lib/images.js';
import { WIDGET_URI } from '../widget.js';

const serviceOut = z.object({
  service_id: z.string(),
  name: z.string(),
  name_ar: z.string().nullable().optional(),
  duration_min: z.number(),
  price_qar: z.number()
});

const businessOut = z.object({
  business_id: z.string(),
  name: z.string(),
  name_ar: z.string().nullable().optional(),
  category: z.string(),
  area: z.string(),
  address: z.string(),
  image_url: z.string().nullable().optional(),
  services: z.array(serviceOut)
});

type Row = {
  id: string;
  name_en: string;
  name_ar: string | null;
  category: string;
  area: string;
  address: string | null;
  images: string[] | null;
  services: { id: string; name_en: string; name_ar: string | null; duration_min: number; price: number | string }[] | null;
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
        'Never invent ids, prices or businesses. If nothing matches, say so and offer to search with fewer filters.',
      inputSchema: {
        category: z.string().trim().min(1).max(50).optional()
          .describe('Kind of business, e.g. "gym", "barber", "salon", "spa", "clinic". Omit to search all.'),
        area: z.string().trim().min(1).max(80).optional()
          .describe('Neighbourhood or district in Qatar, e.g. "Al Sadd", "The Pearl", "West Bay".'),
        query: z.string().trim().min(1).max(100).optional()
          .describe('Free text matched against business names and descriptions, e.g. a business the user named.'),
        limit: z.number().int().min(1).max(10).default(5)
          .describe('How many businesses to return. Default 5, max 10.')
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
    async ({ category, area, query, limit }) => guard('search_businesses', async () => {
      let q = db()
        .from('businesses')
        .select('id,name_en,name_ar,category,area,address,images,services(id,name_en,name_ar,duration_min,price)')
        .eq('is_active', true)
        .eq('services.is_active', true)
        .order('name_en', { ascending: true })
        .limit(limit);

      const cat = category ? cleanText(category) : '';
      const where = area ? cleanText(area) : '';
      const text = query ? cleanText(query) : '';

      if (cat) q = q.ilike('category', cat);
      if (where) q = q.ilike('area', `%${where}%`);
      if (text) q = q.or(`name_en.ilike.%${text}%,name_ar.ilike.%${text}%,description_en.ilike.%${text}%`);

      const { data, error } = await q;
      if (error) throw error;

      const rows = (data ?? []) as Row[];
      const businesses = rows.map((b) => ({
        business_id: b.id,
        name: b.name_en,
        category: b.category,
        area: b.area,
        address: b.address?.trim() || `${b.area}, Doha, Qatar`,
        services: (b.services ?? []).map((s) => ({
          service_id: s.id,
          name: s.name_en,
          duration_min: Number(s.duration_min),
          price_qar: Number(s.price)
        }))
      }));

      const note = businesses.length ? {} : {
        note: 'No businesses matched. Tell the user, and offer to search again with fewer filters (for example without the area or category).'
      };

      /* the UI also gets Arabic names and the cover photo; the model's text
         answer stays exactly as before */
      const forUi = businesses.map((b, i) => ({
        ...b,
        name_ar: rows[i].name_ar || null,
        image_url: coverImage(rows[i].images),
        services: b.services.map((s, j) => ({ ...s, name_ar: rows[i].services?.[j]?.name_ar || null }))
      }));

      return ok(
        { businesses: forUi, count: businesses.length, ...note },
        { businesses, count: businesses.length, ...note }
      );
    })
  );
}
