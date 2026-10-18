// Dates are shown in the item's branch time zone ("Fri 24 Oct, 17:00"),
// 24-hour, weeks start Monday (UX_SPEC §11).
import { TZDate } from "@date-fns/tz";
import {
  differenceInCalendarDays,
  differenceInMinutes,
  format,
  isSameDay,
  addDays,
} from "date-fns";

export const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

export function inZone(iso: string | Date, zone?: string | null): Date {
  const ms = typeof iso === "string" ? new Date(iso).getTime() : iso.getTime();
  return new TZDate(ms, zone || browserZone);
}

function now(zone?: string | null) {
  return new TZDate(Date.now(), zone || browserZone);
}

/** "Fri 24 Oct" */
export function formatDay(iso: string, zone?: string | null) {
  return format(inZone(iso, zone), "EEE d MMM");
}

/** "Fri 24 Oct, 17:00" */
export function formatDateTime(iso: string, zone?: string | null) {
  return format(inZone(iso, zone), "EEE d MMM, HH:mm");
}

export function formatTime(iso: string, zone?: string | null) {
  return format(inZone(iso, zone), "HH:mm");
}

/** "Today 14:00", "Tomorrow 09:00", "Fri 24 Oct, 17:00" */
export function formatWhen(iso: string, zone?: string | null) {
  const d = inZone(iso, zone);
  const n = now(zone);
  if (isSameDay(d, n)) return `Today ${format(d, "HH:mm")}`;
  if (isSameDay(d, addDays(n, 1))) return `Tomorrow ${format(d, "HH:mm")}`;
  return format(d, "EEE d MMM, HH:mm");
}

/** "just now", "4 min ago", "3 h ago", "Yesterday", "3 days ago", "12 Oct" */
export function timeAgo(iso: string) {
  const d = new Date(iso);
  const mins = differenceInMinutes(Date.now(), d);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = differenceInCalendarDays(Date.now(), d);
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  return format(d, "d MMM");
}

/** Short age for compact lists: "2 min", "1 h", "3 d". */
export function shortAgo(iso: string) {
  const mins = differenceInMinutes(Date.now(), new Date(iso));
  if (mins < 60) return `${Math.max(mins, 1)} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} h`;
  return `${Math.floor(hours / 24)} d`;
}

/** "2 days late", "5 h late", or null when not late. */
export function lateBy(iso: string) {
  const mins = differenceInMinutes(Date.now(), new Date(iso));
  if (mins <= 0) return null;
  if (mins < 60) return `${mins} min late`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} h late`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} late`;
}

/** "(in 4 days)", "(tomorrow)", "(today)" for upcoming dates. */
export function dueIn(iso: string, zone?: string | null) {
  const days = differenceInCalendarDays(inZone(iso, zone), now(zone));
  if (days < 0) return null;
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  return `in ${days} days`;
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
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

/** "1 day and 1 hour" from reminder minutes. */
export function describeReminders(mins: number[]) {
  const words = [...mins]
    .sort((a, b) => b - a)
    .map((m) => {
      if (m % 10080 === 0) return `${m / 10080} week${m === 10080 ? "" : "s"}`;
      if (m % 1440 === 0) return `${m / 1440} day${m === 1440 ? "" : "s"}`;
      if (m % 60 === 0) return `${m / 60} hour${m === 60 ? "" : "s"}`;
      return `${m} minutes`;
    });
  if (words.length <= 1) return words.join("");
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}
