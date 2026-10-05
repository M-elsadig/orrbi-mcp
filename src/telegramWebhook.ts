import type { IncomingMessage, ServerResponse } from 'node:http';
import { db } from './lib/supabase.js';
import { callTelegram } from './lib/telegram.js';
import { reportError } from './lib/errors.js';
import { TZ } from './lib/time.js';
import { NO_SHOW_LIMIT } from './tools/createBooking.js';
import { type Keyboard, type Outcome, keyboardAfter, parseAction, textAfter, webhookSecret } from './lib/telegramActions.js';

/* POST /telegram: Telegram calls this when the owner taps ✅ Confirmed,
   ❌ Couldn't book or 🚫 No-show on a booking alert (see telegramActions.ts).

   Who may act: only requests carrying our secret header (so only Telegram),
   only taps from the owner's chat (TELEGRAM_CHAT_ID), and only on bookings
   the MCP made (user_id = ORRBI_MCP_USER_ID) in the right state: pending for
   ✅/❌, confirmed and already started for 🚫.

   Always answers 200 once the secret checks out, or Telegram retries the
   same tap for hours. The work is done before answering, because Vercel may
   freeze the function as soon as the response is sent. */

type CallbackQuery = {
  id: string;
  data?: string;
  message?: { message_id: number; date: number; chat: { id: number }; text?: string; reply_markup?: Keyboard };
};

export async function handleTelegram(req: IncomingMessage, res: ServerResponse, parsedBody?: unknown): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (req.method !== 'POST' || !token) return end(res, 404);
  if (req.headers['x-telegram-bot-api-secret-token'] !== webhookSecret(token)) return end(res, 401);

  try {
    const update = (parsedBody ?? await readJson(req)) as { callback_query?: CallbackQuery } | null;
    const cq = update?.callback_query;
    if (cq) await onTap(cq);
  } catch (e) {
    await reportError('telegram.webhook', e);
  }
  end(res, 200);
}

async function onTap(cq: CallbackQuery): Promise<void> {
  const answer = (text: string, alert = false) =>
    callTelegram('answerCallbackQuery', { callback_query_id: cq.id, text, show_alert: alert });

  const action = parseAction(cq.data);
  const msg = cq.message;
  if (!action || !msg) return void await answer('Unknown button.');
  if (String(msg.chat.id) !== String(process.env.TELEGRAM_CHAT_ID)) return void await answer('Not allowed.', true);

  let result: OutcomeResult;
  try {
    result = await setOutcome(action.bookingId, action.outcome);
  } catch (e) {
    const code = (e as { message?: string }).message;
    if (code === 'BOOKING_NOT_FOUND') return void await answer('Booking not found.', true);
    if (code === 'TOO_EARLY') return void await answer('The class hasn\'t started yet. Mark no-shows after class time.', true);
    const ref = await reportError('telegram.callback', e, action);
    return void await answer(`Couldn't update the booking (error ref ${ref}). Nothing changed; try again.`, true);
  }
  const { status, changed, no_shows } = result;

  /* messages older than 48h come back without their text; the status is
     saved anyway, only the alert can't be rewritten */
  if (msg.text && changed) {
    const keyboard = keyboardAfter(msg.reply_markup, status, action.bookingId);
    const edited = await callTelegram('editMessageText', {
      chat_id: msg.chat.id,
      message_id: msg.message_id,
      text: textAfter(msg.text, status, qatarNow(), { count: no_shows, limit: NO_SHOW_LIMIT }),
      disable_web_page_preview: true,
      ...(keyboard ? { reply_markup: keyboard } : {})
    });
    if (!edited.ok) console.warn(`[telegram] edit failed for ${action.bookingId}: ${edited.error}`);
  }

  const toast = !changed
    ? `Already ${status.replace('_', '-')}, nothing changed.`
    : status === 'confirmed' ? '✅ Marked confirmed'
    : status === 'failed' ? "❌ Marked couldn't book, spot released"
    : no_shows >= NO_SHOW_LIMIT ? `🚫 No-show #${no_shows}: customer blocked`
    : `🚫 No-show #${no_shows}`;
  await answer(toast);
}

type OutcomeResult = { status: string; changed: boolean; no_shows: number };

/* One locked transaction in the database (mcp_set_booking_outcome): checks
   the booking is the MCP's and in the right state, releases the spot on
   'failed', logs the change as the owner's. A tap that doesn't apply (second
   tap, booking changed in the app) returns changed = false. Raises
   BOOKING_NOT_FOUND, or TOO_EARLY for a no-show before the class. */
async function setOutcome(bookingId: string, outcome: Outcome): Promise<OutcomeResult> {
  const owner = process.env.ORRBI_MCP_USER_ID;
  if (!owner) throw new Error('ORRBI_MCP_USER_ID is not set');

  const { data, error } = await db().rpc('mcp_set_booking_outcome', {
    p_booking_id: bookingId, p_owner_id: owner, p_outcome: outcome
  });
  if (error) throw error;
  const row = (data as { status: string; changed: boolean; no_shows: number }[] | null)?.[0];
  if (!row) throw new Error('mcp_set_booking_outcome returned no row');
  return { status: row.status, changed: row.changed, no_shows: Number(row.no_shows) || 0 };
}

function qatarNow(): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
  }).format(new Date());
}

function end(res: ServerResponse, status: number) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: status === 200 }));
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  let s = '';
  for await (const chunk of req) s += chunk;
  return s ? JSON.parse(s) : null;
}
