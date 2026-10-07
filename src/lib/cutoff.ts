/* How close to the start a time can still be booked through Orrbi. Every
   booking is a request someone confirms by hand, so the last stretch before
   the start is left for that. Each business sets its own
   (businesses.booking_cutoff_min: Aflete 90, Studio 11 120); this default
   covers a missing value. This is not the cancellation policy: free
   cancellation (businesses.cancellation_hours) is only ever said to the
   customer, never used to hide or refuse times. */
export const DEFAULT_BOOKING_CUTOFF_MIN = 90;

/* the business's cutoff in minutes, or the default when it's missing or bad */
export function cutoffMin(value: unknown): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_BOOKING_CUTOFF_MIN;
}

export function cutoffMs(value: unknown): number {
  return cutoffMin(value) * 60_000;
}

/* "90 minutes", "2 hours" */
export function cutoffText(value: unknown): string {
  const min = cutoffMin(value);
  if (min >= 60 && min % 60 === 0) return min === 60 ? '1 hour' : `${min / 60} hours`;
  return `${min} minutes`;
}
