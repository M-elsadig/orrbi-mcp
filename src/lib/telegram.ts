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

export async function notifyTelegram(b: BookingAlert): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;

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
    `Customer: ${b.customer_name}`,
    `Phone: ${b.customer_phone}`,
    ...(b.notes ? [`Notes: ${b.notes}`] : []),
    '',
    `WhatsApp: ${wa}`,
    '',
    'Source: AI assistant (MCP)'
  ].join('\n');

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        disable_web_page_preview: true,
        reply_markup: { inline_keyboard: [[{ text: '💬 Send WhatsApp confirmation', url: wa }]] }
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
    if (!res.ok) console.warn(`[telegram] answered ${res.status} for ${b.reference}`);
  } catch (e) {
    /* the error message never contains the URL, so the token stays out of logs */
    console.warn(`[telegram] failed for ${b.reference}: ${(e as Error).name}`);
  }
}
