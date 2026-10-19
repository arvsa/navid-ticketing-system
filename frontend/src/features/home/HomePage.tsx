// Home dashboard (UX_SPEC §4.2): what needs me, what's coming, what changed.
// Numbers are pills that open the matching list; everything else is a row you
// can click as a whole.
import { useMemo, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { Undo2 } from "lucide-react";
import { useDashboard, useIssueList, useIssuesById, useNotifications, useWorkItems } from "@/api/hooks";
import type { IssueDetail, WorkItem } from "@/api/types";
import { useBranch } from "@/app/BranchContext";
import { Avatar, ProgressBar, TypeBadge, progressOf } from "@/components/badges";
import { Dot, Panel, RowLink, StatPill } from "@/components/rows";
import { EmptyState, ErrorPanel, Skeleton, cx } from "@/components/ui";
import { canApprove, canAssign, hasGrant, isAdminOf, isSuper, mayApproveIn } from "@/lib/can";
import { dayNumber, formatDay, formatTime, greeting, inZone, isDueSoon, lateBy, shortAgo, timeAgo, weekdayShort } from "@/lib/dates";
import { isDone, isSentBack, numberOf } from "@/lib/items";
import { describeNotification } from "@/lib/notifications";
import { useViewer } from "@/lib/useViewer";
import { usePeople } from "@/people/usePeople";
import { WorkButton } from "@/features/work/WorkButton";
import { RsvpButtons } from "@/features/events/RsvpButtons";
import { WholeSchool } from "./WholeSchool";
import { num, t, tn } from "@/i18n";

export function HomePage() {
  const viewer = useViewer();
  const { branchId, isAll } = useBranch();
  if (isSuper(viewer) && isAll) return <WholeSchool />;
  const seesBranch = branchId ? isAdminOf(viewer, branchId) || hasGrant(viewer, branchId, "dashboard.branch") : false;
  return seesBranch ? <AdminHome /> : <StaffHome />;
}

function Greeting({ subtitle }: { subtitle?: string }) {
  const viewer = useViewer();
  return (
    <div>
      <h1 className="text-[30px] leading-9 font-bold tracking-tight sm:text-[36px] sm:leading-[44px]">
        {t("{greeting}, {name}", { greeting: greeting(), name: viewer.me.user.first_name })}
      </h1>
      {subtitle && <p className="mt-1 text-[17px] text-text-2">{subtitle}</p>}
    </div>
  );
}

type Need = { kind: "approve" | "overdue" | "owner"; w: WorkItem };

function AdminHome() {
  const viewer = useViewer();
  const people = usePeople();
  const navigate = useNavigate();
  const { branchId, branch, zoneOf } = useBranch();
  const zone = zoneOf(branchId);
  const dash = useDashboard(branchId);
  const numbers = dash.data?.branches.find((b) => b.branch_id === branchId);
  const mine = dash.data?.mine;
  // Only offer what this person can act on: the server would refuse the rest.
  const mayApprove = !!branchId && mayApproveIn(viewer, branchId);
  const mayAssign = !!branchId && (isAdminOf(viewer, branchId) || hasGrant(viewer, branchId, "work_item.assign"));
  const waiting = useWorkItems({ branch_id: branchId, status: "pending_approval" }, mayApprove);
  const active = useWorkItems({ branch_id: branchId });
  const myWork = useWorkItems({ assignee: "me", branch_id: branchId });
  const [filter, setFilter] = useState<Need["kind"] | "all">("all");

  const live = (active.data ?? []).filter((w) => !isDone(w));
  const overdue = live.filter((w) => w.is_overdue).sort((a, b) => (a.sla_due_at ?? "").localeCompare(b.sla_due_at ?? ""));
  const waitingRaw = mayApprove ? (waiting.data ?? []).filter((w) => w.assignee_id !== viewer.me.user.id) : [];
  const unownedRaw = mayAssign ? live.filter((w) => !w.assignee_id) : [];
  const myOpen = (myWork.data ?? []).filter((w) => !isDone(w) && w.status !== "pending_approval");
  const issues = useIssuesById([...waitingRaw, ...unownedRaw, ...overdue.slice(0, 20), ...myOpen.slice(0, 4)].map((w) => w.issue_id));
  // Item-level rules (never your own work, school-wide work only for super admins…).
  const toApprove = waitingRaw.filter((w) => {
    const issue = issues.map.get(w.issue_id);
    return issue ? canApprove(viewer, issue, w) : false;
  });
  const unowned = unownedRaw.filter((w) => {
    const issue = issues.map.get(w.issue_id);
    return issue ? canAssign(viewer, issue, w) : false;
  });
  const needs: Need[] = [
    ...toApprove.map((w) => ({ kind: "approve" as const, w })),
    ...unowned.map((w) => ({ kind: "owner" as const, w })),
    ...overdue.filter((w) => w.assignee_id).map((w) => ({ kind: "overdue" as const, w })),
  ];
  const shown = needs.filter((n) => filter === "all" || n.kind === filter).slice(0, 7);
  const openTotal = numbers?.open_issues_by_type ? Object.values(numbers.open_issues_by_type).reduce((a, b) => a + b, 0) : null;
  const decisions = toApprove.length + unowned.length;
  const loading = (mayApprove && waiting.isLoading) || active.isLoading || issues.isLoading;

  const open = (n: Need) => {
    const issue = issues.map.get(n.w.issue_id);
    if (!issue) return;
    navigate({ to: "/items/$number", params: { number: numberOf(issue.key) }, search: n.kind === "overdue" ? {} : { review: n.w.id } });
  };

  return (
    <div className="space-y-8">
      <div className="space-y-5">
        <Greeting subtitle={`${branch?.name ?? ""} · ${decisions ? tn(decisions, "{n} thing needs a decision from you", "{n} things need a decision from you") : t("nothing needs you right now")}`} />
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 scrollbar-none">
          {mayApprove && (
            <StatPill value={mine?.awaiting_my_approval ?? toApprove.length} label={t("to approve")} tone={toApprove.length ? "warning" : "neutral"} link={{ to: "/approvals" }} />
          )}
          {numbers?.overdue_work_items != null && <StatPill value={numbers.overdue_work_items} label={t("overdue")} tone={numbers.overdue_work_items ? "danger" : "neutral"} onClick={() => setFilter("overdue")} />}
          {openTotal != null && <StatPill value={openTotal} label={t("open items")} link={{ to: "/items" }} />}
          {numbers?.due_next_7_days != null && <StatPill value={numbers.due_next_7_days} label={t("due this week")} link={{ to: "/items" }} />}
          <StatPill value={mine?.upcoming_events.length ?? "—"} label={t("events soon")} link={{ to: "/calendar" }} />
        </div>
      </div>
      {dash.error && <ErrorPanel error={dash.error} onRetry={() => dash.refetch()} />}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-6">
          <Panel
            title={t("Needs you")}
            action={
              <div className="flex gap-1 overflow-x-auto scrollbar-none">
                {(
                  [
                    ["all", t("All"), needs.length, true],
                    ["approve", t("To approve"), toApprove.length, mayApprove],
                    ["overdue", t("Overdue"), overdue.filter((w) => w.assignee_id).length, true],
                    ["owner", t("No owner"), unowned.length, mayAssign],
                  ] as const
                )
                  .filter(([, , , allowed]) => allowed)
                  .map(([k, label, n]) => (
                  <button
                    key={k}
                    onClick={() => setFilter(k)}
                    aria-pressed={filter === k}
                    className={cx("h-8 rounded-full px-3 text-[13px] font-medium whitespace-nowrap", filter === k ? "bg-text text-surface" : "text-text-2 hover:bg-sunken")}
                  >
                    {label} <span className="tabular opacity-70">{num(n)}</span>
                  </button>
                ))}
              </div>
            }
          >
            {loading ? (
              <div className="space-y-2 p-2">
                <Skeleton className="h-12" />
                <Skeleton className="h-12" />
                <Skeleton className="h-12" />
              </div>
            ) : shown.length === 0 ? (
              <EmptyState title={t("Nothing here. Nice.")} />
            ) : (
              <ul>
                {shown.map((n) => {
                  const issue = issues.map.get(n.w.issue_id);
                  const p = people.get(n.w.assignee_id);
                  return (
                    <li key={`${n.kind}-${n.w.id}`}>
                      <RowLink
                        onClick={() => open(n)}
                        leading={
                          n.w.assignee_id ? (
                            <Avatar first={p?.first_name} last={p?.last_name} id={n.w.assignee_id} size={36} />
                          ) : (
                            <span className="size-9 shrink-0 rounded-full border-2 border-dashed border-border-strong" aria-hidden />
                          )
                        }
                        title={issue?.title ?? "…"}
                        meta={
                          n.kind === "approve"
                            ? t("{name} handed it in · {ago} ago", { name: people.short(n.w.assignee_id), ago: n.w.submitted_at ? shortAgo(n.w.submitted_at) : "" })
                            : n.kind === "owner"
                              ? t("Nobody has this yet — hand it to someone")
                              : `${people.short(n.w.assignee_id)} · ${n.w.status === "blocked" ? t("blocked") : n.w.status === "open" ? t("not started") : t("in progress")}`
                        }
                        trailing={
                          n.kind === "approve" ? (
                            <span className="rounded-full bg-warning-soft px-2.5 py-0.5 text-[13px] font-semibold text-warning">{t("Review")}</span>
                          ) : n.kind === "owner" ? (
                            <span className="rounded-full bg-sunken px-2.5 py-0.5 text-[13px] font-semibold">{t("Assign")}</span>
                          ) : (
                            <span className="text-[14px] font-semibold text-danger">{n.w.sla_due_at && lateBy(n.w.sla_due_at)}</span>
                          )
                        }
                      />
                    </li>
                  );
                })}
              </ul>
            )}
            {filter === "approve" && toApprove.length > shown.length && (
              <Link to="/approvals" className="block rounded-[14px] px-3 py-2.5 text-center font-medium text-primary hover:bg-sunken">
                {t("See all {n}", { n: toApprove.length })}
              </Link>
            )}
          </Panel>

          <SentOut branchId={branchId} zone={zone} />
        </div>

        <div className="space-y-6">
          {myOpen.length > 0 && (
            <Panel title={t("Your own to-do")} action={<Link to="/my-work" className="text-[14px] text-primary hover:underline">{t("My work")}</Link>}>
              <ul>
                {myOpen.slice(0, 4).map((w) => {
                  const issue = issues.map.get(w.issue_id);
                  return (
                    <li key={w.id} className="flex items-center gap-1">
                      <RowLink
                        className="w-auto min-w-0 flex-1"
                        chevron={false}
                        link={{ to: "/items/$number/mine", params: { number: issue ? numberOf(issue.key) : "0" } }}
                        leading={issue && <TypeBadge type={issue.type} />}
                        title={issue?.title ?? "…"}
                        meta={w.sla_due_at ? (w.is_overdue ? lateBy(w.sla_due_at) : t("Due {date}", { date: formatDay(w.sla_due_at, zone) })) : undefined}
                      />
                      <WorkButton issue={issue} work={w} viewer={viewer} size="sm" />
                    </li>
                  );
                })}
              </ul>
            </Panel>
          )}
          <ComingUp />
          <HappeningNow />
        </div>
      </div>
    </div>
  );
}

/** Items I created recently. There's no "created by me" filter (gap G-6), so this
 * looks at the 50 most recent open items and keeps mine. */
function SentOut({ branchId, zone }: { branchId?: string; zone?: string }) {
  const viewer = useViewer();
  const list = useIssueList({ branch_id: branchId, state: "open" }, 50);
  const mine = (list.data?.pages[0]?.items ?? []).filter((i) => i.created_by === viewer.me.user.id).slice(0, 5);
  const details = useIssuesById(mine.map((i) => i.id));
  return (
    <Panel title={t("Work you sent out")} action={<Link to="/items" className="text-[14px] text-primary hover:underline">{t("All items")}</Link>}>
      {list.isLoading ? (
        <div className="p-2">
          <Skeleton className="h-32" />
        </div>
      ) : mine.length === 0 ? (
        <EmptyState title={t("Nothing you sent is still open.")} />
      ) : (
        <ul>
          {mine.map((s) => (
            <li key={s.id}>
              <SentRow issue={details.map.get(s.id)} fallbackTitle={s.title} type={s.type} n={numberOf(s.key)} zone={zone} />
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function SentRow({ issue, fallbackTitle, type, n, zone }: { issue?: IssueDetail; fallbackTitle: string; type: IssueDetail["type"]; n: string; zone?: string }) {
  const work = issue?.work_items.filter((w) => w.status !== "cancelled") ?? [];
  const p = progressOf(work);
  const due = work.filter((w) => !isDone(w)).map((w) => w.sla_due_at).filter(Boolean).sort()[0];
  const meta = issue?.event
    ? `${formatDay(issue.event.starts_at, zone)} · ${formatTime(issue.event.starts_at, zone)} · ${t("{n} going", { n: issue.event.rsvp_counts.going })}`
    : work.length
      ? `${t("{done} of {total} approved", { done: p.approved, total: work.length })}${p.waiting ? ` · ${t("{n} to review", { n: p.waiting })}` : ""}${due ? ` · ${t("due {date}", { date: formatDay(due, zone) })}` : ""}`
      : type === "ticket"
        ? t("Waiting for an answer")
        : undefined;
  return (
    <RowLink
      link={{ to: "/items/$number", params: { number: n } }}
      leading={<TypeBadge type={type} />}
      title={issue?.title ?? fallbackTitle}
      meta={meta}
      trailing={work.length > 1 ? <ProgressBar p={p} className="hidden w-24 sm:flex" /> : undefined}
    />
  );
}

function ComingUp() {
  const { branchId, zoneOf } = useBranch();
  const dash = useDashboard(branchId);
  const events = (dash.data?.mine.upcoming_events ?? []).slice(0, 4);
  if (!events.length) return null;
  const zone = zoneOf(branchId);
  return (
    <Panel title={t("Coming up")} action={<Link to="/calendar" className="text-[14px] text-primary hover:underline">{t("Calendar")}</Link>}>
      <ul>
        {events.map((e) => {
          const d = inZone(e.starts_at, zone);
          return (
            <li key={e.issue_id}>
              <RowLink
                link={{ to: "/items/$number", params: { number: numberOf(e.key) } }}
                leading={
                  <span className="flex w-11 shrink-0 flex-col items-center rounded-[12px] bg-[var(--event-soft)] py-1 text-[var(--event)]">
                    <span className="max-w-full truncate px-0.5 text-[11px] font-semibold uppercase">{weekdayShort(d)}</span>
                    <span className="text-[17px] leading-5 font-bold tabular">{dayNumber(d)}</span>
                  </span>
                }
                title={e.title}
                meta={formatTime(e.starts_at, zone)}
                trailing={
                  e.my_rsvp === "pending" ? (
                    <span className="rounded-full bg-warning-soft px-2.5 py-0.5 text-[13px] font-semibold text-warning">{t("Reply")}</span>
                  ) : e.my_rsvp === "going" ? (
                    <span className="rounded-full bg-success-soft px-2.5 py-0.5 text-[13px] font-semibold text-success">{t("Going")}</span>
                  ) : undefined
                }
              />
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

function HappeningNow({ title = t("Happening now") }: { title?: string }) {
  const list = useNotifications(false, 5);
  const people = usePeople();
  const items = list.data?.pages[0]?.items ?? [];
  return (
    <Panel title={title} action={<Link to="/inbox" className="text-[14px] text-primary hover:underline">{t("Inbox")}</Link>}>
      {list.isLoading ? (
        <div className="p-2">
          <Skeleton className="h-28" />
        </div>
      ) : items.length === 0 ? (
        <EmptyState title={t("No updates yet.")} />
      ) : (
        <ul>
          {items.map((n) => {
            const d = describeNotification(n, people.short);
            const dot = <Dot tone={d.tone === "danger" ? "danger" : n.read_at ? "neutral" : "primary"} />;
            return (
              <li key={n.id}>
                {n.issue_key ? (
                  <RowLink link={{ to: "/items/$number", params: { number: numberOf(n.issue_key) } }} leading={dot} title={d.plain} meta={timeAgo(n.created_at)} chevron={false} />
                ) : (
                  <RowLink link={{ to: "/inbox" }} leading={dot} title={d.plain} meta={timeAgo(n.created_at)} chevron={false} />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

/** Staff Home: my to-do, replies needed, updates for me. */
function StaffHome() {
  const { branchId, branch, zoneOf } = useBranch();
  const dash = useDashboard(branchId);
  const myWork = useWorkItems({ assignee: "me", branch_id: branchId });
  const todo = useMemo(
    () =>
      (myWork.data ?? [])
        .filter((w) => w.status === "open" || w.status === "in_progress" || w.status === "blocked")
        .sort((a, b) => Number(isSentBack(b)) - Number(isSentBack(a)) || (a.sla_due_at ?? "z").localeCompare(b.sla_due_at ?? "z")),
    [myWork.data],
  );
  const issues = useIssuesById(todo.slice(0, 8).map((w) => w.issue_id));
  const replies = (dash.data?.mine.upcoming_events ?? []).filter((e) => e.my_rsvp === "pending");
  const tickets = dash.data?.branches.find((b) => b.branch_id === branchId)?.open_public_tickets;
  const overdue = todo.filter((w) => w.is_overdue).length;

  return (
    <div className="space-y-8">
      <div className="space-y-5">
        <Greeting subtitle={branch?.name} />
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 scrollbar-none">
          <StatPill value={todo.length} label={t("to do")} tone={todo.length ? "primary" : "neutral"} link={{ to: "/my-work" }} />
          {overdue > 0 && <StatPill value={overdue} label={t("overdue")} tone="danger" link={{ to: "/my-work" }} />}
          {replies.length > 0 && <StatPill value={replies.length} label={t("to reply")} tone="warning" link={{ to: "/calendar" }} />}
          {tickets != null && tickets > 0 && <StatPill value={tickets} label={t("open questions")} link={{ to: "/items", search: { type: "ticket" } }} />}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <Panel title={t("To do")} action={todo.length > 8 ? <Link to="/my-work" className="text-[14px] text-primary hover:underline">{t("See all {n}", { n: todo.length })}</Link> : undefined}>
          {myWork.isLoading ? (
            <div className="p-2">
              <Skeleton className="h-40" />
            </div>
          ) : todo.length === 0 ? (
            <EmptyState title={t("You're all caught up.")}>{t("Nothing is waiting for you.")}</EmptyState>
          ) : (
            <ul>
              {todo.slice(0, 8).map((w) => (
                <TodoRow key={w.id} work={w} issue={issues.map.get(w.issue_id)} zone={zoneOf(w.branch_id)} />
              ))}
            </ul>
          )}
        </Panel>

        <div className="space-y-6">
          {replies.length > 0 && (
            <Panel title={t("Reply needed")}>
              <ul className="space-y-1">
                {replies.map((e) => {
                  return (
                    <li key={e.issue_id} className="rounded-[14px] px-3 py-3">
                      <Link to="/items/$number" params={{ number: numberOf(e.key) }} className="block hover:underline">
                        <span className="font-medium">{e.title}</span>
                        <span className="block text-[14px] text-text-2">
                          {formatDay(e.starts_at, zoneOf(branchId))} · {formatTime(e.starts_at, zoneOf(branchId))}
                        </span>
                      </Link>
                      <div className="mt-2">
                        <RsvpButtons issueId={e.issue_id} current={e.my_rsvp ?? "pending"} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            </Panel>
          )}
          <HappeningNow title={t("For you")} />
        </div>
      </div>
    </div>
  );
}

function TodoRow({ work, issue, zone }: { work: WorkItem; issue?: IssueDetail; zone?: string }) {
  const viewer = useViewer();
  const people = usePeople();
  const sentBack = isSentBack(work);
  const late = work.sla_due_at && work.is_overdue;
  const soon = work.sla_due_at && !late && isDueSoon(work.sla_due_at);
  return (
    <li className="flex items-center gap-1">
      <RowLink
        className="w-auto min-w-0 flex-1"
        chevron={false}
        link={{ to: "/items/$number/mine", params: { number: issue ? numberOf(issue.key) : "0" } }}
        leading={issue ? <TypeBadge type={issue.type} /> : <Skeleton className="h-6 w-16" />}
        title={issue?.title ?? "…"}
        meta={
          sentBack ? (
            <span className="inline-flex items-center gap-1 text-sent-back">
              <Undo2 className="size-3.5" /> {t("Sent back: {note}", { note: work.decision_note })}
            </span>
          ) : issue ? (
            t("From {name}", { name: people.short(issue.created_by) })
          ) : undefined
        }
        trailing={
          work.sla_due_at && (
            <span className={cx("hidden text-[14px] whitespace-nowrap sm:block", late ? "font-semibold text-danger" : soon ? "font-semibold text-warning" : "text-text-2")}>
              {late ? lateBy(work.sla_due_at) : soon ? t("Due tomorrow") : formatDay(work.sla_due_at, zone)}
            </span>
          )
        }
      />
      {work.status === "open" && <WorkButton issue={issue} work={work} viewer={viewer} size="sm" />}
    </li>
  );
}
