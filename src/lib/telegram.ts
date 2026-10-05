import { qatarLabelAr } from './time.js';

/* Ping the owner on Telegram when an MCP booking comes in. Best effort, like
   the n8n webhook: a Telegram failure is logged and never fails the booking.

   Plain text, no parse_mode, so a customer name with * or _ can't break the
   message or inject formatting. */

const TIMEOUT_MS = 3000;

export type BookingAlert = {
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
export function whatsappLink(b: BookingAlert): string {
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
    'Source: AI assistant (MCP)'
  ].join('\n');

  const first = await sendTelegram(text, {
    reply_markup: { inline_keyboard: [[{ text: '💬 Send WhatsApp confirmation', url: wa }]] }
  });
  if (!first || first === NOT_CONFIGURED) return first;

  /* one retry, without the button, in case the button was what Telegram
     refused; the WhatsApp link is in the text anyway */
  console.warn(`[telegram] alert for ${b.reference} failed (${first}), retrying plain`);
  const second = await sendTelegram(text);
  return second && `${first}; retry: ${second}`;
}

const NOT_CONFIGURED = 'TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID is not set';

/* Plain text to the owner's chat. Resolves to null on success, else a short
   reason. Never throws, and never puts the token (it's in the URL) in the
   reason. */
export async function sendTelegram(text: string, extra: Record<string, unknown> = {}): Promise<string | null> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return NOT_CONFIGURED;

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: text.slice(0, 4000), disable_web_page_preview: true, ...extra }),
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
    if (res.ok) return null;
    const body = await res.json().catch(() => null) as { description?: string } | null;
    return `Telegram answered ${res.status}${body?.description ? `: ${body.description}` : ''}`;
  } catch (e) {
    /* the error message never contains the URL, so the token stays out of logs */
    return `Telegram request failed: ${(e as Error).name}`;
  }
}
