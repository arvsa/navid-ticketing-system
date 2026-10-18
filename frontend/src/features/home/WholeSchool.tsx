// Super admin overview of every branch ("Whole school" design).
import { Link, useNavigate } from "@tanstack/react-router";
import { ChevronRight, Download, Plus } from "lucide-react";
import { useDashboard, useIssueList, useIssuesById } from "@/api/hooks";
import type { IssueDetail, WorkItem } from "@/api/types";
import { useBranch } from "@/app/BranchContext";
import { useNewItem } from "@/app/newItemContext";
import { StatusBadge, TypeBadge } from "@/components/badges";
import { Button, Card, EmptyState, ErrorPanel, PageHeader, SectionLabel, Skeleton, cx } from "@/components/ui";
import { formatDay, timeAgo } from "@/lib/dates";
import { numberOf } from "@/lib/items";
import { useViewer } from "@/lib/useViewer";
import { usePeople, type Directory } from "@/people/usePeople";

export function WholeSchool() {
  const { options, setBranch } = useBranch();
  const openNew = useNewItem();
  const dash = useDashboard(undefined);
  const people = usePeople();
  const list = useIssueList({ state: "open" }, 100);
  const schoolWide = (list.data?.pages[0]?.items ?? []).filter((i) => i.branch_id === null).slice(0, 3);
  const details = useIssuesById(schoolWide.map((i) => i.id));
  const waiting = dash.data?.mine.awaiting_my_approval ?? 0;
  const staff = new Set(people.all.filter((p) => p.branchIds.length > 0).map((p) => p.id)).size;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Whole school"
        subtitle={`${options.length} branches${staff ? ` · about ${Math.round(staff / 10) * 10 || staff} staff` : ""}${waiting ? ` · ${waiting} submission${waiting === 1 ? "" : "s"} waiting for you` : ""}`}
        actions={
          <>
            <Link to="/export">
              <Button size="lg" icon={<Download className="size-5" />}>
                Export whole school
              </Button>
            </Link>
            <Button variant="primary" size="lg" icon={<Plus className="size-5" />} onClick={() => openNew()}>
              Send to branches
            </Button>
          </>
        }
      />

      {list.isLoading ? (
        <Skeleton className="h-48" />
      ) : (
        schoolWide.map((s) => <SchoolWideCard key={s.id} issue={details.map.get(s.id)} people={people} />)
      )}

      <section className="space-y-3">
        <SectionLabel>Branches</SectionLabel>
        {dash.error ? (
          <ErrorPanel error={dash.error} onRetry={() => dash.refetch()} />
        ) : (
          <Card className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left">
              <thead className="border-b border-border text-[13px] tracking-[0.06em] text-text-3 uppercase">
                <tr>
                  <th className="px-6 py-4 font-semibold">Branch</th>
                  <th className="px-4 py-4 font-semibold">Admins</th>
                  <th className="px-4 py-4 text-right font-semibold">Open</th>
                  <th className="px-4 py-4 text-right font-semibold">Overdue</th>
                  <th className="px-4 py-4 text-right font-semibold">Waiting for approval</th>
                  <th className="px-4 py-4 text-right font-semibold">Due in 7 days</th>
                  <th className="px-6 py-4" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border tabular">
                {(dash.data?.branches ?? []).map((b) => {
                  const admins = people.all.filter((p) => p.adminOf.includes(b.branch_id));
                  const open = b.open_issues_by_type ? Object.values(b.open_issues_by_type).reduce((x, y) => x + y, 0) : null;
                  return (
                    <tr key={b.branch_id}>
                      <td className="px-6 py-4">
                        <span className="font-semibold">{b.name}</span> <span className="font-mono text-[13px] text-text-3">{b.code}</span>
                      </td>
                      <td className="px-4 py-4">
                        {admins.length === 0
                          ? "—"
                          : admins.map((a, i) => (
                              <span key={a.id}>
                                {i > 0 && ", "}
                                <Link to="/people" search={{ person: a.id, branch: b.branch_id }} className="text-primary hover:underline">
                                  {people.short(a.id)}
                                </Link>
                              </span>
                            ))}
                        {admins.length === 1 && (
                          <span className="ml-2 rounded-full bg-warning-soft px-2 py-0.5 text-[13px] font-semibold text-warning">Only one admin</span>
                        )}
                      </td>
                      <td className="px-4 py-4 text-right">{open ?? "—"}</td>
                      <td className={cx("px-4 py-4 text-right", b.overdue_work_items ? "font-semibold text-danger" : "text-text-3")}>
                        {b.overdue_work_items ?? "—"}
                      </td>
                      <td className="px-4 py-4 text-right">{b.work_items_by_status?.pending_approval ?? "—"}</td>
                      <td className="px-4 py-4 text-right">{b.due_next_7_days ?? "—"}</td>
                      <td className="px-6 py-4 text-right">
                        <button className="text-primary hover:underline" onClick={() => setBranch(b.branch_id)}>
                          Open branch
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        )}
        <p className="text-text-2">A branch always keeps at least one admin. To replace a branch's only admin, appoint the new one first.</p>
      </section>

      <div className="grid gap-4 md:grid-cols-3">
        <LinkCard to="/branches" title="Appoint a branch admin" text="Only super admins can do this" />
        <LinkCard to="/branches" title="Open a new branch" text="Created together with its first admin" />
        <LinkCard to="/export" title="Export to Excel" text="Any branch, or the whole school" />
      </div>
    </div>
  );
}

function LinkCard({ to, title, text }: { to: "/branches" | "/export"; title: string; text: string }) {
  return (
    <Link to={to} className="rounded-[22px] bg-surface px-6 py-5 shadow-1 ring-1 ring-border transition-[box-shadow,transform] hover:-translate-y-px hover:shadow-2">
      <span className="block text-[18px] font-semibold">{title}</span>
      <span className="text-text-2">{text}</span>
    </Link>
  );
}

function SchoolWideCard({ issue, people }: { issue?: IssueDetail; people: Directory }) {
  const viewer = useViewer();
  const navigate = useNavigate();
  const { branchById } = useBranch();
  if (!issue) return <Skeleton className="h-40" />;
  const work = issue.work_items.filter((w) => w.status !== "cancelled");
  const approved = work.filter((w) => w.status === "approved").length;
  const due = work.map((w) => w.sla_due_at).filter(Boolean).sort()[0];
  const n = numberOf(issue.key);
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-6 py-4">
        <TypeBadge type={issue.type} />
        <Link to="/items/$number" params={{ number: n }} className="text-[18px] font-semibold hover:underline">
          {issue.title}
        </Link>
        <span className="text-[14px] text-text-2">
          {issue.created_by === viewer.me.user.id ? "You" : people.short(issue.created_by)} sent it {formatDay(issue.created_at)}
          {due && ` · due ${formatDay(due)}`}
          {issue.requires_super_admin_approval && " · only super admins approve it"}
        </span>
        <span className="ml-auto font-semibold">
          {approved} of {work.length} approved
        </span>
      </div>
      {work.length === 0 ? (
        <EmptyState title="No branch has this yet." />
      ) : (
        <ul className="divide-y divide-border">
          {work.map((w) => (
            <BranchRow key={w.id} w={w} people={people} branchName={branchById.get(w.branch_id)?.name ?? "Branch"} onReview={() => navigate({ to: "/items/$number", params: { number: n }, search: { review: w.id } })} />
          ))}
        </ul>
      )}
    </Card>
  );
}

function BranchRow({ w, people, branchName, onReview }: { w: WorkItem; people: Directory; branchName: string; onReview: () => void }) {
  const waiting = w.status === "pending_approval";
  const who = w.assignee_id ? people.short(w.assignee_id) : null;
  const text =
    w.status === "approved"
      ? `Done by ${who} · approved ${w.decided_at ? timeAgo(w.decided_at) : ""}`
      : waiting
        ? `Done by ${who} · submitted ${w.submitted_at ? timeAgo(w.submitted_at) : ""}`
        : who
          ? `With ${who}`
          : "Waiting for the branch admin to hand it to someone";
  return (
    <li className="px-2">
      <button onClick={onReview} className={cx("group flex w-full flex-wrap items-center gap-x-4 gap-y-1 rounded-[14px] px-4 py-3 text-left hover:bg-sunken", waiting && "bg-warning-soft/60")}>
        <span className="w-40 font-semibold">{branchName}</span>
        <span className="min-w-0 flex-1 text-text-2">{text}</span>
        <StatusBadge status={w.status} forMe={waiting} />
        <ChevronRight className="size-4 text-text-3 transition-transform group-hover:translate-x-0.5" aria-hidden />
      </button>
    </li>
  );
}
