/* English and Arabic. The host's locale decides; anything starting with "ar"
   is Arabic (right-to-left), everything else English. Digits stay Western in
   both, to match references, prices and phone numbers. All times are Qatar
   time, whatever the viewer's device says. */

const TZ = 'Asia/Qatar';

export type Lang = 'en' | 'ar';

export const langFor = (locale: string | undefined): Lang => (/^ar\b/i.test(locale ?? '') ? 'ar' : 'en');

const CATEGORY_AR: Record<string, string> = {
  gym: 'نادي رياضي',
  barber: 'حلاق',
  salon: 'صالون',
  spa: 'سبا',
  clinic: 'عيادة',
  restaurant: 'مطعم',
  studio: 'استوديو'
};

const STRINGS = {
  en: {
    placesFound: (n: number) => (n === 1 ? '1 place' : `${n} places`),
    noBusinesses: 'No businesses matched this search.',
    moreServices: (n: number) => `+${n} more`,
    noSlots: 'No open times on this day.',
    noWeek: 'No open times in the next 7 days.',
    moved: (requested: string, shown: string) => `No times on ${requested}, showing ${shown}`,
    today: 'Today',
    tomorrow: 'Tomorrow',
    periods: { morning: 'Morning', afternoon: 'Afternoon', evening: 'Evening' },
    from: (price: string) => `from ${price}`,
    left: (n: number) => `${n} left`,
    pickTime: 'Tap a time to continue',
    sent: 'Sent. Continue in the chat.',
    sendFailed: 'Couldn’t send that. Type the time in the chat instead.',
    pending: 'Pending',
    awaiting: (b: string) => `Waiting for ${b} to confirm. You’ll get a WhatsApp message once they do.`,
    service: 'Service',
    when: 'When',
    reference: 'Reference',
    errorTitle: 'Something went wrong',
    slotMessage: (time: string, day: string, service: string, business: string) =>
      `I want the ${time} slot on ${day} for ${service} at ${business}.`
  },
  ar: {
    placesFound: (n: number) => (n === 1 ? 'مكان واحد' : n === 2 ? 'مكانان' : `${n} أماكن`),
    noBusinesses: 'لا توجد أماكن مطابقة لهذا البحث.',
    moreServices: (n: number) => `+${n} أخرى`,
    noSlots: 'لا توجد مواعيد متاحة في هذا اليوم.',
    noWeek: 'لا توجد مواعيد متاحة خلال الأيام السبعة القادمة.',
    moved: (requested: string, shown: string) => `لا مواعيد يوم ${requested}، نعرض ${shown}`,
    today: 'اليوم',
    tomorrow: 'غداً',
    periods: { morning: 'الصباح', afternoon: 'بعد الظهر', evening: 'المساء' },
    from: (price: string) => `من ${price}`,
    left: (n: number) => `متبقي ${n}`,
    pickTime: 'اختر موعداً للمتابعة',
    sent: 'تم الإرسال. أكمل في المحادثة.',
    sendFailed: 'تعذّر الإرسال. اكتب الموعد في المحادثة.',
    pending: 'قيد الانتظار',
    awaiting: (b: string) => `بانتظار تأكيد ${b}. ستصلك رسالة واتساب بعد التأكيد.`,
    service: 'الخدمة',
    when: 'الموعد',
    reference: 'رقم الحجز',
    errorTitle: 'حدث خطأ',
    slotMessage: (time: string, day: string, service: string, business: string) =>
      `أريد موعد ${time} يوم ${day} لـ ${service} في ${business}.`
  }
} as const;

export type Strings = (typeof STRINGS)['en'] | (typeof STRINGS)['ar'];
export const strings = (lang: Lang): Strings => STRINGS[lang];

const intlLocale = (lang: Lang) => (lang === 'ar' ? 'ar-QA-u-nu-latn' : 'en-GB');

/* 6:00 PM · 6:00 م */
export function timeLabel(iso: string, lang: Lang): string {
  return new Intl.DateTimeFormat(lang === 'ar' ? intlLocale(lang) : 'en-US', {
    timeZone: TZ, hour: 'numeric', minute: '2-digit', hour12: true
  }).format(new Date(iso));
}

/* Sun 4 Oct · الأحد، 4 أكتوبر */
export function dayLabel(iso: string, lang: Lang): string {
  return new Intl.DateTimeFormat(intlLocale(lang), lang === 'ar'
    ? { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long' }
    : { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short' }
  ).format(new Date(iso));
}

/* a YYYY-MM-DD Qatar date, read at Qatar midday so no timezone can shift it */
export const dayFromDate = (ymd: string, lang: Lang) => dayLabel(`${ymd}T12:00:00+03:00`, lang);

export const dateTimeLabel = (iso: string, lang: Lang) =>
  `${dayLabel(iso, lang)}${lang === 'ar' ? '، ' : ', '}${timeLabel(iso, lang)}`;

export function priceLabel(qar: number, lang: Lang): string {
  const n = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(qar);
  return lang === 'ar' ? `${n} ر.ق` : `${n} QAR`;
}

export const durationLabel = (min: number, lang: Lang) => (lang === 'ar' ? `${min} دقيقة` : `${min} min`);

export function categoryLabel(category: string, lang: Lang): string {
  const key = category.trim().toLowerCase();
  if (lang === 'ar') return CATEGORY_AR[key] ?? category;
  return key.charAt(0).toUpperCase() + key.slice(1);
}

/* Arabic name when the UI is Arabic and one exists, else the English one */
export const pick = (en: string, ar: string | null | undefined, lang: Lang) => (lang === 'ar' && ar ? ar : en);

/* ── Day strip and time groups ── */

/* YYYY-MM-DD in Qatar for an instant (default: now) */
export function qatarDate(at = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
}

/* the chip's two lines: "Today" / "Sun" over "4" */
export function dayChip(ymd: string, lang: Lang, today = qatarDate()): { top: string; num: string } {
  const t = strings(lang);
  const at = new Date(`${ymd}T12:00:00+03:00`);
  const tomorrow = qatarDate(new Date(new Date(`${today}T12:00:00+03:00`).getTime() + 86_400_000));
  const top = ymd === today ? t.today
    : ymd === tomorrow ? t.tomorrow
    : new Intl.DateTimeFormat(intlLocale(lang), { timeZone: TZ, weekday: 'short' }).format(at);
  const num = new Intl.DateTimeFormat(intlLocale(lang), { timeZone: TZ, day: 'numeric' }).format(at);
  return { top, num };
}

export type Period = 'morning' | 'afternoon' | 'evening';

/* the server sends starts in Qatar time ("…T18:00:00+03:00"), so the hour
   is right there: before 12 morning, 12–17 afternoon, 17 on evening */
export function periodOf(qatarIso: string): Period {
  const hour = Number(qatarIso.slice(11, 13));
  return hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';
}
