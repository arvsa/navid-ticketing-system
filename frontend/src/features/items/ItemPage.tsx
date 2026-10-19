// Item detail (UX_SPEC §4.5): one layout that adapts to the kind.
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Info, Lock, MoreHorizontal, Unlock, X } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/api/client";
import { setIssue, useComments, useHistory, useIssue, useIssueByNumber, useTransition } from "@/api/hooks";
import type { IssueDetail, Target } from "@/api/types";
import { useBranch } from "@/app/BranchContext";
import { Pill, PriorityText, TypeBadge } from "@/components/badges";
import { FileList } from "@/components/files";
import { Button, Card, ErrorPanel, Menu, MenuItem, MenuSeparator, Skeleton, Tabs, cx } from "@/components/ui";
import { canClose, canEdit, canSetPrivate, canTarget, isAdminOf, isSuper } from "@/lib/can";
import { formatDateTime, formatDay, timeAgo, zoneSuffix } from "@/lib/dates";
import { historyLines } from "@/lib/history";
import { isDone, numberOf, primaryAction, targetName, useGroupDirectory, useItemLabels } from "@/lib/items";
import { errorMessage, modeLabel, stateLabel } from "@/lib/labels";
import { useViewer } from "@/lib/useViewer";
import { usePeople } from "@/people/usePeople";
import { EventHeader, RsvpCard, WhosComing } from "@/features/events/EventPanel";
import type { ItemSearch } from "@/app/router";
import { CommentThread } from "./Comments";
import { ConfirmDialog, EditDialog, SendToMoreDialog, useIssueAction } from "./ItemDialogs";
import { PeopleList, ReviewDrawer, StatusTiles } from "./WorkPanel";
import { SelfReport } from "./SelfReport";

export function ItemPage() {
  const { number } = useParams({ from: "/authed/shell/items/$number" });
  const n = Number(number);
  const lookup = useIssueByNumber(n);
  const issue = useIssue(lookup.data);
  if (!Number.isFinite(n)) return <ErrorPanel error={{ code: "not_found" }} />;
  if (lookup.error) return <ErrorPanel error={lookup.error} onRetry={() => lookup.refetch()} />;
  if (issue.error) return <ErrorPanel error={issue.error} onRetry={() => issue.refetch()} />;
  if (!issue.data)
    return (
      <div className="space-y-4" role="status" aria-label="Loading">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-12 w-2/3" />
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  return <ItemView issue={issue.data} />;
}

function useMarkReadOnOpen(issue: IssueDetail) {
  const qc = useQueryClient();
  useEffect(() => {
    api
      .post(`/issues/${issue.id}/read`)
      .then(() => qc.invalidateQueries({ queryKey: ["issues", "list"] }))
      .catch(() => {});
    // once per item and update
  }, [issue.id, issue.updated_at, qc]);
}

function ItemView({ issue }: { issue: IssueDetail }) {
  useMarkReadOnOpen(issue);
  const viewer = useViewer();
  const people = usePeople();
  const groups = useGroupDirectory();
  const { zoneOf } = useBranch();
  const search = useSearch({ from: "/authed/shell/items/$number" });
  const navigate = useNavigate({ from: "/items/$number" });
  const setSearch = (patch: Partial<ItemSearch>) => navigate({ search: (s: ItemSearch) => ({ ...s, ...patch }), replace: true });
  const comments = useComments(issue.id);
  const history = useHistory(issue.id, search.tab === "history");
  const [filter, setFilter] = useState<null | "approved" | "waiting" | "progress" | "not_started">(null);
  const [dialog, setDialog] = useState<null | "edit" | "send" | "close" | "cancel">(null);
  const close = useIssueAction(issue, "close");
  const cancel = useIssueAction(issue, "cancel");
  const zone = zoneOf(issue.branch_id) ?? zoneOf(issue.work_items[0]?.branch_id);
  const hasWork = issue.type === "action" || issue.type === "report";
  const tab = search.tab ?? "discussion";
  const labels = useItemLabels(issue);
  const branchName = (id: string) => labels.branchName(id) ?? "another branch";
  const live = issue.work_items.filter((w) => !isDone(w));
  const due = live.map((w) => w.sla_due_at).filter(Boolean).sort()[0] ?? issue.work_items.map((w) => w.sla_due_at).filter(Boolean).sort()[0];
  const commentCount = (comments.data ?? []).filter((c) => !c.work_item_id && !c.deleted).length;
  const primary = primaryAction(issue, viewer);
  const schoolWideForBranchAdmin = issue.requires_super_admin_approval && !isSuper(viewer);

  const qc = useQueryClient();
  const setPrivate = useMutation({
    mutationFn: () => api.patch<IssueDetail>(`/issues/${issue.id}`, { version: issue.version, is_private: !issue.is_private }),
    onSuccess: (u) => (setIssue(qc, u), toast.success(u.is_private ? "Now private" : "Now visible to the branch")),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const removeTarget = useMutation({
    mutationFn: (t: Target) => api.del<IssueDetail>(`/issues/${issue.id}/targets/${t.id}`),
    onSuccess: (u) => (setIssue(qc, u), toast.success("Removed")),
    onError: (e) => toast.error(errorMessage(e)),
  });

  const subtitle = (
    <>
      {issue.type === "ticket" ? "Asked by " : issue.targets.length === 0 ? (issue.type === "event" ? "Organised by " : "Filed by ") : "Sent by "}
      {issue.created_by === viewer.me.user.id ? "you" : labels.person(issue.created_by)}
      {labels.sentTo && (
        <>
          {" "}to <b className="text-text">{labels.sentTo}</b>
        </>
      )}
      {hasWork && issue.work_items.length > 1 && ` · ${modeLabel[issue.completion_mode]}`}
      {hasWork && due && (
        <>
          {" "}· due <b className="text-text">{formatDateTime(due, zone)}</b>
        </>
      )}
      {issue.branch_id === null && " · school-wide"}
      {zone && zoneSuffix(zone) && (
        <>
          <br />
          {issue.branch_id ? branchName(issue.branch_id) : zoneSuffix(zone)} time
        </>
      )}
    </>
  );

  const menu = (
    <Menu
      trigger={
        <Button size="lg" aria-label="More actions" className="w-12 px-0">
          <MoreHorizontal className="size-5" />
        </Button>
      }
    >
      {canSetPrivate(viewer, issue) && (
        <MenuItem onSelect={() => setPrivate.mutate()}>
          {issue.is_private ? <Unlock className="size-4" /> : <Lock className="size-4" />}
          {issue.is_private ? "Make it visible to the branch" : "Make it private"}
        </MenuItem>
      )}
      {canTarget(viewer, issue) && <MenuItem onSelect={() => setDialog("send")}>Send to more people</MenuItem>}
      <MenuItem
        onSelect={() => {
          navigator.clipboard?.writeText(`${location.origin}/items/${numberOf(issue.key)}`);
          toast.success("Link copied");
        }}
      >
        Copy link
      </MenuItem>
      {(canClose(viewer, issue) || canEdit(viewer, issue)) && <MenuSeparator />}
      {canClose(viewer, issue) && <MenuItem onSelect={() => setDialog("close")}>{issue.type === "ticket" ? "Close question" : "Close"}</MenuItem>}
      {canClose(viewer, issue) && (
        <MenuItem danger onSelect={() => setDialog("cancel")}>
          {issue.type === "event" ? "Cancel event" : "Cancel"}
        </MenuItem>
      )}
    </Menu>
  );

  const actions = (
    <div className="flex flex-wrap items-center gap-2">
      <PrimaryButton issue={issue} onClose={() => setDialog("close")} onEdit={() => setDialog("edit")} onReview={(id) => setSearch({ review: id })} />
      {canEdit(viewer, issue) && primary.kind !== "edit-event" && (
        <Button size="lg" onClick={() => setDialog("edit")}>
          Edit
        </Button>
      )}
      {menu}
    </div>
  );

  return (
    <div className="mx-auto max-w-[1100px] space-y-6">
      <nav aria-label="Breadcrumb" className="text-[17px]">
        <Link to="/items" className="text-primary hover:underline">
          Items
        </Link>
        <span className="mx-2 text-text-3">/</span>
        <span className="font-mono text-text-2">{issue.key}</span>
      </nav>

      {issue.state === "closed" && (
        <Banner tone="success" icon={<CheckCircle2 className="size-5" />}>
          {issue.type === "ticket" ? "Answered and closed" : "Closed"}
          {issue.closed_by ? ` by ${labels.person(issue.closed_by)}` : " automatically"}
          {issue.closed_at && ` · ${formatDay(issue.closed_at, zone)}`}
        </Banner>
      )}
      {issue.state === "cancelled" && (
        <Banner tone="danger" icon={<X className="size-5" />}>
          Cancelled{issue.closed_by ? ` by ${labels.person(issue.closed_by)}` : ""}. {issue.type === "event" ? "Invitees were told." : "Everyone involved was told."}
        </Banner>
      )}
      {schoolWideForBranchAdmin && issue.work_items.some((w) => isAdminOf(viewer, w.branch_id)) && (
        <Banner tone="info" icon={<Info className="size-5" />}>
          Sent by school leadership. You can comment and assign your branch's part. Only super admins approve this work.
        </Banner>
      )}

      {issue.type === "event" && issue.event ? (
        <>
          <div className="flex justify-end">{actions}</div>
          <EventHeader issue={issue} />
          <RsvpCard issue={issue} />
          {issue.description && (
            <Card className="p-6">
              <h2 className="mb-2 text-[20px] font-semibold">About</h2>
              <p className="text-[17px] leading-7 whitespace-pre-wrap break-anywhere">{issue.description}</p>
            </Card>
          )}
          <WhosComing issue={issue} />
        </>
      ) : (
        <>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <TypeBadge type={issue.type} />
                <Pill fg="var(--text-2)" bg="var(--sunken)">
                  {stateLabel[issue.state]}
                </Pill>
                {(issue.priority === "high" || issue.priority === "critical") && <PriorityText priority={issue.priority} />}
                {issue.is_private && (
                  <span className="inline-flex items-center gap-1 text-text-2">
                    <Lock className="size-4" /> Private
                  </span>
                )}
                {issue.requires_super_admin_approval && hasWork && (
                  <span className="inline-flex items-center gap-1 text-text-2">
                    <Lock className="size-4" /> A super admin signs this off
                  </span>
                )}
              </div>
              <h1 className="mt-3 text-[30px] leading-9 font-bold break-anywhere sm:text-[38px] sm:leading-[46px]">{issue.title}</h1>
              <p className="mt-2 text-[17px] text-text-2">{subtitle}</p>
            </div>
            {actions}
          </div>

          {(issue.description || issue.attachments.some((a) => !a.comment_id && !a.report_id)) && (
            <Card className="space-y-4 px-6 py-5">
              {issue.description && <p className="text-[17px] leading-7 whitespace-pre-wrap break-anywhere">{issue.description}</p>}
              <FileList files={issue.attachments.filter((a) => !a.comment_id && !a.report_id)} />
            </Card>
          )}
          {issue.type === "ticket" && issue.targets.length === 0 && <p className="text-text-2">Asked the branch admins.</p>}
          {issue.type === "report" && issue.work_items.length === 0 && <SelfReport issue={issue} />}
          {hasWork && issue.work_items.length > 0 && <StatusTiles issue={issue} filter={filter} onFilter={(f) => (setFilter(f), setSearch({ tab: "people" }))} />}
        </>
      )}

      {canTarget(viewer, issue) && issue.targets.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-[15px]">
          <span className="text-text-2">{issue.type === "event" ? "Invited:" : issue.type === "ticket" ? "Asked:" : "Sent to:"}</span>
          {issue.targets.map((t) => (
            <span key={t.id} className="inline-flex items-center gap-1 rounded-full bg-sunken py-1 pr-2 pl-3">
              {targetName(t, people, groups, branchName)}
              <button
                className="rounded-full p-0.5 text-text-3 hover:text-danger"
                aria-label={`Stop sending to ${targetName(t, people, groups, branchName)}`}
                onClick={() => {
                  const open = issue.work_items.filter((w) => w.target_id === t.id && !isDone(w)).length;
                  if (confirm(`Stop sending this to ${targetName(t, people, groups, branchName)}?${open ? ` ${open} unfinished assignment${open === 1 ? "" : "s"} will be cancelled.` : ""}`))
                    removeTarget.mutate(t);
                }}
              >
                <X className="size-3.5" />
              </button>
            </span>
          ))}
        </div>
      )}

      <Tabs
        value={tab}
        onChange={(t) => setSearch({ tab: t })}
        tabs={[
          { value: "discussion" as const, label: "Discussion", count: commentCount },
          ...(hasWork && issue.work_items.length > 0 ? [{ value: "people" as const, label: "People", count: issue.work_items.filter((w) => w.status !== "cancelled").length }] : []),
          { value: "history" as const, label: "History" },
        ]}
      />

      {tab === "people" && hasWork && <PeopleList issue={issue} filter={filter} reviewing={search.review} onReview={(id) => setSearch({ review: id })} />}
      {tab === "discussion" && (
        <Card className="p-6">
          <CommentThread issue={issue} />
        </Card>
      )}
      {tab === "history" && (
        <Card className="p-6">
          {history.isLoading ? (
            <Skeleton className="h-32" />
          ) : (
            <ol className="relative space-y-5 before:absolute before:top-2 before:bottom-2 before:left-[3px] before:w-px before:bg-border">
              {historyLines(history.data ?? [], issue, {
                person: labels.person,
                branchName: labels.branchName,
                target: (v) =>
                  v?.kind === "user"
                    ? labels.person(v.user_id as string)
                    : v?.kind === "group"
                      ? groups.get(v.group_id as string)?.name ?? "a group"
                      : labels.branchName(v?.branch_id as string) ?? "another branch",
              }).map((h) => (
                <li key={h.id} className="relative flex gap-4">
                  <span className="mt-2 size-[7px] shrink-0 rounded-full bg-border-strong" aria-hidden />
                  <div>
                    <div className="break-anywhere">{h.text}</div>
                    <time className="text-[14px] text-text-3" dateTime={h.at} title={formatDateTime(h.at, zone)}>
                      {timeAgo(h.at)}
                    </time>
                  </div>
                </li>
              ))}
            </ol>
          )}
          <p className="mt-6 text-[13px] text-text-3">History can't be edited or deleted.</p>
        </Card>
      )}

      <ReviewDrawer issue={issue} workId={search.review} onClose={() => setSearch({ review: undefined })} onSelect={(id) => setSearch({ review: id })} />
      {dialog === "edit" && <EditDialog issue={issue} open onOpenChange={(o) => !o && setDialog(null)} />}
      {dialog === "send" && <SendToMoreDialog issue={issue} open onOpenChange={(o) => !o && setDialog(null)} />}
      <ConfirmDialog
        open={dialog === "close"}
        onOpenChange={(o) => !o && setDialog(null)}
        title={issue.type === "ticket" ? "Close question?" : issue.type === "event" ? "Close event?" : `Close “${issue.title}”?`}
        body={
          issue.type === "ticket"
            ? "Got your answer? Closing tells everyone it's done."
            : live.length
              ? `${live.length} unfinished assignment${live.length === 1 ? "" : "s"} will be cancelled and those people told.`
              : "Everyone involved will see it as closed."
        }
        confirm={issue.type === "ticket" ? "Close question" : "Close"}
        loading={close.isPending}
        onConfirm={() => close.mutate(undefined, { onSuccess: () => setDialog(null) })}
      />
      <ConfirmDialog
        open={dialog === "cancel"}
        onOpenChange={(o) => !o && setDialog(null)}
        title={issue.type === "event" ? `Cancel ${issue.title}?` : "Cancel this item?"}
        body={issue.type === "event" ? "Everyone who hasn't declined will be told." : "Unfinished work is cancelled and everyone involved is told."}
        confirm={issue.type === "event" ? "Cancel event" : "Cancel item"}
        cancelText={issue.type === "event" ? "Keep event" : "Keep it"}
        danger
        loading={cancel.isPending}
        onConfirm={() => cancel.mutate(undefined, { onSuccess: () => setDialog(null) })}
      />
    </div>
  );
}

function Banner({ tone, icon, children }: { tone: "success" | "danger" | "info"; icon: React.ReactNode; children: React.ReactNode }) {
  const style =
    tone === "success"
      ? { color: "var(--success)", background: "var(--success-soft)" }
      : tone === "danger"
        ? { color: "var(--danger)", background: "var(--danger-soft)" }
        : { color: "var(--primary-on-soft)", background: "var(--primary-soft)" };
  return (
    <div className={cx("flex items-start gap-3 rounded-[12px] px-5 py-4")} style={style} role="status">
      <span className="mt-0.5 shrink-0">{icon}</span>
      <span>{children}</span>
    </div>
  );
}

function PrimaryButton({ issue, onClose, onEdit, onReview }: { issue: IssueDetail; onClose: () => void; onEdit: () => void; onReview: (id: string) => void }) {
  const viewer = useViewer();
  const t = useTransition();
  const navigate = useNavigate();
  const p = primaryAction(issue, viewer);
  const n = numberOf(issue.key);
  const run = (work: Parameters<typeof t.mutate>[0]["item"], transition: "start" | "claim" | "unblock", done: string) =>
    t.mutate({ item: work, transition }, { onSuccess: () => toast.success(done), onError: (e) => toast.error(errorMessage(e)) });
  const btn = (label: string, onClick: () => void) => (
    <Button variant="primary" size="lg" loading={t.isPending} onClick={onClick}>
      {label}
    </Button>
  );
  switch (p.kind) {
    case "close-question":
      return btn("Close question", onClose);
    case "reply":
      return btn("Reply", () => {
        navigate({ to: "/items/$number", params: { number: n }, search: { tab: "discussion" }, replace: true });
        setTimeout(() => document.querySelector<HTMLTextAreaElement>("textarea[id^=composer]")?.focus(), 50);
      });
    case "start":
      return btn("Start", () => run(p.work, "start", "Started"));
    case "claim":
      return btn("I'll take it", () => run(p.work, "claim", "It's yours now"));
    case "continue":
      return btn("Continue", () => run(p.work, "unblock", "Back in progress"));
    case "submit":
      return btn("Send for approval", () => navigate({ to: "/items/$number/mine", params: { number: n } }));
    case "write-report":
      return btn("Continue report", () => navigate({ to: "/items/$number/mine", params: { number: n } }));
    case "review":
      return btn(`Review ${p.count} waiting`, () => onReview(p.first.id));
    case "assign":
      return btn("Assign our part", () => onReview(p.work.id));
    case "edit-event":
      return btn("Edit event", onEdit);
    case "close-event":
      return btn("Close event", onClose);
    default:
      return null;
  }
}
