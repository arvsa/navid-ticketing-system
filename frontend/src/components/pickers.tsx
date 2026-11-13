// Choosing people, groups and branches.
import { useEffect, useMemo, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { useQueries } from "@tanstack/react-query";
import { toast } from "sonner";
import { Building2, ChevronDown, Search, User, Users, X } from "lucide-react";
import { getAll } from "@/api/client";
import { keys } from "@/api/keys";
import type { BranchGroup, BranchPerson, Group, Member } from "@/api/types";
import type { Person } from "@/people/usePeople";
import { Avatar } from "./badges";
import { cx, inputClass } from "./ui";
import { localeTag, num, quote, t } from "@/i18n";

export type Recipient =
  /** `note`: the person's or group's branch, when it's another branch. */
  | { kind: "user"; id: string; branchId: string; label: string; note?: string }
  /** `whole`: the branch's All members group. */
  | { kind: "group"; id: string; branchId: string; label: string; count: number; note?: string; whole?: boolean }
  | { kind: "branch"; id: string; branchId: string; label: string };

// With the branch: on a school-wide item someone in two branches can be picked in either.
export const recipientKey = (r: Recipient) => `${r.kind}:${r.id}:${r.branchId}`;

/** Which picked people are already reached through a picked branch or group.
 * Group members are fetched; a group we can't list covers no one. */
function useCovered(value: Recipient[]) {
  const groups = value.filter((r): r is Extract<Recipient, { kind: "group" }> => r.kind === "group" && !r.whole);
  const members = useQueries({
    queries: groups.map((g) => {
      const extra = { include_left: false, group_id: g.id };
      return {
        queryKey: keys.members(g.branchId, extra),
        queryFn: () => getAll<Member>(`/branches/${g.branchId}/members`, { group_id: g.id }),
        staleTime: 5 * 60_000,
        retry: false,
      };
    }),
  });
  const wholeBranches = new Set(value.filter((r) => r.kind === "branch" || (r.kind === "group" && r.whole)).map((r) => r.branchId));
  const inGroups = new Set<string>();
  members.forEach((m, i) => m.data?.forEach((x) => inGroups.add(`${x.user_id}:${groups[i].branchId}`)));
  return (r: Recipient) => r.kind === "user" && (wholeBranches.has(r.branchId) || inGroups.has(`${r.id}:${r.branchId}`));
}

export function RecipientChip({ r, onRemove }: { r: Recipient; onRemove?: () => void }) {
  const Icon = r.kind === "user" ? User : r.kind === "group" ? Users : Building2;
  return (
    <span className="inline-flex h-10 items-center gap-2 rounded-[10px] bg-sunken px-3">
      <Icon className="size-4 text-text-2" aria-hidden />
      <b>{r.label}</b>
      <span className="text-text-3">
        {r.kind === "group" ? [t("group · {n}", { n: r.count }), r.note].filter(Boolean).join(" · ") : r.kind === "branch" ? t("whole branch") : (r.note ?? "")}
      </span>
      {onRemove && (
        <button type="button" onClick={onRemove} aria-label={t("Remove {name}", { name: r.label })} className="ms-1 text-text-3 hover:text-danger">
          <X className="size-4" />
        </button>
      )}
    </span>
  );
}

/** Text field with chips; typing shows matching people, groups (and branches).
 * `crossPeople` and `crossGroups` are people and groups of other branches
 * (labelled with their branch); `branchId` null is a school-wide item, which
 * also takes whole `branches`. */
export function RecipientPicker({
  value,
  onChange,
  people,
  groups,
  branches,
  crossPeople,
  crossGroups,
  branchId,
  branchName,
  placeholder = t("Add a person or group"),
}: {
  value: Recipient[];
  onChange: (v: Recipient[]) => void;
  people: Person[];
  groups: Group[];
  branches?: { id: string; name: string }[];
  crossPeople?: BranchPerson[];
  crossGroups?: BranchGroup[];
  branchId: string | null;
  /** The item's own branch, to head its section when other branches show. */
  branchName?: string;
  placeholder?: string;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  // Other branches start folded, this one open; searching opens them all.
  const [toggled, setToggled] = useState<Set<string>>(new Set());
  const chosen = new Set(value.map(recipientKey));
  const covered = useCovered(value);
  // Someone already reached through a picked branch or group is dropped.
  const redundant = value.filter(covered);
  const redundantKey = redundant.map(recipientKey).join(",");
  useEffect(() => {
    if (!redundant.length) return;
    onChange(value.filter((r) => !covered(r)));
    toast.info(
      t("Removed {names}: already included through a group or branch.", { names: redundant.map((r) => r.label).join(t(", ")) }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [redundantKey]);
  const options = useMemo(() => {
    const term = q.trim().toLowerCase();
    const match = (s: string) => !term || s.toLowerCase().includes(term);
    const out: Recipient[] = [];
    for (const b of branches ?? []) if (match(b.name)) out.push({ kind: "branch", id: b.id, branchId: b.id, label: b.name });
    if (branchId) {
      for (const g of groups)
        if (!g.archived_at && match(g.name))
          out.push({ kind: "group", id: g.id, branchId, label: g.is_default ? t("All members") : g.name, count: g.member_count, whole: g.is_default });
      for (const p of people)
        if (p.is_active && match(`${p.first_name} ${p.last_name} ${p.email}`))
          out.push({ kind: "user", id: p.id, branchId, label: `${p.first_name} ${p.last_name}` });
    }
    // Other branches: groups first (like "IT"), then people.
    for (const g of crossGroups ?? [])
      if (g.branch_id !== branchId && match(`${g.name} ${g.branch_name}`))
        out.push({ kind: "group", id: g.id, branchId: g.branch_id, label: g.name, count: g.member_count, note: g.branch_name });
    for (const p of crossPeople ?? [])
      if (p.branch_id !== branchId && match(`${p.first_name} ${p.last_name} ${p.branch_name}`))
        out.push({ kind: "user", id: p.user_id, branchId: p.branch_id, label: `${p.first_name} ${p.last_name}`, note: p.branch_name });
    return out.filter((o) => !chosen.has(recipientKey(o)) && !covered(o));
  }, [q, people, groups, branches, crossPeople, crossGroups, branchId, chosen, covered]);

  // One section per branch: the branch itself (when it can be picked
  // whole), then its groups, then its people. This branch comes first.
  const sections = useMemo(() => {
    const names = new Map<string, string>();
    if (branchId && branchName) names.set(branchId, branchName);
    for (const b of branches ?? []) names.set(b.id, b.name);
    for (const g of crossGroups ?? []) names.set(g.branch_id, g.branch_name);
    for (const p of crossPeople ?? []) names.set(p.branch_id, p.branch_name);
    const byBranch = new Map<string, { id: string; name: string; head?: Recipient; items: Recipient[] }>();
    for (const o of options) {
      const s = byBranch.get(o.branchId) ?? { id: o.branchId, name: names.get(o.branchId) ?? "", items: [] };
      if (o.kind === "branch") s.head = o;
      else s.items.push(o);
      byBranch.set(o.branchId, s);
    }
    const rank = (r: Recipient) => (r.kind === "group" ? 0 : 1);
    return [...byBranch.values()]
      .map((s) => ({ ...s, items: s.items.sort((a, b) => rank(a) - rank(b)).slice(0, 25) }))
      .sort((a, b) => Number(b.id === branchId) - Number(a.id === branchId) || a.name.localeCompare(b.name, localeTag));
  }, [options, branches, crossGroups, crossPeople, branchId, branchName]);
  // Just this branch's people and groups: no headings needed.
  const plain = sections.length === 1 && sections[0].id === branchId && !sections[0].head;
  const isOpen = (id: string) => plain || !!q.trim() || (id === branchId) !== toggled.has(id);
  const toggle = (id: string) =>
    setToggled((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const flat = sections.flatMap((s) => [...(s.head ? [s.head] : []), ...(isOpen(s.id) ? s.items : [])]);

  const pick = (o: Recipient) => {
    onChange([...value, o]);
    setQ("");
  };

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Anchor asChild>
        <div
          className="flex min-h-[60px] flex-wrap items-center gap-2 rounded-[12px] border border-input bg-surface px-2.5 py-2 focus-within:border-primary"
          onClick={() => setOpen(true)}
        >
          {value.map((r) => (
            <RecipientChip key={recipientKey(r)} r={r} onRemove={() => onChange(value.filter((x) => recipientKey(x) !== recipientKey(r)))} />
          ))}
          <input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={(e) => {
              if (e.key === "Backspace" && !q && value.length) onChange(value.slice(0, -1));
              if (e.key === "Enter" && flat[0]) {
                e.preventDefault();
                onChange([...value, flat[0]]);
                setQ("");
              }
            }}
            placeholder={value.length ? "" : placeholder}
            aria-label={placeholder}
            className="h-10 min-w-[160px] flex-1 bg-transparent px-2 outline-none placeholder:text-text-3"
          />
        </div>
      </Popover.Anchor>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={4}
          onOpenAutoFocus={(e) => e.preventDefault()}
          className="z-[80] max-h-[320px] w-[var(--radix-popover-trigger-width)] min-w-[280px] overflow-y-auto rounded-[12px] border border-border bg-surface p-1 shadow-2"
        >
          {flat.length === 0 ? (
            <p className="px-3 py-3 text-text-2">{t("No one matches.")}</p>
          ) : (
            sections.map((sec) => (
              <div key={sec.id} role="group" aria-label={sec.name} className="py-0.5">
                {plain ? null : sec.head ? (
                  <div className="flex items-center">
                    <div className="min-w-0 flex-1">
                      <OptionRow o={sec.head} onPick={pick} />
                    </div>
                    {sec.items.length > 0 && <FoldButton open={isOpen(sec.id)} name={sec.name} onToggle={() => toggle(sec.id)} />}
                  </div>
                ) : (
                  <button
                    type="button"
                    aria-expanded={isOpen(sec.id)}
                    onClick={() => toggle(sec.id)}
                    className="flex w-full items-center gap-3 rounded-md px-3 pt-2 pb-1 text-start text-[13px] font-semibold text-text-3 hover:text-text-2"
                  >
                    <Building2 className="size-4" aria-hidden />
                    <span className="flex-1">{sec.name}</span>
                    <span className="font-normal">{num(sec.items.length)}</span>
                    <ChevronDown className={cx("size-4 transition-transform", !isOpen(sec.id) && "rtl:rotate-90 ltr:-rotate-90")} aria-hidden />
                  </button>
                )}
                {isOpen(sec.id) && (
                  <div className={cx(!plain && "ms-5 border-s border-border ps-1")}>
                    {sec.items.map((o) => (
                      <OptionRow key={recipientKey(o)} o={o} onPick={pick} />
                    ))}
                  </div>
                )}
              </div>
            ))
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function FoldButton({ open, name, onToggle }: { open: boolean; name: string; onToggle: () => void }) {
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-label={open ? t("Hide {name}", { name }) : t("Show {name}", { name })}
      onClick={onToggle}
      className="rounded-md p-2 text-text-3 hover:bg-sunken hover:text-text-2"
    >
      <ChevronDown className={cx("size-4 transition-transform", !open && "rtl:rotate-90 ltr:-rotate-90")} aria-hidden />
    </button>
  );
}

function OptionRow({ o, onPick }: { o: Recipient; onPick: (o: Recipient) => void }) {
  return (
    <button type="button" className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-start hover:bg-sunken" onClick={() => onPick(o)}>
      {o.kind === "user" ? (
        <Avatar first={o.label.split(" ")[0]} last={o.label.split(" ")[1]} id={o.id} size={28} />
      ) : o.kind === "group" ? (
        <Users className="size-5 text-text-2" />
      ) : (
        <Building2 className="size-5 text-text-2" />
      )}
      <span className={cx("flex-1", o.kind === "branch" && "font-semibold")}>{o.label}</span>
      <span className="text-[13px] text-text-3">{o.kind === "group" ? t("{n} people", { n: o.count }) : o.kind === "branch" ? t("Whole branch") : t("Person")}</span>
    </button>
  );
}

/** Pick one person from a list (assign, appoint admin, check permissions). */
export function PersonSelect({
  people,
  value,
  onChange,
  placeholder = t("Search people…"),
  exclude = [],
}: {
  people: Person[];
  value?: string | null;
  onChange: (id: string) => void;
  placeholder?: string;
  exclude?: string[];
}) {
  const [q, setQ] = useState("");
  const term = q.trim().toLowerCase();
  const list = people
    .filter((p) => p.is_active && !exclude.includes(p.id))
    .filter((p) => !term || `${p.first_name} ${p.last_name} ${p.email}`.toLowerCase().includes(term))
    .sort((a, b) => a.first_name.localeCompare(b.first_name, localeTag))
    .slice(0, 50);
  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 start-3 size-4 -translate-y-1/2 text-text-3" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} aria-label={placeholder} className={cx(inputClass, "ps-9")} />
      </div>
      <ul className="max-h-[280px] overflow-y-auto rounded-[10px] border border-border" role="listbox">
        {list.length === 0 && <li className="px-3 py-3 text-text-2">{t("No one matches {q}.", { q: quote(q) })}</li>}
        {list.map((p) => (
          <li key={p.id} role="option" aria-selected={value === p.id}>
            <button
              type="button"
              onClick={() => onChange(p.id)}
              className={cx("flex w-full items-center gap-3 px-3 py-2 text-start hover:bg-sunken", value === p.id && "bg-primary-soft")}
            >
              <Avatar first={p.first_name} last={p.last_name} id={p.id} size={28} />
              <span className="min-w-0 flex-1">
                <span className="block">
                  {p.first_name} {p.last_name}
                </span>
                <span className="block truncate text-[13px] text-text-3">{p.email}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Pick several people from a list (adding people to a group). */
export function PeopleChecklist({
  people,
  value,
  onChange,
  exclude = [],
}: {
  people: Person[];
  value: string[];
  onChange: (ids: string[]) => void;
  exclude?: string[];
}) {
  const [q, setQ] = useState("");
  const term = q.trim().toLowerCase();
  const list = people
    .filter((p) => p.is_active && !exclude.includes(p.id))
    .filter((p) => !term || `${p.first_name} ${p.last_name} ${p.email}`.toLowerCase().includes(term))
    .sort((a, b) => a.first_name.localeCompare(b.first_name, localeTag));
  const flip = (id: string) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  const allShown = list.length > 0 && list.every((p) => value.includes(p.id));
  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 start-3 size-4 -translate-y-1/2 text-text-3" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Search people…")} aria-label={t("Search people…")} className={cx(inputClass, "ps-9")} />
      </div>
      {list.length > 1 && (
        <label className="flex items-center gap-3 px-3 text-[14px] text-text-2">
          <input
            type="checkbox"
            className="size-4"
            checked={allShown}
            onChange={() => onChange(allShown ? value.filter((id) => !list.some((p) => p.id === id)) : [...new Set([...value, ...list.map((p) => p.id)])])}
          />
          {term ? t("Select everyone shown ({n})", { n: list.length }) : t("Select everyone ({n})", { n: list.length })}
        </label>
      )}
      <ul className="max-h-[280px] overflow-y-auto rounded-[10px] border border-border">
        {list.length === 0 && <li className="px-3 py-3 text-text-2">{q ? t("No one matches {q}.", { q: quote(q) }) : t("Everyone here is in it already.")}</li>}
        {list.map((p) => (
          <li key={p.id}>
            <label className={cx("flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-sunken", value.includes(p.id) && "bg-primary-soft")}>
              <input type="checkbox" className="size-4" checked={value.includes(p.id)} onChange={() => flip(p.id)} />
              <Avatar first={p.first_name} last={p.last_name} id={p.id} size={28} />
              <span className="min-w-0 flex-1">
                <span className="block">
                  {p.first_name} {p.last_name}
                </span>
                <span className="block truncate text-[13px] text-text-3">{p.email}</span>
              </span>
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}
