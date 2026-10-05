/* People and models say "fitness", "crossfit" or "نادي" for what the database
   calls category = 'gym'. Map those words onto the stored category before
   searching, so a search never comes back empty just because of wording.

   Keys are in normalized form (see norm): lower case, Arabic without "ال",
   hamza/ta marbuta variants folded, no diacritics. */
const SYNONYMS: Record<string, string> = {};

function add(category: string, words: string[]) {
  for (const w of words) SYNONYMS[norm(w)] = category;
}

/* Fold the spellings people actually type: أ/إ/آ → ا, ة → ه, ى → ي, drop
   tashkeel and tatweel, drop a leading "ال", and a plain English plural s. */
function norm(word: string): string {
  let w = word.toLowerCase()
    .replace(/[ً-ٰٟـ]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي');
  if (w.startsWith('ال') && w.length > 3) w = w.slice(2);
  if (/^[a-z]{3,}s$/.test(w) && !w.endsWith('ss')) w = w.slice(0, -1);
  return w;
}

add('gym', [
  'gym', 'fitness', 'studio', 'crossfit', 'workout', 'training', 'exercise', 'sport',
  'جيم', 'فتنس', 'فيتنس', 'رياضة', 'رياضي', 'رياضية', 'تمارين', 'تمرين', 'نادي', 'نوادي', 'صالة'
]);

/* Words that can sit next to a category word without changing it:
   "fitness center", "work out", "صالة رياضية", "a gym near me". */
const FILLER = new Set(['center', 'centre', 'club', 'class', 'session', 'place', 'near', 'me',
  'a', 'the', 'in', 'work', 'out', 'and', 'or', 'في', 'و', 'قريب', 'مني'].map(norm));

const words = (s: string) => s.split(/[\s,/&.-]+/).filter(Boolean).map(norm);

/* The stored category a free-text category means, or the text unchanged
   when nothing matches (so "barber" still searches for "barber"). */
export function resolveCategory(input: string): string {
  return categoryOf(input) ?? input;
}

/* The stored category when every meaningful word in the text names the same
   category, else null. "crossfit gym" → gym; "Aflete" → null. */
export function categoryOf(text: string): string | null {
  const ws = words(text);
  let found: string | null = null;
  let meaningful = 0;
  for (const w of ws) {
    const c = SYNONYMS[w];
    if (c) {
      if (found && found !== c) return null;
      found = c;
      meaningful++;
    } else if (!FILLER.has(w)) {
      return null;
    }
  }
  return meaningful ? found : null;
}
