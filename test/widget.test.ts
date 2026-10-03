import { test } from 'node:test';
import assert from 'node:assert/strict';
import { claudeDomain, uiProfile } from '../src/widget.js';
import { coverImage } from '../src/lib/images.js';
import { dayLabel, priceLabel, strings, timeLabel } from '../ui/src/i18n.js';

/* ── ui.domain ── */

test('Claude domain matches the value in Claude\'s docs', () => {
  assert.equal(claudeDomain('https://example.com/mcp'), 'c3d80a4ed901ee05b21755a88273b4a4.claudemcpcontent.com');
});

test('Claude domain for the live connector URL', () => {
  assert.equal(claudeDomain('https://orrbi-mcp.vercel.app/mcp'), '57dfa9b336b6975c016639ad34cf2764.claudemcpcontent.com');
});

test('each host gets its own domain format', () => {
  delete process.env.MCP_PUBLIC_URL;
  assert.deepEqual(uiProfile('claude', 'https://orrbi-mcp.vercel.app'),
    { host: 'claude', domain: '57dfa9b336b6975c016639ad34cf2764.claudemcpcontent.com' });
  assert.deepEqual(uiProfile('chatgpt', 'https://orrbi-mcp.vercel.app'),
    { host: 'chatgpt', domain: 'https://orrbi-mcp.vercel.app' });
});

test('MCP_PUBLIC_URL overrides the Claude connector URL', () => {
  process.env.MCP_PUBLIC_URL = 'https://example.com/mcp';
  try {
    assert.equal(uiProfile('claude', 'https://orrbi-mcp.vercel.app').domain, claudeDomain('https://example.com/mcp'));
  } finally {
    delete process.env.MCP_PUBLIC_URL;
  }
});

/* ── card photo: images[1], Supabase Storage only ── */

const STORAGE = 'https://ycbmspmgyrbgwmybauos.supabase.co/storage/v1/object/public/businesses/falcon.jpg';

test('uses the first image when it is in our public storage', () => {
  assert.equal(coverImage([STORAGE, 'https://other.example/x.jpg']), STORAGE);
});

test('drops anything the widget CSP would block', () => {
  for (const images of [
    null, [], [''], ['not a url'],
    ['https://other.example/x.jpg'],                                         // other host
    ['http://ycbmspmgyrbgwmybauos.supabase.co/storage/v1/object/public/a.jpg'], // not https
    ['https://ycbmspmgyrbgwmybauos.supabase.co/rest/v1/businesses'],          // not public storage
    ['https://ycbmspmgyrbgwmybauos.supabase.co.evil.example/storage/v1/object/public/a.jpg']
  ]) assert.equal(coverImage(images), null, JSON.stringify(images));
});

test('only the FIRST image counts, like the app', () => {
  assert.equal(coverImage(['https://other.example/x.jpg', STORAGE]), null);
});

/* ── widget text ── */

const SIX_PM = '2026-10-04T18:00:00+03:00';

test('times and dates are Qatar time in both languages', () => {
  assert.equal(timeLabel(SIX_PM, 'en'), '6:00 PM');
  assert.equal(timeLabel(SIX_PM, 'ar'), '6:00 م');
  assert.equal(dayLabel(SIX_PM, 'en'), 'Sun 4 Oct');
  assert.equal(dayLabel(SIX_PM, 'ar'), 'الأحد، 4 أكتوبر');
});

test('slot tap message, English and Arabic', () => {
  assert.equal(strings('en').slotMessage('6:00 PM', 'Sun 4 Oct', 'CrossFit class', 'Falcon Gym'),
    'I want the 6:00 PM slot on Sun 4 Oct for CrossFit class at Falcon Gym.');
  assert.equal(strings('ar').slotMessage('6:00 م', 'الأحد، 4 أكتوبر', 'كروس فت', 'نادي الصقر'),
    'أريد موعد 6:00 م يوم الأحد، 4 أكتوبر لـ كروس فت في نادي الصقر.');
});

test('prices in QAR', () => {
  assert.equal(priceLabel(80, 'en'), '80 QAR');
  assert.equal(priceLabel(80, 'ar'), '80 ر.ق');
});
