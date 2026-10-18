// My work (UX_SPEC §4.3): everything assigned to me, plus shared work I can pick up.
import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Undo2 } from "lucide-react";
import { useIssuesById, useWorkItems } from "@/api/hooks";
import type { IssueDetail, WorkItem } from "@/api/types";
import { useBranch } from "@/app/BranchContext";
import { StatusBadge, TypeBadge } from "@/components/badges";
import { Card, EmptyState, ErrorPanel, LoadingRows, PageHeader, Skeleton, Tabs, cx } from "@/components/ui";
import { canClaim } from "@/lib/can";
import { formatDay, isDueSoon, lateBy } from "@/lib/dates";
import { isSentBack, numberOf } from "@/lib/items";
import { useViewer } from "@/lib/useViewer";
import { usePeople } from "@/people/usePeople";
import { WorkButton } from "./WorkButton";

type Tab = "todo" | "waiting" | "done";

export function MyWorkPage() {
  const viewer = useViewer();
  const { branchId, isAll, branchById, zoneOf } = useBranch();
  const [tab, setTab] = useState<Tab>("todo");
  const mine = useWorkItems({ assignee: "me", branch_id: branchId });
  const openShared = useWorkItems({ status: "open", branch_id: branchId });
  const all = mine.data ?? [];
  const groups = {
    todo: all.filter((w) => w.status === "open" || w.status === "in_progress" || w.status === "blocked"),
    waiting: all.filter((w) => w.status === "pending_approval"),
    done: all.filter((w) => w.status === "approved" || w.status === "cancelled").sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
  };
  const unassigned = (openShared.data ?? []).filter((w) => !w.assignee_id);
  const issues = useIssuesById([...groups[tab], ...unassigned].map((w) => w.issue_id));
  const grabs = unassigned.filter((w) => {
    const issue = issues.map.get(w.issue_id);
    return issue && canClaim(viewer, issue, w);
  });

  const sections = useMemo(() => {
    const list = [...groups[tab]].sort((a, b) => (a.sla_due_at ?? "9").localeCompare(b.sla_due_at ?? "9"));
    if (tab !== "todo") return [{ title: null as string | null, items: list }];
    const weekEnd = Date.now() + 7 * 86400_000;
    return [
      { title: "Overdue", items: list.filter((w) => w.is_overdue) },
      { title: "This week", items: list.filter((w) => !w.is_overdue && w.sla_due_at && new Date(w.sla_due_at).getTime() <= weekEnd) },
      { title: "Later", items: list.filter((w) => !w.is_overdue && w.sla_due_at && new Date(w.sla_due_at).getTime() > weekEnd) },
      { title: "No due date", items: list.filter((w) => !w.sla_due_at) },
    ].filter((s) => s.items.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mine.data, tab]);

  const empty = {
    todo: "Nothing on your plate. New work appears here the moment it's sent.",
    waiting: "Nothing is waiting for approval.",
    done: "Finished work will show here.",
  }[tab];

  return (
    <div className="mx-auto max-w-[1100px]">
      <PageHeader title="My work" />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "todo", label: "To do", count: groups.todo.length },
          { value: "waiting", label: "Waiting for approval", count: groups.waiting.length },
          { value: "done", label: "Done" },
        ]}
      />
      {tab === "todo" && grabs.length > 0 && (
        <Card className="mt-6">
          <h2 className="border-b border-border px-6 py-4 font-semibold">
            Up for grabs ({grabs.length}) <span className="font-normal text-text-2">— shared work for your groups</span>
          </h2>
          <ul className="divide-y divide-border">
            {grabs.map((w) => (
              <WorkRow key={w.id} w={w} issue={issues.map.get(w.issue_id)} branchCode={isAll ? branchById.get(w.branch_id)?.code : undefined} zone={zoneOf(w.branch_id)} />
            ))}
          </ul>
        </Card>
      )}
      <div className="mt-6 space-y-6">
        {mine.isLoading ? (
          <Card>
            <LoadingRows />
          </Card>
        ) : mine.error ? (
          <ErrorPanel error={mine.error} onRetry={() => mine.refetch()} />
        ) : sections.length === 0 || sections.every((s) => !s.items.length) ? (
          <Card>
            <EmptyState title={empty} />
          </Card>
        ) : (
          sections.map((s) => (
            <section key={s.title ?? "all"}>
              {s.title && <h2 className={cx("mb-2 font-semibold", s.title === "Overdue" && "text-danger")}>{s.title}</h2>}
              <Card>
                <ul className="divide-y divide-border">
                  {s.items.map((w) => (
                    <WorkRow key={w.id} w={w} issue={issues.map.get(w.issue_id)} branchCode={isAll ? branchById.get(w.branch_id)?.code : undefined} zone={zoneOf(w.branch_id)} />
                  ))}
                </ul>
              </Card>
            </section>
          ))
        )}
      </div>
    </div>
  );
}

function WorkRow({ w, issue, branchCode, zone }: { w: WorkItem; issue?: IssueDetail; branchCode?: string; zone?: string }) {
  const viewer = useViewer();
  const people = usePeople();
  const due = w.sla_due_at
    ? w.is_overdue
      ? { text: lateBy(w.sla_due_at), cls: "font-semibold text-danger" }
      : isDueSoon(w.sla_due_at)
        ? { text: "Due tomorrow", cls: "font-semibold text-warning" }
        : { text: `Due ${formatDay(w.sla_due_at, zone)}`, cls: "text-text-2" }
    : null;
  return (
    <li className="flex flex-wrap items-center gap-3 px-5 py-4 sm:flex-nowrap">
      <Link
        to={w.assignee_id === viewer.me.user.id ? "/items/$number/mine" : "/items/$number"}
        params={{ number: issue ? numberOf(issue.key) : "0" }}
        className="flex min-w-0 flex-1 items-center gap-3"
      >
        {issue ? <TypeBadge type={issue.type} /> : <Skeleton className="h-6 w-16" />}
        <span className="min-w-0">
          <span className="block font-semibold break-anywhere">{issue?.title ?? "…"}</span>
          <span className="flex flex-wrap gap-x-2 text-[14px] text-text-2">
            {issue && <span className="font-mono text-text-3">{issue.key}</span>}
            {branchCode && <span>· {branchCode}</span>}
            {issue && <span>· from {people.short(issue.created_by)}</span>}
            {isSentBack(w) && (
              <span className="inline-flex items-center gap-1 font-semibold text-sent-back">
                · <Undo2 className="size-3.5" /> Sent back
              </span>
            )}
          </span>
        </span>
      </Link>
      <StatusBadge status={w.status} />
      {due && <span className={cx("w-32 text-right", due.cls)}>{due.text}</span>}
      <div className="w-40 text-right">
        <WorkButton issue={issue} work={w} viewer={viewer} />
      </div>
    </li>
  );
}
