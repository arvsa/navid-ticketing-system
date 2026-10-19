// My part of an Action or Report ("Staff — my assignment, sent back" design;
// UX_SPEC §4.5.6–4.5.7): progress steps, report editor with autosave, hand in.
import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { ApiError, api } from "@/api/client";
import { useIssue, useIssueByNumber, useReports, useTransition } from "@/api/hooks";
import { keys } from "@/api/keys";
import type { IssueDetail, Report, WorkItem } from "@/api/types";
import { useBranch } from "@/app/BranchContext";
import { TypeBadge } from "@/components/badges";
import { AttachButton, FileList, PendingFiles, UploadNow, reportFailedUploads, uploadAll, useFilePicker } from "@/components/files";
import { Button, Card, Dialog, EmptyState, ErrorPanel, Field, Skeleton, cx, inputClass } from "@/components/ui";
import { canClaim, isMine } from "@/lib/can";
import { dueIn, formatDateTime, formatTime, timeAgo } from "@/lib/dates";
import { isDone, isSentBack, numberOf, targetName, useGroupDirectory } from "@/lib/items";
import { errorMessage, modeLabel } from "@/lib/labels";
import { useViewer } from "@/lib/useViewer";
import { usePeople } from "@/people/usePeople";
import { CommentThread } from "@/features/items/Comments";

export function MyAssignmentPage() {
  const { number } = useParams({ from: "/authed/shell/items/$number/mine" });
  const lookup = useIssueByNumber(Number(number));
  const issue = useIssue(lookup.data);
  const viewer = useViewer();
  if (lookup.error || issue.error) return <ErrorPanel error={lookup.error ?? issue.error} />;
  if (!issue.data) return <Skeleton className="h-96" />;
  const mine =
    issue.data.work_items.find((w) => isMine(viewer, w) && !isDone(w)) ??
    issue.data.work_items.find((w) => isMine(viewer, w)) ??
    issue.data.work_items.find((w) => canClaim(viewer, issue.data!, w));
  if (!mine)
    return (
      <EmptyState title="You don't have a part of this item." action={<Link to="/items/$number" params={{ number }} className="text-primary hover:underline">Open the item</Link>} />
    );
  return <AssignmentView issue={issue.data} work={mine} />;
}

const STEPS = ["Not started", "Working on it", "Handed in", "Approved"];

function stepOf(w: WorkItem) {
  if (w.status === "approved") return 3;
  if (w.status === "pending_approval") return 2;
  if (w.status === "in_progress" || w.status === "blocked") return 1;
  return 0;
}

function AssignmentView({ issue, work }: { issue: IssueDetail; work: WorkItem }) {
  const people = usePeople();
  const groups = useGroupDirectory();
  const { zoneOf, branchById } = useBranch();
  const zone = zoneOf(work.branch_id);
  const step = stepOf(work);
  const sentBack = isSentBack(work);
  const n = numberOf(issue.key);
  const sentTo = issue.targets.find((t) => t.id === work.target_id);
  return (
    <div className="space-y-6">
      <nav aria-label="Breadcrumb" className="text-[17px]">
        <Link to="/my-work" className="text-primary hover:underline">
          My work
        </Link>
        <span className="mx-2 text-text-3">/</span>
        <Link to="/items/$number" params={{ number: n }} className="font-mono text-text-2 hover:underline">
          {issue.key}
        </Link>
      </nav>
      <div>
        <div className="flex flex-wrap items-center gap-2 text-[16px] text-text-2">
          <TypeBadge type={issue.type} />
          <span>
            From {people.short(issue.created_by)}
            {work.sla_due_at && (
              <>
                {" "}· due <b className="text-text">{formatDateTime(work.sla_due_at, zone)}</b>
                {!work.is_overdue && dueIn(work.sla_due_at, zone) && ` (${dueIn(work.sla_due_at, zone)})`}
                {work.is_overdue && <b className="text-danger"> · overdue</b>}
              </>
            )}
          </span>
        </div>
        <h1 className="mt-2 text-[30px] leading-9 font-bold break-anywhere sm:text-[38px] sm:leading-[46px]">{issue.title}</h1>
      </div>

      {sentBack && (
        <div className="flex gap-4 rounded-[14px] border border-sent-back-edge bg-sent-back-bg px-5 py-4" role="status">
          <Undo2 className="mt-0.5 size-6 shrink-0 text-sent-back" aria-hidden />
          <div>
            <p className="text-[17px] font-semibold text-sent-back">
              {people.short(work.decided_by).split(" ")[0]} sent this back to you {timeAgo(work.decided_at!).toLowerCase()}
            </p>
            <p className="mt-1 text-[17px]">“{work.decision_note}”</p>
          </div>
        </div>
      )}

      <ol className="grid grid-cols-4 gap-3" aria-label="Progress">
        {STEPS.map((s, i) => (
          <li key={s} aria-current={i === step ? "step" : undefined}>
            <div className={cx("h-1.5 rounded-full", i <= step ? "bg-primary" : "bg-border")} />
            <div className={cx("mt-2 text-[14px] sm:text-[16px]", i === step ? "font-semibold" : "text-text-2")}>
              {s}
              {i === 1 && i === step && sentBack && <span className="hidden sm:inline"> · sent back</span>}
              {i === 1 && i === step && work.status === "blocked" && <span className="hidden sm:inline"> · blocked</span>}
            </div>
          </li>
        ))}
      </ol>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_400px]">
        <div>{issue.type === "report" ? <ReportEditor issue={issue} work={work} /> : <ActionCard issue={issue} work={work} />}</div>
        <div className="space-y-6">
          <Card className="p-6">
            <h2 className="text-[18px] font-semibold">What was asked</h2>
            {issue.description ? <p className="mt-3 text-[16px] leading-7 whitespace-pre-wrap break-anywhere">{issue.description}</p> : <p className="mt-3 text-text-2">No details were given.</p>}
            {sentTo && (
              <p className="mt-3 text-[15px] text-text-2">
                Sent to {targetName(sentTo, people, groups, (id) => branchById.get(id)?.name ?? "branch")}
                {issue.work_items.length > 1 && ` · ${modeLabel[issue.completion_mode]}`}
              </p>
            )}
          </Card>
          <Card>
            <h2 className="border-b border-border px-6 py-5 text-[18px] font-semibold">About your {issue.type === "report" ? "report" : "work"}</h2>
            <div className="px-6 py-5">
              <CommentThread issue={issue} workItemId={work.id} compact emptyText="Questions about this? Ask here." />
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Footer({ issue, work, onSubmit, submitLabel, submitting, hint }: { issue: IssueDetail; work: WorkItem; onSubmit: () => void; submitLabel: string; submitting?: boolean; hint: string }) {
  const t = useTransition();
  const viewer = useViewer();
  const [blockOpen, setBlockOpen] = useState(false);
  const [why, setWhy] = useState("");
  const qc = useQueryClient();
  if (work.status === "pending_approval")
    return (
      <div className="border-t border-border bg-surface-2 px-6 py-5 text-text-2">
        Sent for approval {work.submitted_at ? timeAgo(work.submitted_at) : ""}. You'll be told when it's approved.
      </div>
    );
  if (work.status === "approved") return <div className="border-t border-border bg-success-soft px-6 py-5 font-semibold text-success">Approved. Nothing more to do.</div>;
  if (issue.state !== "open" || work.status === "cancelled") return null;
  const act = (transition: "start" | "claim" | "unblock" | "block", done: string) =>
    t.mutate({ item: work, transition }, { onSuccess: () => toast.success(done), onError: (e) => toast.error(errorMessage(e)) });
  return (
    <div className="flex flex-wrap items-center gap-3 border-t border-border bg-surface-2 px-6 py-5">
      {!work.assignee_id && canClaim(viewer, issue, work) ? (
        <Button variant="primary" size="lg" className="ml-auto" loading={t.isPending} onClick={() => act("claim", "It's yours now")}>
          I'll take it
        </Button>
      ) : work.status === "open" ? (
        <Button variant="primary" size="lg" className="ml-auto" loading={t.isPending} onClick={() => act("start", "Started")}>
          Start
        </Button>
      ) : work.status === "blocked" ? (
        <>
          <span className="text-text-2">You said you're blocked.</span>
          <Button variant="primary" size="lg" className="ml-auto" loading={t.isPending} onClick={() => act("unblock", "Back in progress")}>
            Continue
          </Button>
        </>
      ) : (
        <>
          <Button size="lg" onClick={() => setBlockOpen(true)}>
            I'm blocked
          </Button>
          <span className="text-text-2">{hint}</span>
          <Button variant="primary" size="lg" className="ml-auto" loading={submitting} onClick={onSubmit}>
            {submitLabel}
          </Button>
        </>
      )}
      <Dialog
        open={blockOpen}
        onOpenChange={setBlockOpen}
        title="What's holding you up?"
        description="Your note goes to the conversation about your work, so people can help."
        footer={
          <>
            <Button onClick={() => setBlockOpen(false)}>Cancel</Button>
            <Button
              variant="primary"
              loading={t.isPending}
              onClick={async () => {
                try {
                  if (why.trim()) await api.post(`/issues/${issue.id}/comments`, { body: why.trim(), work_item_id: work.id });
                  qc.invalidateQueries({ queryKey: ["issues", issue.id, "comments"] });
                } catch (e) {
                  toast.error(errorMessage(e));
                }
                act("block", "Marked as blocked");
                setBlockOpen(false);
              }}
            >
              I'm blocked
            </Button>
          </>
        }
      >
        <textarea value={why} onChange={(e) => setWhy(e.target.value)} rows={3} className={inputClass} aria-label="What's holding you up?" placeholder="Optional" />
      </Dialog>
    </div>
  );
}

/** Sending for approval with neither a note nor a file that uploaded. */
class NothingToSend extends Error {
  constructor(public uploadFailed = false) {
    super("nothing to send");
  }
}

function ActionCard({ issue, work }: { issue: IssueDetail; work: WorkItem }) {
  const qc = useQueryClient();
  const t = useTransition();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const files = useFilePicker();
  const approver = issue.requires_super_admin_approval ? "A super admin" : "Your approver";
  const submit = useMutation({
    // Approvers need something to look at: a note, a file, or both.
    mutationFn: async () => {
      const text = note.trim();
      if (!text && !files.files.length) throw new NothingToSend();
      const body = text || (files.files.length === 1 ? `Attached ${files.files[0].name}` : `Attached ${files.files.length} files`);
      const c = await api.post<{ id: string }>(`/issues/${issue.id}/comments`, { body, work_item_id: work.id });
      const failed = files.files.length ? await uploadAll(issue.id, files.files, { comment_id: c.id }) : [];
      if (!text && failed.length === files.files.length) {
        reportFailedUploads(failed, "Not sent:");
        throw new NothingToSend(true);
      }
      reportFailedUploads(failed, "Sent, but");
      await t.mutateAsync({ item: work, transition: "submit" });
    },
    onSuccess: () => {
      toast.success("Sent for approval");
      setOpen(false);
      setNote("");
      files.clear();
      qc.invalidateQueries({ queryKey: ["issues", issue.id, "comments"] });
    },
    onError: (e) => {
      qc.invalidateQueries({ queryKey: ["issues", issue.id, "comments"] });
      if (e instanceof NothingToSend) {
        if (!e.uploadFailed) toast.error("Add a note or a file so your approver can see what you did.");
      } else toast.error(errorMessage(e));
    },
  });
  return (
    <Card className="overflow-hidden">
      <div className="px-6 py-5">
        <h2 className="text-[18px] font-semibold">Your part</h2>
        <p className="mt-2 text-text-2">
          {work.status === "open"
            ? "Start when you begin, so others can see it's in hand."
            : work.status === "pending_approval"
              ? "Handed in. Waiting for approval."
              : work.status === "approved"
                ? "Done and approved."
                : "When it's done, send it for approval. You can add a note and photos or documents."}
        </p>
      </div>
      <Footer issue={issue} work={work} onSubmit={() => setOpen(true)} submitLabel="Send for approval" hint={`${approver} is told when you send it.`} />
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="Send for approval"
        footer={
          <>
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="primary" loading={submit.isPending} disabled={!note.trim() && !files.files.length} onClick={() => submit.mutate()}>
              Send for approval
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-text-2">Add a note, a file, or both, so your approver can see what you did.</p>
          <Field label="What did you do?">
            {(p) => <textarea {...p} value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="e.g. Checked all six kits; restocked plasters in kits 2 and 5." className={inputClass} />}
          </Field>
          <PendingFiles files={files.files} onRemove={files.remove} />
          <AttachButton onPick={files.add} />
        </div>
      </Dialog>
    </Card>
  );
}

type SaveState = "idle" | "saving" | "saved" | "error";

function ReportEditor({ issue, work }: { issue: IssueDetail; work: WorkItem }) {
  const qc = useQueryClient();
  const viewer = useViewer();
  const t = useTransition();
  const reports = useReports(issue.id);
  const existing = reports.data?.find((r) => r.work_item_id === work.id && r.author_id === viewer.me.user.id) ?? reports.data?.find((r) => r.work_item_id === work.id);
  const [report, setReport] = useState<Report | undefined>(undefined);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [state, setState] = useState<SaveState>("idle");
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const loaded = useRef(false);
  const dirty = useRef(false);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const locked = work.status === "approved" || work.status === "pending_approval" || issue.state !== "open";
  const canWrite = work.status === "in_progress" || work.status === "blocked";

  useEffect(() => {
    if (loaded.current || reports.isLoading) return;
    loaded.current = true;
    if (existing) {
      setReport(existing);
      setTitle(existing.title);
      setBody(existing.body);
      setSavedAt(existing.updated_at);
    } else setTitle(issue.title);
  }, [existing, reports.isLoading, issue.title]);

  const save = async (): Promise<Report | undefined> => {
    if (!body.trim() || !title.trim()) return report;
    setState("saving");
    try {
      let r: Report;
      if (!report) {
        try {
          r = await api.post<Report>(`/issues/${issue.id}/reports`, { title: title.trim(), body, work_item_id: work.id });
        } catch (e) {
          if (e instanceof ApiError && e.code === "report_exists") {
            const list = await qc.fetchQuery({ queryKey: keys.reports(issue.id), queryFn: () => api.get<{ items: Report[] }>(`/issues/${issue.id}/reports`).then((p) => p.items) });
            const found = list.find((x) => x.work_item_id === work.id);
            if (!found) throw e;
            r = await api.patch<Report>(`/reports/${found.id}`, { version: found.version, title: title.trim(), body });
          } else throw e;
        }
      } else {
        r = await api.patch<Report>(`/reports/${report.id}`, { version: report.version, title: title.trim(), body });
      }
      setReport(r);
      setSavedAt(r.updated_at);
      setState("saved");
      dirty.current = false;
      return r;
    } catch (e) {
      if (e instanceof ApiError && e.code === "version_conflict") setConflict(true);
      setState("error");
      if (!(e instanceof ApiError && e.code === "version_conflict")) toast.error(errorMessage(e));
      return undefined;
    }
  };

  // Autosave 1.5 s after typing stops.
  useEffect(() => {
    if (!loaded.current || !dirty.current || !canWrite) return;
    const id = setTimeout(save, 1500);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, body]);

  const handIn = useMutation({
    mutationFn: async () => {
      const r = (dirty.current || !report ? await save() : report) ?? report;
      if (!r) throw new ApiError(422, "invalid_report", "", null);
      let submitted = r;
      if (!r.submitted_at || dirty.current) submitted = await api.post<Report>(`/reports/${r.id}/submit`, { version: r.version });
      setReport(submitted);
      await t.mutateAsync({ item: work, transition: "submit" });
    },
    onSuccess: () => {
      setConfirm(false);
      toast.success("Handed in. Your approver has been told.");
      qc.invalidateQueries({ queryKey: keys.reports(issue.id) });
    },
    onError: (e) => {
      setConfirm(false);
      toast.error(errorMessage(e));
      qc.invalidateQueries({ queryKey: keys.reports(issue.id) });
    },
  });

  const wrap = (before: string, after = before) => {
    const el = editorRef.current;
    if (!el) return;
    const { selectionStart: a, selectionEnd: b } = el;
    const next = body.slice(0, a) + before + body.slice(a, b) + after + body.slice(b);
    dirty.current = true;
    setBody(next);
    requestAnimationFrame(() => (el.focus(), el.setSelectionRange(a + before.length, b + before.length)));
  };
  const bullet = () => {
    const el = editorRef.current;
    if (!el) return;
    const a = el.selectionStart;
    const lineStart = body.lastIndexOf("\n", a - 1) + 1;
    dirty.current = true;
    setBody(body.slice(0, lineStart) + "- " + body.slice(lineStart));
  };

  if (reports.isLoading) return <Skeleton className="h-96" />;
  const words = body.trim() ? body.trim().split(/\s+/).length : 0;
  const status =
    state === "saving" ? "Saving…" : state === "error" ? "Couldn't save — keep typing to retry" : savedAt ? `Draft saved ${formatTime(savedAt)}` : null;

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between border-b border-border px-6 py-5">
        <h2 className="text-[18px] font-semibold">Your report</h2>
        {report?.submitted_at && locked ? (
          <span className="text-text-2">Handed in {timeAgo(report.submitted_at)}</span>
        ) : (
          status && (
            <span className={cx("inline-flex items-center gap-1.5", state === "error" ? "text-danger" : "text-success")} role="status">
              {state !== "error" && state !== "saving" && <Check className="size-4" />} {status}
            </span>
          )
        )}
      </div>
      {conflict && (
        <div className="flex flex-wrap items-center gap-3 border-b border-warning-edge bg-warning-soft px-6 py-3 text-warning" role="alert">
          This report was changed in another window.
          <Button
            size="sm"
            onClick={async () => {
              const list = await qc.fetchQuery({ queryKey: keys.reports(issue.id), queryFn: () => api.get<{ items: Report[] }>(`/issues/${issue.id}/reports`).then((p) => p.items) });
              const found = list.find((x) => x.work_item_id === work.id);
              if (found) (setReport(found), setTitle(found.title), setBody(found.body));
              setConflict(false);
            }}
          >
            Load latest
          </Button>
          <Button
            size="sm"
            onClick={async () => {
              const list = await api.get<{ items: Report[] }>(`/issues/${issue.id}/reports`);
              const found = list.items.find((x) => x.work_item_id === work.id);
              if (found) setReport(found);
              setConflict(false);
              dirty.current = true;
              setTimeout(save, 0);
            }}
          >
            Keep mine
          </Button>
        </div>
      )}
      <div className="space-y-5 px-6 py-5">
        {work.status === "open" && <p className="rounded-[10px] bg-sunken px-4 py-3 text-text-2">Press Start below to begin writing.</p>}
        <Field label="Title">
          {(p) => (
            <input
              {...p}
              value={title}
              disabled={!canWrite}
              onChange={(e) => ((dirty.current = true), setTitle(e.target.value))}
              maxLength={200}
              className={cx(inputClass, "text-[18px] font-semibold")}
            />
          )}
        </Field>
        <div>
          <label htmlFor="report-body" className="mb-1.5 block font-semibold">
            Report
          </label>
          <div className="overflow-hidden rounded-[12px] border border-input focus-within:border-primary">
            {canWrite && (
              <div className="flex gap-1 border-b border-border bg-surface-2 px-3 py-2" role="toolbar" aria-label="Formatting">
                <button type="button" onClick={() => wrap("**")} className="rounded-md px-3 py-1 font-bold hover:bg-sunken" aria-label="Bold">
                  B
                </button>
                <button type="button" onClick={() => wrap("_")} className="rounded-md px-3 py-1 italic hover:bg-sunken" aria-label="Italic">
                  I
                </button>
                <button type="button" onClick={bullet} className="rounded-md px-3 py-1 hover:bg-sunken" aria-label="Bulleted list">
                  ≡
                </button>
              </div>
            )}
            <textarea
              id="report-body"
              ref={editorRef}
              value={body}
              disabled={!canWrite}
              onChange={(e) => ((dirty.current = true), setBody(e.target.value))}
              onBlur={() => dirty.current && save()}
              rows={14}
              maxLength={100000}
              className="block min-h-[320px] w-full resize-y bg-surface px-5 py-4 text-[17px] leading-[27px] outline-none disabled:bg-sunken"
            />
          </div>
          <p className="mt-1 text-[13px] text-text-3">{words} words</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {report && <FileList files={report.attachments} />}
          {report && canWrite && <UploadNow issueId={issue.id} parent={{ report_id: report.id }} onDone={() => qc.invalidateQueries({ queryKey: keys.reports(issue.id) }).then(() => reports.refetch().then((r) => setReport(r.data?.find((x) => x.id === report.id) ?? report)))} />}
          {!report && canWrite && <span className="text-[14px] text-text-3">You can attach files once your draft is saved.</span>}
        </div>
      </div>
      <Footer
        issue={issue}
        work={work}
        submitting={handIn.isPending}
        onSubmit={() => (body.trim() ? setConfirm(true) : toast.error("Write your report first."))}
        submitLabel="Hand in for approval"
        hint={`${issue.requires_super_admin_approval ? "A super admin is" : "Your approver is"} told when you hand it in.`}
      />
      <Dialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Hand in your report?"
        description="Your approver will be told. You can still change it if it's sent back."
        footer={
          <>
            <Button onClick={() => setConfirm(false)}>Keep writing</Button>
            <Button variant="primary" loading={handIn.isPending} onClick={() => handIn.mutate()}>
              Hand in report
            </Button>
          </>
        }
      />
    </Card>
  );
}
