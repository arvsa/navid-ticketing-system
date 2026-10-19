// Assignments of an Action or Report: status tiles, the people list and the
// review drawer (Report detail + review panel design; UX_SPEC §4.5.2, §4.5.6).
import { useState } from "react";
import { Check, ChevronDown, ChevronRight, X } from "lucide-react";
import { toast } from "sonner";
import { useReports, useTransition } from "@/api/hooks";
import type { IssueDetail, Report, WorkItem, WorkStatus } from "@/api/types";
import { useBranch } from "@/app/BranchContext";
import { Avatar, StatusBadge } from "@/components/badges";
import { FileList } from "@/components/files";
import { PersonSelect } from "@/components/pickers";
import { Button, Drawer, DrawerClose, Field, cx, inputClass } from "@/components/ui";
import { canApprove, canAssign, canCancelWork, isAdminOf, isSuper, membership } from "@/lib/can";
import { formatDay, lateBy, timeAgo } from "@/lib/dates";
import { isSentBack, sortWork, useItemLabels } from "@/lib/items";
import { errorMessage, workStatusLabel } from "@/lib/labels";
import { useViewer } from "@/lib/useViewer";
import { usePeople } from "@/people/usePeople";
import { useApproveWithUndo } from "@/features/work/approve";
import { StatPill } from "@/components/rows";
import { ConfirmDialog } from "./ItemDialogs";
import { CommentThread } from "./Comments";
import { quote, t, tn } from "@/i18n";

type Bucket = "approved" | "waiting" | "progress" | "not_started";
const bucketOf = (s: WorkStatus): Bucket | null =>
  s === "approved" ? "approved" : s === "pending_approval" ? "waiting" : s === "in_progress" || s === "blocked" ? "progress" : s === "open" ? "not_started" : null;

/** Status counts as filter pills (click again to clear). */
export function StatusTiles({ issue, filter, onFilter }: { issue: IssueDetail; filter: Bucket | null; onFilter: (b: Bucket | null) => void }) {
  const viewer = useViewer();
  const counts = { approved: 0, waiting: 0, progress: 0, not_started: 0 };
  for (const w of issue.work_items) {
    const b = bucketOf(w.status);
    if (b) counts[b]++;
  }
  const approver = issue.work_items.some((w) => canApprove(viewer, issue, w));
  const pills: { b: Bucket; label: string; tone: "success" | "warning" | "primary" | "neutral" }[] = [
    { b: "waiting", label: approver ? t("waiting for you") : t("waiting for approval"), tone: "warning" },
    { b: "progress", label: t("in progress"), tone: "primary" },
    { b: "not_started", label: t("not started"), tone: "neutral" },
    { b: "approved", label: t("approved"), tone: "success" },
  ];
  return (
    <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 scrollbar-none">
      {pills.map((pill) => (
        <StatPill
          key={pill.b}
          value={counts[pill.b]}
          label={pill.label}
          tone={counts[pill.b] ? pill.tone : "neutral"}
          active={filter === pill.b}
          onClick={() => onFilter(filter === pill.b ? null : pill.b)}
        />
      ))}
    </div>
  );
}

function subline(w: WorkItem, report: Report | undefined, myId: string, name: (id?: string | null) => string, zone?: string) {
  const who = (id?: string | null) => (id === myId ? t("you") : name(id));
  if (w.status === "approved") {
    const when = w.decided_at ? timeAgo(w.decided_at) : "";
    return (w.decided_by ? t("Approved by {who} {when}", { who: who(w.decided_by), when }) : t("Approved {when}", { when })).trim();
  }
  if (w.status === "pending_approval") return t("Submitted {when}", { when: w.submitted_at ? timeAgo(w.submitted_at) : "" }).trim();
  if (w.status === "cancelled") return t("No longer needed");
  if (!w.assignee_id) return t("Waiting for the branch admin to hand it to someone");
  const parts: string[] = [];
  if (isSentBack(w)) parts.push(t("Sent back by {who} {when}", { who: who(w.decided_by), when: timeAgo(w.decided_at!) }));
  if (report && !report.submitted_at) parts.push(t("draft saved {when}", { when: timeAgo(report.updated_at) }));
  if (w.status === "blocked") parts.push(t("blocked"));
  if (w.status === "open") parts.push(t("Not opened yet"));
  if (w.is_overdue && w.sla_due_at) parts.push(lateBy(w.sla_due_at)!);
  else if (w.status === "open" && w.sla_due_at) parts.push(t("due {date}", { date: formatDay(w.sla_due_at, zone) }));
  return parts.join(" · ") || t("Working on it");
}

export function PeopleList({ issue, filter, reviewing, onReview }: { issue: IssueDetail; filter: Bucket | null; reviewing?: string; onReview: (id: string) => void }) {
  const viewer = useViewer();
  const people = usePeople();
  const { zoneOf } = useBranch();
  const reports = useReports(issue.id, issue.type === "report");
  const byWork = new Map((reports.data ?? []).map((r) => [r.work_item_id, r]));
  const [showApproved, setShowApproved] = useState(false);
  const myId = viewer.me.user.id;
  const labels = useItemLabels(issue);
  const schoolWide = issue.branch_id === null;
  const everything = sortWork(issue.work_items, myId).filter((w) => w.status !== "cancelled");
  // On school-wide items, each branch handles its own part; only super admins see them all.
  const all = schoolWide && !isSuper(viewer) ? everything.filter((w) => membership(viewer, w.branch_id)) : everything;
  const otherBranches = new Set(everything.filter((w) => !all.includes(w)).map((w) => w.branch_id)).size;
  let rows = filter ? all.filter((w) => bucketOf(w.status) === filter) : all;
  const approved = rows.filter((w) => w.status === "approved");
  if (!filter && !showApproved && approved.length > 0 && approved.length < rows.length) rows = rows.filter((w) => w.status !== "approved");
  if (all.length === 0)
    return (
      <p className="px-6 py-8 text-center text-text-2">
        {otherBranches ? tn(otherBranches, "This went to {n} other branch. Each handles its own part.", "This went to {n} other branches. Each handles its own part.") : t("No one has a part of this yet.")}
      </p>
    );
  return (
    <div className="rounded-[22px] bg-surface p-2 shadow-1 ring-1 ring-border">
      <ul>
        {rows.map((w) => {
          const p = people.get(w.assignee_id);
          const approve = canApprove(viewer, issue, w);
          const assign = !w.assignee_id && canAssign(viewer, issue, w);
          const isMe = w.assignee_id === myId;
          return (
            <li key={w.id}>
              <button
                onClick={() => onReview(w.id)}
                className={cx("group flex w-full items-center gap-3 rounded-[14px] px-3 py-3 text-start hover:bg-sunken", reviewing === w.id && "bg-warning-soft")}
              >
                {w.assignee_id ? (
                  <Avatar first={p?.first_name} last={p?.last_name} id={w.assignee_id} size={40} />
                ) : (
                  <span className="size-10 shrink-0 rounded-full border-2 border-dashed border-border-strong" aria-hidden />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">
                    {schoolWide && labels.branchName(w.branch_id) && <span className="text-text-2">{labels.branchName(w.branch_id)} · </span>}
                    {isMe ? t("You") : w.assignee_id ? labels.person(w.assignee_id) : t("Not assigned yet")}
                  </span>
                  <span className="block truncate text-[14px] text-text-2">{subline(w, byWork.get(w.id), myId, labels.person, zoneOf(w.branch_id))}</span>
                </span>
                {approve ? (
                  <span className="rounded-full bg-warning-soft px-2.5 py-0.5 text-[13px] font-semibold text-warning">{t("Review")}</span>
                ) : assign ? (
                  <span className="rounded-full bg-sunken px-2.5 py-0.5 text-[13px] font-semibold">{t("Assign")}</span>
                ) : (
                  <StatusBadge status={w.status} />
                )}
                <ChevronRight className="size-4 shrink-0 text-text-3 transition-transform group-hover:translate-x-0.5 rtl:-scale-x-100 rtl:group-hover:-translate-x-0.5" aria-hidden />
              </button>
            </li>
          );
        })}
      </ul>
      {otherBranches > 0 && (
        <p className="px-3 py-2 text-[14px] text-text-3">
          {tn(otherBranches, "{n} other branch has its own part.", "{n} other branches have their own part.")}
        </p>
      )}
      {!filter && approved.length > 0 && approved.length < all.length && (
        <button onClick={() => setShowApproved(!showApproved)} className="flex w-full items-center gap-2 rounded-[14px] px-3 py-3 font-medium text-success hover:bg-sunken">
          {showApproved ? <ChevronDown className="size-5 rotate-180" /> : <Check className="size-5" />}
          {showApproved ? t("Hide approved") : t("Show {n} approved", { n: approved.length })}
        </button>
      )}
    </div>
  );
}

export function ReviewDrawer({ issue, workId, onClose, onSelect }: { issue: IssueDetail; workId?: string; onClose: () => void; onSelect: (id: string) => void }) {
  return (
    <Drawer open={!!workId} onOpenChange={(o) => !o && onClose()} label={t("Review")}>
      {workId && <ReviewBody key={workId} issue={issue} workId={workId} onClose={onClose} onSelect={onSelect} />}
    </Drawer>
  );
}

function ReviewBody({ issue, workId, onClose, onSelect }: { issue: IssueDetail; workId: string; onClose: () => void; onSelect: (id: string) => void }) {
  const viewer = useViewer();
  const people = usePeople();
  const transition = useTransition();
  const approveLater = useApproveWithUndo();
  const reports = useReports(issue.id, issue.type === "report");
  const [note, setNote] = useState("");
  const [needNote, setNeedNote] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [assignee, setAssignee] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const w = issue.work_items.find((x) => x.id === workId);
  if (!w) {
    return (
      <div className="p-6">
        <p>{t("This assignment isn't part of this item any more.")}</p>
        <Button className="mt-3" onClick={onClose}>
          {t("Close")}
        </Button>
      </div>
    );
  }
  const queue = issue.work_items.filter((x) => canApprove(viewer, issue, x)).sort((a, b) => (a.submitted_at ?? "").localeCompare(b.submitted_at ?? ""));
  const index = queue.findIndex((x) => x.id === w.id);
  const next = queue.find((x, i) => i !== index && x.id !== w.id && i > index) ?? queue.find((x) => x.id !== w.id);
  const approve = canApprove(viewer, issue, w);
  const person = people.get(w.assignee_id);
  const first = person?.first_name ?? t("them");
  const labels = useItemLabels(issue);
  const report = reports.data?.find((r) => r.work_item_id === w.id);
  const goNext = () => (next ? onSelect(next.id) : onClose());
  const branchPeople = people.inBranch(w.branch_id);
  const branchAdminOnSchoolWide = issue.requires_super_admin_approval && !isSuper(viewer) && w.status === "pending_approval" && isAdminOf(viewer, w.branch_id);

  return (
    <>
      <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-5">
        <div>
          {approve && index >= 0 && (
            <p className="text-[13px] font-semibold tracking-[0.08em] text-warning uppercase">
              {t("Review {i} of {n}", { i: index + 1, n: queue.length })}
            </p>
          )}
          <h2 className="text-[22px] font-bold">
            {w.assignee_id
              ? issue.type === "report"
                ? t("{name}'s report", { name: labels.person(w.assignee_id) })
                : t("{name}'s work", { name: labels.person(w.assignee_id) })
              : `${labels.branchName(w.branch_id) ?? t("This part")} · ${t("not assigned yet")}`}
          </h2>
        </div>
        <DrawerClose className="rounded-[10px] bg-sunken p-2.5 hover:bg-border" aria-label={t("Close")}>
          <X className="size-5" />
        </DrawerClose>
      </div>
      <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
        <p className="text-text-2">
          {w.status === "pending_approval"
            ? `${t("Submitted {when}", { when: w.submitted_at ? timeAgo(w.submitted_at) : "" })} · ${w.decided_at ? t("handed in again after being sent back") : t("first submission")}`
            : `${workStatusLabel[w.status]}${w.sla_due_at ? ` · ${t("due {date}", { date: formatDay(w.sla_due_at) })}` : ""}`}
        </p>
        {w.decision_note && w.status !== "pending_approval" && (
          <div className="rounded-[10px] bg-sunken p-3 text-[15px]">
            <b>{t("Note from {name}:", { name: labels.person(w.decided_by) })}</b> {quote(w.decision_note)}
          </div>
        )}
        {issue.type === "report" &&
          (report ? (
            <div className="space-y-3">
              <div className="rounded-[12px] border border-border bg-surface-2 p-5">
                <h3 className="text-[18px] font-semibold">{report.title}</h3>
                <p className="mt-3 text-[16px] leading-7 whitespace-pre-wrap break-anywhere">{report.body}</p>
                {!report.submitted_at && <p className="mt-3 text-[14px] text-text-3">{t("Draft — not handed in yet.")}</p>}
              </div>
              <FileList files={report.attachments} wide />
            </div>
          ) : (
            <p className="text-text-2">{t("No written report yet.")}</p>
          ))}
        <div>
          <h3 className="mb-3 font-semibold">{issue.type === "report" ? t("About this report") : t("About this work")}</h3>
          <CommentThread issue={issue} workItemId={w.id} compact emptyText={t("No comments on this part yet.")} />
        </div>

        {approve && (
          <Field label={t("Note for {name}", { name: first })} error={needNote ? t("Add a note so {name} knows what to change.", { name: first }) : null}>
            {(p) => (
              <textarea
                {...p}
                value={note}
                onChange={(e) => (setNote(e.target.value), setNeedNote(false))}
                rows={4}
                placeholder={t("Optional when approving. Needed if you send it back, so {name} knows what to change.", { name: first })}
                className={inputClass}
              />
            )}
          </Field>
        )}
        {branchAdminOnSchoolWide && <p className="rounded-[10px] bg-sunken p-3">{t("Only super admins approve this work.")}</p>}

        {!approve && canAssign(viewer, issue, w) && (
          <div className="space-y-3">
            {assigning || !w.assignee_id ? (
              <>
                <h3 className="font-semibold">{w.assignee_id ? t("Hand it to someone else") : t("Hand it to someone")}</h3>
                <PersonSelect people={branchPeople} value={assignee} onChange={setAssignee} exclude={w.assignee_id ? [w.assignee_id] : []} />
                <Button
                  variant="primary"
                  disabled={!assignee}
                  loading={transition.isPending}
                  onClick={() =>
                    transition.mutate(
                      { item: w, transition: "assign", assignee_id: assignee },
                      {
                        onSuccess: () => (toast.success(t("Given to {name}", { name: people.short(assignee) })), setAssigning(false)),
                        onError: (e) => toast.error(errorMessage(e)),
                      },
                    )
                  }
                >
                  {w.assignee_id ? t("Reassign") : t("Assign")}
                </Button>
              </>
            ) : (
              <Button onClick={() => setAssigning(true)}>{t("Reassign…")}</Button>
            )}
          </div>
        )}
        {canCancelWork(viewer, issue, w) && (
          <Button variant="ghost-danger" onClick={() => setConfirmCancel(true)}>
            {t("Cancel this assignment")}
          </Button>
        )}
      </div>
      {approve && (
        <div className="border-t border-border px-6 py-5">
          <div className="grid grid-cols-2 gap-3">
            <Button
              variant="success"
              size="lg"
              icon={<Check className="size-5" />}
              onClick={() => {
                approveLater([w], note, issue.type === "report" ? t("Approved {name}'s report", { name: people.short(w.assignee_id) }) : t("Approved {name}'s work", { name: people.short(w.assignee_id) }));
                goNext();
              }}
            >
              {t("Approve")}
            </Button>
            <Button
              size="lg"
              loading={transition.isPending}
              onClick={() => {
                if (!note.trim()) return setNeedNote(true);
                transition.mutate(
                  { item: w, transition: "reject", note: note.trim() },
                  {
                    onSuccess: () => (toast.success(t("Sent back to {name}", { name: first })), goNext()),
                    onError: (e) => toast.error(errorMessage(e)),
                  },
                );
              }}
            >
              {t("Send back")}
            </Button>
          </div>
          <div className="mt-3 flex items-center justify-between text-[15px]">
            <span className="text-text-2">{t("{name} is told straight away either way.", { name: first })}</span>
            {next && (
              <button className="text-primary hover:underline" onClick={goNext}>
                {t("Next: {name}", { name: people.short(next.assignee_id) })} <span className="inline-block rtl:-scale-x-100">→</span>
              </button>
            )}
          </div>
        </div>
      )}
      <ConfirmDialog
        open={confirmCancel}
        onOpenChange={setConfirmCancel}
        title={t("Cancel this assignment?")}
        body={w.assignee_id ? t("{name} won't need to do this any more. They'll be told.", { name: people.short(w.assignee_id) }) : t("Nobody will be asked to do this part any more.")}
        confirm={t("Cancel assignment")}
        danger
        loading={transition.isPending}
        onConfirm={() =>
          transition.mutate(
            { item: w, transition: "cancel" },
            {
              onSuccess: () => (setConfirmCancel(false), toast.success(t("Assignment cancelled")), onClose()),
              onError: (e) => toast.error(errorMessage(e)),
            },
          )
        }
      />
    </>
  );
}
