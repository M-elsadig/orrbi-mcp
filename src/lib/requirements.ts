import { db } from './supabase.js';

/* Pre-booking requirements (public.booking_requirements): questions the
   customer answers yes/no and notices they acknowledge before booking, e.g.
   Studio 11's EMS health screening. Stored per business (optionally per
   service), never in code. create_guest_booking refuses a booking unless
   every one is answered; checkAnswers mirrors that check so the model and
   the card get a clear message before the database is asked.

   A question's flag_answer is the answer the business must know about: the
   booking still goes through, flagged for the owner and the business, and
   the customer is told flag_note. Answers are health data: they go to the
   database and the owner's alert only, never to logs or the webhook. */

export type Requirement = {
  id: string;
  service_id: string | null;
  kind: 'question' | 'notice';
  key: string;
  text: string;
  text_ar: string | null;
  flag_answer: boolean | null;
  flag_note: string | null;
  flag_note_ar: string | null;
  /* the condition as a short list item ("Epilepsy or a seizure disorder")
     for "Do any of these apply to you?"; missing = use text */
  short?: string | null;
  short_ar?: string | null;
};

export type Answer = { id: string; answer: boolean };

type Row = {
  id: string; business_id: string; service_id: string | null; kind: string; key: string;
  text_en: string; text_ar: string | null; flag_answer: boolean | null;
  flag_note_en: string | null; flag_note_ar: string | null; sort: number | null;
  short_en: string | null; short_ar: string | null;
};

const SELECT = 'id,business_id,service_id,kind,key,text_en,text_ar,short_en,short_ar,flag_answer,flag_note_en,flag_note_ar,sort';

function toRequirement(r: Row): Requirement {
  return {
    id: r.id,
    service_id: r.service_id,
    kind: r.kind === 'notice' ? 'notice' : 'question',
    key: r.key,
    text: r.text_en,
    text_ar: r.text_ar || null,
    flag_answer: r.kind === 'question' && typeof r.flag_answer === 'boolean' ? r.flag_answer : null,
    flag_note: r.flag_note_en || null,
    flag_note_ar: r.flag_note_ar || null,
    short: r.short_en || null,
    short_ar: r.short_ar || null
  };
}

/* Active requirements per business, in order. */
export async function loadRequirements(businessIds: string[]): Promise<Map<string, Requirement[]>> {
  const out = new Map<string, Requirement[]>();
  if (!businessIds.length) return out;
  const { data, error } = await db().from('booking_requirements').select(SELECT)
    .in('business_id', businessIds).eq('is_active', true);
  if (error) throw error;
  const rows = ((data ?? []) as Row[]).slice().sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0) || a.key.localeCompare(b.key));
  for (const r of rows) out.set(r.business_id, [...(out.get(r.business_id) ?? []), toRequirement(r)]);
  return out;
}

/* The ones that apply to a service: its own plus the business-wide ones */
export function forService(reqs: Requirement[], serviceId: string): Requirement[] {
  return reqs.filter((r) => r.service_id === null || r.service_id === serviceId);
}

export type AnswerCheck =
  | { ok: true; flagged: Requirement[] }
  | { ok: false; reason: 'unknown' | 'missing'; missing: Requirement[] };

/* Same rules as create_guest_booking: no answer for anything that isn't one
   of these requirements; every question answered yes or no; every notice
   acknowledged (true). */
export function checkAnswers(reqs: Requirement[], answers: Answer[] | undefined): AnswerCheck {
  const given = new Map((answers ?? []).map((a) => [a.id, a.answer]));
  const ids = new Set(reqs.map((r) => r.id));
  if ([...given.keys()].some((id) => !ids.has(id))) return { ok: false, reason: 'unknown', missing: [] };

  const missing = reqs.filter((r) => {
    const a = given.get(r.id);
    return typeof a !== 'boolean' || (r.kind === 'notice' && a !== true);
  });
  if (missing.length) return { ok: false, reason: 'missing', missing };

  return { ok: true, flagged: reqs.filter((r) => r.flag_answer !== null && given.get(r.id) === r.flag_answer) };
}

/* What the model and the card see */
export function requirementOut(r: Requirement) {
  return {
    id: r.id,
    kind: r.kind,
    text: r.text,
    text_ar: r.text_ar,
    ...(r.short ? { short: r.short, short_ar: r.short_ar ?? null } : {}),
    ...(r.flag_answer !== null ? { flag_answer: r.flag_answer, flag_note: r.flag_note, flag_note_ar: r.flag_note_ar } : {})
  };
}

/* For the model: the same one-step pattern as the card, said once next to the list */
export const REQUIREMENTS_NOTE =
  'This business has requirements to answer before booking. Before create_booking, ask them in ONE message, not one by one: ' +
  'list the questions (short, or text when there is no short) and ask "Do any of these apply to you?". ' +
  'If the user says none apply, every question\'s answer is false. If one or more apply, ask which, and those are true, the rest false. ' +
  'Notices: the user must agree to each. Never answer for the user or assume "none"; include their answer in the read-back, ' +
  'and pass every question in requirements. An answer that applies does not stop the booking: pass on its flag_note.';

/* the line the customer is told when an answer was flagged; one per note */
export function flagNotes(flagged: Requirement[]): string[] {
  return [...new Set(flagged.map((r) => r.flag_note).filter((n): n is string => !!n))];
}
