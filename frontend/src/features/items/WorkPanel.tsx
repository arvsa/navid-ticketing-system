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
import { canApprove, canAssign, canCancelWork, isAdminOf, isSuper } from "@/lib/can";
import { formatDay, lateBy, timeAgo } from "@/lib/dates";
import { isSentBack, sortWork } from "@/lib/items";
import { errorMessage, workStatusLabel } from "@/lib/labels";
import { useViewer } from "@/lib/useViewer";
import { usePeople } from "@/people/usePeople";
import { useApproveWithUndo } from "@/features/work/approve";
import { StatPill } from "@/components/rows";
import { ConfirmDialog } from "./ItemDialogs";
import { CommentThread } from "./Comments";

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
    { b: "waiting", label: approver ? "waiting for you" : "waiting for approval", tone: "warning" },
    { b: "progress", label: "in progress", tone: "primary" },
    { b: "not_started", label: "not started", tone: "neutral" },
    { b: "approved", label: "approved", tone: "success" },
  ];
  return (
    <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 scrollbar-none">
      {pills.map((t) => (
        <StatPill
          key={t.b}
          value={counts[t.b]}
          label={t.label}
          tone={counts[t.b] ? t.tone : "neutral"}
          active={filter === t.b}
          onClick={() => onFilter(filter === t.b ? null : t.b)}
        />
      ))}
    </div>
  );
}

function subline(w: WorkItem, report: Report | undefined, myId: string, name: (id?: string | null) => string, zone?: string) {
  if (w.status === "approved") return `Approved${w.decided_by ? ` by ${w.decided_by === myId ? "you" : name(w.decided_by)}` : ""}${w.decided_at ? ` ${timeAgo(w.decided_at)}` : ""}`;
  if (w.status === "pending_approval") return `Submitted ${w.submitted_at ? timeAgo(w.submitted_at) : ""}`;
  if (w.status === "cancelled") return "No longer needed";
  if (!w.assignee_id) return "Not picked up yet";
  const parts: string[] = [];
  if (isSentBack(w)) parts.push(`Sent back by ${w.decided_by === myId ? "you" : name(w.decided_by)} ${timeAgo(w.decided_at!)}`);
  if (report && !report.submitted_at) parts.push(`draft saved ${timeAgo(report.updated_at)}`);
  if (w.status === "blocked") parts.push("blocked");
  if (w.status === "open") parts.push("Not opened yet");
  if (w.is_overdue && w.sla_due_at) parts.push(lateBy(w.sla_due_at)!);
  else if (w.status === "open" && w.sla_due_at) parts.push(`due ${formatDay(w.sla_due_at, zone)}`);
  return parts.join(" · ") || "Working on it";
}

export function PeopleList({ issue, filter, reviewing, onReview }: { issue: IssueDetail; filter: Bucket | null; reviewing?: string; onReview: (id: string) => void }) {
  const viewer = useViewer();
  const people = usePeople();
  const { zoneOf, branchById } = useBranch();
  const reports = useReports(issue.id, issue.type === "report");
  const byWork = new Map((reports.data ?? []).map((r) => [r.work_item_id, r]));
  const [showApproved, setShowApproved] = useState(false);
  const myId = viewer.me.user.id;
  const all = sortWork(issue.work_items, myId).filter((w) => w.status !== "cancelled");
  let rows = filter ? all.filter((w) => bucketOf(w.status) === filter) : all;
  const approved = rows.filter((w) => w.status === "approved");
  if (!filter && !showApproved && approved.length > 0 && approved.length < rows.length) rows = rows.filter((w) => w.status !== "approved");
  const schoolWide = issue.branch_id === null;
  if (all.length === 0) return <p className="px-6 py-8 text-center text-text-2">No one has a part of this yet.</p>;
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
                className={cx("group flex w-full items-center gap-3 rounded-[14px] px-3 py-3 text-left hover:bg-sunken", reviewing === w.id && "bg-warning-soft")}
              >
                {w.assignee_id ? (
                  <Avatar first={p?.first_name} last={p?.last_name} id={w.assignee_id} size={40} />
                ) : (
                  <span className="size-10 shrink-0 rounded-full border-2 border-dashed border-border-strong" aria-hidden />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">
                    {schoolWide && <span className="text-text-2">{branchById.get(w.branch_id)?.name} · </span>}
                    {isMe ? "You" : w.assignee_id ? people.short(w.assignee_id) : "Nobody yet"}
                  </span>
                  <span className="block truncate text-[14px] text-text-2">{subline(w, byWork.get(w.id), myId, people.short, zoneOf(w.branch_id))}</span>
                </span>
                {approve ? (
                  <span className="rounded-full bg-warning-soft px-2.5 py-0.5 text-[13px] font-semibold text-warning">Review</span>
                ) : assign ? (
                  <span className="rounded-full bg-sunken px-2.5 py-0.5 text-[13px] font-semibold">Assign</span>
                ) : (
                  <StatusBadge status={w.status} />
                )}
                <ChevronRight className="size-4 shrink-0 text-text-3 transition-transform group-hover:translate-x-0.5" aria-hidden />
              </button>
            </li>
          );
        })}
      </ul>
      {!filter && approved.length > 0 && approved.length < all.length && (
        <button onClick={() => setShowApproved(!showApproved)} className="flex w-full items-center gap-2 rounded-[14px] px-3 py-3 font-medium text-success hover:bg-sunken">
          {showApproved ? <ChevronDown className="size-5 rotate-180" /> : <Check className="size-5" />}
          {showApproved ? "Hide approved" : `Show ${approved.length} approved`}
        </button>
      )}
    </div>
  );
}

export function ReviewDrawer({ issue, workId, onClose, onSelect }: { issue: IssueDetail; workId?: string; onClose: () => void; onSelect: (id: string) => void }) {
  return (
    <Drawer open={!!workId} onOpenChange={(o) => !o && onClose()} label="Review">
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
        <p>This assignment isn't part of this item any more.</p>
        <Button className="mt-3" onClick={onClose}>
          Close
        </Button>
      </div>
    );
  }
  const queue = issue.work_items.filter((x) => canApprove(viewer, issue, x)).sort((a, b) => (a.submitted_at ?? "").localeCompare(b.submitted_at ?? ""));
  const index = queue.findIndex((x) => x.id === w.id);
  const next = queue.find((x, i) => i !== index && x.id !== w.id && i > index) ?? queue.find((x) => x.id !== w.id);
  const approve = canApprove(viewer, issue, w);
  const person = people.get(w.assignee_id);
  const first = person?.first_name ?? "them";
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
              Review {index + 1} of {queue.length}
            </p>
          )}
          <h2 className="text-[22px] font-bold">
            {w.assignee_id ? `${people.short(w.assignee_id)}'s ${issue.type === "report" ? "report" : "work"}` : "Nobody has this yet"}
          </h2>
        </div>
        <DrawerClose className="rounded-[10px] bg-sunken p-2.5 hover:bg-border" aria-label="Close">
          <X className="size-5" />
        </DrawerClose>
      </div>
      <div className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
        <p className="text-text-2">
          {w.status === "pending_approval"
            ? `Submitted ${w.submitted_at ? timeAgo(w.submitted_at) : ""} · ${w.decided_at ? "handed in again after being sent back" : "first submission"}`
            : `${workStatusLabel[w.status]}${w.sla_due_at ? ` · due ${formatDay(w.sla_due_at)}` : ""}`}
        </p>
        {w.decision_note && w.status !== "pending_approval" && (
          <div className="rounded-[10px] bg-sunken p-3 text-[15px]">
            <b>Note from {people.short(w.decided_by)}:</b> “{w.decision_note}”
          </div>
        )}
        {issue.type === "report" &&
          (report ? (
            <div className="space-y-3">
              <div className="rounded-[12px] border border-border bg-surface-2 p-5">
                <h3 className="text-[18px] font-semibold">{report.title}</h3>
                <p className="mt-3 text-[16px] leading-7 whitespace-pre-wrap break-anywhere">{report.body}</p>
                {!report.submitted_at && <p className="mt-3 text-[14px] text-text-3">Draft — not handed in yet.</p>}
              </div>
              <FileList files={report.attachments} wide />
            </div>
          ) : (
            <p className="text-text-2">No written report yet.</p>
          ))}
        <div>
          <h3 className="mb-3 font-semibold">About this {issue.type === "report" ? "report" : "work"}</h3>
          <CommentThread issue={issue} workItemId={w.id} compact emptyText="No comments on this part yet." />
        </div>

        {approve && (
          <Field label={`Note for ${first}`} error={needNote ? `Add a note so ${first} knows what to change.` : null}>
            {(p) => (
              <textarea
                {...p}
                value={note}
                onChange={(e) => (setNote(e.target.value), setNeedNote(false))}
                rows={4}
                placeholder={`Optional when approving. Needed if you send it back, so ${first} knows what to change.`}
                className={inputClass}
              />
            )}
          </Field>
        )}
        {branchAdminOnSchoolWide && <p className="rounded-[10px] bg-sunken p-3">Only super admins approve this work.</p>}

        {!approve && canAssign(viewer, issue, w) && (
          <div className="space-y-3">
            {assigning || !w.assignee_id ? (
              <>
                <h3 className="font-semibold">{w.assignee_id ? "Hand it to someone else" : "Hand it to someone"}</h3>
                <PersonSelect people={branchPeople} value={assignee} onChange={setAssignee} exclude={w.assignee_id ? [w.assignee_id] : []} />
                <Button
                  variant="primary"
                  disabled={!assignee}
                  loading={transition.isPending}
                  onClick={() =>
                    transition.mutate(
                      { item: w, transition: "assign", assignee_id: assignee },
                      {
                        onSuccess: () => (toast.success(`Given to ${people.short(assignee)}`), setAssigning(false)),
                        onError: (e) => toast.error(errorMessage(e)),
                      },
                    )
                  }
                >
                  {w.assignee_id ? "Reassign" : "Assign"}
                </Button>
              </>
            ) : (
              <Button onClick={() => setAssigning(true)}>Reassign…</Button>
            )}
          </div>
        )}
        {canCancelWork(viewer, issue, w) && (
          <Button variant="ghost-danger" onClick={() => setConfirmCancel(true)}>
            Cancel this assignment
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
                approveLater([w], note, `Approved ${people.short(w.assignee_id)}'s ${issue.type === "report" ? "report" : "work"}`);
                goNext();
              }}
            >
              Approve
            </Button>
            <Button
              size="lg"
              loading={transition.isPending}
              onClick={() => {
                if (!note.trim()) return setNeedNote(true);
                transition.mutate(
                  { item: w, transition: "reject", note: note.trim() },
                  {
                    onSuccess: () => (toast.success(`Sent back to ${first}`), goNext()),
                    onError: (e) => toast.error(errorMessage(e)),
                  },
                );
              }}
            >
              Send back
            </Button>
          </div>
          <div className="mt-3 flex items-center justify-between text-[15px]">
            <span className="text-text-2">{first} is told straight away either way.</span>
            {next && (
              <button className="text-primary hover:underline" onClick={goNext}>
                Next: {people.short(next.assignee_id)} →
              </button>
            )}
          </div>
        </div>
      )}
      <ConfirmDialog
        open={confirmCancel}
        onOpenChange={setConfirmCancel}
        title="Cancel this assignment?"
        body={w.assignee_id ? `${people.short(w.assignee_id)} won't need to do this any more. They'll be told.` : "Nobody will be asked to do this part any more."}
        confirm="Cancel assignment"
        danger
        loading={transition.isPending}
        onConfirm={() =>
          transition.mutate(
            { item: w, transition: "cancel" },
            {
              onSuccess: () => (setConfirmCancel(false), toast.success("Assignment cancelled"), onClose()),
              onError: (e) => toast.error(errorMessage(e)),
            },
          )
        }
      />
    </>
  );
}
