/* Qatar mobile numbers in, +974XXXXXXXX out.

   Accepted after stripping spaces and dashes:
     55123456         local 8 digits
     97455123456      country code without +
     +97455123456     E.164
     0097455123456    international dialling prefix
   Anything else is rejected rather than guessed. */

export const PHONE_MESSAGE =
  'Please give a Qatar mobile number: 8 digits, optionally starting with +974 or 00974 ' +
  '(e.g. 55123456 or +974 5512 3456).';

export function normalizeQatarPhone(raw: string): string | null {
  const s = raw.replace(/[\s-]/g, '');
  const m = /^(?:\+974|00974|974)?(\d{8})$/.exec(s);
  return m ? '+974' + m[1] : null;
}
