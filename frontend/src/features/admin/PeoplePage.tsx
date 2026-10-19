// People & groups (UX_SPEC §4.11–4.12).
import { useState } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, Copy, Lock, Plus, Shield, X } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/api/client";
import { useEffectivePermissions, useGroupGrants, useGroups, useMembers } from "@/api/hooks";
import type { AddedMember, DeleteOutcome, Group, Member } from "@/api/types";
import { Avatar } from "@/components/badges";
import { PersonSelect } from "@/components/pickers";
import { Button, Card, Dialog, EmptyState, ErrorPanel, Field, LoadingRows, PageHeader, Segmented, Tabs, cx, inputClass } from "@/components/ui";
import { hasGrant, isAdminOf } from "@/lib/can";
import { formatDay } from "@/lib/dates";
import { errorMessage, permissionInfo, reachLabel, typeLabel } from "@/lib/labels";
import { useViewer } from "@/lib/useViewer";
import { usePeople } from "@/people/usePeople";
import { ConfirmDialog } from "@/features/items/ItemDialogs";
import type { PeopleSearch } from "@/app/router";
import { PersonPanel } from "./PersonPanel";
import { PermissionEditor, summarizeGrants } from "./PermissionEditor";
import { useManagedBranch } from "./useManagedBranch";

export function PeoplePage() {
  const viewer = useViewer();
  const search = useSearch({ from: "/authed/shell/people" });
  const navigate = useNavigate({ from: "/people" });
  const { branchId, branch, picker } = useManagedBranch(viewer, "member.manage", search.branch);
  const openPerson = (id: string) => navigate({ search: (s: PeopleSearch) => ({ ...s, person: id }) });
  const members = useMembers(branchId);
  const groups = useGroups(branchId, true);
  const tab = search.tab ?? "groups";
  if (!branchId) return <EmptyState title="You don't manage a branch." />;
  return (
    <div>
      <PageHeader
        title="People & groups"
        subtitle={branch?.name}
        actions={
          <>
            {picker}
            <Segmented
              label="Show"
              value={tab}
              onChange={(t) => navigate({ search: (s: PeopleSearch) => ({ ...s, tab: t === "members" ? "members" : undefined, group: undefined }) })}
              options={[
                { value: "members", label: `Members ${members.data?.length ?? ""}` },
                { value: "groups", label: `Groups ${groups.data?.filter((g) => !g.archived_at).length ?? ""}` },
              ]}
            />
          </>
        }
      />
      {tab === "members" ? (
        <MembersTab branchId={branchId} branchName={branch?.name ?? ""} onOpen={openPerson} />
      ) : (
        <GroupsTab branchId={branchId} branchName={branch?.name ?? ""} selected={search.group} onSelect={(g) => navigate({ search: (s: PeopleSearch) => ({ ...s, group: g }) })} onOpen={openPerson} />
      )}
      <PersonPanel userId={search.person} branchId={branchId} onClose={() => navigate({ search: (s: PeopleSearch) => ({ ...s, person: undefined }) })} />
    </div>
  );
}

// ---------- groups ----------

function GroupsTab({ branchId, branchName, selected, onSelect, onOpen }: { branchId: string; branchName: string; selected?: string; onSelect: (id: string) => void; onOpen: (id: string) => void }) {
  const viewer = useViewer();
  const groups = useGroups(branchId, true);
  const [creating, setCreating] = useState(false);
  const admin = isAdminOf(viewer, branchId);
  const list = groups.data ?? [];
  const [gq, setGq] = useState("");
  const active = list.filter((g) => !g.archived_at && (!gq.trim() || (g.is_default ? "all members" : g.name.toLowerCase()).includes(gq.trim().toLowerCase()))).sort((a, b) => Number(b.is_default) - Number(a.is_default) || a.name.localeCompare(b.name));
  const archived = list.filter((g) => g.archived_at);
  const current = list.find((g) => g.id === selected) ?? active.find((g) => !g.is_default) ?? active[0];
  if (groups.isLoading) return <LoadingRows />;
  if (groups.error) return <ErrorPanel error={groups.error} />;
  return (
    <div className="grid gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
      <div className="space-y-6">
        <Card className="p-2">
          {list.length > 5 && (
            <input
              type="search"
              value={gq}
              onChange={(e) => setGq(e.target.value)}
              placeholder="Find a group"
              aria-label="Find a group"
              className={cx(inputClass, "mb-1 h-10 rounded-full py-0")}
            />
          )}
          {gq && active.length === 0 && <p className="px-4 py-3 text-text-2">No group matches “{gq}”.</p>}
          <ul>
            {active.map((g) => (
              <GroupListItem key={g.id} g={g} active={current?.id === g.id} onClick={() => onSelect(g.id)} />
            ))}
          </ul>
          {admin && (
            <button onClick={() => setCreating(true)} className="flex items-center gap-2 px-4 py-3 font-semibold text-primary hover:underline">
              <Plus className="size-5" /> New group
            </button>
          )}
          {archived.length > 0 && (
            <details className="border-t border-border px-4 py-3">
              <summary className="cursor-pointer text-text-2">Archived ({archived.length})</summary>
              <ul className="mt-2">
                {archived.map((g) => (
                  <GroupListItem key={g.id} g={g} active={current?.id === g.id} onClick={() => onSelect(g.id)} />
                ))}
              </ul>
            </details>
          )}
        </Card>
        <CheckSomeone branchId={branchId} onOpen={onOpen} />
      </div>
      {current && <GroupDetail key={current.id} group={current} branchId={branchId} branchName={branchName} editable={admin} onOpen={onOpen} />}
      <NewGroupDialog open={creating} onOpenChange={setCreating} branchId={branchId} onCreated={onSelect} />
    </div>
  );
}

function GroupListItem({ g, active, onClick }: { g: Group; active: boolean; onClick: () => void }) {
  const grants = useGroupGrants(g.id);
  return (
    <li>
      <button onClick={onClick} aria-current={active} className={cx("w-full rounded-[10px] px-4 py-3 text-left", active ? "bg-primary-soft" : "hover:bg-surface-2")}>
        <span className="flex items-baseline justify-between gap-2">
          <span className="font-semibold">{g.is_default ? "All members" : g.name}</span>
          <span className="text-text-2 tabular">{g.member_count}</span>
        </span>
        <span className="block text-[14px] text-text-2">{g.is_default ? "Everyone's everyday permissions" : g.archived_at ? "Archived" : summarizeGrants(grants.data)}</span>
      </button>
    </li>
  );
}

function GroupDetail({ group, branchId, branchName, editable, onOpen }: { group: Group; branchId: string; branchName: string; editable: boolean; onOpen: (id: string) => void }) {
  const [tab, setTab] = useState<"can" | "members" | "settings">("can");
  const [renaming, setRenaming] = useState(false);
  const title = group.is_default ? "All members" : group.name;
  return (
    <Card className="min-w-0 overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-3 px-6 pt-6">
        <div>
          <h2 className="flex items-center gap-2 text-[28px] font-bold">
            {group.is_default && <Lock className="size-5 text-text-3" />}
            {title}
          </h2>
          <p className="text-text-2">
            {group.is_default ? `Everyone in ${branchName}` : group.description || "No description"} · {group.member_count} member{group.member_count === 1 ? "" : "s"}
            {group.archived_at && " · Archived"}
          </p>
        </div>
        {editable && !group.is_default && (
          <Button size="lg" onClick={() => setRenaming(true)}>
            Rename
          </Button>
        )}
      </div>
      <Tabs
        className="mx-6 mt-4"
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "can", label: "What they can do" },
          { value: "members", label: "Members", count: group.member_count },
          ...(editable && !group.is_default ? [{ value: "settings" as const, label: "Settings" }] : []),
        ]}
      />
      {tab === "can" && (editable ? <PermissionEditor group={group} branchName={branchName} /> : <ReadOnlyGrants groupId={group.id} />)}
      {tab === "members" && <GroupMembers group={group} branchId={branchId} editable={editable && !group.is_default && !group.archived_at} onOpen={onOpen} />}
      {tab === "settings" && <GroupSettings group={group} />}
      <RenameDialog group={group} open={renaming} onOpenChange={setRenaming} />
    </Card>
  );
}

function ReadOnlyGrants({ groupId }: { groupId: string }) {
  const grants = useGroupGrants(groupId);
  if (!grants.data) return <LoadingRows />;
  if (!grants.data.length) return <p className="px-6 py-6 text-text-2">No extra permissions.</p>;
  return (
    <ul className="divide-y divide-border px-6 py-2">
      {grants.data.map((g) => (
        <li key={g.id} className="py-3">
          <b>{permissionInfo[g.permission]?.title ?? g.permission}</b>
          <span className="text-text-2">
            {" "}
            · {reachLabel(g.permission, g.scope)}
            {g.issue_type && ` · ${typeLabel[g.issue_type]}s`}
          </span>
        </li>
      ))}
    </ul>
  );
}

function GroupMembers({ group, branchId, editable, onOpen }: { group: Group; branchId: string; editable: boolean; onOpen: (id: string) => void }) {
  const qc = useQueryClient();
  const people = usePeople();
  const members = useMembers(branchId, { groupId: group.id });
  const [adding, setAdding] = useState(false);
  const [mq, setMq] = useState("");
  const [pick, setPick] = useState<string | null>(null);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["branches", branchId] });
    qc.invalidateQueries({ queryKey: ["my-groups"] });
  };
  const add = useMutation({
    mutationFn: (id: string) => api.put(`/groups/${group.id}/members/${id}`),
    onSuccess: () => (toast.success("Added"), setPick(null), refresh()),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/groups/${group.id}/members/${id}`),
    onSuccess: () => (toast.success("Removed from the group"), refresh()),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const ids = new Set((members.data ?? []).map((m) => m.user_id));
  const term = mq.trim().toLowerCase();
  const shown = (members.data ?? []).filter((m) => !term || `${m.first_name} ${m.last_name} ${m.email}`.toLowerCase().includes(term));
  return (
    <div className="px-6 py-5">
      {group.is_default && <p className="mb-4 rounded-[10px] bg-sunken px-4 py-3 text-text-2">Everyone in the branch is in this group automatically.</p>}
      {(members.data?.length ?? 0) > 6 && (
        <input
          type="search"
          value={mq}
          onChange={(e) => setMq(e.target.value)}
          placeholder={`Search ${members.data?.length} members by name or email`}
          aria-label="Search members"
          className={cx(inputClass, "mb-3 h-11 rounded-full")}
        />
      )}
      {term && shown.length === 0 && <p className="py-3 text-text-2">No one matches “{mq}”.</p>}
      {editable && (
        <div className="mb-4">
          {adding ? (
            <div className="space-y-3 rounded-[12px] border border-border p-4">
              <PersonSelect people={people.inBranch(branchId)} value={pick} onChange={setPick} exclude={[...ids]} />
              <div className="flex gap-2">
                <Button variant="primary" disabled={!pick} loading={add.isPending} onClick={() => pick && add.mutate(pick)}>
                  Add to {group.name}
                </Button>
                <Button onClick={() => setAdding(false)}>Done</Button>
              </div>
            </div>
          ) : (
            <Button icon={<Plus className="size-4" />} onClick={() => setAdding(true)}>
              Add people
            </Button>
          )}
        </div>
      )}
      {members.isLoading ? (
        <LoadingRows />
      ) : !members.data?.length ? (
        <p className="text-text-2">No one is in this group yet. Add people to give them its permissions.</p>
      ) : (
        <ul className="divide-y divide-border">
          {shown.map((m) => (
            <li key={m.user_id} className="flex items-center gap-3 py-3">
              <button onClick={() => onOpen(m.user_id)} className="flex min-w-0 flex-1 items-center gap-3 rounded-[10px] text-left hover:bg-surface-2">
                <Avatar first={m.first_name} last={m.last_name} id={m.user_id} size={36} />
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">
                    {m.first_name} {m.last_name}
                  </span>
                  <span className="block truncate text-[14px] text-text-3">{m.email}</span>
                </span>
              </button>
              {editable && (
                <Button variant="ghost" size="sm" aria-label={`Remove ${m.first_name} from ${group.name}`} onClick={() => remove.mutate(m.user_id)}>
                  <X className="size-4" />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function GroupSettings({ group }: { group: Group }) {
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: ["branches", group.branch_id, "groups"] });
  const archive = useMutation({
    mutationFn: () => api.patch(`/groups/${group.id}`, { archived: !group.archived_at }),
    onSuccess: () => (toast.success(group.archived_at ? "Restored" : "Archived"), refresh()),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const del = useMutation({
    mutationFn: () => api.del<DeleteOutcome>(`/groups/${group.id}`),
    onSuccess: (o) => (toast.success(o.deleted ? "Group deleted" : "It was sent work before, so it was archived instead."), setConfirm(false), refresh()),
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <div className="space-y-4 px-6 py-5">
      <div className="flex flex-wrap gap-3">
        <Button loading={archive.isPending} onClick={() => archive.mutate()}>
          {group.archived_at ? "Restore group" : "Archive group"}
        </Button>
        <Button variant="ghost-danger" onClick={() => setConfirm(true)}>
          Delete group
        </Button>
      </div>
      <p className="text-text-2">Archived groups can't be sent new work. Their history stays.</p>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={`Delete ${group.name}?`}
        body="If this group was ever sent work it will be archived instead, so its history stays."
        confirm="Delete group"
        danger
        loading={del.isPending}
        onConfirm={() => del.mutate()}
      />
    </div>
  );
}

function RenameDialog({ group, open, onOpenChange }: { group: Group; open: boolean; onOpenChange: (v: boolean) => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState(group.name);
  const [description, setDescription] = useState(group.description ?? "");
  const save = useMutation({
    mutationFn: () => api.patch(`/groups/${group.id}`, { name: name.trim(), description: description.trim() || null }),
    onSuccess: () => (toast.success("Saved"), onOpenChange(false), qc.invalidateQueries({ queryKey: ["branches", group.branch_id, "groups"] }), qc.invalidateQueries({ queryKey: ["groups"] })),
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Rename group"
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" disabled={!name.trim()} loading={save.isPending} onClick={() => save.mutate()}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Name">{(p) => <input {...p} value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />}</Field>
        <Field label="Description" optional>
          {(p) => <input {...p} value={description} onChange={(e) => setDescription(e.target.value)} className={inputClass} />}
        </Field>
      </div>
    </Dialog>
  );
}

function NewGroupDialog({ open, onOpenChange, branchId, onCreated }: { open: boolean; onOpenChange: (v: boolean) => void; branchId: string; onCreated: (id: string) => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const create = useMutation({
    mutationFn: () => api.post<Group>(`/branches/${branchId}/groups`, { name: name.trim(), description: description.trim() || null }),
    onSuccess: (g) => {
      toast.success(`${g.name} created`);
      qc.invalidateQueries({ queryKey: ["branches", branchId, "groups"] });
      qc.invalidateQueries({ queryKey: ["groups"] });
      setName("");
      setDescription("");
      onOpenChange(false);
      onCreated(g.id);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="New group"
      description="Departments, year teams, committees. Choose what it can do after creating it."
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" disabled={!name.trim()} loading={create.isPending} onClick={() => create.mutate()}>
            Create group
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Name">{(p) => <input {...p} value={name} onChange={(e) => setName(e.target.value)} placeholder="Coordinators" className={inputClass} />}</Field>
        <Field label="Description" optional>
          {(p) => <input {...p} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Heads of year and department coordinators" className={inputClass} />}
        </Field>
      </div>
    </Dialog>
  );
}

function CheckSomeone({ branchId, onOpen }: { branchId: string; onOpen: (id: string) => void }) {
  const people = usePeople();
  const [who, setWho] = useState<string | null>(null);
  const eff = useEffectivePermissions(branchId, who ?? undefined);
  const byGroup = new Map<string, { name: string; items: string[] }>();
  for (const g of eff.data?.grants ?? []) {
    const entry = byGroup.get(g.group.id) ?? { name: g.group.name, items: [] };
    const t = permissionInfo[g.permission]?.title ?? g.permission;
    entry.items.push(`${t}${g.issue_type ? ` (${typeLabel[g.issue_type]}s)` : ""}`);
    byGroup.set(g.group.id, entry);
  }
  return (
    <Card className="p-5">
      <h3 className="mb-3 text-[18px] font-semibold">Check what someone can do</h3>
      {who ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between rounded-[10px] border border-input px-3 py-2">
            <button className="text-left font-semibold text-primary hover:underline" onClick={() => onOpen(who)}>
              {people.name(who)}
            </button>
            <button className="text-text-3 hover:text-text" onClick={() => setWho(null)} aria-label="Choose someone else">
              <X className="size-4" />
            </button>
          </div>
          {eff.isLoading ? (
            <LoadingRows rows={2} />
          ) : eff.data?.is_admin ? (
            <p className="flex gap-2">
              <Shield className="mt-0.5 size-4 shrink-0" /> Admin of this branch — can do everything here except school-level tasks.
            </p>
          ) : (
            <ul className="space-y-3">
              {[...byGroup.values()].map((g) => (
                <li key={g.name}>
                  <b>{g.items.slice(0, 3).join(", ")}{g.items.length > 3 ? ` and ${g.items.length - 3} more` : ""}</b>
                  <span className="block text-text-2">from {g.name}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <PersonSelect people={people.inBranch(branchId)} onChange={setWho} placeholder="Type a name…" />
      )}
    </Card>
  );
}

// ---------- members ----------

function MembersTab({ branchId, branchName, onOpen }: { branchId: string; branchName: string; onOpen: (id: string) => void }) {
  const viewer = useViewer();
  const admin = isAdminOf(viewer, branchId);
  const manage = admin || hasGrant(viewer, branchId, "member.manage");
  const [left, setLeft] = useState(false);
  const members = useMembers(branchId, { includeLeft: admin && left });
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState(false);
  const term = q.trim().toLowerCase();
  const list = (members.data ?? [])
    .filter((m) => (left ? !!m.left_at : !m.left_at))
    .filter((m) => !term || `${m.first_name} ${m.last_name} ${m.email}`.toLowerCase().includes(term))
    .sort((a, b) => a.first_name.localeCompare(b.first_name));
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-4">
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search people…" aria-label="Search people" className={cx(inputClass, "h-10 w-full py-0 sm:w-72")} />
        {admin && (
          <Segmented size="sm" label="Who" value={left ? "left" : "current"} onChange={(v) => setLeft(v === "left")} options={[{ value: "current", label: "Current" }, { value: "left", label: "Left the branch" }]} />
        )}
        {manage && (
          <Button variant="primary" className="ml-auto" icon={<Plus className="size-4" />} onClick={() => setAdding(true)}>
            Add member
          </Button>
        )}
      </div>
      {members.isLoading ? (
        <LoadingRows />
      ) : list.length === 0 ? (
        <EmptyState title={term ? `No one matches “${q}”.` : "No one here yet."} />
      ) : (
        <ul className="divide-y divide-border">
          {list.map((m) => (
            <MemberRow key={m.user_id} m={m} onOpen={() => onOpen(m.user_id)} />
          ))}
        </ul>
      )}
      <AddMemberDialog open={adding} onOpenChange={setAdding} branchId={branchId} branchName={branchName} />
    </Card>
  );
}

function MemberRow({ m, onOpen }: { m: Member; onOpen: () => void }) {
  return (
    <li>
      <button onClick={onOpen} className="flex w-full flex-wrap items-center gap-3 px-5 py-3 text-left hover:bg-surface-2 sm:flex-nowrap">
        <Avatar first={m.first_name} last={m.last_name} id={m.user_id} size={40} />
        <div className="min-w-0 flex-1">
          <div className={cx("font-semibold", !m.is_active && "line-through")}>
            {m.first_name} {m.last_name}
            {m.is_admin && (
              <span className="ml-2 inline-flex items-center gap-1 rounded-md bg-sunken px-2 text-[13px] font-semibold text-text-2 no-underline">
                <Shield className="size-3.5" /> Admin
              </span>
            )}
            {!m.is_active && <span className="ml-2 text-[13px] font-normal text-text-3">Deactivated</span>}
          </div>
          <div className="truncate text-[14px] text-text-2">{m.email}</div>
        </div>
        <span className="hidden text-[14px] text-text-3 sm:block">{m.left_at ? `Left ${formatDay(m.left_at)}` : `Joined ${formatDay(m.joined_at)}`}</span>
        <ChevronRight className="size-4 text-text-3" aria-hidden />
      </button>
    </li>
  );
}

function AddMemberDialog({ open, onOpenChange, branchId, branchName }: { open: boolean; onOpenChange: (v: boolean) => void; branchId: string; branchName: string }) {
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const [temp, setTemp] = useState<{ name: string; password: string } | null>(null);
  const add = useMutation({
    mutationFn: () => api.post<AddedMember>(`/branches/${branchId}/members`, { email: email.trim(), first_name: first.trim() || null, last_name: last.trim() || null }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["branches", branchId, "members"] });
      qc.invalidateQueries({ queryKey: ["people"] });
      if (r.temporary_password) setTemp({ name: first || email, password: r.temporary_password });
      else toast.success(r.reactivated ? `Welcome back — ${first || email} is a member again.` : `${first || email} was added to ${branchName}.`);
      setEmail("");
      setFirst("");
      setLast("");
      onOpenChange(false);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <>
      <Dialog
        open={open}
        onOpenChange={onOpenChange}
        title={`Add a member to ${branchName}`}
        description="If they already have an account (for example at another branch), they're added straight away."
        footer={
          <>
            <Button onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button variant="primary" disabled={!email.includes("@")} loading={add.isPending} onClick={() => add.mutate()}>
              Add member
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="Email">{(p) => <input {...p} type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} />}</Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="First name" hint="Needed for new accounts">
              {(p) => <input {...p} value={first} onChange={(e) => setFirst(e.target.value)} className={inputClass} />}
            </Field>
            <Field label="Last name">{(p) => <input {...p} value={last} onChange={(e) => setLast(e.target.value)} className={inputClass} />}</Field>
          </div>
        </div>
      </Dialog>
      <TempPasswordDialog name={temp?.name ?? ""} password={temp?.password ?? null} onClose={() => setTemp(null)} />
    </>
  );
}

export function TempPasswordDialog({ name, password, onClose }: { name: string; password: string | null; onClose: () => void }) {
  return (
    <Dialog
      open={!!password}
      onOpenChange={(o) => !o && onClose()}
      title="Temporary password"
      description={`Give this to ${name} in person. They'll choose their own password when they first sign in. It won't be shown again.`}
      footer={
        <Button variant="primary" onClick={onClose}>
          Done
        </Button>
      }
    >
      <div className="flex items-center gap-2">
        <input readOnly value={password ?? ""} aria-label="Temporary password" className={cx(inputClass, "font-mono text-[18px]")} onFocus={(e) => e.target.select()} />
        <Button
          icon={<Copy className="size-4" />}
          onClick={() => {
            navigator.clipboard?.writeText(password ?? "");
            toast.success("Copied");
          }}
        >
          Copy
        </Button>
      </div>
    </Dialog>
  );
}
