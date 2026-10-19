// Branches & admins, for super admins (UX_SPEC §4.13). There's no school-wide
// person search (gap G-12), so pickers merge every branch's member list.
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Shield } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/api/client";
import { useBranches } from "@/api/hooks";
import type { Branch } from "@/api/types";
import { useBranch } from "@/app/BranchContext";
import { Avatar } from "@/components/badges";
import { PersonSelect } from "@/components/pickers";
import { Button, Card, Dialog, EmptyState, ErrorPanel, Field, LoadingRows, PageHeader, SectionLabel, cx, inputClass } from "@/components/ui";
import { isSuper } from "@/lib/can";
import { errorMessage } from "@/lib/labels";
import { useViewer } from "@/lib/useViewer";
import { usePeople } from "@/people/usePeople";
import { ConfirmDialog } from "@/features/items/ItemDialogs";
import { PersonPanel } from "./PersonPanel";
import { t } from "@/i18n";

const ZONES = (() => {
  try {
    return (Intl as unknown as { supportedValuesOf: (k: string) => string[] }).supportedValuesOf("timeZone");
  } catch {
    return ["Europe/London", "UTC"];
  }
})();

export function BranchesPage() {
  const viewer = useViewer();
  const branches = useBranches();
  const [creating, setCreating] = useState(false);
  if (!isSuper(viewer)) return <EmptyState title={t("Only super admins manage branches.")} />;
  return (
    <div className="space-y-8">
      <PageHeader
        title={t("Branches & admins")}
        subtitle={t("A branch always keeps at least one admin.")}
        actions={
          <Button variant="primary" size="lg" icon={<Plus className="size-5" />} onClick={() => setCreating(true)}>
            {t("Open a new branch")}
          </Button>
        }
      />
      {branches.isLoading ? (
        <LoadingRows />
      ) : branches.error ? (
        <ErrorPanel error={branches.error} onRetry={() => branches.refetch()} />
      ) : (
        <div className="space-y-4">
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
  const admins = people.all.filter((p) => p.adminOf.includes(branch.id));
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
  return (
    <Card className={cx("p-6", !branch.is_active && "opacity-70")}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[20px] font-semibold">
            {branch.name}{" "}<span className="font-mono text-[14px] text-text-3">{branch.code}</span>
            {!branch.is_active && <span className="ms-2 rounded-md bg-sunken px-2 text-[13px] text-text-2">{t("Closed")}</span>}
          </h2>
          <p className="text-text-2">
            {branch.timezone}
            {branch.email && ` · ${branch.email}`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {branch.is_active && <Button onClick={() => setBranch(branch.id)}>{t("Open branch")}</Button>}
          <Button onClick={() => setEditing(true)}>{t("Edit")}</Button>
          <Button variant={branch.is_active ? "ghost-danger" : "ghost"} onClick={() => setClosing(true)}>
            {branch.is_active ? t("Close branch") : t("Reopen")}
          </Button>
        </div>
      </div>
      <div className="mt-5">
        <SectionLabel className="mb-2">{t("Admins")}</SectionLabel>
        <ul className="space-y-2">
          {admins.map((a) => (
            <li key={a.id} className="flex items-center gap-3">
              <button onClick={() => setOpen(a.id)} className="flex min-w-0 flex-1 items-center gap-3 rounded-[10px] text-start hover:bg-surface-2">
                <Avatar first={a.first_name} last={a.last_name} id={a.id} size={32} />
                <span className="font-medium text-primary hover:underline">
                  {a.first_name} {a.last_name}
                </span>
              </button>
              {admins.length > 1 ? (
                <Button size="sm" variant="ghost" onClick={() => setRemoving(a.id)}>
                  {t("Remove admin role")}
                </Button>
              ) : (
                <span className="rounded-full bg-warning-soft px-2 py-0.5 text-[13px] font-semibold text-warning">{t("Only one admin")}</span>
              )}
            </li>
          ))}
          {admins.length === 0 && <li className="text-text-2">{t("No admins found.")}</li>}
        </ul>
        {appointing ? (
          <div className="mt-4 space-y-3 rounded-[12px] border border-border p-4">
            <PersonSelect people={people.all} value={pick} onChange={setPick} exclude={admins.map((a) => a.id)} />
            <div className="flex gap-2">
              <Button variant="primary" disabled={!pick} loading={appoint.isPending} onClick={() => pick && appoint.mutate(pick)}>
                {t("Appoint admin")}
              </Button>
              <Button onClick={() => setAppointing(false)}>{t("Cancel")}</Button>
            </div>
            <p className="text-[13px] text-text-3">{t("People who aren't members yet are added to {name}.", { name: branch.name })}</p>
          </div>
        ) : (
          <Button className="mt-4" icon={<Shield className="size-4" />} onClick={() => setAppointing(true)}>
            {t("Appoint a branch admin")}
          </Button>
        )}
      </div>
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
              {ZONES.map((z) => (
                <option key={z} value={z} />
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
  const people = usePeople();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [timezone, setTimezone] = useState("Europe/London");
  const [email, setEmail] = useState("");
  const [admin, setAdmin] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: () => api.post<Branch>("/branches", { name: name.trim(), code, timezone, email: email.trim() || null, first_admin_user_id: admin }),
    onSuccess: (b) => {
      toast.success(t("{name} is open", { name: b.name }));
      qc.invalidateQueries({ queryKey: ["branches"] });
      qc.invalidateQueries({ queryKey: ["people"] });
      onOpenChange(false);
      setName("");
      setCode("");
      setAdmin(null);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      wide
      title={t("Open a new branch")}
      description={t("Every branch needs an admin. You can add more later.")}
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>{t("Cancel")}</Button>
          <Button variant="primary" disabled={!name.trim() || !/^[A-Z0-9]{2,10}$/.test(code) || !admin} loading={create.isPending} onClick={() => create.mutate()}>
            {t("Open branch")}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <BranchFields {...{ name, setName, code, setCode, timezone, setTimezone, email, setEmail }} />
        <div>
          <p className="mb-2 font-semibold">{t("First admin")}</p>
          <PersonSelect people={people.all} value={admin} onChange={setAdmin} />
        </div>
      </div>
    </Dialog>
  );
}

function SuperAdmins() {
  const viewer = useViewer();
  const qc = useQueryClient();
  const people = usePeople();
  const [pick, setPick] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const grant = useMutation({
    mutationFn: (id: string) => api.put(`/users/${id}/super-admin`),
    onSuccess: () => (toast.success(t("{name} is now a super admin", { name: people.name(pick) })), setAdding(false), setPick(null), qc.invalidateQueries({ queryKey: ["people"] })),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api.del(`/users/${id}/super-admin`),
    onSuccess: () => (toast.success(t("Super admin role removed")), qc.invalidateQueries({ queryKey: ["me"] })),
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Card className="p-6">
      <h2 className="text-[20px] font-semibold">{t("Super admins")}</h2>
      <p className="mt-1 text-text-2">{t("Super admins see every branch, send work school-wide and approve it. There must always be at least one.")}</p>
      <div className="mt-4 flex flex-wrap gap-2">
        {adding ? (
          <div className="w-full space-y-3 rounded-[12px] border border-border p-4">
            <PersonSelect people={people.all} value={pick} onChange={setPick} />
            <div className="flex gap-2">
              <Button variant="primary" disabled={!pick} loading={grant.isPending} onClick={() => pick && grant.mutate(pick)}>
                {t("Make super admin")}
              </Button>
              <Button onClick={() => setAdding(false)}>{t("Cancel")}</Button>
            </div>
          </div>
        ) : (
          <>
            <Button icon={<Shield className="size-4" />} onClick={() => setAdding(true)}>
              {t("Make someone a super admin")}
            </Button>
            <Button variant="ghost-danger" loading={revoke.isPending} onClick={() => confirm(t("Stop being a super admin yourself?")) && revoke.mutate(viewer.me.user.id)}>
              {t("Remove my own super admin role")}
            </Button>
          </>
        )}
      </div>
      <p className="mt-3 text-[13px] text-text-3">{t("The app can't list every super admin yet; ask for the backend to add it (gap G-12).")}</p>
    </Card>
  );
}
