// New item, as a modal over the current page (UX_SPEC §4.7). One calm column:
// pick a kind, fill in what it needs, and a one-line summary sits by the button.
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Lock, X } from "lucide-react";
import { addDays, format, setHours, setMinutes } from "date-fns";
import { toast } from "sonner";
import { ApiError, api } from "@/api/client";
import { useGroups } from "@/api/hooks";
import type { CompletionMode, IssueDetail, IssueType, NewIssue, Priority } from "@/api/types";
import { PRIORITIES } from "@/api/types";
import { useBranch } from "@/app/BranchContext";
import type { NewItemOptions } from "@/app/newItemContext";
import { AttachButton, PendingFiles, uploadAll, useFilePicker } from "@/components/files";
import { RecipientPicker, type Recipient } from "@/components/pickers";
import { Button, DrawerClose, Field, Segmented, cx, inputClass } from "@/components/ui";
import { canSendType, canSetPrivateIn, creatableTypes, isSuper } from "./rules";
import { describeReminders, formatDateTime, fromLocalInput, toLocalInput } from "@/lib/dates";
import { errorMessage, modeTitle, priorityLabel, typeLabel, typePitch } from "@/lib/labels";
import { useViewer } from "@/lib/useViewer";
import { usePeople } from "@/people/usePeople";

const REMINDER_CHOICES = [
  { mins: 10080, label: "1 week" },
  { mins: 1440, label: "1 day" },
  { mins: 60, label: "1 hour" },
  { mins: 15, label: "15 min" },
];

type Draft = {
  type?: IssueType;
  title: string;
  description: string;
  priority: Priority;
  isPrivate: boolean;
  mode: CompletionMode;
  due: string;
  starts: string;
  ends: string;
  allDay: boolean;
  location: string;
  reminders: number[];
  recipients: Recipient[];
  branch: string | "school";
};

const DRAFT_KEY = "st.draft.new";

function defaultDue(type: IssueType | undefined) {
  const d = setMinutes(setHours(addDays(new Date(), type === "action" ? 3 : 7), 17), 0);
  return format(d, "yyyy-MM-dd'T'HH:mm");
}

function readDraft(): Partial<Draft> {
  try {
    return JSON.parse(sessionStorage.getItem(DRAFT_KEY) ?? "{}");
  } catch {
    return {};
  }
}

function clearDraft() {
  try {
    sessionStorage.removeItem(DRAFT_KEY);
  } catch {
    // storage unavailable
  }
}

export function NewItemModal({ initial, onClose }: { initial: NewItemOptions; onClose: () => void }) {
  const viewer = useViewer();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const people = usePeople();
  const { branchId, options, zoneOf } = useBranch();
  const superAdmin = isSuper(viewer);
  const files = useFilePicker();

  const [d, setD] = useState<Draft>(() => {
    const saved = initial.type || initial.date || initial.group ? {} : readDraft();
    const type = initial.type ?? saved.type;
    const start = initial.date ? `${initial.date}T18:00` : format(setMinutes(setHours(addDays(new Date(), 1), 18), 0), "yyyy-MM-dd'T'HH:mm");
    return {
      title: "",
      description: "",
      priority: "medium",
      isPrivate: false,
      mode: "per_member",
      due: defaultDue(type),
      starts: start,
      ends: start.replace(/T(\d\d)/, (_, h) => `T${String(Math.min(23, Number(h) + 2)).padStart(2, "0")}`),
      allDay: false,
      location: "",
      reminders: [1440, 60],
      recipients: [],
      branch: branchId ?? (superAdmin && type !== "event" ? "school" : options[0]?.id ?? ""),
      ...saved,
      type,
    };
  });
  const set = (patch: Partial<Draft>) => setD((x) => ({ ...x, ...patch }));
  const [error, setError] = useState<{ field?: string; text: string } | null>(null);
  const [showMore, setShowMore] = useState(false);

  useEffect(() => {
    const id = setTimeout(() => {
      try {
        sessionStorage.setItem(DRAFT_KEY, JSON.stringify(d));
      } catch {
        // storage unavailable
      }
    }, 600);
    return () => clearTimeout(id);
  }, [d]);

  const createBranch = d.branch === "school" ? null : d.branch;
  const zone = zoneOf(createBranch) ?? zoneOf(options[0]?.id);
  const branch = options.find((o) => o.id === createBranch);
  const groups = useGroups(createBranch ?? undefined);
  const kinds = creatableTypes(viewer, createBranch);
  const canSend = d.type ? canSendType(viewer, createBranch, d.type) : false;
  const hasWork = d.type === "action" || d.type === "report";
  const groupGoing = d.recipients.some((r) => r.kind !== "user");

  useEffect(() => {
    if (initial.group && groups.data && !d.recipients.length && createBranch) {
      const g = groups.data.find((x) => x.id === initial.group);
      if (g) set({ recipients: [{ kind: "group", id: g.id, branchId: createBranch, label: g.name, count: g.member_count }] });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial.group, groups.data]);

  const headcount = useMemo(() => {
    const ids = new Set<string>();
    let extra = 0;
    for (const r of d.recipients) {
      if (r.kind === "user") ids.add(r.id);
      else if (r.kind === "group") extra += r.count;
      else extra += people.inBranch(r.id).length;
    }
    return ids.size + extra;
  }, [d.recipients, people]);
  const pieces = hasWork ? (d.mode === "per_member" ? headcount : d.recipients.length) : 0;

  const create = useMutation({
    mutationFn: async () => {
      const body: NewIssue = {
        type: d.type!,
        branch_id: createBranch,
        title: d.title.trim(),
        description: d.description.trim() || null,
        priority: d.priority,
        is_private: d.isPrivate || undefined,
        targets: d.recipients.map((r) => (r.kind === "user" ? { user_id: r.id } : r.kind === "group" ? { group_id: r.id } : { branch_id: r.id })),
      };
      if (hasWork) {
        body.completion_mode = groupGoing ? d.mode : "per_member";
        if (d.recipients.length) body.sla_due_at = fromLocalInput(d.due, zone);
      }
      if (d.type === "event") {
        const startIso = d.allDay ? fromLocalInput(`${d.starts.slice(0, 10)}T00:00`, zone) : fromLocalInput(d.starts, zone);
        const endIso = d.allDay ? fromLocalInput(`${d.ends.slice(0, 10)}T23:59`, zone) : fromLocalInput(d.ends, zone);
        body.event = { starts_at: startIso, ends_at: endIso, all_day: d.allDay, location: d.location || null, reminders: d.reminders };
      }
      const issue = await api.post<IssueDetail>("/issues", body);
      if (files.files.length) await uploadAll(issue.id, files.files);
      return issue;
    },
    onSuccess: (issue) => {
      clearDraft();
      qc.invalidateQueries({ queryKey: ["issues", "list"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["calendar"] });
      toast.success(d.recipients.length ? `Sent. ${issue.key} is on its way.` : `${issue.key} created.`, {
        action: { label: "Open", onClick: () => navigate({ to: "/items/$number", params: { number: String(issue.number) } }) },
      });
      onClose();
    },
    onError: (e) => {
      const code = e instanceof ApiError ? e.code : "";
      const field =
        code === "invalid_title" ? "title" : code === "invalid_target" ? "recipients" : ["invalid_event_range", "invalid_reminders", "event_required"].includes(code) ? "event" : code === "invalid_sla" ? "due" : undefined;
      setError({ field, text: errorMessage(e) });
      if (!field) toast.error(errorMessage(e));
    },
  });

  const discard = () => {
    clearDraft();
    onClose();
  };

  const problems: string[] = [];
  if (!d.type) problems.push("Pick what you need.");
  else if (!kinds.includes(d.type)) problems.push(`You can't create ${typeLabel[d.type].toLowerCase()}s here.`);
  else if (!d.title.trim()) problems.push("Give it a title.");
  else if (d.type === "event" && !d.allDay && d.ends <= d.starts) problems.push("The end must be after the start.");
  else if (d.type === "action" && canSend && !d.recipients.length) problems.push("Choose who it's for.");
  else if (createBranch === null && d.recipients.length === 0) problems.push("Add at least one branch, or choose a single branch above.");
  else if (createBranch === null && d.recipients.some((r) => r.kind !== "branch")) problems.push("School-wide items go to whole branches.");

  const dueText = hasWork && d.recipients.length ? `, due ${formatDateTime(fromLocalInput(d.due, zone), zone)}` : "";
  const summary = !d.type
    ? ""
    : d.type === "report"
      ? d.recipients.length
        ? `${pieces} ${pieces === 1 ? "report" : "reports"} to write${dueText}. Each comes back to you to approve.`
        : "You file this report yourself."
      : d.type === "action"
        ? createBranch === null
          ? `Goes to ${d.recipients.length} branch${d.recipients.length === 1 ? "" : "es"}${dueText}. Super admins approve.`
          : `${pieces || "No"} ${pieces === 1 ? "task" : "tasks"}${dueText}. Each comes back to you to approve.`
        : d.type === "ticket"
          ? d.recipients.length
            ? `${headcount} ${headcount === 1 ? "person is" : "people are"} told straight away.`
            : "It goes to the branch admins."
          : d.recipients.length
            ? `${headcount} invited${d.reminders.length ? `, reminded ${describeReminders(d.reminders)} before` : ""}.`
            : createBranch === null
              ? "School-wide events need at least one branch invited."
              : "Just on your calendar until you invite someone.";

  const sendLabel =
    d.type === "report"
      ? d.recipients.length
        ? `Request ${pieces > 1 ? `${pieces} reports` : "report"}`
        : "Create report"
      : d.type === "action"
        ? pieces > 1
          ? `Send ${pieces} tasks`
          : "Send task"
        : d.type === "event"
          ? "Create event"
          : d.type === "ticket"
            ? "Ask"
            : "Send";

  const branchPeople = createBranch ? people.inBranch(createBranch) : [];
  const showBranchPicker = options.length > 1 || superAdmin;

  return (
    <>
      <div className="flex items-center gap-3 border-b border-border px-6 py-4">
        <h2 className="text-[20px] font-bold">New {d.type ? typeLabel[d.type].toLowerCase() : "item"}</h2>
        {showBranchPicker ? (
          <select
            value={d.branch}
            onChange={(e) => set({ branch: e.target.value, recipients: [] })}
            className="h-8 rounded-full border border-border bg-surface-2 px-3 text-[14px] text-text-2"
            aria-label="Create in"
          >
            {superAdmin && <option value="school">School-wide (several branches)</option>}
            {options
              .filter((o) => superAdmin || creatableTypes(viewer, o.id).length > 0)
              .map((o) => (
                <option key={o.id} value={o.id}>
                  in {o.name}
                </option>
              ))}
          </select>
        ) : (
          <span className="text-text-2">in {branch?.name}</span>
        )}
        <DrawerClose className="ml-auto rounded-full p-2 text-text-2 hover:bg-sunken" aria-label="Close">
          <X className="size-5" />
        </DrawerClose>
      </div>

      <div className="flex-1 space-y-6 overflow-y-auto px-6 py-5">
        {!initial.onlyType && (
        <div role="radiogroup" aria-label="What do you need?" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {(["ticket", "action", "report", "event"] as IssueType[])
            .filter((k) => kinds.includes(k))
            .map((k) => {
              const on = d.type === k;
              return (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => set({ type: k, due: defaultDue(k) })}
                  className={cx(
                    "rounded-[16px] border px-4 py-3 text-left transition-colors",
                    on ? "border-transparent" : "border-border hover:border-border-strong hover:bg-surface-2",
                  )}
                  style={on ? { background: `var(--${k}-soft)`, boxShadow: `inset 0 0 0 2px var(--${k})` } : undefined}
                >
                  <span className="block font-semibold" style={{ color: `var(--${k})` }}>
                    {typeLabel[k]}
                  </span>
                  <span className="mt-0.5 block text-[13px] leading-snug text-text-2">{typePitch[k]}</span>
                </button>
              );
            })}
        </div>
        )}
        {initial.onlyType && d.type && !kinds.includes(d.type) && <p className="text-text-2">You can't create {typeLabel[d.type].toLowerCase()}s here.</p>}
        {!initial.onlyType && kinds.length === 0 && <p className="text-text-2">You can't create items here.</p>}

        {d.type && (
          <>
            <Field label="Title" error={error?.field === "title" ? error.text : d.title.length > 180 ? `${200 - d.title.length} characters left` : null}>
              {(p) => (
                <input
                  {...p}
                  autoFocus
                  value={d.title}
                  onChange={(e) => set({ title: e.target.value })}
                  maxLength={200}
                  placeholder={d.type === "report" ? "Term 1 science report" : d.type === "event" ? "Parent evening" : d.type === "ticket" ? "Where do I order lab supplies?" : "Update fire-exit signs"}
                  className={cx(inputClass, "h-12 text-[17px]")}
                />
              )}
            </Field>

            {d.type === "event" && (
              <div className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Starts">
                    {(p) => (
                      <input {...p} type={d.allDay ? "date" : "datetime-local"} value={d.allDay ? d.starts.slice(0, 10) : d.starts} onChange={(e) => set({ starts: d.allDay ? `${e.target.value}T00:00` : e.target.value })} className={inputClass} />
                    )}
                  </Field>
                  <Field label="Ends" error={error?.field === "event" ? error.text : null}>
                    {(p) => (
                      <input {...p} type={d.allDay ? "date" : "datetime-local"} value={d.allDay ? d.ends.slice(0, 10) : d.ends} onChange={(e) => set({ ends: d.allDay ? `${e.target.value}T23:59` : e.target.value })} className={inputClass} />
                    )}
                  </Field>
                </div>
                <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                  <label className="inline-flex items-center gap-2">
                    <input type="checkbox" checked={d.allDay} onChange={(e) => set({ allDay: e.target.checked })} className="size-4" /> All day
                  </label>
                  <input value={d.location} onChange={(e) => set({ location: e.target.value })} placeholder="Where? (optional)" aria-label="Where" className={cx(inputClass, "h-10 flex-1 py-0")} />
                </div>
              </div>
            )}

            {canSend && (
              <div className="space-y-1.5">
                <span className="block font-semibold">{d.type === "event" ? "Who's invited?" : d.type === "ticket" ? "Who should answer?" : "Send to"}</span>
                <RecipientPicker
                  value={d.recipients}
                  onChange={(recipients) => set({ recipients })}
                  people={branchPeople.filter((p) => p.id !== viewer.me.user.id || d.type === "event")}
                  groups={groups.data ?? []}
                  branches={createBranch === null ? options.map((o) => ({ id: o.id, name: o.name })) : undefined}
                  branchId={createBranch}
                  placeholder={createBranch === null ? "Add a branch" : "Add a person or group"}
                />
                <p className={cx("text-[13px]", error?.field === "recipients" ? "text-danger" : "text-text-3")}>
                  {error?.field === "recipients" ? error.text : d.type === "ticket" ? "Leave it empty to ask the branch admins." : createBranch === null ? "School-wide items go to whole branches." : ""}
                </p>
              </div>
            )}

            {hasWork && groupGoing && (
              <Segmented<CompletionMode>
                label="How should groups do this?"
                value={d.mode}
                onChange={(mode) => set({ mode })}
                options={[
                  { value: "per_member", label: modeTitle.per_member.title + (headcount && createBranch ? ` (${headcount})` : "") },
                  { value: "shared", label: modeTitle.shared.title },
                ]}
              />
            )}

            <div className="flex flex-wrap items-end gap-3">
              {hasWork && d.recipients.length > 0 && (
                <Field label="Due" error={error?.field === "due" ? error.text : null}>
                  {(p) => <input {...p} type="datetime-local" value={d.due} min={toLocalInput(new Date(), zone)} onChange={(e) => set({ due: e.target.value })} className={cx(inputClass, "w-auto")} />}
                </Field>
              )}
              <Field label="Priority">
                {(p) => (
                  <select {...p} value={d.priority} onChange={(e) => set({ priority: e.target.value as Priority })} className={cx(inputClass, "w-auto")}>
                    {PRIORITIES.map((x) => (
                      <option key={x} value={x}>
                        {priorityLabel[x]}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
              {canSetPrivateIn(viewer, createBranch, d.type) && (
                <label className="mb-2.5 inline-flex items-center gap-2" title="Only the people it's sent to and admins will see it.">
                  <input type="checkbox" checked={d.isPrivate} onChange={(e) => set({ isPrivate: e.target.checked })} className="size-4" />
                  <Lock className="size-4 text-text-2" /> Private
                </label>
              )}
            </div>

            {showMore || d.description || files.files.length || d.type === "event" ? (
              <div className="space-y-2">
                <Field label="Details" optional>
                  {(p) => (
                    <textarea {...p} value={d.description} onChange={(e) => set({ description: e.target.value })} rows={4} placeholder={d.type === "report" ? "What should the report cover?" : ""} className={inputClass} />
                  )}
                </Field>
                <PendingFiles files={files.files} onRemove={files.remove} />
                <div className="flex flex-wrap items-center gap-2">
                  <AttachButton onPick={files.add} />
                  {d.type === "event" && (
                    <div className="flex flex-wrap gap-1.5" role="group" aria-label="Reminders">
                      {REMINDER_CHOICES.map((r) => {
                        const on = d.reminders.includes(r.mins);
                        return (
                          <button
                            key={r.mins}
                            type="button"
                            aria-pressed={on}
                            onClick={() => set({ reminders: on ? d.reminders.filter((m) => m !== r.mins) : [...d.reminders, r.mins] })}
                            className={cx("h-9 rounded-full border px-3 text-[14px]", on ? "border-transparent bg-primary-soft font-semibold text-primary-on-soft" : "border-border text-text-2")}
                          >
                            {r.label} before
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <button type="button" className="font-medium text-primary hover:underline" onClick={() => setShowMore(true)}>
                + Add details or files
              </button>
            )}
          </>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-border bg-surface-2 px-6 py-4">
        <p className="min-w-0 flex-1 text-[14px] text-text-2">{problems[0] && d.type ? problems[0] : summary}</p>
        <Button variant="ghost" onClick={discard}>
          Discard
        </Button>
        <Button variant="primary" disabled={problems.length > 0} loading={create.isPending} onClick={() => (setError(null), create.mutate())}>
          {create.isPending ? "Sending…" : sendLabel}
        </Button>
      </div>
    </>
  );
}
