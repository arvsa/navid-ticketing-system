// "What they can do" for a group (Groups & permissions design; UX_SPEC §4.12).
// The API has no update: a change of reach or kinds is delete + create, run in
// sequence by the save bar (gap G-13).
import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Info, Lock, Search } from "lucide-react";
import { toast } from "sonner";
import { ApiError, api } from "@/api/client";
import { useCatalog, useGroupGrants } from "@/api/hooks";
import { keys } from "@/api/keys";
import type { CatalogEntry, Group, GroupGrant, IssueType, Permission, Scope } from "@/api/types";
import { Button, Dialog, LoadingRows, Segmented, Switch, cx, inputClass } from "@/components/ui";
import { permissionInfo, permissionSections, reachLabel, typeLabel } from "@/lib/labels";
import { quote, t, tn, tx } from "@/i18n";

type Kinds = "all" | IssueType[];
type Row = { on: boolean; scope: Scope; kinds: Kinds; custom?: boolean };
type State = Record<string, Row>;

const KIND_OPTIONS: { value: string; label: string; kinds: Kinds }[] = [
  { value: "all", label: t("All kinds"), kinds: "all" },
  { value: "ticket", label: t("Tickets only"), kinds: ["ticket"] },
  { value: "action", label: t("Actions only"), kinds: ["action"] },
  { value: "report", label: t("Reports only"), kinds: ["report"] },
  { value: "event", label: t("Events only"), kinds: ["event"] },
  { value: "action,report", label: t("Actions and Reports"), kinds: ["action", "report"] },
  { value: "ticket,event", label: t("Tickets and Events"), kinds: ["ticket", "event"] },
];
const kindsValue = (k: Kinds) => (k === "all" ? "all" : [...k].sort().join(","));

function fromGrants(catalog: CatalogEntry[], grants: GroupGrant[]): State {
  const s: State = {};
  for (const c of catalog) {
    const gs = grants.filter((g) => g.permission === c.key);
    if (!gs.length) {
      s[c.key] = { on: false, scope: c.allowed_scopes[c.allowed_scopes.length - 1], kinds: "all" };
      continue;
    }
    const scopes = new Set(gs.map((g) => g.scope));
    const all = gs.some((g) => !g.issue_type);
    const kinds: Kinds = all ? "all" : (gs.map((g) => g.issue_type!).sort() as IssueType[]);
    s[c.key] = { on: true, scope: gs[0].scope, kinds, custom: scopes.size > 1 || (all && gs.length > 1) };
  }
  return s;
}

function toGrants(state: State): { permission: Permission; scope: Scope; issue_type: IssueType | null }[] {
  const out: { permission: Permission; scope: Scope; issue_type: IssueType | null }[] = [];
  for (const [key, row] of Object.entries(state)) {
    if (!row.on) continue;
    if (row.kinds === "all") out.push({ permission: key as Permission, scope: row.scope, issue_type: null });
    else for (const k of row.kinds) out.push({ permission: key as Permission, scope: row.scope, issue_type: k });
  }
  return out;
}

const sig = (g: { permission: string; scope: string; issue_type?: string | null }) => `${g.permission}|${g.scope}|${g.issue_type ?? ""}`;

export function PermissionEditor({ group, branchName }: { group: Group; branchName: string }) {
  const qc = useQueryClient();
  const catalog = useCatalog();
  const grants = useGroupGrants(group.id);
  const base = useMemo(() => (catalog.data && grants.data ? fromGrants(catalog.data, grants.data) : null), [catalog.data, grants.data]);
  const [state, setState] = useState<State | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [q, setQ] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => setState(base), [base]);

  if (!catalog.data || !grants.data || !state || !base) return <LoadingRows rows={6} />;

  const changed = Object.keys(state).filter((k) => {
    const a = state[k];
    const b = base[k];
    return a.on !== b.on || (a.on && (a.scope !== b.scope || kindsValue(a.kinds) !== kindsValue(b.kinds)));
  });
  const set = (key: string, patch: Partial<Row>) => setState({ ...state, [key]: { ...state[key], ...patch, custom: false } });

  const save = async () => {
    setSaving(true);
    const want = new Set(toGrants(state).map(sig));
    const touched = new Set(changed);
    const toDelete = grants.data!.filter((g) => touched.has(g.permission) && !want.has(sig(g)));
    const have = new Set(grants.data!.map(sig));
    const toAdd = toGrants(state).filter((g) => touched.has(g.permission) && !have.has(sig(g)));
    const failed: string[] = [];
    for (const g of toDelete) {
      try {
        await api.del(`/group-permissions/${g.id}`);
      } catch {
        failed.push(permissionInfo[g.permission]?.title ?? g.permission);
      }
    }
    for (const g of toAdd) {
      try {
        await api.post(`/groups/${group.id}/permissions`, g);
      } catch (e) {
        if (!(e instanceof ApiError && e.code === "grant_exists")) failed.push(permissionInfo[g.permission]?.title ?? g.permission);
      }
    }
    setSaving(false);
    setConfirm(false);
    await qc.invalidateQueries({ queryKey: keys.groupGrants(group.id) });
    qc.invalidateQueries({ queryKey: ["effective-permissions"] });
    if (failed.length) toast.error(t("Some changes didn't save: {list}. Try again.", { list: [...new Set(failed)].join(t(", ")) }));
    else toast.success(tn(group.member_count, "Saved. {n} person affected.", "Saved. {n} people affected."));
  };

  const gained = changed.filter((k) => state[k].on).map((k) => describe(k as Permission, state[k]));
  const lost = changed.filter((k) => !state[k].on).map((k) => permissionInfo[k as Permission]?.title.toLowerCase() ?? k);
  const term = q.trim().toLowerCase();
  const matching = catalog.data.filter((c) => {
    if (!term) return true;
    const info = permissionInfo[c.key];
    return `${info?.title ?? ""} ${info?.help ?? ""} ${c.description} ${c.key}`.toLowerCase().includes(term);
  });

  return (
    <div className="pb-4">
      <div className="mx-6 mt-5 flex gap-3 rounded-[12px] bg-sunken px-5 py-4 text-text-2">
        <Info className="mt-0.5 size-5 shrink-0" aria-hidden />
        <p>
          {group.is_default ? (
            t("These are the everyday permissions everyone in {branch} gets. Changes affect all {n} people.", { branch: branchName, n: group.member_count })
          ) : (
            tx("These add to what {all} can already do. Changes apply on members' next click, are kept in the history, and other admins are told.", { all: <b className="text-text">{t("All members")}</b> })
          )}
        </p>
      </div>

      <div className="relative mx-6 mt-5">
        <Search className="pointer-events-none absolute top-1/2 start-3.5 size-4 -translate-y-1/2 text-text-3" aria-hidden />
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("Search permissions, e.g. approve, export, private")}
          aria-label={t("Search permissions")}
          className={cx(inputClass, "h-11 rounded-full ps-10")}
        />
      </div>
      {term && !matching.length && <p className="px-6 pt-6 text-text-2">{t("No permissions match {q}.", { q: quote(q) })}</p>}

      {permissionSections.map((sec) => {
        const rows = matching.filter((c) => (permissionInfo[c.key]?.section ?? "people") === sec.key);
        if (!rows.length) return null;
        return (
          <section key={sec.key} className="mt-6">
            <h3 className="px-6 pb-2 text-[13px] font-semibold tracking-[0.08em] text-text-3 uppercase">{sec.title}</h3>
            <ul className="divide-y divide-border border-t border-border">
              {rows.map((c) => {
                const row = state[c.key];
                const info = permissionInfo[c.key] ?? { title: c.description, help: "" };
                const isChanged = changed.includes(c.key);
                const scopes = c.allowed_scopes.filter((sc) => !(c.key === "issue.read" && sc === "own") || row.scope === sc);
                return (
                  <li key={c.key} className={cx("flex gap-4 px-6 py-4", isChanged && "bg-warning-soft/60")}>
                    <Switch checked={row.on} onChange={(on) => set(c.key, { on })} label={info.title} />
                    <div className="min-w-0 flex-1 space-y-2.5">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[17px] font-semibold">{info.title}</span>
                          {isChanged && <span className="rounded-md bg-warning-soft px-2 text-[13px] font-semibold text-warning">{t("Changed")}</span>}
                        </div>
                        <div className="text-text-2">{info.help || c.description}</div>
                        {row.custom && <div className="mt-1 text-[13px] text-warning">{t("Custom setup. Changing it here replaces it with the choice shown.")}</div>}
                      </div>
                      {row.on && (
                        <div className="flex flex-wrap items-center gap-2">
                          {scopes.length > 1 ? (
                            <Segmented<Scope> size="sm" label={t("Reach for {name}", { name: info.title })} value={row.scope} onChange={(scope) => set(c.key, { scope })} options={scopes.map((sc) => ({ value: sc, label: reachLabel(c.key, sc) }))} />
                          ) : (
                            <span className="rounded-full bg-sunken px-3 py-1 text-[14px] text-text-2">{reachLabel(c.key, scopes[0])}</span>
                          )}
                          {c.per_issue_type && (
                            <select
                              value={kindsValue(row.kinds)}
                              onChange={(e) => set(c.key, { kinds: KIND_OPTIONS.find((o) => o.value === e.target.value)?.kinds ?? "all" })}
                              className={cx("h-8 rounded-full border border-input bg-surface px-3 text-[14px]", isChanged && "border-warning-edge")}
                              aria-label={t("Kinds for {name}", { name: info.title })}
                            >
                              {!KIND_OPTIONS.some((o) => o.value === kindsValue(row.kinds)) && <option value={kindsValue(row.kinds)}>{(row.kinds as IssueType[]).map((k) => typeLabel[k]).join(t(", "))}</option>}
                              {KIND_OPTIONS.map((o) => (
                                <option key={o.value} value={o.value}>
                                  {o.label}
                                </option>
                              ))}
                            </select>
                          )}
                        </div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}

      <div className="mx-6 mt-6 rounded-[12px] border border-dashed border-border-strong px-5 py-4">
        <p className="flex items-center gap-2 font-semibold">
          <Lock className="size-4" />{" "}{t("Stays with admins — can't be given to a group")}
        </p>
        <p className="mt-1 text-text-2">
          {t("Creating groups and choosing their permissions · adding people to groups · cancelling one person's assignment · appointing admins · approving work a super admin sent out · exporting several branches")}
        </p>
      </div>

      {changed.length > 0 && (
        <div className="sticky bottom-0 mt-6 flex flex-wrap items-center gap-3 border-t border-border bg-surface-2 px-6 py-4 max-md:bottom-[72px]">
          <span>
            {tx("{changes} not saved yet · {affected}", {
              changes: <b className="text-warning">{tn(changed.length, "{n} change", "{n} changes")}</b>,
              affected: tn(group.member_count, "{n} person affected", "{n} people affected"),
            })}
          </span>
          <div className="ms-auto flex gap-2">
            <Button size="lg" onClick={() => setState(base)}>
              {t("Discard")}
            </Button>
            <Button size="lg" variant="primary" onClick={() => setConfirm(true)}>
              {t("Save changes")}
            </Button>
          </div>
        </div>
      )}
      <Dialog
        open={confirm}
        onOpenChange={setConfirm}
        title={t("Save changes to {name}?", { name: group.is_default ? t("All members") : group.name })}
        footer={
          <>
            <Button onClick={() => setConfirm(false)}>{t("Keep editing")}</Button>
            <Button variant="primary" loading={saving} onClick={save}>
              {t("Save changes")}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {gained.length > 0 && (
            <p>
              <b>{t("Will be able to:")}</b> {gained.join(t("; "))}{t(".")}
            </p>
          )}
          {lost.length > 0 && (
            <p>
              <b>{t("Will no longer be able to:")}</b> {lost.join(t("; "))}{t(".")}
            </p>
          )}
          <p className="text-text-2">{tn(group.member_count, "It applies right away to {n} person.", "It applies right away to {n} people.")}</p>
        </div>
      </Dialog>
    </div>
  );
}

function describe(key: Permission, row: Row) {
  const title = permissionInfo[key]?.title.toLowerCase() ?? key;
  const kinds = row.kinds === "all" ? "" : ` (${row.kinds.map((k) => typeLabel[k]).join(t(", "))})`;
  return `${title}${kinds} — ${reachLabel(key, row.scope).toLowerCase()}`;
}

/** One-line summary for the group list ("Can approve and manage members"). */
export function summarizeGrants(grants: GroupGrant[] | undefined) {
  if (!grants) return "";
  if (!grants.length) return t("No extra permissions");
  const words: Record<string, string> = {
    "work_item.approve": t("approve"),
    "member.manage": t("manage members"),
    "issue.read_private": t("see private items"),
    "issue.close": t("close items"),
    "export.run": t("export"),
    "work_item.assign": t("assign work"),
    "issue.target": t("give tasks"),
    "dashboard.branch": t("see branch numbers"),
  };
  const parts = [...new Set(grants.map((g) => words[g.permission]).filter(Boolean))];
  return parts.length ? t("Can {list}", { list: parts.slice(0, 3).join(t(", ")) }) : tn(grants.length, "{n} permission", "{n} permissions");
}
