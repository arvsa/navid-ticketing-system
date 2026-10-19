// Language and calendar. English text is the key: t("Home") looks the words up
// in the Farsi dictionary and falls back to English. Both settings are read once
// at start-up (labels are built at module load), so changing them reloads.
import { Fragment, createElement, type ReactNode } from "react";
import { fa } from "./fa";

export type Lang = "en" | "fa";
export type CalendarSystem = "gregorian" | "persian";

const LANG_KEY = "st.lang";
const CAL_KEY = "st.calendar";

function read(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null; // storage unavailable
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // storage unavailable
  }
}

function detectLang(): Lang {
  const saved = read(LANG_KEY);
  if (saved === "en" || saved === "fa") return saved;
  if (typeof navigator !== "undefined" && /^fa\b/i.test(navigator.language)) return "fa";
  return "en";
}

export const lang: Lang = detectLang();
export const isRtl = lang === "fa";

function detectCalendar(): CalendarSystem {
  const saved = read(CAL_KEY);
  if (saved === "gregorian" || saved === "persian") return saved;
  return lang === "fa" ? "persian" : "gregorian";
}

export const calendar: CalendarSystem = detectCalendar();

export function setLang(l: Lang) {
  if (l === lang) return;
  write(LANG_KEY, l);
  location.reload();
}

export function setCalendar(c: CalendarSystem) {
  if (c === calendar) return;
  write(CAL_KEY, c);
  location.reload();
}

/** Sets lang and dir on <html>. */
export function applyLang() {
  document.documentElement.lang = lang;
  document.documentElement.dir = isRtl ? "rtl" : "ltr";
}

const FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹";

/** Digits in the reader's script: 12 → ۱۲ in Farsi. */
export function num(v: number | string): string {
  const s = typeof v === "number" ? v.toLocaleString("en-US", { useGrouping: false, maximumFractionDigits: 2 }) : v;
  return lang === "fa" ? s.replace(/[0-9]/g, (d) => FA_DIGITS[+d]) : s;
}

/** Keeps a value's own direction inside text of the other direction, so
 * "Sam S." stays "Sam S." in a Farsi sentence (Unicode first-strong isolate). */
export function isolate(s: string): string {
  return isRtl && s ? `⁨${s}⁩` : s;
}

const missing = new Set<string>();

function lookup(text: string): string {
  if (lang === "en") return text;
  const hit = fa[text];
  if (hit !== undefined) return hit;
  if (import.meta.env.DEV && !missing.has(text)) {
    missing.add(text);
    console.warn(`[i18n] missing Farsi for: ${JSON.stringify(text)}`);
  }
  return text;
}

type Vars = Record<string, string | number | null | undefined>;

function fill(text: string, vars?: Vars) {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (match, k: string) => {
    if (!(k in vars)) return match;
    const v = vars[k];
    return v == null ? "" : typeof v === "number" ? num(v) : isolate(v);
  });
}

/** Translated text; {name} placeholders are filled from vars (numbers get local digits). */
export function t(text: string, vars?: Vars): string {
  return fill(lookup(text), vars);
}

/** Singular or plural by count, with {n} filled. */
export function tn(n: number, one: string, other: string, vars?: Vars): string {
  return t(n === 1 ? one : other, { n, ...vars });
}

/** Like t(), but placeholders may be elements: tx("{name} replied", { name: <b>Sam</b> }). */
export function tx(text: string, vars: Record<string, ReactNode>): ReactNode {
  const parts = lookup(text).split(/\{(\w+)\}/g);
  return createElement(
    Fragment,
    null,
    ...parts.map((p, i) => {
      if (i % 2 === 0) return p;
      const v = vars[p];
      if (typeof v === "number") return num(v);
      if (typeof v === "string") return isolate(v);
      return isRtl && v != null ? createElement("bdi", { key: i }, v) : v;
    }),
  );
}

/** A title in quotes: “Trip” / «سفر». */
export function quote(s: string) {
  return lang === "fa" ? `«${s}»` : `“${s}”`;
}

/** "a, b and c" in the reader's language. Items are isolated, so a list of
 * Latin names still reads right to left in Farsi. */
export function joinList(list: string[]): string {
  const items = list.map(isolate);
  if (items.length <= 1) return items.join("");
  const and = lang === "fa" ? " و " : " and ";
  const comma = lang === "fa" ? "، " : ", ";
  return `${items.slice(0, -1).join(comma)}${and}${items[items.length - 1]}`;
}

/** Locale tag for Intl and localeCompare. */
export const localeTag = lang === "fa" ? "fa-IR" : "en-GB";
