// Data hooks, grouped by API area.
import {
  useInfiniteQuery,
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { api, getAll } from "./client";
import { keys } from "./keys";
import type {
  Branch,
  CalendarEntry,
  CatalogEntry,
  Comment,
  Dashboard,
  EffectivePermissions,
  Group,
  GroupGrant,
  HistoryEntry,
  IssueDetail,
  IssueState,
  IssueSummary,
  IssueType,
  Member,
  Notification,
  Page,
  Report,
  RsvpPage,
  RsvpResponse,
  Transition,
  WorkItem,
  WorkStatus,
} from "./types";

// ---------- branches, people, groups ----------

export function useBranches(enabled = true) {
  return useQuery({
    queryKey: keys.branches,
    queryFn: () => getAll<Branch>("/branches"),
    staleTime: 5 * 60_000,
    enabled,
  });
}

export function useMembers(branchId: string | undefined, opts: { includeLeft?: boolean; groupId?: string } = {}) {
  const extra = { include_left: opts.includeLeft ?? false, group_id: opts.groupId };
  return useQuery({
    queryKey: keys.members(branchId ?? "", extra),
    queryFn: () =>
      getAll<Member>(`/branches/${branchId}/members`, {
        include_left: opts.includeLeft || undefined,
        group_id: opts.groupId,
      }),
    enabled: !!branchId,
    staleTime: 5 * 60_000,
  });
}

export function useGroups(branchId: string | undefined, includeArchived = false) {
  return useQuery({
    queryKey: keys.groups(branchId ?? "", { include_archived: includeArchived }),
    queryFn: () =>
      getAll<Group>(`/branches/${branchId}/groups`, { include_archived: includeArchived || undefined }),
    enabled: !!branchId,
    staleTime: 60_000,
  });
}

export function useEffectivePermissions(branchId?: string, userId?: string) {
  return useQuery({
    queryKey: keys.effective(branchId ?? "", userId ?? ""),
    queryFn: () =>
      api.get<EffectivePermissions>(`/branches/${branchId}/members/${userId}/effective-permissions`),
    enabled: !!branchId && !!userId,
  });
}

export function useCatalog() {
  return useQuery({
    queryKey: keys.catalog,
    queryFn: () => api.get<CatalogEntry[]>("/permissions"),
    staleTime: 5 * 60_000,
  });
}

export function useGroupGrants(groupId?: string) {
  return useQuery({
    queryKey: keys.groupGrants(groupId ?? ""),
    queryFn: () => getAll<GroupGrant>(`/groups/${groupId}/permissions`),
    enabled: !!groupId,
  });
}

// ---------- issues ----------

export type IssueFilters = {
  branch_id?: string;
  type?: IssueType;
  state?: IssueState;
  assignee?: "me";
  q?: string;
};

export function useIssueList(filters: IssueFilters, limit = 25) {
  return useInfiniteQuery({
    queryKey: keys.issueList({ ...filters, limit }),
    queryFn: ({ pageParam, signal }) =>
      api.get<Page<IssueSummary>>("/issues", { ...filters, limit, after: pageParam }, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  });
}

export function useIssue(id: string | undefined) {
  return useQuery({
    queryKey: keys.issue(id ?? ""),
    queryFn: () => api.get<IssueDetail>(`/issues/${id}`),
    enabled: !!id,
  });
}

export function useIssueByNumber(n: number) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: keys.issueByNumber(n),
    queryFn: async () => {
      const issue = await api.get<IssueDetail>(`/issues/by-number/${n}`);
      qc.setQueryData(keys.issue(issue.id), issue);
      return issue.id;
    },
    retry: false,
    staleTime: Infinity,
  });
}

/** Issue details for a set of ids (gap G-1: work items carry no title). */
export function useIssuesById(ids: string[]) {
  const unique = [...new Set(ids)];
  const results = useQueries({
    queries: unique.map((id) => ({
      queryKey: keys.issue(id),
      queryFn: () => api.get<IssueDetail>(`/issues/${id}`),
      staleTime: 60_000,
    })),
  });
  const map = new Map<string, IssueDetail>();
  results.forEach((r) => r.data && map.set(r.data.id, r.data));
  return { map, isLoading: results.some((r) => r.isLoading) };
}

export function setIssue(qc: QueryClient, issue: IssueDetail) {
  qc.setQueryData(keys.issue(issue.id), issue);
  qc.invalidateQueries({ queryKey: ["issues", "list"] });
  qc.invalidateQueries({ queryKey: keys.workItems });
  qc.invalidateQueries({ queryKey: ["dashboard"] });
}

export function useComments(issueId: string | undefined, workItemId?: string) {
  return useQuery({
    queryKey: keys.comments(issueId ?? "", workItemId),
    queryFn: () => getAll<Comment>(`/issues/${issueId}/comments`, { work_item_id: workItemId }),
    enabled: !!issueId,
  });
}

export function useReports(issueId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: keys.reports(issueId ?? ""),
    queryFn: () => getAll<Report>(`/issues/${issueId}/reports`),
    enabled: !!issueId && enabled,
  });
}

export function useHistory(issueId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: keys.history(issueId ?? ""),
    queryFn: () => getAll<HistoryEntry>(`/issues/${issueId}/history`),
    enabled: !!issueId && enabled,
  });
}

export function useRsvps(issueId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: keys.rsvps(issueId ?? ""),
    queryFn: async () => {
      const first = await api.get<RsvpPage>(`/events/${issueId}/rsvps`, { limit: 200 });
      let after = first.next_cursor;
      const items = [...first.items];
      while (after) {
        const page = await api.get<RsvpPage>(`/events/${issueId}/rsvps`, { limit: 200, after });
        items.push(...page.items);
        after = page.next_cursor;
      }
      return { ...first, items };
    },
    enabled: !!issueId && enabled,
  });
}

export function useRsvp(issueId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { response: RsvpResponse; note?: string | null }) =>
      api.put(`/events/${issueId}/rsvp`, v),
    onMutate: async (v) => {
      const key = keys.issue(issueId);
      await qc.cancelQueries({ queryKey: key });
      const prev = qc.getQueryData<IssueDetail>(key);
      if (prev?.event) {
        const counts = { ...prev.event.rsvp_counts };
        const old = prev.event.my_rsvp ?? "pending";
        counts[old] = Math.max(0, counts[old] - 1);
        counts[v.response] += 1;
        qc.setQueryData<IssueDetail>(key, {
          ...prev,
          event: { ...prev.event, my_rsvp: v.response, rsvp_counts: counts },
        });
      }
      return { prev };
    },
    onError: (_e, _v, ctx) => ctx?.prev && qc.setQueryData(keys.issue(issueId), ctx.prev),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: keys.issue(issueId) });
      qc.invalidateQueries({ queryKey: keys.rsvps(issueId) });
      qc.invalidateQueries({ queryKey: ["calendar"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

// ---------- work items ----------

export type WorkFilters = { assignee?: "me"; status?: WorkStatus; branch_id?: string };

export function useWorkItems(filters: WorkFilters, enabled = true) {
  return useQuery({
    queryKey: keys.workItemList(filters),
    queryFn: () => getAll<WorkItem>("/work-items", filters, 1000),
    enabled,
  });
}

export function useTransition() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: {
      item: WorkItem;
      transition: Transition;
      note?: string | null;
      assignee_id?: string | null;
    }) =>
      api.post<WorkItem>(`/work-items/${v.item.id}/${v.transition}`, {
        version: v.item.version,
        note: v.note || undefined,
        assignee_id: v.assignee_id || undefined,
      }),
    onSettled: (_d, _e, v) => {
      qc.invalidateQueries({ queryKey: keys.issue(v.item.issue_id) });
      qc.invalidateQueries({ queryKey: keys.workItems });
      qc.invalidateQueries({ queryKey: ["issues", "list"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: keys.history(v.item.issue_id) });
    },
  });
}

// ---------- calendar ----------

export function useCalendar(from: string, to: string, branchId?: string) {
  return useQuery({
    queryKey: keys.calendar(from, to, branchId),
    queryFn: () => getAll<CalendarEntry>("/calendar", { from, to, branch_id: branchId }),
  });
}

// ---------- notifications & dashboard ----------

export function useUnreadCount() {
  return useQuery({
    queryKey: keys.unread,
    queryFn: () => api.get<{ count: number }>("/notifications/unread-count"),
    select: (d) => d.count,
  });
}

export function useNotifications(unread: boolean, limit = 30) {
  return useInfiniteQuery({
    queryKey: keys.notifications({ unread, limit }),
    queryFn: ({ pageParam }) =>
      api.get<Page<Notification>>("/notifications", { unread: unread || undefined, limit, after: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  });
}

export function useMarkRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number | "all") =>
      id === "all" ? api.post("/notifications/read-all") : api.post(`/notifications/${id}/read`),
    onMutate: (id) => {
      qc.setQueriesData<{ pages: Page<Notification>[] }>({ queryKey: ["notifications"] }, (old) => {
        if (!old?.pages) return old;
        return {
          ...old,
          pages: old.pages.map((p) => ({
            ...p,
            items: p.items.map((n) =>
              id === "all" || n.id === id ? { ...n, read_at: n.read_at ?? new Date().toISOString() } : n,
            ),
          })),
        };
      });
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["notifications"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

export function useDashboard(branchId?: string) {
  return useQuery({
    queryKey: keys.dashboard(branchId),
    queryFn: () => api.get<Dashboard>("/dashboard", { branch_id: branchId }),
  });
}
