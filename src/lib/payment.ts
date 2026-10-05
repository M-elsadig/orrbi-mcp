/* How a price is said everywhere: MCP results, the card, the Telegram alert,
   the WhatsApp confirmation. One module so they can't drift apart.

   Orrbi never takes payment. For a pay-at-venue business (businesses.
   pay_at_venue) the customer pays there, and Orrbi only reserves the spot,
   so every price carries "pay at the gym". Shared with the UI bundle, so no
   Node imports here. */

export type Lang = 'en' | 'ar';

export type PayInfo = { price_qar: number; pay_at_venue?: boolean | null; category?: string | null };

const number = (n: number) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(n);

function venue(category: string | null | undefined, lang: Lang): string {
  if (category === 'gym') return lang === 'ar' ? 'الجيم' : 'the gym';
  return lang === 'ar' ? 'المكان' : 'the venue';
}

/* "100 QAR — pay at the gym" · "100 ر.ق — الدفع في الجيم" · "100 QAR" */
export function priceText(p: PayInfo, lang: Lang = 'en'): string {
  const amount = lang === 'ar' ? `${number(p.price_qar)} ر.ق` : `${number(p.price_qar)} QAR`;
  if (!p.pay_at_venue) return amount;
  return lang === 'ar' ? `${amount} — الدفع في ${venue(p.category, lang)}` : `${amount} — pay at ${venue(p.category, lang)}`;
}

/* A full sentence for confirmations; null when there's nothing to say.
   Without a price (a whole business, not one service) it just says where. */
export function paymentNote(p: Omit<PayInfo, 'price_qar'> & { price_qar?: number | null }, lang: Lang = 'en'): string | null {
  if (!p.pay_at_venue) return null;
  const amount = p.price_qar == null ? '' : lang === 'ar' ? ` ${number(p.price_qar)} ر.ق` : ` ${number(p.price_qar)} QAR`;
  return lang === 'ar'
    ? `ادفع${amount} في ${venue(p.category, lang)} عند الحضور. أوربي يحجز مكانك فقط ولا يستلم أي مبلغ.`
    : `Pay${amount} at ${venue(p.category, lang)} when you arrive. Orrbi only reserves your spot and never takes payment.`;
}

/* "Free cancellation up to 4 hours before the start." null when unset. */
export function cancellationText(hours: number | null | undefined, lang: Lang = 'en'): string | null {
  if (hours == null) return null;
  return lang === 'ar'
    ? `الإلغاء مجاني حتى ${hours} ساعات قبل الموعد.`
    : `Free cancellation up to ${hours} hours before the start.`;
}
