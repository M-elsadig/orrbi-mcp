import { createHash } from 'node:crypto';

/* The ✅ / ❌ buttons on a new-booking alert. The owner books by hand in the
   business's own app, then taps one: the booking goes pending → confirmed or
   pending → failed, and the alert is edited to say so.

   Pure functions only; the webhook in src/telegramWebhook.ts does the I/O. */

export type Outcome = 'confirmed' | 'failed';

type Button = { text: string; url?: string; callback_data?: string };
export type Keyboard = { inline_keyboard: Button[][] };

/* callback_data is capped at 64 bytes: "c:" + a 36-char uuid fits. */
const CODES: Record<string, Outcome> = { c: 'confirmed', f: 'failed' };

export function actionRow(bookingId: string): Button[] {
  return [
    { text: '✅ Confirmed', callback_data: `c:${bookingId}` },
    { text: "❌ Couldn't book", callback_data: `f:${bookingId}` }
  ];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseAction(data: unknown): { outcome: Outcome; bookingId: string } | null {
  if (typeof data !== 'string') return null;
  const [code, id] = data.split(':');
  const outcome = CODES[code];
  return outcome && id && UUID.test(id) ? { outcome, bookingId: id } : null;
}

/* Telegram sends this secret back in X-Telegram-Bot-Api-Secret-Token on every
   webhook call. Derived from the bot token, so there's no extra env var to
   keep in sync, and the token itself never travels in a header. */
export function webhookSecret(botToken: string): string {
  return createHash('sha256').update(`orrbi-telegram-webhook:${botToken}`).digest('hex').slice(0, 48);
}

const STATUS_LINE: Record<string, string> = {
  confirmed: '✅ CONFIRMED: booked at the business. Send the customer the WhatsApp confirmation.',
  failed: "❌ COULDN'T BOOK: contact the customer to rebook or apologise.",
  cancelled: '🚫 Already cancelled.',
  rejected: '🚫 Already declined by the business.',
  completed: '✔️ Already completed.'
};

/* The alert after a tap: the original text, its first line swapped for the
   outcome, and a status line with who/when. Telegram hands the text back
   without the buttons, so they are rebuilt by keyboardAfter. */
export function textAfter(original: string, status: string, when: string): string {
  const lines = original.split('\n');
  lines[0] = status === 'confirmed' ? '✅ Booking confirmed' : status === 'failed' ? "❌ Couldn't book" : lines[0];
  const note = STATUS_LINE[status] ?? `Status: ${status}`;
  return `${lines.join('\n')}\n\n${note}\n(${when}, Qatar time)`.slice(0, 4096);
}

/* Confirmed keeps the prefilled WhatsApp confirmation; failed swaps it for a
   plain chat with the customer (no "your booking is confirmed" text). The
   ✅/❌ row goes away either way, so a booking can't be flipped twice. */
export function keyboardAfter(original: Keyboard | undefined, status: string): Keyboard | undefined {
  const wa = original?.inline_keyboard.flat().find((b) => b.url?.startsWith('https://wa.me/'))?.url;
  if (!wa) return undefined;
  if (status === 'failed') {
    return { inline_keyboard: [[{ text: '💬 WhatsApp the customer', url: wa.split('?')[0] }]] };
  }
  return { inline_keyboard: [[{ text: '💬 Send WhatsApp confirmation', url: wa }]] };
}
