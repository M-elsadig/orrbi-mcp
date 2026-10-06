import { z } from 'zod';
import { db } from './supabase.js';
import { coverImage } from './images.js';
import { type ClassSlotUi, type NextTime, nextTimes } from './classes.js';

/* The compact card, one per gym: photo, name, area, "From 100 QAR" and the
   next 3 open times that answer the question. search_businesses and
   find_classes both open on it; everything else (photos, classes, about,
   the week) is fetched by the card when the gym page opens (get_business). */

export type GymCard = {
  business_id: string;
  name: string;
  name_ar: string | null;
  category: string;
  area: string;
  image_url: string | null;
  from_price_qar: number | null;
  pay_at_venue: boolean;
  next_times: NextTime[];
};

export const gymCardOut = z.object({
  business_id: z.string(),
  name: z.string(),
  area: z.string(),
  from_price_qar: z.number().nullable(),
  next_times: z.array(z.object({ start: z.string(), start_label: z.string(), ladies_only: z.boolean() }).passthrough())
}).passthrough();

export type GymRow = {
  id: string;
  name_en: string;
  name_ar: string | null;
  category: string;
  area: string;
  images: string[] | null;
  pay_at_venue: boolean | null;
  services: { price: number | string; bookable: boolean }[] | null;
};

export const GYM_SELECT = 'id,name_en,name_ar,category,area,images,pay_at_venue,services(price,bookable,is_active)';

/* lowest price of a class that can be booked */
export function fromPrice(services: GymRow['services']): number | null {
  const prices = (services ?? []).filter((s) => s.bookable).map((s) => Number(s.price)).filter(Number.isFinite);
  return prices.length ? Math.min(...prices) : null;
}

export function gymCard(b: GymRow, slots: ClassSlotUi[]): GymCard {
  return {
    business_id: b.id,
    name: b.name_en,
    name_ar: b.name_ar || null,
    category: b.category,
    area: b.area,
    image_url: coverImage(b.images),
    from_price_qar: fromPrice(b.services),
    pay_at_venue: Boolean(b.pay_at_venue),
    next_times: nextTimes(slots.filter((s) => s.business_id === b.id))
  };
}

/* The gyms behind a set of slots, in the order their first time comes up */
export async function cardsForSlots(slots: ClassSlotUi[]): Promise<GymCard[]> {
  const ids = [...new Set(slots.map((s) => s.business_id))];
  if (!ids.length) return [];
  const { data, error } = await db().from('businesses').select(GYM_SELECT)
    .in('id', ids).eq('services.is_active', true);
  if (error) throw error;
  const rows = new Map(((data ?? []) as unknown as GymRow[]).map((b) => [b.id, b]));
  return ids.filter((id) => rows.has(id)).map((id) => gymCard(rows.get(id)!, slots));
}

/* Said in every result that opens the card: the card is the answer */
export const DONT_REPEAT =
  'The card already shows these gyms and their times. Do not list the gyms, classes, times or prices again in your reply: ' +
  'answer in one short sentence (for example, ask which gym or time suits them).';
