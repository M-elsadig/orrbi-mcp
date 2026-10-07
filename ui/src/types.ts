/* The structuredContent each tool returns (see src/tools/*). Only what the
   widget reads. */

export type Service = {
  service_id: string;
  name: string;
  name_ar?: string | null;
  /* "BxS Full Body": for one-line rows; name is the full one */
  short_name?: string | null;
  short_name_ar?: string | null;
  description?: string | null;
  duration_min: number;
  price_qar: number;
  pay_at_venue?: boolean;
};

/* 1:1 appointments: the trainer a slot is with (src/lib/staff.ts) */
export type Trainer = {
  id: string;
  name: string;
  gender?: 'male' | 'female' | null;
  title?: string | null;
  title_ar?: string | null;
  photo_url?: string | null;
};

export type TrainerProfile = Trainer & {
  specialties: string[];
  specialties_ar: string[];
  bio?: string | null;
  bio_ar?: string | null;
};

/* A question (yes/no) or notice (agree) to answer before booking
   (src/lib/requirements.ts). flag_answer: the answer the business must know
   about; it doesn't block, flag_note says what happens next. */
export type Requirement = {
  id: string;
  kind: 'question' | 'notice';
  text: string;
  text_ar?: string | null;
  flag_answer?: boolean;
  flag_note?: string | null;
  flag_note_ar?: string | null;
  /* get_business only: null = every service */
  service_id?: string | null;
};

export type Slot = { slot_id: string; start: string; end: string; start_label: string; ladies_only?: boolean; trainer?: Trainer };

export type Day = { date: string; slots: Slot[] };

export type AvailabilityResult = {
  business_id?: string;
  business_name: string;
  business_name_ar?: string | null;
  service_id?: string;
  service_name: string;
  service_name_ar?: string | null;
  price_qar?: number;
  pay_at_venue?: boolean;
  category?: string;
  duration_min?: number;
  /* the day shown first: requested_date, or the next one with open times */
  date: string;
  requested_date?: string;
  slots: Slot[];
  /* all 7 days from requested_date, preloaded so switching is instant */
  days?: Day[];
  requirements?: Requirement[];
  note?: string;
};

export type BookingResult = {
  booking_id: string;
  reference: string;
  status: string;
  business_name: string;
  business_name_ar?: string | null;
  service_name: string;
  service_name_ar?: string | null;
  start: string;
  start_label?: string;
  price_qar?: number | null;
  pay_at_venue?: boolean;
  category?: string | null;
  first_visit?: string;
  first_visit_ar?: string | null;
  cancellation_policy?: string;
  trainer?: string;
  /* a flagged requirement answer: what happens next (e.g. the studio calls first) */
  health_note?: string;
  health_note_ar?: string | null;
};

/* find_classes: one open class time, across gyms (src/lib/classes.ts) */
export type ClassSlot = {
  slot_id: string;
  business_id: string;
  business_name: string;
  business_name_ar?: string | null;
  area: string;
  service_id: string;
  class: string;
  class_ar?: string | null;
  class_full?: string;
  class_full_ar?: string | null;
  description?: string | null;
  start: string;
  start_label: string;
  date?: string;
  ladies_only: boolean;
  category?: string;
  price_qar?: number;
  pay_at_venue?: boolean;
  duration_min?: number;
  /* 1:1 appointments */
  trainer?: string;
  trainer_info?: Trainer;
};

export type PartOfDay = 'morning' | 'afternoon' | 'evening' | 'any';

/* The compact card, one per gym (src/lib/cards.ts): search_businesses and
   find_classes both open on a carousel of these */
export type NextTime = { start: string; start_label: string; date: string; ladies_only: boolean };

export type GymCard = {
  business_id: string;
  name: string;
  name_ar?: string | null;
  category: string;
  area: string;
  image_url?: string | null;
  from_price_qar: number | null;
  pay_at_venue?: boolean;
  next_times: NextTime[];
};

export type CardsResult = {
  gyms: GymCard[];
  count: number;
  date: string;
  days: number;
  /* a day or time was asked for, so the chips answer it */
  timed?: boolean;
  part_of_day?: PartOfDay | null;
  around_time?: string | null;
  ladies_filter?: boolean | null;
  /* nothing in the asked window: these are the next open times */
  next?: boolean;
  note?: string;
};

/* get_business: the gym page (src/tools/getBusiness.ts) */
export type GymPage = {
  business_id: string;
  name: string;
  name_ar?: string | null;
  category: string;
  area: string;
  address: string;
  description?: string | null;
  description_ar?: string | null;
  maps_url?: string | null;
  images: string[];
  from_price_qar: number | null;
  pay_at_venue: boolean;
  cancellation_hours?: number | null;
  cancellation_policy?: string | null;
  first_visit?: string | null;
  first_visit_ar?: string | null;
  services: Service[];
  other_services: { name: string; name_ar?: string | null; price: string }[];
  /* 1:1 appointments: who can be booked; empty for class-only gyms */
  staff?: TrainerProfile[];
  requirements?: Requirement[];
  class_hours: { weekday: number; first: string; last: string }[];
  week: { date: string; days: number; slots: ClassSlot[] };
};

export type ToolName = 'search_businesses' | 'get_availability' | 'find_classes' | 'create_booking';
