import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STUDIO_BUTTON, actionRow, keyboardAfter, noShowRow, parseAction, textAfter, webhookSecret } from '../src/lib/telegramActions.js';

const ID = '3f2c1a9e-8b7d-4c6e-9f00-112233445566';
const WA = 'https://wa.me/97455000000?text=%D9%85%D8%B1%D8%AD%D8%A8%D8%A7';
const ALERT = '🆕 New booking request (pending)\n\nRef: ATO-KX4CTS\nBusiness: Aflete';
const KEYBOARD = { inline_keyboard: [[{ text: '💬 Send WhatsApp confirmation', url: WA }], actionRow(ID)] };

test('buttons round-trip and fit in 64 bytes', () => {
  for (const b of [...actionRow(ID), ...noShowRow(ID)]) {
    assert.ok(Buffer.byteLength(b.callback_data!) <= 64);
  }
  assert.deepEqual(parseAction(actionRow(ID)[0].callback_data), { outcome: 'confirmed', bookingId: ID });
  assert.deepEqual(parseAction(actionRow(ID)[1].callback_data), { outcome: 'failed', bookingId: ID });
  assert.deepEqual(parseAction(noShowRow(ID)[0].callback_data), { outcome: 'no_show', bookingId: ID });
});

test('anything else is refused', () => {
  for (const d of [undefined, '', 'x:' + ID, 'c:', 'c:not-a-uuid', `c:${ID}' or 1=1`, 42]) {
    assert.equal(parseAction(d), null, String(d));
  }
});

test('confirmed: WhatsApp confirmation stays, ✅/❌ go, 🚫 No-show appears', () => {
  const t = textAfter(ALERT, 'confirmed', 'Mon 5 Oct, 18:02');
  assert.match(t, /^✅ Booking confirmed\n\nRef: ATO-KX4CTS/);
  assert.match(t, /✅ CONFIRMED/);
  assert.match(t, /\(Mon 5 Oct, 18:02, Qatar time\)$/);
  assert.deepEqual(keyboardAfter(KEYBOARD, 'confirmed', ID), {
    inline_keyboard: [[{ text: '💬 Send WhatsApp confirmation', url: WA }], noShowRow(ID)]
  });
});

test('failed: the WhatsApp button opens a plain chat, not "your booking is confirmed"', () => {
  assert.match(textAfter(ALERT, 'failed', 'now'), /^❌ Couldn't book\n[\s\S]*contact the customer/);
  assert.deepEqual(keyboardAfter(KEYBOARD, 'failed', ID),
    { inline_keyboard: [[{ text: '💬 WhatsApp the customer', url: 'https://wa.me/97455000000' }]] });
});

test('no-show: counts, says when the customer is blocked, drops the No-show button', () => {
  const confirmed = textAfter(ALERT, 'confirmed', 'earlier');
  const first = textAfter(confirmed, 'no_show', 'now', { count: 1, limit: 2 });
  assert.match(first, /^🚫 No-show\n/);
  assert.match(first, /now has 1 no-show\./);
  assert.doesNotMatch(first, /blocked/);
  assert.match(textAfter(confirmed, 'no_show', 'now', { count: 2, limit: 2 }), /2 no-shows\. They are now blocked/);

  const after = keyboardAfter({ inline_keyboard: [[{ text: '💬', url: WA }], noShowRow(ID)] }, 'no_show', ID);
  assert.deepEqual(after, { inline_keyboard: [[{ text: '💬 WhatsApp the customer', url: 'https://wa.me/97455000000' }]] });
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

test('confirmed: the customer confirmation is never swapped for the studio request', () => {
  const STUDIO = 'https://wa.me/97477700000?text=Hello%20Irish';
  const withStudio = { inline_keyboard: [[{ text: STUDIO_BUTTON, url: STUDIO }], [{ text: '💬 Send WhatsApp confirmation', url: WA }], actionRow(ID)] };
  assert.deepEqual(keyboardAfter(withStudio, 'confirmed', ID), {
    inline_keyboard: [[{ text: '💬 Send WhatsApp confirmation', url: WA }], noShowRow(ID)]
  });
  assert.deepEqual(keyboardAfter(withStudio, 'failed', ID),
    { inline_keyboard: [[{ text: '💬 WhatsApp the customer', url: 'https://wa.me/97455000000' }]] });
});
