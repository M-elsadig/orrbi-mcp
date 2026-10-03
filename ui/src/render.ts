import type { AvailabilityResult, BookingResult, Business, Day, SearchResult, Slot, ToolName } from './types';
import {
  type Lang, type Period, categoryLabel, dateTimeLabel, dayChip, dayFromDate, dayLabel, durationLabel, periodOf, pick,
  priceLabel, qatarDate, strings, timeLabel
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

function photo(b: Business, name: string): HTMLElement {
  if (!b.image_url) return initial(b.name, 'photo');
  const img = h('img', { class: 'photo', src: b.image_url, alt: name, loading: 'lazy', decoding: 'async' });
  /* a missing or blocked photo falls back to the initial, never a broken icon */
  img.addEventListener('error', () => img.replaceWith(initial(b.name, 'photo')), { once: true });
  return img;
}

const metaLine = (b: Business, lang: Lang) => `${categoryLabel(b.category, lang)} · ${b.area}`;

function cheapest(b: Business): number | null {
  const prices = b.services.map((s) => s.price_qar).filter((p) => Number.isFinite(p));
  return prices.length ? Math.min(...prices) : null;
}

/* With photos: the big swipeable cards */
function businessCard(b: Business, lang: Lang): HTMLElement {
  const t = strings(lang);
  const name = pick(b.name, b.name_ar, lang);
  const shown = b.services.slice(0, MAX_SERVICES);
  const extra = b.services.length - shown.length;

  return h('article', { class: 'card business', role: 'listitem' },
    photo(b, name),
    h('div', { class: 'body' },
      h('h3', { class: 'title' }, name),
      h('p', { class: 'meta' }, metaLine(b, lang)),
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

/* Without photos: a quiet list, one line of facts per place */
function businessRow(b: Business, lang: Lang): HTMLElement {
  const t = strings(lang);
  const low = cheapest(b);
  return h('li', { class: 'place' },
    initial(b.name, 'avatar'),
    h('div', { class: 'place-text' },
      h('span', { class: 'place-name' }, pick(b.name, b.name_ar, lang)),
      h('span', { class: 'place-meta' }, metaLine(b, lang))
    ),
    low === null ? null : h('span', { class: 'place-price' }, t.from(priceLabel(low, lang)))
  );
}

export function renderSearch(root: HTMLElement, r: SearchResult, lang: Lang) {
  const t = strings(lang);
  const list = r.businesses ?? [];
  if (!list.length) {
    root.replaceChildren(h('section', { class: 'card notice' }, h('p', {}, t.noBusinesses)));
    return;
  }
  /* big cards only earn their space when there is a real photo to show */
  if (list.some((b) => b.image_url)) {
    root.replaceChildren(h('div', { class: list.length === 1 ? 'carousel single' : 'carousel', role: 'list' },
      ...list.map((b) => businessCard(b, lang))));
  } else {
    root.replaceChildren(h('section', { class: 'card' }, h('ul', { class: 'places' }, ...list.map((b) => businessRow(b, lang)))));
  }
}

/* ── Booking card: day strip + grouped times ────────────────────────────── */

export type PickSlot = (slot: Slot, day: string) => Promise<boolean>;

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

export function renderAvailability(root: HTMLElement, r: AvailabilityResult, lang: Lang, pickSlot: PickSlot) {
  const t = strings(lang);
  const business = pick(r.business_name, r.business_name_ar, lang);
  const service = pick(r.service_name, r.service_name_ar, lang);
  const today = qatarDate();

  /* all 7 days arrive with the result; older results without them still show their one day */
  const days: Day[] = r.days?.length ? r.days : [{ date: r.date, slots: r.slots ?? [] }];
  const firstShown = r.date;
  const moved = !!r.requested_date && r.requested_date !== r.date && (r.slots?.length ?? 0) > 0;

  let selected = firstShown;
  let chosen: string | null = null;     // slot_id once a time was sent
  let busy = false;

  const strip = h('div', { class: 'days', role: 'tablist', 'aria-label': service });
  const sub = h('p', { class: 'meta' });
  const times = h('div', { class: 'times', role: 'tabpanel' });
  const status = h('p', { class: 'caption foot', role: 'status' }, t.pickTime);

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
    const few = s.spots_left <= 2;
    const isChosen = chosen === s.slot_id;
    const btn = h('button', {
      class: `time${isChosen ? ' chosen' : ''}`,
      type: 'button',
      disabled: (chosen !== null && !isChosen) || busy,
      'aria-pressed': isChosen ? 'true' : undefined,
      'aria-label': few ? `${time}, ${t.left(s.spots_left)}` : time
    }, time, few ? h('span', { class: 'few' }, t.left(s.spots_left)) : null);

    btn.addEventListener('click', async () => {
      if (chosen || busy) return;
      busy = true;
      chosen = s.slot_id;
      drawTimes();
      const ok = await pickSlot(s, date);
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
  root.replaceChildren(h('section', { class: 'card pad booking-times' },
    h('header', { class: 'head' }, h('h3', { class: 'title' }, service), sub),
    strip,
    times,
    status
  ));
  revealSelected(strip);
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
    root.replaceChildren(h('section', { class: 'card', 'aria-busy': 'true' }, h('ul', { class: 'places' },
      ...[0, 1, 2].map(() => h('li', { class: 'place' },
        h('div', { class: 'avatar sk' }),
        h('div', { class: 'place-text' }, bar('w60'), bar('w40'))
      ))
    )));
    return;
  }
  const inner = tool === 'get_availability'
    ? [bar('w50 tall'), bar('w40'),
       h('div', { class: 'days' }, ...Array.from({ length: 7 }, () => h('div', { class: 'day sk' }))),
       h('div', { class: 'chips' }, ...Array.from({ length: 6 }, () => h('div', { class: 'time sk' })))]
    : [bar('w30'), bar('w60 tall'), bar('w80'), bar('w70'), bar('w50')];
  root.replaceChildren(h('section', { class: 'card pad', 'aria-busy': 'true' }, ...inner));
}

export function renderError(root: HTMLElement, message: string, lang: Lang) {
  root.replaceChildren(h('section', { class: 'card pad notice error', role: 'alert' },
    h('p', { class: 'title' }, strings(lang).errorTitle),
    h('p', { class: 'meta' }, message)
  ));
}
