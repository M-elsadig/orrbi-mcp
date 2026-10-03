/* The structuredContent each tool returns (see src/tools/*). Only what the
   widget reads. */

export type Service = {
  service_id: string;
  name: string;
  name_ar?: string | null;
  duration_min: number;
  price_qar: number;
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

export type AvailabilityResult = {
  business_name: string;
  business_name_ar?: string | null;
  service_name: string;
  service_name_ar?: string | null;
  date: string;
  slots: Slot[];
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
};

export type ToolName = 'search_businesses' | 'get_availability' | 'create_booking';
