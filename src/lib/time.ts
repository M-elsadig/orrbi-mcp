/* Everything is shown in Qatar time, explicitly. The server runs in UTC, so
   `new Date(x).getHours()` would be three hours behind Doha (the same bug the
   app's agent hit). Qatar has no DST, so the offset is fixed. */

export const TZ = 'Asia/Qatar';
export const TZ_LABEL = 'Asia/Qatar (UTC+3)';
const OFFSET_MS = 3 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/* YYYY-MM-DD as it reads in Qatar */
export function todayInQatar(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(now);
}

/* true for real calendar dates only: rejects 2026-02-30 */
export function isRealDate(ymd: string): boolean {
  const d = new Date(ymd + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === ymd;
}

/* [start, end) of a Qatar calendar day, as UTC instants */
export function qatarDayRange(ymd: string): { from: Date; to: Date } {
  const from = new Date(ymd + 'T00:00:00+03:00');
  return { from, to: new Date(from.getTime() + DAY_MS) };
}

/* 2026-10-05T18:00:00+03:00 */
export function toQatarIso(at: Date | string): string {
  const d = typeof at === 'string' ? new Date(at) : at;
  return new Date(d.getTime() + OFFSET_MS).toISOString().slice(0, 19) + '+03:00';
}

/* Sun 5 Oct, 6:00 PM */
export function qatarLabel(at: Date | string): string {
  const d = typeof at === 'string' ? new Date(at) : at;
  const p: Record<string, string> = {};
  const f = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short',
    hour: 'numeric', minute: '2-digit', hour12: true
  });
  for (const part of f.formatToParts(d)) p[part.type] = part.value;
  return `${p.weekday} ${p.day} ${p.month}, ${p.hour}:${p.minute} ${(p.dayPeriod ?? '').toUpperCase()}`;
}

/* الاثنين، 5 أكتوبر في 6:00 م — Arabic names, Western digits to match the
   reference and phone number around it */
export function qatarLabelAr(at: Date | string): string {
  const d = typeof at === 'string' ? new Date(at) : at;
  return new Intl.DateTimeFormat('ar-QA-u-nu-latn', {
    timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long',
    hour: 'numeric', minute: '2-digit', hour12: true
  }).format(d);
}
