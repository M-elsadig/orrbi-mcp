import { photoFor } from './images.js';

/* Trainers for 1:1 appointments (public.staff). An appointment slot belongs
   to one trainer (availability.staff_id), so picking the slot picks the
   trainer. Group classes have no trainer. */

export const STAFF_EMBED = 'staff(id,name,gender,title_en,title_ar,photo_url,photo_focus)';

export type StaffRow = {
  id: string;
  name: string;
  gender: string | null;
  title_en: string | null;
  title_ar: string | null;
  photo_url: string | null;
  photo_focus?: string | null;
};

export type Trainer = {
  id: string;
  name: string;
  gender: 'male' | 'female' | null;
  title: string | null;
  title_ar: string | null;
  photo_url: string | null;
  photo_srcset: string | null;
  photo_position: string | null;
};

export function toTrainer(r: StaffRow | null | undefined): Trainer | null {
  if (!r?.id || !r.name) return null;
  const photo = photoFor(r.photo_url, 'avatar', r.photo_focus);
  return {
    id: r.id,
    name: r.name,
    gender: r.gender === 'male' || r.gender === 'female' ? r.gender : null,
    title: r.title_en || null,
    title_ar: r.title_ar || null,
    photo_url: photo?.src ?? null,
    photo_srcset: photo?.srcset ?? null,
    photo_position: photo?.position ?? null
  };
}

/* the label the model reads out names the trainer, so a time is never
   offered without saying who it is with */
export function withTrainer(label: string, t: Pick<Trainer, 'name'> | null | undefined): string {
  return t ? `${label} · with ${t.name}` : label;
}

/* The gym page's trainer profiles */
export type StaffProfileRow = StaffRow & {
  specialties_en: string[] | null;
  specialties_ar: string[] | null;
  bio_en: string | null;
  bio_ar: string | null;
  sort: number | null;
};

export type StaffProfile = Trainer & {
  specialties: string[];
  specialties_ar: string[];
  bio: string | null;
  bio_ar: string | null;
};

export function toProfiles(rows: StaffProfileRow[]): StaffProfile[] {
  return rows.slice()
    .sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0) || a.name.localeCompare(b.name))
    .map((r) => ({
      ...toTrainer(r)!,
      specialties: r.specialties_en ?? [],
      specialties_ar: r.specialties_ar ?? [],
      bio: r.bio_en || null,
      bio_ar: r.bio_ar || null
    }));
}
