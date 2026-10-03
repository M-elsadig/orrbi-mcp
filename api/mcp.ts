import type { IncomingMessage, ServerResponse } from 'node:http';
import { handleMcp } from '../src/http.js';

/* Vercel Node function, reached at /mcp through the rewrite in vercel.json.
   Vercel has already parsed the JSON body, so it is passed through rather
   than read from the (consumed) stream. */
export default async function handler(req: IncomingMessage & { body?: unknown }, res: ServerResponse) {
  await handleMcp(req, res, req.method === 'POST' ? req.body : undefined);
}
