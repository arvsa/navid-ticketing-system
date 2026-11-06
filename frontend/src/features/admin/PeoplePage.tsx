// People & groups (UX_SPEC §4.11–4.12).
import { useState } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Archive, ArchiveRestore, Building2, ChevronDown, ChevronRight, Copy, FileSpreadsheet, Globe, Lock, Pencil, Plus, Shield, ShieldCheck, Trash2, UserPlus, UserRound, Users, X } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/api/client";
import { useEffectivePermissions, useGroupGrants, useGroups, useMembers, useSchoolGroupCopies, useSchoolGroups } from "@/api/hooks";
import { keys } from "@/api/keys";
import type { AddedMember, DeleteOutcome, Group, Member } from "@/api/types";
import { useBranch } from "@/app/BranchContext";
import { Avatar } from "@/components/badges";
import { PersonSelect } from "@/components/pickers";
import { Button, Card, Dialog, EmptyState, ErrorPanel, Field, IconButton, LoadingRows, Menu, MenuItem, PageHeader, SectionLabel, Segmented, Tabs, cx, inputClass } from "@/components/ui";
import { hasGrant, isAdminOf, isSuper } from "@/lib/can";
import { guard } from "@/lib/unsaved";
import { formatDay } from "@/lib/dates";
import { errorMessage, permissionInfo, reachLabel, typePlural } from "@/lib/labels";
import { useViewer } from "@/lib/useViewer";
import { usePeople } from "@/people/usePeople";
import { ConfirmDialog } from "@/features/items/ItemDialogs";
import type { PeopleSearch } from "@/app/router";
import { ImportMembersDialog } from "./ImportMembers";
import { PersonPanel } from "./PersonPanel";
import { PermissionEditor, summarizeGrants } from "./PermissionEditor";
import { useManagedBranch } from "./useManagedBranch";
import { localeTag, num, quote, t, tn } from "@/i18n";

export function PeoplePage() {
  const viewer = useViewer();
  const search = useSearch({ from: "/authed/shell/people" });
  const navigate = useNavigate({ from: "/people" });
  const { branchId, branch, choices, pick } = useManagedBranch(viewer, "member.manage", search.branch);
  const openPerson = (id: string) => navigate({ search: (s: PeopleSearch) => ({ ...s, person: id }) });
  const ctx = useBranch();
  // From a school-wide group to its copy in one branch, and back.
  const openCopy = (copyBranch: string, groupId: string) =>
    guard(() => {
      if (ctx.branchId && ctx.branchId !== copyBranch) ctx.setBranch(copyBranch);
      else pick(copyBranch);
      navigate({ search: (s: PeopleSearch) => ({ ...s, tab: undefined, group: groupId }) });
    });
  const openTemplate = (templateId: string) => navigate({ search: (s: PeopleSearch) => ({ ...s, tab: "school", group: templateId }) });
  const members = useMembers(branchId);
  const groups = useGroups(branchId, true);
  const superAdmin = isSuper(viewer);
  const schoolGroups = useSchoolGroups(superAdmin);
  const tab = search.tab === "school" && !superAdmin ? "groups" : (search.tab ?? "groups");
  if (!branchId) return <EmptyState title={t("You don't manage a branch.")} />;
  const activeGroups = groups.data?.filter((g) => !g.archived_at).length;
  const openBranch = (id: string) =>
    guard(() => {
      pick(id);
      navigate({ search: (s: PeopleSearch) => ({ ...s, tab: tab === "school" ? undefined : s.tab, group: undefined }) });
    });
  const openTab = (v: "members" | "groups") =>
    navigate({ search: (s: PeopleSearch) => ({ ...s, tab: v === "groups" ? undefined : v, group: undefined }) });
  return (
    <div>
      <PageHeader title={t("People & groups")} subtitle={tab === "school" ? t("School-wide groups · for every branch") : branch?.name} />
      <div className="grid gap-6 lg:grid-cols-[248px_minmax(0,1fr)]">
        <PeopleNav
          branches={choices.length ? choices : branch ? [branch] : []}
          branchId={tab === "school" ? undefined : branchId}
          tab={tab}
          members={members.data?.length}
          groups={activeGroups}
          schoolGroups={superAdmin ? (schoolGroups.data?.filter((g) => !g.archived_at).length ?? null) : undefined}
          everyone={superAdmin ? schoolGroups.data?.find((g) => g.is_default) : undefined}
          selectedGroup={search.group}
          onEveryone={(id) => guard(() => navigate({ search: (s: PeopleSearch) => ({ ...s, tab: "school", group: id }) }))}
          onBranch={openBranch}
          onTab={openTab}
          onSchool={() => guard(() => navigate({ search: (s: PeopleSearch) => ({ ...s, tab: "school", group: undefined }) }))}
        />
        <div className="min-w-0">
          {tab === "members" ? (
            <MembersTab branchId={branchId} branchName={branch?.name ?? ""} onOpen={openPerson} />
          ) : tab === "school" ? (
            <SchoolGroupsTab selected={search.group} onSelect={(g) => navigate({ search: (s: PeopleSearch) => ({ ...s, group: g }) })} onOpenCopy={openCopy} />
          ) : (
            <GroupsTab
              branchId={branchId}
              branchName={branch?.name ?? ""}
              selected={search.group}
              onSelect={(g) => navigate({ search: (s: PeopleSearch) => ({ ...s, group: g }) })}
              onOpen={openPerson}
              onOpenTemplate={superAdmin ? openTemplate : undefined}
            />
          )}
        </div>
      </div>
      <PersonPanel userId={search.person} branchId={branchId} onClose={() => navigate({ search: (s: PeopleSearch) => ({ ...s, person: undefined }) })} />
    </div>
  );
}

/** The page's own navigation: a floating card with the branches and, under
 * the open one, its members and groups. Super admins also get the
 * school-wide groups. */
function PeopleNav({
  branches,
  branchId,
  tab,
  members,
  groups,
  schoolGroups,
  everyone,
  selectedGroup,
  onBranch,
  onTab,
  onSchool,
  onEveryone,
}: {
  branches: { id: string; name: string }[];
  /** Unset while the school-wide groups are open. */
  branchId?: string;
  tab: string;
  members?: number;
  groups?: number;
  /** `undefined` hides the entry (not a super admin); `null` while loading. */
  schoolGroups?: number | null;
  /** The school-wide "Everyone" group (super admins). */
  everyone?: Group;
  selectedGroup?: string;
  onBranch: (id: string) => void;
  onTab: (tab: "members" | "groups") => void;
  onSchool: () => void;
  onEveryone: (id: string) => void;
}) {
  const onEveryonePage = tab === "school" && !!everyone && selectedGroup === everyone.id;
  const row = (active: boolean) =>
    cx(
      "flex w-full items-center gap-2.5 rounded-[12px] px-3 py-2.5 text-start transition-colors",
      active ? "bg-selected font-semibold text-on-selected" : "text-text-2 hover:bg-sunken hover:text-text",
    );
  const count = (n?: number | null) => n != null && <span className="ms-auto text-[14px] tabular opacity-80">{num(n)}</span>;
  return (
    <aside className="lg:sticky lg:top-24 lg:self-start">
      <Card className="p-2 shadow-2">
        <nav aria-label={t("People & groups")} className="space-y-1">
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
                      <li>
                        <button onClick={() => onTab("members")} aria-current={tab === "members" ? "page" : undefined} className={row(tab === "members")}>
                          <UserRound className="size-[18px] shrink-0" aria-hidden />
                          {t("Members")}
                          {count(members)}
                        </button>
                      </li>
                      <li>
                        <button onClick={() => onTab("groups")} aria-current={tab === "groups" ? "page" : undefined} className={row(tab === "groups")}>
                          <Users className="size-[18px] shrink-0" aria-hidden />
                          {t("Groups")}
                          {count(groups)}
                        </button>
                      </li>
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
          {schoolGroups !== undefined && (
            <div className="mt-1 space-y-1 border-t border-border pt-2">
              <button onClick={onSchool} aria-current={tab === "school" && !onEveryonePage ? "page" : undefined} className={row(tab === "school" && !onEveryonePage)}>
                <Globe className="size-[18px] shrink-0" aria-hidden />
                {t("School-wide groups")}
                {count(schoolGroups)}
              </button>
              {everyone && (
                <button onClick={() => onEveryone(everyone.id)} aria-current={onEveryonePage ? "page" : undefined} className={row(onEveryonePage)}>
                  <ShieldCheck className="size-[18px] shrink-0" aria-hidden />
                  {t("Permissions for everyone")}
                </button>
              )}
            </div>
          )}
        </nav>
      </Card>
    </aside>
  );
}

// ---------- groups ----------

function GroupsTab({
  branchId,
  branchName,
  selected,
  onSelect,
  onOpen,
  onOpenTemplate,
}: {
  branchId: string;
  branchName: string;
  selected?: string;
  onSelect: (id: string) => void;
  onOpen: (id: string) => void;
  onOpenTemplate?: (id: string) => void;
}) {
  const viewer = useViewer();
  const groups = useGroups(branchId, true);
  const [creating, setCreating] = useState(false);
  const admin = isAdminOf(viewer, branchId);
  const list = groups.data ?? [];
  const [gq, setGq] = useState("");
  const active = list.filter((g) => !g.archived_at && (!gq.trim() || (g.is_default ? t("All members").toLowerCase() : g.name.toLowerCase()).includes(gq.trim().toLowerCase()))).sort((a, b) => Number(b.is_default) - Number(a.is_default) || a.name.localeCompare(b.name, localeTag));
  const archived = list.filter((g) => g.archived_at);
  const current = list.find((g) => g.id === selected) ?? active.find((g) => !g.is_default) ?? active[0];
  if (groups.isLoading) return <LoadingRows />;
  if (groups.error) return <ErrorPanel error={groups.error} />;
  return (
    <div className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
      <div className="space-y-6">
        <Card className="p-2">
          {list.length > 5 && (
            <input
              type="search"
              value={gq}
              onChange={(e) => setGq(e.target.value)}
              placeholder={t("Find a group")}
              aria-label={t("Find a group")}
              className={cx(inputClass, "mb-1 h-10 rounded-full py-0")}
            />
          )}
          {gq && active.length === 0 && <p className="px-4 py-3 text-text-2">{t("No group matches {q}.", { q: quote(gq) })}</p>}
          <ul>
            {active.map((g) => (
              <GroupListItem key={g.id} g={g} active={current?.id === g.id} onClick={() => onSelect(g.id)} />
            ))}
          </ul>
          {admin && (
            <button onClick={() => setCreating(true)} className="flex items-center gap-2 px-4 py-3 font-semibold text-primary hover:underline">
              <Plus className="size-5" />{" "}{t("New group")}
            </button>
          )}
          {archived.length > 0 && (
            <details className="border-t border-border px-4 py-3">
              <summary className="cursor-pointer text-text-2">{t("Archived ({n})", { n: archived.length })}</summary>
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
      {current && <GroupDetail key={current.id} group={current} branchId={branchId} branchName={branchName} editable={admin} onOpen={onOpen} onOpenTemplate={onOpenTemplate} />}
      <NewGroupDialog open={creating} onOpenChange={setCreating} branchId={branchId} onCreated={onSelect} />
    </div>
  );
}

/** Groups with no branch (super admins): their permissions apply in every
 * branch their members belong to. Members can come from any branch. */
function SchoolGroupsTab({ selected, onSelect, onOpenCopy }: { selected?: string; onSelect: (id: string) => void; onOpenCopy: (branchId: string, groupId: string) => void }) {
  const groups = useSchoolGroups(true);
  const [creating, setCreating] = useState(false);
  const [gq, setGq] = useState("");
  const list = groups.data ?? [];
  const term = gq.trim().toLowerCase();
  const active = list
    .filter((g) => !g.archived_at && (!term || groupName(g).toLowerCase().includes(term)))
    .sort((a, b) => Number(b.is_default) - Number(a.is_default) || a.name.localeCompare(b.name, localeTag));
  const archived = list.filter((g) => g.archived_at);
  const current = list.find((g) => g.id === selected) ?? active.find((g) => !g.is_default) ?? active[0];
  if (groups.isLoading) return <LoadingRows />;
  if (groups.error) return <ErrorPanel error={groups.error} />;
  return (
    <div className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
      <div className="space-y-6">
        <Card className="p-2">
          <p className="flex gap-2 px-4 py-3 text-[14px] text-text-2">
            <Globe className="mt-0.5 size-4 shrink-0" aria-hidden />
            {t("Common groups between branches")}
          </p>
          {list.length > 5 && (
            <input type="search" value={gq} onChange={(e) => setGq(e.target.value)} placeholder={t("Find a group")} aria-label={t("Find a group")} className={cx(inputClass, "mb-1 h-10 rounded-full py-0")} />
          )}
          {term && active.length === 0 && <p className="px-4 py-3 text-text-2">{t("No group matches {q}.", { q: quote(gq) })}</p>}
          {!list.some((g) => !g.is_default) && <p className="px-4 py-3 text-text-2">{t("No school-wide groups yet.")}</p>}
          <ul>
            {active.map((g) => (
              <GroupListItem key={g.id} g={g} active={current?.id === g.id} onClick={() => onSelect(g.id)} />
            ))}
          </ul>
          <button onClick={() => setCreating(true)} className="flex items-center gap-2 px-4 py-3 font-semibold text-primary hover:underline">
            <Plus className="size-5" />{" "}{t("New school-wide group")}
          </button>
          {archived.length > 0 && (
            <details className="border-t border-border px-4 py-3">
              <summary className="cursor-pointer text-text-2">{t("Archived ({n})", { n: archived.length })}</summary>
              <ul className="mt-2">
                {archived.map((g) => (
                  <GroupListItem key={g.id} g={g} active={current?.id === g.id} onClick={() => onSelect(g.id)} />
                ))}
              </ul>
            </details>
          )}
        </Card>
      </div>
      {current && <GroupDetail key={current.id} group={current} branchId={null} branchName={t("every branch")} editable onOpenCopy={onOpenCopy} />}
      <NewGroupDialog open={creating} onOpenChange={setCreating} branchId={null} onCreated={onSelect} />
    </div>
  );
}

/** Built-in groups: each branch's "All members", and the school-wide "Everyone". */
function groupName(g: Group) {
  return g.is_default ? (g.branch_id ? t("All members") : t("Everyone")) : g.name;
}

function GroupListItem({ g, active, onClick }: { g: Group; active: boolean; onClick: () => void }) {
  const grants = useGroupGrants(g.id);
  return (
    <li>
      <button onClick={onClick} aria-current={active} className={cx("w-full rounded-[10px] px-4 py-3 text-start", active ? "bg-primary-soft" : "hover:bg-surface-2")}>
        <span className="flex items-baseline justify-between gap-2">
          <span className="flex items-center gap-1.5 font-semibold">
            {g.template_id && <Globe className="size-3.5 shrink-0 text-text-3" aria-label={t("School-wide")} />}
            {groupName(g)}
          </span>
          <span className="text-text-2 tabular">{num(g.member_count)}</span>
        </span>
        <span className="block text-[14px] text-text-2">{g.is_default ? (g.branch_id ? t("Everyone's everyday permissions") : t("Every user, in every branch")) : g.archived_at ? t("Archived") : summarizeGrants(grants.data)}</span>
      </button>
    </li>
  );
}

/** `branchId` null: a school-wide group (a template with a copy in every
 * branch). A branch group with `template_id` is such a copy: only its members
 * are chosen here. */
function GroupDetail({
  group,
  branchId,
  branchName,
  editable,
  onOpen,
  onOpenCopy,
  onOpenTemplate,
}: {
  group: Group;
  branchId: string | null;
  branchName: string;
  editable: boolean;
  onOpen?: (id: string) => void;
  onOpenCopy?: (branchId: string, groupId: string) => void;
  onOpenTemplate?: (id: string) => void;
}) {
  const [tab, setTab] = useState<"can" | "members" | "branches">("can");
  const [renaming, setRenaming] = useState(false);
  const title = groupName(group);
  const isCopy = !!group.template_id;
  const isEveryone = group.is_default && !group.branch_id;
  // A copy's name, permissions and archiving come from the school-wide group.
  const shapeEditable = editable && !group.is_default && !isCopy;
  return (
    <Card className="min-w-0 overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-3 px-6 pt-6">
        <div>
          <h2 className="flex items-center gap-2 text-[28px] font-bold">
            {group.is_default && <Lock className="size-5 text-text-3" />}
            {(!group.branch_id || isCopy) && <Globe className="size-5 text-text-3" aria-label={t("School-wide")} />}
            {title}
          </h2>
          <p className="text-text-2">
            {isEveryone ? t("Every user, in every branch") : group.is_default ? t("Everyone in {name}", { name: branchName }) : group.description || t("No description")} ·{" "}
            {isEveryone
              ? tn(group.member_count, "{n} person", "{n} people")
              : !branchId
                ? tn(group.member_count, "{n} member across branches", "{n} members across branches")
                : tn(group.member_count, "{n} member", "{n} members")}
            {group.archived_at && ` · ${t("Archived")}`}
          </p>
        </div>
        {shapeEditable && <GroupActions group={group} onRename={() => setRenaming(true)} />}
      </div>
      {isCopy && (
        <div className="mx-6 mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[12px] bg-sunken px-4 py-3 text-text-2">
          <Globe className="size-4 shrink-0" aria-hidden />
          <span className="flex-1">{t("Set up for every branch by the school office. You choose who's in it.")}</span>
          {onOpenTemplate && (
            <button className="font-semibold text-primary hover:underline" onClick={() => onOpenTemplate(group.template_id!)}>
              {t("Edit for every branch")}
            </button>
          )}
        </div>
      )}
      <Tabs
        className="mx-6 mt-4"
        value={tab}
        onChange={(v) => guard(() => setTab(v))}
        tabs={[
          { value: "can", label: t("What they can do") },
          ...(isEveryone
            ? []
            : [
                branchId
                  ? { value: "members" as const, label: t("Members"), count: group.member_count }
                  : { value: "branches" as const, label: t("Branches") },
              ]),
        ]}
      />
      {tab === "can" && (shapeEditable || (editable && group.is_default) ? <PermissionEditor group={group} branchName={branchName} /> : <ReadOnlyGrants groupId={group.id} />)}
      {tab === "members" && branchId && (
        <GroupMembers group={group} branchId={branchId} editable={editable && !group.is_default && !group.archived_at} onOpen={onOpen} />
      )}
      {tab === "branches" && <GroupCopies group={group} onOpenCopy={onOpenCopy} />}
      <RenameDialog group={group} open={renaming} onOpenChange={setRenaming} />
    </Card>
  );
}

/** A school-wide group's copy in each branch, to open and fill with people. */
function GroupCopies({ group, onOpenCopy }: { group: Group; onOpenCopy?: (branchId: string, groupId: string) => void }) {
  const copies = useSchoolGroupCopies(group.id);
  const { branchById } = useBranch();
  if (copies.isLoading) return <LoadingRows />;
  if (copies.error) return <ErrorPanel error={copies.error} />;
  return (
    <div className="px-6 py-5">
      <p className="mb-3 text-text-2">{t("Each branch has its own copy. Its admins choose who's in it; new branches get one automatically.")}</p>
      <ul className="divide-y divide-border">
        {(copies.data ?? []).map((c) => (
          <li key={c.id}>
            <button
              onClick={() => c.branch_id && onOpenCopy?.(c.branch_id, c.id)}
              className="flex w-full items-center gap-3 rounded-[10px] px-2 py-3 text-start hover:bg-surface-2"
            >
              <span className="min-w-0 flex-1 font-semibold">{(c.branch_id && branchById.get(c.branch_id)?.name) ?? t("Branch")}</span>
              <span className="text-text-2">{tn(c.member_count, "{n} member", "{n} members")}</span>
              <ChevronRight className="size-4 text-text-3 rtl:-scale-x-100" aria-hidden />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ReadOnlyGrants({ groupId }: { groupId: string }) {
  const grants = useGroupGrants(groupId);
  if (!grants.data) return <LoadingRows />;
  if (!grants.data.length) return <p className="px-6 py-6 text-text-2">{t("No extra permissions.")}</p>;
  return (
    <ul className="divide-y divide-border px-6 py-2">
      {grants.data.map((g) => (
        <li key={g.id} className="py-3">
          <b>{permissionInfo[g.permission]?.title ?? g.permission}</b>
          <span className="text-text-2">
            {" "}
            · {reachLabel(g.permission, g.scope)}
            {g.issue_type && ` · ${typePlural[g.issue_type]}`}
          </span>
        </li>
      ))}
    </ul>
  );
}

function GroupMembers({ group, branchId, editable, onOpen }: { group: Group; branchId: string; editable: boolean; onOpen?: (id: string) => void }) {
  const qc = useQueryClient();
  const people = usePeople();
  const members = useMembers(branchId, { groupId: group.id });
  const [adding, setAdding] = useState(false);
  const [mq, setMq] = useState("");
  const [pick, setPick] = useState<string | null>(null);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["branches", branchId] });
    qc.invalidateQueries({ queryKey: ["school-groups"] });
    qc.invalidateQueries({ queryKey: ["my-groups"] });
  };
  const add = useMutation({
    mutationFn: (id: string) => api.put(`/groups/${group.id}/members/${id}`),
    onSuccess: () => (toast.success(t("Added")), setPick(null), refresh()),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/groups/${group.id}/members/${id}`),
    onSuccess: () => (toast.success(t("Removed from the group")), refresh()),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const ids = new Set((members.data ?? []).map((m) => m.user_id));
  const term = mq.trim().toLowerCase();
  const shown = (members.data ?? []).filter((m) => !term || `${m.first_name} ${m.last_name} ${m.email}`.toLowerCase().includes(term));
  return (
    <div className="px-6 py-5">
      {group.is_default && <p className="mb-4 rounded-[10px] bg-sunken px-4 py-3 text-text-2">{t("Everyone in the branch is in this group automatically.")}</p>}
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
              <PersonSelect people={people.inBranch(branchId)} value={pick} onChange={setPick} exclude={[...ids]} />
              <div className="flex gap-2">
                <Button variant="primary" disabled={!pick} loading={add.isPending} onClick={() => pick && add.mutate(pick)}>
                  {t("Add to {name}", { name: group.name })}
                </Button>
                <Button onClick={() => setAdding(false)}>{t("Done")}</Button>
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
        <p className="text-text-2">{t("No one is in this group yet. Add people to give them its permissions.")}</p>
      ) : (
        <ul className="divide-y divide-border">
          {shown.map((m) => (
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
                  </span>
                  <span className="block truncate text-[14px] text-text-3">{m.email}</span>
                </span>
              </button>
              {editable && (
                <Button variant="ghost" size="sm" aria-label={t("Remove {person} from {group}", { person: m.first_name, group: group.name })} onClick={() => remove.mutate(m.user_id)}>
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

/** Rename, archive (or restore) and delete, as icons beside the group's name. */
function GroupActions({ group, onRename }: { group: Group; onRename: () => void }) {
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  const refresh = () => (qc.invalidateQueries({ queryKey: ["branches", group.branch_id, "groups"] }), qc.invalidateQueries({ queryKey: keys.schoolGroups }));
  const archive = useMutation({
    mutationFn: () => api.patch(`/groups/${group.id}`, { archived: !group.archived_at }),
    onSuccess: () => (toast.success(group.archived_at ? t("Restored") : t("Archived")), refresh()),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const del = useMutation({
    mutationFn: () => api.del<DeleteOutcome>(`/groups/${group.id}`),
    onSuccess: (o) => (toast.success(o.deleted ? t("Group deleted") : t("It was sent work before, so it was archived instead.")), setConfirm(false), refresh()),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const archiveLabel = group.archived_at
    ? t("Restore group")
    : group.branch_id
      ? t("Archive group. It can't be sent new work; its history stays.")
      : t("Archive group, and its copy in every branch");
  return (
    <div className="flex items-center gap-1">
      <IconButton variant="ghost" label={t("Rename")} hintAlign="end" icon={<Pencil className="size-4" />} onClick={onRename} />
      <IconButton
        variant="ghost"
        label={archiveLabel}
        hintAlign="end"
        loading={archive.isPending}
        icon={group.archived_at ? <ArchiveRestore className="size-4" /> : <Archive className="size-4" />}
        onClick={() => archive.mutate()}
      />
      <IconButton variant="ghost-danger" label={t("Delete group")} hintAlign="end" icon={<Trash2 className="size-4" />} onClick={() => setConfirm(true)} />
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={t("Delete {name}?", { name: group.name })}
        body={
          group.branch_id
            ? t("If this group was ever sent work it will be archived instead, so its history stays.")
            : t("Each branch keeps its copy, with its people and permissions, as an ordinary group of that branch.")
        }
        confirm={t("Delete group")}
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
    onSuccess: () => (
      toast.success(t("Saved")),
      onOpenChange(false),
      qc.invalidateQueries({ queryKey: ["branches", group.branch_id, "groups"] }),
      qc.invalidateQueries({ queryKey: ["groups"] }),
      qc.invalidateQueries({ queryKey: keys.schoolGroups })
    ),
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("Rename group")}
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
function NewGroupDialog({ open, onOpenChange, branchId, onCreated }: { open: boolean; onOpenChange: (v: boolean) => void; branchId: string | null; onCreated: (id: string) => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const create = useMutation({
    mutationFn: () =>
      api.post<Group>(branchId ? `/branches/${branchId}/groups` : "/school-groups", { name: name.trim(), description: description.trim() || null }),
    onSuccess: (g) => {
      toast.success(t("{name} created", { name: g.name }));
      if (branchId) qc.invalidateQueries({ queryKey: ["branches", branchId, "groups"] });
      else qc.invalidateQueries({ queryKey: keys.schoolGroups });
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
      title={branchId ? t("New group") : t("New school-wide group")}
      description={
        branchId
          ? t("Departments, year teams, committees. Choose what it can do after creating it.")
          : t("Every branch gets its own copy. Choose what it can do after creating it.")
      }
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>{t("Cancel")}</Button>
          <Button variant="primary" disabled={!name.trim()} loading={create.isPending} onClick={() => create.mutate()}>
            {t("Create group")}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label={t("Name")}>{(p) => <input {...p} value={name} onChange={(e) => setName(e.target.value)} placeholder={t("Coordinators")} className={inputClass} />}</Field>
        <Field label={t("Description")} optional>
          {(p) => <input {...p} value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t("Heads of year and department coordinators")} className={inputClass} />}
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
    const title = permissionInfo[g.permission]?.title ?? g.permission;
    entry.items.push(`${title}${g.issue_type ? ` (${typePlural[g.issue_type]})` : ""}`);
    byGroup.set(g.group.id, entry);
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
              {[...byGroup.values()].map((g) => (
                <li key={g.name}>
                  <b>{g.items.slice(0, 3).join(t(", "))}{g.items.length > 3 ? t(" and {n} more", { n: g.items.length - 3 }) : ""}</b>
                  <span className="block text-text-2">{t("from {name}", { name: g.name })}</span>
                </li>
              ))}
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
