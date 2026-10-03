import { addDays, qatarLabel, todayInQatar, toQatarIso } from './time.js';

/* get_availability reads a whole week in one query and decides here which
   day to show. Pure (no database, `now` passed in) so it can be tested. */

export const WINDOW_DAYS = 7;

export type SlotRow = { id: string; starts_at: string; capacity: number; booked_count: number };

export type Slot = { slot_id: string; start: string; end: string; start_label: string; spots_left: number };

export type Day = { date: string; slots: Slot[] };

export type Week = {
  /* the 7 days from the requested date, each with its open slots */
  days: Day[];
  /* the day to show: the requested one, or the next one with open slots */
  date: string;
  slots: Slot[];
};

export function buildWeek(rows: SlotRow[], requested: string, durationMin: number, now: number): Week {
  const days: Day[] = Array.from({ length: WINDOW_DAYS }, (_, i) => ({ date: addDays(requested, i), slots: [] }));
  const byDate = new Map(days.map((d) => [d.date, d]));
  const durationMs = durationMin * 60_000;

  const sorted = [...rows].sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  for (const r of sorted) {
    const start = new Date(r.starts_at);
    const left = Number(r.capacity) - Number(r.booked_count);
    if (start.getTime() <= now || left <= 0) continue;

    const day = byDate.get(todayInQatar(start));   // the slot's Qatar calendar date
    if (!day) continue;
    day.slots.push({
      slot_id: r.id,
      start: toQatarIso(start),
      end: toQatarIso(new Date(start.getTime() + durationMs)),
      start_label: qatarLabel(start),
      spots_left: left
    });
  }

  const shown = days.find((d) => d.slots.length) ?? days[0];
  return { days, date: shown.date, slots: shown.slots };
}
