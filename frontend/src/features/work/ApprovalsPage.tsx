// Approvals queue (UX_SPEC §4.8): grouped by item, oldest submission first,
// approve inline with undo, bulk approve. There's no "approvable by me" filter
// (gap G-3), so my own work and school-wide work (unless I'm a super admin) are
// filtered out here.
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useIssuesById, useWorkItems } from "@/api/hooks";
import type { WorkItem } from "@/api/types";
import { useBranch } from "@/app/BranchContext";
import { Avatar, TypeBadge } from "@/components/badges";
import { Button, Card, Dialog, EmptyState, ErrorPanel, LoadingRows, PageHeader } from "@/components/ui";
import { canApprove } from "@/lib/can";
import { timeAgo } from "@/lib/dates";
import { numberOf } from "@/lib/items";
import { useViewer } from "@/lib/useViewer";
import { usePeople } from "@/people/usePeople";
import { useApproveWithUndo } from "./approve";
import { RowLink } from "@/components/rows";
import { t, tn } from "@/i18n";

export function ApprovalsPage() {
  const viewer = useViewer();
  const people = usePeople();
  const approve = useApproveWithUndo();
  const { branchId, branch, branchById, isAll } = useBranch();
  const waiting = useWorkItems({ status: "pending_approval", branch_id: branchId });
  const raw = (waiting.data ?? []).filter((w) => w.assignee_id !== viewer.me.user.id);
  const issues = useIssuesById(raw.map((w) => w.issue_id));
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState(false);
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  const mine = raw.filter((w) => {
    const issue = issues.map.get(w.issue_id);
    return issue ? canApprove(viewer, issue, w) && !hidden.has(w.id) : false;
  });
  const groups = new Map<string, WorkItem[]>();
  for (const w of [...mine].sort((a, b) => (a.submitted_at ?? "").localeCompare(b.submitted_at ?? ""))) {
    groups.set(w.issue_id, [...(groups.get(w.issue_id) ?? []), w]);
  }
  const chosen = mine.filter((w) => selected.has(w.id));
  const toggle = (id: string) => setSelected((s) => {
    const next = new Set(s);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
  const approveNow = (items: WorkItem[]) => {
    setHidden((h) => new Set([...h, ...items.map((w) => w.id)]));
    setSelected(new Set());
    approve(items, undefined, items.length === 1 ? t("Approved {name}'s work", { name: people.short(items[0].assignee_id) }) : t("Approved {n} pieces of work", { n: items.length }));
    setTimeout(() => setHidden(new Set()), 7000);
  };

  return (
    <div className="mx-auto max-w-[1100px]">
      <PageHeader
        title={mine.length ? t("Waiting for your approval ({n})", { n: mine.length }) : t("Waiting for your approval")}
        subtitle={branch?.name ?? (isAll ? t("All branches") : undefined)}
        actions={
          chosen.length > 0 && (
            <Button variant="success" size="lg" onClick={() => setConfirm(true)}>
              {t("Approve selected ({n})", { n: chosen.length })}
            </Button>
          )
        }
      />
      {waiting.isLoading || issues.isLoading ? (
        <Card>
          <LoadingRows />
        </Card>
      ) : waiting.error ? (
        <ErrorPanel error={waiting.error} onRetry={() => waiting.refetch()} />
      ) : groups.size === 0 ? (
        <Card>
          <EmptyState title={t("No work is waiting for your approval.")} />
        </Card>
      ) : (
        <div className="space-y-5">
          {[...groups.entries()].map(([issueId, items]) => {
            const issue = issues.map.get(issueId)!;
            const n = numberOf(issue.key);
            return (
              <Card key={issueId}>
                <div className="flex flex-wrap items-center gap-3 border-b border-border px-6 py-4">
                  <TypeBadge type={issue.type} />
                  <Link to="/items/$number" params={{ number: n }} className="font-semibold hover:underline">
                    {issue.title}
                  </Link>
                  <span className="text-text-2">· {t("{n} waiting", { n: items.length })}</span>
                  {issue.branch_id === null && <span className="rounded-full bg-primary-soft px-2 text-[13px] font-semibold text-primary-on-soft">{t("School-wide")}</span>}
                </div>
                <ul className="divide-y divide-border">
                  {items.map((w) => {
                    const p = people.get(w.assignee_id);
                    return (
                      <li key={w.id} className="flex items-center gap-2 px-2">
                        <input type="checkbox" className="ms-2 size-5 shrink-0" checked={selected.has(w.id)} onChange={() => toggle(w.id)} aria-label={t("Select {name}", { name: people.name(w.assignee_id) })} />
                        <RowLink
                          className="w-auto min-w-0 flex-1"
                          link={{ to: "/items/$number", params: { number: n }, search: { review: w.id } }}
                          leading={<Avatar first={p?.first_name} last={p?.last_name} id={w.assignee_id ?? ""} size={40} />}
                          title={
                            <>
                              {people.name(w.assignee_id)}
                              {isAll && <span className="ms-2 text-[13px] font-normal text-text-3">{branchById.get(w.branch_id)?.code}</span>}
                            </>
                          }
                          meta={`${issue.type === "report" ? t("Handed in {when}", { when: w.submitted_at ? timeAgo(w.submitted_at) : "" }) : t("Sent {when}", { when: w.submitted_at ? timeAgo(w.submitted_at) : "" })}${w.decided_at ? ` · ${t("handed in again")}` : ""}`}
                        />
                        <Button size="sm" variant="success" onClick={() => approveNow([w])}>
                          {t("Approve")}
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              </Card>
            );
          })}
        </div>
      )}
      <Dialog
        open={confirm}
        onOpenChange={setConfirm}
        title={tn(chosen.length, "Approve {n} piece of work?", "Approve {n} pieces of work?")}
        description={chosen.map((w) => people.name(w.assignee_id)).join(t(", "))}
        footer={
          <>
            <Button onClick={() => setConfirm(false)}>{t("Cancel")}</Button>
            <Button variant="success" onClick={() => (approveNow(chosen), setConfirm(false))}>
              {t("Approve {n}", { n: chosen.length })}
            </Button>
          </>
        }
      >
        <p className="text-text-2">{t("Each person is told straight away. There's no bulk send back: each needs its own note.")}</p>
      </Dialog>
    </div>
  );
}
