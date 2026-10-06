/* How close to the start a class can still be booked through Orrbi. Every
   booking is a request someone confirms by hand, so the last 90 minutes are
   left for that. This is not the cancellation policy: free cancellation
   (businesses.cancellation_hours, 4h for Aflete) is only ever said to the
   customer, never used to hide or refuse times. */
export const BOOKING_CUTOFF_MIN = 90;
export const BOOKING_CUTOFF_MS = BOOKING_CUTOFF_MIN * 60_000;
