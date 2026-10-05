import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cancellationText, paymentNote, priceText } from '../src/lib/payment.js';
import { whatsappLink } from '../src/lib/telegram.js';
import { blockedMessage } from '../src/tools/createBooking.js';

const gym = { price_qar: 100, pay_at_venue: true, category: 'gym' };

test('pay-at-the-gym prices say so, in both languages', () => {
  assert.equal(priceText(gym), '100 QAR — pay at the gym');
  assert.equal(priceText(gym, 'ar'), '100 ر.ق — الدفع في الجيم');
  assert.equal(priceText({ ...gym, category: 'spa' }), '100 QAR — pay at the venue');
  assert.equal(priceText({ price_qar: 1900 }), '1,900 QAR');
});

test('the payment sentence never says Orrbi takes the money', () => {
  const en = paymentNote(gym)!;
  assert.equal(en, 'Pay 100 QAR at the gym when you arrive. Orrbi only reserves your spot and never takes payment.');
  assert.equal(paymentNote({ pay_at_venue: true, category: 'gym' }),
    'Pay at the gym when you arrive. Orrbi only reserves your spot and never takes payment.');
  assert.equal(paymentNote({ price_qar: 100 }), null);
});

test('cancellation window', () => {
  assert.equal(cancellationText(4), 'Free cancellation up to 4 hours before the start.');
  assert.equal(cancellationText(null), null);
});

test('WhatsApp confirmation carries payment, cancellation and first-visit lines', () => {
  const url = whatsappLink({
    customer_name: 'Test', customer_phone: '+97455000000', business_name: 'Aflete', reference: 'ATO-AAAAAA',
    starts_at: '2026-10-05T15:00:00+00:00', ...gym, cancellation_hours: 4, first_visit_note_ar: 'تعال مبكراً.'
  });
  const lines = new URL(url).searchParams.get('text')!.split('\n');
  assert.equal(lines.length, 4);
  assert.match(lines[0], /^مرحبا Test، حجزك في Aflete .* رقم الحجز: ATO-AAAAAA$/);
  assert.equal(lines[1], '💳 ادفع 100 ر.ق في الجيم عند الحضور. أوربي يحجز مكانك فقط ولا يستلم أي مبلغ.');
  assert.equal(lines[2], '⏰ الإلغاء مجاني حتى 4 ساعات قبل الموعد.');
  assert.equal(lines[3], '📍 تعال مبكراً.');
});

test('blocked customers are told politely who to contact', () => {
  assert.match(blockedMessage(undefined), /contact the Orrbi team and we'll sort it out/);
  assert.match(blockedMessage('+974 5000 0000'), /WhatsApp at https:\/\/wa\.me\/97450000000/);
});
