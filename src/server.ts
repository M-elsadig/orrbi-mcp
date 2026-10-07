import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerSearchBusinesses } from './tools/searchBusinesses.js';
import { registerGetAvailability } from './tools/getAvailability.js';
import { registerCreateBooking } from './tools/createBooking.js';
import { registerFindClasses } from './tools/findClasses.js';
import { registerGetBusiness } from './tools/getBusiness.js';
import { registerWidget, type UiProfile } from './widget.js';

const INSTRUCTIONS =
  'Orrbi books services at local businesses in Qatar. Times are Qatar time (Asia/Qatar, UTC+3) and prices are in QAR. ' +
  'Answer the question first. When the user names a day or time ("tonight", "tomorrow morning", "Tuesday 6pm", "this week"), call find_classes ONCE: it returns the matching class times across all gyms, and the card lets them book by tapping one. ' +
  'To browse places or answer questions about a gym, use search_businesses (pass date / part_of_day / around_time when a day or time was named, so its card shows only those times); get_availability is for one class at one gym when the user already chose it (never loop over services or days). ' +
  'The card shows the gyms and times itself: never list the gyms, classes, times or prices again in your reply under it; answer in one short sentence. ' +
  'The user can book inside the card; otherwise confirm every detail with the user -> create_booking. ' +
  'Some services are private 1:1 appointments with a trainer the user picks: every such time is with one trainer, so always say who it is with and include the trainer in the read-back. ' +
  'Some businesses have requirements to answer before booking (e.g. a health screening): ask the user each one word for word, never answer for them or guess, ' +
  'and pass their answers to create_booking; if an answer is flagged, pass on its note (the business will call them before the session). ' +
  'Before create_booking, read back the business, service, date and time, the customer name and their Qatar mobile number, ' +
  'and only book after the user explicitly confirms. Bookings start as pending until the business confirms; ' +
  'the customer then receives a WhatsApp confirmation. ' +
  'Payment: Orrbi never takes payment and has no checkout. Orrbi only reserves the spot. When a price_label says "pay at the gym" ' +
  '(or "pay at the venue"), the customer pays that amount at the business when they arrive. Always quote prices that way, ' +
  'and never say or imply that the user pays, has paid, or can pay through Orrbi, online, or by card in the chat. ' +
  'other_services in search results are information only and cannot be booked through Orrbi. ' +
  'Ladies-only is a property of each class time, not of the class: the same class can be ladies-only in the morning and mixed in the evening. ' +
  'For ladies or women classes, pass ladies_only: true to find_classes, search_businesses and get_availability; for mixed classes pass ladies_only: false. ' +
  'Never offer a ladies-only time to someone who did not ask for ladies classes without saying it is ladies-only. ' +
  'Never say how many places are left: the business also takes bookings elsewhere, and every Orrbi booking is a request it confirms. ' +
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
  registerFindClasses(server);
  registerGetBusiness(server);
  registerCreateBooking(server);
  registerWidget(server, profile);
  return server;
}
