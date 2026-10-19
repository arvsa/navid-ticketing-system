// Conversation: oldest first, composer at the bottom, @mentions, staff-only
// comments, files (UX_SPEC §4.5.5).
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { EyeOff, MoreHorizontal } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/api/client";
import { useComments } from "@/api/hooks";
import { keys } from "@/api/keys";
import type { Comment, IssueDetail } from "@/api/types";
import { Avatar } from "@/components/badges";
import { AttachButton, FileList, PendingFiles, reportFailedUploads, uploadAll, useFilePicker } from "@/components/files";
import { Button, EmptyState, LoadingRows, Menu, MenuItem, cx, inputClass } from "@/components/ui";
import { canComment, canModerate, canStaffOnly } from "@/lib/can";
import { formatDateTime, timeAgo } from "@/lib/dates";
import { errorMessage } from "@/lib/labels";
import { useViewer } from "@/lib/useViewer";
import { useItemLabels } from "@/lib/items";
import { usePeople, type Person } from "@/people/usePeople";
import { t } from "@/i18n";

function draftKey(issueId: string, workItemId?: string) {
  return `st.draft.comment.${issueId}.${workItemId ?? "issue"}`;
}
function readDraft(key: string) {
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}
function writeDraft(key: string, value: string) {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    // storage unavailable
  }
}

/** Highlights "@First Last" for mentioned people. */
function renderBody(body: string, mentioned: Person[]) {
  if (!mentioned.length) return body;
  const names = mentioned.map((p) => `@${p.first_name} ${p.last_name}`).sort((a, b) => b.length - a.length);
  const re = new RegExp(`(${names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "g");
  return body.split(re).map((part, i) =>
    names.includes(part) ? (
      <span key={i} className="font-semibold text-primary">
        {part}
      </span>
    ) : (
      part
    ),
  );
}

export function CommentThread({
  issue,
  workItemId,
  compact,
  emptyText = t("No comments yet. Ask or answer here."),
  header,
}: {
  issue: IssueDetail;
  workItemId?: string;
  compact?: boolean;
  emptyText?: string;
  header?: ReactNode;
}) {
  const viewer = useViewer();
  const people = usePeople();
  const comments = useComments(issue.id, workItemId);
  const list = (comments.data ?? []).filter((c) => (workItemId ? c.work_item_id === workItemId : true));
  const mayComment = canComment(viewer, issue) && issue.state === "open";
  return (
    <div className={cx("space-y-5", compact && "space-y-4")}>
      {header}
      {comments.isLoading ? (
        <LoadingRows rows={2} />
      ) : list.length === 0 ? (
        compact ? <p className="text-text-2">{emptyText}</p> : <EmptyState title={emptyText} />
      ) : (
        <ol className="space-y-5">
          {list.map((c) => (
            <CommentItem key={c.id} c={c} issue={issue} compact={compact} people={people} />
          ))}
        </ol>
      )}
      {mayComment ? (
        <Composer issue={issue} workItemId={workItemId} compact={compact} allowStaffOnly={canStaffOnly(viewer, issue)} />
      ) : (
        issue.state !== "open" && <p className="text-text-3">{t("This item is closed, so the conversation is read-only.")}</p>
      )}
    </div>
  );
}

function CommentItem({ c, issue, compact, people }: { c: Comment; issue: IssueDetail; compact?: boolean; people: ReturnType<typeof usePeople> }) {
  const viewer = useViewer();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(c.body ?? "");
  const author = people.get(c.author_id);
  const labels = useItemLabels(issue);
  const mine = c.author_id === viewer.me.user.id;
  const invalidate = () => qc.invalidateQueries({ queryKey: ["issues", issue.id, "comments"] });
  const edit = useMutation({
    mutationFn: () => api.patch(`/comments/${c.id}`, { body: text }),
    onSuccess: () => (setEditing(false), invalidate()),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: () => api.del(`/comments/${c.id}`),
    onSuccess: () => (toast.success(t("Comment removed")), invalidate()),
    onError: (e) => toast.error(errorMessage(e)),
  });
  if (c.deleted) {
    return <li className="text-[14px] text-text-3 italic">{t("This comment was removed.")}</li>;
  }
  const mentioned = c.mentions.map((id) => people.get(id)).filter(Boolean) as Person[];
  return (
    <li className={cx("flex gap-3", c.is_internal_only && "rounded-[10px] border-s-4 border-staff-edge bg-staff-bg p-3")}>
      <Avatar first={author?.first_name} last={author?.last_name} id={c.author_id} size={compact ? 36 : 40} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <b>{mine ? t("You") : labels.person(c.author_id)}</b>
          <time dateTime={c.created_at} title={formatDateTime(c.created_at)} className="text-[14px] text-text-3">
            {timeAgo(c.created_at)}
          </time>
          {c.edited && <span className="text-[13px] text-text-3">{t("edited")}</span>}
          {c.is_internal_only && (
            <span className="inline-flex items-center gap-1 text-[13px] font-semibold text-warning">
              <EyeOff className="size-3.5" aria-hidden />{" "}{t("Staff only")}
            </span>
          )}
          {issue.state === "open" && (mine || canModerate(viewer, issue)) && !editing && (
            <span className="ms-auto">
              <Menu
                trigger={
                  <button className="rounded-md p-1 text-text-3 hover:bg-sunken" aria-label={t("Comment options")}>
                    <MoreHorizontal className="size-4" />
                  </button>
                }
              >
                {mine && <MenuItem onSelect={() => setEditing(true)}>{t("Edit")}</MenuItem>}
                <MenuItem danger onSelect={() => confirm(t("Remove this comment?")) && remove.mutate()}>
                  {t("Remove")}
                </MenuItem>
              </Menu>
            </span>
          )}
        </div>
        {editing ? (
          <div className="mt-2 space-y-2">
            <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} className={inputClass} aria-label={t("Edit comment")} />
            <div className="flex gap-2">
              <Button size="sm" variant="primary" loading={edit.isPending} disabled={!text.trim()} onClick={() => edit.mutate()}>
                {t("Save")}
              </Button>
              <Button size="sm" onClick={() => (setEditing(false), setText(c.body ?? ""))}>
                {t("Cancel")}
              </Button>
            </div>
          </div>
        ) : (
          <p className="mt-1 whitespace-pre-wrap break-anywhere">{renderBody(c.body ?? "", mentioned)}</p>
        )}
        {c.attachments.length > 0 && (
          <div className="mt-2">
            <FileList files={c.attachments} />
          </div>
        )}
      </div>
    </li>
  );
}

function Composer({ issue, workItemId, compact, allowStaffOnly }: { issue: IssueDetail; workItemId?: string; compact?: boolean; allowStaffOnly: boolean }) {
  const qc = useQueryClient();
  const people = usePeople();
  const key = draftKey(issue.id, workItemId);
  const [body, setBody] = useState(() => readDraft(key));
  const [mentions, setMentions] = useState<Person[]>([]);
  const [staffOnly, setStaffOnly] = useState(false);
  const files = useFilePicker();
  const ref = useRef<HTMLTextAreaElement>(null);
  const [query, setQuery] = useState<string | null>(null);
  const branchIds = issue.branch_id ? [issue.branch_id] : [...new Set(issue.work_items.map((w) => w.branch_id))];
  const candidates = useMemo(() => {
    const seen = new Map<string, Person>();
    for (const b of branchIds) for (const p of people.inBranch(b)) if (p.is_active) seen.set(p.id, p);
    return [...seen.values()];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [people.all.length, branchIds.join()]);
  const matches = query === null ? [] : candidates.filter((p) => `${p.first_name} ${p.last_name}`.toLowerCase().includes(query.toLowerCase())).slice(0, 6);

  useEffect(() => writeDraft(key, body), [key, body]);

  const send = useMutation({
    mutationFn: async () => {
      const ids = mentions.filter((p) => body.includes(`@${p.first_name} ${p.last_name}`)).map((p) => p.id);
      const text = body.trim() || (files.files.length === 1 ? t("Attached {name}", { name: files.files[0].name }) : t("Attached {n} files", { n: files.files.length }));
      const c = await api.post<Comment>(`/issues/${issue.id}/comments`, {
        body: text,
        is_internal_only: staffOnly,
        mention_user_ids: [...new Set(ids)].slice(0, 50),
        work_item_id: workItemId ?? null,
      });
      const failed = files.files.length ? await uploadAll(issue.id, files.files, { comment_id: c.id }) : [];
      reportFailedUploads(failed, t("Your comment was posted, but"));
      return c;
    },
    onSuccess: () => {
      setBody("");
      setMentions([]);
      files.clear();
      writeDraft(key, "");
      qc.invalidateQueries({ queryKey: ["issues", issue.id, "comments"] });
      qc.invalidateQueries({ queryKey: keys.issue(issue.id) });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const onChange = (value: string) => {
    setBody(value);
    const caret = ref.current?.selectionStart ?? value.length;
    const before = value.slice(0, caret);
    const m = before.match(/(?:^|\s)@([\p{L}' -]{0,30})$/u);
    setQuery(m && !m[1].includes("  ") ? m[1] : null);
  };

  const pick = (p: Person) => {
    const el = ref.current;
    const caret = el?.selectionStart ?? body.length;
    const before = body.slice(0, caret).replace(/@([\p{L}' -]{0,30})$/u, `@${p.first_name} ${p.last_name} `);
    setBody(before + body.slice(caret));
    setMentions((m) => [...m, p]);
    setQuery(null);
    requestAnimationFrame(() => el?.focus());
  };

  const hidden = issue.is_private
    ? mentions.filter((p) => body.includes(`@${p.first_name} ${p.last_name}`))
    : [];

  return (
    <form
      className={cx("space-y-2 rounded-[12px]", staffOnly && "bg-staff-bg p-3")}
      onSubmit={(e) => {
        e.preventDefault();
        if (body.trim() || files.files.length) send.mutate();
      }}
    >
      <label className="block text-[14px] text-text-2" htmlFor={`composer-${key}`}>
        {t("Write a comment — type @ to bring someone in")}
      </label>
      <div className="relative">
        <div className={cx("flex gap-2", compact ? "items-stretch" : "flex-col")}>
          <textarea
            id={`composer-${key}`}
            ref={ref}
            value={body}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              if (matches.length && (e.key === "Enter" || e.key === "Tab") && query !== null) {
                e.preventDefault();
                pick(matches[0]);
              } else if (e.key === "Escape") setQuery(null);
              else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                if (body.trim() || files.files.length) send.mutate();
              }
            }}
            rows={compact ? 2 : 3}
            maxLength={20000}
            className={cx(inputClass, "resize-y")}
          />
          {compact && (
            <Button type="submit" variant="dark" size="lg" loading={send.isPending} disabled={!body.trim() && !files.files.length} className="h-auto">
              {t("Send")}
            </Button>
          )}
        </div>
        {matches.length > 0 && (
          <ul className="absolute bottom-full start-0 z-20 mb-1 w-72 rounded-[10px] border border-border bg-surface p-1 shadow-2" role="listbox">
            {matches.map((p) => (
              <li key={p.id}>
                <button type="button" onMouseDown={(e) => (e.preventDefault(), pick(p))} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-start hover:bg-sunken">
                  <Avatar first={p.first_name} last={p.last_name} id={p.id} size={24} />
                  {p.first_name} {p.last_name}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {hidden.length > 0 && <p className="text-[13px] text-text-3">{t("This item is private. People it isn't sent to won't see it or be told.")}</p>}
      <PendingFiles files={files.files} onRemove={files.remove} />
      <div className="flex flex-wrap items-center gap-3">
        <AttachButton onPick={files.add} label={t("Attach")} dashed={false} />
        {allowStaffOnly && (
          <label className="inline-flex items-center gap-2 text-[14px]">
            <input type="checkbox" checked={staffOnly} onChange={(e) => setStaffOnly(e.target.checked)} className="size-4" />
            <EyeOff className="size-4 text-warning" aria-hidden />{" "}{t("Staff only")}
          </label>
        )}
        {!compact && (
          <Button type="submit" variant="primary" className="ms-auto" loading={send.isPending} disabled={!body.trim() && !files.files.length}>
            {t("Comment")}
          </Button>
        )}
      </div>
    </form>
  );
}
