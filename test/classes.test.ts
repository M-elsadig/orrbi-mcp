import { test } from 'node:test';
import assert from 'node:assert/strict';
import { type ClassRow, classHours, dayRange, forModel, nextTimes, parseClock, pickSlots } from '../src/lib/classes.js';
import { fromPrice } from '../src/lib/cards.js';
import { windowTitle } from '../ui/src/i18n.js';

/* Aflete, Tuesday 6 Oct (Qatar = UTC+3) */
const svc = (name: string, short: string) => ({
  name_en: name, name_ar: null, short_name_en: short, short_name_ar: null, description_en: null, price: '100.00', duration_min: 60
});
const lower = svc('BUILD X SWEAT (Lower Body & Core)', 'BxS Lower & Core');
const snatch = svc('XFIT (Snatch Skills)', 'XFIT Snatch');
const aflete = { name_en: 'Aflete', name_ar: 'أفليت', area: 'West Bay', category: 'gym', pay_at_venue: true, cancellation_hours: 4 };

const row = (id: string, utc: string, s = lower, ladies = false, booked = 0): ClassRow => ({
  id, starts_at: utc, capacity: 16, booked_count: booked, ladies_only: ladies,
  business_id: 'b1', service_id: s === lower ? 's-lower' : 's-snatch', services: s, businesses: aflete
});

const tuesday = [
  row('l0830', '2026-10-06T05:30:00Z', lower, true),
  row('l1600', '2026-10-06T13:00:00Z', lower, true),
  row('m1715', '2026-10-06T14:15:00Z'),
  row('m1830', '2026-10-06T15:30:00Z'),
  row('x1930', '2026-10-06T16:30:00Z', snatch)
];
const MON_EVENING = Date.parse('2026-10-05T15:00:00Z');   // Mon 6 PM Qatar
const ids = (f: Parameters<typeof pickSlots>[1], now = MON_EVENING) => pickSlots(tuesday, f, now).map((s) => s.slot_id);

test('part of day uses Qatar hours', () => {
  assert.deepEqual(ids({ part: 'morning' }), ['l0830']);
  assert.deepEqual(ids({ part: 'afternoon' }), ['l1600']);
  assert.deepEqual(ids({ part: 'evening' }), ['m1715', 'm1830', 'x1930']);
  assert.deepEqual(ids({}), ['l0830', 'l1600', 'm1715', 'm1830', 'x1930']);
});

test('"Tuesday 6:30" means within 90 minutes of it', () => {
  assert.deepEqual(ids({ around: '18:30' }), ['m1715', 'm1830', 'x1930']);
  assert.deepEqual(ids({ around: '18:30', ladiesOnly: false }), ['m1715', 'm1830', 'x1930']);
  assert.deepEqual(ids({ around: '08:00' }), ['l0830']);
});

test('ladies-only is per slot', () => {
  assert.deepEqual(ids({ ladiesOnly: true }), ['l0830', 'l1600']);
  assert.deepEqual(ids({ ladiesOnly: false, part: 'evening' }), ['m1715', 'm1830', 'x1930']);
});

test('booking cutoff is 90 minutes, not the 4h cancellation window; nothing full', () => {
  /* Tue 12:00 Qatar: 4:00 PM is 4h away, well outside 90 min, so it is offered */
  const tueNoon = Date.parse('2026-10-06T09:00:00Z');
  assert.deepEqual(ids({}, tueNoon), ['l1600', 'm1715', 'm1830', 'x1930']);
  /* Tue 3:00 PM Qatar: 4:00 PM is 60 min away → gone; 5:15 PM (135 min) stays */
  assert.deepEqual(ids({}, Date.parse('2026-10-06T12:00:00Z')), ['m1715', 'm1830', 'x1930']);
  /* the edge: 5:15 PM is offered at 91 min away, not at exactly 90 */
  assert.deepEqual(ids({}, Date.parse('2026-10-06T12:44:00Z')), ['m1715', 'm1830', 'x1930']);
  assert.deepEqual(ids({}, Date.parse('2026-10-06T12:45:00Z')), ['m1830', 'x1930']);
  const full = pickSlots([row('full', '2026-10-06T15:30:00Z', lower, false, 16)], {}, MON_EVENING);
  assert.deepEqual(full, []);
});

test('rows carry a short name and say "Ladies only" in the model\'s label', () => {
  const [first] = pickSlots(tuesday, { ladiesOnly: true }, MON_EVENING);
  assert.equal(first.class, 'BxS Lower & Core');
  assert.equal(first.class_full, 'BUILD X SWEAT (Lower Body & Core)');
  assert.equal(first.start_label, 'Tue 6 Oct, 8:30 AM · Ladies only');
  assert.equal(first.date, '2026-10-06');
  assert.equal(first.pay_at_venue, true);
  /* the model's copy stays lean */
  assert.deepEqual(Object.keys(forModel(first)).sort(),
    ['area', 'business_id', 'business_name', 'class', 'ladies_only', 'service_id', 'slot_id', 'start', 'start_label']);
});

test('clock parsing and the queried range', () => {
  assert.equal(parseClock('18:00'), 1080);
  assert.equal(parseClock('6:30'), 390);
  assert.equal(parseClock('25:00'), null);
  assert.deepEqual(dayRange('2026-10-06', 1), { from: '2026-10-05T21:00:00.000Z', to: '2026-10-06T21:00:00.000Z' });
});

test('the results title says what the answer is for', () => {
  const today = '2026-10-05';
  assert.equal(windowTitle({ date: today, days: 1, part_of_day: 'evening' }, 'en', today), 'Tonight');
  assert.equal(windowTitle({ date: '2026-10-06', days: 1, part_of_day: 'morning' }, 'en', today), 'Tomorrow · Morning');
  assert.equal(windowTitle({ date: '2026-10-06', days: 1 }, 'en', today), 'Tomorrow');
  assert.equal(windowTitle({ date: today, days: 7 }, 'en', today), 'This week');
  assert.equal(windowTitle({ date: today, days: 1, next: true }, 'en', today), 'Next open classes');
  assert.equal(windowTitle({ date: today, days: 1, part_of_day: 'evening' }, 'ar', today), 'الليلة');
});

/* ── the compact card ── */

test('a card shows the next 3 times that answer the question, one chip per time', () => {
  const evening = pickSlots(tuesday, { part: 'evening' }, MON_EVENING);
  assert.deepEqual(nextTimes(evening).map((t) => t.start), [
    '2026-10-06T17:15:00+03:00', '2026-10-06T18:30:00+03:00', '2026-10-06T19:30:00+03:00'
  ]);
  /* two classes at the same time are one chip */
  const twin = pickSlots([...tuesday, row('m1830b', '2026-10-06T15:30:00Z', snatch)], {}, MON_EVENING);
  assert.equal(nextTimes(twin, 10).filter((t) => t.start === '2026-10-06T18:30:00+03:00').length, 1);
  /* ladies-only chips stay marked */
  assert.deepEqual(nextTimes(pickSlots(tuesday, {}, MON_EVENING)).map((t) => t.ladies_only), [true, true, false]);
  /* within 90 minutes, nothing: at Tue 3:00 PM the 4:00 PM is gone and 5:15 PM comes first */
  assert.equal(nextTimes(pickSlots(tuesday, {}, Date.parse('2026-10-06T12:00:00Z')))[0].start, '2026-10-06T17:15:00+03:00');
  /* at Tue noon the 4:00 PM (4h away) still shows: the cancellation window is not a cutoff */
  assert.equal(nextTimes(pickSlots(tuesday, {}, Date.parse('2026-10-06T09:00:00Z')))[0].start, '2026-10-06T16:00:00+03:00');
});

test('"From" price is the cheapest bookable class', () => {
  assert.equal(fromPrice([{ price: '100.00', bookable: true }, { price: 80, bookable: true }, { price: 20, bookable: false }]), 80);
  assert.equal(fromPrice([{ price: 300, bookable: false }]), null);
  assert.equal(fromPrice(null), null);
});

test('class hours come from the bookable timetable', () => {
  assert.deepEqual(classHours([
    { weekday: 2, start_time: '17:15:00', bookable: true },
    { weekday: 0, start_time: '08:30:00', bookable: true },
    { weekday: 0, start_time: '19:30:00', bookable: true },
    { weekday: 5, start_time: '09:00:00', bookable: false }
  ]), [
    { weekday: 0, first: '08:30', last: '19:30' },
    { weekday: 2, first: '17:15', last: '17:15' }
  ]);
});
