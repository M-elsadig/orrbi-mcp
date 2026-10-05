# orrbi-mcp

A remote [MCP](https://modelcontextprotocol.io) server that lets AI assistants (Claude, ChatGPT) find local businesses in Qatar, check open times and request bookings. It uses the **same Supabase database as the Orrbi app**.

- Connector URLs: `POST /mcp` for Claude, `POST /chatgpt/mcp` for ChatGPT (same server; see [Inline UI](#inline-ui-mcp-apps))
- Streamable HTTP, stateless, JSON responses
- Times in Asia/Qatar (UTC+3), prices in QAR
- No authentication in v1

## Tools

| Tool | Annotations | What it does |
|---|---|---|
| `search_businesses` | read-only, closed world | Active businesses with their active services (`service_id`, name, duration, `price_qar`). Filters: `category`, `area`, `query`, `limit` (default 5, max 10). |
| `get_availability` | read-only, closed world | Future slots with space left for one service on one Qatar date: `slot_id`, `start`, `end`, `start_label`, `spots_left`. |
| `create_booking` | write, open world, not destructive | Creates a **pending** booking. It rejects full, past or mismatched slots, then POSTs to `N8N_WEBHOOK_URL` if set. |

The tool descriptions tell the model to read back the business, service, time, name and phone, and to get the user's explicit OK before `create_booking`.

The tools never return owner phone/WhatsApp, the customer's phone, user ids or internal counters.

### Phone numbers
After spaces and dashes are stripped, `create_booking` accepts:
- `55123456`
- `97455123456`
- `+97455123456`
- `0097455123456`

Each is normalised to `+974XXXXXXXX`, the only form stored (a DB CHECK enforces it) and sent to n8n. Anything else is rejected with a message telling the user what format to use.

## Inline UI (MCP Apps)

In hosts that support [MCP Apps](https://github.com/modelcontextprotocol/ext-apps) (Claude, ChatGPT), each tool result also renders as an inline widget. The UI is extra: text-only clients get the same text answers (the 7-day preload, ids and Arabic names go to the card only, in `structuredContent`). The tool descriptions tell the model to ask which service first and call `get_availability` once, never looping over services or days.

| Tool | Widget |
|---|---|
| `search_businesses` | No photos: a compact list (initial, name, category · area, "from" price). With a photo: swipeable cards with services, prices and durations |
| `get_availability` | One booking card for the next 7 days: a day strip (empty days greyed) and that day's times grouped under Morning / Afternoon / Evening ("2 left" only when 2 or fewer remain). All 7 days come with the first result, so switching days is instant. If the requested day is empty, it opens on the next day with times and says so. Tapping a time tells the model its `slot_id` (`updateModelContext`) and sends a chat message ("I want the 7:00 PM slot on Thu 8 Oct for CrossFit class at Falcon Gym."); the model still confirms name and phone before booking |
| `create_booking` | Confirmation card: **Pending** badge, business, service, Qatar date and time, reference. Never the phone |

### Booking inside the card

When the host lets the widget call tools (`serverTools` capability; Claude and ChatGPT do), the whole flow happens in one card by taps, with a back arrow on each step:

**Places → Services → Times → Your details → Booked**

- **Services:** tapping a place shows its services (duration, price).
- **Times:** tapping a service loads the 7-day card with `app.callServerTool('get_availability')`.
- **Your details:** tapping a time shows a summary (place, service, Qatar date and time, price) and Name + Qatar mobile fields, checked with the server's own phone rules (`src/lib/phone.ts`). **Confirm booking** calls `create_booking` from the card with a `request_id` made in the card and reused on retries, so a double tap or retry can't book twice. Errors (time just taken, already booked, too many pending, bad number) show in the form; a taken time offers "Pick another time".
- **Booked:** the Pending confirmation with the reference. Then `app.updateModelContext` tells the model only what was booked (place, service, time, reference): **never the name or phone**, which go only to the server as `create_booking` arguments and are never sent as chat text.

A card the model opened with `get_availability` starts at Times (no back). If the host can't forward tool calls from the widget, the card falls back to the chat flow: tapping a time sends a chat message and the model continues. Hosts without UI get the same text answers as before.

- **Languages:** every tool takes an optional `language` ("ar" | "en"), which the model sets from the user's language; otherwise the card follows the host's locale. Arabic switches the widget to right-to-left and uses `name_ar` for businesses and services; everything else is English. Times are always Qatar time.
- **Theme:** uses the host's colour and font variables, so light and dark follow the host.
- **Mobile first:** works from 320px wide, 44px+ tap targets, respects safe-area insets, no nested vertical scrolling.
- **Photos:** the first entry of `businesses.images` (the app's cover photo), only if it is a public Supabase Storage URL on `IMAGE_HOST`. The widget's CSP allows that one host and nothing else, and the widget makes no network calls. To add a photo, upload it to a public bucket and put its public URL first in `images`.

### Why two connector URLs
Claude and ChatGPT both read the widget's `_meta.ui.domain` but expect different values, and a stateless server can't tell them apart:

| URL | Host | `ui.domain` |
|---|---|---|
| `https://orrbi-mcp.vercel.app/mcp` | Claude | `{sha256(connector URL)[0:32]}.claudemcpcontent.com` = `57dfa9b336b6975c016639ad34cf2764.claudemcpcontent.com` |
| `https://orrbi-mcp.vercel.app/chatgpt/mcp` | ChatGPT | `https://orrbi-mcp.vercel.app` |

Claude hashes the exact URL configured in Connectors (a trailing slash changes it). If you use a different URL, set `MCP_PUBLIC_URL` to it.

### Building the widget
`ui/` holds a small TypeScript app (no framework) bundled by Vite into one self-contained file, `ui/dist/widget.html`. It uses `@modelcontextprotocol/ext-apps` **1.7.5**, the last release that works with `@modelcontextprotocol/sdk` 1.x (2.x needs the v2 SDK packages).

- `npm run build:ui` builds it; `npm run dev`/`npm start` build it first.
- On Vercel, the `vercel-build` script builds it and `vercel.json` ships it with the function (`includeFiles`).

## How it fits the existing database

Existing tables are untouched. Migration `../tend-app/supabase/migrations/0004_mcp_guest_bookings.sql` adds:

- **`businesses.address`** (nullable). When it is empty, search falls back to `"{area}, Doha, Qatar"`.
- **`booking_contacts`**: the guest's name, phone and `request_id` for each MCP booking. It has RLS on, no policies and no grants, so only the service role can read it (same pattern as `booking_events`).
- **`create_guest_booking(...)`**: mirrors the app's `create_booking()`. It:
  - takes the same `FOR UPDATE` slot lock and runs the same past/full checks
  - inserts the same `pending` status with the same `ATO-XXXXXX` reference, and the existing trigger writes the audit row
  - checks duplicates per phone
  - is idempotent on `request_id`
  - allows at most 3 future pending requests per phone

  Only `service_role` can execute it.

`bookings.user_id` must reference a profile, so every MCP booking is owned by one **system user** ("Orrbi MCP"). That user is banned from signing in and has no password and an undeliverable `.invalid` email. The real customer is in `booking_contacts`.

> ⚠️ Never delete the system user. `bookings.user_id` is `ON DELETE CASCADE`, so deleting it would delete every MCP booking.

## Setup

Requires Node 20+.

```bash
npm install
cp .env.example .env     # then fill in the values below
```

| Variable | Required | |
|---|---|---|
| `SUPABASE_URL` | yes | The app's project (`https://ycbmspmgyrbgwmybauos.supabase.co`) |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | Supabase → Settings → API. Server-side only, never commit it. |
| `ORRBI_MCP_USER_ID` | yes | From `npm run create-system-user` (below) |
| `N8N_WEBHOOK_URL` | no | Receives each new booking. Failures are logged and never fail the booking. |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | no | Sends you a Telegram message for every new (non-retried) booking: reference, business, service, Qatar time, customer name and phone. 3s timeout; failures are logged and never fail the booking. |
| `ALLOWED_ORIGINS` | no | Comma-separated browser origins. Default: claude.ai, claude.com, chatgpt.com, chat.openai.com, and the Inspector on localhost:6274. Requests with **no** Origin header (server-to-server connectors) are always allowed; a disallowed Origin gets 403. |

### 1. Migration
`0004_mcp_guest_bookings` is already applied to the project. To apply it elsewhere, run the file from `../tend-app/supabase/migrations/` (SQL editor or `supabase db push`).

### 2. System user (once)
```bash
npm run create-system-user
# → ORRBI_MCP_USER_ID=xxxxxxxx-...   paste into .env (and into Vercel later)
```
It is safe to run again: it finds the existing user instead of creating a second one.

### 3. Test data (optional)
If there are no future slots, `get_availability` returns nothing. This creates hourly slots from 09:00 to 21:00 Qatar time for the next 7 days for every active service, with 5 places each. It skips slots that already exist. Run it in the Supabase SQL editor:

```sql
insert into public.availability (business_id, service_id, starts_at, capacity)
select s.business_id, s.id, (d::date + make_time(h, 0, 0)) at time zone 'Asia/Qatar', 5
  from public.services s
  join public.businesses b on b.id = s.business_id and b.is_active
 cross join generate_series((now() at time zone 'Asia/Qatar')::date,
                            (now() at time zone 'Asia/Qatar')::date + 6,
                            interval '1 day') as d
 cross join generate_series(9, 21) as h
 where s.is_active
   and (d::date + make_time(h, 0, 0)) at time zone 'Asia/Qatar' > now()
on conflict (business_id, service_id, starts_at) do nothing;
```

## Run locally

```bash
npm run dev        # http://localhost:3000/mcp  (health: /health)
npm test           # phone normalisation tests
npm run build      # typecheck
```

Quick check:
```bash
curl -s http://localhost:3000/mcp \
  -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

## Test with MCP Inspector

```bash
npm run inspector          # = npx @modelcontextprotocol/inspector
```
1. In the Inspector UI (http://localhost:6274), set **Transport Type** to *Streamable HTTP* and **URL** to `http://localhost:3000/mcp`, then click **Connect**.
2. **Tools → List Tools.** All three should appear with titles and annotations.
3. Run `search_businesses` with `{}` and copy a `business_id` and `service_id`.
4. Run `get_availability` for tomorrow's date and copy a `slot_id`.
5. Run `create_booking` with your test name, a Qatar number (e.g. `55123456`) and a `request_id`. You should get `status: "pending"` and a reference.
6. Run the same call again with the same `request_id`. You get the same booking back and no second place is taken.

Check the result in SQL: the booking is `pending`, `availability.booked_count` went up by 1, and rows exist in `booking_events` and `booking_contacts`.

To clean up test bookings:
```sql
-- frees the places, then removes the test rows (contacts cascade)
update public.availability a set booked_count = greatest(a.booked_count - x.n, 0)
  from (select b.availability_id, count(*) as n
          from public.bookings b join public.booking_contacts c on c.booking_id = b.id
         where c.customer_name = 'YOUR TEST NAME' and b.status in ('pending', 'confirmed')
         group by b.availability_id) x
 where a.id = x.availability_id;
delete from public.booking_events e using public.booking_contacts c
 where e.booking_id = c.booking_id and c.customer_name = 'YOUR TEST NAME';
delete from public.bookings b using public.booking_contacts c
 where b.id = c.booking_id and c.customer_name = 'YOUR TEST NAME';
```

## Deploy to Vercel

```bash
npm i -g vercel
vercel login
vercel link                       # create/link the project
vercel env add SUPABASE_URL production
vercel env add SUPABASE_SERVICE_ROLE_KEY production
vercel env add ORRBI_MCP_USER_ID production
vercel env add N8N_WEBHOOK_URL production      # optional
vercel env add TELEGRAM_BOT_TOKEN production   # booking alerts + error pings
vercel env add TELEGRAM_CHAT_ID production
vercel --prod
```
Your server is at **`https://<project>.vercel.app/mcp`**. `vercel.json` declares `api/mcp.ts` as the only function (an explicit `@vercel/node` build, so Vercel's zero-config detection doesn't treat `src/` files as entrypoints) and routes `/mcp` to it. Vercel will log that Project Settings build options don't apply; that is expected.

Smoke test:
```bash
curl -s https://<project>.vercel.app/mcp -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
# Origin check → 403:
curl -s -o /dev/null -w "%{http_code}\n" https://<project>.vercel.app/mcp -H "Origin: https://evil.example" \
  -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

## Telegram alert buttons

Each new-booking alert shows the price ("100 QAR — pay at the gym"), who to call to book (`business_private.booking_contact_*`), and the cancellation windows. It has **✅ Confirmed** and **❌ Couldn't book**. Book in the business's own app, then tap one:

- ✅ sets the booking `pending → confirmed`. The alert keeps the prefilled WhatsApp confirmation (with the payment line, cancellation window and first-visit note) and gains **🚫 No-show (after class)**.
- ❌ sets `pending → failed` and gives the spot back to the slot (`booked_count - 1`). The button becomes a plain WhatsApp chat so you can contact the customer.
- 🚫 sets `confirmed → no_show`, only once the class has started (earlier taps are refused). The alert shows the customer's no-show count.

**No-shows:** customers pay at the gym, so a no-show costs the business a spot. After **2** no-shows (`NO_SHOW_LIMIT` in `src/tools/createBooking.ts`, counted per phone by `mcp_no_show_count`) the number can't book: `create_booking` politely tells them to contact the Orrbi team (with a WhatsApp link if `ORRBI_SUPPORT_WHATSAPP` is set), and you get a 🚫 Telegram ping. To unblock someone, change one of their `no_show` bookings to `completed` or `cancelled`.

Each tap is one locked transaction in `mcp_set_booking_outcome` (tend-app migration 0006). It only acts on MCP bookings in the right state; a second tap, or a booking changed in the app meanwhile, changes nothing and says so. Every change lands in `booking_events` as `admin`/`telegram`.

## Payment

Orrbi never takes payment. For a business with `pay_at_venue` (Aflete), every price reads "100 QAR — pay at the gym" in search results, availability, the card, the booking confirmation, the Telegram alert and the WhatsApp template (`src/lib/payment.ts`, shared by server and card). The server instructions tell the assistant never to say payment happens in Orrbi.

Taps reach `POST /telegram` (`src/telegramWebhook.ts`). Only Telegram can call it: the bot's webhook is registered with a secret derived from the bot token, which Telegram sends back in a header. Only taps from `TELEGRAM_CHAT_ID` count. Register the webhook once after deploying:

```bash
npm run set-telegram-webhook                 # → https://orrbi-mcp.vercel.app/telegram
npm run set-telegram-webhook -- '?remove'    # to use getUpdates again
```

## Errors

An unexpected failure answers *"Something went wrong on our side (error ref E-XXXXXX)"*. The cause is in three places:

- **Telegram:** a ⚠️ ping with the ref, the error and the tool arguments (so a failed booking can still be done by hand).
- **`public.mcp_errors`:** one row per ref, with the message, Postgres code, details, a short stack and the arguments (phone numbers reduced to their last 3 digits). RLS is on with no policies, so only the service role can read it.
- **Vercel function logs:** the full error, searchable by ref.

```sql
select * from mcp_errors where ref = 'E-XXXXXX';
select created_at, ref, source, message, code from mcp_errors order by created_at desc limit 20;
```

A booking whose Telegram alert could not be sent (including `TELEGRAM_* is not set`) is logged there too, as `create_booking.telegram_alert`, so a missed alert always leaves a trace. The booking itself is in `bookings` regardless.

## Add to Claude as a custom connector

1. In Claude (web or desktop), go to **Settings → Connectors → Add custom connector**. On Team/Enterprise plans an owner adds it under **Admin settings → Connectors**.
2. Name it **Orrbi**, set the URL to `https://<project>.vercel.app/mcp`, and leave OAuth empty (v1 has no auth).
3. In a chat, enable Orrbi from the tools menu and try: *"Find a gym in Al Sadd and book me a day pass tomorrow evening."* Claude should search, show times, read back the details, and only book after you confirm.

**ChatGPT:** turn on Developer mode (Settings → Apps & Connectors → Advanced), then create a connector with **`https://orrbi-mcp.vercel.app/chatgpt/mcp`** (not `/mcp`, so the widget gets the domain ChatGPT expects) and no authentication.

## Known v1 limits

- **No auth.** Anyone with the URL can create *pending* bookings. Mitigations: the business must confirm every booking, each phone can hold at most 3 future pending requests, and phones must be Qatar numbers. Add OAuth or rate limiting before wide release.
- Bookings are created as `pending`. Confirming them and sending the WhatsApp message is done by the business and your n8n flow, not by this server.
- Cancelling and rescheduling aren't exposed yet.
