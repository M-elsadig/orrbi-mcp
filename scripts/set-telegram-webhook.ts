import { webhookSecret } from '../src/lib/telegramActions.js';

/* Point the bot's button taps at the deployed /telegram endpoint. Run once
   after deploying (and again if the bot token or the domain changes):

     npm run set-telegram-webhook                       # https://orrbi-mcp.vercel.app
     npm run set-telegram-webhook -- https://my.domain

   While a webhook is set, getUpdates (used once to find the chat id) stops
   working; delete the webhook with ?remove to use it again. */

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) throw new Error('TELEGRAM_BOT_TOKEN must be set in .env');

const arg = process.argv[2] ?? 'https://orrbi-mcp.vercel.app';
const api = (method: string, body: unknown) =>
  fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  }).then((r) => r.json());

if (arg === '?remove') {
  console.log(await api('deleteWebhook', {}));
} else {
  const url = `${arg.replace(/\/$/, '')}/telegram`;
  console.log(await api('setWebhook', {
    url,
    secret_token: webhookSecret(token),
    allowed_updates: ['callback_query'],
    drop_pending_updates: true
  }));
  const info = await api('getWebhookInfo', {}) as { result: { url: string } };
  console.log('webhook →', info.result.url);
}
