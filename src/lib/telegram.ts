import { qatarLabelAr } from './time.js';
import { actionRow } from './telegramActions.js';

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
  starts_at: string;
  start_label: string;
  customer_name: string;
  customer_phone: string;   // +974XXXXXXXX
  notes: string | null;
};

/* wa.me wants the number without +, and the text URL-encoded. The prefilled
   message is the one the owner sends once the business has confirmed. */
export function whatsappLink(b: Pick<BookingAlert, 'customer_name' | 'customer_phone' | 'business_name' | 'starts_at' | 'reference'>): string {
  const message =
    `مرحبا ${b.customer_name}، حجزك في ${b.business_name} يوم ${qatarLabelAr(b.starts_at)} ` +
    `تم تأكيده ✅ رقم الحجز: ${b.reference}`;
  return `https://wa.me/${b.customer_phone.replace(/^\+/, '')}?text=${encodeURIComponent(message)}`;
}

/* Resolves to null when the alert went out, else why it didn't, so the
   caller can log it: a booking whose alert failed must still leave a trace. */
export async function notifyTelegram(b: BookingAlert): Promise<string | null> {
  const wa = whatsappLink(b);

  /* the full link is long once the Arabic is encoded, so the text carries
     the short form and the button carries the prefilled message */
  const text = [
    '🆕 New booking request (pending)',
    '',
    `Ref: ${b.reference}`,
    `Business: ${b.business_name}`,
    `Service: ${b.service_name}`,
    `When: ${b.start_label} (Qatar time)`,
    `Price: ${b.price_qar == null ? 'unknown' : `${b.price_qar} QAR`}`,
    `Customer: ${b.customer_name}`,
    `Phone: ${b.customer_phone}`,
    ...(b.notes ? [`Notes: ${b.notes}`] : []),
    '',
    `WhatsApp: ${wa}`,
    '',
    'Source: AI assistant (MCP)',
    'Book it in the business app, then tap ✅ or ❌.'
  ].join('\n');

  const first = await sendTelegram(text, {
    reply_markup: { inline_keyboard: [[{ text: '💬 Send WhatsApp confirmation', url: wa }], actionRow(b.booking_id)] }
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
