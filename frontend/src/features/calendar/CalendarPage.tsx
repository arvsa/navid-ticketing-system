// Calendar (UX_SPEC §4.9): month grid and agenda, with "needs a reply" filter
// and my due dates. Months and weeks follow the reader's calendar (Gregorian
// weeks start Monday, Persian weeks Saturday).
import { useMemo, useState } from "react";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { addDays, endOfWeek, format, isSameDay, startOfWeek } from "date-fns";
import { useCalendar, useIssuesById, useWorkItems } from "@/api/hooks";
import type { CalendarEntry } from "@/api/types";
import { useBranch } from "@/app/BranchContext";
import { useNewItem } from "@/app/newItemContext";
import { DateBlock, RsvpBadge } from "@/components/badges";
import { Button, Card, Chip, EmptyState, ErrorPanel, LoadingRows, PageHeader, Segmented, cx } from "@/components/ui";
import {
  addMonthsTo,
  dateIn,
  dayNumber,
  daysInMonth,
  formatDayMonth,
  formatMonthTitle,
  formatTime,
  inZone,
  monthOf,
  monthParam,
  parseMonthParam,
  sameMonth,
  weekdayHeadings,
  weekStartsOn,
  type MonthRef,
} from "@/lib/dates";
import { isDone, numberOf } from "@/lib/items";
import { rsvpLabel } from "@/lib/labels";
import { RsvpButtons } from "@/features/events/RsvpButtons";
import { t } from "@/i18n";

type View = "month" | "agenda";
type Filter = "all" | "reply" | "going";

export function CalendarPage() {
  const search = useSearch({ from: "/authed/shell/calendar" });
  const navigate = useNavigate({ from: "/calendar" });
  const { branchId, zoneOf, isAll, branchById } = useBranch();
  const openNew = useNewItem();
  const zone = zoneOf(branchId);
  const [view, setView] = useState<View>(() => (matchMedia("(max-width: 639px)").matches ? "agenda" : "month"));
  const [filter, setFilter] = useState<Filter>("all");
  const [showDue, setShowDue] = useState(true);
  const month: MonthRef = parseMonthParam(search.month) ?? monthOf(new Date());
  const first = dateIn(month, 1);
  const gridStart = startOfWeek(first, { weekStartsOn });
  const gridEnd = endOfWeek(dateIn(month, daysInMonth(month)), { weekStartsOn });
  const from = view === "month" ? gridStart : first;
  const to = view === "month" ? addDays(gridEnd, 1) : addDays(first, 60);
  const cal = useCalendar(from.toISOString(), to.toISOString(), branchId);
  const mine = useWorkItems({ assignee: "me", branch_id: branchId }, showDue);
  const dueItems = (mine.data ?? []).filter((w) => w.sla_due_at && !isDone(w));
  const dueIssues = useIssuesById(showDue ? dueItems.map((w) => w.issue_id) : []);

  const events = (cal.data ?? []).filter((e) => (filter === "reply" ? e.my_rsvp === "pending" : filter === "going" ? e.my_rsvp === "going" : true));
  const replyCount = (cal.data ?? []).filter((e) => e.my_rsvp === "pending" && e.state === "open").length;
  const goMonth = (r: MonthRef) => navigate({ search: { month: monthParam(r) } });

  const byDay = useMemo(() => {
    const m = new Map<string, { events: CalendarEntry[]; due: { title: string; key: string }[] }>();
    const slot = (d: Date) => {
      const k = format(d, "yyyy-MM-dd");
      if (!m.has(k)) m.set(k, { events: [], due: [] });
      return m.get(k)!;
    };
    for (const e of events) slot(inZone(e.starts_at, zoneOf(e.branch_id) ?? zone)).events.push(e);
    if (showDue)
      for (const w of dueItems) {
        const issue = dueIssues.map.get(w.issue_id);
        if (issue) slot(inZone(w.sla_due_at!, zone)).due.push({ title: issue.title, key: issue.key });
      }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events, dueItems.length, dueIssues.map.size, showDue]);

  const days: Date[] = [];
  for (let d = gridStart; d <= gridEnd; d = addDays(d, 1)) days.push(d);

  return (
    <div>
      <PageHeader
        title={t("Calendar")}
        actions={
          <Button variant="primary" size="lg" icon={<Plus className="size-5" />} onClick={() => openNew({ type: "event", onlyType: true })}>
            {t("New event")}
          </Button>
        }
      />
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1">
          <Button variant="ghost" aria-label={t("Previous month")} onClick={() => goMonth(addMonthsTo(month, -1))}>
            <ChevronLeft className="size-5 rtl:-scale-x-100" />
          </Button>
          <Button onClick={() => navigate({ search: {} })}>{t("Today")}</Button>
          <Button variant="ghost" aria-label={t("Next month")} onClick={() => goMonth(addMonthsTo(month, 1))}>
            <ChevronRight className="size-5 rtl:-scale-x-100" />
          </Button>
        </div>
        <h2 className="min-w-[180px] text-[22px] font-bold">{formatMonthTitle(month)}</h2>
        <div className="ms-auto">
          <Segmented<View> label={t("View")} value={view} onChange={setView} options={[{ value: "month", label: t("Month") }, { value: "agenda", label: t("Agenda") }]} />
        </div>
      </div>
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <Chip active={filter === "reply"} onClick={() => setFilter(filter === "reply" ? "all" : "reply")}>
          {t("Needs a reply ({n})", { n: replyCount })}
        </Chip>
        <Chip active={filter === "going"} onClick={() => setFilter(filter === "going" ? "all" : "going")}>
          {t("Going")}
        </Chip>
        <Chip active={filter === "all"} onClick={() => setFilter("all")}>
          {t("All")}
        </Chip>
        <label className="ms-2 inline-flex items-center gap-2">
          <input type="checkbox" checked={showDue} onChange={(e) => setShowDue(e.target.checked)} className="size-4" />
          {t("Show my due dates")}
        </label>
      </div>

      {cal.error ? (
        <ErrorPanel error={cal.error} onRetry={() => cal.refetch()} />
      ) : view === "month" ? (
        <Card className="overflow-hidden">
          <div className="grid grid-cols-7 border-b border-border bg-surface-2 text-center text-[13px] font-semibold text-text-3">
            {weekdayHeadings().map((d) => (
              <div key={d} className="truncate px-0.5 py-2">
                {d}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {days.map((d) => {
              const k = format(d, "yyyy-MM-dd");
              const slot = byDay.get(k);
              const items = [...(slot?.events ?? [])];
              const today = isSameDay(d, new Date());
              return (
                <div key={k} className={cx("min-h-[110px] border-e border-b border-border p-1.5 sm:p-2", !sameMonth(monthOf(d), month) && "bg-surface-2 text-text-3")}>
                  <div className="mb-1 flex items-center justify-between">
                    <span className={cx("flex size-7 items-center justify-center rounded-full text-[14px] tabular", today && "bg-primary font-bold text-on-primary")}>{dayNumber(d)}</span>
                    <button onClick={() => openNew({ type: "event", date: k, onlyType: true })} className="hidden rounded-full px-1.5 text-text-3 hover:bg-sunken sm:block" aria-label={t("New event on {date}", { date: formatDayMonth(d) })}>
                      +
                    </button>
                  </div>
                  <ul className="space-y-1">
                    {items.slice(0, 3).map((e) => (
                      <li key={e.issue_id}>
                        <EventChip e={e} zone={zoneOf(e.branch_id) ?? zone} />
                      </li>
                    ))}
                    {items.length > 3 && <li className="px-1 text-[12px] text-text-2">{t("+{n} more", { n: items.length - 3 })}</li>}
                    {slot?.due.slice(0, 2).map((x) => (
                      <li key={x.key}>
                        <Link to="/items/$number" params={{ number: numberOf(x.key) }} className="block truncate rounded px-1.5 py-0.5 text-[12px] text-danger hover:underline">
                          ⏰ {t("Due: {title}", { title: x.title })}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        </Card>
      ) : cal.isLoading ? (
        <Card>
          <LoadingRows />
        </Card>
      ) : events.length === 0 ? (
        <Card>
          <EmptyState title={t("Nothing on the calendar this month.")} />
        </Card>
      ) : (
        <div className="space-y-3">
          {events.map((e) => {
            const z = zoneOf(e.branch_id) ?? zone;
            return (
              <Card key={e.issue_id} className={cx("flex flex-wrap items-center gap-4 p-5", e.state === "cancelled" && "opacity-60")}>
                <DateBlock date={inZone(e.starts_at, z)} size="sm" />
                <Link to="/items/$number" params={{ number: String(e.number) }} className="min-w-0 flex-1">
                  <span className={cx("block text-[17px] font-semibold", e.state === "cancelled" && "line-through")}>{e.title}</span>
                  <span className="text-text-2">
                    {e.all_day ? t("All day") : `${formatTime(e.starts_at, z)}–${formatTime(e.ends_at, z)}`}
                    {e.location && ` · ${e.location}`}
                    {isAll && e.branch_id && ` · ${branchById.get(e.branch_id)?.code}`}
                    {e.state === "cancelled" && ` · ${t("Cancelled")}`}
                  </span>
                </Link>
                {e.my_rsvp && e.state === "open" && (
                  <div className="w-full sm:w-[360px]">
                    <RsvpButtons issueId={e.issue_id} current={e.my_rsvp} />
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

function EventChip({ e, zone }: { e: CalendarEntry; zone?: string }) {
  const r = e.my_rsvp;
  const style =
    r === "going"
      ? { background: "var(--event)", color: "var(--surface)" }
      : r === "maybe"
        ? { background: "repeating-linear-gradient(45deg, var(--event-soft), var(--event-soft) 4px, transparent 4px, transparent 8px)", color: "var(--event)", border: "1px solid var(--event)" }
        : r === "pending"
          ? { border: "1px dashed var(--event)", color: "var(--event)" }
          : { background: "var(--event-soft)", color: "var(--event)", opacity: r === "declined" ? 0.5 : 1 };
  return (
    <Link
      to="/items/$number"
      params={{ number: String(e.number) }}
      className={cx("block truncate rounded px-1.5 py-0.5 text-[12px] font-medium", (e.state === "cancelled" || r === "declined") && "line-through")}
      style={style}
      title={`${e.title}${r ? ` · ${r === "pending" ? t("Reply needed") : rsvpLabel[r]}` : ""}`}
    >
      {!e.all_day && <span className="tabular">{formatTime(e.starts_at, zone)} </span>}
      {e.title}
      <span className="sr-only">{r && <RsvpBadge response={r} mine />}</span>
    </Link>
  );
}
