/* Origin validation (MCP Streamable HTTP spec: servers MUST validate Origin
   to stop DNS-rebinding and drive-by browser calls).

   - No Origin header: allowed. Claude's and ChatGPT's connector backends call
     server-to-server and send none.
   - Origin present: must be on the allowlist, else 403. */

const DEFAULT_ALLOWED = [
  'https://claude.ai',
  'https://claude.com',
  'https://chatgpt.com',
  'https://chat.openai.com',
  'http://localhost:6274',  // MCP Inspector
  'http://127.0.0.1:6274'
];

function allowed(): string[] {
  const env = process.env.ALLOWED_ORIGINS;
  const list = env ? env.split(',') : DEFAULT_ALLOWED;
  return list.map(normalize).filter(Boolean);
}

const normalize = (o: string) => o.trim().replace(/\/+$/, '').toLowerCase();

export function isOriginAllowed(origin: string | undefined): boolean {
  if (!origin) return true;
  return allowed().includes(normalize(origin));
}
