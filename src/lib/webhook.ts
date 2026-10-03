/* Tell n8n about a new booking so it can message the business and, once they
   confirm, WhatsApp the customer. Best effort: a webhook failure is logged and
   never fails the booking, which is already committed by the time this runs.

   Awaited (with a short timeout) rather than fire-and-forget, because Vercel
   may freeze the function as soon as the response is sent. */

const TIMEOUT_MS = 3000;

export async function notifyBookingCreated(payload: Record<string, unknown>): Promise<void> {
  const url = process.env.N8N_WEBHOOK_URL;
  if (!url) return;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
    if (!res.ok) console.warn(`[webhook] n8n answered ${res.status} for booking ${payload.booking_id}`);
  } catch (e) {
    console.warn(`[webhook] failed for booking ${payload.booking_id}: ${(e as Error).message}`);
  }
}
