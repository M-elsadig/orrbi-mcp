import { createHash } from 'node:crypto';

/* The buttons on a new-booking alert. The owner books by hand in the
   business's own app, then taps ✅ or ❌: the booking goes pending →
   confirmed or pending → failed, and the alert is edited to say so. A
   confirmed alert then offers 🚫 No-show, which only works once the class
   has started (confirmed → no_show); enough no-shows block the number.

   Pure functions only; the webhook in src/telegramWebhook.ts does the I/O
   and mcp_set_booking_outcome (tend-app 0006) does the database side. */

export type Outcome = 'confirmed' | 'failed' | 'no_show';

type Button = { text: string; url?: string; callback_data?: string };
export type Keyboard = { inline_keyboard: Button[][] };

/* callback_data is capped at 64 bytes: "c:" + a 36-char uuid fits. */
const CODES: Record<string, Outcome> = { c: 'confirmed', f: 'failed', n: 'no_show' };

export function actionRow(bookingId: string): Button[] {
  return [
    { text: '✅ Confirmed', callback_data: `c:${bookingId}` },
    { text: "❌ Couldn't book", callback_data: `f:${bookingId}` }
  ];
}

export function noShowRow(bookingId: string): Button[] {
  return [{ text: '🚫 No-show (after class)', callback_data: `n:${bookingId}` }];
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

const HEADLINE: Record<string, string> = {
  confirmed: '✅ Booking confirmed',
  failed: "❌ Couldn't book",
  no_show: '🚫 No-show'
};

const STATUS_LINE: Record<string, string> = {
  confirmed: '✅ CONFIRMED: booked at the business. Send the customer the WhatsApp confirmation. After class, tap 🚫 if they didn\'t come.',
  failed: "❌ COULDN'T BOOK: contact the customer to rebook or apologise.",
  cancelled: '🚫 Already cancelled.',
  rejected: '🚫 Already declined by the business.',
  completed: '✔️ Already completed.'
};

/* The alert after a tap: the original text, its first line swapped for the
   outcome, and a status line with when. Telegram hands the text back without
   the buttons, so they are rebuilt by keyboardAfter. */
export function textAfter(original: string, status: string, when: string, noShows?: { count: number; limit: number }): string {
  const lines = original.split('\n');
  lines[0] = HEADLINE[status] ?? lines[0];
  let note = STATUS_LINE[status] ?? `Status: ${status}`;
  if (status === 'no_show') {
    const n = noShows?.count ?? 1;
    note = `🚫 NO-SHOW: this customer now has ${n} no-show${n === 1 ? '' : 's'}.`;
    if (noShows && n >= noShows.limit) note += ' They are now blocked from booking through Orrbi.';
  }
  return `${lines.join('\n')}\n\n${note}\n(${when}, Qatar time)`.slice(0, 4096);
}

/* After a tap:
   confirmed → the prefilled WhatsApp confirmation, and 🚫 No-show
   failed / no_show → a plain chat with the customer (no "confirmed" text)
   anything else → the WhatsApp confirmation as it was
   The ✅/❌ row goes away either way, so a booking can't be flipped twice. */
export function keyboardAfter(original: Keyboard | undefined, status: string, bookingId: string): Keyboard | undefined {
  const wa = original?.inline_keyboard.flat().find((b) => b.url?.startsWith('https://wa.me/'))?.url;
  const rows: Button[][] = [];
  if (status === 'failed' || status === 'no_show') {
    if (wa) rows.push([{ text: '💬 WhatsApp the customer', url: wa.split('?')[0] }]);
  } else {
    if (wa) rows.push([{ text: '💬 Send WhatsApp confirmation', url: wa }]);
    if (status === 'confirmed') rows.push(noShowRow(bookingId));
  }
  return rows.length ? { inline_keyboard: rows } : undefined;
}
