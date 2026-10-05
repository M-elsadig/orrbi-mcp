/* A class's weekly timetable as one line the model can read:
   "Sun 8:30 AM (ladies only), 4:00 PM (ladies only), 5:15 PM, 6:30 PM; Tue …"
   From schedule_templates rows (tend-app 0007). Pure, for tests. */

export type TemplateRow = { weekday: number; start_time: string; ladies_only: boolean; bookable: boolean };

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/* "17:15:00" → "5:15 PM" */
export function clock(t: string): string {
  const [h, m] = t.split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

/* Only bookable times. ladiesOnly true/false keeps just that kind; then the
   "(ladies only)" marks are dropped as redundant. null when nothing is left. */
export function weeklyTimes(rows: TemplateRow[], ladiesOnly?: boolean): string | null {
  const kept = rows
    .filter((r) => r.bookable && (ladiesOnly === undefined || r.ladies_only === ladiesOnly))
    .sort((a, b) => a.weekday - b.weekday || a.start_time.localeCompare(b.start_time));
  if (!kept.length) return null;

  const days = new Map<number, string[]>();
  for (const r of kept) {
    const time = clock(r.start_time) + (r.ladies_only && ladiesOnly === undefined ? ' (ladies only)' : '');
    days.set(r.weekday, [...(days.get(r.weekday) ?? []), time]);
  }
  return [...days].map(([d, times]) => `${DAYS[d]} ${times.join(', ')}`).join('; ');
}
