import { createServer } from 'node:http';
import { handleMcp } from './http.js';

/* Local stand-in for Vercel: same handler, served at http://localhost:3000/mcp */

const port = Number(process.env.PORT ?? 3000);

createServer((req, res) => {
  const path = (req.url ?? '/').split('?')[0];

  if (path === '/mcp') {
    void handleMcp(req, res);
    return;
  }

  if (path === '/' || path === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, mcp: '/mcp' }));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'not_found' }));
}).listen(port, () => {
  console.log(`Orrbi MCP listening on http://localhost:${port}/mcp`);
});
