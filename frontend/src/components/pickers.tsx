// Choosing people, groups and branches.
import { useMemo, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { Building2, Search, User, Users, X } from "lucide-react";
import type { Group } from "@/api/types";
import type { Person } from "@/people/usePeople";
import { Avatar } from "./badges";
import { cx, inputClass } from "./ui";

export type Recipient =
  | { kind: "user"; id: string; branchId: string; label: string }
  | { kind: "group"; id: string; branchId: string; label: string; count: number }
  | { kind: "branch"; id: string; branchId: string; label: string };

export const recipientKey = (r: Recipient) => `${r.kind}:${r.id}`;

export function RecipientChip({ r, onRemove }: { r: Recipient; onRemove?: () => void }) {
  const Icon = r.kind === "user" ? User : r.kind === "group" ? Users : Building2;
  return (
    <span className="inline-flex h-10 items-center gap-2 rounded-[10px] bg-sunken px-3">
      <Icon className="size-4 text-text-2" aria-hidden />
      <b>{r.label}</b>
      <span className="text-text-3">
        {r.kind === "group" ? `group · ${r.count}` : r.kind === "branch" ? "whole branch" : ""}
      </span>
      {onRemove && (
        <button type="button" onClick={onRemove} aria-label={`Remove ${r.label}`} className="ml-1 text-text-3 hover:text-danger">
          <X className="size-4" />
        </button>
      )}
    </span>
  );
}

/** Text field with chips; typing shows matching people, groups (and branches). */
export function RecipientPicker({
  value,
  onChange,
  people,
  groups,
  branches,
  branchId,
  placeholder = "Add a person or group",
}: {
  value: Recipient[];
  onChange: (v: Recipient[]) => void;
  people: Person[];
  groups: Group[];
  branches?: { id: string; name: string }[];
  branchId: string | null;
  placeholder?: string;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const chosen = new Set(value.map(recipientKey));
  const options = useMemo(() => {
    const term = q.trim().toLowerCase();
    const match = (s: string) => !term || s.toLowerCase().includes(term);
    const out: Recipient[] = [];
    for (const b of branches ?? []) if (match(b.name)) out.push({ kind: "branch", id: b.id, branchId: b.id, label: b.name });
    if (branchId) {
      for (const g of groups)
        if (!g.archived_at && match(g.name))
          out.push({ kind: "group", id: g.id, branchId, label: g.is_default ? "All members" : g.name, count: g.member_count });
      for (const p of people)
        if (p.is_active && match(`${p.first_name} ${p.last_name} ${p.email}`))
          out.push({ kind: "user", id: p.id, branchId, label: `${p.first_name} ${p.last_name}` });
    }
    return out.filter((o) => !chosen.has(recipientKey(o))).slice(0, 40);
  }, [q, people, groups, branches, branchId, chosen]);

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
              if (e.key === "Enter" && options[0]) {
                e.preventDefault();
                onChange([...value, options[0]]);
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
          {options.length === 0 ? (
            <p className="px-3 py-3 text-text-2">No one matches.</p>
          ) : (
            options.map((o) => (
              <button
                key={recipientKey(o)}
                type="button"
                className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left hover:bg-sunken"
                onClick={() => {
                  onChange([...value, o]);
                  setQ("");
                }}
              >
                {o.kind === "user" ? (
                  <Avatar first={o.label.split(" ")[0]} last={o.label.split(" ")[1]} id={o.id} size={28} />
                ) : o.kind === "group" ? (
                  <Users className="size-5 text-text-2" />
                ) : (
                  <Building2 className="size-5 text-text-2" />
                )}
                <span className="flex-1">{o.label}</span>
                <span className="text-[13px] text-text-3">{o.kind === "group" ? `${o.count} people` : o.kind === "branch" ? "Whole branch" : "Person"}</span>
              </button>
            ))
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** Pick one person from a list (assign, appoint admin, check permissions). */
export function PersonSelect({
  people,
  value,
  onChange,
  placeholder = "Search people…",
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
    .sort((a, b) => a.first_name.localeCompare(b.first_name))
    .slice(0, 50);
  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-text-3" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} aria-label={placeholder} className={cx(inputClass, "pl-9")} />
      </div>
      <ul className="max-h-[280px] overflow-y-auto rounded-[10px] border border-border" role="listbox">
        {list.length === 0 && <li className="px-3 py-3 text-text-2">No one matches “{q}”.</li>}
        {list.map((p) => (
          <li key={p.id} role="option" aria-selected={value === p.id}>
            <button
              type="button"
              onClick={() => onChange(p.id)}
              className={cx("flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-sunken", value === p.id && "bg-primary-soft")}
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
