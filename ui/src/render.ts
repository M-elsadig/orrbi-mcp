import type {
  AvailabilityResult, BookingResult, CardsResult, ClassSlot, Day, GymCard, GymPage, NextTime, Requirement, Slot, ToolName, Trainer
} from './types';
import {
  type Answers, type Choice, type DetailsForm, type GymStep, classesAt, flaggedBy, shownDay, slotsByDay, timesOn
} from './flow';
import { type BookingErrorKind, type FieldErrors, validateDetails } from './booking';
import { cancellationText } from '../../src/lib/payment.js';
import {
  type Lang, type Period, clockLabel, dateTimeLabel, dayChip, dayFromDate, dayLabel, durationLabel, periodOf, pick,
  payNote, priceLabel, qatarDate, strings, timeLabel, weekdayName, windowTitle
} from './i18n';

/* Every step of the card is built here as a detached element; the
   controller (main.ts) decides which one is on screen. */

/* Tiny element builder. Text always goes in through textContent, never
   innerHTML, so nothing from the database or the user can inject markup. */
type Attrs = Record<string, string | number | boolean | undefined>;
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: (Node | string | null | false)[]) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (k === 'class') el.className = String(v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children) if (c !== null && c !== false) el.append(c);
  return el;
}

/* A back arrow that points the way the reader came from: left in English,
   right in Arabic (the glyph is mirrored by CSS under dir=rtl). */
function backButton(lang: Lang, onBack: () => void): HTMLElement {
  const btn = h('button', { class: 'back', type: 'button', 'aria-label': strings(lang).back },
    h('span', { class: 'chev', 'aria-hidden': 'true' }));
  btn.addEventListener('click', onBack);
  return btn;
}

function header(lang: Lang, onBack: (() => void) | undefined, title: string, sub?: string | HTMLElement): HTMLElement {
  return h('header', { class: onBack ? 'head with-back' : 'head' },
    onBack ? backButton(lang, onBack) : null,
    h('div', { class: 'head-text' },
      h('h3', { class: 'title' }, title),
      sub === undefined ? null : typeof sub === 'string' ? h('p', { class: 'meta' }, sub) : sub
    )
  );
}

/* ── Shared bits ────────────────────────────────────────────────────────── */

/* a stable hue per business, so its initial keeps its colour between calls */
function hueFor(text: string): number {
  let n = 0;
  for (const ch of text) n = (n * 31 + ch.codePointAt(0)!) % 360;
  return n;
}

/* The initial is a logo stand-in, so it comes from the English name in both
   languages: the same letter and colour everywhere, and no bare alef (ا),
   which reads as a vertical line on its own. */
function initial(englishName: string, cls: string): HTMLElement {
  const letter = Array.from(englishName.trim())[0]?.toUpperCase() ?? '?';
  const el = h('div', { class: `${cls} placeholder`, 'aria-hidden': 'true' }, h('span', {}, letter));
  el.style.setProperty('--hue', String(hueFor(englishName)));
  return el;
}

/* "From 100 QAR" on the compact card: no "pay at the gym" there, that is
   said on the gym page and at the review step */
function fromLabel(qar: number | null | undefined, lang: Lang, pay?: { pay_at_venue?: boolean; category?: string }): string | null {
  if (qar == null) return null;
  return strings(lang).fromPrice(priceLabel(qar, lang, pay));
}

const LADIES_MARK = '♀';

/* "Women only", small, beside a class */
const ladiesTag = (lang: Lang) => h('span', { class: 'tag ladies' }, strings(lang).womenOnly);

/* ── Cards: one compact card per gym, in a carousel ─────────────────────── */

export type CardsHandlers = {
  /* open the gym page, with a time preselected when a chip was tapped */
  onOpen?: (g: GymCard, start?: string) => void;
  /* no tool calls from the card: a chip becomes a chat message */
  onChat?: (g: GymCard, x: NextTime) => void;
};

/* Photo, name, area, "From 100 QAR" and the next 3 times that answer the
   question. No class list, no price per row: the gym page has those. */
export function viewCards(r: CardsResult, lang: Lang, on: CardsHandlers): HTMLElement {
  const t = strings(lang);
  const gyms = r.gyms ?? [];
  if (!gyms.length) return h('section', { class: 'card notice' }, h('p', {}, t.noBusinesses));
  const today = qatarDate();

  const caption = r.next
    ? h('p', { class: 'cards-caption' }, t.nextTimesInstead)
    : r.timed ? h('p', { class: 'cards-caption' }, windowTitle({ ...r, days: r.days ?? 1 }, lang, today)) : null;

  const list = h('div', { class: gyms.length === 1 ? 'carousel single' : 'carousel', role: 'list' }, ...gyms.map((g) => {
    const name = pick(g.name, g.name_ar, lang);
    const price = fromLabel(g.from_price_qar, lang);
    const inner = [
      cover(g.image_url, g.name, 'gc-photo'),
      h('span', { class: 'gc-body' },
        h('span', { class: 'gc-name' }, name),
        h('span', { class: 'gc-meta' }, [g.area, price].filter(Boolean).join(' · '))
      )
    ];
    let main: HTMLElement;
    if (on.onOpen) {
      main = h('button', { class: 'gc-main tappable', type: 'button', 'aria-label': t.openGym(name) }, ...inner);
      main.addEventListener('click', () => on.onOpen!(g));
    } else {
      main = h('div', { class: 'gc-main' }, ...inner);
    }

    const times = g.next_times ?? [];
    const firstDay = times[0]?.date;
    const when = times.length && firstDay !== today ? h('span', { class: 'gc-day' }, dayName(firstDay, lang, today)) : null;
    const chips = times.length
      ? h('div', { class: 'gc-times' }, ...times.map((x) => {
          const time = timeLabel(x.start, lang);
          /* a chip on another day than the first says which */
          const label = x.date !== firstDay ? `${dayChip(x.date, lang, today).top} ${time}` : time;
          const chip = h('button', {
            class: x.ladies_only ? 'gc-time ladies' : 'gc-time', type: 'button',
            'aria-label': `${dayLabel(x.start, lang)}, ${time}${x.ladies_only ? `, ${t.womenOnly}` : ''}`,
            disabled: !on.onOpen && !on.onChat
          }, label, x.ladies_only ? h('span', { class: 'mark', 'aria-hidden': 'true' }, LADIES_MARK) : null);
          chip.addEventListener('click', () => (on.onOpen ? on.onOpen(g, x.start) : on.onChat?.(g, x)));
          return chip;
        }))
      : h('p', { class: 'gc-none' }, r.timed ? t.noTimesThen : t.noOpenTimes);

    return h('article', { class: 'card gc', role: 'listitem' }, main, h('div', { class: 'gc-foot' }, when, chips));
  }));

  return h('div', { class: 'cards' }, caption, list);
}

/* "Tomorrow", or "Wed 8 Oct" */
function dayName(ymd: string, lang: Lang, today: string): string {
  const { top } = dayChip(ymd, lang, today);
  return top === strings(lang).today || top === strings(lang).tomorrow ? top : dayFromDate(ymd, lang);
}

/* a photo, or the gym's initial when it has none or it fails to load */
function cover(src: string | null | undefined, englishName: string, cls: string): HTMLElement {
  if (!src) return initial(englishName, cls);
  const img = h('img', { class: cls, src, alt: '', loading: 'lazy', decoding: 'async' });
  img.addEventListener('error', () => img.replaceWith(initial(englishName, cls)), { once: true });
  return img;
}

/* ── Gym page: the tend-app detail sheet, in the card ───────────────────── */

export type GymHandlers = {
  onBack?: () => void;
  onDay: (date: string) => void;
  onTime: (start: string) => void;
  onBook: () => void;
  onToggleHours: () => void;
  onMaps?: (url: string) => void;
  onRetry: () => void;
};

const SVG = 'http://www.w3.org/2000/svg';

/* the app's map pin, drawn in currentColor */
function pin(): SVGElement {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 20 20');
  svg.setAttribute('width', '16');
  svg.setAttribute('height', '16');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'pin');
  const p = document.createElementNS(SVG, 'path');
  p.setAttribute('d', 'M10 17.5C10 17.5 15.5 12.6 15.5 8.5A5.5 5.5 0 0 0 4.5 8.5C4.5 12.6 10 17.5 10 17.5Z');
  const c = document.createElementNS(SVG, 'circle');
  c.setAttribute('cx', '10');
  c.setAttribute('cy', '8.4');
  c.setAttribute('r', '2');
  for (const el of [p, c]) {
    el.setAttribute('fill', 'none');
    el.setAttribute('stroke', 'currentColor');
    el.setAttribute('stroke-width', '1.4');
    svg.append(el);
  }
  return svg;
}

const section = (label: string, ...body: (Node | null)[]) =>
  h('section', { class: 'gp-sec' }, h('h4', { class: 'gp-label' }, label), ...body);

/* Photos, name, price, address; the 7 days and that day's times; classes,
   about, class times, Maps; a sticky Book button. The card's own data shows
   at once, the rest as it loads. */
export function viewGymPage(step: GymStep, lang: Lang, on: GymHandlers): HTMLElement {
  const t = strings(lang);
  const g = step.card;
  const page = step.page;
  const name = pick(g.name, g.name_ar, lang);
  const photos = page?.images?.length ? page.images : g.image_url ? [g.image_url] : [];

  /* ── photos: swipe, with dots ── */
  let hero: HTMLElement;
  if (photos.length) {
    const track = h('div', { class: 'gp-track' }, ...photos.map((src, i) => {
      const img = h('img', { class: 'gp-shot', src, alt: i === 0 ? name : '', loading: i < 2 ? 'eager' : 'lazy', decoding: 'async' });
      img.addEventListener('error', () => img.remove(), { once: true });
      return img;
    }));
    const dots = photos.length > 1
      ? h('div', { class: 'gp-dots', 'aria-hidden': 'true' }, ...photos.map((_, i) => h('span', { class: i === 0 ? 'on' : undefined })))
      : null;
    if (dots) {
      track.addEventListener('scroll', () => {
        const i = Math.round(Math.abs(track.scrollLeft) / Math.max(1, track.clientWidth));
        dots.querySelectorAll('span').forEach((d, j) => d.classList.toggle('on', i === j));
      }, { passive: true });
    }
    hero = h('div', { class: 'gp-hero' }, track, dots);
  } else {
    hero = h('div', { class: 'gp-hero' }, initial(g.name, 'gp-shot'));
  }
  if (on.onBack) {
    const back = backButton(lang, on.onBack);
    back.classList.add('gp-back');
    hero.append(back);
  }

  const pay = { pay_at_venue: page?.pay_at_venue ?? g.pay_at_venue, category: g.category };
  const price = fromLabel(page?.from_price_qar ?? g.from_price_qar, lang, pay);
  const head = h('header', { class: 'gp-head' },
    h('h2', { class: 'gp-name' }, name),
    price ? h('p', { class: 'gp-price' }, price) : null,
    h('p', { class: 'gp-where' }, pin(), h('span', {}, page?.address || g.area))
  );

  let body: HTMLElement[];
  if (step.error) {
    const retry = h('button', { class: 'btn secondary', type: 'button' }, t.tryAgain);
    retry.addEventListener('click', on.onRetry);
    body = [h('p', { class: 'meta' }, t.loadFailed), retry];
  } else if (!page) {
    body = [
      h('div', { class: 'gp-sec', 'aria-busy': 'true' },
        h('div', { class: 'sk w30' }),
        h('div', { class: 'days' }, ...Array.from({ length: 7 }, () => h('div', { class: 'day sk' }))),
        h('div', { class: 'gp-grid' }, ...Array.from({ length: 8 }, () => h('div', { class: 'gp-slot sk' })))),
      h('div', { class: 'gp-sec' }, h('div', { class: 'sk w40' }), h('div', { class: 'sk w80' }), h('div', { class: 'sk w70' }))
    ];
  } else {
    body = gymBody(step, page, lang, on);
  }

  /* Book: what will be booked, or what to do first. Right under the times
     (the first section), in the page's flow: never pinned to the bottom,
     where the host's chat input can cover it. */
  if (page && !step.error) {
    const picked = !!step.time && classesAt(page, step.time).length > 0;
    const book = h('button', { class: 'btn accent', type: 'button', disabled: !picked },
      picked ? t.bookAt(timeLabel(step.time!, lang)) : t.bookNow);
    book.addEventListener('click', () => { if (picked) on.onBook(); });
    const bar = h('div', { class: 'gp-bar' },
      picked ? null : h('p', { class: 'caption', role: 'status' }, step.time ? t.timeGone : t.pickTimeFirst),
      book);
    body.splice(1, 0, bar);
  }

  return h('article', { class: 'gp' }, hero, h('div', { class: 'gp-body' }, head, ...body));
}

function gymBody(step: GymStep, page: GymPage, lang: Lang, on: GymHandlers): HTMLElement[] {
  const t = strings(lang);
  const today = qatarDate();
  const byDay = slotsByDay(page);
  const day = shownDay(page, step.day);
  const out: HTMLElement[] = [];

  /* ── available: 7 day chips, that day's times ── */
  if (!day) {
    out.push(section(t.available, h('p', { class: 'empty' }, t.noClassesWeek)));
  } else {
    const dates = Array.from({ length: page.week.days }, (_, i) => plusDays(page.week.date, i));
    const strip = h('div', { class: 'days', role: 'tablist' }, ...dates.map((d) => {
      const { top, num } = dayChip(d, lang, today);
      const empty = !byDay.get(d)?.length;
      const isOn = d === day;
      const chip = h('button', {
        class: `day${isOn ? ' on' : ''}`, type: 'button', role: 'tab', 'aria-selected': isOn ? 'true' : 'false',
        'aria-label': dayLabel(`${d}T12:00:00+03:00`, lang), disabled: empty
      }, h('span', { class: 'day-top' }, top), h('span', { class: 'day-num' }, num));
      chip.addEventListener('click', () => { if (!empty && !isOn) on.onDay(d); });
      return chip;
    }));
    requestAnimationFrame(() => revealSelected(strip));

    const grid = h('div', { class: 'gp-grid' }, ...timesOn(page, day).map((x) => {
      const time = timeLabel(x.start, lang);
      const isOn = step.time === x.start;
      const btn = h('button', {
        class: `gp-slot${isOn ? ' on' : ''}${x.ladies_only ? ' ladies' : ''}`, type: 'button',
        'aria-pressed': isOn ? 'true' : 'false', 'aria-label': x.ladies_only ? `${time}, ${t.womenOnly}` : time
      }, h('span', {}, time), x.ladies_only ? h('span', { class: 'gp-slot-tag' }, `${LADIES_MARK} ${t.womenOnly}`) : null);
      btn.addEventListener('click', () => on.onTime(x.start));
      return btn;
    }));
    out.push(section(t.available, strip, grid));
  }

  /* 1:1 appointments (trainers) say "sessions"; group gyms say "classes" */
  const staff = page.staff ?? [];
  const appt = staff.length > 0;

  /* ── classes: what each costs and how long; booked by time above ── */
  if (page.services.length) {
    out.push(section(appt ? t.sessionsTitle : t.classesTitle, h('ul', { class: 'gp-list' }, ...page.services.map((s) =>
      h('li', { class: 'gp-row' },
        h('span', { class: 'gp-row-main' },
          h('span', { class: 'gp-row-name' }, pick(s.name, s.name_ar, lang)),
          h('span', { class: 'gp-row-sub' },
            [durationLabel(s.duration_min, lang), appt ? t.privateSession : null].filter(Boolean).join(' · ')),
          s.description ? h('span', { class: 'gp-row-sub' }, s.description) : null),
        h('span', { class: 'gp-row-price' }, priceLabel(s.price_qar, lang)))
    ))));
  }

  /* ── trainers: who the customer picks after the time ── */
  if (appt) {
    out.push(section(t.trainersTitle, h('ul', { class: 'gp-staff' }, ...staff.map((p) => {
      const title = pick(p.title ?? '', p.title_ar, lang);
      const skills = lang === 'ar' && p.specialties_ar.length ? p.specialties_ar : p.specialties;
      const bio = pick(p.bio ?? '', p.bio_ar, lang);
      return h('li', { class: 'gp-trainer' },
        trainerPhoto(p),
        h('div', { class: 'gp-trainer-text' },
          h('p', { class: 'gp-row-name' }, p.name),
          title ? h('p', { class: 'gp-row-sub' }, title) : null,
          skills.length ? h('ul', { class: 'gp-skills' }, ...skills.map((s) => h('li', { class: 'tag' }, s))) : null,
          bio ? h('p', { class: 'gp-trainer-bio' }, bio) : null));
    }))));
  }

  const about = pick(page.description ?? '', page.description_ar, lang);
  if (about) out.push(section(t.about, h('p', { class: 'gp-about' }, about)));

  if (page.other_services.length) {
    out.push(section(t.alsoHere, h('ul', { class: 'gp-list' }, ...page.other_services.map((s) =>
      h('li', { class: 'gp-row' },
        h('span', { class: 'gp-row-name' }, pick(s.name, s.name_ar, lang)),
        h('span', { class: 'gp-row-price muted' }, s.price))
    ))));
  }

  /* ── class times (from the timetable), collapsed like the app's Hours ── */
  if (page.class_hours.length) {
    const toggle = h('button', { class: 'gp-toggle', type: 'button', 'aria-expanded': step.hoursOpen ? 'true' : 'false' },
      h('span', {}, appt ? t.sessionTimes : t.classTimes), h('span', { class: `disclose${step.hoursOpen ? ' open' : ''}`, 'aria-hidden': 'true' }));
    toggle.addEventListener('click', on.onToggleHours);
    const rows = step.hoursOpen
      ? h('dl', { class: 'gp-hours' }, ...page.class_hours.map((r) =>
          h('div', { class: 'gp-hours-row' },
            h('dt', {}, weekdayName(r.weekday, lang)),
            h('dd', {}, r.first === r.last ? clockLabel(r.first, lang) : `${clockLabel(r.first, lang)} – ${clockLabel(r.last, lang)}`))))
      : null;
    out.push(h('div', { class: 'gp-sec gp-collapse' }, toggle, rows));
  }

  if (page.maps_url && on.onMaps) {
    const maps = h('button', { class: 'btn secondary gp-maps', type: 'button' }, pin(), h('span', {}, t.openMaps));
    maps.addEventListener('click', () => on.onMaps!(page.maps_url!));
    out.push(maps);
  }
  return out;
}

function plusDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/* a trainer's photo, or their initial when there is none (or it fails) */
function trainerPhoto(p: Trainer): HTMLElement {
  if (!p.photo_url) return initial(p.name, 'avatar');
  const img = h('img', { class: 'avatar', src: p.photo_url, alt: '', loading: 'lazy', decoding: 'async' });
  img.addEventListener('error', () => img.replaceWith(initial(p.name, 'avatar')), { once: true });
  return img;
}

/* ── Class: which class at the time picked ──────────────────────────────── */

/* For a 1:1 appointment the options are the same session with different
   trainers, so this is the trainer picker. */
export function viewClassPick(
  start: string, options: ClassSlot[], lang: Lang, onBack: () => void, onPick: (s: ClassSlot) => void,
  staff: Trainer[] = []
): HTMLElement {
  const t = strings(lang);
  const ladies = options.some((s) => s.ladies_only);
  const trainers = options.length > 0 && options.every((s) => s.trainer_info);
  /* photos come from the page's trainer list, not from every slot */
  const photoOf = (tr: Trainer) => staff.find((p) => p.id === tr.id)?.photo_url ?? tr.photo_url;
  return h('section', { class: 'card pad' },
    header(lang, onBack, trainers ? t.chooseTrainer : t.chooseClass, dateTimeLabel(start, lang)),
    ladies ? h('p', { class: 'women-note', role: 'note' }, `${LADIES_MARK} ${t.womenOnlyNote}`) : null,
    h('ul', { class: 'pick-list' }, ...options.map((s) => {
      const meta = [
        trainers ? pick(s.class_full || s.class, s.class_full_ar || s.class_ar, lang) : null,
        s.duration_min !== undefined ? durationLabel(s.duration_min, lang) : null,
        s.price_qar !== undefined ? priceLabel(s.price_qar, lang) : null
      ].filter(Boolean).join(' · ');
      const tr = s.trainer_info;
      const title = tr ? pick(tr.title ?? '', tr.title_ar, lang) : '';
      const btn = h('button', { class: `pick tappable${tr ? ' with-avatar' : ''}`, type: 'button' },
        tr ? trainerPhoto({ ...tr, photo_url: photoOf(tr) }) : null,
        h('span', { class: 'pick-main' },
          h('span', { class: 'pick-name' },
            h('span', {}, tr ? tr.name : pick(s.class_full || s.class, s.class_full_ar || s.class_ar, lang)),
            s.ladies_only ? ladiesTag(lang) : null),
          title ? h('span', { class: 'pick-meta' }, title) : null,
          meta ? h('span', { class: 'pick-meta' }, meta) : null,
          !tr && s.description ? h('span', { class: 'pick-desc' }, s.description) : null),
        h('span', { class: 'chev fwd', 'aria-hidden': 'true' }));
      btn.addEventListener('click', () => onPick(s));
      return h('li', {}, btn);
    }))
  );
}

/* ── Times: day strip + grouped times ───────────────────────────────────── */

const PERIODS: Period[] = ['morning', 'afternoon', 'evening'];

/* Bring the selected day into view by scrolling the strip only.
   scrollIntoView() could also scroll the host's conversation around the
   iframe. Visual deltas work the same in LTR and RTL. */
function revealSelected(strip: HTMLElement) {
  const chip = strip.querySelector<HTMLElement>('.day.on');
  if (!chip) return;
  const s = strip.getBoundingClientRect(), c = chip.getBoundingClientRect();
  if (c.left < s.left) strip.scrollLeft -= s.left - c.left + 8;
  else if (c.right > s.right) strip.scrollLeft += c.right - s.right + 8;
}

export type TimesMode =
  /* in-card booking: a tap opens the details step */
  | { kind: 'open'; onPick: (slot: Slot, day: string) => void }
  /* no tool calls from the card: a tap sends a chat message, as before */
  | { kind: 'chat'; send: (slot: Slot, day: string) => Promise<boolean> };

export function viewTimes(
  r: AvailabilityResult, lang: Lang, onBack: (() => void) | undefined, mode: TimesMode,
  selectedInit: string | undefined, onSelectDay: (date: string) => void
): HTMLElement {
  const t = strings(lang);
  const business = pick(r.business_name, r.business_name_ar, lang);
  const service = pick(r.service_name, r.service_name_ar, lang);
  const today = qatarDate();

  /* all 7 days arrive with the result; older results without them still show their one day */
  const days: Day[] = r.days?.length ? r.days : [{ date: r.date, slots: r.slots ?? [] }];
  const firstShown = r.date;
  const moved = !!r.requested_date && r.requested_date !== r.date && (r.slots?.length ?? 0) > 0;

  let selected = selectedInit && days.some((d) => d.date === selectedInit && d.slots.length) ? selectedInit : firstShown;
  let chosen: string | null = null;     // chat mode: slot_id once a time was sent
  let busy = false;

  const sub = h('p', { class: 'meta' });
  const strip = h('div', { class: 'days', role: 'tablist', 'aria-label': service });
  const times = h('div', { class: 'times', role: 'tabpanel' });
  const status = h('p', { class: 'caption foot', role: 'status' }, mode.kind === 'chat' ? t.pickTime : '');
  if (mode.kind === 'open') status.hidden = true;

  function drawStrip() {
    strip.replaceChildren(...days.map((d) => {
      const { top, num } = dayChip(d.date, lang, today);
      const empty = d.slots.length === 0;
      const on = d.date === selected;
      const chip = h('button', {
        class: `day${on ? ' on' : ''}`,
        type: 'button',
        role: 'tab',
        'aria-selected': on ? 'true' : 'false',
        'aria-label': dayLabel(`${d.date}T12:00:00+03:00`, lang),
        disabled: empty
      }, h('span', { class: 'day-top' }, top), h('span', { class: 'day-num' }, num));
      chip.addEventListener('click', () => {
        if (empty || d.date === selected) return;
        selected = d.date;
        onSelectDay(selected);
        draw(true);
      });
      return chip;
    }));
    revealSelected(strip);
  }

  function drawTimes() {
    const day = days.find((d) => d.date === selected) ?? days[0];
    sub.textContent = `${business} · ${dayFromDate(day.date, lang)}`;

    if (!days.some((d) => d.slots.length)) {
      times.replaceChildren(h('p', { class: 'empty' }, t.noWeek));
      status.hidden = true;
      return;
    }

    const groups = PERIODS
      .map((p) => ({ p, slots: day.slots.filter((s) => periodOf(s.start) === p) }))
      .filter((g) => g.slots.length);

    const note = moved && selected === firstShown
      ? [h('p', { class: 'moved' }, t.moved(dayFromDate(r.requested_date!, lang), dayFromDate(firstShown, lang)))]
      : [];
    times.replaceChildren(
      ...note,
      ...groups.map((g) => h('div', { class: 'group' },
        h('p', { class: 'group-title' }, t.periods[g.p]),
        h('div', { class: 'chips' }, ...g.slots.map((s) => timeChip(s, day.date)))
      ))
    );
  }

  function timeChip(s: Slot, date: string): HTMLElement {
    const time = timeLabel(s.start, lang);
    /* no "N left": Orrbi doesn't know the real count (the business also
       books in its own system). Ladies-only is per time, so it's on the chip. */
    const ladies = s.ladies_only;
    const isChosen = chosen === s.slot_id;
    const btn = h('button', {
      class: `time${isChosen ? ' chosen' : ''}`,
      type: 'button',
      disabled: (chosen !== null && !isChosen) || busy,
      'aria-pressed': isChosen ? 'true' : undefined,
      'aria-label': ladies ? `${time}, ${t.ladiesOnly}` : time
    }, time, ladies ? h('span', { class: 'tag' }, t.ladiesOnly) : null);

    btn.addEventListener('click', async () => {
      if (mode.kind === 'open') return mode.onPick(s, date);

      if (chosen || busy) return;
      busy = true;
      chosen = s.slot_id;
      drawTimes();
      const ok = await mode.send(s, date);
      busy = false;
      if (ok) {
        status.textContent = t.sent;
      } else {
        chosen = null;                      // let them pick again, or type it
        status.textContent = t.sendFailed;
      }
      drawTimes();
    });
    return btn;
  }

  /* switching days swaps the times in place; a short fade, none with reduced motion */
  function draw(swap = false) {
    drawStrip();
    drawTimes();
    if (swap) {
      times.classList.remove('swap');
      void times.offsetWidth;
      times.classList.add('swap');
    }
  }

  draw();
  const el = h('section', { class: 'card pad booking-times' }, header(lang, onBack, service, sub), strip, times, status);
  requestAnimationFrame(() => revealSelected(strip));
  return el;
}

export function viewTimesLoading(lang: Lang, onBack: (() => void) | undefined, title: string): HTMLElement {
  const bar = (cls: string) => h('div', { class: `sk ${cls}` });
  return h('section', { class: 'card pad', 'aria-busy': 'true' },
    header(lang, onBack, title, bar('w40')),
    h('div', { class: 'days' }, ...Array.from({ length: 7 }, () => h('div', { class: 'day sk' }))),
    h('div', { class: 'chips' }, ...Array.from({ length: 6 }, () => h('div', { class: 'time sk' })))
  );
}

export function viewTimesError(lang: Lang, onBack: (() => void) | undefined, title: string, onRetry: () => void): HTMLElement {
  const t = strings(lang);
  const retry = h('button', { class: 'btn secondary', type: 'button' }, t.tryAgain);
  retry.addEventListener('click', onRetry);
  return h('section', { class: 'card pad' },
    header(lang, onBack, title),
    h('p', { class: 'meta' }, t.loadFailed),
    retry,
    h('p', { class: 'caption' }, t.continueInChat)
  );
}

/* ── Details: name and mobile ───────────────────────────────────────────── */

export type DetailsState = { choice: Choice; slot: Slot; form: DetailsForm; fieldErrors: FieldErrors };

export type DetailsHandlers = {
  onBack: () => void;
  onInput: (form: DetailsForm) => void;
  onSubmit: (form: DetailsForm) => void;
};

/* the facts of the request, the same on the details and review steps */
function summaryRows(c: Choice, slot: Slot, lang: Lang, full: boolean): HTMLElement {
  const t = strings(lang);
  const row = (label: string, value: string) => h('div', { class: 'row' }, h('dt', {}, label), h('dd', {}, value));
  const business = pick(c.business_name, c.business_name_ar, lang);
  const service = pick(c.service_name, c.service_name_ar, lang);
  const when = dateTimeLabel(slot.start, lang) + (slot.ladies_only ? ` · ${t.womenOnly}` : '');
  const price = c.price_qar !== undefined ? priceLabel(c.price_qar, lang, c) : null;
  const cancel = c.cancellation_hours != null ? cancellationText(c.cancellation_hours, lang) : null;
  return h('dl', { class: 'rows summary' },
    row(t.business, business),
    row(t.service, service + (c.duration_min !== undefined ? ` · ${durationLabel(c.duration_min, lang)}` : '')),
    slot.trainer ? row(t.trainer, slot.trainer.name) : null,
    row(t.when, when),
    price ? row(full ? t.payment : t.price, price) : null,
    full && cancel ? row(t.cancellation, cancel) : null
  );
}

export function viewDetails(s: DetailsState, lang: Lang, on: DetailsHandlers): HTMLElement {
  const t = strings(lang);

  const field = (id: 'name' | 'phone', label: string, error: string | undefined, attrs: Attrs) => {
    const input = h('input', {
      id: `f-${id}`, name: id, class: error ? 'input invalid' : 'input', value: s.form[id],
      'aria-invalid': error ? 'true' : undefined, 'aria-describedby': error ? `e-${id}` : undefined, ...attrs
    });
    /* always present, so a check on leaving the field can fill it in place */
    const msg = h('p', { class: 'field-error', id: `e-${id}` }, error ?? '');
    msg.hidden = !error;
    return { input, msg, el: h('div', { class: 'field' }, h('label', { for: `f-${id}` }, label), input, msg) };
  };

  const nameErr = s.fieldErrors.name === 'required' ? t.nameRequired : s.fieldErrors.name === 'tooLong' ? t.nameTooLong : undefined;
  const phoneErr = s.fieldErrors.phone ? t.phoneInvalid : undefined;
  const nameF = field('name', t.name, nameErr, { type: 'text', autocomplete: 'name', maxlength: 100, enterkeyhint: 'next' });
  const phoneF = field('phone', t.mobile, phoneErr, {
    type: 'tel', inputmode: 'tel', autocomplete: 'tel', dir: 'ltr', placeholder: t.mobileHint, maxlength: 20, enterkeyhint: 'done'
  });

  const read = (): DetailsForm => ({ name: (nameF.input as HTMLInputElement).value, phone: (phoneF.input as HTMLInputElement).value });
  nameF.input.addEventListener('input', () => on.onInput(read()));
  phoneF.input.addEventListener('input', () => on.onInput(read()));

  /* Check a field when the user leaves it (not while typing), and update
     only its own message: re-rendering would steal focus from the next field. */
  const show = (fld: typeof nameF, text: string | undefined) => {
    fld.msg.textContent = text ?? '';
    fld.msg.hidden = !text;
    fld.input.classList.toggle('invalid', !!text);
    if (text) fld.input.setAttribute('aria-invalid', 'true'); else fld.input.removeAttribute('aria-invalid');
    if (text) fld.input.setAttribute('aria-describedby', fld.msg.id); else fld.input.removeAttribute('aria-describedby');
  };
  nameF.input.addEventListener('blur', () => {
    if (!(nameF.input as HTMLInputElement).value) return;      // don't scold an untouched field
    const e = validateDetails(read()).errors.name;
    show(nameF, e === 'required' ? t.nameRequired : e === 'tooLong' ? t.nameTooLong : undefined);
  });
  phoneF.input.addEventListener('blur', () => {
    if (!(phoneF.input as HTMLInputElement).value) return;
    show(phoneF, validateDetails(read()).errors.phone ? t.phoneInvalid : undefined);
  });
  /* a corrected field clears its message as soon as it becomes valid */
  phoneF.input.addEventListener('input', () => {
    if (!phoneF.msg.hidden && !validateDetails(read()).errors.phone) show(phoneF, undefined);
  });
  nameF.input.addEventListener('input', () => {
    if (!nameF.msg.hidden && !validateDetails(read()).errors.name) show(nameF, undefined);
  });

  const form = h('form', { class: 'details', novalidate: true },
    nameF.el,
    phoneF.el,
    h('button', { class: 'btn accent', type: 'submit' }, t.continue),
    h('p', { class: 'caption' }, t.privacy)
  );
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    on.onSubmit(read());
  });

  return h('section', { class: 'card pad' },
    header(lang, on.onBack, t.yourDetails),
    s.slot.ladies_only ? h('p', { class: 'women-note', role: 'note' }, `${LADIES_MARK} ${t.womenOnlyNote}`) : null,
    summaryRows(s.choice, s.slot, lang, false),
    form
  );
}

/* ── Requirements: questions and notices before the request ─────────────── */

export type RequirementsState = { choice: Choice; slot: Slot; picks: Answers; some?: boolean };

export type RequirementsHandlers = {
  onBack: () => void;
  /* tick a condition, or agree to a notice */
  onPick: (id: string, value: boolean) => void;
  onNone: () => void;
  onSome: () => void;
  onContinue: () => void;
};

/* the note shown for answers that need the business's attention, once each */
function flagNote(reqs: Requirement[], answers: Answers, lang: Lang): HTMLElement | null {
  const notes = [...new Set(flaggedBy(reqs, answers).map((r) => pick(r.flag_note ?? '', r.flag_note_ar, lang)).filter(Boolean))];
  return notes.length ? h('div', { class: 'flag-note', role: 'status' }, ...notes.map((n) => h('p', {}, n))) : null;
}

const conditionText = (r: Requirement, lang: Lang) => pick(r.short || r.text, r.short_ar || r.text_ar, lang);

/* One screen for every business with requirements: "Do any of these apply
   to you?", the conditions as a short list, then "None of these apply to
   me" or "One or more applies". Nothing is preselected and the two buttons
   look the same, so neither reads as the default. "One or more" turns the
   list into ticks (at least one), shows what happens next, and continues.
   Notices are checkboxes the customer must agree to first. */
export function viewRequirements(s: RequirementsState, lang: Lang, on: RequirementsHandlers): HTMLElement {
  const t = strings(lang);
  const reqs = s.choice.requirements ?? [];
  const questions = reqs.filter((r) => r.kind === 'question');
  const notices = reqs.filter((r) => r.kind === 'notice');
  const agreed = notices.every((n) => s.picks[n.id] === true);

  const noticeList = notices.length
    ? h('ul', { class: 'rq-list' }, ...notices.map((r, i) => {
        const box = h('input', { type: 'checkbox', id: `rq-n${i}`, checked: s.picks[r.id] === true });
        box.addEventListener('change', () => on.onPick(r.id, (box as HTMLInputElement).checked));
        return h('li', { class: 'rq notice' }, h('label', { for: `rq-n${i}`, class: 'rq-check' }, box, h('span', {}, pick(r.text, r.text_ar, lang))));
      }))
    : null;

  const head = header(lang, on.onBack, s.some ? t.whichApply : t.anyApply, pick(s.choice.business_name, s.choice.business_name_ar, lang));

  if (!s.some) {
    const none = h('button', { class: 'btn secondary', type: 'button', disabled: !agreed }, t.noneApply);
    const some = h('button', { class: 'btn secondary', type: 'button', disabled: !agreed }, t.someApply);
    none.addEventListener('click', () => { if (agreed) on.onNone(); });
    some.addEventListener('click', () => { if (agreed) on.onSome(); });
    return h('section', { class: 'card pad' },
      head,
      questions.length ? h('ul', { class: 'rq-conditions' }, ...questions.map((r) => h('li', {}, conditionText(r, lang)))) : null,
      noticeList,
      agreed ? null : h('p', { class: 'caption', role: 'status' }, t.agreeFirst),
      h('div', { class: 'rq-choices', role: 'group', 'aria-label': t.anyApply }, none, some),
      h('p', { class: 'caption' }, t.requirementsIntro)
    );
  }

  /* "One or more applies": tick which */
  const ticked = questions.some((q) => s.picks[q.id] === true);
  const ready = ticked && agreed;
  const ticks = h('ul', { class: 'rq-list' }, ...questions.map((r, i) => {
    const box = h('input', { type: 'checkbox', id: `rq-q${i}`, checked: s.picks[r.id] === true });
    box.addEventListener('change', () => on.onPick(r.id, (box as HTMLInputElement).checked));
    return h('li', { class: 'rq' }, h('label', { for: `rq-q${i}`, class: 'rq-check' }, box, h('span', {}, conditionText(r, lang))));
  }));
  const asAnswers = Object.fromEntries(questions.map((q) => [q.id, s.picks[q.id] === true]));
  const next = h('button', { class: 'btn accent', type: 'button', disabled: !ready }, t.continue);
  next.addEventListener('click', () => { if (ready) on.onContinue(); });

  return h('section', { class: 'card pad' },
    head,
    ticks,
    noticeList,
    ticked ? flagNote(questions, asAnswers, lang) : null,
    ready ? null : h('p', { class: 'caption', role: 'status' }, ticked ? t.agreeFirst : t.tickAtLeastOne),
    next,
    h('p', { class: 'caption' }, t.requirementsIntro)
  );
}

/* ── Review: everything once more, then the request ─────────────────────── */

export type ReviewState = {
  choice: Choice; slot: Slot; name: string; phone: string; answers?: Answers;
  error?: BookingErrorKind; retime?: boolean; busy?: boolean;
};

/* "None apply" / "2 apply" on the review step */
function appliesSummary(reqs: Requirement[], answers: Answers, t: ReturnType<typeof strings>): string {
  const n = reqs.filter((r) => r.kind === 'question' && answers[r.id] === true).length;
  return n ? t.reviewSome(n) : t.reviewNone;
}

export function viewReview(s: ReviewState, lang: Lang, on: { onBack: () => void; onSend: () => void; onRetime: () => void }): HTMLElement {
  const t = strings(lang);
  const business = pick(s.choice.business_name, s.choice.business_name_ar, lang);
  const row = (label: string, value: string, cls = '') => h('div', { class: 'row' }, h('dt', {}, label), h('dd', { class: cls }, value));

  let action: HTMLElement;
  if (s.retime) {
    action = h('button', { class: 'btn secondary', type: 'button' }, t.pickAnother);
    action.addEventListener('click', on.onRetime);
  } else {
    action = h('button', { class: 'btn accent', type: 'button', disabled: s.busy }, s.busy ? t.sending : t.sendRequest);
    action.addEventListener('click', () => { if (!s.busy) on.onSend(); });
  }

  return h('section', { class: 'card pad' },
    header(lang, s.busy ? undefined : on.onBack, t.reviewTitle),
    s.slot.ladies_only ? h('p', { class: 'women-note', role: 'note' }, `${LADIES_MARK} ${t.womenOnlyNote}`) : null,
    summaryRows(s.choice, s.slot, lang, true),
    h('dl', { class: 'rows' },
      row(t.yourName, s.name),
      row(t.yourMobile, s.phone, 'ref'),
      s.choice.requirements?.length ? row(t.beforeYouBook, appliesSummary(s.choice.requirements, s.answers ?? {}, t)) : null
    ),
    s.choice.requirements?.length ? flagNote(s.choice.requirements, s.answers ?? {}, lang) : null,
    h('p', { class: 'request-note' }, t.requestNote(business)),
    s.error ? h('div', { class: 'form-error', role: 'alert' }, h('p', {}, t.bookErrors[s.error])) : null,
    action
  );
}

/* ── Requested: a request, pending, never "confirmed" ───────────────────── */

export function viewBooked(r: BookingResult, lang: Lang, cancellationHours?: number | null): HTMLElement {
  const t = strings(lang);
  const business = pick(r.business_name, r.business_name_ar, lang);
  const service = pick(r.service_name, r.service_name_ar, lang);
  const firstVisit = lang === 'ar' ? r.first_visit_ar || r.first_visit : r.first_visit;
  const cancel = cancellationHours != null ? cancellationText(cancellationHours, lang) : lang === 'en' ? r.cancellation_policy ?? null : null;

  /* only these fields, by design: never the customer's phone */
  const row = (label: string, value: string, cls = '') =>
    h('div', { class: 'row' }, h('dt', {}, label), h('dd', { class: cls }, value));

  return h('section', { class: 'card pad booking' },
    h('header', { class: 'head' },
      h('span', { class: 'badge pending' }, h('span', { class: 'dot', 'aria-hidden': 'true' }), t.notConfirmed),
      h('h3', { class: 'title' }, t.requestSent)
    ),
    h('p', { class: 'meta' }, t.awaiting(business)),
    h('dl', { class: 'rows' },
      row(t.business, business),
      row(t.service, service),
      r.trainer ? row(t.trainer, r.trainer) : null,
      row(t.when, dateTimeLabel(r.start, lang)),
      row(t.reference, r.reference, 'ref')
    ),
    r.health_note ? h('div', { class: 'flag-note', role: 'status' },
      h('p', {}, lang === 'ar' ? r.health_note_ar || r.health_note : r.health_note)) : null,
    /* pay-at-venue: say where the money goes, so nobody looks for a checkout */
    r.price_qar != null && r.pay_at_venue ? h('p', { class: 'caption' }, payNote(r.price_qar, lang, r)) : null,
    cancel ? h('p', { class: 'caption' }, cancel) : null,
    firstVisit ? h('p', { class: 'caption' }, `${t.firstVisit}: ${firstVisit}`) : null
  );
}

/* ── Loading and errors ─────────────────────────────────────────────────── */

export function viewSkeleton(tool: ToolName | null): HTMLElement {
  const bar = (cls: string) => h('div', { class: `sk ${cls}` });
  if (tool === 'search_businesses' || tool === 'find_classes') {
    return h('div', { class: 'carousel', 'aria-busy': 'true' }, ...[0, 1].map(() =>
      h('div', { class: 'card gc' },
        h('div', { class: 'gc-main' }, h('div', { class: 'gc-photo sk' }), h('div', { class: 'gc-body' }, bar('w60'), bar('w40'))),
        h('div', { class: 'gc-foot' }, h('div', { class: 'gc-times' }, ...[0, 1, 2].map(() => h('div', { class: 'gc-time sk' })))))));
  }
  const inner = tool === 'get_availability'
    ? [bar('w50 tall'), bar('w40'),
       h('div', { class: 'days' }, ...Array.from({ length: 7 }, () => h('div', { class: 'day sk' }))),
       h('div', { class: 'chips' }, ...Array.from({ length: 6 }, () => h('div', { class: 'time sk' })))]
    : [bar('w30'), bar('w60 tall'), bar('w80'), bar('w70'), bar('w50')];
  return h('section', { class: 'card pad', 'aria-busy': 'true' }, ...inner);
}

export function viewError(message: string, lang: Lang): HTMLElement {
  return h('section', { class: 'card pad notice error', role: 'alert' },
    h('p', { class: 'title' }, strings(lang).errorTitle),
    h('p', { class: 'meta' }, message)
  );
}
