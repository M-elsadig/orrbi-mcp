/* Card photos come from businesses.images[1] (the app's cover photo too), but
   only when they live in our Supabase Storage. The UI's CSP allows exactly
   that one host, so any other URL would render as a broken image; sending
   null instead shows the clean placeholder.

   Uploads are full size (300 KB–2 MB). Every photo goes out as a Supabase
   image-transformation URL at the size it is shown, so a phone downloads
   tens of KB instead (served as WebP to browsers that accept it). */

const DEFAULT_IMAGE_HOST = 'https://ycbmspmgyrbgwmybauos.supabase.co';
const PUBLIC_STORAGE_PATH = '/storage/v1/object/public/';
const RENDER_PATH = '/storage/v1/render/image/public/';

/* widths in CSS px × ~2 for phone screens */
export const IMAGE_WIDTH = { thumb: 400, hero: 800, avatar: 160 } as const;
export type ImageSize = keyof typeof IMAGE_WIDTH;

export function imageHost(): string {
  const raw = process.env.IMAGE_HOST?.trim() || DEFAULT_IMAGE_HOST;
  return new URL(raw).origin;
}

/* the compact card's photo, small */
export function coverImage(images: unknown): string | null {
  return Array.isArray(images) ? publicImage(images[0], 'thumb') : null;
}

/* every usable photo, cover first, for the detail's photo strip */
export function galleryImages(images: unknown, max = 8): string[] {
  if (!Array.isArray(images)) return [];
  return images.map((u) => publicImage(u, 'hero')).filter((u): u is string => !!u).slice(0, max);
}

/* one photo (e.g. a trainer's), resized, or null when it isn't in our Storage */
export function publicImage(first: unknown, size?: ImageSize): string | null {
  if (typeof first !== 'string' || !first) return null;

  let url: URL;
  try {
    url = new URL(first);
  } catch {
    return null;
  }

  if (url.protocol !== 'https:' || url.origin !== imageHost()) return null;
  if (!url.pathname.startsWith(PUBLIC_STORAGE_PATH)) return null;
  if (!size) return url.href;
  url.pathname = RENDER_PATH + url.pathname.slice(PUBLIC_STORAGE_PATH.length);
  url.search = `?width=${IMAGE_WIDTH[size]}&quality=70`;
  return url.href;
}
