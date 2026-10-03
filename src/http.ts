import type { IncomingMessage, ServerResponse } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { buildServer } from './server.js';
import { isOriginAllowed } from './lib/origin.js';
import { uiProfile, type UiHost } from './widget.js';

/* The one /mcp handler, shared by the Vercel function and the local dev
   server. Stateless Streamable HTTP: POST only, JSON responses, no sessions. */

function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
}

const rpcError = (code: number, message: string) => ({ jsonrpc: '2.0', error: { code, message }, id: null });

function cors(origin: string | undefined): Record<string, string> {
  if (!origin) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Accept, Authorization, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-Id',
    'Access-Control-Expose-Headers': 'Mcp-Session-Id',
    Vary: 'Origin'
  };
}

/* Which host this connector URL is for. /chatgpt/mcp is ChatGPT's URL; on
   Vercel the route also tags it with ?ui=chatgpt, in case the function sees
   the rewritten path rather than the original one. Everything else is Claude. */
function hostFor(req: IncomingMessage): UiHost {
  const url = new URL(req.url ?? '/', 'http://local');
  return url.pathname.startsWith('/chatgpt') || url.searchParams.get('ui') === 'chatgpt' ? 'chatgpt' : 'claude';
}

const first = (h: string | string[] | undefined) => (Array.isArray(h) ? h[0] : h)?.split(',')[0]?.trim();

/* The public origin the request arrived on, e.g. https://orrbi-mcp.vercel.app */
function publicOrigin(req: IncomingMessage): string {
  const host = first(req.headers['x-forwarded-host']) || first(req.headers.host) || 'localhost';
  const local = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);
  const proto = first(req.headers['x-forwarded-proto']) || (local ? 'http' : 'https');
  return `${proto}://${host}`;
}

export async function handleMcp(req: IncomingMessage, res: ServerResponse, parsedBody?: unknown): Promise<void> {
  const origin = req.headers.origin;

  if (!isOriginAllowed(origin)) {
    return sendJson(res, 403, rpcError(-32000, 'Forbidden: this Origin is not allowed.'));
  }

  const corsHeaders = cors(origin);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders);
    res.end();
    return;
  }

  if (req.method !== 'POST') {
    return sendJson(res, 405, rpcError(-32000, 'Method not allowed. This MCP server is stateless: send JSON-RPC with POST /mcp.'),
      { ...corsHeaders, Allow: 'POST, OPTIONS' });
  }

  for (const [k, v] of Object.entries(corsHeaders)) res.setHeader(k, v);

  const server = buildServer(uiProfile(hostFor(req), publicOrigin(req)));
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true
  });

  res.on('close', () => {
    void transport.close();
    void server.close();
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, parsedBody);
  } catch (e) {
    console.error('[mcp] request failed', e);
    if (!res.headersSent) sendJson(res, 500, rpcError(-32603, 'Internal server error'));
  }
}
