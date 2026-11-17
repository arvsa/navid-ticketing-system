// People, departments and permission groups (UX_SPEC §4.11–4.12).
//
// Departments are who does what (IT, Health, Teachers): items are sent to
// them and their heads run the work. Permission groups are what people may
// do: attached to departments, their grants reach the departments' members.
import { useState } from "react";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Archive, ArchiveRestore, Building2, ChevronDown, ChevronRight, Copy, Download, FileSpreadsheet, Globe, KeyRound, Lock, Pencil, Plus, Shield, ShieldCheck, Trash2, Upload, UserPlus, UserRound, Users, X } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/api/client";
import { useDepartments, useEffectivePermissions, useMembers, usePermissionGroups, useSchoolPermissionGroups } from "@/api/hooks";
import type { AddedMember, ConfigImportOutcome, DeleteOutcome, Department, Member, PermissionGroup } from "@/api/types";
import { Avatar } from "@/components/badges";
import { PeopleChecklist, PersonSelect } from "@/components/pickers";
import { Button, Card, Dialog, EmptyState, ErrorPanel, Field, IconButton, LoadingRows, Menu, MenuItem, PageHeader, SectionLabel, Segmented, TabPanel, Tabs, cx, inputClass } from "@/components/ui";
import { canChooseMembers, canManageDepartments, hasGrant, isAdminOf, isSuper } from "@/lib/can";
import { guard } from "@/lib/unsaved";
import { formatDay } from "@/lib/dates";
import { errorMessage, grantTitle } from "@/lib/labels";
import { useViewer } from "@/lib/useViewer";
import { usePeople } from "@/people/usePeople";
import { ConfirmDialog } from "@/features/items/ItemDialogs";
import type { PeopleSearch } from "@/app/router";
import { ImportMembersDialog } from "./ImportMembers";
import { PersonPanel } from "./PersonPanel";
import { PermissionEditor, summarizeGrants } from "./PermissionEditor";
import { useManagedBranch } from "./useManagedBranch";
import { localeTag, num, quote, t, tn } from "@/i18n";

type Tab = "departments" | "members" | "permissions" | "school";

export function PeoplePage() {
  const viewer = useViewer();
  const search = useSearch({ from: "/authed/shell/people" });
  const navigate = useNavigate({ from: "/people" });
  const { branchId, branch, choices, pick } = useManagedBranch(viewer, "member.manage", search.branch, true);
  const openPerson = (id: string) => navigate({ search: (s: PeopleSearch) => ({ ...s, person: id }) });
  const members = useMembers(branchId);
  const departments = useDepartments(branchId);
  const superAdmin = isSuper(viewer);
  const admin = isAdminOf(viewer, branchId);
  const permissionGroups = usePermissionGroups(branchId, admin);
  const schoolGroups = useSchoolPermissionGroups(superAdmin);
  const tab: Tab =
    search.tab === "school" ? (superAdmin ? "school" : "departments") : search.tab === "permissions" ? (admin ? "permissions" : "departments") : (search.tab ?? "departments");
  if (!branchId)
    return superAdmin ? (
      <EmptyState
        title={t("No branches yet.")}
        action={
          <Link to="/branches" className="font-semibold text-primary hover:underline">
            {t("Open the first branch")}
          </Link>
        }
      >
        {t("People belong to branches: open one, then add its people here.")}
      </EmptyState>
    ) : (
      <EmptyState title={t("You don't manage a branch.")} />
    );
  const openBranch = (id: string) =>
    guard(() => {
      pick(id);
      navigate({ search: (s: PeopleSearch) => ({ ...s, tab: tab === "school" ? undefined : s.tab, department: undefined, group: undefined }) });
    });
  const openTab = (v: Tab) =>
    guard(() => navigate({ search: (s: PeopleSearch) => ({ ...s, tab: v === "departments" ? undefined : v, department: undefined, group: undefined }) }));
  const subtitle = tab === "school" ? t("School-wide permission groups · for every branch") : branch?.name;
  return (
    <div>
      <PageHeader title={t("People & departments")} subtitle={subtitle} />
      <div className="grid gap-6 lg:grid-cols-[248px_minmax(0,1fr)]">
        <PeopleNav
          branches={choices.length ? choices : branch ? [branch] : []}
          branchId={tab === "school" ? undefined : branchId}
          tab={tab}
          counts={{
            members: members.data?.length,
            departments: departments.data?.filter((d) => !d.archived_at).length,
            permissions: admin ? permissionGroups.data?.filter((g) => g.branch_id).length : undefined,
          }}
          schoolGroups={superAdmin ? (schoolGroups.data?.length ?? null) : undefined}
          onBranch={openBranch}
          onTab={openTab}
        />
        <div className="min-w-0">
          {tab === "members" ? (
            <MembersTab branchId={branchId} branchName={branch?.name ?? ""} onOpen={openPerson} />
          ) : tab === "permissions" ? (
            <PermissionGroupsTab
              branchId={branchId}
              branchName={branch?.name ?? ""}
              selected={search.group}
              onSelect={(g) => navigate({ search: (s: PeopleSearch) => ({ ...s, group: g }) })}
            />
          ) : tab === "school" ? (
            <PermissionGroupsTab branchId={null} branchName={t("every branch")} selected={search.group} onSelect={(g) => navigate({ search: (s: PeopleSearch) => ({ ...s, group: g }) })} />
          ) : (
            <DepartmentsTab
              branchId={branchId}
              branchName={branch?.name ?? ""}
              selected={search.department}
              onSelect={(d) => navigate({ search: (s: PeopleSearch) => ({ ...s, department: d }) })}
              onOpen={openPerson}
              onOpenGroup={(g) => navigate({ search: (s: PeopleSearch) => ({ ...s, tab: "permissions", group: g, department: undefined }) })}
            />
          )}
        </div>
      </div>
      <PersonPanel userId={search.person} branchId={branchId} onClose={() => navigate({ search: (s: PeopleSearch) => ({ ...s, person: undefined }) })} />
    </div>
  );
}

/** The page's own navigation: a floating card with the branches and, under
 * the open one, its members, departments and (admins) permission groups.
 * Super admins also get the school-wide permission groups. */
function PeopleNav({
  branches,
  branchId,
  tab,
  counts,
  schoolGroups,
  onBranch,
  onTab,
}: {
  branches: { id: string; name: string }[];
  /** Unset while the school-wide groups are open. */
  branchId?: string;
  tab: Tab;
  /** `permissions` undefined: not an admin of the branch. */
  counts: { members?: number; departments?: number; permissions?: number };
  /** `undefined` hides the entry (not a super admin); `null` while loading. */
  schoolGroups?: number | null;
  onBranch: (id: string) => void;
  onTab: (tab: Tab) => void;
}) {
  const row = (active: boolean) =>
    cx(
      "flex w-full items-center gap-2.5 rounded-[12px] px-3 py-2.5 text-start transition-colors",
      active ? "bg-selected font-semibold text-on-selected" : "text-text-2 hover:bg-sunken hover:text-text",
    );
  const count = (n?: number | null) => n != null && <span className="ms-auto text-[14px] tabular opacity-80">{num(n)}</span>;
  const entry = (value: Tab, icon: React.ReactNode, label: string, n?: number) => (
    <li>
      <button onClick={() => onTab(value)} aria-current={tab === value ? "page" : undefined} className={row(tab === value)}>
        {icon}
        {label}
        {count(n)}
      </button>
    </li>
  );
  return (
    <aside className="lg:sticky lg:top-24 lg:self-start">
      <Card className="p-2 shadow-2">
        <nav aria-label={t("People & departments")} className="space-y-1">
          {branches.length > 1 && <SectionLabel className="px-3 pt-2 pb-1">{t("Branches")}</SectionLabel>}
          <ul className="space-y-1">
            {branches.map((b) => {
              const open = b.id === branchId;
              return (
                <li key={b.id}>
                  {branches.length > 1 ? (
                    <button onClick={() => !open && onBranch(b.id)} aria-expanded={open} className={cx(row(false), open && "font-semibold text-text")}>
                      <Building2 className="size-[18px] shrink-0" aria-hidden />
                      <span className="min-w-0 truncate">{b.name}</span>
                      <ChevronDown className={cx("ms-auto size-4 shrink-0 transition-transform", !open && "rtl:rotate-90 ltr:-rotate-90")} aria-hidden />
                    </button>
                  ) : (
                    <p className="flex items-center gap-2.5 px-3 py-2.5 font-semibold">
                      <Building2 className="size-[18px] shrink-0 text-text-2" aria-hidden />
                      <span className="min-w-0 truncate">{b.name}</span>
                    </p>
                  )}
                  {open && (
                    <ul className="mt-1 space-y-1 border-s-2 border-border ps-2 ms-5">
                      {entry("members", <UserRound className="size-[18px] shrink-0" aria-hidden />, t("Members"), counts.members)}
                      {entry("departments", <Users className="size-[18px] shrink-0" aria-hidden />, t("Departments"), counts.departments)}
                      {counts.permissions !== undefined &&
                        entry("permissions", <KeyRound className="size-[18px] shrink-0" aria-hidden />, t("Permission groups"), counts.permissions)}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
          {schoolGroups !== undefined && (
            <ul className="mt-1 space-y-1 border-t border-border pt-2">
              {entry("school", <Globe className="size-[18px] shrink-0" aria-hidden />, t("School-wide permission groups"), schoolGroups ?? undefined)}
            </ul>
          )}
        </nav>
      </Card>
    </aside>
  );
}

// ---------- departments ----------

function DepartmentsTab({
  branchId,
  branchName,
  selected,
  onSelect,
  onOpen,
  onOpenGroup,
}: {
  branchId: string;
  branchName: string;
  selected?: string;
  onSelect: (id: string) => void;
  onOpen: (id: string) => void;
  onOpenGroup: (id: string) => void;
}) {
  const viewer = useViewer();
  const departments = useDepartments(branchId, true);
  const [creating, setCreating] = useState(false);
  const manage = canManageDepartments(viewer, branchId);
  const list = departments.data ?? [];
  const [q, setQ] = useState("");
  const term = q.trim().toLowerCase();
  const active = list
    .filter((d) => !d.archived_at && (!term || departmentName(d).toLowerCase().includes(term)))
    .sort((a, b) => Number(b.is_default) - Number(a.is_default) || a.name.localeCompare(b.name, localeTag));
  const archived = list.filter((d) => d.archived_at);
  const current = list.find((d) => d.id === selected) ?? active.find((d) => !d.is_default) ?? active[0];
  if (departments.isLoading) return <LoadingRows />;
  if (departments.error) return <ErrorPanel error={departments.error} />;
  return (
    <div className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
      <div className="space-y-6">
        <Card className="p-2">
          {list.length > 5 && (
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Find a department")} aria-label={t("Find a department")} className={cx(inputClass, "mb-1 h-10 rounded-full py-0")} />
          )}
          {term && active.length === 0 && <p className="px-4 py-3 text-text-2">{t("No department matches {q}.", { q: quote(q) })}</p>}
          <ul>
            {active.map((d) => (
              <DepartmentListItem key={d.id} d={d} active={current?.id === d.id} onClick={() => onSelect(d.id)} />
            ))}
          </ul>
          {manage && (
            <button onClick={() => setCreating(true)} className="flex items-center gap-2 px-4 py-3 font-semibold text-primary hover:underline">
              <Plus className="size-5" />{" "}{t("New department")}
            </button>
          )}
          {archived.length > 0 && (
            <details className="border-t border-border px-4 py-3">
              <summary className="cursor-pointer text-text-2">{t("Archived ({n})", { n: archived.length })}</summary>
              <ul className="mt-2">
                {archived.map((d) => (
                  <DepartmentListItem key={d.id} d={d} active={current?.id === d.id} onClick={() => onSelect(d.id)} />
                ))}
              </ul>
            </details>
          )}
        </Card>
        <CheckSomeone branchId={branchId} onOpen={onOpen} />
      </div>
      {current && <DepartmentDetail key={current.id} department={current} branchName={branchName} onOpen={onOpen} onOpenGroup={onOpenGroup} />}
      <NewDepartmentDialog open={creating} onOpenChange={setCreating} branchId={branchId} onCreated={onSelect} />
    </div>
  );
}

/** The built-in "All members" is named in the reader's language. */
function departmentName(d: Department) {
  return d.is_default ? t("All members") : d.name;
}

function DepartmentListItem({ d, active, onClick }: { d: Department; active: boolean; onClick: () => void }) {
  const groups = d.permission_groups.map((g) => g.name);
  return (
    <li>
      <button onClick={onClick} aria-current={active} className={cx("w-full rounded-[10px] px-4 py-3 text-start", active ? "bg-primary-soft" : "hover:bg-surface-2")}>
        <span className="flex items-baseline justify-between gap-2">
          <span className="flex items-center gap-1.5 font-semibold">
            {d.is_default && <Lock className="size-3.5 shrink-0 text-text-3" aria-hidden />}
            {departmentName(d)}
          </span>
          <span className="text-text-2 tabular">{num(d.member_ids.length)}</span>
        </span>
        <span className="block truncate text-[14px] text-text-2">
          {d.archived_at ? t("Archived") : groups.length ? t("Permissions: {list}", { list: groups.join(t(", ")) }) : t("Only the basics")}
        </span>
      </button>
    </li>
  );
}

function DepartmentDetail({ department, branchName, onOpen, onOpenGroup }: { department: Department; branchName: string; onOpen: (id: string) => void; onOpenGroup: (id: string) => void }) {
  const viewer = useViewer();
  const branchId = department.branch_id;
  const manage = canManageDepartments(viewer, branchId);
  const [tab, setTab] = useState<"members" | "permissions">("members");
  const [renaming, setRenaming] = useState(false);
  return (
    <Card className="min-w-0 overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-3 px-6 pt-6">
        <div>
          <h2 className="flex items-center gap-2 text-[28px] font-bold">
            {department.is_default && <Lock className="size-5 text-text-3" />}
            {departmentName(department)}
          </h2>
          <p className="text-text-2">
            {department.is_default ? t("Everyone in {name}", { name: branchName }) : department.description || t("No description")} · {tn(department.member_ids.length, "{n} member", "{n} members")}
            {!department.is_default && ` · ${tn(department.head_ids.length, "{n} head", "{n} heads")}`}
            {department.archived_at && ` · ${t("Archived")}`}
          </p>
        </div>
        {manage && !department.is_default && <DepartmentActions department={department} onRename={() => setRenaming(true)} />}
      </div>
      <Tabs
        id="department"
        className="mx-6 mt-4"
        value={tab}
        onChange={(v) => guard(() => setTab(v))}
        tabs={[
          { value: "members", label: t("Members"), count: department.member_ids.length },
          { value: "permissions", label: t("What they can do"), count: department.permission_groups.length },
        ]}
      />
      <TabPanel id="department" value={tab}>
        {tab === "members" && (
          <DepartmentMembers
            department={department}
            editable={canChooseMembers(viewer, branchId, department.name) && !department.is_default && !department.archived_at}
            heads={manage && !department.is_default && !department.archived_at}
            onOpen={onOpen}
          />
        )}
        {tab === "permissions" && <DepartmentPermissions department={department} onOpenGroup={onOpenGroup} />}
      </TabPanel>
      <RenameDepartmentDialog department={department} open={renaming} onOpenChange={setRenaming} />
    </Card>
  );
}

const refreshDepartments = (qc: ReturnType<typeof useQueryClient>, branchId: string) => {
  qc.invalidateQueries({ queryKey: ["branches", branchId] });
  qc.invalidateQueries({ queryKey: ["directory"] });
  qc.invalidateQueries({ queryKey: ["effective-permissions"] });
};

/** `editable`: may choose members (admins, `department.manage`, or a grant
 * for this department). `heads`: may also choose its heads. */
function DepartmentMembers({ department, editable, heads, onOpen }: { department: Department; editable: boolean; heads: boolean; onOpen?: (id: string) => void }) {
  const qc = useQueryClient();
  const people = usePeople();
  const branchId = department.branch_id;
  const members = useMembers(branchId, { departmentId: department.id });
  const [adding, setAdding] = useState(false);
  const [mq, setMq] = useState("");
  const [picks, setPicks] = useState<string[]>([]);
  const refresh = () => refreshDepartments(qc, branchId);
  // One request each; whoever was added stays added if a later one fails.
  const add = useMutation({
    mutationFn: async (ids: string[]) => {
      for (const id of ids) {
        await api.put(`/departments/${department.id}/members/${id}`);
        setPicks((p) => p.filter((x) => x !== id));
      }
      return ids.length;
    },
    onSuccess: (n) => (toast.success(tn(n, "Added", "Added {n} people")), setAdding(false)),
    onError: (e) => toast.error(errorMessage(e)),
    onSettled: refresh,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/departments/${department.id}/members/${id}`),
    onSuccess: () => (toast.success(t("Removed from the department")), refresh()),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const setHead = useMutation({
    mutationFn: ({ id, head }: { id: string; head: boolean }) => (head ? api.put : api.del)(`/departments/${department.id}/heads/${id}`),
    onSuccess: (_, { head }) => (
      toast.success(head ? t("Now a head of {name}", { name: department.name }) : t("No longer a head of {name}", { name: department.name })), refresh()
    ),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const ids = new Set((members.data ?? []).map((m) => m.user_id));
  const term = mq.trim().toLowerCase();
  const shown = (members.data ?? []).filter((m) => !term || `${m.first_name} ${m.last_name} ${m.email}`.toLowerCase().includes(term));
  return (
    <div className="px-6 py-5">
      {department.is_default && <p className="mb-4 rounded-[10px] bg-sunken px-4 py-3 text-text-2">{t("Everyone in the branch is in this department automatically.")}</p>}
      {(members.data?.length ?? 0) > 6 && (
        <input
          type="search"
          value={mq}
          onChange={(e) => setMq(e.target.value)}
          placeholder={t("Search {n} members by name or email", { n: members.data?.length ?? 0 })}
          aria-label={t("Search members")}
          className={cx(inputClass, "mb-3 h-11 rounded-full")}
        />
      )}
      {term && shown.length === 0 && <p className="py-3 text-text-2">{t("No one matches {q}.", { q: quote(mq) })}</p>}
      {editable && (
        <div className="mb-4">
          {adding ? (
            <div className="space-y-3 rounded-[12px] border border-border p-4">
              <PeopleChecklist people={people.inBranch(branchId)} value={picks} onChange={setPicks} exclude={[...ids]} />
              <div className="flex gap-2">
                <Button variant="primary" disabled={!picks.length} loading={add.isPending} onClick={() => add.mutate(picks)}>
                  {picks.length > 1 ? t("Add {n} to {name}", { n: picks.length, name: department.name }) : t("Add to {name}", { name: department.name })}
                </Button>
                <Button onClick={() => (setAdding(false), setPicks([]))}>{t("Done")}</Button>
              </div>
            </div>
          ) : (
            <Button icon={<Plus className="size-4" />} onClick={() => setAdding(true)}>
              {t("Add people")}
            </Button>
          )}
        </div>
      )}
      {members.isLoading ? (
        <LoadingRows />
      ) : !members.data?.length ? (
        <p className="text-text-2">{t("No one is in this department yet. Items sent to it reach its members.")}</p>
      ) : (
        <ul className="divide-y divide-border">
          {shown.map((m) => {
            const isHead = department.head_ids.includes(m.user_id);
            return (
              <li key={m.user_id} className="flex items-center gap-3 py-3">
                <button
                  onClick={() => onOpen?.(m.user_id)}
                  disabled={!onOpen}
                  className="flex min-w-0 flex-1 items-center gap-3 rounded-[10px] text-start enabled:hover:bg-surface-2 disabled:cursor-default"
                >
                  <Avatar first={m.first_name} last={m.last_name} id={m.user_id} size={36} />
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">
                      {m.first_name} {m.last_name}
                      {isHead && <span className="ms-2 rounded-md bg-primary-soft px-1.5 text-[12px] font-semibold text-primary">{t("Head")}</span>}
                    </span>
                    <span className="block truncate text-[14px] text-text-3">{m.email}</span>
                  </span>
                </button>
                {heads && (
                  <Button variant="ghost" size="sm" loading={setHead.isPending && setHead.variables?.id === m.user_id} onClick={() => setHead.mutate({ id: m.user_id, head: !isHead })}>
                    {isHead ? t("Remove as head") : t("Make head")}
                  </Button>
                )}
                {/* Heads are removed by those who choose heads. */}
                {editable && (!isHead || heads) && (
                  <Button variant="ghost" size="sm" aria-label={t("Remove {person} from {group}", { person: m.first_name, group: department.name })} onClick={() => remove.mutate(m.user_id)}>
                    <X className="size-4" />
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** The permission groups attached to a department: their grants reach its
 * members. Branch admins attach and detach them. */
function DepartmentPermissions({ department, onOpenGroup }: { department: Department; onOpenGroup: (id: string) => void }) {
  const viewer = useViewer();
  const qc = useQueryClient();
  const branchId = department.branch_id;
  const admin = isAdminOf(viewer, branchId);
  const groups = usePermissionGroups(branchId, admin);
  const [choosing, setChoosing] = useState("");
  const attached = new Set(department.permission_groups.map((g) => g.id));
  const available = (groups.data ?? []).filter((g) => !g.is_default && !attached.has(g.id));
  const byId = new Map((groups.data ?? []).map((g) => [g.id, g]));
  const change = useMutation({
    mutationFn: ({ id, attach }: { id: string; attach: boolean }) => (attach ? api.put : api.del)(`/departments/${department.id}/permission-groups/${id}`),
    onSuccess: (_, { attach }) => (toast.success(attach ? t("Attached") : t("Detached")), setChoosing(""), refreshDepartments(qc, branchId)),
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <div className="space-y-4 px-6 py-5">
      <p className="text-text-2">
        {t("Members get the basics everyone has, plus what these permission groups allow. Adding someone to the department gives them these too.")}
      </p>
      {department.permission_groups.length === 0 ? (
        <p className="rounded-[10px] bg-sunken px-4 py-3 text-text-2">{t("No permission groups: its members have only the basics.")}</p>
      ) : (
        <ul className="divide-y divide-border rounded-[12px] border border-border">
          {department.permission_groups.map((g) => (
            <li key={g.id} className="flex items-center gap-3 px-4 py-3">
              {g.school_wide ? <Globe className="size-4 shrink-0 text-text-3" aria-label={t("School-wide")} /> : <KeyRound className="size-4 shrink-0 text-text-3" aria-hidden />}
              <span className="min-w-0 flex-1">
                {admin ? (
                  <button className="font-semibold text-primary hover:underline" onClick={() => onOpenGroup(g.id)}>
                    {g.name}
                  </button>
                ) : (
                  <b>{g.name}</b>
                )}
                <span className="block text-[14px] text-text-2">{summarizeGrants(byId.get(g.id)?.grants)}</span>
              </span>
              {admin && (
                <Button variant="ghost" size="sm" loading={change.isPending && change.variables?.id === g.id} onClick={() => change.mutate({ id: g.id, attach: false })}>
                  {t("Detach")}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {admin && !department.archived_at && (
        <div className="flex flex-wrap items-center gap-2">
          <select value={choosing} onChange={(e) => setChoosing(e.target.value)} className={cx(inputClass, "h-11 w-auto min-w-56")} aria-label={t("Permission group to attach")}>
            <option value="">{t("Choose a permission group…")}</option>
            {available.map((g) => (
              <option key={g.id} value={g.id}>
                {g.branch_id ? g.name : t("{name} (school-wide)", { name: g.name })}
              </option>
            ))}
          </select>
          <Button disabled={!choosing} loading={change.isPending && change.variables?.attach} onClick={() => change.mutate({ id: choosing, attach: true })}>
            {t("Attach")}
          </Button>
        </div>
      )}
    </div>
  );
}

/** Rename, archive (or restore) and delete, as icons beside the name. */
function DepartmentActions({ department, onRename }: { department: Department; onRename: () => void }) {
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  const refresh = () => refreshDepartments(qc, department.branch_id);
  const archive = useMutation({
    mutationFn: () => api.patch(`/departments/${department.id}`, { archived: !department.archived_at }),
    onSuccess: () => (toast.success(department.archived_at ? t("Restored") : t("Archived")), refresh()),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const del = useMutation({
    mutationFn: () => api.del<DeleteOutcome>(`/departments/${department.id}`),
    onSuccess: (o) => (toast.success(o.deleted ? t("Department deleted") : t("It was sent work before, so it was archived instead.")), setConfirm(false), refresh()),
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <div className="flex items-center gap-1">
      <IconButton variant="ghost" label={t("Rename")} hintAlign="end" icon={<Pencil className="size-4" />} onClick={onRename} />
      <IconButton
        variant="ghost"
        label={department.archived_at ? t("Restore department") : t("Archive department. It can't be sent new work; its history stays.")}
        hintAlign="end"
        loading={archive.isPending}
        icon={department.archived_at ? <ArchiveRestore className="size-4" /> : <Archive className="size-4" />}
        onClick={() => archive.mutate()}
      />
      <IconButton variant="ghost-danger" label={t("Delete department")} hintAlign="end" icon={<Trash2 className="size-4" />} onClick={() => setConfirm(true)} />
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={t("Delete {name}?", { name: department.name })}
        body={t("If this department was ever sent work it will be archived instead, so its history stays.")}
        confirm={t("Delete department")}
        danger
        loading={del.isPending}
        onConfirm={() => del.mutate()}
      />
    </div>
  );
}

function RenameDepartmentDialog({ department, open, onOpenChange }: { department: Department; open: boolean; onOpenChange: (v: boolean) => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState(department.name);
  const [description, setDescription] = useState(department.description ?? "");
  const save = useMutation({
    mutationFn: () => api.patch(`/departments/${department.id}`, { name: name.trim(), description: description.trim() || null }),
    onSuccess: () => (toast.success(t("Saved")), onOpenChange(false), refreshDepartments(qc, department.branch_id)),
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("Edit department")}
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>{t("Cancel")}</Button>
          <Button variant="primary" disabled={!name.trim()} loading={save.isPending} onClick={() => save.mutate()}>
            {t("Save")}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label={t("Name")}>{(p) => <input {...p} value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />}</Field>
        <Field label={t("Description")} optional>
          {(p) => <input {...p} value={description} onChange={(e) => setDescription(e.target.value)} className={inputClass} />}
        </Field>
        {name.trim() !== department.name && (
          <p className="text-[14px] text-text-2">{t("Grants that name departments use their names: check permission groups that name the old one.")}</p>
        )}
      </div>
    </Dialog>
  );
}

function NewDepartmentDialog({ open, onOpenChange, branchId, onCreated }: { open: boolean; onOpenChange: (v: boolean) => void; branchId: string; onCreated: (id: string) => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const create = useMutation({
    mutationFn: () => api.post<Department>(`/branches/${branchId}/departments`, { name: name.trim(), description: description.trim() || null }),
    onSuccess: (d) => {
      toast.success(t("{name} created", { name: d.name }));
      refreshDepartments(qc, branchId);
      setName("");
      setDescription("");
      onOpenChange(false);
      onCreated(d.id);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("New department")}
      description={t("A team that does work for others or shares a role: IT, Health, Teachers. Items can be sent to it; admins choose what it can do.")}
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>{t("Cancel")}</Button>
          <Button variant="primary" disabled={!name.trim()} loading={create.isPending} onClick={() => create.mutate()}>
            {t("Create department")}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label={t("Name")}>{(p) => <input {...p} value={name} onChange={(e) => setName(e.target.value)} placeholder={t("IT")} className={inputClass} />}</Field>
        <Field label={t("Description")} optional>
          {(p) => <input {...p} value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t("Computers, projectors and the network")} className={inputClass} />}
        </Field>
      </div>
    </Dialog>
  );
}

// ---------- permission groups ----------

/** `branchId` null: the school-wide groups (super admins). A branch's list
 * shows its own groups and, read-only, the school-wide ones it can attach. */
function PermissionGroupsTab({ branchId, branchName, selected, onSelect }: { branchId: string | null; branchName: string; selected?: string; onSelect: (id: string) => void }) {
  const viewer = useViewer();
  const branchGroups = usePermissionGroups(branchId ?? undefined, branchId !== null);
  const schoolGroups = useSchoolPermissionGroups(branchId === null);
  const groups = branchId === null ? schoolGroups : branchGroups;
  const departments = useDepartments(branchId ?? undefined);
  const [creating, setCreating] = useState(false);
  const [config, setConfig] = useState(false);
  const [q, setQ] = useState("");
  const list = groups.data ?? [];
  const term = q.trim().toLowerCase();
  const shown = list.filter((g) => !term || groupName(g).toLowerCase().includes(term));
  const own = shown.filter((g) => (branchId === null ? true : g.branch_id === branchId));
  const school = branchId === null ? [] : shown.filter((g) => !g.branch_id);
  const current = list.find((g) => g.id === selected) ?? own.find((g) => !g.is_default) ?? own[0] ?? school[0];
  const editable = (g: PermissionGroup) => (g.branch_id ? isAdminOf(viewer, g.branch_id) : isSuper(viewer));
  const departmentNames = (departments.data ?? []).filter((d) => !d.is_default && !d.archived_at).map((d) => d.name);
  if (groups.isLoading) return <LoadingRows />;
  if (groups.error) return <ErrorPanel error={groups.error} />;
  const item = (g: PermissionGroup) => (
    <li key={g.id}>
      <button onClick={() => onSelect(g.id)} aria-current={current?.id === g.id} className={cx("w-full rounded-[10px] px-4 py-3 text-start", current?.id === g.id ? "bg-primary-soft" : "hover:bg-surface-2")}>
        <span className="flex items-center gap-1.5 font-semibold">
          {g.is_default ? <ShieldCheck className="size-3.5 shrink-0 text-text-3" aria-hidden /> : !g.branch_id && <Globe className="size-3.5 shrink-0 text-text-3" aria-label={t("School-wide")} />}
          {groupName(g)}
        </span>
        <span className="block truncate text-[14px] text-text-2">
          {g.is_default ? t("Every user, in every branch") : `${summarizeGrants(g.grants)} · ${tn(g.department_ids.length, "{n} department", "{n} departments")}`}
        </span>
      </button>
    </li>
  );
  return (
    <div className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
      <div className="space-y-6">
        <Card className="p-2">
          <p className="flex gap-2 px-4 py-3 text-[14px] text-text-2">
            <KeyRound className="mt-0.5 size-4 shrink-0" aria-hidden />
            {branchId === null ? t("Attachable to departments in every branch.") : t("Attach them to departments: their members get what they allow.")}
          </p>
          {list.length > 6 && (
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Find a permission group")} aria-label={t("Find a permission group")} className={cx(inputClass, "mb-1 h-10 rounded-full py-0")} />
          )}
          {term && shown.length === 0 && <p className="px-4 py-3 text-text-2">{t("No permission group matches {q}.", { q: quote(q) })}</p>}
          <ul>{own.map(item)}</ul>
          <button onClick={() => setCreating(true)} className="flex items-center gap-2 px-4 py-3 font-semibold text-primary hover:underline">
            <Plus className="size-5" />{" "}{branchId === null ? t("New school-wide group") : t("New permission group")}
          </button>
          {school.length > 0 && (
            <div className="border-t border-border pt-2">
              <SectionLabel className="px-4 py-2">{t("School-wide")}</SectionLabel>
              <ul>{school.map(item)}</ul>
            </div>
          )}
        </Card>
        <Card className="space-y-3 p-5">
          <h3 className="text-[18px] font-semibold">{t("As a file")}</h3>
          <p className="text-[14px] text-text-2">{t("Every permission group and which departments use it, as YAML or JSON: to review, keep, or edit and load back.")}</p>
          <Button icon={<Upload className="size-4" />} onClick={() => setConfig(true)}>
            {t("Download or load the setup")}
          </Button>
        </Card>
      </div>
      {current && (
        <PermissionGroupDetail key={current.id} group={current} branchName={branchName} editable={editable(current)} departments={departments.data ?? []} departmentNames={departmentNames} />
      )}
      <NewPermissionGroupDialog open={creating} onOpenChange={setCreating} branchId={branchId} onCreated={onSelect} />
      <ConfigDialog open={config} onOpenChange={setConfig} />
    </div>
  );
}

/** The built-in "Everyone" is named in the reader's language. */
function groupName(g: PermissionGroup) {
  return g.is_default ? t("Everyone") : g.name;
}

function PermissionGroupDetail({
  group,
  branchName,
  editable,
  departments,
  departmentNames,
}: {
  group: PermissionGroup;
  branchName: string;
  editable: boolean;
  departments: Department[];
  departmentNames: string[];
}) {
  const qc = useQueryClient();
  const [renaming, setRenaming] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const used = departments.filter((d) => group.department_ids.includes(d.id));
  const del = useMutation({
    mutationFn: () => api.del(`/permission-groups/${group.id}`),
    onSuccess: () => (
      toast.success(t("Permission group deleted")),
      setConfirm(false),
      qc.invalidateQueries({ queryKey: ["branches"] }),
      qc.invalidateQueries({ queryKey: ["school-permission-groups"] })
    ),
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Card className="min-w-0 overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-3 px-6 pt-6">
        <div>
          <h2 className="flex items-center gap-2 text-[28px] font-bold">
            {group.is_default ? <ShieldCheck className="size-5 text-text-3" /> : !group.branch_id && <Globe className="size-5 text-text-3" aria-label={t("School-wide")} />}
            {groupName(group)}
          </h2>
          <p className="text-text-2">
            {group.is_default
              ? t("Every user, in every branch")
              : [group.description || (group.branch_id ? branchName : t("School-wide")), tn(group.department_ids.length, "attached to {n} department", "attached to {n} departments")].join(" · ")}
          </p>
          {used.length > 0 && (
            <p className="mt-1 flex flex-wrap gap-1.5">
              {used.map((d) => (
                <span key={d.id} className="rounded-full bg-sunken px-2.5 py-0.5 text-[14px]">
                  {departmentName(d)}
                </span>
              ))}
            </p>
          )}
        </div>
        {editable && !group.is_default && (
          <div className="flex items-center gap-1">
            <IconButton variant="ghost" label={t("Rename")} hintAlign="end" icon={<Pencil className="size-4" />} onClick={() => setRenaming(true)} />
            <IconButton variant="ghost-danger" label={t("Delete permission group")} hintAlign="end" icon={<Trash2 className="size-4" />} onClick={() => setConfirm(true)} />
          </div>
        )}
      </div>
      {!editable && (
        <p className="mx-6 mt-4 flex gap-2 rounded-[12px] bg-sunken px-4 py-3 text-text-2">
          <Globe className="mt-0.5 size-4 shrink-0" aria-hidden />
          {t("Set up for every branch by the school office. You choose which departments use it.")}
        </p>
      )}
      <PermissionEditor group={group} editable={editable} departments={departmentNames} />
      <RenamePermissionGroupDialog group={group} open={renaming} onOpenChange={setRenaming} />
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={t("Delete {name}?", { name: group.name })}
        body={tn(group.department_ids.length, "It's detached from {n} department, whose members lose what it allowed.", "It's detached from {n} departments, whose members lose what it allowed.")}
        confirm={t("Delete permission group")}
        danger
        loading={del.isPending}
        onConfirm={() => del.mutate()}
      />
    </Card>
  );
}

function RenamePermissionGroupDialog({ group, open, onOpenChange }: { group: PermissionGroup; open: boolean; onOpenChange: (v: boolean) => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState(group.name);
  const [description, setDescription] = useState(group.description ?? "");
  const save = useMutation({
    mutationFn: () => api.patch(`/permission-groups/${group.id}`, { name: name.trim(), description: description.trim() || null }),
    onSuccess: () => (
      toast.success(t("Saved")),
      onOpenChange(false),
      qc.invalidateQueries({ queryKey: ["branches"] }),
      qc.invalidateQueries({ queryKey: ["school-permission-groups"] })
    ),
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("Edit permission group")}
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>{t("Cancel")}</Button>
          <Button variant="primary" disabled={!name.trim()} loading={save.isPending} onClick={() => save.mutate()}>
            {t("Save")}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label={t("Name")}>{(p) => <input {...p} value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />}</Field>
        <Field label={t("Description")} optional>
          {(p) => <input {...p} value={description} onChange={(e) => setDescription(e.target.value)} className={inputClass} />}
        </Field>
      </div>
    </Dialog>
  );
}

/** `branchId` null creates a school-wide group. */
function NewPermissionGroupDialog({ open, onOpenChange, branchId, onCreated }: { open: boolean; onOpenChange: (v: boolean) => void; branchId: string | null; onCreated: (id: string) => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const create = useMutation({
    mutationFn: () =>
      api.post<PermissionGroup>(branchId ? `/branches/${branchId}/permission-groups` : "/school-permission-groups", {
        name: name.trim(),
        description: description.trim() || null,
      }),
    onSuccess: (g) => {
      toast.success(t("{name} created", { name: g.name }));
      qc.invalidateQueries({ queryKey: branchId ? ["branches", branchId, "permission-groups"] : ["school-permission-groups"] });
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
      title={branchId ? t("New permission group") : t("New school-wide group")}
      description={
        branchId
          ? t("A set of permissions, like Approvers or Office staff. Choose what it allows, then attach it to departments.")
          : t("Any branch can attach it to its departments. Choose what it allows after creating it.")
      }
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>{t("Cancel")}</Button>
          <Button variant="primary" disabled={!name.trim()} loading={create.isPending} onClick={() => create.mutate()}>
            {t("Create")}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label={t("Name")}>{(p) => <input {...p} value={name} onChange={(e) => setName(e.target.value)} placeholder={t("Approvers")} className={inputClass} />}</Field>
        <Field label={t("Description")} optional>
          {(p) => <input {...p} value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t("Approve the work sent to the branch")} className={inputClass} />}
        </Field>
      </div>
    </Dialog>
  );
}

/** The whole setup as a YAML or JSON document: download it, or paste an
 * edited one, check what it would change, and apply it. */
function ConfigDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const qc = useQueryClient();
  const [format, setFormat] = useState<"yaml" | "json">("yaml");
  const [text, setText] = useState("");
  const [checked, setChecked] = useState<{ text: string; outcome: ConfigImportOutcome } | null>(null);
  const [busy, setBusy] = useState<"load" | "check" | "apply" | null>(null);
  const type = format === "yaml" ? "application/yaml" : "application/json";
  const load = async () => {
    setBusy("load");
    try {
      setText(await api.getText("/permission-config", { format }));
      setChecked(null);
    } catch (e) {
      toast.error(errorMessage(e));
    }
    setBusy(null);
  };
  const download = () => {
    const blob = new Blob([text], { type });
    const href = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = href;
    link.download = format === "yaml" ? "permissions.yaml" : "permissions.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
  };
  const run = async (dryRun: boolean) => {
    setBusy(dryRun ? "check" : "apply");
    try {
      const outcome = await api.postText<ConfigImportOutcome>("/permission-config", text, type, { format, dry_run: dryRun });
      if (dryRun) setChecked({ text, outcome });
      else {
        toast.success(outcome.changes.length ? tn(outcome.changes.length, "Applied {n} change.", "Applied {n} changes.") : t("Nothing to change."));
        setChecked(null);
        qc.invalidateQueries({ queryKey: ["branches"] });
        qc.invalidateQueries({ queryKey: ["school-permission-groups"] });
        qc.invalidateQueries({ queryKey: ["me"] });
      }
    } catch (e) {
      setChecked(null);
      toast.error(errorMessage(e));
    }
    setBusy(null);
  };
  const upToDate = checked?.text === text;
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("Permissions as a file")}
      description={t("Loading a file creates and changes permission groups, which departments use them, and who heads them. It never deletes: what's missing from the file stays as it is.")}
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>{t("Close")}</Button>
          <Button disabled={!text.trim()} loading={busy === "check"} onClick={() => run(true)}>
            {t("Check changes")}
          </Button>
          <Button variant="primary" disabled={!upToDate || !checked?.outcome.changes.length} loading={busy === "apply"} onClick={() => run(false)}>
            {t("Apply")}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Segmented size="sm" label={t("Format")} value={format} onChange={(f) => (setFormat(f), setText(""), setChecked(null))} options={[{ value: "yaml", label: "YAML" }, { value: "json", label: "JSON" }]} />
          <Button size="sm" loading={busy === "load"} onClick={load}>
            {t("Load the current setup")}
          </Button>
          <Button size="sm" icon={<Download className="size-4" />} disabled={!text} onClick={download}>
            {t("Download")}
          </Button>
        </div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          dir="ltr"
          spellCheck={false}
          rows={14}
          placeholder={t("Load the current setup, or paste a file here.")}
          aria-label={t("Permission setup")}
          className={cx(inputClass, "h-auto font-mono text-[13px] leading-5")}
        />
        {checked && upToDate && (
          <div className="rounded-[12px] border border-border px-4 py-3">
            {checked.outcome.changes.length === 0 ? (
              <p className="text-text-2">{t("Already set up like this: nothing would change.")}</p>
            ) : (
              <>
                <p className="mb-2 font-semibold">{tn(checked.outcome.changes.length, "{n} change:", "{n} changes:")}</p>
                <ul dir="ltr" className="max-h-48 list-disc space-y-1 overflow-y-auto ps-5 text-[14px]">
                  {checked.outcome.changes.map((c, i) => (
                    <li key={i}>{c}</li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}
        {checked && !upToDate && <p className="text-[14px] text-warning">{t("The file changed since it was checked: check it again.")}</p>}
      </div>
    </Dialog>
  );
}

function CheckSomeone({ branchId, onOpen }: { branchId: string; onOpen: (id: string) => void }) {
  const people = usePeople();
  const [who, setWho] = useState<string | null>(null);
  const eff = useEffectivePermissions(branchId, who ?? undefined);
  const bySource = new Map<string, { name: string; items: string[] }>();
  for (const g of eff.data?.grants ?? []) {
    const key = `${g.permission_group.id}:${g.department?.id ?? ""}`;
    const name = g.department ? t("{group}, through {department}", { group: g.permission_group.name, department: g.department.name }) : t("Everyone");
    const entry = bySource.get(key) ?? { name, items: [] };
    entry.items.push(grantTitle(g));
    bySource.set(key, entry);
  }
  return (
    <Card className="p-5">
      <h3 className="mb-3 text-[18px] font-semibold">{t("Check what someone can do")}</h3>
      {who ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between rounded-[10px] border border-input px-3 py-2">
            <button className="text-start font-semibold text-primary hover:underline" onClick={() => onOpen(who)}>
              {people.name(who)}
            </button>
            <button className="text-text-3 hover:text-text" onClick={() => setWho(null)} aria-label={t("Choose someone else")}>
              <X className="size-4" />
            </button>
          </div>
          {eff.isLoading ? (
            <LoadingRows rows={2} />
          ) : eff.data?.is_admin ? (
            <p className="flex gap-2">
              <Shield className="mt-0.5 size-4 shrink-0" />{" "}{t("Admin of this branch — can do everything here except school-level tasks.")}
            </p>
          ) : (
            <ul className="space-y-3">
              {[...bySource.values()].map((g) => (
                <li key={g.name}>
                  <b>{g.items.slice(0, 3).join(t(", "))}{g.items.length > 3 ? t(" and {n} more", { n: g.items.length - 3 }) : ""}</b>
                  <span className="block text-text-2">{t("from {name}", { name: g.name })}</span>
                </li>
              ))}
              {bySource.size === 0 && <li className="text-text-2">{t("Only the basics: their own items and what is sent to them.")}</li>}
            </ul>
          )}
        </div>
      ) : (
        <PersonSelect people={people.inBranch(branchId)} onChange={setWho} placeholder={t("Type a name…")} />
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
  const [importing, setImporting] = useState(false);
  const term = q.trim().toLowerCase();
  const list = (members.data ?? [])
    .filter((m) => (left ? !!m.left_at : !m.left_at))
    .filter((m) => !term || `${m.first_name} ${m.last_name} ${m.email}`.toLowerCase().includes(term))
    .sort((a, b) => a.first_name.localeCompare(b.first_name, localeTag));
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-4">
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Search people…")} aria-label={t("Search people")} className={cx(inputClass, "h-10 w-full py-0 sm:w-72")} />
        {admin && (
          <Segmented size="sm" label={t("Who")} value={left ? "left" : "current"} onChange={(v) => setLeft(v === "left")} options={[{ value: "current", label: t("Current") }, { value: "left", label: t("Left the branch") }]} />
        )}
        {manage && (
          <div className="ms-auto">
            {/* One way in: add someone by hand, or many from an Excel file. */}
            <Menu
              trigger={
                <Button variant="primary" size="lg" icon={<UserPlus className="size-6" />}>
                  {t("Add people")}
                  <ChevronDown className="size-4 opacity-80" aria-hidden />
                </Button>
              }
            >
              <MenuItem onSelect={() => setAdding(true)}>
                <UserPlus className="size-5" />
                {t("Add one person")}
              </MenuItem>
              <MenuItem onSelect={() => setImporting(true)}>
                <FileSpreadsheet className="size-5" />
                {t("Import from Excel")}
              </MenuItem>
            </Menu>
          </div>
        )}
      </div>
      {members.isLoading ? (
        <LoadingRows />
      ) : list.length === 0 ? (
        <EmptyState title={term ? t("No one matches {q}.", { q: quote(q) }) : t("No one here yet.")} />
      ) : (
        <ul className="divide-y divide-border">
          {list.map((m) => (
            <MemberRow key={m.user_id} m={m} onOpen={() => onOpen(m.user_id)} />
          ))}
        </ul>
      )}
      <AddMemberDialog open={adding} onOpenChange={setAdding} branchId={branchId} branchName={branchName} />
      <ImportMembersDialog open={importing} onOpenChange={setImporting} branchId={branchId} branchName={branchName} />
    </Card>
  );
}

function MemberRow({ m, onOpen }: { m: Member; onOpen: () => void }) {
  return (
    <li>
      <button onClick={onOpen} className="flex w-full flex-wrap items-center gap-3 px-5 py-3 text-start hover:bg-surface-2 sm:flex-nowrap">
        <Avatar first={m.first_name} last={m.last_name} id={m.user_id} size={40} />
        <div className="min-w-0 flex-1">
          <div className={cx("font-semibold", !m.is_active && "line-through")}>
            {m.first_name} {m.last_name}{" "}
            {m.is_admin && (
              <span className="ms-2 inline-flex items-center gap-1 rounded-md bg-sunken px-2 text-[13px] font-semibold text-text-2 no-underline">
                <Shield className="size-3.5" />{" "}{t("Admin")}
              </span>
            )}
            {!m.is_active && <span className="ms-2 text-[13px] font-normal text-text-3">{t("Deactivated")}</span>}
          </div>
          <div className="truncate text-[14px] text-text-2">{m.email}</div>
        </div>
        <span className="hidden text-[14px] text-text-3 sm:block">{m.left_at ? t("Left {date}", { date: formatDay(m.left_at) }) : t("Joined {date}", { date: formatDay(m.joined_at) })}</span>
        <ChevronRight className="size-4 text-text-3 rtl:-scale-x-100" aria-hidden />
      </button>
    </li>
  );
}

export function AddMemberDialog({ open, onOpenChange, branchId, branchName }: { open: boolean; onOpenChange: (v: boolean) => void; branchId: string; branchName: string }) {
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
      else toast.success(r.reactivated ? t("Welcome back — {name} is a member again.", { name: first || email }) : t("{name} was added to {branch}.", { name: first || email, branch: branchName }));
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
        title={t("Add a member to {name}", { name: branchName })}
        description={t("If they already have an account (for example at another branch), they're added straight away.")}
        footer={
          <>
            <Button onClick={() => onOpenChange(false)}>{t("Cancel")}</Button>
            <Button variant="primary" disabled={!email.includes("@")} loading={add.isPending} onClick={() => add.mutate()}>
              {t("Add member")}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label={t("Email")}>{(p) => <input {...p} type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} />}</Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("First name")} hint={t("Needed for new accounts")}>
              {(p) => <input {...p} value={first} onChange={(e) => setFirst(e.target.value)} className={inputClass} />}
            </Field>
            <Field label={t("Last name")}>{(p) => <input {...p} value={last} onChange={(e) => setLast(e.target.value)} className={inputClass} />}</Field>
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
      title={t("Temporary password")}
      description={t("Give this to {name} in person. They'll choose their own password when they first sign in. It won't be shown again.", { name })}
      footer={
        <Button variant="primary" onClick={onClose}>
          {t("Done")}
        </Button>
      }
    >
      <div className="flex items-center gap-2">
        <input readOnly value={password ?? ""} aria-label={t("Temporary password")} className={cx(inputClass, "font-mono text-[18px]")} onFocus={(e) => e.target.select()} />
        <Button
          icon={<Copy className="size-4" />}
          onClick={() => {
            navigator.clipboard?.writeText(password ?? "");
            toast.success(t("Copied"));
          }}
        >
          {t("Copy")}
        </Button>
      </div>
    </Dialog>
  );
}
