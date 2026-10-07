import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildWeek, type SlotRow } from '../src/lib/availability.js';
import { DEFAULT_BOOKING_CUTOFF_MIN, cutoffMin, cutoffMs, cutoffText } from '../src/lib/cutoff.js';
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

test('nothing within the 90-minute booking cutoff is offered (Aflete)', () => {
  const at = (utc: string) => buildWeek(tuesday, '2026-10-06', 60, Date.parse(utc), { minLeadMs: cutoffMs(90) })
    .slots.map((s) => s.slot_id);
  /* Tue 1:00 PM Qatar: 4:00 PM is 3h away, inside the 4h cancellation window but bookable */
  assert.deepEqual(at('2026-10-06T10:00:00Z'), ['l1600', 'm1715', 'm1830']);
  /* Tue 3:00 PM Qatar: 4:00 PM is 60 min away → not offered */
  assert.deepEqual(at('2026-10-06T12:00:00Z'), ['m1715', 'm1830']);
  /* exactly 90 min before 4:00 PM (2:30 PM Qatar) → not offered; 91 min → offered */
  assert.deepEqual(at('2026-10-06T11:30:00Z'), ['m1715', 'm1830']);
  assert.deepEqual(at('2026-10-06T11:29:00Z'), ['l1600', 'm1715', 'm1830']);
});

test('the cutoff is per business: 2 hours hides what 90 minutes would offer', () => {
  /* Tue 2:15 PM Qatar: 4:00 PM is 105 min away */
  const now = Date.parse('2026-10-06T11:15:00Z');
  const ids = (min: number) => buildWeek(tuesday, '2026-10-06', 60, now, { minLeadMs: cutoffMs(min) }).slots.map((s) => s.slot_id);
  assert.deepEqual(ids(90), ['l1600', 'm1715', 'm1830']);
  assert.deepEqual(ids(120), ['m1715', 'm1830']);
  /* exactly 2 hours before 4:00 PM → not offered */
  assert.deepEqual(buildWeek(tuesday, '2026-10-06', 60, Date.parse('2026-10-06T11:00:00Z'), { minLeadMs: cutoffMs(120) })
    .slots.map((s) => s.slot_id), ['m1715', 'm1830']);
});

test('a missing or bad cutoff falls back to 90 minutes', () => {
  assert.equal(DEFAULT_BOOKING_CUTOFF_MIN, 90);
  assert.equal(cutoffMin(null), 90);
  assert.equal(cutoffMin(undefined), 90);
  assert.equal(cutoffMin(-5), 90);
  assert.equal(cutoffMin('abc'), 90);
  assert.equal(cutoffMin(120), 120);
  assert.equal(cutoffMin(0), 0);
  assert.equal(cutoffText(90), '90 minutes');
  assert.equal(cutoffText(120), '2 hours');
  assert.equal(cutoffText(60), '1 hour');
});

/* Studio 11: one slot per trainer at the same time */
const aaron = { id: '11111111-1111-4111-8111-111111111111', name: 'Aaron Clarke', gender: 'male', title_en: 'Personal Trainer & EMS Specialist', title_ar: null, photo_url: null };
const jackie = { id: '22222222-2222-4222-8222-222222222222', name: 'Jackie Mora', gender: 'female', title_en: null, title_ar: null, photo_url: 'https://evil.example.com/x.jpg' };
const appts: SlotRow[] = [
  { ...row('a10', '2026-10-08T07:00:00Z', 1), staff: aaron },     // Thu 10:00 AM Qatar
  { ...row('j10', '2026-10-08T07:00:00Z', 1), staff: jackie },
  { ...row('a1030', '2026-10-08T07:30:00Z', 1, 1), staff: aaron }  // taken
];

test('appointment slots name their trainer, and staff_id keeps one trainer', () => {
  const w = buildWeek(appts, '2026-10-08', 30, NOW);
  assert.deepEqual(w.slots.map((s) => s.slot_id), ['a10', 'j10']);
  assert.equal(w.slots[0].start_label, 'Thu 8 Oct, 10:00 AM · with Aaron Clarke');
  assert.equal(w.slots[0].trainer?.name, 'Aaron Clarke');
  assert.equal(w.slots[0].trainer?.gender, 'male');
  assert.equal(w.slots[0].end, '2026-10-08T10:30:00+03:00');
  /* a photo outside our Storage is dropped */
  assert.equal(w.slots[1].trainer?.photo_url, null);
  assert.deepEqual(buildWeek(appts, '2026-10-08', 30, NOW, { staffId: jackie.id }).slots.map((s) => s.slot_id), ['j10']);
});

test('group class slots have no trainer', () => {
  const w = buildWeek(tuesday, '2026-10-06', 60, MON);
  assert.ok(w.slots.every((s) => !('trainer' in s)));
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
