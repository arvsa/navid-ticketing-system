// What a permission group lets its people do (Groups & permissions design;
// UX_SPEC §4.12). Every grant is branch-wide: what people may do with their
// own items and with what's sent to them needs no grant. The save bar sends
// the whole set in one request, so it's all or nothing and admins are told once.
import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Info, Lock, Search } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/api/client";
import { useCatalog } from "@/api/hooks";
import type { CatalogEntry, GrantSpec, IssueType, Permission, PermissionGroup } from "@/api/types";
import { Button, Dialog, LoadingRows, Switch, cx, inputClass } from "@/components/ui";
import { errorMessage, grantTitle, permissionInfo, permissionSections, typeLabel } from "@/lib/labels";
import { useUnsaved } from "@/lib/unsaved";
import { quote, t, tn, tx } from "@/i18n";

type Kinds = "all" | IssueType[];
/** `departments`: for department.members.manage, names or `*`. */
type Row = { on: boolean; kinds: Kinds; departments: string[] };
type State = Record<string, Row>;

const KIND_OPTIONS: { value: string; label: string; kinds: Kinds }[] = [
  { value: "all", label: t("All kinds"), kinds: "all" },
  { value: "ticket", label: t("Tickets only"), kinds: ["ticket"] },
  { value: "action", label: t("Actions only"), kinds: ["action"] },
  { value: "event", label: t("Events only"), kinds: ["event"] },
  { value: "ticket,event", label: t("Tickets and Events"), kinds: ["ticket", "event"] },
];
const kindsValue = (k: Kinds) => (k === "all" ? "all" : [...k].sort().join(","));
const perDepartment = (key: string) => key === "department.members.manage";

function fromGrants(catalog: CatalogEntry[], grants: GrantSpec[]): State {
  const s: State = {};
  for (const c of catalog) {
    const gs = grants.filter((g) => g.permission === c.key);
    const all = gs.some((g) => !g.issue_type);
    const kinds: Kinds = !gs.length || all ? "all" : (gs.map((g) => g.issue_type!).sort() as IssueType[]);
    const departments = [...new Set(gs.map((g) => g.department).filter((d): d is string => !!d))].sort();
    s[c.key] = { on: gs.length > 0, kinds, departments };
  }
  return s;
}

function toGrants(state: State): GrantSpec[] {
  const out: GrantSpec[] = [];
  for (const [key, row] of Object.entries(state)) {
    const permission = key as Permission;
    if (!row.on) continue;
    if (perDepartment(key)) for (const department of row.departments) out.push({ permission, department });
    else if (row.kinds === "all") out.push({ permission });
    else for (const issue_type of row.kinds) out.push({ permission, issue_type });
  }
  return out;
}

const same = (a: Row, b: Row) =>
  a.on === b.on && (!a.on || (kindsValue(a.kinds) === kindsValue(b.kinds) && a.departments.join("|") === b.departments.join("|")));

/** `editable` false: shown read-only (another branch's or a school-wide
 * group, for branch admins). `departments`: the branch's department names,
 * offered for the per-department permission. */
export function PermissionEditor({ group, editable, departments }: { group: PermissionGroup; editable: boolean; departments: string[] }) {
  const qc = useQueryClient();
  const catalog = useCatalog();
  const base = useMemo(() => (catalog.data ? fromGrants(catalog.data, group.grants) : null), [catalog.data, group.grants]);
  const [state, setState] = useState<State | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [q, setQ] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => setState(base), [base]);

  const changed = state && base ? Object.keys(state).filter((k) => !same(state[k], base[k])) : [];
  useUnsaved(`permissions:${group.id}`, changed.length > 0);

  if (!catalog.data || !state || !base) return <LoadingRows rows={6} />;

  const set = (key: string, patch: Partial<Row>) => setState({ ...state, [key]: { ...state[key], ...patch } });
  const reach = group.is_default
    ? t("every user, in every branch")
    : tn(group.department_ids.length, "the members of {n} department", "the members of {n} departments");

  const save = async () => {
    setSaving(true);
    try {
      await api.patch(`/permission-groups/${group.id}`, { grants: toGrants(state) });
      toast.success(t("Saved. It applies to {reach}.", { reach }));
    } catch (e) {
      // Nothing was saved; the changes stay on screen to try again.
      toast.error(t("Nothing was saved: {reason}", { reason: errorMessage(e) }));
      setSaving(false);
      return;
    }
    setSaving(false);
    setConfirm(false);
    qc.invalidateQueries({ queryKey: ["branches"] });
    qc.invalidateQueries({ queryKey: ["school-permission-groups"] });
    qc.invalidateQueries({ queryKey: ["effective-permissions"] });
  };

  const gained = changed.filter((k) => state[k].on).flatMap((k) => toGrants({ [k]: state[k] }).map(grantTitle));
  const lost = changed.filter((k) => !state[k].on).map((k) => permissionInfo[k as Permission]?.title ?? k);
  const term = q.trim().toLowerCase();
  const matching = catalog.data.filter((c) => {
    // Staff-only comments are switched off in the app for now.
    if (c.key === "comment.internal") return false;
    if (!term) return true;
    const info = permissionInfo[c.key];
    return `${info?.title ?? ""} ${info?.help ?? ""} ${c.description} ${c.key}`.toLowerCase().includes(term);
  });

  return (
    <div className="pb-4">
      <div className="mx-6 mt-5 flex gap-3 rounded-[12px] bg-sunken px-5 py-4 text-text-2">
        <Info className="mt-0.5 size-5 shrink-0" aria-hidden />
        <p>
          {group.is_default
            ? t("Every user can do these, in every branch they belong to.")
            : tx("On top of the basics everyone has, for {reach}.", { reach: <b className="text-text">{reach}</b> })}{" "}
          {t("Everyone already creates items, sends them to anyone, works on what's sent to them, and edits or deletes their own while they're open.")}
        </p>
      </div>

      <div className="relative mx-6 mt-5">
        <Search className="pointer-events-none absolute top-1/2 start-3.5 size-4 -translate-y-1/2 text-text-3" aria-hidden />
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("Search permissions, e.g. approve, export")}
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
                return (
                  <li key={c.key} className={cx("flex gap-4 px-6 py-4", isChanged && "bg-warning-soft/60")}>
                    <Switch
                      checked={row.on}
                      disabled={!editable}
                      onChange={(on) => set(c.key, { on, departments: on && perDepartment(c.key) && !row.departments.length ? ["*"] : row.departments })}
                      label={info.title}
                    />
                    <div className="min-w-0 flex-1 space-y-2.5">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[17px] font-semibold">{info.title}</span>
                          {isChanged && <span className="rounded-md bg-warning-soft px-2 text-[13px] font-semibold text-warning">{t("Changed")}</span>}
                        </div>
                        <div className="text-text-2">{info.help || c.description}</div>
                      </div>
                      {row.on && c.per_issue_type && (
                        <select
                          value={kindsValue(row.kinds)}
                          disabled={!editable}
                          onChange={(e) => set(c.key, { kinds: KIND_OPTIONS.find((o) => o.value === e.target.value)?.kinds ?? "all" })}
                          className={cx("h-8 rounded-full border border-input bg-surface px-3 text-[14px]", isChanged && "border-warning-edge")}
                          aria-label={t("Kinds for {name}", { name: info.title })}
                        >
                          {!KIND_OPTIONS.some((o) => o.value === kindsValue(row.kinds)) && (
                            <option value={kindsValue(row.kinds)}>{(row.kinds as IssueType[]).map((k) => typeLabel[k]).join(t(", "))}</option>
                          )}
                          {KIND_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      )}
                      {row.on && perDepartment(c.key) && (
                        <DepartmentChoice value={row.departments} options={departments} disabled={!editable} onChange={(d) => set(c.key, { departments: d })} />
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}

      <details className="mx-6 mt-6 text-text-2">
        <summary className="flex cursor-pointer items-center gap-2 text-[14px]">
          <Lock className="size-4" />{" "}{t("What only admins can do")}
        </summary>
        <p className="mt-2 ps-6 text-[14px]">
          {t("Making permission groups and attaching them to departments · sending to the whole branch · deleting other people's items · cancelling one person's assignment · appointing admins · exporting several branches")}
        </p>
      </details>

      {editable && changed.length > 0 && (
        <div className="sticky bottom-0 mt-6 flex flex-wrap items-center gap-3 border-t border-border bg-surface-2 px-6 py-4 max-md:bottom-[72px]">
          <span>
            {tx("{changes} not saved yet · {affected}", {
              changes: <b className="text-warning">{tn(changed.length, "{n} change", "{n} changes")}</b>,
              affected: t("for {reach}", { reach }),
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
        title={t("Save changes to {name}?", { name: group.is_default ? t("Everyone") : group.name })}
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
          <p className="text-text-2">{t("It applies right away to {reach}.", { reach })}</p>
        </div>
      </Dialog>
    </div>
  );
}

/** Which departments a per-department permission covers: all of them, or
 * the ones named. Names (not ids) so a school-wide group means the same
 * department in every branch. */
function DepartmentChoice({ value, options, disabled, onChange }: { value: string[]; options: string[]; disabled: boolean; onChange: (v: string[]) => void }) {
  const all = value.includes("*");
  const named = value.filter((d) => d !== "*");
  // Names that no department of this branch has (another branch's, or renamed).
  const extra = named.filter((d) => !options.some((o) => o.toLowerCase() === d.toLowerCase()));
  const toggle = (name: string) => {
    const has = named.some((d) => d.toLowerCase() === name.toLowerCase());
    const next = has ? named.filter((d) => d.toLowerCase() !== name.toLowerCase()) : [...named, name];
    onChange(next.length ? next.sort() : ["*"]);
  };
  return (
    <fieldset className="space-y-2" disabled={disabled}>
      <legend className="sr-only">{t("Which departments")}</legend>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={all} onChange={(e) => onChange(e.target.checked ? ["*"] : [])} />
        {t("Every department")}
      </label>
      {!all && (
        <div className="flex flex-wrap gap-2">
          {[...options, ...extra].map((name) => (
            <label key={name} className="inline-flex items-center gap-1.5 rounded-full border border-input px-3 py-1 text-[14px]">
              <input type="checkbox" checked={named.some((d) => d.toLowerCase() === name.toLowerCase())} onChange={() => toggle(name)} />
              {name}
            </label>
          ))}
        </div>
      )}
      {!all && named.length === 0 && <p className="text-[13px] text-warning">{t("Choose at least one department.")}</p>}
    </fieldset>
  );
}

/** One-line summary for the list ("Can approve, manage members"). */
export function summarizeGrants(grants: GrantSpec[] | undefined) {
  if (!grants) return "";
  if (!grants.length) return t("Nothing beyond the basics");
  const words: Partial<Record<Permission, string>> = {
    "work_item.approve": t("approve"),
    "member.manage": t("manage members"),
    "issue.close": t("close items"),
    "export.run": t("export"),
    "work_item.assign": t("assign work"),
    "dashboard.branch": t("see branch numbers"),
    "department.manage": t("run departments"),
    "department.members.manage": t("choose department members"),
  };
  const parts = [...new Set(grants.map((g) => words[g.permission]).filter(Boolean))];
  return parts.length ? t("Can {list}", { list: parts.slice(0, 3).join(t(", ")) }) : tn(grants.length, "{n} permission", "{n} permissions");
}
