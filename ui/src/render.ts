import type { AvailabilityResult, BookingResult, Business, SearchResult, Slot, ToolName } from './types';
import {
  type Lang, categoryLabel, dateTimeLabel, dayFromDate, dayLabel, durationLabel, pick, priceLabel, strings, timeLabel
} from './i18n';

/* Tiny element builder. Text always goes in through textContent, never
   innerHTML, so nothing from the database can inject markup. */
type Attrs = Record<string, string | number | boolean | undefined>;
function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: (Node | string | null | false)[]) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (k === 'class') el.className = String(v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children) if (c !== null && c !== false) el.append(c);
  return el;
}

/* ── Businesses ─────────────────────────────────────────────────────────── */

const MAX_SERVICES = 3;

/* a stable hue per business, so a placeholder keeps its colour between calls */
function hueFor(text: string): number {
  let n = 0;
  for (const ch of text) n = (n * 31 + ch.codePointAt(0)!) % 360;
  return n;
}

function placeholder(name: string): HTMLElement {
  const initial = Array.from(name.trim())[0]?.toUpperCase() ?? '?';
  const el = h('div', { class: 'photo placeholder', 'aria-hidden': 'true' }, h('span', {}, initial));
  el.style.setProperty('--hue', String(hueFor(name)));
  return el;
}

/* The placeholder is a logo stand-in, so it uses the English name in both
   languages: the same letter and colour everywhere, and no bare alef (ا),
   which reads as a vertical line on its own. */
function photo(b: Business, name: string): HTMLElement {
  if (!b.image_url) return placeholder(b.name);
  const img = h('img', { class: 'photo', src: b.image_url, alt: name, loading: 'lazy', decoding: 'async' });
  /* a missing or blocked photo falls back to the initial, never a broken icon */
  img.addEventListener('error', () => img.replaceWith(placeholder(b.name)), { once: true });
  return img;
}

function businessCard(b: Business, lang: Lang): HTMLElement {
  const t = strings(lang);
  const name = pick(b.name, b.name_ar, lang);
  const shown = b.services.slice(0, MAX_SERVICES);
  const extra = b.services.length - shown.length;

  return h('article', { class: 'card business' },
    photo(b, name),
    h('div', { class: 'body' },
      h('h3', { class: 'title' }, name),
      h('p', { class: 'meta' }, `${categoryLabel(b.category, lang)} · ${b.area}`),
      shown.length
        ? h('ul', { class: 'services' },
            ...shown.map((s) => h('li', {},
              h('span', { class: 'svc-name' }, pick(s.name, s.name_ar, lang)),
              h('span', { class: 'svc-meta' }, `${priceLabel(s.price_qar, lang)} · ${durationLabel(s.duration_min, lang)}`)
            )),
            extra > 0 ? h('li', { class: 'more' }, t.moreServices(extra)) : null
          )
        : null
    )
  );
}

export function renderSearch(root: HTMLElement, r: SearchResult, lang: Lang) {
  const t = strings(lang);
  if (!r.businesses?.length) {
    root.replaceChildren(h('section', { class: 'card notice' }, h('p', {}, t.noBusinesses)));
    return;
  }
  const single = r.businesses.length === 1;
  root.replaceChildren(
    h('p', { class: 'caption' }, t.placesFound(r.businesses.length)),
    h('div', { class: single ? 'carousel single' : 'carousel', role: 'list' },
      ...r.businesses.map((b) => {
        const card = businessCard(b, lang);
        card.setAttribute('role', 'listitem');
        return card;
      })
    )
  );
}

/* ── Open times ─────────────────────────────────────────────────────────── */

export type SendSlot = (text: string) => Promise<boolean>;

export function renderAvailability(root: HTMLElement, r: AvailabilityResult, lang: Lang, send: SendSlot) {
  const t = strings(lang);
  const business = pick(r.business_name, r.business_name_ar, lang);
  const service = pick(r.service_name, r.service_name_ar, lang);
  const day = dayFromDate(r.date, lang);

  const header = h('header', { class: 'head' },
    h('h3', { class: 'title' }, service),
    h('p', { class: 'meta' }, `${business} · ${day}`)
  );

  if (!r.slots?.length) {
    root.replaceChildren(h('section', { class: 'card pad' }, header, h('p', { class: 'empty' }, t.noSlots)));
    return;
  }

  const status = h('p', { class: 'caption foot', role: 'status' }, t.pickTime);
  const grid = h('div', { class: 'slots' });

  const buttons = r.slots.map((s: Slot) => {
    const time = timeLabel(s.start, lang);
    const low = s.spots_left <= 2;
    const content = [
      h('span', { class: 'time' }, time),
      h('span', { class: low ? 'left low' : 'left' }, t.left(s.spots_left))
    ];
    const btn = h('button', { class: 'slot', type: 'button', 'aria-label': `${time}, ${t.left(s.spots_left)}` }, ...content);
    btn.addEventListener('click', async () => {
      for (const b of buttons) (b as HTMLButtonElement).disabled = true;
      btn.classList.add('chosen');
      btn.setAttribute('aria-pressed', 'true');
      const ok = await send(t.slotMessage(time, dayLabel(s.start, lang), service, business));
      if (ok) {
        status.textContent = t.sent;
      } else {
        /* let them try again, or type it */
        status.textContent = t.sendFailed;
        btn.classList.remove('chosen');
        btn.removeAttribute('aria-pressed');
        for (const b of buttons) (b as HTMLButtonElement).disabled = false;
      }
    });
    return btn;
  });

  grid.append(...buttons);
  root.replaceChildren(h('section', { class: 'card pad' }, header, grid, status));
}

/* ── Booking confirmation ───────────────────────────────────────────────── */

export function renderBooking(root: HTMLElement, r: BookingResult, lang: Lang) {
  const t = strings(lang);
  const business = pick(r.business_name, r.business_name_ar, lang);
  const service = pick(r.service_name, r.service_name_ar, lang);

  /* only these fields, by design: never the customer's phone */
  const row = (label: string, value: string, cls = '') =>
    h('div', { class: 'row' }, h('dt', {}, label), h('dd', { class: cls }, value));

  root.replaceChildren(
    h('section', { class: 'card pad booking' },
      h('header', { class: 'head' },
        h('span', { class: 'badge pending' }, h('span', { class: 'dot', 'aria-hidden': 'true' }), t.pending),
        h('h3', { class: 'title' }, business)
      ),
      h('dl', { class: 'rows' },
        row(t.service, service),
        row(t.when, dateTimeLabel(r.start, lang)),
        row(t.reference, r.reference, 'ref')
      ),
      h('p', { class: 'caption foot' }, t.awaiting(business))
    )
  );
}

/* ── Loading and errors ─────────────────────────────────────────────────── */

export function renderSkeleton(root: HTMLElement, tool: ToolName | null) {
  const bar = (cls: string) => h('div', { class: `sk ${cls}` });
  if (tool === 'search_businesses') {
    root.replaceChildren(h('div', { class: 'carousel', 'aria-busy': 'true' },
      ...[0, 1].map(() => h('div', { class: 'card business' },
        h('div', { class: 'photo sk' }),
        h('div', { class: 'body' }, bar('w60'), bar('w40'), bar('w80'), bar('w70'))
      ))
    ));
    return;
  }
  const inner = tool === 'get_availability'
    ? [bar('w50 tall'), bar('w40'), h('div', { class: 'slots' }, ...Array.from({ length: 6 }, () => h('div', { class: 'slot sk' })))]
    : [bar('w30'), bar('w60 tall'), bar('w80'), bar('w70'), bar('w50')];
  root.replaceChildren(h('section', { class: 'card pad', 'aria-busy': 'true' }, ...inner));
}

export function renderError(root: HTMLElement, message: string, lang: Lang) {
  root.replaceChildren(h('section', { class: 'card pad notice error', role: 'alert' },
    h('p', { class: 'title' }, strings(lang).errorTitle),
    h('p', { class: 'meta' }, message)
  ));
}
