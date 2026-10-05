import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Flow, choiceFor, choiceFromAvailability } from '../ui/src/flow.js';
import { bookedNote, bookingArgs, classifyBookingError, newRequestId, validateDetails } from '../ui/src/booking.js';
import type { Business, BookingResult, Slot } from '../ui/src/types.js';

const gym: Business = {
  business_id: 'b1', name: 'Falcon Gym', name_ar: 'نادي الصقر', category: 'gym', area: 'Al Sadd', address: 'Al Sadd, Doha, Qatar',
  services: [
    { service_id: 's1', name: 'Day pass', duration_min: 90, price_qar: 50 },
    { service_id: 's2', name: 'CrossFit class', name_ar: 'كروسفت جماعي', duration_min: 60, price_qar: 80 }
  ]
};
const slot: Slot = { slot_id: 'x1', start: '2026-10-08T19:00:00+03:00', end: '2026-10-08T20:00:00+03:00', start_label: 'Thu 8 Oct, 7:00 PM', spots_left: 5 };
const booking: BookingResult = {
  booking_id: 'bk', reference: 'ATO-AB12CD', status: 'pending', business_name: 'Falcon Gym', service_name: 'CrossFit class',
  start: slot.start, start_label: slot.start_label
};

/* ── step history ── */

test('back walks the steps in reverse, and the first step has no back', () => {
  const f = new Flow({ kind: 'places', search: { businesses: [gym], count: 1 } });
  assert.equal(f.canGoBack, false);
  f.push({ kind: 'services', business: gym });
  f.push({ kind: 'times', choice: choiceFor(gym, 's2')! });
  assert.equal(f.current.kind as string, 'times');
  assert.ok(f.back());
  assert.equal(f.current.kind as string, 'services');
  assert.ok(f.back());
  assert.equal(f.current.kind as string, 'places');
  assert.equal(f.back(), false);
});

test('a card opened at times has no back', () => {
  const f = new Flow({ kind: 'times', choice: choiceFor(gym, 's1')! });
  assert.equal(f.canGoBack, false);
});

test('booking ends the flow: no way back to the form', () => {
  const f = new Flow({ kind: 'places', search: { businesses: [gym], count: 1 } });
  f.push({ kind: 'services', business: gym });
  f.finish(booking);
  assert.equal(f.current.kind as string, 'booked');
  assert.equal(f.canGoBack, false);
  assert.equal(f.depth, 1);
});

test('a step keeps what it loaded when you come back to it', () => {
  const f = new Flow({ kind: 'times', choice: choiceFor(gym, 's2')!, data: { business_name: 'x', service_name: 'y', date: '2026-10-08', slots: [] }, selected: '2026-10-09' });
  f.push({ kind: 'details', choice: choiceFor(gym, 's2')!, slot, day: '2026-10-08', requestId: 'r', form: { name: '', phone: '' }, fieldErrors: {} });
  f.back();
  const cur = f.current;
  assert.equal(cur.kind, 'times');
  if (cur.kind === 'times') {
    assert.ok(cur.data);
    assert.equal(cur.selected, '2026-10-09');
  }
});

test('choice carries ids, names and price', () => {
  assert.deepEqual(choiceFor(gym, 's2'), {
    business_id: 'b1', business_name: 'Falcon Gym', business_name_ar: 'نادي الصقر',
    service_id: 's2', service_name: 'CrossFit class', service_name_ar: 'كروسفت جماعي', price_qar: 80, duration_min: 60,
    pay_at_venue: undefined, category: 'gym'
  });
  assert.equal(choiceFor(gym, 'nope'), null);
  assert.equal(choiceFromAvailability({ business_name: 'a', service_name: 'b', date: 'd', slots: [] }), null);
});

/* ── details form ── */

test('the form uses the server\'s phone rules', () => {
  for (const p of ['55123456', '974 5512-3456', '+97455123456', '00974 5512 3456']) {
    const v = validateDetails({ name: ' Mohamed ', phone: p });
    assert.deepEqual(v.errors, {}, p);
    assert.equal(v.phone, '+97455123456');
    assert.equal(v.name, 'Mohamed');
  }
  assert.deepEqual(validateDetails({ name: '', phone: '5512345' }).errors, { name: 'required', phone: 'invalid' });
  assert.equal(validateDetails({ name: 'x'.repeat(101), phone: '55123456' }).errors.name, 'tooLong');
});

test('booking arguments carry the normalised phone and the request id', () => {
  assert.deepEqual(bookingArgs(choiceFor(gym, 's2')!, slot, 'Mohamed', '+97455123456', 'req-1', 'ar'), {
    business_id: 'b1', service_id: 's2', slot_id: 'x1', customer_name: 'Mohamed',
    customer_phone: '+97455123456', request_id: 'req-1', language: 'ar'
  });
});

test('request ids are UUIDs and differ', () => {
  const a = newRequestId(), b = newRequestId();
  assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.notEqual(a, b);
});

/* ── privacy: what the model is told after booking ── */

test('the model hears what was booked, and nothing about the customer', () => {
  const note = bookedNote(booking);
  assert.match(note, /CrossFit class at Falcon Gym, Thu 8 Oct, 7:00 PM \(Qatar time\)/);
  assert.match(note, /Reference: ATO-AB12CD/);
  assert.match(note, /do not call create_booking/);
  /* the note is built from the booking result alone: there is no name or phone to leak */
  assert.doesNotMatch(note, /Mohamed|974|\+?\d{8}/);
});

/* ── server errors → what the card says ── */

test('booking errors map to card messages', () => {
  const c = (s: string) => classifyBookingError(s);
  assert.deepEqual(c('Sorry, that time is now fully booked. Call get_availability again and offer the user another time.'), { kind: 'slotGone', retime: true });
  assert.deepEqual(c('That time has already passed. Call get_availability and offer the user a later time.'), { kind: 'slotGone', retime: true });
  assert.deepEqual(c('This phone number already has a booking for that exact time, so nothing new was booked.'), { kind: 'duplicate', retime: false });
  assert.deepEqual(c('This phone number already has 3 booking requests waiting for confirmation. Please wait...'), { kind: 'tooMany', retime: false });
  assert.deepEqual(c('Please give a Qatar mobile number: 8 digits, optionally starting with +974 or 00974'), { kind: 'phone', retime: false });
  assert.deepEqual(c('Something went wrong on our side.'), { kind: 'other', retime: false });
});
