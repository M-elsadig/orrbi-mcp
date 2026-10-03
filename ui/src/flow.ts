import type { AvailabilityResult, BookingResult, Business, SearchResult, Slot } from './types.js';
import type { BookingErrorKind, FieldErrors } from './booking.js';

/* The booking flow inside one card: places → services → times → details →
   booked. Pure state (no DOM) so it can be tested; the controller renders
   whatever step is on top. Each step keeps what it loaded, so Back is
   instant and never refetches. */

/* What the times and details steps need to know about the choice so far */
export type Choice = {
  business_id: string;
  business_name: string;
  business_name_ar?: string | null;
  service_id: string;
  service_name: string;
  service_name_ar?: string | null;
  price_qar?: number;
  duration_min?: number;
};

export type DetailsForm = { name: string; phone: string };

export type Step =
  | { kind: 'places'; search: SearchResult }
  | { kind: 'services'; business: Business }
  /* data missing = loading; error set = failed */
  | { kind: 'times'; choice: Choice; data?: AvailabilityResult; error?: string; selected?: string }
  | {
      kind: 'details'; choice: Choice; slot: Slot; day: string;
      /* made once per details screen and reused on retries: no double booking */
      requestId: string;
      form: DetailsForm; fieldErrors: FieldErrors;
      error?: BookingErrorKind; retime?: boolean; busy?: boolean;
    }
  | { kind: 'booked'; booking: BookingResult };

export class Flow {
  private stack: Step[];

  constructor(first: Step) {
    this.stack = [first];
  }

  get current(): Step {
    return this.stack[this.stack.length - 1];
  }

  /* Back is offered on every step except the first, and never after booking */
  get canGoBack(): boolean {
    return this.stack.length > 1 && this.current.kind !== 'booked';
  }

  push(step: Step) {
    this.stack.push(step);
  }

  back(): boolean {
    if (!this.canGoBack) return false;
    this.stack.pop();
    return true;
  }

  /* A booking ends the flow: nothing behind it to go back to */
  finish(booking: BookingResult) {
    this.stack = [{ kind: 'booked', booking }];
  }

  get depth(): number {
    return this.stack.length;
  }
}

/* The choice for a service picked from a business in the search results */
export function choiceFor(b: Business, serviceId: string): Choice | null {
  const s = b.services.find((x) => x.service_id === serviceId);
  if (!s) return null;
  return {
    business_id: b.business_id,
    business_name: b.name,
    business_name_ar: b.name_ar,
    service_id: s.service_id,
    service_name: s.name,
    service_name_ar: s.name_ar,
    price_qar: s.price_qar,
    duration_min: s.duration_min
  };
}

/* The choice behind a get_availability result the model opened */
export function choiceFromAvailability(r: AvailabilityResult): Choice | null {
  if (!r.business_id || !r.service_id) return null;
  return {
    business_id: r.business_id,
    business_name: r.business_name,
    business_name_ar: r.business_name_ar,
    service_id: r.service_id,
    service_name: r.service_name,
    service_name_ar: r.service_name_ar,
    price_qar: r.price_qar,
    duration_min: r.duration_min
  };
}
