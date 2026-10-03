import type { AvailabilityResult, BookingResult, Business, Day, SearchResult, Slot, ToolName } from './types';
import type { Choice, DetailsForm } from './flow';
import { type BookingErrorKind, type FieldErrors, validateDetails } from './booking';
import {
  type Lang, type Period, categoryLabel, dateTimeLabel, dayChip, dayFromDate, dayLabel, durationLabel, periodOf, pick,
  priceLabel, qatarDate, strings, timeLabel
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

/* ── Places ─────────────────────────────────────────────────────────────── */

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

function photo(b: Business, name: string, cls = 'photo'): HTMLElement {
  if (!b.image_url) return initial(b.name, cls);
  const img = h('img', { class: cls, src: b.image_url, alt: cls === 'photo' ? name : '', loading: 'lazy', decoding: 'async' });
  /* a missing or blocked photo falls back to the initial, never a broken icon */
  img.addEventListener('error', () => img.replaceWith(initial(b.name, cls)), { once: true });
  return img;
}

const metaLine = (b: Business, lang: Lang) => `${categoryLabel(b.category, lang)} · ${b.area}`;

function cheapest(b: Business): number | null {
  const prices = b.services.map((s) => s.price_qar).filter((p) => Number.isFinite(p));
  return prices.length ? Math.min(...prices) : null;
}

/* With photos: the big swipeable cards */
function businessCard(b: Business, lang: Lang, onPick?: (b: Business) => void): HTMLElement {
  const t = strings(lang);
  const name = pick(b.name, b.name_ar, lang);
  const shown = b.services.slice(0, MAX_SERVICES);
  const extra = b.services.length - shown.length;

  const body = [
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
  ];
  if (!onPick) return h('article', { class: 'card business', role: 'listitem' }, ...body);

  const btn = h('button', { class: 'card business tappable', type: 'button', role: 'listitem', 'aria-label': name }, ...body);
  btn.addEventListener('click', () => onPick(b));
  return btn;
}

/* Without photos: a quiet list, one line of facts per place */
function businessRow(b: Business, lang: Lang, onPick?: (b: Business) => void): HTMLElement {
  const t = strings(lang);
  const low = cheapest(b);
  const content = [
    initial(b.name, 'avatar'),
    h('div', { class: 'place-text' },
      h('span', { class: 'place-name' }, pick(b.name, b.name_ar, lang)),
      h('span', { class: 'place-meta' }, metaLine(b, lang))
    ),
    low === null ? null : h('span', { class: 'place-price' }, t.from(priceLabel(low, lang))),
    onPick ? h('span', { class: 'chev fwd', 'aria-hidden': 'true' }) : null
  ];
  if (!onPick) return h('li', { class: 'place' }, ...content);

  const btn = h('button', { class: 'place tappable', type: 'button' }, ...content);
  btn.addEventListener('click', () => onPick(b));
  return h('li', {}, btn);
}

export function viewPlaces(r: SearchResult, lang: Lang, onPick?: (b: Business) => void): HTMLElement {
  const t = strings(lang);
  const list = r.businesses ?? [];
  if (!list.length) return h('section', { class: 'card notice' }, h('p', {}, t.noBusinesses));

  /* big cards only earn their space when there is a real photo to show */
  if (list.some((b) => b.image_url)) {
    return h('div', { class: list.length === 1 ? 'carousel single' : 'carousel', role: 'list' },
      ...list.map((b) => businessCard(b, lang, onPick)));
  }
  return h('section', { class: 'card' }, h('ul', { class: 'places' }, ...list.map((b) => businessRow(b, lang, onPick))));
}

/* ── Services ───────────────────────────────────────────────────────────── */

export function viewServices(b: Business, lang: Lang, onBack: (() => void) | undefined, onPick: (serviceId: string) => void): HTMLElement {
  const t = strings(lang);
  const name = pick(b.name, b.name_ar, lang);

  return h('section', { class: 'card pad' },
    h('header', { class: onBack ? 'head with-back' : 'head' },
      onBack ? backButton(lang, onBack) : null,
      photo(b, name, 'avatar'),
      h('div', { class: 'head-text' },
        h('h3', { class: 'title' }, name),
        h('p', { class: 'meta' }, metaLine(b, lang))
      )
    ),
    h('p', { class: 'group-title' }, t.pickService),
    h('ul', { class: 'svc-list' }, ...b.services.map((s) => {
      const btn = h('button', { class: 'svc tappable', type: 'button' },
        h('span', { class: 'svc-text' },
          h('span', { class: 'svc-title' }, pick(s.name, s.name_ar, lang)),
          h('span', { class: 'svc-sub' }, durationLabel(s.duration_min, lang))
        ),
        h('span', { class: 'svc-price' }, priceLabel(s.price_qar, lang)),
        h('span', { class: 'chev fwd', 'aria-hidden': 'true' })
      );
      btn.addEventListener('click', () => onPick(s.service_id));
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

/* ── Details: summary + name and mobile ─────────────────────────────────── */

export type DetailsState = {
  choice: Choice;
  slot: Slot;
  form: DetailsForm;
  fieldErrors: FieldErrors;
  error?: BookingErrorKind;
  retime?: boolean;
  busy?: boolean;
};

export type DetailsHandlers = {
  onBack: () => void;
  onInput: (form: DetailsForm) => void;
  onSubmit: (form: DetailsForm) => void;
  onRetime: () => void;
};

export function viewDetails(s: DetailsState, lang: Lang, on: DetailsHandlers): HTMLElement {
  const t = strings(lang);
  const c = s.choice;
  const business = pick(c.business_name, c.business_name_ar, lang);
  const service = pick(c.service_name, c.service_name_ar, lang);

  const row = (label: string, value: string) => h('div', { class: 'row' }, h('dt', {}, label), h('dd', {}, value));
  const priceDur = [
    c.price_qar !== undefined ? priceLabel(c.price_qar, lang) : null,
    c.duration_min !== undefined ? durationLabel(c.duration_min, lang) : null
  ].filter(Boolean).join(' · ');

  const field = (id: 'name' | 'phone', label: string, error: string | undefined, attrs: Attrs) => {
    const input = h('input', {
      id: `f-${id}`, name: id, class: error ? 'input invalid' : 'input', value: s.form[id],
      'aria-invalid': error ? 'true' : undefined, 'aria-describedby': error ? `e-${id}` : undefined,
      disabled: s.busy, ...attrs
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

  const confirm = h('button', { class: 'btn primary', type: 'submit', disabled: s.busy }, s.busy ? t.booking : t.confirm);
  const form = h('form', { class: 'details', novalidate: true },
    nameF.el,
    phoneF.el,
    s.error
      ? h('div', { class: 'form-error', role: 'alert' }, h('p', {}, t.bookErrors[s.error]))
      : null,
    s.retime ? (() => {
      const b = h('button', { class: 'btn secondary', type: 'button' }, t.pickAnother);
      b.addEventListener('click', on.onRetime);
      return b;
    })() : confirm,
    h('p', { class: 'caption' }, t.privacy)
  );
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!s.busy) on.onSubmit(read());
  });

  return h('section', { class: 'card pad' },
    header(lang, s.busy ? undefined : on.onBack, t.yourDetails),
    h('dl', { class: 'rows summary' },
      row(t.business, business),
      row(t.service, service),
      row(t.when, dateTimeLabel(s.slot.start, lang)),
      priceDur ? row(t.price, priceDur) : null
    ),
    form
  );
}

/* ── Booked ─────────────────────────────────────────────────────────────── */

export function viewBooked(r: BookingResult, lang: Lang): HTMLElement {
  const t = strings(lang);
  const business = pick(r.business_name, r.business_name_ar, lang);
  const service = pick(r.service_name, r.service_name_ar, lang);

  /* only these fields, by design: never the customer's phone */
  const row = (label: string, value: string, cls = '') =>
    h('div', { class: 'row' }, h('dt', {}, label), h('dd', { class: cls }, value));

  return h('section', { class: 'card pad booking' },
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
  );
}

/* ── Loading and errors ─────────────────────────────────────────────────── */

export function viewSkeleton(tool: ToolName | null): HTMLElement {
  const bar = (cls: string) => h('div', { class: `sk ${cls}` });
  if (tool === 'search_businesses') {
    return h('section', { class: 'card', 'aria-busy': 'true' }, h('ul', { class: 'places' },
      ...[0, 1, 2].map(() => h('li', { class: 'place' },
        h('div', { class: 'avatar sk' }),
        h('div', { class: 'place-text' }, bar('w60'), bar('w40'))
      ))
    ));
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
