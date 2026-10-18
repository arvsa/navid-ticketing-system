// One person, opened from anywhere on the admin pages (UX_SPEC §4.11 member
// page): who they are, their branches and groups, what they can do here, and
// the actions the viewer may take.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Shield, X } from "lucide-react";
import { toast } from "sonner";
import { api, getAll } from "@/api/client";
import { useEffectivePermissions, useMembers } from "@/api/hooks";
import type { Group, Member } from "@/api/types";
import { useBranch } from "@/app/BranchContext";
import { Avatar } from "@/components/badges";
import { Button, Dialog, Drawer, DrawerClose, Field, LoadingRows, SectionLabel, cx, inputClass } from "@/components/ui";
import { hasGrant, isAdminOf, isSuper } from "@/lib/can";
import { formatDay } from "@/lib/dates";
import { errorMessage, permissionInfo, typeLabel } from "@/lib/labels";
import { useViewer } from "@/lib/useViewer";
import { usePeople } from "@/people/usePeople";
import { ConfirmDialog } from "@/features/items/ItemDialogs";
import { TempPasswordDialog } from "./PeoplePage";

export function PersonPanel({ userId, branchId, onClose }: { userId?: string | null; branchId?: string; onClose: () => void }) {
  return (
    <Drawer open={!!userId} onOpenChange={(o) => !o && onClose()} label="Person">
      {userId && <PersonBody key={`${userId}-${branchId}`} userId={userId} branchId={branchId} onClose={onClose} />}
    </Drawer>
  );
}

/** Groups this person is in, in one branch (gap G-4: no endpoint lists them). */
function usePersonGroups(branchId: string | undefined, userId: string) {
  return useQuery({
    queryKey: ["person-groups", branchId, userId],
    enabled: !!branchId,
    queryFn: async () => {
      const groups = await getAll<Group>(`/branches/${branchId}/groups`);
      const mine: Group[] = [];
      await Promise.all(
        groups.map(async (g) => {
          if (g.is_default) return void mine.push(g);
          const members = await getAll<Member>(`/branches/${branchId}/members`, { group_id: g.id });
          if (members.some((m) => m.user_id === userId)) mine.push(g);
        }),
      );
      return mine.sort((a, b) => Number(b.is_default) - Number(a.is_default) || a.name.localeCompare(b.name));
    },
  });
}

function PersonBody({ userId, branchId: initialBranch, onClose }: { userId: string; branchId?: string; onClose: () => void }) {
  const viewer = useViewer();
  const qc = useQueryClient();
  const people = usePeople();
  const { branchById } = useBranch();
  const superAdmin = isSuper(viewer);
  const person = people.get(userId);
  const branchIds = person?.branchIds ?? [];
  const [branchId, setBranchId] = useState<string | undefined>(initialBranch && (branchIds.includes(initialBranch) || !branchIds.length) ? initialBranch : branchIds[0] ?? initialBranch);
  const admin = isAdminOf(viewer, branchId);
  const manage = admin || (!!branchId && hasGrant(viewer, branchId, "member.manage"));
  const members = useMembers(branchId, { includeLeft: admin });
  const m = members.data?.find((x) => x.user_id === userId);
  const groups = usePersonGroups(branchId, userId);
  const eff = useEffectivePermissions(m && !m.left_at ? branchId : undefined, userId);
  const [dialog, setDialog] = useState<null | "edit" | "remove" | "deactivate" | "reset" | "super">(null);
  const [temp, setTemp] = useState<string | null>(null);
  const self = userId === viewer.me.user.id;
  const branchName = (id?: string) => (id ? branchById.get(id)?.name ?? "Branch" : "");

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["branches"] });
    qc.invalidateQueries({ queryKey: ["people"] });
    qc.invalidateQueries({ queryKey: ["person-groups"] });
    qc.invalidateQueries({ queryKey: ["effective-permissions"] });
  };
  const ok = (text: string) => () => (toast.success(text), setDialog(null), refresh());
  const fail = (e: unknown) => toast.error(errorMessage(e));
  const remove = useMutation({ mutationFn: () => api.del(`/branches/${branchId}/members/${userId}`), onSuccess: ok(`Removed from ${branchName(branchId)}`), onError: fail });
  const active = useMutation({ mutationFn: () => api.patch(`/users/${userId}/active`, { is_active: !m?.is_active }), onSuccess: ok(m?.is_active ? "Deactivated" : "Reactivated"), onError: fail });
  const reset = useMutation({
    mutationFn: () => api.post<{ temporary_password: string }>(`/users/${userId}/reset-password`),
    onSuccess: (r) => (setTemp(r.temporary_password), setDialog(null)),
    onError: fail,
  });
  const appoint = useMutation({ mutationFn: (b: string) => api.put(`/branches/${b}/admins/${userId}`), onSuccess: ok("Admin appointed"), onError: fail });
  const demote = useMutation({ mutationFn: (b: string) => api.del(`/branches/${b}/admins/${userId}`), onSuccess: ok("Admin role removed"), onError: fail });
  const makeSuper = useMutation({ mutationFn: () => api.put(`/users/${userId}/super-admin`), onSuccess: ok("Now a super admin"), onError: fail });

  const first = m?.first_name ?? person?.first_name ?? "this person";
  const fullName = m ? `${m.first_name} ${m.last_name}` : people.name(userId);
  const singleBranch = branchIds.length <= 1;

  const byGroup = new Map<string, { name: string; items: string[] }>();
  for (const g of eff.data?.grants ?? []) {
    const entry = byGroup.get(g.group.id) ?? { name: g.group.name, items: [] };
    entry.items.push(`${permissionInfo[g.permission]?.title ?? g.permission}${g.issue_type ? ` (${typeLabel[g.issue_type]}s)` : ""}`);
    byGroup.set(g.group.id, entry);
  }

  return (
    <>
      <div className="flex items-start gap-4 border-b border-border px-6 py-5">
        <Avatar first={m?.first_name ?? person?.first_name} last={m?.last_name ?? person?.last_name} id={userId} size={52} />
        <div className="min-w-0 flex-1">
          <h2 className={cx("text-[22px] font-bold break-anywhere", m && !m.is_active && "line-through")}>{fullName}</h2>
          <p className="truncate text-text-2">{m?.email ?? person?.email}</p>
          {m && !m.is_active && <p className="text-[14px] text-text-3">Deactivated</p>}
        </div>
        <DrawerClose className="rounded-[10px] bg-sunken p-2.5 hover:bg-border" aria-label="Close">
          <X className="size-5" />
        </DrawerClose>
      </div>

      <div className="flex-1 space-y-7 overflow-y-auto px-6 py-5">
        <section>
          <SectionLabel className="mb-2">Branches</SectionLabel>
          {branchIds.length === 0 ? (
            <p className="text-text-2">Not a current member of any branch you can see.</p>
          ) : (
            <ul className="divide-y divide-border rounded-[12px] border border-border">
              {branchIds.map((b) => {
                const isAdmin = person?.adminOf.includes(b);
                return (
                  <li key={b} className={cx("flex flex-wrap items-center gap-2 px-4 py-3", b === branchId && "bg-surface-2")}>
                    <button className="min-w-0 flex-1 text-left" onClick={() => setBranchId(b)} aria-pressed={b === branchId}>
                      <span className="font-semibold">{branchName(b)}</span>
                      <span className="ml-2 text-text-2">
                        {isAdmin ? (
                          <span className="inline-flex items-center gap-1">
                            <Shield className="size-3.5" /> Admin
                          </span>
                        ) : (
                          "Member"
                        )}
                      </span>
                    </button>
                    {superAdmin &&
                      (isAdmin ? (
                        <Button size="sm" variant="ghost" loading={demote.isPending && demote.variables === b} onClick={() => demote.mutate(b)}>
                          Remove admin role
                        </Button>
                      ) : (
                        <Button size="sm" loading={appoint.isPending && appoint.variables === b} onClick={() => appoint.mutate(b)}>
                          Make admin
                        </Button>
                      ))}
                  </li>
                );
              })}
            </ul>
          )}
          {m && <p className="mt-2 text-[14px] text-text-3">{m.left_at ? `Left ${branchName(branchId)} ${formatDay(m.left_at)}` : `Joined ${branchName(branchId)} ${formatDay(m.joined_at)}`}</p>}
        </section>

        {branchId && m && !m.left_at && (
          <>
            <section>
              <SectionLabel className="mb-2">Groups in {branchName(branchId)}</SectionLabel>
              {groups.isLoading ? (
                <LoadingRows rows={1} />
              ) : (
                <div className="flex flex-wrap gap-2">
                  {(groups.data ?? []).map((g) => (
                    <span key={g.id} className="rounded-full bg-sunken px-3 py-1">
                      {g.is_default ? "All members" : g.name}
                    </span>
                  ))}
                </div>
              )}
            </section>

            <section>
              <SectionLabel className="mb-2">What they can do here</SectionLabel>
              {eff.isLoading ? (
                <LoadingRows rows={2} />
              ) : eff.data?.is_admin ? (
                <p className="flex gap-2">
                  <Shield className="mt-0.5 size-4 shrink-0" /> Admin of {branchName(branchId)} — can do everything here except school-level tasks.
                </p>
              ) : (
                <ul className="space-y-3">
                  {[...byGroup.values()].map((g) => (
                    <li key={g.name}>
                      <span className="block">{g.items.join(", ")}</span>
                      <span className="text-[14px] text-text-2">from {g.name}</span>
                    </li>
                  ))}
                  {byGroup.size === 0 && <li className="text-text-2">Nothing beyond seeing their own work.</li>}
                </ul>
              )}
            </section>
          </>
        )}
        {members.isLoading && <LoadingRows rows={2} />}
      </div>

      {(manage || superAdmin) && !self && m && !m.left_at && (
        <div className="flex flex-wrap gap-2 border-t border-border px-6 py-4">
          {m.is_admin && !superAdmin ? (
            <p className="w-full text-[14px] text-text-2">Admins are managed by super admins.</p>
          ) : (
            <>
              <Button onClick={() => setDialog("edit")}>Edit name or email</Button>
              <Button onClick={() => setDialog("reset")}>Reset password</Button>
              {!m.is_admin && (
                <Button variant="ghost-danger" onClick={() => setDialog("remove")}>
                  Remove from {branchName(branchId)}
                </Button>
              )}
              {(singleBranch || superAdmin) && (
                <Button variant={m.is_active ? "ghost-danger" : "ghost"} onClick={() => setDialog("deactivate")}>
                  {m.is_active ? "Deactivate account" : "Reactivate account"}
                </Button>
              )}
              {superAdmin && (
                <Button variant="ghost" icon={<Shield className="size-4" />} onClick={() => setDialog("super")}>
                  Make super admin
                </Button>
              )}
            </>
          )}
        </div>
      )}

      <ConfirmDialog
        open={dialog === "remove"}
        onOpenChange={(o) => !o && setDialog(null)}
        title={`Remove ${first} from ${branchName(branchId)}?`}
        body="Their unfinished work here becomes unassigned, so someone else can be given it."
        confirm="Remove"
        danger
        loading={remove.isPending}
        onConfirm={() => remove.mutate(undefined, { onSuccess: () => singleBranch && onClose() })}
      />
      <ConfirmDialog
        open={dialog === "deactivate"}
        onOpenChange={(o) => !o && setDialog(null)}
        title={m?.is_active ? `Deactivate ${first}?` : `Reactivate ${first}?`}
        body={m?.is_active ? `${first} won't be able to sign in. Their history stays. You can reactivate later.` : `${first} can sign in again.`}
        confirm={m?.is_active ? "Deactivate" : "Reactivate"}
        danger={m?.is_active}
        loading={active.isPending}
        onConfirm={() => active.mutate()}
      />
      <ConfirmDialog
        open={dialog === "reset"}
        onOpenChange={(o) => !o && setDialog(null)}
        title={`Reset ${first}'s password?`}
        body={`${first} gets a new temporary password and is signed out everywhere.`}
        confirm="Reset password"
        loading={reset.isPending}
        onConfirm={() => reset.mutate()}
      />
      <ConfirmDialog
        open={dialog === "super"}
        onOpenChange={(o) => !o && setDialog(null)}
        title={`Make ${first} a super admin?`}
        body={`${first} will see every branch, send work school-wide and approve it.`}
        confirm="Make super admin"
        loading={makeSuper.isPending}
        onConfirm={() => makeSuper.mutate()}
      />
      {dialog === "edit" && m && branchId && <EditPerson m={m} branchId={branchId} onClose={() => (setDialog(null), refresh())} />}
      <TempPasswordDialog name={first} password={temp} onClose={() => setTemp(null)} />
    </>
  );
}

function EditPerson({ m, branchId, onClose }: { m: Member; branchId: string; onClose: () => void }) {
  const [first, setFirst] = useState(m.first_name);
  const [last, setLast] = useState(m.last_name);
  const [email, setEmail] = useState(m.email);
  const save = useMutation({
    mutationFn: () => api.patch(`/branches/${branchId}/members/${m.user_id}`, { first_name: first.trim(), last_name: last.trim(), email: email.trim() }),
    onSuccess: () => (toast.success("Saved"), onClose()),
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Edit ${m.first_name}`}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="First name">{(p) => <input {...p} value={first} onChange={(e) => setFirst(e.target.value)} className={inputClass} />}</Field>
          <Field label="Last name">{(p) => <input {...p} value={last} onChange={(e) => setLast(e.target.value)} className={inputClass} />}</Field>
        </div>
        <Field label="Email">{(p) => <input {...p} type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} />}</Field>
      </div>
    </Dialog>
  );
}
