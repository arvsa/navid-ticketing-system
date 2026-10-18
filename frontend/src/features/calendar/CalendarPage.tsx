// Calendar (UX_SPEC §4.9): month grid (weeks start Monday) and agenda, with
// "needs a reply" filter and my due dates.
import { useMemo, useState } from "react";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import {
  addDays,
  addMonths,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { useCalendar, useIssuesById, useWorkItems } from "@/api/hooks";
import type { CalendarEntry } from "@/api/types";
import { useBranch } from "@/app/BranchContext";
import { useNewItem } from "@/app/newItemContext";
import { DateBlock, RsvpBadge } from "@/components/badges";
import { Button, Card, Chip, EmptyState, ErrorPanel, LoadingRows, PageHeader, Segmented, cx } from "@/components/ui";
import { formatTime, inZone } from "@/lib/dates";
import { isDone, numberOf } from "@/lib/items";
import { RsvpButtons } from "@/features/events/RsvpButtons";

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
  const month = search.month ? new Date(`${search.month}-01T12:00:00`) : new Date();
  const gridStart = startOfWeek(startOfMonth(month), { weekStartsOn: 1 });
  const gridEnd = endOfWeek(endOfMonth(month), { weekStartsOn: 1 });
  const from = view === "month" ? gridStart : startOfMonth(month);
  const to = view === "month" ? addDays(gridEnd, 1) : addDays(startOfMonth(month), 60);
  const cal = useCalendar(from.toISOString(), to.toISOString(), branchId);
  const mine = useWorkItems({ assignee: "me", branch_id: branchId }, showDue);
  const dueItems = (mine.data ?? []).filter((w) => w.sla_due_at && !isDone(w));
  const dueIssues = useIssuesById(showDue ? dueItems.map((w) => w.issue_id) : []);

  const events = (cal.data ?? []).filter((e) => (filter === "reply" ? e.my_rsvp === "pending" : filter === "going" ? e.my_rsvp === "going" : true));
  const replyCount = (cal.data ?? []).filter((e) => e.my_rsvp === "pending" && e.state === "open").length;
  const goMonth = (d: Date) => navigate({ search: { month: format(d, "yyyy-MM") } });

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
        title="Calendar"
        actions={
          <Button variant="primary" size="lg" icon={<Plus className="size-5" />} onClick={() => openNew({ type: "event", onlyType: true })}>
            New event
          </Button>
        }
      />
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1">
          <Button variant="ghost" aria-label="Previous month" onClick={() => goMonth(addMonths(month, -1))}>
            <ChevronLeft className="size-5" />
          </Button>
          <Button onClick={() => navigate({ search: {} })}>Today</Button>
          <Button variant="ghost" aria-label="Next month" onClick={() => goMonth(addMonths(month, 1))}>
            <ChevronRight className="size-5" />
          </Button>
        </div>
        <h2 className="min-w-[180px] text-[22px] font-bold">{format(month, "MMMM yyyy")}</h2>
        <div className="ml-auto">
          <Segmented<View> label="View" value={view} onChange={setView} options={[{ value: "month", label: "Month" }, { value: "agenda", label: "Agenda" }]} />
        </div>
      </div>
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <Chip active={filter === "reply"} onClick={() => setFilter(filter === "reply" ? "all" : "reply")}>
          Needs a reply ({replyCount})
        </Chip>
        <Chip active={filter === "going"} onClick={() => setFilter(filter === "going" ? "all" : "going")}>
          Going
        </Chip>
        <Chip active={filter === "all"} onClick={() => setFilter("all")}>
          All
        </Chip>
        <label className="ml-2 inline-flex items-center gap-2">
          <input type="checkbox" checked={showDue} onChange={(e) => setShowDue(e.target.checked)} className="size-4" />
          Show my due dates
        </label>
      </div>

      {cal.error ? (
        <ErrorPanel error={cal.error} onRetry={() => cal.refetch()} />
      ) : view === "month" ? (
        <Card className="overflow-hidden">
          <div className="grid grid-cols-7 border-b border-border bg-surface-2 text-center text-[13px] font-semibold text-text-3">
            {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
              <div key={d} className="py-2">
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
                <div key={k} className={cx("min-h-[110px] border-r border-b border-border p-1.5 sm:p-2", !isSameMonth(d, month) && "bg-surface-2 text-text-3")}>
                  <div className="mb-1 flex items-center justify-between">
                    <span className={cx("flex size-7 items-center justify-center rounded-full text-[14px] tabular", today && "bg-primary font-bold text-on-primary")}>{d.getDate()}</span>
                    <button onClick={() => openNew({ type: "event", date: k, onlyType: true })} className="hidden rounded-full px-1.5 text-text-3 hover:bg-sunken sm:block" aria-label={`New event on ${format(d, "d MMMM")}`}>
                      +
                    </button>
                  </div>
                  <ul className="space-y-1">
                    {items.slice(0, 3).map((e) => (
                      <li key={e.issue_id}>
                        <EventChip e={e} zone={zoneOf(e.branch_id) ?? zone} />
                      </li>
                    ))}
                    {items.length > 3 && <li className="px-1 text-[12px] text-text-2">+{items.length - 3} more</li>}
                    {slot?.due.slice(0, 2).map((x) => (
                      <li key={x.key}>
                        <Link to="/items/$number" params={{ number: numberOf(x.key) }} className="block truncate rounded px-1.5 py-0.5 text-[12px] text-danger hover:underline">
                          ⏰ Due: {x.title}
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
          <EmptyState title="Nothing on the calendar this month." />
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
                    {e.all_day ? "All day" : `${formatTime(e.starts_at, z)}–${formatTime(e.ends_at, z)}`}
                    {e.location && ` · ${e.location}`}
                    {isAll && e.branch_id && ` · ${branchById.get(e.branch_id)?.code}`}
                    {e.state === "cancelled" && " · Cancelled"}
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
      title={`${e.title}${r ? ` · ${r === "pending" ? "Reply needed" : r}` : ""}`}
    >
      {!e.all_day && <span className="tabular">{formatTime(e.starts_at, zone)} </span>}
      {e.title}
      <span className="sr-only">{r && <RsvpBadge response={r} mine />}</span>
    </Link>
  );
}
