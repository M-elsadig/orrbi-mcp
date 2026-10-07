import { addDays, qatarLabel, todayInQatar, toQatarIso } from './time.js';
import { LADIES_SUFFIX } from './availability.js';
import { cutoffMs } from './cutoff.js';
import { type StaffRow, type Trainer, toTrainer, withTrainer } from './staff.js';

/* find_classes: open class times across every gym and class, for asks with
   a time in them ("tonight", "tomorrow morning", "Tuesday 6pm"). The tool
   reads the rows; this decides which ones answer the question. Pure (`now`
   passed in) so it can be tested. */

export type PartOfDay = 'morning' | 'afternoon' | 'evening' | 'any';

/* Qatar wall-clock hours, [from, to) */
const PARTS: Record<Exclude<PartOfDay, 'any'>, [number, number]> = {
  morning: [5, 12],
  afternoon: [12, 17],
  evening: [17, 24]
};

/* "around 6pm" means anything from 4:30 to 7:30 */
export const AROUND_MINUTES = 90;

export type ClassRow = {
  id: string;
  starts_at: string;
  capacity: number;
  booked_count: number;
  ladies_only: boolean | null;
  business_id: string;
  service_id: string;
  services: {
    name_en: string; name_ar: string | null; short_name_en: string | null; short_name_ar: string | null;
    description_en: string | null; price: number | string; duration_min: number;
  };
  businesses: {
    name_en: string; name_ar: string | null; area: string; category: string;
    pay_at_venue: boolean | null; cancellation_hours: number | null; booking_cutoff_min?: number | null;
  };
  /* the trainer of a 1:1 appointment slot; null for group classes */
  staff?: StaffRow | null;
};

export type ClassSlot = {
  slot_id: string;
  business_id: string;
  business_name: string;
  area: string;
  service_id: string;
  /* short name for rows; the full one is class_full */
  class: string;
  start: string;
  start_label: string;
  ladies_only: boolean;
  /* 1:1 appointments: who it is with */
  trainer?: string;
};

/* what the card also gets (Arabic, full names, price for the booking step) */
export type ClassSlotUi = ClassSlot & {
  date: string;
  class_full: string;
  class_ar: string | null;
  class_full_ar: string | null;
  description: string | null;
  business_name_ar: string | null;
  category: string;
  price_qar: number;
  pay_at_venue: boolean;
  duration_min: number;
  trainer_info?: Trainer;
};

export type ClassFilter = {
  part?: PartOfDay;
  around?: string;            // "HH:MM", Qatar time
  ladiesOnly?: boolean;
};

/* minutes since Qatar midnight */
function qatarMinutes(d: Date): number {
  const [h, m] = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Qatar', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .format(d).split(':').map(Number);
  return h * 60 + m;
}

export function parseClock(s: string | undefined): number | null {
  const m = s?.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]), min = Number(m[2]);
  return h < 24 && min < 60 ? h * 60 + min : null;
}

function inWindow(d: Date, f: ClassFilter): boolean {
  const mins = qatarMinutes(d);
  const around = parseClock(f.around);
  if (around !== null) return Math.abs(mins - around) <= AROUND_MINUTES;
  if (f.part && f.part !== 'any') {
    const [from, to] = PARTS[f.part];
    return mins >= from * 60 && mins < to * 60;
  }
  return true;
}

/* Bookable slots that answer the question, in time order. Never offers a
   slot starting within its business's booking cutoff (the request needs
   confirming), and never a full one. */
export function pickSlots(rows: ClassRow[], filter: ClassFilter, now: number): ClassSlotUi[] {
  return rows
    .filter((r) => {
      const start = new Date(r.starts_at);
      if (start.getTime() <= now + cutoffMs(r.businesses.booking_cutoff_min)) return false;
      if (Number(r.capacity) - Number(r.booked_count) <= 0) return false;
      if (filter.ladiesOnly !== undefined && Boolean(r.ladies_only) !== filter.ladiesOnly) return false;
      return inWindow(start, filter);
    })
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
    .map((r) => toSlot(r));
}

function toSlot(r: ClassRow): ClassSlotUi {
  const start = new Date(r.starts_at);
  const ladies = Boolean(r.ladies_only);
  const s = r.services, b = r.businesses;
  const trainer = toTrainer(r.staff);
  return {
    slot_id: r.id,
    business_id: r.business_id,
    business_name: b.name_en,
    area: b.area,
    service_id: r.service_id,
    class: s.short_name_en || s.name_en,
    start: toQatarIso(start),
    /* the label the model reads out says "Ladies only" itself */
    start_label: withTrainer(qatarLabel(start) + (ladies ? LADIES_SUFFIX : ''), trainer),
    ladies_only: ladies,
    ...(trainer ? { trainer: trainer.name, trainer_info: trainer } : {}),
    date: todayInQatar(start),
    class_full: s.name_en,
    class_ar: s.short_name_ar || s.name_ar,
    class_full_ar: s.name_ar,
    description: s.description_en,
    business_name_ar: b.name_ar,
    category: b.category,
    price_qar: Number(s.price),
    pay_at_venue: Boolean(b.pay_at_venue),
    duration_min: Number(s.duration_min)
  };
}

/* The model's copy: just enough to answer and to book */
export function forModel(s: ClassSlotUi): ClassSlot {
  const { slot_id, business_id, business_name, area, service_id, start, start_label, ladies_only, trainer } = s;
  return {
    slot_id, business_id, business_name, area, service_id, class: s.class, start, start_label, ladies_only,
    ...(trainer ? { trainer } : {})
  };
}

/* [date, date + days) as Qatar days → the UTC range to query */
export function dayRange(date: string, days: number): { from: string; to: string } {
  return {
    from: new Date(`${date}T00:00:00+03:00`).toISOString(),
    to: new Date(`${addDays(date, days)}T00:00:00+03:00`).toISOString()
  };
}

/* The compact card's chips: one gym's next open times, at most `max`.
   Two classes at the same time are one chip (the gym page then asks which
   class); ladies-only times stay apart from mixed ones at the same hour. */
export type NextTime = { start: string; start_label: string; date: string; ladies_only: boolean };

export function nextTimes(slots: ClassSlotUi[], max = 3): NextTime[] {
  const out: NextTime[] = [];
  const seen = new Set<string>();
  for (const s of slots) {
    const key = `${s.start}|${s.ladies_only}`;
    if (seen.has(key)) continue;
    seen.add(key);
    /* one chip stands for every trainer free then, so it names none */
    const label = s.trainer ? s.start_label.replace(` · with ${s.trainer}`, '') : s.start_label;
    out.push({ start: s.start, start_label: label, date: s.date, ladies_only: s.ladies_only });
    if (out.length === max) break;
  }
  return out;
}

/* first to last class start per weekday, from the active timetable:
   real times only (there is no opening-hours column) */
export type ClassHours = { weekday: number; first: string; last: string };

export function classHours(rows: { weekday: number; start_time: string; bookable: boolean }[]): ClassHours[] {
  const days = new Map<number, string[]>();
  for (const r of rows) if (r.bookable) days.set(r.weekday, [...(days.get(r.weekday) ?? []), r.start_time.slice(0, 5)]);
  return [...days].sort((a, b) => a[0] - b[0]).map(([weekday, t]) => {
    t.sort();
    return { weekday, first: t[0], last: t[t.length - 1] };
  });
}
