import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { db } from '../lib/supabase.js';
import { GENERIC_ERROR, fail, guard, ok } from '../lib/results.js';
import { PHONE_MESSAGE, normalizeQatarPhone } from '../lib/phone.js';
import { qatarLabel, toQatarIso } from '../lib/time.js';
import { notifyBookingCreated } from '../lib/webhook.js';
import { notifyTelegram } from '../lib/telegram.js';

/* create_guest_booking raises these by name (0004_mcp_guest_bookings.sql).
   Each becomes a sentence the model can pass straight to the user. None of
   them repeats the customer's phone number. */
const DB_ERRORS: Record<string, string> = {
  SERVICE_NOT_FOUND:
    'That service is not offered by this business, or is no longer available. Use search_businesses to see current services.',
  SLOT_NOT_FOUND:
    'That time slot does not exist. Call get_availability again and offer the user one of the current times.',
  SLOT_MISMATCH:
    'That slot belongs to a different business or service. Call get_availability for this business and service and use one of its slot_ids.',
  SLOT_IN_PAST:
    'That time has already passed. Call get_availability and offer the user a later time.',
  SLOT_FULL:
    'Sorry, that time is now fully booked. Call get_availability again and offer the user another time.',
  DUPLICATE_BOOKING:
    'This phone number already has a booking for that exact time, so nothing new was booked.',
  TOO_MANY_PENDING:
    'This phone number already has 3 booking requests waiting for confirmation. Please wait until the businesses confirm those before booking more.',
  REQUEST_ID_REUSED:
    'This request_id was already used for a different booking. Use a new request_id for a new booking.'
};

type Booked = {
  booking_id: string;
  reference: string;
  status: string;
  starts_at: string;
  business_name: string;
  service_name: string;
  deduped: boolean;
};

export function registerCreateBooking(server: McpServer) {
  server.registerTool(
    'create_booking',
    {
      title: 'Request a booking',
      description:
        'Request a booking for one slot at a business in Qatar. The booking is created as pending: the business still has to confirm it, ' +
        'and the customer then gets a WhatsApp confirmation. ' +
        'BEFORE calling this tool you MUST read back to the user, and get their explicit "yes" to, all of: ' +
        'the business name, the service, the date and time (Qatar time, from get_availability start_label), ' +
        'the customer\'s name, and their Qatar mobile number. Never call it on a guess or without that confirmation. ' +
        'Use business_id/service_id from search_businesses and slot_id from get_availability; never invent ids. ' +
        'Generate a request_id (e.g. a UUID) for each new booking and send the same request_id if you retry, so the booking is not made twice. ' +
        'If the slot is full, call get_availability again and offer other times.',
      inputSchema: {
        business_id: z.uuid('business_id must be the id returned by search_businesses')
          .describe('business_id from search_businesses.'),
        service_id: z.uuid('service_id must be the id returned by search_businesses')
          .describe('service_id from search_businesses.'),
        slot_id: z.uuid('slot_id must be the id returned by get_availability')
          .describe('slot_id from get_availability.'),
        customer_name: z.string().trim()
          .min(1, 'customer_name is required')
          .max(100, 'customer_name must be 100 characters or fewer')
          .describe('Full name of the person the booking is for, as confirmed by the user.'),
        customer_phone: z.string().max(30, PHONE_MESSAGE)
          .describe('Qatar mobile number, as confirmed by the user: 8 digits (55123456), or with +974, 974 or 00974 in front. Used for the WhatsApp confirmation.'),
        notes: z.string().trim().max(500, 'notes must be 500 characters or fewer').optional()
          .describe('Optional note for the business, e.g. "first visit".'),
        request_id: z.string().trim().min(1).max(100, 'request_id must be 100 characters or fewer').optional()
          .describe('Idempotency key. Generate one per new booking and reuse it on retries.')
      },
      outputSchema: {
        booking_id: z.string(),
        reference: z.string(),
        status: z.string(),
        business_name: z.string(),
        service_name: z.string(),
        start: z.string(),
        start_label: z.string(),
        message: z.string()
      },
      annotations: {
        title: 'Request a booking',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true
      }
    },
    async (args) => guard('create_booking', async () => {
      const phone = normalizeQatarPhone(args.customer_phone);
      if (!phone) return fail(PHONE_MESSAGE);

      const owner = process.env.ORRBI_MCP_USER_ID;
      if (!owner) {
        console.error('[create_booking] ORRBI_MCP_USER_ID is not set');
        return fail('Booking is temporarily unavailable. Please try again later.');
      }

      const params = {
        p_owner_id: owner,
        p_business_id: args.business_id,
        p_service_id: args.service_id,
        p_availability_id: args.slot_id,
        p_customer_name: args.customer_name,
        p_customer_phone: phone,
        p_notes: args.notes || null,
        p_request_id: args.request_id || null
      };

      let res = await db().rpc('create_guest_booking', params);

      /* two calls racing on the same request_id: the loser hits the unique
         index and rolls back. Asking again returns the winner's booking. */
      if (res.error?.code === '23505' && params.p_request_id) {
        res = await db().rpc('create_guest_booking', params);
      }

      if (res.error) {
        const known = DB_ERRORS[res.error.message];
        if (known) return fail(known);
        console.error('[create_booking] rpc failed', res.error.code, res.error.message);
        return fail(GENERIC_ERROR);
      }

      const row = (res.data as Booked[] | null)?.[0];
      if (!row) {
        console.error('[create_booking] rpc returned no row');
        return fail(GENERIC_ERROR);
      }

      const start = toQatarIso(row.starts_at);
      const startLabel = qatarLabel(row.starts_at);

      /* a retried request_id already notified everyone the first time.
         Both run side by side, each capped at 3s, and neither can throw. */
      if (!row.deduped) {
        await Promise.all([
          notifyBookingCreated({
            event: 'booking.created',
            source: 'mcp',
            booking_id: row.booking_id,
            reference: row.reference,
            status: row.status,
            business_id: args.business_id,
            business_name: row.business_name,
            service_id: args.service_id,
            service_name: row.service_name,
            slot_id: args.slot_id,
            start,
            start_label: startLabel,
            customer_name: args.customer_name,
            customer_phone: phone,
            notes: args.notes || null
          }),
          notifyTelegram({
            reference: row.reference,
            business_name: row.business_name,
            service_name: row.service_name,
            starts_at: row.starts_at,
            start_label: startLabel,
            customer_name: args.customer_name,
            customer_phone: phone,
            notes: args.notes || null
          })
        ]);
      }

      return ok({
        booking_id: row.booking_id,
        reference: row.reference,
        status: row.status,
        business_name: row.business_name,
        service_name: row.service_name,
        start,
        start_label: startLabel,
        message:
          `Your booking request for ${row.service_name} at ${row.business_name} on ${startLabel} (Qatar time) has been sent ` +
          `and is pending. You'll get a WhatsApp confirmation once ${row.business_name} confirms it. Reference: ${row.reference}.`
      });
    })
  );
}
