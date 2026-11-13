// Branches & admins, for super admins (UX_SPEC §4.13). There's no school-wide
// person search (gap G-12), so pickers merge every branch's member list.
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUpRight, Ban, FileSpreadsheet, Hash, Mail, MoreHorizontal, Pencil, Plus, RotateCcw, Shield, UserPlus, Users, X } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/api/client";
import { useBranches, useGroups } from "@/api/hooks";
import type { Branch, RootUser } from "@/api/types";
import { useBranch } from "@/app/BranchContext";
import { Avatar } from "@/components/badges";
import { PersonSelect } from "@/components/pickers";
import { Button, Card, Dialog, EmptyState, ErrorPanel, Field, IconButton, LoadingRows, Menu, MenuItem, PageHeader, SectionLabel, cx, inputClass } from "@/components/ui";
import { isSuper } from "@/lib/can";
import { errorMessage } from "@/lib/labels";
import { useViewer } from "@/lib/useViewer";
import { usePeople } from "@/people/usePeople";
import { ConfirmDialog } from "@/features/items/ItemDialogs";
import { ImportMembersDialog } from "./ImportMembers";
import { AddMemberDialog } from "./PeoplePage";
import { PersonPanel } from "./PersonPanel";
import { localeTag, num, t, tn } from "@/i18n";

const ZONES = (() => {
  try {
    return (Intl as unknown as { supportedValuesOf: (k: string) => string[] }).supportedValuesOf("timeZone");
  } catch {
    return ["Europe/London", "UTC"];
  }
})();

/** The zone's everyday name ("Iran Time"), so people can find a zone by
 * country or name, not only by its ID (Asia/Tehran). */
function zoneName(zone: string, locale: string) {
  try {
    const parts = new Intl.DateTimeFormat(locale, { timeZone: zone, timeZoneName: "longGeneric" }).formatToParts(new Date());
    return parts.find((x) => x.type === "timeZoneName")?.value ?? "";
  } catch {
    return "";
  }
}

/** Each zone with its name in the reader's language and in English. */
const ZONE_LABELS = ZONES.map((z) => {
  const local = zoneName(z, localeTag);
  const english = zoneName(z, "en");
  return { zone: z, label: [local, english !== local ? english : ""].filter(Boolean).join(" · ") };
});

export function BranchesPage() {
  const viewer = useViewer();
  const branches = useBranches();
  const [creating, setCreating] = useState(false);
  if (!isSuper(viewer)) return <EmptyState title={t("Only root users manage branches.")} />;
  return (
    <div className="space-y-8">
      <PageHeader
        title={t("Branches & admins")}
        subtitle={t("A branch always keeps at least one admin.")}
        actions={
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
            {t("Open a new branch")}
          </Button>
        }
      />
      {branches.isLoading ? (
        <LoadingRows />
      ) : branches.error ? (
        <ErrorPanel error={branches.error} onRetry={() => branches.refetch()} />
      ) : (
        <div className="grid items-stretch gap-4 md:grid-cols-2 xl:grid-cols-3">
          {(branches.data ?? []).map((b) => (
            <BranchCard key={b.id} branch={b} />
          ))}
        </div>
      )}
      <SuperAdmins />
      <NewBranchDialog open={creating} onOpenChange={setCreating} />
    </div>
  );
}

function BranchCard({ branch }: { branch: Branch }) {
  const qc = useQueryClient();
  const people = usePeople();
  const { setBranch } = useBranch();
  const [appointing, setAppointing] = useState(false);
  const [pick, setPick] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [closing, setClosing] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState<null | "one" | "import">(null);
  const admins = people.all.filter((p) => p.adminOf.includes(branch.id));
  const members = people.inBranch(branch.id);
  const groups = useGroups(branch.id);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["people"] });
    qc.invalidateQueries({ queryKey: ["branches"] });
    qc.invalidateQueries({ queryKey: ["me"] });
  };
  const appoint = useMutation({
    mutationFn: (id: string) => api.put(`/branches/${branch.id}/admins/${id}`),
    onSuccess: () => (toast.success(t("Admin appointed")), setAppointing(false), setPick(null), refresh()),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const demote = useMutation({
    mutationFn: (id: string) => api.del(`/branches/${branch.id}/admins/${id}`),
    onSuccess: () => (toast.success(t("Admin role removed")), setRemoving(null), refresh()),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const toggle = useMutation({
    mutationFn: () => api.patch(`/branches/${branch.id}`, { is_active: !branch.is_active }),
    onSuccess: () => (toast.success(branch.is_active ? t("Branch closed") : t("Branch reopened")), setClosing(false), refresh()),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const departments = (groups.data ?? []).filter((g) => g.kind === "department" && !g.archived_at);
  const chip = "inline-flex max-w-full items-center gap-1.5 rounded-full bg-sunken py-1 ps-1 pe-3 text-[14px]";
  return (
    <Card className={cx("flex flex-col p-5", !branch.is_active && "opacity-70")}>
      <div className="flex items-start gap-2">
        <h2 className="min-w-0 flex-1 text-[20px] leading-7 font-bold break-anywhere">{branch.name}</h2>
        {!branch.is_active && <span className="mt-0.5 rounded-md bg-sunken px-2 text-[13px] text-text-2">{t("Closed")}</span>}
        <Menu trigger={<IconButton variant="ghost" size="sm" label={t("More actions")} icon={<MoreHorizontal className="size-5" />} />}>
          {branch.is_active && (
            <MenuItem onSelect={() => setBranch(branch.id)}>
              <ArrowUpRight className="size-4 rtl:-scale-x-100" />
              {t("Open branch")}
            </MenuItem>
          )}
          <MenuItem onSelect={() => setEditing(true)}>
            <Pencil className="size-4" />
            {t("Edit")}
          </MenuItem>
          <MenuItem danger={branch.is_active} onSelect={() => setClosing(true)}>
            {branch.is_active ? <Ban className="size-4" /> : <RotateCcw className="size-4" />}
            {branch.is_active ? t("Close branch") : t("Reopen")}
          </MenuItem>
        </Menu>
      </div>

      <dl className="mt-1 mb-5 space-y-4">
        <div className="space-y-1 text-text-2">
          <dt className="sr-only">{t("Code")}</dt>
          <dd className="flex items-center gap-2">
            <Hash className="size-4 shrink-0 text-text-3" aria-hidden />
            <span className="font-mono text-[14px] tracking-wide">{branch.code}</span>
          </dd>
          <dt className="sr-only">{t("Email")}</dt>
          <dd className="flex min-w-0 items-center gap-2">
            <Mail className="size-4 shrink-0 text-text-3" aria-hidden />
            {branch.email ? <span className="truncate" dir="ltr">{branch.email}</span> : <span className="text-text-3">{t("No email")}</span>}
          </dd>
        </div>

        <div>
          <dt className="mb-1.5"><SectionLabel>{t("Admins")}</SectionLabel></dt>
          <dd className="flex flex-wrap gap-1.5">
            {admins.map((a) => (
              <span key={a.id} className={chip}>
                <button onClick={() => setOpen(a.id)} className="flex min-w-0 items-center gap-1.5 hover:underline">
                  <Avatar first={a.first_name} last={a.last_name} id={a.id} size={24} />
                  <span className="truncate">
                    {a.first_name} {a.last_name}
                  </span>
                </button>
                {admins.length > 1 && (
                  <button onClick={() => setRemoving(a.id)} aria-label={t("Remove admin role")} className="text-text-3 hover:text-danger">
                    <X className="size-3.5" />
                  </button>
                )}
              </span>
            ))}
            {admins.length === 0 && <span className="text-[14px] text-text-2">{t("No admin yet")}</span>}
            {branch.is_active && (
              <button
                onClick={() => setAppointing(true)}
                disabled={members.length === 0}
                className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-3 py-1 text-[14px] text-text-2 hover:border-border-strong hover:text-text disabled:opacity-50"
              >
                <Plus className="size-3.5" />
                {t("Appoint")}
              </button>
            )}
          </dd>
        </div>

        <div>
          <dt className="mb-1.5"><SectionLabel>{t("Departments")}</SectionLabel></dt>
          <dd className="flex flex-wrap gap-1.5">
            {departments.map((g) => (
              <Link key={g.id} to="/people" search={{ branch: branch.id, group: g.id }} className={cx(chip, "ps-3 hover:bg-surface-2")}>
                <span className="truncate">{g.name}</span>
                <span className="text-text-3 tabular">{num(g.member_count)}</span>
              </Link>
            ))}
            {groups.isSuccess && departments.length === 0 && <span className="text-[14px] text-text-2">{t("No departments yet")}</span>}
          </dd>
        </div>
      </dl>

      <div className="mt-auto flex items-center gap-3 border-t border-border pt-4">
        <Link to="/people" search={{ tab: "members", branch: branch.id }} className="flex min-w-0 flex-1 items-center gap-2 font-semibold text-primary hover:underline">
          <Users className="size-4 shrink-0" aria-hidden />
          {tn(members.length, "{n} person", "{n} people")}
        </Link>
        {branch.is_active && (
          <Menu
            trigger={<IconButton variant="primary" label={t("Add people")} hintAlign="end" icon={<UserPlus className="size-5" />} />}
          >
            <MenuItem onSelect={() => setAdding("one")}>
              <UserPlus className="size-5" />
              {t("Add one person")}
            </MenuItem>
            <MenuItem onSelect={() => setAdding("import")}>
              <FileSpreadsheet className="size-5" />
              {t("Import from Excel")}
            </MenuItem>
          </Menu>
        )}
      </div>

      <Dialog
        open={appointing}
        onOpenChange={(o) => (setAppointing(o), o || setPick(null))}
        title={t("Appoint a branch admin")}
        description={branch.name}
        footer={
          <>
            <Button onClick={() => setAppointing(false)}>{t("Cancel")}</Button>
            <Button variant="primary" disabled={!pick} loading={appoint.isPending} onClick={() => pick && appoint.mutate(pick)}>
              {t("Appoint admin")}
            </Button>
          </>
        }
      >
        <PersonSelect people={members} value={pick} onChange={setPick} exclude={admins.map((a) => a.id)} />
      </Dialog>
      <AddMemberDialog open={adding === "one"} onOpenChange={(o) => !o && setAdding(null)} branchId={branch.id} branchName={branch.name} />
      <ImportMembersDialog open={adding === "import"} onOpenChange={(o) => !o && setAdding(null)} branchId={branch.id} branchName={branch.name} />
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={t("Remove admin role?")}
        body={t("{person} will stay a member of {branch} but won't be an admin.", { person: people.name(removing), branch: branch.name })}
        confirm={t("Remove admin role")}
        loading={demote.isPending}
        onConfirm={() => removing && demote.mutate(removing)}
      />
      <ConfirmDialog
        open={closing}
        onOpenChange={setClosing}
        title={branch.is_active ? t("Close {name}?", { name: branch.name }) : t("Reopen {name}?", { name: branch.name })}
        body={branch.is_active ? t("People can't work in {name} any more. Its history stays.", { name: branch.name }) : t("People can work in it again.")}
        confirm={branch.is_active ? t("Close branch") : t("Reopen branch")}
        danger={branch.is_active}
        loading={toggle.isPending}
        onConfirm={() => toggle.mutate()}
      />
      {editing && <EditBranchDialog branch={branch} onClose={() => setEditing(false)} />}
      <PersonPanel userId={open} branchId={branch.id} onClose={() => setOpen(null)} />
    </Card>
  );
}

function EditBranchDialog({ branch, onClose }: { branch: Branch; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState(branch.name);
  const [code, setCode] = useState(branch.code);
  const [timezone, setTimezone] = useState(branch.timezone);
  const [email, setEmail] = useState(branch.email ?? "");
  const save = useMutation({
    mutationFn: () => api.patch(`/branches/${branch.id}`, { name: name.trim(), code, timezone, email: email.trim() || null }),
    onSuccess: () => (toast.success(t("Saved")), qc.invalidateQueries({ queryKey: ["branches"] }), qc.invalidateQueries({ queryKey: ["me"] }), onClose()),
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t("Edit {name}", { name: branch.name })}
      footer={
        <>
          <Button onClick={onClose}>{t("Cancel")}</Button>
          <Button variant="primary" loading={save.isPending} disabled={!/^[A-Z0-9]{2,10}$/.test(code) || !name.trim()} onClick={() => save.mutate()}>
            {t("Save")}
          </Button>
        </>
      }
    >
      <BranchFields {...{ name, setName, code, setCode, timezone, setTimezone, email, setEmail }} />
    </Dialog>
  );
}

function BranchFields(p: { name: string; setName: (v: string) => void; code: string; setCode: (v: string) => void; timezone: string; setTimezone: (v: string) => void; email: string; setEmail: (v: string) => void }) {
  return (
    <div className="space-y-4">
      <Field label={t("Name")}>{(f) => <input {...f} value={p.name} onChange={(e) => p.setName(e.target.value)} placeholder={t("North Campus")} className={inputClass} />}</Field>
      <Field label={t("Code")} hint={t("2 to 10 capital letters or digits, used in item numbers.")} error={p.code && !/^[A-Z0-9]{2,10}$/.test(p.code) ? t("Use 2 to 10 capital letters or digits.") : null}>
        {(f) => <input {...f} value={p.code} onChange={(e) => p.setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))} maxLength={10} placeholder="NTH" className={cx(inputClass, "font-mono")} />}
      </Field>
      <Field label={t("Time zone")}>
        {(f) => (
          <>
            <input {...f} list="tz-list" value={p.timezone} onChange={(e) => p.setTimezone(e.target.value)} className={inputClass} />
            <datalist id="tz-list">
              {ZONE_LABELS.map((z) => (
                <option key={z.zone} value={z.zone} label={z.label} />
              ))}
            </datalist>
          </>
        )}
      </Field>
      <Field label={t("Email")} optional>
        {(f) => <input {...f} type="email" value={p.email} onChange={(e) => p.setEmail(e.target.value)} className={inputClass} />}
      </Field>
    </div>
  );
}

function NewBranchDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [timezone, setTimezone] = useState("Asia/Tehran");
  const [email, setEmail] = useState("");
  // A new branch has no people yet: its admin is appointed once they're in.
  const create = useMutation({
    mutationFn: () => api.post<Branch>("/branches", { name: name.trim(), code, timezone, email: email.trim() || null }),
    onSuccess: (b) => {
      toast.success(t("{name} is open", { name: b.name }));
      qc.invalidateQueries({ queryKey: ["branches"] });
      qc.invalidateQueries({ queryKey: ["people"] });
      onOpenChange(false);
      setName("");
      setCode("");
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      wide
      title={t("Open a new branch")}
      description={t("You can add its people and appoint its admin after opening it.")}
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>{t("Cancel")}</Button>
          <Button variant="primary" disabled={!name.trim() || !/^[A-Z0-9]{2,10}$/.test(code)} loading={create.isPending} onClick={() => create.mutate()}>
            {t("Open branch")}
          </Button>
        </>
      }
    >
      <BranchFields {...{ name, setName, code, setCode, timezone, setTimezone, email, setEmail }} />
    </Dialog>
  );
}

function SuperAdmins() {
  const viewer = useViewer();
  const qc = useQueryClient();
  const people = usePeople();
  const roots = useQuery({ queryKey: ["root-users"], queryFn: () => api.get<RootUser[]>("/root-users") });
  const [pick, setPick] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<RootUser | null>(null);
  const refresh = () => (qc.invalidateQueries({ queryKey: ["root-users"] }), qc.invalidateQueries({ queryKey: ["people"] }), qc.invalidateQueries({ queryKey: ["me"] }));
  const grant = useMutation({
    mutationFn: (id: string) => api.put(`/users/${id}/super-admin`),
    onSuccess: () => (toast.success(t("{name} is now a root user", { name: people.name(pick) })), setAdding(false), setPick(null), refresh()),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api.del(`/users/${id}/super-admin`),
    onSuccess: () => (toast.success(t("Root user role removed")), setRemoving(null), refresh()),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const list = roots.data ?? [];
  const me = viewer.me.user.id;
  return (
    <Card className="p-6">
      <h2 className="text-[20px] font-semibold">{t("Root users")}</h2>
      <p className="mt-1 text-text-2">{t("Root users see every branch, send work school-wide and approve it. There must always be at least one.")}</p>
      {roots.isLoading ? (
        <LoadingRows rows={2} />
      ) : (
        <ul className="mt-4 divide-y divide-border">
          {list.map((u) => (
            <li key={u.id} className="flex items-center gap-3 py-3">
              <Avatar first={u.first_name} last={u.last_name} id={u.id} size={36} />
              <span className="min-w-0 flex-1">
                <span className="block font-medium">
                  {u.first_name} {u.last_name}
                  {u.id === me && <span className="text-text-3">{" "}{t("(you)")}</span>}
                  {!u.is_active && <span className="ms-2 rounded-md bg-sunken px-1.5 text-[12px] text-text-2">{t("Deactivated")}</span>}
                </span>
                <span className="block truncate text-[14px] text-text-3" dir="ltr">
                  {u.email}
                </span>
              </span>
              {list.length > 1 && (
                <Button variant="ghost-danger" size="sm" onClick={() => setRemoving(u)}>
                  {t("Remove root role")}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3">
        {adding ? (
          <div className="w-full space-y-3 rounded-[12px] border border-border p-4">
            <PersonSelect people={people.all} value={pick} onChange={setPick} exclude={list.map((u) => u.id)} />
            <div className="flex gap-2">
              <Button variant="primary" disabled={!pick} loading={grant.isPending} onClick={() => pick && grant.mutate(pick)}>
                {t("Make root user")}
              </Button>
              <Button onClick={() => setAdding(false)}>{t("Cancel")}</Button>
            </div>
          </div>
        ) : (
          <Button icon={<Shield className="size-4" />} onClick={() => setAdding(true)}>
            {t("Make someone a root user")}
          </Button>
        )}
      </div>
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={removing?.id === me ? t("Stop being a root user yourself?") : t("Remove {name}'s root role?", { name: `${removing?.first_name} ${removing?.last_name}` })}
        body={t("They keep their account and branches, but no longer run the school.")}
        confirm={t("Remove root role")}
        danger
        loading={revoke.isPending}
        onConfirm={() => removing && revoke.mutate(removing.id)}
      />
    </Card>
  );
}
