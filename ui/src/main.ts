import {
  App, applyDocumentTheme, applyHostFonts, applyHostStyleVariables, type McpUiHostContext
} from '@modelcontextprotocol/ext-apps';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import './styles.css';
import { type Lang, dayLabel, langFor, pick, qatarDate, strings, timeLabel } from './i18n';
import { type Choice, type DetailsForm, Flow, type Step, choiceFor, choiceFromAvailability } from './flow';
import { bookedNote, bookingArgs, classifyBookingError, newRequestId, validateDetails } from './booking';
import {
  type TimesMode, viewBooked, viewDetails, viewError, viewPlaces, viewServices, viewSkeleton, viewTimes,
  viewTimesError, viewTimesLoading
} from './render';
import type { AvailabilityResult, BookingResult, SearchResult, Slot, ToolName } from './types';

/* One widget for all three tools, and the whole booking flow inside it:
   places → services → times → details → booked, by taps. It knows which
   tool opened it from the host context (toolInfo), and falls back to the
   shape of the result. */

const root = document.getElementById('root')!;
const app = new App({ name: 'Orrbi', version: '1.2.0' });

let lang: Lang = 'en';
let asked: Lang | null = null;   // the tool's `language` argument, set by the model
let tool: ToolName | null = null;
let flow: Flow | null = null;
let errorText: string | null = null;
let received = false;

/* What the user typed, kept in memory only (never storage) so going back to
   pick another time doesn't make them type it again. */
let lastForm: DetailsForm = { name: '', phone: '' };

const TOOLS: ToolName[] = ['search_businesses', 'get_availability', 'create_booking'];
const CALL_TIMEOUT_MS = 15_000;

function toolFromContext(ctx: McpUiHostContext | undefined): ToolName | null {
  const name = ctx?.toolInfo?.tool?.name;
  return TOOLS.includes(name as ToolName) ? (name as ToolName) : null;
}

function toolFromResult(data: Record<string, unknown>): ToolName | null {
  if (Array.isArray(data.businesses)) return 'search_businesses';
  if (Array.isArray(data.slots)) return 'get_availability';
  if (typeof data.booking_id === 'string') return 'create_booking';
  return null;
}

/* Booking in the card needs the host to forward tool calls from the widget.
   Without that, the card keeps the chat-message flow. */
const canCallTools = () => !!app.getHostCapabilities()?.serverTools;

/* ── Host context: language, theme, safe area ───────────────────────────── */

/* Language: the language the model says the user writes in, else the host's
   locale, else the lang ChatGPT mirrors onto <html>, else the browser's.
   Arabic flips the whole widget right-to-left. */
let hostLocale: string | undefined;
function applyLocale(ctx: McpUiHostContext | undefined) {
  if (ctx?.locale) hostLocale = ctx.locale;
  const next = asked ?? langFor(hostLocale || document.documentElement.lang || navigator.language);
  document.documentElement.lang = next;
  document.documentElement.dir = next === 'ar' ? 'rtl' : 'ltr';
  if (next !== lang) {
    lang = next;
    if (received) show('none');
  }
}

function applyHost(ctx: McpUiHostContext | undefined) {
  if (!ctx) return;
  if (ctx.theme) applyDocumentTheme(ctx.theme);
  if (ctx.styles?.variables) applyHostStyleVariables(ctx.styles.variables);
  if (ctx.styles?.css?.fonts) applyHostFonts(ctx.styles.css.fonts);
  if (ctx.safeAreaInsets) {
    const { top, right, bottom, left } = ctx.safeAreaInsets;
    const s = document.documentElement.style;
    s.setProperty('--safe-top', `${top}px`);
    s.setProperty('--safe-right', `${right}px`);
    s.setProperty('--safe-bottom', `${bottom}px`);
    s.setProperty('--safe-left', `${left}px`);
  }
  tool ??= toolFromContext(ctx);
  applyLocale(ctx);
}

/* ── Rendering the current step ─────────────────────────────────────────── */

type Dir = 'fwd' | 'back' | 'none';

/* Forward slides in from the trailing edge, Back from the leading edge:
   the same path both ways (mirrored in Arabic by CSS). */
function mount(el: HTMLElement, dir: Dir) {
  const step = document.createElement('div');
  step.className = dir === 'none' ? 'step' : `step enter-${dir}`;
  step.append(el);
  root.replaceChildren(step);
}

function show(dir: Dir) {
  if (errorText !== null) return mount(viewError(errorText, lang), dir);
  if (!flow) return mount(viewSkeleton(tool), dir);
  mount(build(flow.current), dir);
}

const goBack = () => {
  if (flow?.back()) show('back');
};
const backFor = () => (flow?.canGoBack ? goBack : undefined);

function build(step: Step): HTMLElement {
  switch (step.kind) {
    case 'places':
      return viewPlaces(step.search, lang, canCallTools() ? (b) => {
        flow!.push({ kind: 'services', business: b });
        show('fwd');
      } : undefined);

    case 'services':
      return viewServices(step.business, lang, backFor(), (serviceId) => {
        const choice = choiceFor(step.business, serviceId);
        if (!choice) return;
        const next: Step = { kind: 'times', choice };
        flow!.push(next);
        show('fwd');
        void loadWeek(next);
      });

    case 'times': {
      const title = pick(step.choice.service_name, step.choice.service_name_ar, lang);
      if (step.error) return viewTimesError(lang, backFor(), title, () => void loadWeek(step));
      if (!step.data) return viewTimesLoading(lang, backFor(), title);
      return viewTimes(step.data, lang, backFor(), timesMode(step.choice, step.data), step.selected, (d) => { step.selected = d; });
    }

    case 'details':
      return viewDetails(step, lang, {
        onBack: goBack,
        onInput: (form) => { step.form = form; lastForm = form; },
        onSubmit: (form) => void submit(step, form),
        onRetime: () => retime()
      });

    case 'booked':
      return viewBooked(step.booking, lang);
  }
}

function timesMode(choice: Choice, data: AvailabilityResult): TimesMode {
  if (canCallTools() && choice.business_id && choice.service_id) {
    return {
      kind: 'open',
      onPick: (slot, day) => {
        flow!.push({
          kind: 'details', choice, slot, day, requestId: newRequestId(),
          form: { ...lastForm }, fieldErrors: {}
        });
        show('fwd');
      }
    };
  }
  return { kind: 'chat', send: (slot) => sendSlotToChat(data, slot) };
}

/* ── Calls the card makes itself ────────────────────────────────────────── */

const textOf = (r: CallToolResult) => {
  const c = r.content?.find((x) => x.type === 'text');
  return c && 'text' in c ? c.text : '';
};

/* All 7 days in one call, as the model's get_availability gets them */
async function loadWeek(step: Extract<Step, { kind: 'times' }>) {
  step.error = undefined;
  step.data = undefined;
  if (flow?.current === step) show('none');
  try {
    const res = await app.callServerTool(
      { name: 'get_availability', arguments: {
        business_id: step.choice.business_id, service_id: step.choice.service_id, date: qatarDate(), language: lang
      } },
      { signal: AbortSignal.timeout(CALL_TIMEOUT_MS) }
    );
    if (res.isError) throw new Error(textOf(res as CallToolResult));
    step.data = res.structuredContent as unknown as AvailabilityResult;
  } catch (e) {
    console.warn('[orrbi] get_availability from the card failed', e);
    step.error = 'load';
  }
  if (flow?.current === step) show('none');   // only redraw if they're still looking at it
}

async function submit(step: Extract<Step, { kind: 'details' }>, form: DetailsForm) {
  step.form = form;
  lastForm = form;
  const { errors, name, phone } = validateDetails(form);
  step.fieldErrors = errors;
  step.error = undefined;
  step.retime = false;
  if (errors.name || errors.phone || !phone) return show('none');

  step.busy = true;
  show('none');
  try {
    /* name and phone go to the server as tool arguments only: never into
       the chat, never into model context */
    const res = await app.callServerTool(
      { name: 'create_booking', arguments: bookingArgs(step.choice, step.slot, name, phone, step.requestId, lang) },
      { signal: AbortSignal.timeout(CALL_TIMEOUT_MS) }
    );
    if (res.isError) {
      const { kind, retime } = classifyBookingError(textOf(res as CallToolResult));
      step.error = kind;
      step.retime = retime;
      step.busy = false;
      if (flow?.current === step) show('none');
      return;
    }
    const booking = res.structuredContent as unknown as BookingResult;
    flow!.finish(booking);
    show('fwd');
    void tellModel(booking);
  } catch (e) {
    console.warn('[orrbi] create_booking from the card failed', e);
    step.error = 'other';
    step.busy = false;
    if (flow?.current === step) show('none');
  }
}

/* The slot is gone: back to the times, with fresh availability */
function retime() {
  if (!flow?.back()) return;
  const cur = flow.current;
  show('back');
  if (cur.kind === 'times') void loadWeek(cur);
}

/* After booking, the model learns only what was booked: no name, no phone */
async function tellModel(b: BookingResult) {
  try {
    await app.updateModelContext(
      {
        content: [{ type: 'text', text: bookedNote(b) }],
        structuredContent: {
          booked: true, reference: b.reference, status: b.status,
          business_name: b.business_name, service_name: b.service_name, start: b.start
        }
      },
      { signal: AbortSignal.timeout(5000) }
    );
  } catch {
    /* the card still shows the booking; the model just won't know yet */
  }
}

/* ── Fallback: no tool calls from the card ──────────────────────────────── */

/* Tapping a time tells the model which slot (quietly) and sends a normal
   user message, so the model carries on in chat as before. */
async function sendSlotToChat(r: AvailabilityResult, slot: Slot): Promise<boolean> {
  try {
    await app.updateModelContext({
      content: [{
        type: 'text',
        text: `The user picked a time in the Orrbi card: ${r.service_name} at ${r.business_name}, ${slot.start_label} (Qatar time). ` +
          `business_id=${r.business_id} service_id=${r.service_id} slot_id=${slot.slot_id}. ` +
          'Use this slot_id for create_booking, after confirming the customer name and phone with the user.'
      }],
      structuredContent: {
        business_id: r.business_id, service_id: r.service_id, slot_id: slot.slot_id,
        start: slot.start, start_label: slot.start_label
      }
    }, { signal: AbortSignal.timeout(5000) });
  } catch {
    /* not supported here: the model can still call get_availability for that one date */
  }

  const text = strings(lang).slotMessage(
    timeLabel(slot.start, lang),
    dayLabel(slot.start, lang),
    pick(r.service_name, r.service_name_ar, lang),
    pick(r.business_name, r.business_name_ar, lang)
  );
  try {
    const res = await app.sendMessage({ role: 'user', content: [{ type: 'text', text }] }, { signal: AbortSignal.timeout(8000) });
    return !res.isError;
  } catch {
    return false;
  }
}

/* ── The tool result that opened the card ───────────────────────────────── */

function start(result: CallToolResult) {
  received = true;
  errorText = null;
  flow = null;

  if (result.isError) {
    errorText = textOf(result);
    return show('none');
  }

  const data = (result.structuredContent ?? {}) as Record<string, unknown>;
  switch (tool ?? toolFromResult(data)) {
    case 'search_businesses':
      flow = new Flow({ kind: 'places', search: data as unknown as SearchResult });
      break;
    case 'get_availability': {
      const r = data as unknown as AvailabilityResult;
      const choice: Choice = choiceFromAvailability(r) ?? {
        business_id: '', business_name: r.business_name, business_name_ar: r.business_name_ar,
        service_id: '', service_name: r.service_name, service_name_ar: r.service_name_ar
      };
      flow = new Flow({ kind: 'times', choice, data: r });
      break;
    }
    case 'create_booking':
      flow = new Flow({ kind: 'booked', booking: data as unknown as BookingResult });
      break;
    default:
      return root.replaceChildren();
  }
  show('none');
}

/* Handlers go on before connect(), or the first events are missed. */
app.onhostcontextchanged = (ctx) => applyHost({ ...app.getHostContext(), ...ctx });
app.ontoolinput = (params) => {
  const l = params.arguments?.language;
  if (l === 'ar' || l === 'en') {
    asked = l;
    applyLocale(undefined);
  }
  if (!received) show('none');
};
app.ontoolresult = (result) => start(result as CallToolResult);
app.ontoolcancelled = () => { if (!received) root.replaceChildren(); };
app.onteardown = async () => ({});
app.onerror = (e) => console.error('[orrbi]', e);

show('none');
applyLocale(undefined);

app.connect().then(() => {
  applyHost(app.getHostContext());
  /* the result may already be here; redraw so taps match what the host allows */
  show('none');
}).catch((e) => console.error('[orrbi] could not connect to host', e));
