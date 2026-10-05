import { test } from 'node:test';
import assert from 'node:assert/strict';
import { actionRow, keyboardAfter, parseAction, textAfter, webhookSecret } from '../src/lib/telegramActions.js';

const ID = '3f2c1a9e-8b7d-4c6e-9f00-112233445566';
const WA = 'https://wa.me/97455000000?text=%D9%85%D8%B1%D8%AD%D8%A8%D8%A7';
const ALERT = '🆕 New booking request (pending)\n\nRef: ATO-KX4CTS\nBusiness: Aflete';
const KEYBOARD = { inline_keyboard: [[{ text: '💬 Send WhatsApp confirmation', url: WA }], actionRow(ID)] };

test('buttons round-trip and fit in 64 bytes', () => {
  for (const b of actionRow(ID)) {
    assert.ok(Buffer.byteLength(b.callback_data!) <= 64);
  }
  assert.deepEqual(parseAction(actionRow(ID)[0].callback_data), { outcome: 'confirmed', bookingId: ID });
  assert.deepEqual(parseAction(actionRow(ID)[1].callback_data), { outcome: 'failed', bookingId: ID });
});

test('anything else is refused', () => {
  for (const d of [undefined, '', 'x:' + ID, 'c:', 'c:not-a-uuid', `c:${ID}' or 1=1`, 42]) {
    assert.equal(parseAction(d), null, String(d));
  }
});

test('confirmed: headline and status line change, WhatsApp confirmation stays, ✅/❌ go', () => {
  const t = textAfter(ALERT, 'confirmed', 'Mon 5 Oct, 18:02');
  assert.match(t, /^✅ Booking confirmed\n\nRef: ATO-KX4CTS/);
  assert.match(t, /✅ CONFIRMED/);
  assert.match(t, /\(Mon 5 Oct, 18:02, Qatar time\)$/);
  assert.deepEqual(keyboardAfter(KEYBOARD, 'confirmed'),
    { inline_keyboard: [[{ text: '💬 Send WhatsApp confirmation', url: WA }]] });
});

test('failed: the WhatsApp button opens a plain chat, not "your booking is confirmed"', () => {
  assert.match(textAfter(ALERT, 'failed', 'now'), /^❌ Couldn't book\n[\s\S]*contact the customer/);
  assert.deepEqual(keyboardAfter(KEYBOARD, 'failed'),
    { inline_keyboard: [[{ text: '💬 WhatsApp the customer', url: 'https://wa.me/97455000000' }]] });
});

test('a booking changed elsewhere keeps its headline and says so', () => {
  assert.match(textAfter(ALERT, 'cancelled', 'now'), /^🆕 New booking request[\s\S]*Already cancelled/);
});

test('the webhook secret is stable, Telegram-safe and not the token', () => {
  const s = webhookSecret('123:abc');
  assert.equal(s, webhookSecret('123:abc'));
  assert.notEqual(s, webhookSecret('123:abd'));
  assert.match(s, /^[0-9a-f]{48}$/);
});
