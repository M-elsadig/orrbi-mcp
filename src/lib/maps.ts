/* A Google Maps link to a business: its own pin (businesses.maps_url) when
   set, else its coordinates, else a search for its name and address (which
   Google resolves to the place when it is listed). Pure, for tests. */

export type Place = {
  name: string;
  address?: string | null;
  maps_url?: string | null;
  lat?: number | null;
  lng?: number | null;
};

const SEARCH = 'https://www.google.com/maps/search/?api=1&query=';

export function mapsLink(p: Place): string {
  if (p.maps_url?.startsWith('https://')) return p.maps_url;
  if (p.lat != null && p.lng != null) return `${SEARCH}${p.lat},${p.lng}`;
  return SEARCH + encodeURIComponent([p.name, p.address].filter(Boolean).join(', '));
}
