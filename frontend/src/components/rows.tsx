// Light, clickable building blocks: stat pills, whole-row links and panels.
// Prefer these over boxes with buttons inside: the whole thing is the target.
import type { ReactNode } from "react";
import { Link, type LinkProps } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { cx } from "./ui";

type Tone = "neutral" | "danger" | "warning" | "primary" | "success";
const toneStyle: Record<Tone, { fg: string; bg: string }> = {
  neutral: { fg: "var(--text)", bg: "var(--surface)" },
  danger: { fg: "var(--danger)", bg: "var(--danger-soft)" },
  warning: { fg: "var(--warning)", bg: "var(--warning-soft)" },
  primary: { fg: "var(--primary-on-soft)", bg: "var(--primary-soft)" },
  success: { fg: "var(--success)", bg: "var(--success-soft)" },
};

/** "12 overdue" as a rounded, clickable pill. */
export function StatPill({
  value,
  label,
  tone = "neutral",
  onClick,
  link,
  active,
}: {
  value: ReactNode;
  label: string;
  tone?: Tone;
  onClick?: () => void;
  link?: LinkProps;
  active?: boolean;
}) {
  const t = toneStyle[tone];
  const cls = cx(
    "inline-flex h-11 items-center gap-2 rounded-full border px-4 text-[15px] whitespace-nowrap transition-[box-shadow,transform] hover:-translate-y-px hover:shadow-2",
    tone === "neutral" ? "border-border" : "border-transparent",
    active && "ring-2 ring-text",
  );
  const body = (
    <>
      <b className="text-[17px] tabular">{value}</b>
      <span className={tone === "neutral" ? "text-text-2" : ""}>{label}</span>
    </>
  );
  if (link)
    return (
      <Link {...link} className={cls} style={{ color: t.fg, background: t.bg }}>
        {body}
      </Link>
    );
  return (
    <button type="button" onClick={onClick} aria-pressed={active} className={cls} style={{ color: t.fg, background: t.bg }}>
      {body}
    </button>
  );
}

const rowCls = "group flex w-full items-center gap-3 rounded-[14px] px-3 py-3 text-left transition-colors hover:bg-sunken";

/** A list row that is one big link (or button), with a chevron on the right.
 * Next to a button, pass className="w-auto min-w-0 flex-1" so it leaves room. */
export function RowLink({
  link,
  onClick,
  leading,
  title,
  meta,
  trailing,
  chevron = true,
  className,
}: {
  link?: LinkProps;
  onClick?: () => void;
  leading?: ReactNode;
  title: ReactNode;
  meta?: ReactNode;
  trailing?: ReactNode;
  chevron?: boolean;
  className?: string;
}) {
  const body = (
    <>
      {leading}
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{title}</span>
        {meta && <span className="block truncate text-[14px] text-text-2">{meta}</span>}
      </span>
      {trailing}
      {chevron && <ChevronRight className="size-4 shrink-0 text-text-3 transition-transform group-hover:translate-x-0.5" aria-hidden />}
    </>
  );
  if (link)
    return (
      <Link {...link} className={cx(rowCls, className)}>
        {body}
      </Link>
    );
  return (
    <button type="button" onClick={onClick} className={cx(rowCls, className)}>
      {body}
    </button>
  );
}

/** A soft panel with a title and an optional link on the right. */
export function Panel({ title, action, children, className }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx("rounded-[22px] bg-surface p-2 shadow-1 ring-1 ring-border", className)}>
      {(title || action) && (
        <div className="flex items-center justify-between gap-3 px-3 pt-3 pb-2">
          {title && <h2 className="text-[17px] font-semibold">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

/** Small round tag used at the start of a row. */
export function Dot({ tone }: { tone: Tone }) {
  return <span className="size-2.5 shrink-0 rounded-full" style={{ background: toneStyle[tone].fg }} aria-hidden />;
}
