/* Card photos come from businesses.images[0] (the app's cover photo too), but
   only when they live in our Supabase Storage. The UI's CSP allows exactly
   that one host, so any other URL would render as a broken image; sending
   null instead shows the clean placeholder.

   Uploads are full size. Every photo goes out as Supabase image-
   transformation URLs sized for where it is shown, at 1x/2x/3x (iPhones are
   3x), as a srcset the browser picks from. Resized by WIDTH ONLY with
   resize=contain, so the photo keeps its aspect ratio: Supabase's default
   (cover) keeps the original height when only a width is given and returns
   a narrow strip, which is what cropped the cards to a torso. The one crop
   is CSS object-fit: cover, aimed by the photo's focal point. */

const DEFAULT_IMAGE_HOST = 'https://ycbmspmgyrbgwmybauos.supabase.co';
const PUBLIC_STORAGE_PATH = '/storage/v1/object/public/';
const RENDER_PATH = '/storage/v1/render/image/public/';
const QUALITY = 75;

/* how wide each kind of photo is shown, in CSS px (= iPhone points) */
export const DISPLAY_WIDTH = { thumb: 330, hero: 390, avatar: 56 } as const;
export type ImageSize = keyof typeof DISPLAY_WIDTH;

/* what the card gets for one photo */
export type Photo = {
  src: string;          // the 2x version, for clients without srcset
  srcset: string;       // "<1x> 1x, <2x> 2x, <3x> 3x"
  position: string | null;   // CSS object-position, e.g. "50% 30%"; null = center
};

/* businesses.image_focus: { "<url in images[]>": "x% y%" } */
export type FocusMap = Record<string, unknown> | null | undefined;

export function imageHost(): string {
  const raw = process.env.IMAGE_HOST?.trim() || DEFAULT_IMAGE_HOST;
  return new URL(raw).origin;
}

/* "50% 30%", or null for anything else (then the photo is centered) */
export function focusPosition(value: unknown): string | null {
  return typeof value === 'string' && /^(100|[0-9]{1,2})% (100|[0-9]{1,2})%$/.test(value) ? value : null;
}

/* a photo in our public Storage, as a URL object; null for anything else */
function storageUrl(raw: unknown): URL | null {
  if (typeof raw !== 'string' || !raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.origin !== imageHost()) return null;
  if (!url.pathname.startsWith(PUBLIC_STORAGE_PATH)) return null;
  return url;
}

function rendered(base: URL, width: number): string {
  const url = new URL(base.href);
  url.pathname = RENDER_PATH + base.pathname.slice(PUBLIC_STORAGE_PATH.length);
  url.search = `?width=${width}&resize=contain&quality=${QUALITY}`;
  return url.href;
}

/* one photo at the size it is shown, with its focal point */
export function photoFor(raw: unknown, size: ImageSize, focus?: unknown): Photo | null {
  const base = storageUrl(raw);
  if (!base) return null;
  const w = DISPLAY_WIDTH[size];
  return {
    src: rendered(base, w * 2),
    srcset: [1, 2, 3].map((x) => `${rendered(base, w * x)} ${x}x`).join(', '),
    position: focusPosition(focus)
  };
}

/* the compact card's photo: the cover (images[0]) */
export function coverPhoto(images: unknown, focus?: FocusMap): Photo | null {
  return Array.isArray(images) ? photoFor(images[0], 'thumb', focus?.[images[0] as string]) : null;
}

/* every usable photo, cover first, for the gym page's photo strip */
export function galleryPhotos(images: unknown, focus?: FocusMap, max = 8): Photo[] {
  if (!Array.isArray(images)) return [];
  return images.map((u) => photoFor(u, 'hero', focus?.[u as string])).filter((p): p is Photo => !!p).slice(0, max);
}

/* just the URLs, for callers that only need the src */
export function coverImage(images: unknown, focus?: FocusMap): string | null {
  return coverPhoto(images, focus)?.src ?? null;
}

export function galleryImages(images: unknown, focus?: FocusMap, max = 8): string[] {
  return galleryPhotos(images, focus, max).map((p) => p.src);
}

/* one photo URL as stored, or null when it isn't in our Storage */
export function publicImage(raw: unknown): string | null {
  return storageUrl(raw)?.href ?? null;
}
