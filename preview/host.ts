import { AppBridge, PostMessageTransport } from '@modelcontextprotocol/ext-apps/app-bridge';
import widgetHtml from '../ui/dist/widget.html?raw';
import fixture from './.data/fixture.json';

/* A stand-in MCP Apps host for reviewing an inactive business: the real
   widget (ui/dist/widget.html) in an iframe, opened as if search_businesses
   had found the business. get_business answers from the fixture made by
   scripts/preview-business.ts; create_booking is stubbed and sends nothing. */

type Req = { id: string; kind: string; flag_answer?: boolean; flag_note?: string | null; flag_note_ar?: string | null };
type Fixture = { cards: Record<string, unknown>; page: Record<string, unknown> & { requirements: Req[]; name: string; name_ar?: string | null } };
const data = fixture as unknown as Fixture;

/* Photos are inlined as data: URIs so the page needs no network; messages
   carrying megabytes of them stall the widget, so each becomes a short
   blob: URL once (the iframe shares this origin). */
const blobs = new Map<string, string>();
async function toBlobUrls(v: unknown): Promise<unknown> {
  if (typeof v === 'string' && v.startsWith('data:')) {
    if (!blobs.has(v)) blobs.set(v, URL.createObjectURL(await (await fetch(v)).blob()));
    return blobs.get(v);
  }
  if (Array.isArray(v)) return Promise.all(v.map(toBlobUrls));
  if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) (v as Record<string, unknown>)[k] = await toBlobUrls(x);
  }
  return v;
}
const ready = toBlobUrls(data);

const params = new URLSearchParams(location.search);
let lang: 'en' | 'ar' = params.get('lang') === 'ar' ? 'ar' : 'en';
let mode: 'inline' | 'fullscreen' = 'inline';

const frame = document.getElementById('widget') as HTMLIFrameElement;
const stage = document.getElementById('stage')!;
const log = document.getElementById('log')!;

function note(text: string) {
  const li = document.createElement('li');
  li.textContent = text;
  log.prepend(li);
}

function setMode(next: typeof mode) {
  mode = next;
  stage.dataset.mode = next;
}

let bridge: AppBridge | null = null;

async function start() {
  bridge?.close().catch(() => undefined);
  setMode('inline');
  await ready;

  const b = new AppBridge(null, { name: 'Orrbi preview', version: '1.0.0' }, { serverTools: {}, openLinks: {} }, {
    hostContext: {
      theme: matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
      locale: lang === 'ar' ? 'ar-QA' : 'en-GB',
      displayMode: 'inline',
      availableDisplayModes: ['inline', 'fullscreen'],
      toolInfo: { tool: { name: 'search_businesses', inputSchema: { type: 'object' } } }
    }
  });
  bridge = b;

  b.oncalltool = async ({ name, arguments: a }) => {
    if (name === 'get_business') {
      note('Card opened the gym page (get_business, from the preview data).');
      return { content: [{ type: 'text', text: '{}' }], structuredContent: data.page };
    }
    if (name === 'create_booking') {
      const answers = new Map(((a?.requirements ?? []) as { id: string; answer: boolean }[]).map((x) => [x.id, x.answer]));
      const flagged = data.page.requirements.filter((r) => r.flag_answer !== undefined && answers.get(r.id) === r.flag_answer);
      note(`create_booking (STUB, nothing sent): ${answers.size} answers, ${flagged.length} flagged.`);
      const slot = (data.page.week as { slots: { slot_id: string; start: string; start_label: string; service_id: string; class_full?: string; trainer?: string }[] })
        .slots.find((s) => s.slot_id === a?.slot_id);
      return {
        content: [{ type: 'text', text: '{}' }],
        structuredContent: {
          booking_id: 'preview', reference: 'PREVIEW', status: 'pending',
          business_name: data.page.name, business_name_ar: data.page.name_ar,
          service_name: slot?.class_full ?? 'Session', start: slot?.start ?? new Date().toISOString(), start_label: slot?.start_label,
          price_qar: (data.page.services as { service_id: string; price_qar: number }[]).find((s) => s.service_id === slot?.service_id)?.price_qar,
          pay_at_venue: data.page.pay_at_venue, category: data.page.category,
          trainer: slot?.trainer,
          ...(flagged.length ? { health_note: flagged[0].flag_note ?? undefined, health_note_ar: flagged[0].flag_note_ar } : {})
        }
      };
    }
    return { isError: true, content: [{ type: 'text', text: `${name} is not available in the preview.` }] };
  };
  b.onrequestdisplaymode = async ({ mode: m }) => {
    setMode(m === 'fullscreen' ? 'fullscreen' : 'inline');
    b.setHostContext({ ...b.getHostContext(), displayMode: mode });
    return { mode };
  };
  b.onopenlink = async ({ url }) => {
    window.open(url, '_blank', 'noopener');
    return {};
  };
  b.onupdatemodelcontext = async () => {
    note('Card told the model about the request (no name, phone or answers).');
    return {};
  };
  b.onmessage = async () => ({});
  b.oninitialized = () => {
    b.sendToolInput({ arguments: { query: data.page.name, language: lang } });
    b.sendToolResult({ content: [{ type: 'text', text: '{}' }], structuredContent: data.cards });
  };

  /* listen first: the widget says hello as soon as it loads */
  await b.connect(new PostMessageTransport(frame.contentWindow!, frame.contentWindow!));
  frame.srcdoc = widgetHtml;
}

for (const btn of document.querySelectorAll<HTMLButtonElement>('[data-lang]')) {
  btn.addEventListener('click', () => {
    lang = btn.dataset.lang === 'ar' ? 'ar' : 'en';
    document.querySelectorAll('[data-lang]').forEach((x) => x.setAttribute('aria-pressed', String(x === btn)));
    void start();
  });
}
document.getElementById('close')!.addEventListener('click', () => {
  if (mode !== 'fullscreen' || !bridge) return;
  setMode('inline');
  bridge.setHostContext({ ...bridge.getHostContext(), displayMode: 'inline' });
});

void start();
