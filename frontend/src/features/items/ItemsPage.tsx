// Items list (UX_SPEC §4.4), with a sidebar of filters that combine: kind,
// status, priority, tags and the days items were created. Export downloads
// exactly what's filtered.
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import * as Popover from "@radix-ui/react-popover";
import { endOfDay, startOfDay } from "date-fns";
import { Check, ChevronDown, Download, SlidersHorizontal, X } from "lucide-react";
import { toast } from "sonner";
import { qs } from "@/api/client";
import { useIssueList, useIssueTags, type IssueFilters } from "@/api/hooks";
import { PRIORITIES, type IssueState, type IssueSummary, type IssueType, type Priority } from "@/api/types";
import { useBranch } from "@/app/BranchContext";
import { useNewItem } from "@/app/newItemContext";
import { PriorityText, ProgressBar, TagList, TypeBadge } from "@/components/badges";
import { DateInput } from "@/components/DateInput";
import { Button, Card, EmptyState, ErrorPanel, Field, Hint, LoadingRows, PageHeader, Tabs, cx, inputClass } from "@/components/ui";
import { hasGrant, isAdminOf, isSuper } from "@/lib/can";
import { timeAgo } from "@/lib/dates";
import { downloadFile, localDay } from "@/lib/download";
import { numberOf } from "@/lib/items";
import { errorMessage, priorityLabel, stateLabel, tagLabel, typeLabel, typePlural } from "@/lib/labels";
import { useViewer } from "@/lib/useViewer";
import type { ItemsSearch } from "@/app/router";
import { num, quote, t, tn } from "@/i18n";

const KINDS: IssueType[] = ["ticket", "action", "event"];
const STATES: IssueState[] = ["open", "closed", "cancelled"];
const split = (v?: string) => (v ? v.split(",").filter(Boolean) : []);
const joined = (v: string[]) => (v.length ? v.join(",") : undefined);

export function ItemsPage() {
  const search = useSearch({ from: "/authed/shell/items" });
  const navigate = useNavigate({ from: "/items" });
  const viewer = useViewer();
  const { branchId, branch, isAll, branchById, options } = useBranch();
  const openNew = useNewItem();
  const [q, setQ] = useState(search.q ?? "");
  const [showFilters, setShowFilters] = useState(false);
  const [exporting, setExporting] = useState(false);
  const set = (patch: Partial<ItemsSearch>) => navigate({ search: (s: ItemsSearch) => ({ ...s, ...patch }), replace: true });

  useEffect(() => setQ(search.q ?? ""), [search.q]);
  useEffect(() => {
    const t = setTimeout(() => {
      if ((search.q ?? "") !== q.trim()) set({ q: q.trim() || undefined });
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const state: IssueState = search.state ?? "open";
  const tags = split(search.tags);
  const priorities = split(search.priority) as Priority[];
  // Whole days in the reader's time; `to` includes its day.
  const from = search.from ? startOfDay(localDay(search.from)).toISOString() : undefined;
  const to = search.to ? endOfDay(localDay(search.to)).toISOString() : undefined;
  const badRange = !!(from && to && to <= from);
  const filters: IssueFilters = {
    branch_id: branchId,
    type: search.type,
    state,
    assignee: search.view === "mine" ? "me" : undefined,
    q: search.q,
    tags: search.tags,
    priority: search.priority,
    from,
    to: badRange ? undefined : to,
  };
  const list = useIssueList(filters, 25);
  const rows = list.data?.pages.flatMap((p) => p.items) ?? [];
  const sideCount = [search.type, search.state, search.from || search.to].filter(Boolean).length + tags.length + priorities.length;
  const filtered = !!(search.q || search.view) || sideCount > 0;
  const clearSide = () => set({ type: undefined, state: undefined, tags: undefined, priority: undefined, from: undefined, to: undefined });

  // Export: the branch on screen, or with all branches, the whole school
  // (root users) or the one branch you may export.
  const superAdmin = isSuper(viewer);
  const exportable = options.filter((o) => superAdmin || isAdminOf(viewer, o.id) || hasGrant(viewer, o.id, "export.run"));
  const exportBranches: string[] | null | undefined = branchId
    ? exportable.some((o) => o.id === branchId)
      ? [branchId]
      : undefined
    : superAdmin
      ? null
      : exportable.length === 1
        ? [exportable[0].id]
        : undefined;
  const canExport = exportable.length > 0;
  const runExport = async () => {
    if (exportBranches === undefined) return;
    setExporting(true);
    try {
      await downloadFile(
        `/api/exports${qs({
          branch_ids: exportBranches?.join(","),
          // Actions come with their written reports.
          types: search.type === "action" ? "action,report" : search.type,
          state,
          priority: search.priority,
          tags: search.tags,
          q: search.q,
          from,
          to: badRange ? undefined : to,
          dates: "created",
        })}`,
        "items.xlsx",
      );
      toast.success(t("Export downloaded"));
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setExporting(false);
    }
  };

  return (
    <div>
      <PageHeader
        title={t("Items")}
        actions={
          canExport && (
            <Hint
              label={exportBranches === undefined ? t("Choose one branch to export its items") : t("Download these items as an Excel file")}
              align="end"
            >
              <Button icon={<Download className="size-4" />} loading={exporting} disabled={exportBranches === undefined} onClick={runExport}>
                {t("Export")}
              </Button>
            </Hint>
          )
        }
      />
      <Tabs
        value={search.view ?? "all"}
        onChange={(v) => set({ view: v === "mine" ? "mine" : undefined })}
        tabs={[
          { value: "all", label: isAll ? t("All my branches") : branch ? t("Whole branch") : t("Whole school") },
          { value: "mine", label: t("Assigned to me") },
        ]}
      />

      <div className="mt-5 lg:grid lg:grid-cols-[260px_minmax(0,1fr)] lg:items-start lg:gap-6">
        <aside className={cx("mb-5 lg:sticky lg:top-4 lg:mb-0 lg:block", !showFilters && "hidden")} aria-label={t("Filters")}>
          <FilterSidebar
            search={search}
            set={set}
            state={state}
            tags={tags}
            priorities={priorities}
            branchId={branchId}
            badRange={badRange}
            count={sideCount}
            onClear={clearSide}
          />
        </aside>

        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <Button className="lg:hidden" icon={<SlidersHorizontal className="size-4" />} aria-expanded={showFilters} onClick={() => setShowFilters((v) => !v)}>
              {sideCount ? t("Filters ({n})", { n: num(sideCount) }) : t("Filters")}
            </Button>
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t("Search titles…")}
              aria-label={t("Search titles")}
              className={cx(inputClass, "h-10 min-w-0 flex-1 py-0")}
            />
            {filtered && (
              <Button variant="link" onClick={() => navigate({ search: {}, replace: true })}>
                {t("Clear filters")}
              </Button>
            )}
          </div>

          <Card className="mt-5 overflow-hidden">
            {list.isLoading ? (
              <LoadingRows rows={6} />
            ) : list.error ? (
              <ErrorPanel error={list.error} onRetry={() => list.refetch()} />
            ) : rows.length === 0 ? (
              search.q ? (
                <EmptyState title={t("No titles match {term}.", { term: quote(search.q) })}>{t("Try a number like ISS-1042.")}</EmptyState>
              ) : filtered ? (
                <EmptyState title={t("Nothing matches these filters.")} action={<Button onClick={() => navigate({ search: {} })}>{t("Clear filters")}</Button>} />
              ) : (
                <EmptyState title={t("No items yet.")} action={<Button variant="primary" onClick={() => openNew()}>{t("New item")}</Button>}>
                  {t("Ask a question, send a task or add an event.")}
                </EmptyState>
              )
            ) : (
              <>
                <div className="hidden grid-cols-[minmax(0,1fr)_220px_100px_110px] gap-4 border-b border-border px-6 py-4 text-[13px] font-semibold tracking-[0.06em] text-text-3 uppercase xl:grid">
                  <span>{t("Item")}</span>
                  <span>{t("Where it stands")}</span>
                  <span>{t("Priority")}</span>
                  <span>{t("Updated")}</span>
                </div>
                <ul className="divide-y divide-border">
                  {rows.map((r) => (
                    <ItemRow key={r.id} item={r} branchName={isAll && r.branch_id ? branchById.get(r.branch_id)?.code : isAll ? t("School-wide") : undefined} />
                  ))}
                </ul>
              </>
            )}
          </Card>

          <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
            <p className="text-text-2">
              {tn(rows.length, "Showing {n} {state} item", "Showing {n} {state} items", { state: stateLabel[state].toLowerCase() })} · {t("a blue dot means something changed since you last looked")}
            </p>
            {list.hasNextPage && (
              <Button onClick={() => list.fetchNextPage()} loading={list.isFetchingNextPage}>
                {t("Load more")}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function FilterSidebar({
  search,
  set,
  state,
  tags,
  priorities,
  branchId,
  badRange,
  count,
  onClear,
}: {
  search: ItemsSearch;
  set: (patch: Partial<ItemsSearch>) => void;
  state: IssueState;
  tags: string[];
  priorities: Priority[];
  branchId?: string;
  badRange: boolean;
  count: number;
  onClear: () => void;
}) {
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  return (
    <Card className="space-y-6 p-5">
      <div className="flex items-center justify-between">
        <h2 className="text-[17px] font-semibold">{t("Filters")}</h2>
        {count > 0 && (
          <Button variant="link" className="text-[14px]" onClick={onClear}>
            {t("Clear all")}
          </Button>
        )}
      </div>

      <FilterGroup legend={t("Kind")}>
        {[undefined, ...KINDS].map((k) => (
          <Option key={k ?? "all"} type="radio" checked={search.type === k} onChange={() => set({ type: k })} tone={k ? `var(--${k})` : undefined}>
            {k ? typePlural[k] : t("All kinds")}
          </Option>
        ))}
      </FilterGroup>

      <FilterGroup legend={t("Status")}>
        {STATES.map((s) => (
          <Option key={s} type="radio" checked={state === s} onChange={() => set({ state: s === "open" ? undefined : s })}>
            {stateLabel[s]}
          </Option>
        ))}
      </FilterGroup>

      <FilterGroup legend={t("Priority")}>
        {[...PRIORITIES].reverse().map((p) => (
          <Option key={p} type="checkbox" checked={priorities.includes(p)} onChange={() => set({ priority: joined(toggle(priorities, p)) })}>
            {priorityLabel[p]}
          </Option>
        ))}
      </FilterGroup>

      <FilterGroup legend={t("Tags")}>
        <TagPicker branchId={branchId} value={tags} onChange={(v) => set({ tags: joined(v) })} />
      </FilterGroup>

      <FilterGroup legend={t("Created")}>
        <div className="space-y-3">
          <Field label={t("From")}>{(p) => <DateInput {...p} mode="date" value={search.from ?? ""} onChange={(v) => set({ from: v || undefined })} />}</Field>
          <Field label={t("To")} error={badRange ? t("The end date must be after the start date.") : undefined}>
            {(p) => <DateInput {...p} mode="date" value={search.to ?? ""} min={search.from} onChange={(v) => set({ to: v || undefined })} />}
          </Field>
          {(search.from || search.to) && (
            <Button variant="link" className="text-[14px]" onClick={() => set({ from: undefined, to: undefined })}>
              {t("Any date")}
            </Button>
          )}
        </div>
      </FilterGroup>
    </Card>
  );
}

function FilterGroup({ legend, children }: { legend: string; children: React.ReactNode }) {
  return (
    <fieldset>
      <legend className="mb-2 text-[13px] font-semibold tracking-[0.06em] text-text-3 uppercase">{legend}</legend>
      <div className="space-y-0.5">{children}</div>
    </fieldset>
  );
}

function Option({
  type,
  checked,
  onChange,
  tone,
  children,
}: {
  type: "radio" | "checkbox";
  checked: boolean;
  onChange: () => void;
  tone?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={cx("flex cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 hover:bg-sunken", checked && "font-semibold")}>
      <input type={type} className="size-4 accent-[var(--primary)]" checked={checked} onChange={onChange} />
      <span style={tone ? { color: tone } : undefined}>{children}</span>
    </label>
  );
}

/** A dropdown of the tags in use, with a search; several can be picked. */
function TagPicker({ branchId, value, onChange }: { branchId?: string; value: string[]; onChange: (v: string[]) => void }) {
  const tags = useIssueTags(branchId);
  const [q, setQ] = useState("");
  const all = useMemo(() => {
    const known = tags.data ?? [];
    // Picked tags stay listed even when no visible item has them now.
    const extra = value.filter((v) => !known.some((k) => k.tag === v)).map((tag) => ({ tag, count: 0 }));
    return [...known, ...extra];
  }, [tags.data, value]);
  const term = q.trim().toLowerCase().replace(/^#/, "");
  const shown = all.filter((x) => !term || x.tag.includes(term) || tagLabel(x.tag).toLowerCase().includes(term));
  const flip = (tag: string) => onChange(value.includes(tag) ? value.filter((v) => v !== tag) : [...value, tag]);
  return (
    <div className="space-y-2">
      <Popover.Root>
        <Popover.Trigger asChild>
          <button type="button" className={cx(inputClass, "flex h-10 items-center justify-between py-0 text-start")}>
            <span className={cx("truncate", !value.length && "text-text-3")}>
              {value.length ? tn(value.length, "{n} tag", "{n} tags") : t("Any tag")}
            </span>
            <ChevronDown className="size-4 shrink-0 text-text-3" aria-hidden />
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            align="start"
            sideOffset={4}
            className="z-[80] w-[var(--radix-popover-trigger-width)] min-w-[240px] rounded-[12px] border border-border bg-surface p-1 shadow-2"
          >
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={t("Search tags…")}
              aria-label={t("Search tags")}
              className={cx(inputClass, "mb-1 h-9 py-0")}
            />
            <ul className="max-h-[280px] overflow-y-auto" role="listbox" aria-multiselectable>
              {tags.isLoading ? (
                <li className="px-3 py-2 text-text-2">{t("Loading…")}</li>
              ) : shown.length === 0 ? (
                <li className="px-3 py-2 text-text-2">{all.length ? t("No tags match.") : t("No items have tags yet.")}</li>
              ) : (
                shown.map((x) => (
                  <li key={x.tag} role="option" aria-selected={value.includes(x.tag)}>
                    <button type="button" onClick={() => flip(x.tag)} className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-start hover:bg-sunken">
                      <span className={cx("flex size-4 items-center justify-center rounded border", value.includes(x.tag) ? "border-primary bg-primary text-on-primary" : "border-input")}>
                        {value.includes(x.tag) && <Check className="size-3" aria-hidden />}
                      </span>
                      <span className="flex-1 truncate">{tagLabel(x.tag)}</span>
                      {x.count > 0 && <span className="text-[13px] text-text-3">{num(x.count)}</span>}
                    </button>
                  </li>
                ))
              )}
            </ul>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((tag) => (
            <span key={tag} className="inline-flex items-center gap-1 rounded-full bg-sunken py-1 ps-2.5 pe-1.5 text-[13px]">
              {tagLabel(tag)}
              <button type="button" onClick={() => flip(tag)} aria-label={t("Remove {name}", { name: tagLabel(tag) })} className="text-text-3 hover:text-danger">
                <X className="size-3.5" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function ItemRow({ item, branchName }: { item: IssueSummary; branchName?: string }) {
  const hasWork = item.work_item_count > 0;
  const total = item.work_item_count;
  const approved = item.done_count;
  return (
    <li>
      <Link
        to="/items/$number"
        params={{ number: numberOf(item.key) }}
        className={cx(
          "grid gap-x-4 gap-y-2 px-4 py-4 hover:bg-surface-2 sm:px-6 xl:grid-cols-[minmax(0,1fr)_220px_100px_110px] xl:items-center",
          item.unread && "bg-[color-mix(in_srgb,var(--warning-soft)_35%,transparent)]",
          item.priority === "critical" && "border-s-[3px] border-danger-solid",
        )}
        aria-label={`${typeLabel[item.type]} ${item.key}${t(", ")}${item.title}${hasWork ? `${t(", ")}${t("{done} of {total} approved", { done: approved, total })}` : ""}${item.unread ? `${t(", ")}${t("unread")}` : ""}`}
      >
        <div className="flex min-w-0 items-center gap-3">
          <span className={cx("size-2.5 shrink-0 rounded-full", item.unread ? "bg-primary" : "bg-transparent")} aria-hidden />
          <TypeBadge type={item.type} />
          <span className="min-w-0">
            <span className={cx("block break-anywhere", item.unread ? "font-bold" : "font-semibold", item.state === "cancelled" && "line-through")}>
              {item.title}
            </span>
            <span className="flex flex-wrap items-center gap-x-2 font-mono text-[14px] text-text-3">
              {item.key}
              {branchName && <span className="font-sans">· {branchName}</span>}
              <span className="font-sans">{t("· by {name}", { name: item.created_by_name })}</span>
              {item.unread && <span className="font-sans">{t("· unread")}</span>}
              <TagList tags={item.tags} className="font-sans" />
            </span>
          </span>
        </div>
        <div className="ps-[22px] xl:ps-0">
          {hasWork ? (
            <>
              <ProgressBar
                p={{ approved, waiting: 0, inProgress: 0, blocked: 0, notStarted: total - approved }}
                className="max-w-[240px]"
              />
              <span className="mt-1 block text-[14px] text-text-2">
                {t("{done} of {total} approved", { done: approved, total })}
                {item.is_overdue && <b className="text-danger">{" "}{t("· overdue")}</b>}
              </span>
            </>
          ) : (
            <span className="text-[14px] text-text-2">{item.state === "open" ? (item.type === "event" ? t("Upcoming") : t("Open")) : stateLabel[item.state]}</span>
          )}
        </div>
        <div className="hidden xl:block">
          <PriorityText priority={item.priority} />
        </div>
        <div className="hidden text-text-2 xl:block">{timeAgo(item.last_activity_at)}</div>
      </Link>
    </li>
  );
}
