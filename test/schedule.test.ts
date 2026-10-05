import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clock, weeklyTimes } from '../src/lib/schedule.js';

const r = (weekday: number, start_time: string, ladies_only = false, bookable = true) => ({ weekday, start_time, ladies_only, bookable });

/* Aflete BUILD X SWEAT (Full Body): Sunday only */
const fullBody = [r(0, '18:30:00'), r(0, '08:30:00', true), r(0, '17:15:00'), r(0, '16:00:00', true)];

test('clock times', () => {
  assert.equal(clock('08:30:00'), '8:30 AM');
  assert.equal(clock('12:00:00'), '12:00 PM');
  assert.equal(clock('00:15:00'), '12:15 AM');
  assert.equal(clock('19:30:00'), '7:30 PM');
});

test('weekly times in order, ladies-only marked', () => {
  assert.equal(weeklyTimes(fullBody), 'Sun 8:30 AM (ladies only), 4:00 PM (ladies only), 5:15 PM, 6:30 PM');
});

test('filtered to one kind, the mark is dropped', () => {
  assert.equal(weeklyTimes(fullBody, true), 'Sun 8:30 AM, 4:00 PM');
  assert.equal(weeklyTimes(fullBody, false), 'Sun 5:15 PM, 6:30 PM');
});

test('non-bookable times (Friday PFT) are left out; several days join with ;', () => {
  const hycross = [r(1, '08:30:00', true), r(1, '17:15:00'), r(5, '08:00:00', false, false)];
  assert.equal(weeklyTimes(hycross), 'Mon 8:30 AM (ladies only), 5:15 PM');
  assert.equal(weeklyTimes([r(5, '08:00:00', false, false)]), null);
  assert.equal(weeklyTimes([r(2, '18:30:00'), r(0, '09:30:00')]), 'Sun 9:30 AM; Tue 6:30 PM');
});
