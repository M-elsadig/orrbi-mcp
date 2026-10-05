import type { IncomingMessage, ServerResponse } from 'node:http';
import { handleTelegram } from '../src/telegramWebhook.js';

/* Vercel Node function for the Telegram bot webhook, reached at /telegram
   through vercel.json. As in api/mcp.ts, Vercel has already parsed the body. */
export default async function handler(req: IncomingMessage & { body?: unknown }, res: ServerResponse) {
  await handleTelegram(req, res, req.method === 'POST' ? req.body : undefined);
}
