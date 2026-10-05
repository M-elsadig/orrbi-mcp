import type { IncomingMessage, ServerResponse } from 'node:http';
import { db } from './lib/supabase.js';
import { callTelegram } from './lib/telegram.js';
import { reportError } from './lib/errors.js';
import { TZ } from './lib/time.js';
import { type Keyboard, type Outcome, keyboardAfter, parseAction, textAfter, webhookSecret } from './lib/telegramActions.js';

/* POST /telegram: Telegram calls this when the owner taps ✅ Confirmed or
   ❌ Couldn't book on a new-booking alert (see telegramActions.ts).

   Who may act: only requests carrying our secret header (so only Telegram),
   only taps from the owner's chat (TELEGRAM_CHAT_ID), and only on bookings
   the MCP made (user_id = ORRBI_MCP_USER_ID) that are still pending.

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

  let status: string;
  try {
    status = await setOutcome(action.bookingId, action.outcome);
  } catch (e) {
    const ref = await reportError('telegram.callback', e, action);
    return void await answer(`Couldn't update the booking (error ref ${ref}). Nothing changed; try again.`, true);
  }
  if (status === 'missing') return void await answer('Booking not found.', true);

  /* messages older than 48h come back without their text; the status is
     saved anyway, only the alert can't be rewritten */
  if (msg.text) {
    const edited = await callTelegram('editMessageText', {
      chat_id: msg.chat.id,
      message_id: msg.message_id,
      text: textAfter(msg.text, status, qatarNow()),
      disable_web_page_preview: true,
      ...(keyboardAfter(msg.reply_markup, status) ? { reply_markup: keyboardAfter(msg.reply_markup, status) } : {})
    });
    if (!edited.ok) console.warn(`[telegram] edit failed for ${action.bookingId}: ${edited.error}`);
  }

  const toast =
    status === action.outcome
      ? (status === 'confirmed' ? '✅ Marked confirmed' : "❌ Marked couldn't book")
      : `Already ${status}, nothing changed.`;
  await answer(toast);
}

/* pending → outcome, atomically: the status filter makes a second tap (or a
   tap after the app changed it) a no-op. Resolves to the booking's status
   afterwards, or 'missing'. */
async function setOutcome(bookingId: string, outcome: Outcome): Promise<string> {
  const owner = process.env.ORRBI_MCP_USER_ID;
  if (!owner) throw new Error('ORRBI_MCP_USER_ID is not set');

  const upd = await db().from('bookings')
    .update({ status: outcome })
    .eq('id', bookingId).eq('user_id', owner).eq('status', 'pending')
    .select('status')
    .maybeSingle();
  if (upd.error) throw upd.error;
  if (upd.data) return upd.data.status as string;

  const cur = await db().from('bookings').select('status').eq('id', bookingId).eq('user_id', owner).maybeSingle();
  if (cur.error) throw cur.error;
  return (cur.data?.status as string | undefined) ?? 'missing';
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
