import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  Flow, answered, answersFrom, choiceFromAvailability, classesAt, flaggedBy, fromClass, openGym, requirementsFor, shownDay, slotsByDay, timesOn
} from '../ui/src/flow.js';
import { bookedNote, bookingArgs, classifyBookingError, newRequestId, validateDetails } from '../ui/src/booking.js';
import { COMPOSER_CLEAR_PX, bottomClear } from '../ui/src/layout.js';
import type { BookingResult, CardsResult, ClassSlot, GymCard, GymPage, Requirement, Slot } from '../ui/src/types.js';

const card: GymCard = {
  business_id: 'b1', name: 'Test Gym', name_ar: 'نادي التجربة', category: 'gym', area: 'West Bay',
  image_url: null, from_price_qar: 100, pay_at_venue: true,
  next_times: [{ start: '2026-10-08T19:00:00+03:00', start_label: 'Thu 8 Oct, 7:00 PM', date: '2026-10-08', ladies_only: false }]
};
const cards: CardsResult = { gyms: [card], count: 1, date: '2026-10-08', days: 1 };

const cls = (id: string, start: string, service: string, ladies = false): ClassSlot => ({
  slot_id: id, business_id: 'b1', business_name: 'Test Gym', area: 'West Bay', service_id: service,
  class: service.toUpperCase(), class_full: `${service.toUpperCase()} (full)`, start, start_label: start,
  date: start.slice(0, 10), ladies_only: ladies, price_qar: 100, pay_at_venue: true, category: 'gym', duration_min: 60
});

const page: GymPage = {
  business_id: 'b1', name: 'Test Gym', category: 'gym', area: 'West Bay', address: 'West Bay, Doha',
  images: [], from_price_qar: 100, pay_at_venue: true, cancellation_hours: 4,
  services: [], other_services: [], class_hours: [],
  week: {
    date: '2026-10-08', days: 7, slots: [
      cls('a', '2026-10-08T08:30:00+03:00', 'bxs', true),
      cls('b', '2026-10-08T19:00:00+03:00', 'bxs'),
      cls('c', '2026-10-08T19:00:00+03:00', 'xfit'),
      cls('d', '2026-10-10T18:00:00+03:00', 'hycross')
    ]
  }
};

const slot: Slot = { slot_id: 'x1', start: '2026-10-08T19:00:00+03:00', end: '2026-10-08T20:00:00+03:00', start_label: 'Thu 8 Oct, 7:00 PM', ladies_only: false };
const booking: BookingResult = {
  booking_id: 'bk', reference: 'ATO-AB12CD', status: 'pending', business_name: 'Test Gym', service_name: 'CrossFit class',
  start: slot.start, start_label: slot.start_label
};

/* ── step history ── */

test('back walks the steps in reverse, and the carousel has no back', () => {
  const f = new Flow({ kind: 'cards', result: cards });
  assert.equal(f.canGoBack, false);
  f.push(openGym(card));
  f.push({ kind: 'class', page, start: slot.start, options: classesAt(page, slot.start) });
  assert.equal(f.current.kind as string, 'class');
  assert.ok(f.back());
  assert.equal(f.current.kind as string, 'gym');
  assert.ok(f.back());
  assert.equal(f.current.kind as string, 'cards');
  assert.equal(f.back(), false);
});

test('closing fullscreen goes home to the carousel, but never undoes a request', () => {
  const f = new Flow({ kind: 'cards', result: cards });
  f.push(openGym(card));
  f.push({ kind: 'details', ...fromClass(page.week.slots[1]), form: { name: '', phone: '' }, fieldErrors: {} });
  f.home();
  assert.equal(f.current.kind as string, 'cards');
  assert.equal(f.depth, 1);
  f.finish(booking, 4);
  f.home();
  assert.equal(f.current.kind as string, 'booked');
});

test('a request ends the flow: no way back to the form', () => {
  const f = new Flow({ kind: 'cards', result: cards });
  f.push(openGym(card));
  f.finish(booking);
  assert.equal(f.current.kind as string, 'booked');
  assert.equal(f.canGoBack, false);
  assert.equal(f.depth, 1);
});

/* ── gym page ── */

test('a tapped chip opens the gym on that day with that time picked', () => {
  const s = openGym(card, '2026-10-10T18:00:00+03:00');
  assert.equal(s.day, '2026-10-10');
  assert.equal(s.time, '2026-10-10T18:00:00+03:00');
  assert.equal(openGym(card).time, undefined);
});

test('days and times on the gym page', () => {
  assert.deepEqual([...slotsByDay(page).keys()], ['2026-10-08', '2026-10-10']);
  assert.equal(shownDay(page, '2026-10-10'), '2026-10-10');
  assert.equal(shownDay(page, '2026-10-09'), '2026-10-08');     // empty day → first with times
  assert.equal(shownDay(page), '2026-10-08');
  /* two classes at 7 PM are one time; the 8:30 ladies-only one stays marked */
  assert.deepEqual(timesOn(page, '2026-10-08'), [
    { start: '2026-10-08T08:30:00+03:00', ladies_only: true },
    { start: '2026-10-08T19:00:00+03:00', ladies_only: false }
  ]);
});

test('a time leads to the classes at it, and a gone time to none', () => {
  assert.deepEqual(classesAt(page, '2026-10-08T19:00:00+03:00').map((s) => s.slot_id), ['b', 'c']);
  assert.deepEqual(classesAt(page, '2026-10-08T21:00:00+03:00'), []);
});

test('a class becomes a choice (full name, cancellation window) and a slot (with its end)', () => {
  const { choice, slot: s } = fromClass(page.week.slots[0], 4);
  assert.equal(choice.service_name, 'BXS (full)');
  assert.equal(choice.pay_at_venue, true);
  assert.equal(choice.cancellation_hours, 4);
  assert.equal(s.slot_id, 'a');
  assert.equal(s.ladies_only, true);
  assert.equal(new Date(s.end).getTime() - new Date(s.start).getTime(), 60 * 60_000);
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
  const { choice } = fromClass(page.week.slots[1]);
  assert.deepEqual(bookingArgs(choice, slot, 'Mohamed', '+97455123456', 'req-1', 'ar'), {
    business_id: 'b1', service_id: 'bxs', slot_id: 'x1', customer_name: 'Mohamed',
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
  assert.match(note, /CrossFit class at Test Gym, Thu 8 Oct, 7:00 PM \(Qatar time\)/);
  assert.match(note, /Reference: ATO-AB12CD/);
  assert.match(note, /do not call create_booking/);
  assert.doesNotMatch(note, /Mohamed|974|\+?\d{8}/);
});

/* ── server errors → what the card says ── */

test('booking errors map to card messages', () => {
  const c = (s: string) => classifyBookingError(s);
  assert.deepEqual(c('Sorry, that time is now fully booked. Call get_availability again and offer the user another time.'), { kind: 'slotGone', retime: true });
  assert.deepEqual(c('That time has already passed. Call get_availability and offer the user a later time.'), { kind: 'slotGone', retime: true });
  assert.deepEqual(c('That time starts in 90 minutes or less, too soon to book through Orrbi: pick a later time.'), { kind: 'slotGone', retime: true });
  assert.deepEqual(c('This phone number already has a booking for that exact time, so nothing new was booked.'), { kind: 'duplicate', retime: false });
  assert.deepEqual(c('This phone number already has 3 booking requests waiting for confirmation. Please wait...'), { kind: 'tooMany', retime: false });
  assert.deepEqual(c('Please give a Qatar mobile number: 8 digits, optionally starting with +974 or 00974'), { kind: 'phone', retime: false });
  assert.deepEqual(c('Something went wrong on our side.'), { kind: 'other', retime: false });
});

/* ── 1:1 appointments and pre-booking requirements (Studio 11) ── */

const aaron = { id: 't-aaron', name: 'Aaron Clarke', gender: 'male' as const, title: 'Personal Trainer & EMS Specialist' };
const jackie = { id: 't-jackie', name: 'Jackie Mora', gender: 'female' as const };
const appt = (id: string, start: string, trainer: typeof aaron | typeof jackie): ClassSlot => ({
  ...cls(id, start, 'discovery'), business_id: 'b11', business_name: 'Studio 11 Fitness', duration_min: 30, price_qar: 160,
  trainer: trainer.name, trainer_info: trainer
});
const pacemaker: Requirement = {
  id: 'r-pace', kind: 'question', text: 'Do you have a pacemaker?', flag_answer: true,
  flag_note: 'Studio 11 will call you before your session.', service_id: null
};
const pregnant: Requirement = { ...pacemaker, id: 'r-preg', text: 'Are you pregnant?' };
const otherService: Requirement = { ...pacemaker, id: 'r-other', service_id: 'single' };
const studio: GymPage = {
  ...page, business_id: 'b11', name: 'Studio 11 Fitness', cancellation_hours: 24,
  staff: [{ ...aaron, specialties: [], specialties_ar: [] }, { ...jackie, specialties: [], specialties_ar: [] }],
  requirements: [pacemaker, pregnant, otherService],
  week: { date: '2026-10-08', days: 7, slots: [appt('s-a10', '2026-10-08T10:00:00+03:00', aaron), appt('s-j10', '2026-10-08T10:00:00+03:00', jackie)] }
};

test('one time chip, then the trainers at that time', () => {
  assert.deepEqual(timesOn(studio, '2026-10-08').map((x) => x.start), ['2026-10-08T10:00:00+03:00']);
  assert.deepEqual(classesAt(studio, '2026-10-08T10:00:00+03:00').map((s) => s.trainer), ['Aaron Clarke', 'Jackie Mora']);
});

test('picking a trainer carries them and the service\'s requirements into the booking', () => {
  const s = studio.week.slots[1];
  const { choice, slot: picked } = fromClass(s, studio.cancellation_hours, requirementsFor(studio, s.service_id));
  assert.equal(picked.trainer?.name, 'Jackie Mora');
  assert.equal(picked.end, '2026-10-08T07:30:00.000Z');
  assert.deepEqual(choice.requirements?.map((r) => r.id), ['r-pace', 'r-preg']);
});

test('a class gym has no requirements step (Aflete unchanged)', () => {
  const { choice } = fromClass(page.week.slots[1], 4, requirementsFor(page, 'bxs'));
  assert.equal(choice.requirements, undefined);
  assert.ok(!('requirements' in bookingArgs(choice, slot, 'Mohamed', '+97455123456', 'req-1', 'en')));
});

test('continue only when every question is answered; a Yes is flagged, not blocked', () => {
  const reqs = [pacemaker, pregnant];
  assert.equal(answered(reqs, {}), false);
  assert.equal(answered(reqs, { 'r-pace': false }), false);
  assert.equal(answered(reqs, { 'r-pace': true, 'r-preg': false }), true);
  assert.deepEqual(flaggedBy(reqs, { 'r-pace': true, 'r-preg': false }).map((r) => r.id), ['r-pace']);
  const notice: Requirement = { id: 'n', kind: 'notice', text: 'I agree' };
  assert.equal(answered([notice], { n: false }), false);
  assert.equal(answered([notice], { n: true }), true);
});

/* ── one screen: "Do any of these apply to you?" ── */

test('"None of these apply" answers every question false, in the shape create_booking stores', () => {
  assert.deepEqual(answersFrom([pacemaker, pregnant], {}, 'none'), { 'r-pace': false, 'r-preg': false });
});

test('"One or more applies": the ticked ones true, the rest false, and one tick is required', () => {
  const reqs = [pacemaker, pregnant];
  assert.equal(answersFrom(reqs, {}, 'some'), null);
  assert.equal(answersFrom(reqs, { 'r-pace': false }, 'some'), null);
  const a = answersFrom(reqs, { 'r-preg': true }, 'some')!;
  assert.deepEqual(a, { 'r-pace': false, 'r-preg': true });
  assert.ok(answered(reqs, a));
  /* booking still goes through, flagged */
  assert.deepEqual(flaggedBy(reqs, a).map((r) => r.id), ['r-preg']);
});

test('ticks from "one or more" do not leak into "none"', () => {
  assert.deepEqual(answersFrom([pacemaker, pregnant], { 'r-pace': true }, 'none'), { 'r-pace': false, 'r-preg': false });
});

test('notices must be agreed before either answer', () => {
  const notice: Requirement = { id: 'n', kind: 'notice', text: 'I will arrive 10 minutes early' };
  assert.equal(answersFrom([pacemaker, notice], {}, 'none'), null);
  assert.deepEqual(answersFrom([pacemaker, notice], { n: true }, 'none'), { 'r-pace': false, n: true });
  assert.equal(answersFrom([pacemaker, notice], { 'r-pace': true }, 'some'), null);
});

test('the answer from the one screen goes to create_booking as one entry per question', () => {
  const { choice } = fromClass(studio.week.slots[0], 24, requirementsFor(studio, 'discovery'));
  const args = bookingArgs(choice, slot, 'Mohamed', '+97455123456', 'req-1', 'en', answersFrom(choice.requirements!, {}, 'none')!);
  assert.deepEqual(args.requirements, [{ id: 'r-pace', answer: false }, { id: 'r-preg', answer: false }]);
});

test('booking args send exactly the answers given, never a default', () => {
  const { choice } = fromClass(studio.week.slots[0], 24, requirementsFor(studio, 'discovery'));
  const full = bookingArgs(choice, slot, 'Mohamed', '+97455123456', 'req-1', 'en', { 'r-pace': true, 'r-preg': false });
  assert.deepEqual(full.requirements, [{ id: 'r-pace', answer: true }, { id: 'r-preg', answer: false }]);
  /* an unanswered one is left out, so the server refuses rather than assuming "No" */
  const partial = bookingArgs(choice, slot, 'Mohamed', '+97455123456', 'req-1', 'en', { 'r-pace': false });
  assert.deepEqual(partial.requirements, [{ id: 'r-pace', answer: false }]);
});

test('requirements step sits between details and review, and Back returns to it', () => {
  const { choice, slot: picked } = fromClass(studio.week.slots[0], 24, requirementsFor(studio, 'discovery'));
  const f = new Flow({ kind: 'cards', result: cards });
  f.push({ kind: 'details', choice, slot: picked, form: { name: '', phone: '' }, fieldErrors: {} });
  f.push({ kind: 'requirements', choice, slot: picked, name: 'M', phone: '+97455123456', picks: {} });
  f.push({ kind: 'review', choice, slot: picked, name: 'M', phone: '+97455123456', answers: { 'r-pace': false, 'r-preg': false }, requestId: 'x' });
  assert.ok(f.back());
  assert.equal(f.current.kind as string, 'requirements');
});

test('a refused booking for missing answers is said as such, and is no reason to pick another time', () => {
  assert.deepEqual(classifyBookingError('Before booking, Studio 11 Fitness needs the user\'s own answer to: "Do you have a pacemaker?" (yes or no).'),
    { kind: 'requirements', retime: false });
  assert.deepEqual(classifyBookingError('This business needs every pre-booking requirement answered first.'),
    { kind: 'requirements', retime: false });
});

test('the model hears the trainer, never the screening', () => {
  const note = bookedNote({ ...booking, service_name: 'Discovery Session', business_name: 'Studio 11 Fitness', trainer: 'Aaron Clarke',
    health_note: 'Studio 11 will call you before your session.' });
  assert.match(note, /Discovery Session with Aaron Clarke at Studio 11 Fitness/);
  assert.doesNotMatch(note, /call you|health|screening/i);
});

/* ── room under the last button for the host's chat input ── */

test('fullscreen leaves room for Claude\'s chat input on a phone, even when the host reports no inset', () => {
  assert.equal(bottomClear({ platform: 'mobile', safeAreaInsets: { top: 0, right: 0, bottom: 0, left: 0 } }, false), COMPOSER_CLEAR_PX);
  assert.ok(COMPOSER_CLEAR_PX >= 140 + 60, 'clears a 140px input with room to spare');
  assert.equal(bottomClear({ deviceCapabilities: { touch: true } }, false), COMPOSER_CLEAR_PX);
  assert.equal(bottomClear({}, true), COMPOSER_CLEAR_PX);
  /* a host that reports a bigger inset wins */
  assert.equal(bottomClear({ platform: 'mobile', safeAreaInsets: { top: 0, right: 0, bottom: 300, left: 0 } }, false), 316);
  /* desktop: just a little air */
  assert.equal(bottomClear({ platform: 'web' }, false), 24);
});
