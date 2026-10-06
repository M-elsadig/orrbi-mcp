import { addDays, qatarLabel, todayInQatar, toQatarIso } from './time.js';

/* get_availability reads a whole week in one query and decides here which
   day to show. Pure (no database, `now` passed in) so it can be tested. */

export const WINDOW_DAYS = 7;

export type SlotRow = { id: string; starts_at: string; capacity: number; booked_count: number; ladies_only?: boolean | null };

/* No spot count: partners also take bookings in their own systems, so
   Orrbi's count isn't the real one, and every booking is a request the
   business confirms. Capacity only decides whether a slot is offered. */
export type Slot = { slot_id: string; start: string; end: string; start_label: string; ladies_only: boolean };

export type Day = { date: string; slots: Slot[] };

export type Week = {
  /* the 7 days from the requested date, each with its open slots */
  days: Day[];
  /* the day to show: the requested one, or the next one with open slots */
  date: string;
  slots: Slot[];
};

export type WeekOptions = {
  /* true: only ladies-only slots; false: only mixed; undefined: both */
  ladiesOnly?: boolean;
  /* don't offer slots starting sooner than this (the booking cutoff,
     src/lib/cutoff.ts), so the request can be confirmed */
  minLeadMs?: number;
};

export const LADIES_SUFFIX = ' · Ladies only';

export function buildWeek(rows: SlotRow[], requested: string, durationMin: number, now: number, opts: WeekOptions = {}): Week {
  const days: Day[] = Array.from({ length: WINDOW_DAYS }, (_, i) => ({ date: addDays(requested, i), slots: [] }));
  const byDate = new Map(days.map((d) => [d.date, d]));
  const durationMs = durationMin * 60_000;
  const earliest = now + (opts.minLeadMs ?? 0);

  const sorted = [...rows].sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  for (const r of sorted) {
    const start = new Date(r.starts_at);
    const ladies = Boolean(r.ladies_only);
    if (start.getTime() <= earliest) continue;
    if (Number(r.capacity) - Number(r.booked_count) <= 0) continue;
    if (opts.ladiesOnly !== undefined && ladies !== opts.ladiesOnly) continue;

    const day = byDate.get(todayInQatar(start));   // the slot's Qatar calendar date
    if (!day) continue;
    day.slots.push({
      slot_id: r.id,
      start: toQatarIso(start),
      end: toQatarIso(new Date(start.getTime() + durationMs)),
      /* the label the model reads out carries "Ladies only", so a
         ladies-only time can't be offered without saying so */
      start_label: qatarLabel(start) + (ladies ? LADIES_SUFFIX : ''),
      ladies_only: ladies
    });
  }

  const shown = days.find((d) => d.slots.length) ?? days[0];
  return { days, date: shown.date, slots: shown.slots };
}
