import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { RESOURCE_MIME_TYPE, registerAppResource } from '@modelcontextprotocol/ext-apps/server';
import { imageHost } from './lib/images.js';

/* One UI resource for all three tools. The widget picks its view from the
   tool that opened it (search → cards, availability → time buttons,
   booking → confirmation). */

export const WIDGET_URI = 'ui://orrbi/widget.html';

/* Claude and ChatGPT both read _meta.ui.domain but want different values, and
   this server is stateless, so it cannot tell who is asking. Each host gets
   its own connector URL instead:

     /mcp          Claude   {sha256(connector URL)[0:32]}.claudemcpcontent.com
     /chatgpt/mcp  ChatGPT  the server's own origin, e.g. https://orrbi-mcp.vercel.app */
export type UiHost = 'claude' | 'chatgpt';

export type UiProfile = { host: UiHost; domain: string };

export function claudeDomain(connectorUrl: string): string {
  return createHash('sha256').update(connectorUrl).digest('hex').slice(0, 32) + '.claudemcpcontent.com';
}

/* origin: the public origin the request came in on, e.g. https://orrbi-mcp.vercel.app.
   MCP_PUBLIC_URL overrides the Claude connector URL when it differs from
   {origin}/mcp (a custom domain, a trailing slash). Claude hashes the exact
   string configured in Connectors, so it must match character for character. */
export function uiProfile(host: UiHost, origin: string): UiProfile {
  if (host === 'chatgpt') return { host, domain: origin };
  const connectorUrl = process.env.MCP_PUBLIC_URL?.trim() || `${origin}/mcp`;
  return { host, domain: claudeDomain(connectorUrl) };
}

/* Built by `npm run build:ui`; shipped to Vercel through includeFiles. */
const WIDGET_FILE = path.join(process.cwd(), 'ui', 'dist', 'widget.html');
let widgetHtml: Promise<string> | null = null;

function loadWidget(): Promise<string> {
  widgetHtml ??= readFile(WIDGET_FILE, 'utf8').catch((e) => {
    widgetHtml = null;   // let the next request try again
    throw e;
  });
  return widgetHtml;
}

export function registerWidget(server: McpServer, profile: UiProfile) {
  registerAppResource(
    server,
    'Orrbi booking',
    WIDGET_URI,
    { description: 'Business cards, open times and booking confirmations for Orrbi.' },
    async () => ({
      contents: [{
        uri: WIDGET_URI,
        mimeType: RESOURCE_MIME_TYPE,
        text: await loadWidget(),
        _meta: {
          ui: {
            /* photos from our Supabase Storage, and nothing else: no
               connectDomains, so the widget cannot make network calls */
            csp: { resourceDomains: [imageHost()] },
            domain: profile.domain,
            prefersBorder: true
          }
        }
      }]
    })
  );
}
