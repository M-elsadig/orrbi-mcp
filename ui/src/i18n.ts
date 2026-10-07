/* English and Arabic. The host's locale decides; anything starting with "ar"
   is Arabic (right-to-left), everything else English. Digits stay Western in
   both, to match references, prices and phone numbers. All times are Qatar
   time, whatever the viewer's device says. */

import { paymentNote, priceText } from '../../src/lib/payment.js';

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
    ladiesOnly: 'Ladies only',
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
      `I want the ${time} slot on ${day} for ${service} at ${business}.`,
    /* booking inside the card */
    back: 'Back',
    business: 'Place',
    price: 'Price',
    duration: 'Duration',
    pickService: 'Choose a service',
    yourDetails: 'Your details',
    name: 'Name',
    mobile: 'Qatar mobile',
    mobileHint: 'e.g. 5512 3456',
    nameRequired: 'Enter your name.',
    nameTooLong: 'Use 100 characters or fewer.',
    phoneInvalid: '8 digits, optionally starting with +974 or 00974.',
    confirm: 'Confirm booking',
    booking: 'Booking…',
    privacy: 'Your name and number go only to the business, not into this chat.',
    loadFailed: 'Couldn’t load the times.',
    tryAgain: 'Try again',
    continueInChat: 'Or continue in the chat.',
    pickAnother: 'Pick another time',
    bookErrors: {
      slotGone: 'That time was just taken or is no longer available.',
      duplicate: 'This number already has a booking at this time.',
      tooMany: 'This number already has 3 bookings waiting for confirmation.',
      phone: 'Check the mobile number: 8 digits, optionally starting with +974.',
      other: 'Couldn’t complete the booking. Please try again.',
      blocked: 'This number can’t book through Orrbi right now because of missed bookings. Please contact the Orrbi team and we’ll sort it out.',
      requirements: 'Please answer every question before sending the request.'
    },
    booked: 'Booking requested',
    firstVisit: 'First visit',
    /* answer-first results and the gym detail */
    /* compact cards, the gym page and the request steps */
    fromPrice: (price: string) => `From ${price}`,
    noTimesThen: 'Nothing open then',
    nextTimesInstead: 'Nothing open then. Next open times:',
    noOpenTimes: 'No open times this week',
    openGym: (name: string) => `Open ${name}`,
    available: 'Available',
    classesTitle: 'Classes',
    about: 'About',
    classTimes: 'Class times',
    alsoHere: 'Also here (book at the gym)',
    openMaps: 'Open in Google Maps',
    bookNow: 'Book now',
    bookAt: (time: string) => `Book ${time}`,
    pickTimeFirst: 'Pick a time above',
    timeGone: 'That time is no longer open. Pick another.',
    chooseClass: 'Choose your class',
    womenOnly: 'Women only',
    womenOnlyNote: 'This time is for women only.',
    continue: 'Continue',
    reviewTitle: 'Check your request',
    payment: 'Payment',
    cancellation: 'Cancellation',
    sendRequest: 'Send booking request',
    sending: 'Sending…',
    requestNote: (b: string) => `This is a request, not a booking yet. ${b} confirms it, then you get a WhatsApp message.`,
    requestSent: 'Booking request sent',
    notConfirmed: 'Pending — not confirmed yet',
    yourName: 'Name',
    yourMobile: 'Mobile',
    tonight: 'Tonight',
    thisWeek: 'This week',
    nextOpen: 'Next open classes',
    nothingThen: 'Nothing open then. These are the next times.',
    classes: (n: number) => (n === 1 ? '1 class' : `${n} classes`),
    showMore: (n: number) => `Show ${n} more`,
    perClass: (price: string) => `${price} per class`,
    noClasses: 'No open classes for this.',
    noClassesDay: 'No classes on this day.',
    noClassesWeek: 'No open classes in the next 7 days.',
    classSlotMessage: (time: string, day: string, cls: string, business: string) =>
      `I want the ${time} ${cls} class on ${day} at ${business}.`,
    cardTimeMessage: (time: string, day: string, business: string) =>
      `I want a class at ${business} at ${time} on ${day}.`,
    /* 1:1 appointments and pre-booking requirements */
    trainersTitle: 'Trainers',
    sessionsTitle: 'Sessions',
    sessionTimes: 'Session times',
    chooseTrainer: 'Choose your trainer',
    trainer: 'Trainer',
    privateSession: 'Private 1:1',
    beforeYouBook: 'Before you book',
    requirementsIntro: 'Please answer each question. Your answers go only to the business.',
    yes: 'Yes',
    no: 'No',
    agree: 'I agree',
    answerAll: 'Answer every question to continue.',
    answersGiven: 'Answered'
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
    ladiesOnly: 'للسيدات فقط',
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
      `أريد موعد ${time} يوم ${day} لـ ${service} في ${business}.`,
    back: 'رجوع',
    business: 'المكان',
    price: 'السعر',
    duration: 'المدة',
    pickService: 'اختر الخدمة',
    yourDetails: 'بياناتك',
    name: 'الاسم',
    mobile: 'رقم الجوال في قطر',
    /* digits only: the mobile field is left-to-right, and an Arabic word in it would scramble */
    mobileHint: '5512 3456',
    nameRequired: 'أدخل اسمك.',
    nameTooLong: 'استخدم 100 حرف أو أقل.',
    phoneInvalid: '8 أرقام، ويمكن أن يبدأ بـ ‎+974 أو ‎00974.',
    confirm: 'تأكيد الحجز',
    booking: 'جارٍ الحجز…',
    privacy: 'يصل اسمك ورقمك إلى المكان فقط، ولا يُرسلان إلى هذه المحادثة.',
    loadFailed: 'تعذّر تحميل المواعيد.',
    tryAgain: 'حاول مرة أخرى',
    continueInChat: 'أو أكمل في المحادثة.',
    pickAnother: 'اختر موعداً آخر',
    bookErrors: {
      slotGone: 'هذا الموعد حُجز للتو أو لم يعد متاحاً.',
      duplicate: 'لدى هذا الرقم حجز في هذا الموعد بالفعل.',
      tooMany: 'لدى هذا الرقم 3 حجوزات بانتظار التأكيد.',
      phone: 'تحقق من رقم الجوال: 8 أرقام، ويمكن أن يبدأ بـ ‎+974.',
      other: 'تعذّر إتمام الحجز. حاول مرة أخرى.',
      blocked: 'لا يمكن لهذا الرقم الحجز عبر أوربي حالياً بسبب حجوزات لم يتم حضورها. تواصل مع فريق أوربي وسنساعدك.',
      requirements: 'يرجى الإجابة عن كل الأسئلة قبل إرسال الطلب.'
    },
    booked: 'تم طلب الحجز',
    firstVisit: 'زيارتك الأولى',
    fromPrice: (price: string) => `من ${price}`,
    noTimesThen: 'لا مواعيد في هذا الوقت',
    nextTimesInstead: 'لا مواعيد في هذا الوقت. أقرب المواعيد:',
    noOpenTimes: 'لا مواعيد متاحة هذا الأسبوع',
    openGym: (name: string) => `افتح ${name}`,
    available: 'المواعيد المتاحة',
    classesTitle: 'الحصص',
    about: 'نبذة',
    classTimes: 'أوقات الحصص',
    alsoHere: 'متوفر أيضاً (الحجز في النادي)',
    openMaps: 'افتح في خرائط Google',
    bookNow: 'احجز الآن',
    bookAt: (time: string) => `احجز ${time}`,
    pickTimeFirst: 'اختر موعداً من الأعلى',
    timeGone: 'هذا الموعد لم يعد متاحاً. اختر موعداً آخر.',
    chooseClass: 'اختر الحصة',
    womenOnly: 'للسيدات فقط',
    womenOnlyNote: 'هذا الموعد للسيدات فقط.',
    continue: 'متابعة',
    reviewTitle: 'راجع طلبك',
    payment: 'الدفع',
    cancellation: 'الإلغاء',
    sendRequest: 'إرسال طلب الحجز',
    sending: 'جارٍ الإرسال…',
    requestNote: (b: string) => `هذا طلب وليس حجزاً بعد. يؤكده ${b} ثم تصلك رسالة واتساب.`,
    requestSent: 'تم إرسال طلب الحجز',
    notConfirmed: 'قيد الانتظار — لم يتم التأكيد بعد',
    yourName: 'الاسم',
    yourMobile: 'الجوال',
    tonight: 'الليلة',
    thisWeek: 'هذا الأسبوع',
    nextOpen: 'أقرب الحصص المتاحة',
    nothingThen: 'لا حصص في هذا الوقت. هذه أقرب المواعيد.',
    classes: (n: number) => (n === 1 ? 'حصة واحدة' : n === 2 ? 'حصتان' : `${n} حصص`),
    showMore: (n: number) => `عرض ${n} أخرى`,
    perClass: (price: string) => `${price} للحصة`,
    noClasses: 'لا حصص متاحة لهذا الطلب.',
    noClassesDay: 'لا حصص في هذا اليوم.',
    noClassesWeek: 'لا حصص متاحة خلال الأيام السبعة القادمة.',
    classSlotMessage: (time: string, day: string, cls: string, business: string) =>
      `أريد حصة ${cls} الساعة ${time} يوم ${day} في ${business}.`,
    cardTimeMessage: (time: string, day: string, business: string) =>
      `أريد حصة في ${business} الساعة ${time} يوم ${day}.`,
    trainersTitle: 'المدربون',
    sessionsTitle: 'الجلسات',
    sessionTimes: 'أوقات الجلسات',
    chooseTrainer: 'اختر مدربك',
    trainer: 'المدرب',
    privateSession: 'جلسة خاصة',
    beforeYouBook: 'قبل الحجز',
    requirementsIntro: 'يرجى الإجابة عن كل سؤال. تصل إجاباتك إلى المكان فقط.',
    yes: 'نعم',
    no: 'لا',
    agree: 'أوافق',
    answerAll: 'أجب عن كل الأسئلة للمتابعة.',
    answersGiven: 'تمت الإجابة'
  }
} as const;

export type Strings = (typeof STRINGS)['en'] | (typeof STRINGS)['ar'];
export const strings = (lang: Lang): Strings => STRINGS[lang];

const intlLocale = (lang: Lang) => (lang === 'ar' ? 'ar-QA-u-nu-latn' : 'en-GB');

/* "Sun" · "الأحد" for weekday 0–6 (schedule_templates.weekday, 0 = Sunday) */
export function weekdayName(weekday: number, lang: Lang): string {
  /* 2026-10-04 was a Sunday */
  const at = new Date(Date.UTC(2026, 9, 4 + weekday, 12));
  return new Intl.DateTimeFormat(intlLocale(lang), { timeZone: 'UTC', weekday: lang === 'ar' ? 'long' : 'short' }).format(at);
}

/* "17:15" → "5:15 PM" in the UI's language */
export function clockLabel(hhmm: string, lang: Lang): string {
  return timeLabel(`2026-10-04T${hhmm}:00+03:00`, lang);
}

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

/* 100 QAR · 100 QAR — pay at the gym (src/lib/payment.ts, shared with the server) */
export function priceLabel(qar: number, lang: Lang, pay?: { pay_at_venue?: boolean | null; category?: string | null }): string {
  return priceText({ price_qar: qar, pay_at_venue: pay?.pay_at_venue, category: pay?.category }, lang);
}

export function payNote(qar: number, lang: Lang, pay: { pay_at_venue?: boolean | null; category?: string | null }): string | null {
  return paymentNote({ price_qar: qar, pay_at_venue: pay.pay_at_venue, category: pay.category }, lang);
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

/* The results header: what the answer is for. "Tonight", "Tomorrow ·
   Morning", "Tue 7 Oct", "This week", or "Next open classes". */
export function windowTitle(r: { date: string; days: number; part_of_day?: string | null; next?: boolean }, lang: Lang, today = qatarDate()): string {
  const t = strings(lang);
  if (r.next) return t.nextOpen;
  if (r.days >= 7 && r.date === today) return t.thisWeek;
  const part = r.part_of_day && r.part_of_day !== 'any' ? (r.part_of_day as Period) : null;
  if (r.days > 1) return `${dayFromDate(r.date, lang)} – ${dayFromDate(addDay(r.date, r.days - 1), lang)}`;
  if (r.date === today && part === 'evening') return t.tonight;
  const { top } = dayChip(r.date, lang, today);
  const day = r.date === today || r.date === addDay(today, 1) ? top : dayFromDate(r.date, lang);
  return part ? `${day} · ${t.periods[part]}` : day;
}

function addDay(ymd: string, n: number): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export type Period = 'morning' | 'afternoon' | 'evening';

/* the server sends starts in Qatar time ("…T18:00:00+03:00"), so the hour
   is right there: before 12 morning, 12–17 afternoon, 17 on evening */
export function periodOf(qatarIso: string): Period {
  const hour = Number(qatarIso.slice(11, 13));
  return hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';
}
