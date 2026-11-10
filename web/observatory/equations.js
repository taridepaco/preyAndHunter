/* Equations as native MathML (no libraries). Numbers follow the page's language (decimal comma in Spanish). */
import { locale } from '../i18n.js';

const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
export const mi = (s) => `<mi>${esc(s)}</mi>`;
export const mo = (s) => `<mo>${s}</mo>`;
export const mn = (s) => `<mn>${s}</mn>`;
const DOT = mo('·');

/** A number in MathML with about `digits` significant digits; scientific notation if tiny or huge. */
export function number(v, digits = 2) {
  const a = Math.abs(v);
  const sign = v < 0 ? mo('−') : '';
  if (a === 0) return mn('0');
  if (a >= 1e-3 && a < 1e5) {
    return sign + mn(a.toLocaleString(locale(), { maximumSignificantDigits: digits, useGrouping: false }));
  }
  const e = Math.floor(Math.log10(a));
  const m = a / 10 ** e;
  return `${sign}${mn(m.toLocaleString(locale(), { maximumSignificantDigits: digits }))}${DOT}<msup>${mn('10')}${mn(e < 0 ? `−${-e}` : `${e}`)}</msup>`;
}

const deriv = (v) => `<mfrac><mrow>${mi('d')}${mi(v)}</mrow><mrow>${mi('d')}${mi('t')}</mrow></mfrac>`;

/** Sum of terms [{coef, factors}] with proper signs: 0,02 − 1,1·z + … */
export function sum(terms) {
  return terms.map((t, i) => {
    const neg = t.coef < 0;
    const sign = i === 0 ? (neg ? mo('−') : '') : mo(neg ? '−' : '+');
    const factors = t.factors.map(mi).join(DOT);
    return sign + number(Math.abs(t.coef)) + (factors ? DOT + factors : '');
  }).join('');
}

/** dv/dt = v·(…) for a per-capita equation, dv/dt = … otherwise. */
export function equation(target, terms, { log = false } = {}) {
  const body = sum(terms) || mn('0');
  const rhs = log ? `${mi(target)}${DOT}<mrow>${mo('(')}${body}${mo(')')}</mrow>` : body;
  return `<math display="block">${deriv(target)}${mo('=')}${rhs}</math>`;
}

/** An equation given as a raw MathML right-hand side. */
export function rawEquation(target, rhs) {
  return `<math display="block">${deriv(target)}${mo('=')}${rhs}</math>`;
}
