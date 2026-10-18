// Items list (UX_SPEC §4.4). The API filters by one kind, one state, "assigned
// to me" and title search only (gap G-6), so those are the filters offered.
import { useEffect, useState } from "react";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { Download, Lock } from "lucide-react";
import { useIssueList, type IssueFilters } from "@/api/hooks";
import type { IssueState, IssueSummary, IssueType } from "@/api/types";
import { useBranch } from "@/app/BranchContext";
import { useNewItem } from "@/app/newItemContext";
import { PriorityText, ProgressBar, TypeBadge } from "@/components/badges";
import { Button, Card, Chip, EmptyState, ErrorPanel, LoadingRows, PageHeader, Tabs, cx, inputClass } from "@/components/ui";
import { timeAgo } from "@/lib/dates";
import { numberOf } from "@/lib/items";
import { stateLabel, typePlural } from "@/lib/labels";
import type { ItemsSearch } from "@/app/router";

const KINDS: IssueType[] = ["ticket", "action", "report", "event"];

export function ItemsPage() {
  const search = useSearch({ from: "/authed/shell/items" });
  const navigate = useNavigate({ from: "/items" });
  const { branchId, branch, isAll, branchById } = useBranch();
  const openNew = useNewItem();
  const [q, setQ] = useState(search.q ?? "");
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
  const filters: IssueFilters = {
    branch_id: branchId,
    type: search.type,
    state,
    assignee: search.view === "mine" ? "me" : undefined,
    q: search.q,
  };
  const list = useIssueList(filters, 25);
  const rows = list.data?.pages.flatMap((p) => p.items) ?? [];
  const filtered = !!(search.type || search.q || search.state || search.view);

  return (
    <div>
      <PageHeader
        title="Items"
        actions={
          <Link to="/export">
            <Button size="lg" icon={<Download className="size-5" />}>
              Export to Excel
            </Button>
          </Link>
        }
      />
      <Tabs
        value={search.view ?? "all"}
        onChange={(v) => set({ view: v === "mine" ? "mine" : undefined })}
        tabs={[
          { value: "all", label: isAll ? "All my branches" : `Whole ${branch ? "branch" : "school"}` },
          { value: "mine", label: "Assigned to me" },
        ]}
      />

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <div className="flex gap-2 overflow-x-auto scrollbar-none">
          <Chip active={!search.type} onClick={() => set({ type: undefined })}>
            All kinds
          </Chip>
          {KINDS.map((k) => (
            <Chip key={k} active={search.type === k} onClick={() => set({ type: search.type === k ? undefined : k })} tone={`var(--${k})`}>
              {typePlural[k]}
            </Chip>
          ))}
        </div>
        <span className="hidden h-8 w-px bg-border sm:block" aria-hidden />
        <label className="flex items-center gap-2">
          <span className="sr-only">Status</span>
          <select
            value={state}
            onChange={(e) => set({ state: e.target.value === "open" ? undefined : (e.target.value as IssueState) })}
            className={cx(inputClass, "h-10 w-auto py-0 pr-8")}
          >
            {(["open", "closed", "cancelled"] as IssueState[]).map((s) => (
              <option key={s} value={s}>
                Status: {stateLabel[s]}
              </option>
            ))}
          </select>
        </label>
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search titles…"
          aria-label="Search titles"
          className={cx(inputClass, "h-10 w-full py-0 sm:w-64")}
        />
        {filtered && (
          <Button variant="link" onClick={() => navigate({ search: {}, replace: true })}>
            Clear filters
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
            <EmptyState title={`No titles match “${search.q}”.`}>Try a number like ISS-1042.</EmptyState>
          ) : filtered ? (
            <EmptyState title="Nothing matches these filters." action={<Button onClick={() => navigate({ search: {} })}>Clear filters</Button>} />
          ) : (
            <EmptyState title="No items yet." action={<Button variant="primary" onClick={() => openNew()}>New item</Button>}>
              Ask a question, send a task or add an event.
            </EmptyState>
          )
        ) : (
          <>
            <div className="hidden grid-cols-[minmax(0,1fr)_260px_110px_130px] gap-4 border-b border-border px-6 py-4 text-[13px] font-semibold tracking-[0.06em] text-text-3 uppercase lg:grid">
              <span>Item</span>
              <span>Where it stands</span>
              <span>Priority</span>
              <span>Updated</span>
            </div>
            <ul className="divide-y divide-border">
              {rows.map((r) => (
                <ItemRow key={r.id} item={r} branchName={isAll && r.branch_id ? branchById.get(r.branch_id)?.code : isAll ? "School-wide" : undefined} />
              ))}
            </ul>
          </>
        )}
      </Card>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <p className="text-text-2">
          Showing {rows.length} {stateLabel[state].toLowerCase()} item{rows.length === 1 ? "" : "s"} · a blue dot means something changed since you last looked
        </p>
        {list.hasNextPage && (
          <Button onClick={() => list.fetchNextPage()} loading={list.isFetchingNextPage}>
            Load more
          </Button>
        )}
      </div>
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
          "grid gap-x-4 gap-y-2 px-4 py-4 hover:bg-surface-2 sm:px-6 lg:grid-cols-[minmax(0,1fr)_260px_110px_130px] lg:items-center",
          item.unread && "bg-[color-mix(in_srgb,var(--warning-soft)_35%,transparent)]",
          item.priority === "critical" && "border-l-[3px] border-danger-solid",
        )}
        aria-label={`${item.type} ${item.key}, ${item.title}${hasWork ? `, ${approved} of ${total} approved` : ""}${item.unread ? ", unread" : ""}`}
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
              {item.unread && <span className="font-sans">· unread</span>}
              {item.is_private && (
                <span className="inline-flex items-center gap-1 font-sans">
                  · <Lock className="size-3.5" aria-hidden /> Private
                </span>
              )}
            </span>
          </span>
        </div>
        <div className="pl-[22px] lg:pl-0">
          {hasWork ? (
            <>
              <ProgressBar
                p={{ approved, waiting: 0, inProgress: 0, blocked: 0, notStarted: total - approved }}
                className="max-w-[240px]"
              />
              <span className="mt-1 block text-[14px] text-text-2">
                {approved} of {total} approved
                {item.is_overdue && <b className="text-danger"> · overdue</b>}
              </span>
            </>
          ) : (
            <span className="text-[14px] text-text-2">{item.state === "open" ? (item.type === "event" ? "Upcoming" : "Open") : stateLabel[item.state]}</span>
          )}
        </div>
        <div className="hidden lg:block">
          <PriorityText priority={item.priority} />
        </div>
        <div className="hidden text-text-2 lg:block">{timeAgo(item.last_activity_at)}</div>
      </Link>
    </li>
  );
}
