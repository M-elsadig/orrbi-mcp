/* Card photos come from businesses.images[1] (the app's cover photo too), but
   only when they live in our Supabase Storage. The UI's CSP allows exactly
   that one host, so any other URL would render as a broken image; sending
   null instead shows the clean initial placeholder. */

const DEFAULT_IMAGE_HOST = 'https://ycbmspmgyrbgwmybauos.supabase.co';
const PUBLIC_STORAGE_PATH = '/storage/v1/object/public/';

export function imageHost(): string {
  const raw = process.env.IMAGE_HOST?.trim() || DEFAULT_IMAGE_HOST;
  return new URL(raw).origin;
}

export function coverImage(images: unknown): string | null {
  const first = Array.isArray(images) ? images[0] : null;
  if (typeof first !== 'string' || !first) return null;

  let url: URL;
  try {
    url = new URL(first);
  } catch {
    return null;
  }

  if (url.protocol !== 'https:' || url.origin !== imageHost()) return null;
  if (!url.pathname.startsWith(PUBLIC_STORAGE_PATH)) return null;
  return url.href;
}
