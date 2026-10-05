import { test } from 'node:test';
import assert from 'node:assert/strict';
import { whatsappLink } from '../src/lib/telegram.js';

const alert = {
  booking_id: '00000000-0000-4000-8000-000000000000',
  reference: 'ATO-KX4CTS',
  business_name: 'Falcon Gym',
  service_name: 'CrossFit class',
  price_qar: 60,
  starts_at: '2026-10-05T15:00:00+00:00',   // 6:00 PM in Qatar
  start_label: 'Mon 5 Oct, 6:00 PM',
  customer_name: 'Mohamed Test',
  customer_phone: '+97455000000',
  notes: null
};

test('links to the customer number without +', () => {
  const url = new URL(whatsappLink(alert));
  assert.equal(url.origin + url.pathname, 'https://wa.me/97455000000');
});

test('prefills the Arabic confirmation in Qatar time', () => {
  const text = new URL(whatsappLink(alert)).searchParams.get('text');
  assert.equal(text,
    'مرحبا Mohamed Test، حجزك في Falcon Gym يوم الاثنين، 5 أكتوبر في 6:00 م تم تأكيده ✅ رقم الحجز: ATO-KX4CTS');
});

test('encodes names that contain URL syntax', () => {
  const url = new URL(whatsappLink({ ...alert, customer_name: 'A&B ?x=1 #y' }));
  assert.match(url.searchParams.get('text') ?? '', /^مرحبا A&B \?x=1 #y،/);
  assert.equal(url.hash, '');
});
