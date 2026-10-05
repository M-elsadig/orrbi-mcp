import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerAppTool } from '@modelcontextprotocol/ext-apps/server';
import { db } from '../lib/supabase.js';
import { fail, failUnexpected, guard, ok } from '../lib/results.js';
import { reportError } from '../lib/errors.js';
import { PHONE_MESSAGE, normalizeQatarPhone } from '../lib/phone.js';
import { qatarLabel, toQatarIso } from '../lib/time.js';
import { notifyBookingCreated } from '../lib/webhook.js';
import { notifyTelegram, sendTelegram } from '../lib/telegram.js';
import { cancellationText, paymentNote, priceText } from '../lib/payment.js';
import { WIDGET_URI } from '../widget.js';
import { languageInput } from '../lib/language.js';

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

/* After this many no-shows a number can't book through Orrbi. */
export const NO_SHOW_LIMIT = 2;

/* Polite, and says what to do. ORRBI_SUPPORT_WHATSAPP (+974...) adds a link. */
export function blockedMessage(support = process.env.ORRBI_SUPPORT_WHATSAPP): string {
  const digits = support?.replace(/\D/g, '');
  const contact = digits ? ` on WhatsApp at https://wa.me/${digits}` : '';
  return 'Sorry, this number can\'t book through Orrbi right now because of missed bookings. ' +
    `Please contact the Orrbi team${contact} and we'll sort it out. ` +
    'Tell the user this kindly; do not retry the booking.';
}

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
  registerAppTool(
    server,
    'create_booking',
    {
      title: 'Request a booking',
      description:
        'Request a booking for one slot at a business in Qatar. The booking is created as pending: the business still has to confirm it, ' +
        'and the customer then gets a WhatsApp confirmation. Orrbi never takes payment: when the result has a payment line, ' +
        'the customer pays at the business; say so, and never say they paid or will pay through Orrbi. ' +
        'BEFORE calling this tool you MUST read back to the user, and get their explicit "yes" to, all of: ' +
        'the business name, the service, the date and time (Qatar time, from get_availability start_label), the price as price_label gives it, ' +
        'the customer\'s name, and their Qatar mobile number. Never call it on a guess or without that confirmation. ' +
        'Use business_id/service_id from search_businesses and slot_id from get_availability; never invent ids. ' +
        'Generate a request_id (e.g. a UUID) for each new booking and send the same request_id if you retry, so the booking is not made twice. ' +
        'If the slot is full, call get_availability again and offer other times. ' +
        'After booking, pass on the payment line, the cancellation policy and the first-visit note from the result. ' +
        'If the card already reported a booking through model context, it is done: do not call this again for it.',
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
          .describe('Idempotency key. Generate one per new booking and reuse it on retries.'),
        language: languageInput
      },
      outputSchema: {
        booking_id: z.string(),
        reference: z.string(),
        status: z.string(),
        business_name: z.string(),
        business_name_ar: z.string().nullable().optional(),
        service_name: z.string(),
        service_name_ar: z.string().nullable().optional(),
        start: z.string(),
        start_label: z.string(),
        price_label: z.string().optional(),
        payment: z.string().optional(),
        cancellation_policy: z.string().optional(),
        first_visit: z.string().optional(),
        price_qar: z.number().nullable().optional(),
        pay_at_venue: z.boolean().optional(),
        category: z.string().nullable().optional(),
        first_visit_ar: z.string().nullable().optional(),
        message: z.string()
      },
      annotations: {
        title: 'Request a booking',
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true
      },
      _meta: { ui: { resourceUri: WIDGET_URI } }
    },
    async (args) => guard('create_booking', async () => {
      const phone = normalizeQatarPhone(args.customer_phone);
      if (!phone) return fail(PHONE_MESSAGE);

      /* the owner's Telegram ping carries the full arguments, phone included,
         so a booking that fails unexpectedly still reaches them */
      const unexpected = (where: string, e: unknown) => failUnexpected(where, e, args);

      const owner = process.env.ORRBI_MCP_USER_ID;
      if (!owner) return unexpected('create_booking.config', new Error('ORRBI_MCP_USER_ID is not set'));

      /* what the checks, the confirmation and the alert need. Best effort:
         if it fails the booking still goes ahead, with plainer wording */
      const ctx = await bookingContext(args.business_id, args.service_id);
      if (ctx.bookable === false) {
        return fail(`${ctx.service_name ?? 'That service'} can't be booked through Orrbi yet. ` +
          'Tell the user to arrange it with the business directly, or offer one of its classes instead.');
      }

      /* customers pay at the gym, so a no-show costs the business a spot:
         after NO_SHOW_LIMIT of them the number can't book any more */
      const noShows = await noShowCount(phone);
      if (noShows >= NO_SHOW_LIMIT) {
        await sendTelegram([
          '🚫 Blocked booking attempt (no-shows)',
          '',
          `Customer: ${args.customer_name}`,
          `Phone: ${phone}`,
          `No-shows: ${noShows}`,
          `Wanted: ${ctx.service_name ?? args.service_id} at ${ctx.business_name ?? args.business_id}`
        ].join('\n'));
        return fail(blockedMessage());
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
        return unexpected('create_booking.rpc', res.error);
      }

      const row = (res.data as Booked[] | null)?.[0];
      if (!row) return unexpected('create_booking.rpc', new Error('create_guest_booking returned no row'));

      const start = toQatarIso(row.starts_at);
      const startLabel = qatarLabel(row.starts_at);
      const pay = ctx.price == null ? null : { price_qar: ctx.price, pay_at_venue: ctx.pay_at_venue, category: ctx.category };
      const priceLabel = pay ? priceText(pay) : null;

      /* a retried request_id already notified everyone the first time.
         Neither notification can throw. */
      if (!row.deduped) {
        const [, alertFailed] = await Promise.all([
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
            price_qar: ctx.price,
            price_label: priceLabel,
            pay_at_venue: ctx.pay_at_venue,
            slot_id: args.slot_id,
            start,
            start_label: startLabel,
            customer_name: args.customer_name,
            customer_phone: phone,
            notes: args.notes || null
          }),
          notifyTelegram({
            booking_id: row.booking_id,
            reference: row.reference,
            business_name: row.business_name,
            service_name: row.service_name,
            price_qar: ctx.price,
            pay_at_venue: ctx.pay_at_venue,
            category: ctx.category,
            starts_at: row.starts_at,
            start_label: startLabel,
            customer_name: args.customer_name,
            customer_phone: phone,
            notes: args.notes || null,
            cancellation_hours: ctx.cancellation_hours,
            venue_cancellation_hours: ctx.venue_cancellation_hours,
            first_visit_note_ar: ctx.first_visit_note_ar,
            booking_contact: ctx.booking_contact
          })
        ]);

        /* the booking is saved either way; this makes sure a missed alert
           still shows up in mcp_errors. No ping: Telegram is what failed. */
        if (alertFailed) {
          await reportError('create_booking.telegram_alert', new Error(alertFailed),
            { reference: row.reference, booking_id: row.booking_id, business_name: row.business_name }, { ping: false });
        }
      }

      const payment = pay ? paymentNote(pay) : null;
      const cancellation = cancellationText(ctx.cancellation_hours);

      const answer = {
        booking_id: row.booking_id,
        reference: row.reference,
        status: row.status,
        business_name: row.business_name,
        service_name: row.service_name,
        start,
        start_label: startLabel,
        ...(priceLabel ? { price_label: priceLabel } : {}),
        ...(payment ? { payment } : {}),
        ...(cancellation ? { cancellation_policy: cancellation } : {}),
        ...(ctx.first_visit_note_en ? { first_visit: ctx.first_visit_note_en } : {}),
        message: [
          `Your booking request for ${row.service_name} at ${row.business_name} on ${startLabel} (Qatar time) has been sent and is pending.`,
          `You'll get a WhatsApp confirmation once ${row.business_name} confirms it.`,
          payment,
          cancellation,
          ctx.first_visit_note_en ? `First visit: ${ctx.first_visit_note_en}` : null,
          `Reference: ${row.reference}.`
        ].filter(Boolean).join(' ')
      };

      /* the card also gets Arabic text and what it needs to label the price;
         the phone is in neither */
      return ok({
        ...answer,
        business_name_ar: ctx.business_name_ar,
        service_name_ar: ctx.service_name_ar,
        price_qar: ctx.price,
        pay_at_venue: ctx.pay_at_venue,
        category: ctx.category,
        first_visit_ar: ctx.first_visit_note_ar
      }, answer);
    }, args)
  );
}

/* Best effort: a failed lookup must not stop a booking. */
async function noShowCount(phone: string): Promise<number> {
  try {
    const { data, error } = await db().rpc('mcp_no_show_count', { p_customer_phone: phone })
      .abortSignal(AbortSignal.timeout(2000));
    if (error) throw error;
    return Number(data) || 0;
  } catch (e) {
    await reportError('create_booking.no_show_check', e, {}, { ping: false });
    return 0;
  }
}

type BookingContext = {
  bookable: boolean | null;
  business_name: string | null;
  business_name_ar: string | null;
  service_name: string | null;
  service_name_ar: string | null;
  category: string | null;
  price: number | null;
  pay_at_venue: boolean;
  cancellation_hours: number | null;
  venue_cancellation_hours: number | null;
  first_visit_note_en: string | null;
  first_visit_note_ar: string | null;
  booking_contact: { name: string | null; phone: string } | null;
};

/* Everything about the business and service the booking needs beyond what
   create_guest_booking returns. The booking contact comes from
   business_private, which only the service role can read: it goes to the
   owner's Telegram alert, never to the customer. */
async function bookingContext(businessId: string, serviceId: string): Promise<BookingContext> {
  try {
    const signal = AbortSignal.timeout(2000);
    const [b, s, p] = await Promise.all([
      db().from('businesses')
        .select('name_en,name_ar,category,pay_at_venue,cancellation_hours,venue_cancellation_hours,first_visit_note_en,first_visit_note_ar')
        .eq('id', businessId).abortSignal(signal).maybeSingle(),
      db().from('services').select('name_en,name_ar,price,bookable').eq('id', serviceId).abortSignal(signal).maybeSingle(),
      db().from('business_private').select('booking_contact_name,booking_contact_phone')
        .eq('business_id', businessId).abortSignal(signal).maybeSingle()
    ]);
    const price = s.data?.price;
    return {
      bookable: s.data ? Boolean(s.data.bookable) : null,
      business_name: b.data?.name_en ?? null,
      business_name_ar: b.data?.name_ar || null,
      service_name: s.data?.name_en ?? null,
      service_name_ar: s.data?.name_ar || null,
      category: b.data?.category ?? null,
      price: price == null || price === '' ? null : Number(price),
      pay_at_venue: Boolean(b.data?.pay_at_venue),
      cancellation_hours: b.data?.cancellation_hours ?? null,
      venue_cancellation_hours: b.data?.venue_cancellation_hours ?? null,
      first_visit_note_en: b.data?.first_visit_note_en || null,
      first_visit_note_ar: b.data?.first_visit_note_ar || null,
      booking_contact: p.data?.booking_contact_phone
        ? { name: p.data.booking_contact_name ?? null, phone: p.data.booking_contact_phone }
        : null
    };
  } catch {
    return {
      bookable: null, business_name: null, business_name_ar: null, service_name: null, service_name_ar: null,
      category: null, price: null, pay_at_venue: false, cancellation_hours: null, venue_cancellation_hours: null,
      first_visit_note_en: null, first_visit_note_ar: null, booking_contact: null
    };
  }
}
