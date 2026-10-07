import { test } from 'node:test';
import assert from 'node:assert/strict';
import { studioWhatsappLink, whatsappLink } from '../src/lib/telegram.js';

const alert = {
  booking_id: '00000000-0000-4000-8000-000000000000',
  reference: 'ATO-KX4CTS',
  business_name: 'Test Gym',
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
    'مرحبا Mohamed Test، حجزك في Test Gym يوم الاثنين، 5 أكتوبر في 6:00 م تم تأكيده ✅ رقم الحجز: ATO-KX4CTS');
});

test('the customer confirmation names the trainer of a 1:1 session', () => {
  const text = new URL(whatsappLink({ ...alert, trainer: 'Jackie Mora' })).searchParams.get('text');
  assert.match(text ?? '', /^مرحبا Mohamed Test، حجزك في Test Gym مع Jackie Mora يوم /);
});

const studio = {
  ...alert,
  business_name: 'Studio 11 Fitness',
  service_name: 'Discovery Session',
  start_label: 'Thu 8 Oct, 10:00 AM',
  booking_contact: { name: 'Front desk', phone: '+974 5000 0000' },
  trainer: 'Aaron Clarke'
};

test('studio request: to the booking contact, with trainer, time and customer', () => {
  const url = new URL(studioWhatsappLink(studio)!);
  assert.equal(url.origin + url.pathname, 'https://wa.me/97450000000');
  const text = url.searchParams.get('text') ?? '';
  assert.match(text, /^Hello Front desk, a booking request from Orrbi:/);
  assert.match(text, /Discovery Session with Aaron Clarke\nWhen: Thu 8 Oct, 10:00 AM \(Qatar time\)/);
  assert.match(text, /Customer: Mohamed Test, \+97455000000/);
  assert.match(text, /Ref: ATO-KX4CTS\. Can you confirm this time\?$/);
  assert.doesNotMatch(text, /Health/);
});

test('studio request carries the health flag so they call the customer first', () => {
  const text = new URL(studioWhatsappLink({
    ...studio, health_flags: ['Do you have a pacemaker, defibrillator or any other electrical implant?']
  })!).searchParams.get('text') ?? '';
  assert.match(text, /⚠️ Health screening: the customer answered YES to:\n- Do you have a pacemaker, defibrillator or any other electrical implant\?\n/);
  assert.match(text, /Please call the customer before the session/);
});

test('no booking contact, no studio link', () => {
  assert.equal(studioWhatsappLink({ ...studio, booking_contact: null }), null);
});

test('encodes names that contain URL syntax', () => {
  const url = new URL(whatsappLink({ ...alert, customer_name: 'A&B ?x=1 #y' }));
  assert.match(url.searchParams.get('text') ?? '', /^مرحبا A&B \?x=1 #y،/);
  assert.equal(url.hash, '');
});
