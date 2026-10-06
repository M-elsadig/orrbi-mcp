import type { AvailabilityResult, BookingResult, CardsResult, ClassSlot, GymCard, GymPage, Slot } from './types.js';
import type { BookingErrorKind, FieldErrors } from './booking.js';

/* The booking flow inside one card, Google Maps style:
     search / find_classes   cards (carousel) → gym page → class → details → review → requested
     availability            times (one class) → details → review → requested
   The gym page opens fullscreen where the host allows it. Pure state (no
   DOM) so it can be tested; the controller renders whatever step is on
   top. Each step keeps what it loaded, so Back is instant and never
   refetches. */

/* What the later steps need to know about the choice so far */
export type Choice = {
  business_id: string;
  business_name: string;
  business_name_ar?: string | null;
  service_id: string;
  service_name: string;
  service_name_ar?: string | null;
  price_qar?: number;
  duration_min?: number;
  /* to say "pay at the gym" next to the price */
  pay_at_venue?: boolean;
  category?: string;
  /* the customer-facing window, said on the review step */
  cancellation_hours?: number | null;
};

export type DetailsForm = { name: string; phone: string };

export type GymStep = {
  kind: 'gym';
  card: GymCard;
  /* page missing = loading; error set = failed */
  page?: GymPage;
  error?: string;
  /* the day shown, and the time picked on it (a start ISO) */
  day?: string;
  time?: string;
  hoursOpen?: boolean;
};

export type Step =
  | { kind: 'cards'; result: CardsResult }
  | GymStep
  /* the classes that start at the time picked (one or more) */
  | { kind: 'class'; page: GymPage; start: string; options: ClassSlot[] }
  /* data missing = loading; error set = failed */
  | { kind: 'times'; choice: Choice; data?: AvailabilityResult; error?: string; selected?: string }
  | { kind: 'details'; choice: Choice; slot: Slot; form: DetailsForm; fieldErrors: FieldErrors }
  | {
      kind: 'review'; choice: Choice; slot: Slot; name: string; phone: string;
      /* made once per review screen and reused on retries: no double booking */
      requestId: string;
      error?: BookingErrorKind; retime?: boolean; busy?: boolean;
    }
  | { kind: 'booked'; booking: BookingResult; cancellation_hours?: number | null };

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

  /* Back to the first step (the carousel), e.g. when fullscreen is closed */
  home() {
    if (this.current.kind === 'booked') return;
    this.stack = [this.stack[0]];
  }

  /* A booking ends the flow: nothing behind it to go back to */
  finish(booking: BookingResult, cancellation_hours?: number | null) {
    this.stack = [{ kind: 'booked', booking, cancellation_hours }];
  }

  get depth(): number {
    return this.stack.length;
  }
}

/* A gym opened from its card; a tapped time chip comes preselected */
export function openGym(card: GymCard, start?: string): GymStep {
  return { kind: 'gym', card, day: start?.slice(0, 10), time: start };
}

/* The open slots on the gym page, by Qatar day */
export function slotsByDay(page: GymPage): Map<string, ClassSlot[]> {
  const days = new Map<string, ClassSlot[]>();
  for (const s of page.week.slots) {
    const d = s.date ?? s.start.slice(0, 10);
    days.set(d, [...(days.get(d) ?? []), s]);
  }
  return days;
}

/* The day to show: the one asked for if it has times, else the first that does */
export function shownDay(page: GymPage, wanted?: string): string | null {
  const days = slotsByDay(page);
  if (wanted && days.get(wanted)?.length) return wanted;
  return [...days.keys()].sort()[0] ?? null;
}

/* Distinct times on a day, in order; ladies-only apart from mixed */
export function timesOn(page: GymPage, day: string): { start: string; ladies_only: boolean }[] {
  const seen = new Set<string>();
  const out: { start: string; ladies_only: boolean }[] = [];
  for (const s of slotsByDay(page).get(day) ?? []) {
    const key = `${s.start}|${s.ladies_only}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ start: s.start, ladies_only: s.ladies_only });
  }
  return out;
}

/* The classes behind a picked time. A preselected time that is no longer
   open (taken, or now within the booking cutoff) gives none. */
export function classesAt(page: GymPage, start: string): ClassSlot[] {
  return page.week.slots.filter((s) => s.start === start);
}

/* A class picked on the gym page: the choice and the slot, ready to book.
   Later steps name the class in full; chips used the short name. */
export function fromClass(s: ClassSlot, cancellation_hours?: number | null): { choice: Choice; slot: Slot } {
  const start = new Date(s.start).getTime();
  return {
    choice: {
      business_id: s.business_id,
      business_name: s.business_name,
      business_name_ar: s.business_name_ar,
      service_id: s.service_id,
      service_name: s.class_full || s.class,
      service_name_ar: s.class_full_ar || s.class_ar,
      price_qar: s.price_qar,
      duration_min: s.duration_min,
      pay_at_venue: s.pay_at_venue,
      category: s.category,
      cancellation_hours
    },
    slot: {
      slot_id: s.slot_id,
      start: s.start,
      end: new Date(start + (s.duration_min ?? 60) * 60_000).toISOString(),
      start_label: s.start_label,
      ladies_only: s.ladies_only
    }
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
    duration_min: r.duration_min,
    pay_at_venue: r.pay_at_venue,
    category: r.category
  };
}
