import { test } from 'node:test';
import assert from 'node:assert/strict';
import { arabicHours, cancellationText, payOnArrival, paymentNote, priceText } from '../src/lib/payment.js';
import { whatsappLink, whatsappMessage } from '../src/lib/telegram.js';
import { mapsLink } from '../src/lib/maps.js';
import { blockedMessage, bookingLanguage } from '../src/tools/createBooking.js';

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

test('Arabic hours agree with the number: never "24 ساعات"', () => {
  assert.equal(arabicHours(1), 'ساعة واحدة');
  assert.equal(arabicHours(2), 'ساعتين');
  assert.equal(arabicHours(4), '4 ساعات');
  assert.equal(arabicHours(10), '10 ساعات');
  assert.equal(arabicHours(11), '11 ساعة');
  assert.equal(arabicHours(24), '24 ساعة');
  assert.equal(cancellationText(24, 'ar'), 'الإلغاء مجاني حتى 24 ساعة قبل الموعد.');
  assert.equal(cancellationText(2, 'ar'), 'الإلغاء مجاني حتى ساعتين قبل الموعد.');
  assert.equal(cancellationText(1), 'Free cancellation up to 1 hour before the start.');
});

test('pay on arrival names the business, never "the gym"', () => {
  assert.equal(payOnArrival(gym, 'Studio 11 Fitness'), 'Pay 100 QAR at Studio 11 Fitness on arrival.');
  assert.equal(payOnArrival(gym, 'Studio 11 Fitness', 'ar'), 'ادفع 100 ر.ق في Studio 11 Fitness عند الحضور.');
  assert.equal(payOnArrival({ price_qar: 100 }, 'X'), null);
});

test('Maps link: the business pin, else its coordinates, else a search for name and address', () => {
  assert.equal(mapsLink({ name: 'Aflete', maps_url: 'https://maps.app.goo.gl/U2zKH2AH7KpoBZbW9' }), 'https://maps.app.goo.gl/U2zKH2AH7KpoBZbW9');
  assert.equal(mapsLink({ name: 'X', lat: 25.3, lng: 51.5 }), 'https://www.google.com/maps/search/?api=1&query=25.3,51.5');
  assert.equal(mapsLink({ name: 'Studio 11 Fitness', address: '35 West Bay Towers, Doha' }),
    'https://www.google.com/maps/search/?api=1&query=Studio%2011%20Fitness%2C%2035%20West%20Bay%20Towers%2C%20Doha');
});

const studio = {
  customer_name: 'Mohamed', customer_phone: '+97455000000', business_name: 'Studio 11 Fitness', business_name_ar: 'Studio 11 Fitness',
  service_name: 'Discovery Session', service_name_ar: 'جلسة تعريفية', trainer: 'Aaron Clarke', reference: 'ORB-7KQ2MX',
  starts_at: '2026-10-08T06:30:00+00:00', price_qar: 160, pay_at_venue: true, category: 'gym', cancellation_hours: 24,
  first_visit_note_en: 'EMS suit and kit are provided.', first_visit_note_ar: 'بدلة EMS والمعدات متوفرة في الاستوديو.',
  maps_link: 'https://maps.example/s11'
};

test('WhatsApp confirmation in English for an English booking', () => {
  assert.equal(whatsappMessage({ ...studio, language: 'en' }), [
    'Hi Mohamed, your booking at Studio 11 Fitness is confirmed ✅',
    'Discovery Session with Aaron Clarke · Thu 8 Oct, 9:30 AM',
    'Ref: ORB-7KQ2MX',
    '',
    '💳 Pay 160 QAR at Studio 11 Fitness on arrival.',
    '⏰ Free cancellation up to 24 hours before the start.',
    'ℹ️ EMS suit and kit are provided.',
    '📍 https://maps.example/s11'
  ].join('\n'));
});

test('WhatsApp confirmation in Arabic for an Arabic booking, with correct hours and the business name', () => {
  const text = whatsappMessage({ ...studio, language: 'ar' });
  const lines = text.split('\n');
  assert.equal(lines[0], 'مرحبا Mohamed، تم تأكيد حجزك في Studio 11 Fitness ✅');
  assert.match(lines[1], /^جلسة تعريفية مع Aaron Clarke · /);
  assert.equal(lines[2], 'رقم الحجز: ORB-7KQ2MX');
  assert.equal(lines[4], '💳 ادفع 160 ر.ق في Studio 11 Fitness عند الحضور.');
  assert.equal(lines[5], '⏰ الإلغاء مجاني حتى 24 ساعة قبل الموعد.');
  assert.equal(lines[6], 'ℹ️ بدلة EMS والمعدات متوفرة في الاستوديو.');
  assert.equal(lines[7], '📍 https://maps.example/s11');
  assert.doesNotMatch(text, /الجيم|ساعات قبل/);
});

test('a booking from before the language was stored stays Arabic', () => {
  assert.match(whatsappMessage({ ...studio, language: null }), /^مرحبا/);
});

test('the link encodes the message for the customer number', () => {
  const url = new URL(whatsappLink({ ...studio, language: 'en' }));
  assert.equal(url.origin + url.pathname, 'https://wa.me/97455000000');
  assert.match(url.searchParams.get('text')!, /^Hi Mohamed,/);
});

test('booking language: as passed, else Arabic letters in the name, else English', () => {
  assert.equal(bookingLanguage('en', 'محمد'), 'en');
  assert.equal(bookingLanguage(undefined, 'محمد الصادق'), 'ar');
  assert.equal(bookingLanguage(undefined, 'Mohamed'), 'en');
});

test('blocked customers are told politely who to contact', () => {
  assert.match(blockedMessage(undefined), /contact the Orrbi team and we'll sort it out/);
  assert.match(blockedMessage('+974 5000 0000'), /WhatsApp at https:\/\/wa\.me\/97450000000/);
});
