import { normalizeQatarPhone } from '../../src/lib/phone.js';
import type { Choice, DetailsForm } from './flow.js';
import type { BookingResult, Slot } from './types.js';

/* Booking from inside the card. Pure helpers, no DOM, no host calls. */

export type FieldErrors = { name?: 'required' | 'tooLong'; phone?: 'invalid' };

/* Same rules as the server: the phone check is the server's own code */
export function validateDetails(form: DetailsForm): { errors: FieldErrors; name: string; phone: string | null } {
  const name = form.name.trim();
  const phone = normalizeQatarPhone(form.phone);
  const errors: FieldErrors = {};
  if (!name) errors.name = 'required';
  else if (name.length > 100) errors.name = 'tooLong';
  if (!phone) errors.phone = 'invalid';
  return { errors, name, phone };
}

/* One id per details screen, reused if Confirm is tapped again: the server
   then returns the booking it already made instead of making a second one. */
export function newRequestId(): string {
  const c = globalThis.crypto;
  if (typeof c?.randomUUID === 'function') return c.randomUUID();
  const b = c.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function bookingArgs(choice: Choice, slot: Slot, name: string, phone: string, requestId: string, language: string) {
  return {
    business_id: choice.business_id,
    service_id: choice.service_id,
    slot_id: slot.slot_id,
    customer_name: name,
    customer_phone: phone,
    request_id: requestId,
    language
  };
}

/* What the model is told after a booking made in the card. Deliberately
   nothing about the customer: no name, no phone. */
export function bookedNote(b: BookingResult): string {
  const when = b.start_label ? `${b.start_label} (Qatar time)` : b.start;
  return `The user sent a booking request in the Orrbi card: ${b.service_name} at ${b.business_name}, ${when}. ` +
    `Status: ${b.status} (a request, not confirmed until the business confirms). Reference: ${b.reference}. ` +
    'The card already shows it; do not repeat the details, and do not call create_booking for it again.';
}

/* create_booking's error sentences (src/tools/createBooking.ts) → what the
   card says, and whether the user should go back and pick another time */
export type BookingErrorKind = 'slotGone' | 'duplicate' | 'tooMany' | 'phone' | 'blocked' | 'other';

export function classifyBookingError(text: string): { kind: BookingErrorKind; retime: boolean } {
  const t = text.toLowerCase();
  if (t.includes('fully booked') || t.includes('already passed') || t.includes('does not exist') || t.includes('different business or service') ||
      t.includes('too soon to book')) {
    return { kind: 'slotGone', retime: true };
  }
  if (t.includes('already has a booking for that exact time')) return { kind: 'duplicate', retime: false };
  if (t.includes('booking requests waiting')) return { kind: 'tooMany', retime: false };
  if (t.includes('qatar mobile number')) return { kind: 'phone', retime: false };
  if (t.includes('missed bookings')) return { kind: 'blocked', retime: false };
  return { kind: 'other', retime: false };
}
