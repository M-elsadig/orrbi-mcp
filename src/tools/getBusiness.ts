import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerAppTool } from '@modelcontextprotocol/ext-apps/server';
import { db } from '../lib/supabase.js';
import { fail, guard, ok } from '../lib/results.js';
import { type FocusMap, galleryPhotos } from '../lib/images.js';
import { languageInput } from '../lib/language.js';
import { cancellationText, paymentNote, priceText } from '../lib/payment.js';
import { type ClassSlotUi, classHours } from '../lib/classes.js';
import { fromPrice } from '../lib/cards.js';
import { openSlots } from '../lib/openSlots.js';
import { cutoffMin } from '../lib/cutoff.js';
import { loadRequirements, requirementOut } from '../lib/requirements.js';
import { type StaffProfileRow, toProfiles } from '../lib/staff.js';
import { todayInQatar } from '../lib/time.js';

/* The gym page: everything the compact card leaves out, in one call, made
   by the card itself when a gym opens (never by the model: visibility
   "app"). Photos, about, address and Maps link, classes, info-only
   services, trainers, pre-booking requirements, the timetable's hours, and
   7 days of open times. */

export const WEEK = 7;

type Row = {
  id: string;
  name_en: string;
  name_ar: string | null;
  category: string;
  area: string;
  address: string | null;
  description_en: string | null;
  description_ar: string | null;
  maps_url: string | null;
  pay_at_venue: boolean | null;
  cancellation_hours: number | null;
  booking_cutoff_min: number | null;
  first_visit_note_en: string | null;
  first_visit_note_ar: string | null;
  images: string[] | null;
  image_focus: FocusMap;
  services: {
    id: string; name_en: string; name_ar: string | null; short_name_en: string | null; short_name_ar: string | null;
    description_en: string | null; duration_min: number; price: number | string; bookable: boolean; price_note_en: string | null;
  }[] | null;
};

export function registerGetBusiness(server: McpServer) {
  registerAppTool(
    server,
    'get_business',
    {
      title: 'Gym page',
      description: 'Used by the Orrbi card to open a business page. Not for the assistant: use search_businesses or find_classes.',
      inputSchema: {
        business_id: z.uuid(),
        language: languageInput
      },
      annotations: { title: 'Gym page', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      _meta: { ui: { visibility: ['app'] } }
    },
    async ({ business_id }) => guard('get_business', async () => {
      const page = await gymPage(business_id);
      return page ? ok(page) : fail('This business is not on Orrbi any more.');
    }, { business_id })
  );
}

/* The page's data. `preview` is only for scripts/preview-business.ts: it
   reads an inactive business and takes slots made from its timetable
   instead of the database (an inactive business has none). */
export async function gymPage(business_id: string, preview?: { slots: ClassSlotUi[] }) {
  let q = db().from('businesses')
    .select('id,name_en,name_ar,category,area,address,description_en,description_ar,maps_url,pay_at_venue,cancellation_hours,' +
      'booking_cutoff_min,first_visit_note_en,first_visit_note_ar,images,image_focus,' +
      'services(id,name_en,name_ar,short_name_en,short_name_ar,description_en,duration_min,price,bookable,price_note_en)')
    .eq('id', business_id).eq('services.is_active', true);
  if (!preview) q = q.eq('is_active', true);
  const { data, error } = await q.maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const b = data as unknown as Row;

  const [t, st, reqs] = await Promise.all([
    db().from('schedule_templates')
      .select('weekday,start_time,bookable').eq('business_id', business_id).eq('is_active', true),
    db().from('staff')
      .select('id,name,gender,title_en,title_ar,photo_url,photo_focus,specialties_en,specialties_ar,bio_en,bio_ar,sort')
      .eq('business_id', business_id).eq('is_active', true),
    loadRequirements([business_id])
  ]);
  if (t.error) throw t.error;
  if (st.error) throw st.error;

  const date = todayInQatar();
  const slots = preview ? preview.slots : (await openSlots(date, WEEK, { business_id }, {}, Date.now(), false)).slots;

  const photos = galleryPhotos(b.images, b.image_focus);
  const all = (b.services ?? []).slice().sort((x, y) => x.name_en.localeCompare(y.name_en));
  const pay = { pay_at_venue: b.pay_at_venue, category: b.category };
  return {
    business_id: b.id,
    name: b.name_en,
    name_ar: b.name_ar,
    category: b.category,
    area: b.area,
    address: b.address?.trim() || `${b.area}, Doha, Qatar`,
    description: b.description_en,
    description_ar: b.description_ar,
    maps_url: b.maps_url,
    /* the photos as URLs (older cards) and with srcset and focal point */
    images: photos.map((p) => p.src),
    photos,
    from_price_qar: fromPrice(all),
    pay_at_venue: Boolean(b.pay_at_venue),
    payment: paymentNote(pay),
    cancellation_hours: b.cancellation_hours,
    cancellation_policy: cancellationText(b.cancellation_hours),
    cutoff_min: cutoffMin(b.booking_cutoff_min),
    first_visit: b.first_visit_note_en,
    first_visit_ar: b.first_visit_note_ar,
    services: all.filter((s) => s.bookable).map((s) => ({
      service_id: s.id,
      name: s.name_en,
      name_ar: s.name_ar,
      short_name: s.short_name_en,
      short_name_ar: s.short_name_ar,
      description: s.description_en,
      duration_min: Number(s.duration_min),
      price_qar: Number(s.price),
      pay_at_venue: Boolean(b.pay_at_venue)
    })),
    other_services: all.filter((s) => !s.bookable).map((s) => ({
      name: s.name_en,
      name_ar: s.name_ar,
      price: s.price_note_en || priceText({ price_qar: Number(s.price), ...pay })
    })),
    staff: toProfiles((st.data ?? []) as StaffProfileRow[]),
    /* every one, with its service_id (null = all services); the card keeps those of the picked service */
    requirements: (reqs.get(business_id) ?? []).map((r) => ({ ...requirementOut(r), service_id: r.service_id })),
    class_hours: classHours((t.data ?? []) as { weekday: number; start_time: string; bookable: boolean }[]),
    week: { date, days: WEEK, slots }
  };
}
