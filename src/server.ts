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
  'the customer then receives a WhatsApp confirmation. Pass language ("ar" or "en") matching the language the user writes in.';

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
