import { db } from './supabase.js';
import { type ClassFilter, type ClassRow, type ClassSlotUi, dayRange, pickSlots } from './classes.js';

/* Open, bookable class times from the database. Shared by find_classes,
   search_businesses (the card's next times) and get_business (the gym
   page); which rows answer the question is decided in classes.ts. */

export const NEXT_DAYS = 7;     // how far ahead to look when the asked window is empty

const SELECT =
  'id,starts_at,capacity,booked_count,ladies_only,business_id,service_id,' +
  'services!inner(name_en,name_ar,short_name_en,short_name_ar,description_en,price,duration_min,bookable,is_active),' +
  'businesses!inner(name_en,name_ar,area,category,pay_at_venue,cancellation_hours,is_active)';

export type Where = { business_id?: string; business_ids?: string[]; area?: string; category?: string; text?: string };

/* Every open, bookable slot in [date, date + days) that matches where. */
export async function loadClassRows(date: string, days: number, where: Where): Promise<ClassRow[]> {
  const { from, to } = dayRange(date, days);
  let q = db().from('availability').select(SELECT)
    .eq('services.is_active', true).eq('services.bookable', true).eq('businesses.is_active', true)
    .gte('starts_at', from).lt('starts_at', to)
    .order('starts_at', { ascending: true })
    .limit(1000);
  if (where.business_id) q = q.eq('business_id', where.business_id);
  if (where.business_ids) q = q.in('business_id', where.business_ids);
  if (where.area) q = q.ilike('businesses.area', `%${where.area}%`);
  if (where.category) q = q.ilike('businesses.category', where.category);
  const { data, error } = await q;
  if (error) throw error;

  const rows = (data ?? []) as unknown as ClassRow[];
  if (!where.text) return rows;
  const t = where.text;
  const has = (s: string | null | undefined) => !!s && s.toLowerCase().includes(t);
  return rows.filter((r) => has(r.services.name_en) || has(r.services.short_name_en) || has(r.services.name_ar) ||
    has(r.businesses.name_en) || has(r.businesses.name_ar));
}

/* The slots that answer the question. Nothing in the asked window: the next
   open times with the same class/gym/ladies filters (`next`), so the answer
   is never a dead end. */
export async function openSlots(
  date: string, days: number, where: Where, filter: ClassFilter, now = Date.now(), fallback = true
): Promise<{ slots: ClassSlotUi[]; next: boolean }> {
  const slots = pickSlots(await loadClassRows(date, days, where), filter, now);
  if (slots.length || !fallback) return { slots, next: false };
  const later = pickSlots(await loadClassRows(date, NEXT_DAYS, where), { ladiesOnly: filter.ladiesOnly }, now);
  return later.length ? { slots: later, next: true } : { slots, next: false };
}
