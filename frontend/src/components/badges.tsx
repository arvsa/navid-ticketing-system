// Status visual language (UX_SPEC §6): every badge is a word, never colour alone.
import type { ReactNode } from "react";
import { Lock } from "lucide-react";
import type { IssueType, Priority, RsvpResponse, WorkStatus } from "@/api/types";
import { priorityLabel, rsvpLabel, typeLabel, workStatusLabel } from "@/lib/labels";
import { initials } from "@/people/usePeople";
import { cx } from "./ui";
import { t } from "@/i18n";
import { calendarParts, dayNumber, monthName, weekdayShort } from "@/lib/dates";

export function TypeBadge({ type, className }: { type: IssueType; className?: string }) {
  return (
    <span
      className={cx("inline-flex h-6 shrink-0 items-center rounded-md px-2 text-[13px] font-semibold", className)}
      style={{ color: `var(--${type})`, background: `var(--${type}-soft)` }}
    >
      {typeLabel[type]}
    </span>
  );
}

const statusVar: Record<WorkStatus, string> = {
  open: "open",
  in_progress: "prog",
  blocked: "block",
  pending_approval: "wait",
  approved: "ok",
  cancelled: "cxl",
};

export function Pill({ fg, bg, children, className }: { fg: string; bg: string; children: ReactNode; className?: string }) {
  return (
    <span
      className={cx("inline-flex h-7 shrink-0 items-center rounded-full px-3 text-[13px] font-semibold whitespace-nowrap", className)}
      style={{ color: fg, background: bg }}
    >
      {children}
    </span>
  );
}

/** Work status. "Waiting for you" when the viewer is the one who approves it. */
export function StatusBadge({ status, forMe }: { status: WorkStatus; forMe?: boolean }) {
  const v = statusVar[status];
  const text = status === "pending_approval" && forMe ? t("Waiting for you") : workStatusLabel[status];
  return (
    <Pill fg={`var(--st-${v})`} bg={`var(--st-${v}-bg)`}>
      {text}
    </Pill>
  );
}

export function PriorityText({ priority, hideNormal }: { priority: Priority; hideNormal?: boolean }) {
  if (hideNormal && (priority === "low" || priority === "medium")) return null;
  const color =
    priority === "critical" ? "var(--danger-solid)" : priority === "high" ? "var(--danger)" : priority === "low" ? "var(--text-3)" : "var(--text)";
  return (
    <span className={cx(priority === "high" || priority === "critical" ? "font-semibold" : "")} style={{ color }}>
      {priorityLabel[priority]}
    </span>
  );
}

export function PrivateTag() {
  return (
    <span className="inline-flex items-center gap-1 text-text-2">
      <Lock className="size-3.5" aria-hidden />
      {t("Private")}
    </span>
  );
}

export function RsvpBadge({ response, mine }: { response: RsvpResponse; mine?: boolean }) {
  if (response === "going") return <Pill fg="var(--success)" bg="var(--success-soft)">{t("Going")}</Pill>;
  if (response === "maybe") return <Pill fg="var(--warning)" bg="var(--warning-soft)">{t("Maybe")}</Pill>;
  if (response === "declined") return <Pill fg="var(--st-cxl)" bg="var(--st-cxl-bg)">{t("Can't go")}</Pill>;
  return mine ? (
    <Pill fg="var(--warning)" bg="var(--warning-soft)">{t("Reply")}</Pill>
  ) : (
    <Pill fg="var(--text-2)" bg="var(--sunken)">{rsvpLabel.pending}</Pill>
  );
}

const AVATAR_TONES = [
  ["--report", "--report-soft"],
  ["--ticket", "--ticket-soft"],
  ["--action", "--action-soft"],
  ["--event", "--event-soft"],
  ["--success", "--success-soft"],
];

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function Avatar({
  first,
  last,
  id,
  size = 32,
  dark,
}: {
  first?: string;
  last?: string;
  id?: string;
  size?: number;
  dark?: boolean;
}) {
  const [fg, bg] = AVATAR_TONES[hash(id ?? `${first}${last}`) % AVATAR_TONES.length];
  return (
    <span
      aria-hidden
      className="inline-flex shrink-0 items-center justify-center rounded-full font-semibold"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.38,
        color: dark ? "var(--nav-text)" : `var(${fg})`,
        background: dark ? "#3b4257" : `var(${bg})`,
      }}
    >
      {initials(first, last)}
    </span>
  );
}

export type Progress = { approved: number; waiting: number; inProgress: number; blocked: number; notStarted: number };

export function progressOf(items: { status: WorkStatus }[]): Progress {
  const p = { approved: 0, waiting: 0, inProgress: 0, blocked: 0, notStarted: 0 };
  for (const w of items) {
    if (w.status === "approved") p.approved++;
    else if (w.status === "pending_approval") p.waiting++;
    else if (w.status === "in_progress") p.inProgress++;
    else if (w.status === "blocked") p.blocked++;
    else if (w.status === "open") p.notStarted++;
  }
  return p;
}

export function ProgressBar({ p, className, label }: { p: Progress; className?: string; label?: string }) {
  const total = p.approved + p.waiting + p.inProgress + p.blocked + p.notStarted;
  const seg = (n: number, color: string) =>
    n > 0 ? <span style={{ width: `${(n / total) * 100}%`, background: color }} className="h-full" /> : null;
  return (
    <div
      role="img"
      aria-label={label ?? t("{done} of {total} approved", { done: p.approved, total })}
      className={cx("flex h-2 overflow-hidden rounded-full", className)}
      style={{ background: "var(--bar-track)" }}
    >
      {total > 0 && (
        <>
          {seg(p.approved, "var(--bar-ok)")}
          {seg(p.waiting, "var(--bar-wait)")}
          {seg(p.inProgress, "var(--bar-prog)")}
          {seg(p.blocked, "var(--bar-block)")}
        </>
      )}
    </div>
  );
}

/** Calendar-page style date block: "THU / 23 / October" (or "پنجشنبه / ۱ / آبان"). */
export function DateBlock({ date, size = "md" }: { date: Date; size?: "sm" | "md" }) {
  const day = weekdayShort(date).toUpperCase();
  if (size === "sm") {
    return (
      <div className="w-12 shrink-0 text-center">
        <div className="text-[12px] font-semibold text-[var(--event)]">{day}</div>
        <div className="text-[22px] leading-6 font-bold tabular">{dayNumber(date)}</div>
      </div>
    );
  }
  return (
    <div className="w-[88px] shrink-0 overflow-hidden rounded-[10px] border border-[var(--event-soft)] text-center">
      <div className="py-1 text-[13px] font-semibold" style={{ background: "var(--event)", color: "var(--surface)" }}>
        {day}
      </div>
      <div className="text-[30px] leading-9 font-bold tabular">{dayNumber(date)}</div>
      <div className="pb-1.5 text-[13px] text-text-2">{monthName(calendarParts(date).m)}</div>
    </div>
  );
}
