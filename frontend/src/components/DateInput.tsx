// Date and date-time fields. Values are always Gregorian strings, as for the
// native inputs ("2026-10-24" or "2026-10-24T17:00"). With the Gregorian
// calendar this is the browser's own picker; with the Persian calendar it is a
// Jalali month grid (browsers have no Persian date picker).
import { useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { format } from "date-fns";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { calendar, num, t } from "@/i18n";
import {
  addMonthsTo,
  dateIn,
  daysInMonth,
  formatLongDate,
  formatMonthTitle,
  monthOf,
  weekdayHeadings,
  weekStartsOn,
  type MonthRef,
} from "@/lib/dates";
import { Button, cx, inputClass } from "./ui";

type Props = {
  id?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
  mode: "date" | "datetime";
  value: string;
  onChange: (value: string) => void;
  /** Earliest allowed value, in the same format. */
  min?: string;
  className?: string;
};

export function DateInput(props: Props) {
  if (calendar !== "persian") {
    const { mode, onChange, className, ...rest } = props;
    return (
      <input
        {...rest}
        type={mode === "date" ? "date" : "datetime-local"}
        onChange={(e) => onChange(e.target.value)}
        className={cx(inputClass, className)}
      />
    );
  }
  return <JalaliInput {...props} />;
}

/** "yyyy-MM-dd" for a local date. */
const ymd = (d: Date) => format(d, "yyyy-MM-dd");

function parse(value: string): Date | null {
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
}

function JalaliInput({ id, mode, value, onChange, min, className, ...aria }: Props) {
  const [open, setOpen] = useState(false);
  const chosen = parse(value);
  const time = value.split("T")[1]?.slice(0, 5) || "09:00";
  const [shown, setShown] = useState<MonthRef>(() => monthOf(chosen ?? new Date()));
  const minDay = min?.slice(0, 10);
  const today = ymd(new Date());

  const first = dateIn(shown, 1);
  const lead = (first.getDay() - weekStartsOn + 7) % 7;
  const cells: (Date | null)[] = [...Array.from({ length: lead }, () => null)];
  for (let d = 1; d <= daysInMonth(shown); d++) cells.push(dateIn(shown, d));

  const emit = (day: string, hhmm = time) => onChange(mode === "date" ? day : `${day}T${hhmm}`);
  const label = chosen ? (mode === "date" ? formatLongDate(chosen) : `${formatLongDate(chosen)}${t(", ")}${num(time)}`) : t("Choose a date");

  return (
    <Popover.Root
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setShown(monthOf(chosen ?? new Date()));
      }}
    >
      <Popover.Trigger asChild>
        <button
          id={id}
          type="button"
          {...aria}
          className={cx(inputClass, "flex items-center justify-between gap-2 text-start", !chosen && "text-text-3", className)}
        >
          <span className="truncate">{label}</span>
          <CalendarDays className="size-4 shrink-0 text-text-3" aria-hidden />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="start" sideOffset={6} className="z-[90] w-[300px] rounded-[16px] border border-border bg-surface p-3 shadow-3">
          <div className="mb-2 flex items-center justify-between">
            <button type="button" className="rounded-full p-1.5 hover:bg-sunken" aria-label={t("Previous month")} onClick={() => setShown(addMonthsTo(shown, -1))}>
              <ChevronLeft className="size-4 rtl:-scale-x-100" />
            </button>
            <span className="font-semibold">{formatMonthTitle(shown)}</span>
            <button type="button" className="rounded-full p-1.5 hover:bg-sunken" aria-label={t("Next month")} onClick={() => setShown(addMonthsTo(shown, 1))}>
              <ChevronRight className="size-4 rtl:-scale-x-100" />
            </button>
          </div>
          <div className="grid grid-cols-7 text-center text-[11px] text-text-3">
            {weekdayHeadings().map((w) => (
              <span key={w} className="truncate py-1">
                {w.slice(0, 1)}
              </span>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-0.5">
            {cells.map((d, i) => {
              if (!d) return <span key={`x${i}`} />;
              const k = ymd(d);
              const selected = chosen && k === ymd(chosen);
              const disabled = !!minDay && k < minDay;
              return (
                <button
                  key={k}
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    emit(k);
                    if (mode === "date") setOpen(false);
                  }}
                  className={cx(
                    "h-9 rounded-full text-[14px] tabular disabled:opacity-30",
                    selected ? "bg-primary font-bold text-on-primary" : "hover:bg-sunken",
                    !selected && k === today && "ring-1 ring-primary",
                  )}
                >
                  {num(i - lead + 1)}
                </button>
              );
            })}
          </div>
          <div className="mt-3 flex items-center justify-between gap-2 border-t border-border pt-3">
            {mode === "datetime" ? (
              <input
                type="time"
                aria-label={t("Time")}
                value={time}
                onChange={(e) => e.target.value && emit(chosen ? ymd(chosen) : today, e.target.value)}
                className={cx(inputClass, "w-auto py-1.5")}
              />
            ) : (
              <Button size="sm" variant="ghost" onClick={() => (emit(today), setOpen(false))}>
                {t("Today")}
              </Button>
            )}
            <Popover.Close asChild>
              <Button size="sm" variant="primary">
                {t("Done")}
              </Button>
            </Popover.Close>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
