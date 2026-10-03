import {
  App, applyDocumentTheme, applyHostFonts, applyHostStyleVariables, type McpUiHostContext
} from '@modelcontextprotocol/ext-apps';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import './styles.css';
import { type Lang, dayLabel, langFor, pick, strings, timeLabel } from './i18n';
import { renderAvailability, renderBooking, renderError, renderSearch, renderSkeleton, type PickSlot } from './render';
import type { AvailabilityResult, BookingResult, SearchResult, Slot, ToolName } from './types';

/* One widget for all three tools. It knows which tool opened it from the
   host context (toolInfo), and falls back to the shape of the result. */

const root = document.getElementById('root')!;
const app = new App({ name: 'Orrbi', version: '1.1.0' });

let lang: Lang = 'en';
let asked: Lang | null = null;   // the tool's `language` argument, set by the model
let tool: ToolName | null = null;
let last: CallToolResult | null = null;

const TOOLS: ToolName[] = ['search_businesses', 'get_availability', 'create_booking'];

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
    if (last) render(last);
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

/* Tapping a time does two things:
   1. tells the model which slot it is (business, service and slot ids),
      quietly, so a time picked from another day of the card can be booked
      without another get_availability call;
   2. sends a normal user message, so the model carries on the usual way:
      it still asks for name and phone and confirms before booking.

   Always offered, even when the host doesn't declare the `message`
   capability: some hosts handle messages without declaring it. If the host
   refuses, the card says so and the user can type the time instead. */
function slotPicker(r: AvailabilityResult): PickSlot {
  return async (slot: Slot) => {
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

    const t = strings(lang);
    const text = t.slotMessage(
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
  };
}

function render(result: CallToolResult) {
  last = result;

  if (result.isError) {
    const text = result.content?.find((c) => c.type === 'text');
    renderError(root, text && 'text' in text ? text.text : '', lang);
    return;
  }

  const data = (result.structuredContent ?? {}) as Record<string, unknown>;
  switch (tool ?? toolFromResult(data)) {
    case 'search_businesses': return renderSearch(root, data as unknown as SearchResult, lang);
    case 'get_availability': {
      const r = data as unknown as AvailabilityResult;
      return renderAvailability(root, r, lang, slotPicker(r));
    }
    case 'create_booking': return renderBooking(root, data as unknown as BookingResult, lang);
    default: root.replaceChildren();
  }
}

/* Handlers go on before connect(), or the first events are missed. */
app.onhostcontextchanged = (ctx) => applyHost({ ...app.getHostContext(), ...ctx });
app.ontoolinput = (params) => {
  const l = params.arguments?.language;
  if (l === 'ar' || l === 'en') {
    asked = l;
    applyLocale(undefined);
  }
  if (!last) renderSkeleton(root, tool);
};
app.ontoolresult = (result) => render(result as CallToolResult);
app.ontoolcancelled = () => { if (!last) root.replaceChildren(); };
app.onteardown = async () => ({});
app.onerror = (e) => console.error('[orrbi]', e);

renderSkeleton(root, null);
applyLocale(undefined);

app.connect().then(() => {
  applyHost(app.getHostContext());
  if (!last) renderSkeleton(root, tool);
}).catch((e) => console.error('[orrbi] could not connect to host', e));
