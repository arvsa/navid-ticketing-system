// Dates are shown in the item's branch time zone ("Fri 24 Oct, 17:00"),
// 24-hour (UX_SPEC §11), in the reader's language and calendar: Gregorian weeks
// start Monday, Persian (Jalali) weeks start Saturday ("جمعه ۲ آبان، ۱۷:۰۰").
import { TZDate } from "@date-fns/tz";
import { differenceInCalendarDays, differenceInMinutes, format, isSameDay, addDays } from "date-fns";
import { calendar, joinList, lang, num, t, tn } from "@/i18n";
import { jalaliMonthLength, toGregorian, toJalali } from "./jalali";

export const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

export function inZone(iso: string | Date, zone?: string | null): Date {
  const ms = typeof iso === "string" ? new Date(iso).getTime() : iso.getTime();
  return new TZDate(ms, zone || browserZone);
}

function now(zone?: string | null) {
  return new TZDate(Date.now(), zone || browserZone);
}

// ---- Calendar words --------------------------------------------------------

const MONTHS = {
  gregorian: {
    en: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
    fa: ["ژانویه", "فوریه", "مارس", "آوریل", "مه", "ژوئن", "ژوئیه", "اوت", "سپتامبر", "اکتبر", "نوامبر", "دسامبر"],
  },
  persian: {
    en: ["Farvardin", "Ordibehesht", "Khordad", "Tir", "Mordad", "Shahrivar", "Mehr", "Aban", "Azar", "Dey", "Bahman", "Esfand"],
    fa: ["فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور", "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند"],
  },
};

/** Sunday first, like Date.getDay(). */
const WEEKDAYS = {
  en: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
  fa: ["یکشنبه", "دوشنبه", "سه‌شنبه", "چهارشنبه", "پنجشنبه", "جمعه", "شنبه"],
};

/** Year, month (1–12) and day of a date's wall clock, in the reader's calendar. */
export function calendarParts(date: Date) {
  const gy = date.getFullYear();
  const gm = date.getMonth() + 1;
  const gd = date.getDate();
  if (calendar === "persian") {
    const j = toJalali(gy, gm, gd);
    return { y: j.jy, m: j.jm, d: j.jd };
  }
  return { y: gy, m: gm, d: gd };
}

export function monthName(m: number, short = false) {
  const name = MONTHS[calendar][lang][m - 1];
  return short && lang === "en" && calendar === "gregorian" ? name.slice(0, 3) : name;
}

export function weekdayShort(date: Date) {
  return WEEKDAYS[lang][date.getDay()];
}

/** The day of the month, in local digits. */
export function dayNumber(date: Date) {
  return num(calendarParts(date).d);
}

const comma = lang === "fa" ? "، " : ", ";
const hhmm = (d: Date) => num(format(d, "HH:mm"));
const dMMM = (d: Date) => {
  const p = calendarParts(d);
  return `${num(p.d)} ${monthName(p.m, true)}`;
};

/** "Fri 24 Oct" */
export function formatDay(iso: string, zone?: string | null) {
  const d = inZone(iso, zone);
  return `${weekdayShort(d)} ${dMMM(d)}`;
}

/** "Fri 24 Oct, 17:00" */
export function formatDateTime(iso: string, zone?: string | null) {
  const d = inZone(iso, zone);
  return `${weekdayShort(d)} ${dMMM(d)}${comma}${hhmm(d)}`;
}

export function formatTime(iso: string, zone?: string | null) {
  return hhmm(inZone(iso, zone));
}

/** "24 October 2026" for a date already in its zone. */
export function formatLongDate(d: Date) {
  const p = calendarParts(d);
  return `${num(p.d)} ${monthName(p.m)} ${num(p.y)}`;
}

/** "24 October" for a date already in its zone. */
export function formatDayMonth(d: Date) {
  const p = calendarParts(d);
  return `${num(p.d)} ${monthName(p.m)}`;
}

/** "Today 14:00", "Tomorrow 09:00", "Fri 24 Oct, 17:00" */
export function formatWhen(iso: string, zone?: string | null) {
  const d = inZone(iso, zone);
  const n = now(zone);
  if (isSameDay(d, n)) return t("Today {time}", { time: hhmm(d) });
  if (isSameDay(d, addDays(n, 1))) return t("Tomorrow {time}", { time: hhmm(d) });
  return formatDateTime(iso, zone);
}

/** "just now", "4 min ago", "3 h ago", "Yesterday", "3 days ago", "12 Oct" */
export function timeAgo(iso: string) {
  const d = new Date(iso);
  const mins = differenceInMinutes(Date.now(), d);
  if (mins < 1) return t("just now");
  if (mins < 60) return t("{n} min ago", { n: mins });
  const hours = Math.floor(mins / 60);
  if (hours < 24) return t("{n} h ago", { n: hours });
  const days = differenceInCalendarDays(Date.now(), d);
  if (days === 1) return t("Yesterday");
  if (days < 7) return t("{n} days ago", { n: days });
  return dMMM(d);
}

/** Short age for compact lists: "2 min", "1 h", "3 d". */
export function shortAgo(iso: string) {
  const mins = differenceInMinutes(Date.now(), new Date(iso));
  if (mins < 60) return t("{n} min", { n: Math.max(mins, 1) });
  const hours = Math.floor(mins / 60);
  if (hours < 24) return t("{n} h", { n: hours });
  return t("{n} d", { n: Math.floor(hours / 24) });
}

/** "2 days late", "5 h late", or null when not late. */
export function lateBy(iso: string) {
  const mins = differenceInMinutes(Date.now(), new Date(iso));
  if (mins <= 0) return null;
  if (mins < 60) return t("{n} min late", { n: mins });
  const hours = Math.floor(mins / 60);
  if (hours < 24) return t("{n} h late", { n: hours });
  const days = Math.floor(hours / 24);
  return tn(days, "{n} day late", "{n} days late");
}

/** "(in 4 days)", "(tomorrow)", "(today)" for upcoming dates. */
export function dueIn(iso: string, zone?: string | null) {
  const days = differenceInCalendarDays(inZone(iso, zone), now(zone));
  if (days < 0) return null;
  if (days === 0) return t("today");
  if (days === 1) return t("tomorrow");
  return t("in {n} days", { n: days });
}

export function isDueSoon(iso: string) {
  const ms = new Date(iso).getTime() - Date.now();
  return ms > 0 && ms < 24 * 3600_000;
}

export function zoneSuffix(zone?: string | null) {
  if (!zone || zone === browserZone) return "";
  return zone.split("/").pop()?.replace(/_/g, " ") ?? zone;
}

/** Value for <input type="datetime-local"> from an ISO string, in a zone. */
export function toLocalInput(iso: string | Date, zone?: string | null) {
  return format(inZone(iso, zone), "yyyy-MM-dd'T'HH:mm");
}

/** ISO string from an <input type="datetime-local"> value interpreted in a zone. */
export function fromLocalInput(value: string, zone?: string | null): string {
  const [date, time] = value.split("T");
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = (time ?? "00:00").split(":").map(Number);
  return new TZDate(y, m - 1, d, hh, mm, 0, zone || browserZone).toISOString();
}

export function greeting() {
  const h = new Date().getHours();
  if (h < 12) return t("Good morning");
  if (h < 18) return t("Good afternoon");
  return t("Good evening");
}

/** "1 day and 1 hour" from reminder minutes. */
export function describeReminders(mins: number[]) {
  const words = [...mins]
    .sort((a, b) => b - a)
    .map((m) => {
      if (m % 10080 === 0) return tn(m / 10080, "{n} week", "{n} weeks");
      if (m % 1440 === 0) return tn(m / 1440, "{n} day", "{n} days");
      if (m % 60 === 0) return tn(m / 60, "{n} hour", "{n} hours");
      return t("{n} minutes", { n: m });
    });
  return joinList(words);
}

// ---- Month grids -----------------------------------------------------------

/** A month in the reader's calendar (month 1–12). */
export type MonthRef = { y: number; m: number };

/** Monday for Gregorian, Saturday for the Persian calendar. */
export const weekStartsOn: 1 | 6 = calendar === "persian" ? 6 : 1;

export function monthOf(date: Date): MonthRef {
  const p = calendarParts(date);
  return { y: p.y, m: p.m };
}

export function addMonthsTo(r: MonthRef, n: number): MonthRef {
  const i = r.y * 12 + (r.m - 1) + n;
  return { y: Math.floor(i / 12), m: (i % 12) + 1 };
}

/** A local date (midnight) on day d of a month in the reader's calendar. */
export function dateIn(r: MonthRef, d: number): Date {
  if (calendar === "persian") {
    const g = toGregorian(r.y, r.m, d);
    return new Date(g.gy, g.gm - 1, g.gd);
  }
  return new Date(r.y, r.m - 1, d);
}

export function daysInMonth(r: MonthRef) {
  return calendar === "persian" ? jalaliMonthLength(r.y, r.m) : new Date(r.y, r.m, 0).getDate();
}

export function sameMonth(a: MonthRef, b: MonthRef) {
  return a.y === b.y && a.m === b.m;
}

/** "October 2026" / "مهر ۱۴۰۵" */
export function formatMonthTitle(r: MonthRef) {
  return `${monthName(r.m)} ${num(r.y)}`;
}

/** URL value "yyyy-MM". Persian months have years below 1700, so links work in either calendar. */
export function monthParam(r: MonthRef) {
  return `${r.y}-${String(r.m).padStart(2, "0")}`;
}

export function parseMonthParam(s: string | undefined): MonthRef | null {
  const m = s?.match(/^(\d{4})-(\d{2})$/);
  if (!m) return null;
  const y = +m[1];
  const mo = +m[2];
  if (mo < 1 || mo > 12) return null;
  const persianParam = y < 1700;
  if (persianParam === (calendar === "persian")) return { y, m: mo };
  // Written in the other calendar: show the month holding its first day.
  if (persianParam) {
    const g = toGregorian(y, mo, 1);
    return monthOf(new Date(g.gy, g.gm - 1, g.gd));
  }
  return monthOf(new Date(y, mo - 1, 1));
}

/** Weekday headings for a week starting on weekStartsOn. */
export function weekdayHeadings() {
  return Array.from({ length: 7 }, (_, i) => WEEKDAYS[lang][(weekStartsOn + i) % 7]);
}
