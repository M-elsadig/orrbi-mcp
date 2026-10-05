import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describe, newRef, redact } from '../src/lib/errors.js';
import { genericError } from '../src/lib/results.js';

test('refs are short and unambiguous', () => {
  for (let i = 0; i < 50; i++) assert.match(newRef(), /^E-[2-9A-HJ-NP-Z]{6}$/);
});

test('the user sees the ref', () => {
  assert.equal(genericError('E-ABC234'),
    'Something went wrong on our side (error ref E-ABC234). Please try again in a moment.');
});

test('stored context keeps only the last 3 digits of a phone', () => {
  assert.deepEqual(redact({ customer_phone: '+974 5512 3456', customer_name: 'Test', slot_id: 'x', notes: undefined }),
    { customer_phone: '…456', customer_name: 'Test', slot_id: 'x' });
});

test('PostgREST errors keep code, details and hint', () => {
  const d = describe({ message: 'permission denied for table bookings', code: '42501', details: null, hint: 'grant it' });
  assert.equal(d.message, 'permission denied for table bookings');
  assert.equal(d.code, '42501');
  assert.deepEqual(d.detail, { hint: 'grant it' });
});

test('thrown Errors keep name and a short stack', () => {
  const d = describe(new TypeError('boom'));
  assert.equal(d.message, 'boom');
  assert.equal(d.detail.name, 'TypeError');
  assert.ok(String(d.detail.stack).split('\n').length <= 8);
});
