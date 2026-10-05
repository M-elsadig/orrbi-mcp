import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerSearchBusinesses } from './tools/searchBusinesses.js';
import { registerGetAvailability } from './tools/getAvailability.js';
import { registerCreateBooking } from './tools/createBooking.js';
import { registerWidget, type UiProfile } from './widget.js';

const INSTRUCTIONS =
  'Orrbi books services at local businesses in Qatar. Times are Qatar time (Asia/Qatar, UTC+3) and prices are in QAR. ' +
  'Flow: search_businesses -> ask which business and service -> get_availability once for that service (its card covers 7 days; never loop over services or days) -> confirm every detail with the user -> create_booking. ' +
  'Before create_booking, read back the business, service, date and time, the customer name and their Qatar mobile number, ' +
  'and only book after the user explicitly confirms. Bookings start as pending until the business confirms; ' +
  'the customer then receives a WhatsApp confirmation. ' +
  'Payment: Orrbi never takes payment and has no checkout. Orrbi only reserves the spot. When a price_label says "pay at the gym" ' +
  '(or "pay at the venue"), the customer pays that amount at the business when they arrive. Always quote prices that way, ' +
  'and never say or imply that the user pays, has paid, or can pay through Orrbi, online, or by card in the chat. ' +
  'other_services in search results are information only and cannot be booked through Orrbi. ' +
  'For women-only or ladies-only classes, search with ladies_only: true. ' +
  'After a booking, pass on the payment line, the cancellation policy and the first-visit note from the result. ' +
  'If a booking is refused because of missed bookings, tell the user kindly to contact the Orrbi team, as the message says; do not retry. ' +
  'Pass language ("ar" or "en") matching the language the user writes in.';

/* A fresh server per request: the transport is stateless, so nothing is
   shared between calls and nothing leaks between users. */
export function buildServer(profile: UiProfile): McpServer {
  const server = new McpServer(
    { name: 'orrbi', title: 'Orrbi', version: '1.1.0' },
    { instructions: INSTRUCTIONS }
  );
  registerSearchBusinesses(server);
  registerGetAvailability(server);
  registerCreateBooking(server);
  registerWidget(server, profile);
  return server;
}
