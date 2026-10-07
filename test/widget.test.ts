import { test } from 'node:test';
import assert from 'node:assert/strict';
import { claudeDomain, uiProfile } from '../src/widget.js';
import { coverImage, coverPhoto, focusPosition, galleryPhotos, photoFor, publicImage } from '../src/lib/images.js';
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

const RENDERED = (w: number) =>
  `https://ycbmspmgyrbgwmybauos.supabase.co/storage/v1/render/image/public/businesses/falcon.jpg?width=${w}&resize=contain&quality=75`;

test('resized by width only, never cropped by Supabase (resize=contain keeps the aspect ratio)', () => {
  /* without resize=contain Supabase keeps the original height and returns a strip */
  for (const url of coverPhoto([STORAGE])!.srcset.split(', ')) assert.match(url, /[?&]resize=contain&quality=75 [123]x$/);
});

test('the card cover comes at 1x/2x/3x of 330pt (≈1000px for an iPhone), src = 2x', () => {
  const p = coverPhoto([STORAGE, 'https://other.example/x.jpg'])!;
  assert.equal(p.src, RENDERED(660));
  assert.equal(p.srcset, `${RENDERED(330)} 1x, ${RENDERED(660)} 2x, ${RENDERED(990)} 3x`);
  assert.equal(p.position, null);
  assert.equal(coverImage([STORAGE]), RENDERED(660));
});

test('gym page photos at 390/780/1170, trainer avatars at 56/112/168, spaces stay encoded', () => {
  assert.deepEqual(galleryPhotos([STORAGE]).map((p) => p.srcset),
    [`${RENDERED(390)} 1x, ${RENDERED(780)} 2x, ${RENDERED(1170)} 3x`]);
  assert.equal(photoFor(STORAGE, 'avatar')!.srcset, `${RENDERED(56)} 1x, ${RENDERED(112)} 2x, ${RENDERED(168)} 3x`);
  assert.equal(publicImage(STORAGE), STORAGE);
  assert.match(photoFor('https://ycbmspmgyrbgwmybauos.supabase.co/storage/v1/object/public/business-images/aflete/aflete%201.jpeg', 'thumb')!.src,
    /\/render\/image\/public\/business-images\/aflete\/aflete%201\.jpeg\?width=660&resize=contain&quality=75$/);
});

test('focal point per photo: stored "x% y%" becomes object-position; anything else is center', () => {
  const focus = { [STORAGE]: '50% 25%' };
  assert.equal(coverPhoto([STORAGE], focus)!.position, '50% 25%');
  assert.equal(galleryPhotos([STORAGE], focus)[0].position, '50% 25%');
  assert.equal(photoFor(STORAGE, 'avatar', '40% 10%')!.position, '40% 10%');
  for (const bad of ['top', '50%', '101% 0%', 'url(x) 1%', 7, null]) assert.equal(focusPosition(bad), null, String(bad));
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
  assert.equal(strings('en').slotMessage('6:00 PM', 'Sun 4 Oct', 'CrossFit class', 'Test Gym'),
    'I want the 6:00 PM slot on Sun 4 Oct for CrossFit class at Test Gym.');
  assert.equal(strings('ar').slotMessage('6:00 م', 'الأحد، 4 أكتوبر', 'كروس فت', 'نادي التجربة'),
    'أريد موعد 6:00 م يوم الأحد، 4 أكتوبر لـ كروس فت في نادي التجربة.');
});

test('prices in QAR', () => {
  assert.equal(priceLabel(80, 'en'), '80 QAR');
  assert.equal(priceLabel(80, 'ar'), '80 ر.ق');
});
