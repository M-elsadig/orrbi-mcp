import { randomBytes } from 'node:crypto';
import { db } from './supabase.js';
import { sendTelegram } from './telegram.js';

/* Every "Something went wrong on our side" gets a short ref. The user sees
   the ref, and the cause lands in three places: the public.mcp_errors table
   (durable, searchable by ref), a Telegram ping to the owner (immediate),
   and the Vercel function log (the full stack).

   The table never holds a full phone number: context is passed through
   redact(). The Telegram ping gets the context as is, so a booking that
   failed can still be done by hand; that private chat already receives
   full phones in every booking alert.

   Look one up:  select * from mcp_errors where ref = 'E-7K2QX9';
   Recent ones:  select created_at, ref, source, message, code from mcp_errors order by created_at desc limit 20; */

const TIMEOUT_MS = 2000;
const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';   // no 0/O or 1/I to misread

export function newRef(): string {
  return 'E-' + Array.from(randomBytes(6), (b) => ALPHABET[b % ALPHABET.length]).join('');
}

type Described = { message: string; code: string | null; detail: Record<string, unknown> };

/* Errors here are Error objects, PostgREST errors ({ message, code, details,
   hint }), or whatever else was thrown. Keep what helps find the cause. */
export function describe(e: unknown): Described {
  if (e && typeof e === 'object') {
    const o = e as Record<string, unknown>;
    const detail: Record<string, unknown> = {};
    for (const k of ['name', 'details', 'hint', 'status', 'cause']) {
      if (o[k] != null) detail[k] = k === 'cause' ? String(o[k]) : o[k];
    }
    if (typeof o.stack === 'string') detail.stack = o.stack.split('\n').slice(0, 8).join('\n');
    return {
      message: typeof o.message === 'string' ? o.message : JSON.stringify(o).slice(0, 500),
      code: o.code != null ? String(o.code) : null,
      detail
    };
  }
  return { message: String(e), code: null, detail: {} };
}

/* Phone numbers become their last 3 digits; everything else is kept, since
   ids, dates and names are what make an error reproducible. */
export function redact(context: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(context)) {
    if (v === undefined) continue;
    out[k] = /phone/i.test(k) && typeof v === 'string' ? `…${v.replace(/\D/g, '').slice(-3)}` : v;
  }
  return out;
}

/* Record an error and ping the owner. Resolves to the ref; never throws. */
export async function reportError(
  source: string,
  error: unknown,
  context: Record<string, unknown> = {},
  { ping = true }: { ping?: boolean } = {}
): Promise<string> {
  const ref = newRef();
  const d = describe(error);
  const ctx = redact(context);

  console.error(`[${source}] ${ref}`, error, ctx);

  const [saved] = await Promise.all([
    save({ ref, source, message: d.message, code: d.code, detail: d.detail, context: ctx }),
    ping
      ? sendTelegram([
          `⚠️ Orrbi MCP error ${ref}`,
          `Where: ${source}`,
          `Error: ${d.message}${d.code ? ` (code ${d.code})` : ''}`,
          ...(Object.keys(context).length ? ['', JSON.stringify(context, null, 1).slice(0, 1500)] : [])
        ].join('\n'))
      : null
  ]);
  if (saved) console.error(`[errors] could not save ${ref}: ${saved}`);
  return ref;
}

async function save(row: Record<string, unknown>): Promise<string | null> {
  try {
    const { error } = await db().from('mcp_errors').insert(row).abortSignal(AbortSignal.timeout(TIMEOUT_MS));
    return error ? error.message : null;
  } catch (e) {
    return (e as Error).message;
  }
}
