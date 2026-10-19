// Edit details, send to more people, close / cancel (UX_SPEC §4.5, §11.3).
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ApiError, api } from "@/api/client";
import { setIssue, useGroups } from "@/api/hooks";
import { keys } from "@/api/keys";
import type { IssueDetail, IssuePatch, Priority } from "@/api/types";
import { PRIORITIES } from "@/api/types";
import { useBranch } from "@/app/BranchContext";
import { RecipientPicker, type Recipient } from "@/components/pickers";
import { Button, Dialog, Field, inputClass } from "@/components/ui";
import { fromLocalInput, toLocalInput } from "@/lib/dates";
import { errorMessage, priorityLabel } from "@/lib/labels";
import { usePeople } from "@/people/usePeople";
import { isSuper } from "@/lib/can";
import { useViewer } from "@/lib/useViewer";
import { quote, t } from "@/i18n";
import { DateInput } from "@/components/DateInput";

export function EditDialog({ issue, open, onOpenChange }: { issue: IssueDetail; open: boolean; onOpenChange: (v: boolean) => void }) {
  const qc = useQueryClient();
  const { zoneOf } = useBranch();
  const zone = zoneOf(issue.branch_id);
  const [title, setTitle] = useState(issue.title);
  const [description, setDescription] = useState(issue.description ?? "");
  const [priority, setPriority] = useState<Priority>(issue.priority);
  const [starts, setStarts] = useState(issue.event ? toLocalInput(issue.event.starts_at, zone) : "");
  const [ends, setEnds] = useState(issue.event ? toLocalInput(issue.event.ends_at, zone) : "");
  const [location, setLocation] = useState(issue.event?.location ?? "");
  const [conflict, setConflict] = useState(false);
  const save = useMutation({
    mutationFn: (version: number) => {
      const body: IssuePatch = { version, title: title.trim(), description: description || null, priority };
      if (issue.event)
        body.event = {
          starts_at: fromLocalInput(starts, zone),
          ends_at: fromLocalInput(ends, zone),
          location: location || null,
        };
      return api.patch<IssueDetail>(`/issues/${issue.id}`, body);
    },
    onSuccess: (updated) => {
      setIssue(qc, updated);
      qc.invalidateQueries({ queryKey: keys.history(issue.id) });
      toast.success(t("Saved"));
      onOpenChange(false);
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === "version_conflict") setConflict(true);
      else toast.error(errorMessage(e));
    },
  });
  const latest = qc.getQueryData<IssueDetail>(keys.issue(issue.id));
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("Edit details")}
      wide
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>{t("Cancel")}</Button>
          <Button variant="primary" loading={save.isPending} disabled={!title.trim() || title.length > 200} onClick={() => save.mutate(issue.version)}>
            {t("Save changes")}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {conflict && (
          <div className="rounded-[10px] border border-warning-edge bg-warning-soft p-3 text-warning" role="alert">
            <p className="font-semibold">{t("Someone else changed this while you were editing.")}</p>
            <p className="text-[14px]">
              {t("Now: {title}, {priority}. Your changes are still here.", { title: quote(latest?.title ?? ""), priority: latest ? priorityLabel[latest.priority] : "" })}
            </p>
            <div className="mt-2 flex gap-2">
              <Button
                size="sm"
                onClick={async () => {
                  const fresh = await qc.fetchQuery({ queryKey: keys.issue(issue.id), queryFn: () => api.get<IssueDetail>(`/issues/${issue.id}`) });
                  setConflict(false);
                  save.mutate(fresh.version);
                }}
              >
                {t("Keep mine")}
              </Button>
              <Button
                size="sm"
                onClick={async () => {
                  await qc.invalidateQueries({ queryKey: keys.issue(issue.id) });
                  onOpenChange(false);
                }}
              >
                {t("Use theirs")}
              </Button>
            </div>
          </div>
        )}
        <Field label={t("Title")} hint={title.length > 180 ? t("{n} characters left", { n: 200 - title.length }) : undefined}>
          {(p) => <input {...p} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} className={inputClass} />}
        </Field>
        <Field label={t("Details")} optional>
          {(p) => <textarea {...p} value={description} onChange={(e) => setDescription(e.target.value)} rows={5} className={inputClass} />}
        </Field>
        <Field label={t("Priority")}>
          {(p) => (
            <select {...p} value={priority} onChange={(e) => setPriority(e.target.value as Priority)} className={inputClass}>
              {PRIORITIES.map((x) => (
                <option key={x} value={x}>
                  {priorityLabel[x]}
                </option>
              ))}
            </select>
          )}
        </Field>
        {issue.event && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("Starts")}>{(p) => <DateInput {...p} mode="datetime" value={starts} onChange={setStarts} />}</Field>
            <Field label={t("Ends")}>{(p) => <DateInput {...p} mode="datetime" value={ends} onChange={setEnds} />}</Field>
            <div className="sm:col-span-2">
              <Field label={t("Where")} optional>
                {(p) => <input {...p} value={location} onChange={(e) => setLocation(e.target.value)} className={inputClass} />}
              </Field>
            </div>
            <p className="text-[14px] text-text-2 sm:col-span-2">{t("Everyone invited is told when the time or place changes.")}</p>
          </div>
        )}
      </div>
    </Dialog>
  );
}

export function SendToMoreDialog({ issue, open, onOpenChange }: { issue: IssueDetail; open: boolean; onOpenChange: (v: boolean) => void }) {
  const qc = useQueryClient();
  const viewer = useViewer();
  const people = usePeople();
  const { options } = useBranch();
  const branchId = issue.branch_id;
  const groups = useGroups(branchId ?? undefined);
  const [value, setValue] = useState<Recipient[]>([]);
  const send = useMutation({
    mutationFn: async () => {
      let last: IssueDetail | undefined;
      for (const r of value) {
        const body = r.kind === "user" ? { user_id: r.id } : r.kind === "group" ? { group_id: r.id } : { branch_id: r.id };
        last = await api.post<IssueDetail>(`/issues/${issue.id}/targets`, body);
      }
      return last;
    },
    onSuccess: (updated) => {
      if (updated) setIssue(qc, updated);
      toast.success(t("Sent"));
      setValue([]);
      onOpenChange(false);
    },
    onError: (e) => {
      toast.error(errorMessage(e));
      qc.invalidateQueries({ queryKey: keys.issue(issue.id) });
    },
  });
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("Send to more people")}
      wide
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>{t("Cancel")}</Button>
          <Button variant="primary" disabled={!value.length} loading={send.isPending} onClick={() => send.mutate()}>
            {t("Send")}
          </Button>
        </>
      }
    >
      <RecipientPicker
        value={value}
        onChange={setValue}
        people={branchId ? people.inBranch(branchId) : []}
        groups={groups.data ?? []}
        branches={!branchId && isSuper(viewer) ? options.filter((o) => !issue.targets.some((t) => t.kind === "branch" && t.branch_id === o.id)) : undefined}
        branchId={branchId ?? null}
      />
      {(issue.type === "action" || issue.type === "report") && (
        <p className="mt-3 text-[14px] text-text-2">{t("New people get their own part of the work, due at the same time.")}</p>
      )}
    </Dialog>
  );
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  body,
  confirm,
  onConfirm,
  danger,
  loading,
  cancelText = t("Keep it"),
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  body: React.ReactNode;
  confirm: string;
  onConfirm: () => void;
  danger?: boolean;
  loading?: boolean;
  cancelText?: string;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>{cancelText}</Button>
          <Button variant={danger ? "danger" : "primary"} loading={loading} onClick={onConfirm}>
            {confirm}
          </Button>
        </>
      }
    >
      <div className="text-text-2">{body}</div>
    </Dialog>
  );
}

export function useIssueAction(issue: IssueDetail, action: "close" | "cancel") {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<IssueDetail>(`/issues/${issue.id}/${action}`, { version: issue.version }),
    onSuccess: (updated) => {
      setIssue(qc, updated);
      qc.invalidateQueries({ queryKey: keys.history(issue.id) });
      toast.success(action === "close" ? t("Closed") : t("Cancelled"));
    },
    onError: (e) => {
      toast.error(errorMessage(e));
      qc.invalidateQueries({ queryKey: keys.issue(issue.id) });
    },
  });
}
