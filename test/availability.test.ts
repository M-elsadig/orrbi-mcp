import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildWeek, type SlotRow } from '../src/lib/availability.js';
import { dayChip, periodOf } from '../ui/src/i18n.js';

/* starts_at as the database returns it (UTC); Qatar is UTC+3 */
const row = (id: string, utc: string, capacity = 5, booked = 0): SlotRow => ({ id, starts_at: utc, capacity, booked_count: booked });
const NOW = Date.parse('2026-10-03T12:00:00Z');   // 3 Oct, 3:00 PM in Qatar

test('7 days from the requested date, each with its open slots', () => {
  const w = buildWeek([
    row('a', '2026-10-03T15:00:00Z'),            // 3 Oct 6 PM Qatar
    row('b', '2026-10-05T06:00:00Z')             // 5 Oct 9 AM Qatar
  ], '2026-10-03', 60, NOW);
  assert.deepEqual(w.days.map((d) => d.date),
    ['2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09']);
  assert.deepEqual(w.days.map((d) => d.slots.length), [1, 0, 1, 0, 0, 0, 0]);
  assert.equal(w.date, '2026-10-03');
  assert.equal(w.slots[0].start, '2026-10-03T18:00:00+03:00');
  assert.equal(w.slots[0].end, '2026-10-03T19:00:00+03:00');
});

test('an empty requested day moves to the next day with open times', () => {
  const w = buildWeek([row('b', '2026-10-05T06:00:00Z')], '2026-10-03', 60, NOW);
  assert.equal(w.date, '2026-10-05');
  assert.deepEqual(w.slots.map((s) => s.slot_id), ['b']);
});

test('past, full and out-of-window slots are left out', () => {
  const w = buildWeek([
    row('past', '2026-10-03T09:00:00Z'),          // noon Qatar, before NOW
    row('full', '2026-10-03T16:00:00Z', 5, 5),
    row('late', '2026-10-10T06:00:00Z')           // day 8
  ], '2026-10-03', 60, NOW);
  assert.ok(w.days.every((d) => d.slots.length === 0));
  assert.equal(w.date, '2026-10-03');             // a whole empty week shows the requested day
  assert.deepEqual(w.slots, []);
});

test('days are Qatar calendar days, not UTC ones', () => {
  /* 22:30 UTC on 3 Oct is 1:30 AM on 4 Oct in Qatar */
  const w = buildWeek([row('x', '2026-10-03T22:30:00Z')], '2026-10-03', 30, NOW);
  assert.equal(w.days[0].slots.length, 0);
  assert.equal(w.days[1].slots[0].slot_id, 'x');
});

test('in time order, with no spot counts', () => {
  const w = buildWeek([row('late', '2026-10-04T15:00:00Z', 5, 3), row('early', '2026-10-04T06:00:00Z')], '2026-10-04', 60, NOW);
  assert.deepEqual(w.slots.map((s) => s.slot_id), ['early', 'late']);
  assert.ok(w.slots.every((s) => !('spots_left' in s)));
});

/* Aflete Tuesday: Lower Body & Core is ladies-only at 8:30 AM and 4:00 PM, mixed at 5:15 and 6:30 PM */
const tuesday = [
  { ...row('l0830', '2026-10-06T05:30:00Z', 16), ladies_only: true },
  { ...row('l1600', '2026-10-06T13:00:00Z', 16), ladies_only: true },
  { ...row('m1715', '2026-10-06T14:15:00Z', 16), ladies_only: false },
  { ...row('m1830', '2026-10-06T15:30:00Z', 16), ladies_only: false }
];
const MON = Date.parse('2026-10-05T13:30:00Z');   // Mon 5 Oct, 4:30 PM Qatar

test('ladies-only is per slot: filter either way, or both with the label saying so', () => {
  const ids = (o?: boolean) => buildWeek(tuesday, '2026-10-06', 60, MON, { ladiesOnly: o }).slots.map((s) => s.slot_id);
  assert.deepEqual(ids(true), ['l0830', 'l1600']);
  assert.deepEqual(ids(false), ['m1715', 'm1830']);
  assert.deepEqual(ids(undefined), ['l0830', 'l1600', 'm1715', 'm1830']);

  const both = buildWeek(tuesday, '2026-10-06', 60, MON).slots;
  assert.equal(both[0].start_label, 'Tue 6 Oct, 8:30 AM · Ladies only');
  assert.equal(both[0].ladies_only, true);
  assert.equal(both[2].start_label, 'Tue 6 Oct, 5:15 PM');
  assert.equal(both[2].ladies_only, false);
});

test('nothing inside the cancellation window is offered', () => {
  const lead = (h: number) => buildWeek(tuesday, '2026-10-06', 60, Date.parse('2026-10-06T10:00:00Z'), { minLeadMs: h * 3_600_000 })
    .slots.map((s) => s.slot_id);
  /* now = Tue 1:00 PM Qatar; 4h → only 5:15 PM onwards (4:00 PM is 3h away) */
  assert.deepEqual(lead(4), ['m1715', 'm1830']);
  assert.deepEqual(lead(0), ['l1600', 'm1715', 'm1830']);
});

test('morning / afternoon / evening by Qatar hour', () => {
  assert.equal(periodOf('2026-10-04T09:00:00+03:00'), 'morning');
  assert.equal(periodOf('2026-10-04T11:59:00+03:00'), 'morning');
  assert.equal(periodOf('2026-10-04T12:00:00+03:00'), 'afternoon');
  assert.equal(periodOf('2026-10-04T16:30:00+03:00'), 'afternoon');
  assert.equal(periodOf('2026-10-04T17:00:00+03:00'), 'evening');
  assert.equal(periodOf('2026-10-04T21:00:00+03:00'), 'evening');
});

test('day chips say Today and Tomorrow, then the weekday', () => {
  assert.deepEqual(dayChip('2026-10-03', 'en', '2026-10-03'), { top: 'Today', num: '3' });
  assert.deepEqual(dayChip('2026-10-04', 'en', '2026-10-03'), { top: 'Tomorrow', num: '4' });
  assert.deepEqual(dayChip('2026-10-05', 'en', '2026-10-03'), { top: 'Mon', num: '5' });
  assert.deepEqual(dayChip('2026-10-04', 'ar', '2026-10-03'), { top: 'غداً', num: '4' });
});
