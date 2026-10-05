/* The structuredContent each tool returns (see src/tools/*). Only what the
   widget reads. */

export type Service = {
  service_id: string;
  name: string;
  name_ar?: string | null;
  duration_min: number;
  price_qar: number;
  pay_at_venue?: boolean;
  ladies_only?: boolean;
};

export type Business = {
  business_id: string;
  name: string;
  name_ar?: string | null;
  category: string;
  area: string;
  address: string;
  image_url?: string | null;
  services: Service[];
};

export type SearchResult = { businesses: Business[]; count: number; note?: string };

export type Slot = { slot_id: string; start: string; end: string; start_label: string; spots_left: number };

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
};

export type ToolName = 'search_businesses' | 'get_availability' | 'create_booking';
