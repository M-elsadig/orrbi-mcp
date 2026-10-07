import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { db } from '../src/lib/supabase.js';
import { type ClassRow, pickSlots } from '../src/lib/classes.js';
import { type GymRow, gymCard } from '../src/lib/cards.js';
import { WEEK, gymPage } from '../src/tools/getBusiness.js';
import { addDays, todayInQatar } from '../src/lib/time.js';

/* A clickable preview of one business's card and gym page, for a business
   that is still inactive (so no live tool shows it, and it has no slots).

     npx tsx --env-file=.env scripts/preview-business.ts "Studio 11 Fitness" [--images <dir>]
     npx vite build --config vite.preview.config.ts      → preview/dist/index.html

   Read-only: the business is read with the service role ignoring
   is_active, through the same gymPage() the get_business tool uses, and
   7 days of slots are made in memory from its timetable. Nothing is
   written to the database. Photos are inlined as data URIs (from --images
   by file name, else downloaded) so the page works anywhere. The preview
   host (preview/host.ts) stubs create_booking: nothing is ever sent. */

const args = process.argv.slice(2);
const name = args.find((a) => !a.startsWith('--')) ?? 'Studio 11 Fitness';
const imagesDir = args.includes('--images') ? args[args.indexOf('--images') + 1] : null;

type Template = {
  id: string; weekday: number; start_time: string; ladies_only: boolean; capacity: number | null; bookable: boolean;
  service_id: string;
  services: ClassRow['services'] & { class_capacity: number | null; is_active: boolean; bookable: boolean };
  staff: (NonNullable<ClassRow['staff']> & { is_active: boolean }) | null;
};

const { data: biz, error } = await db().from('businesses')
  .select('id,name_en,name_ar,category,area,images,pay_at_venue,cancellation_hours,booking_cutoff_min,is_active,services(price,bookable,is_active)')
  .eq('name_en', name).maybeSingle();
if (error) throw error;
if (!biz) throw new Error(`No business named "${name}"`);

const t = await db().from('schedule_templates')
  .select('id,weekday,start_time,ladies_only,capacity,bookable,service_id,' +
    'services!inner(name_en,name_ar,short_name_en,short_name_ar,description_en,price,duration_min,class_capacity,is_active,bookable),' +
    'staff(id,name,gender,title_en,title_ar,photo_url,is_active)')
  .eq('business_id', biz.id).eq('is_active', true);
if (t.error) throw t.error;

/* the timetable's next 7 days, as the slots sync_availability would make */
const today = todayInQatar();
const rows: ClassRow[] = [];
for (let i = 0; i < WEEK; i++) {
  const date = addDays(today, i);
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  for (const tpl of (t.data ?? []) as unknown as Template[]) {
    if (tpl.weekday !== weekday || !tpl.bookable || !tpl.services.is_active || !tpl.services.bookable) continue;
    if (tpl.staff && !tpl.staff.is_active) continue;
    rows.push({
      id: `preview-${tpl.id}-${date}`,
      starts_at: new Date(`${date}T${tpl.start_time.slice(0, 8)}+03:00`).toISOString(),
      capacity: tpl.capacity ?? tpl.services.class_capacity ?? 1,
      booked_count: 0,
      ladies_only: tpl.ladies_only,
      business_id: biz.id,
      service_id: tpl.service_id,
      services: tpl.services,
      businesses: {
        name_en: biz.name_en, name_ar: biz.name_ar, area: biz.area, category: biz.category,
        pay_at_venue: biz.pay_at_venue, cancellation_hours: biz.cancellation_hours, booking_cutoff_min: biz.booking_cutoff_min
      },
      staff: tpl.staff
    });
  }
}
const slots = pickSlots(rows, {}, Date.now());
const page = await gymPage(biz.id, { slots });
if (!page) throw new Error('gymPage returned nothing');
const card = gymCard(biz as unknown as GymRow, slots);

/* every photo URL → a data URI, so the preview needs no network */
const cache = new Map<string, string>();
async function inline(url: string | null | undefined): Promise<string | null> {
  if (!url) return null;
  if (cache.has(url)) return cache.get(url)!;
  const file = decodeURIComponent(url.split('/').pop() ?? '');
  const ext = path.extname(file).slice(1).toLowerCase();
  const type = ext === 'webp' ? 'image/webp' : ext === 'png' ? 'image/png' : 'image/jpeg';
  let bytes: Buffer | null = null;
  const local = imagesDir ? path.join(imagesDir, file) : null;
  if (local && existsSync(local)) bytes = await readFile(local);
  else {
    const res = await fetch(url).catch(() => null);
    if (res?.ok) bytes = Buffer.from(await res.arrayBuffer());
  }
  if (!bytes) {
    console.warn(`[preview] no image for ${url}`);
    return null;
  }
  const uri = `data:${type};base64,${bytes.toString('base64')}`;
  cache.set(url, uri);
  return uri;
}

page.images = (await Promise.all(page.images.map(inline))).filter((u): u is string => !!u);
for (const s of page.staff) s.photo_url = await inline(s.photo_url);
/* the trainer picker takes photos from page.staff; one copy per slot would be megabytes */
for (const s of page.week.slots) if (s.trainer_info) s.trainer_info.photo_url = null;
card.image_url = page.images[0] ?? null;

const fixture = {
  generated_at: new Date().toISOString(),
  business: { name: biz.name_en, is_active: biz.is_active },
  cards: { gyms: [card], count: 1, date: today, days: WEEK },
  page
};
await mkdir('preview/.data', { recursive: true });
await writeFile('preview/.data/fixture.json', JSON.stringify(fixture));
console.log(`[preview] ${biz.name_en} (${biz.is_active ? 'active' : 'inactive'}): ${slots.length} slots, ` +
  `${page.staff.length} trainers, ${page.requirements.length} requirements, ${page.images.length} photos → preview/.data/fixture.json`);
