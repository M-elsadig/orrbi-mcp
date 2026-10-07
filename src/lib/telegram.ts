import { qatarLabelAr } from './time.js';
import { actionRow } from './telegramActions.js';
import { cancellationText, paymentNote, priceText } from './payment.js';

/* Ping the owner on Telegram when an MCP booking comes in. Best effort, like
   the n8n webhook: a Telegram failure is logged and never fails the booking.

   Plain text, no parse_mode, so a customer name with * or _ can't break the
   message or inject formatting. */

const TIMEOUT_MS = 3000;

export type BookingAlert = {
  booking_id: string;
  reference: string;
  business_name: string;
  service_name: string;
  price_qar: number | null;
  pay_at_venue?: boolean;
  category?: string | null;
  starts_at: string;
  start_label: string;
  customer_name: string;
  customer_phone: string;   // +974XXXXXXXX
  notes: string | null;
  cancellation_hours?: number | null;        // what the customer is told
  venue_cancellation_hours?: number | null;  // what the business needs
  first_visit_note_ar?: string | null;
  booking_contact?: { name: string | null; phone: string } | null;   // who the owner calls to book
  ladies_only?: boolean;
  trainer?: string | null;                   // 1:1 appointments
  /* the requirement questions answered with their flag answer (health
     screening): the business must call the customer before the session */
  health_flags?: string[];
};

type WhatsAppFields = Pick<BookingAlert, 'customer_name' | 'customer_phone' | 'business_name' | 'starts_at' | 'reference'> &
  Partial<Pick<BookingAlert, 'price_qar' | 'pay_at_venue' | 'category' | 'cancellation_hours' | 'first_visit_note_ar' | 'trainer'>>;

/* wa.me wants the number without +, and the text URL-encoded. The prefilled
   message is the one the owner sends once the business has confirmed: the
   confirmation, then where to pay, the cancellation window and the
   first-visit note, each only when known. */
export function whatsappLink(b: WhatsAppFields): string {
  const pay = b.price_qar == null ? null : paymentNote({ price_qar: b.price_qar, pay_at_venue: b.pay_at_venue, category: b.category }, 'ar');
  const cancel = cancellationText(b.cancellation_hours, 'ar');
  const message = [
    `مرحبا ${b.customer_name}، حجزك في ${b.business_name}${b.trainer ? ` مع ${b.trainer}` : ''} يوم ${qatarLabelAr(b.starts_at)} ` +
    `تم تأكيده ✅ رقم الحجز: ${b.reference}`,
    ...(pay ? [`💳 ${pay}`] : []),
    ...(cancel ? [`⏰ ${cancel}`] : []),
    ...(b.first_visit_note_ar ? [`📍 ${b.first_visit_note_ar}`] : [])
  ].join('\n');
  return `https://wa.me/${b.customer_phone.replace(/^\+/, '')}?text=${encodeURIComponent(message)}`;
}

/* The request the owner forwards to the business's booking contact on
   WhatsApp, in English (what the business works in). Carries the health
   flag, so the business knows to call the customer before the session.
   null without a booking contact. */
export type StudioFields = Pick<BookingAlert,
  'reference' | 'business_name' | 'service_name' | 'start_label' | 'customer_name' | 'customer_phone' | 'notes'> &
  Partial<Pick<BookingAlert, 'booking_contact' | 'trainer' | 'health_flags' | 'ladies_only'>>;

export function studioWhatsappLink(b: StudioFields): string | null {
  const to = b.booking_contact?.phone.replace(/\D/g, '');
  if (!to) return null;
  const message = [
    `Hello${b.booking_contact?.name ? ` ${b.booking_contact.name}` : ''}, a booking request from Orrbi:`,
    '',
    `${b.service_name}${b.trainer ? ` with ${b.trainer}` : ''}${b.ladies_only ? ' (ladies only)' : ''}`,
    `When: ${b.start_label} (Qatar time)`,
    `Customer: ${b.customer_name}, ${b.customer_phone}`,
    ...(b.notes ? [`Notes: ${b.notes}`] : []),
    ...(b.health_flags?.length ? [
      '',
      '⚠️ Health screening: the customer answered YES to:',
      ...b.health_flags.map((q) => `- ${q}`),
      'Please call the customer before the session to make sure it is safe for them.'
    ] : []),
    '',
    `Ref: ${b.reference}. Can you confirm this time?`
  ].join('\n');
  return `https://wa.me/${to}?text=${encodeURIComponent(message)}`;
}

/* "Book via: Irish (reception) +97477708678" (Telegram makes the number tappable) */
function contactLine(c: BookingAlert['booking_contact']): string | null {
  if (!c) return null;
  return `Book via: ${c.name ? `${c.name} ` : ''}${c.phone}`;
}

function cancelLine(b: BookingAlert): string | null {
  if (b.cancellation_hours == null && b.venue_cancellation_hours == null) return null;
  const parts = [
    b.cancellation_hours != null ? `customer told ${b.cancellation_hours}h` : null,
    b.venue_cancellation_hours != null ? `business needs ${b.venue_cancellation_hours}h` : null
  ].filter(Boolean);
  return `Cancellation: ${parts.join(', ')}`;
}

/* Resolves to null when the alert went out, else why it didn't, so the
   caller can log it: a booking whose alert failed must still leave a trace. */
export async function notifyTelegram(b: BookingAlert): Promise<string | null> {
  const wa = whatsappLink(b);
  const studio = studioWhatsappLink(b);

  /* the full link is long once the Arabic is encoded, so the text carries
     the short form and the button carries the prefilled message */
  const text = [
    '🆕 New booking request (pending)',
    ...(b.health_flags?.length ? [
      '',
      '⚠️ HEALTH FLAG: answered YES to:',
      ...b.health_flags.map((q) => `- ${q}`),
      'The business must call the customer before the session (the studio WhatsApp says so).'
    ] : []),
    '',
    `Ref: ${b.reference}`,
    `Business: ${b.business_name}`,
    `Service: ${b.service_name}${b.ladies_only ? ' (LADIES ONLY)' : ''}`,
    ...(b.trainer ? [`Trainer: ${b.trainer}`] : []),
    `When: ${b.start_label} (Qatar time)`,
    `Price: ${b.price_qar == null ? 'unknown' : priceText({ price_qar: b.price_qar, pay_at_venue: b.pay_at_venue, category: b.category })}`,
    `Customer: ${b.customer_name}`,
    `Phone: ${b.customer_phone}`,
    ...(b.notes ? [`Notes: ${b.notes}`] : []),
    ...[contactLine(b.booking_contact), cancelLine(b)].filter((l): l is string => Boolean(l)),
    '',
    `WhatsApp: ${wa}`,
    ...(studio ? [`Studio WhatsApp: ${studio}`] : []),
    '',
    'Source: AI assistant (MCP)',
    studio ? 'Book it with the business (📲 sends them the request on WhatsApp), then tap ✅ or ❌.'
      : 'Book it in the business app, then tap ✅ or ❌.'
  ].join('\n');

  const first = await sendTelegram(text, {
    reply_markup: {
      inline_keyboard: [
        ...(studio ? [[{ text: '📲 Send request to studio', url: studio }]] : []),
        [{ text: '💬 Send WhatsApp confirmation', url: wa }],
        actionRow(b.booking_id)
      ]
    }
  });
  if (!first || first === NOT_CONFIGURED) return first;

  /* one retry without the WhatsApp button, in case its URL was what Telegram
     refused; the link is in the text anyway, and ✅/❌ must survive */
  console.warn(`[telegram] alert for ${b.reference} failed (${first}), retrying without the link button`);
  const second = await sendTelegram(text, { reply_markup: { inline_keyboard: [actionRow(b.booking_id)] } });
  return second && `${first}; retry: ${second}`;
}

const NOT_CONFIGURED = 'TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID is not set';

/* Plain text to the owner's chat. Resolves to null on success, else a short
   reason. Never throws. */
export async function sendTelegram(text: string, extra: Record<string, unknown> = {}): Promise<string | null> {
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!process.env.TELEGRAM_BOT_TOKEN || !chatId) return NOT_CONFIGURED;
  const res = await callTelegram('sendMessage', {
    chat_id: chatId, text: text.slice(0, 4000), disable_web_page_preview: true, ...extra
  });
  return res.ok ? null : res.error;
}

/* Any Bot API method. Never throws, and never puts the token (it's in the
   URL) in the error. */
export async function callTelegram(method: string, body: Record<string, unknown>):
  Promise<{ ok: true; result: unknown } | { ok: false; error: string }> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return { ok: false, error: NOT_CONFIGURED };
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
    const json = await res.json().catch(() => null) as { ok?: boolean; result?: unknown; description?: string } | null;
    if (res.ok && json?.ok) return { ok: true, result: json.result };
    return { ok: false, error: `Telegram ${method} answered ${res.status}${json?.description ? `: ${json.description}` : ''}` };
  } catch (e) {
    return { ok: false, error: `Telegram ${method} failed: ${(e as Error).name}` };
  }
}
