import { useEffect } from "react";
import {
  Outlet,
  useNavigate,
  createRootRouteWithContext,
  createRoute,
  createRouter,
  lazyRouteComponent,
  redirect,
} from "@tanstack/react-router";
import type { QueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@/api/client";
import { keys } from "@/api/keys";
import type { IssueState, IssueType, MeResponse } from "@/api/types";
import { AppShell } from "./AppShell";
import { useNewItem, type NewItemOptions } from "./newItemContext";
import { SignedIn } from "./SignedIn";
import { SignInPage, ChangePasswordPage } from "@/features/auth/AuthPages";

type Ctx = { qc: QueryClient };

const root = createRootRouteWithContext<Ctx>()({ component: () => <Outlet /> });

async function loadMe(qc: QueryClient, href: string) {
  try {
    return await qc.ensureQueryData({ queryKey: keys.me, queryFn: () => api.get<MeResponse>("/me") });
  } catch (e) {
    if (e instanceof ApiError && e.code === "password_change_required") throw redirect({ to: "/change-password" });
    if (e instanceof ApiError && (e.status === 401 || e.code === "unauthenticated")) {
      throw redirect({ to: "/sign-in", search: { redirect: href } });
    }
    throw e;
  }
}

const signIn = createRoute({
  getParentRoute: () => root,
  path: "/sign-in",
  validateSearch: (s: Record<string, unknown>): { redirect?: string } => ({ redirect: typeof s.redirect === "string" ? s.redirect : undefined }),
  component: SignInPage,
});

const changePassword = createRoute({
  getParentRoute: () => root,
  path: "/change-password",
  component: ChangePasswordPage,
});

// Signed in, password gate passed.
const authed = createRoute({
  getParentRoute: () => root,
  id: "authed",
  beforeLoad: async ({ context, location }) => {
    const me = await loadMe(context.qc, location.href);
    if (me.user.must_change_password) throw redirect({ to: "/change-password" });
  },
  component: SignedIn,
});

const shell = createRoute({ getParentRoute: () => authed, id: "shell", component: AppShell });

const home = createRoute({
  getParentRoute: () => shell,
  path: "/",
  component: lazyRouteComponent(() => import("@/features/home/HomePage"), "HomePage"),
});
const myWork = createRoute({
  getParentRoute: () => shell,
  path: "/my-work",
  component: lazyRouteComponent(() => import("@/features/work/MyWorkPage"), "MyWorkPage"),
});

export type ItemsSearch = {
  view?: "all" | "mine";
  type?: IssueType;
  state?: IssueState;
  q?: string;
};
const items = createRoute({
  getParentRoute: () => shell,
  path: "/items",
  validateSearch: (s: Record<string, unknown>): ItemsSearch => ({
    view: s.view === "mine" ? "mine" : undefined,
    type: ["ticket", "action", "report", "event"].includes(s.type as string) ? (s.type as IssueType) : undefined,
    state: ["open", "closed", "cancelled"].includes(s.state as string) ? (s.state as IssueState) : undefined,
    q: typeof s.q === "string" && s.q ? s.q : undefined,
  }),
  component: lazyRouteComponent(() => import("@/features/items/ItemsPage"), "ItemsPage"),
});

export type ItemSearch = { review?: string; tab?: "people" | "discussion" | "files" | "history" };
const item = createRoute({
  getParentRoute: () => shell,
  path: "/items/$number",
  validateSearch: (s: Record<string, unknown>): ItemSearch => ({
    review: typeof s.review === "string" ? s.review : undefined,
    tab: ["people", "discussion", "files", "history"].includes(s.tab as string) ? (s.tab as ItemSearch["tab"]) : undefined,
  }),
  component: lazyRouteComponent(() => import("@/features/items/ItemPage"), "ItemPage"),
});

const myAssignment = createRoute({
  getParentRoute: () => shell,
  path: "/items/$number/mine",
  component: lazyRouteComponent(() => import("@/features/work/MyAssignmentPage"), "MyAssignmentPage"),
});

const approvals = createRoute({
  getParentRoute: () => shell,
  path: "/approvals",
  component: lazyRouteComponent(() => import("@/features/work/ApprovalsPage"), "ApprovalsPage"),
});

const calendar = createRoute({
  getParentRoute: () => shell,
  path: "/calendar",
  validateSearch: (s: Record<string, unknown>): { month?: string } => ({
    month: typeof s.month === "string" && /^\d{4}-\d{2}$/.test(s.month) ? s.month : undefined,
  }),
  component: lazyRouteComponent(() => import("@/features/calendar/CalendarPage"), "CalendarPage"),
});

const inbox = createRoute({
  getParentRoute: () => shell,
  path: "/inbox",
  component: lazyRouteComponent(() => import("@/features/inbox/InboxPage"), "InboxPage"),
});

export type PeopleSearch = { tab?: "members"; group?: string; person?: string; branch?: string };
const people = createRoute({
  getParentRoute: () => shell,
  path: "/people",
  validateSearch: (s: Record<string, unknown>): PeopleSearch => ({
    tab: s.tab === "members" ? ("members" as const) : undefined,
    group: typeof s.group === "string" ? s.group : undefined,
    person: typeof s.person === "string" ? s.person : undefined,
    branch: typeof s.branch === "string" ? s.branch : undefined,
  }),
  component: lazyRouteComponent(() => import("@/features/admin/PeoplePage"), "PeoplePage"),
});
const branches = createRoute({
  getParentRoute: () => shell,
  path: "/branches",
  component: lazyRouteComponent(() => import("@/features/admin/BranchesPage"), "BranchesPage"),
});
const exportPage = createRoute({
  getParentRoute: () => shell,
  path: "/export",
  component: lazyRouteComponent(() => import("@/features/admin/ExportPage"), "ExportPage"),
});
const profile = createRoute({
  getParentRoute: () => shell,
  path: "/profile",
  component: lazyRouteComponent(() => import("@/features/profile/ProfilePage"), "ProfilePage"),
});

// /new opens the New item modal over Home (kept so old links still work).
const newItem = createRoute({
  getParentRoute: () => shell,
  path: "/new",
  validateSearch: (s: Record<string, unknown>): NewItemOptions => ({
    type: ["ticket", "action", "report", "event"].includes(s.type as string) ? (s.type as IssueType) : undefined,
    date: typeof s.date === "string" ? s.date : undefined,
    group: typeof s.group === "string" ? s.group : undefined,
  }),
  component: function NewItemRedirect() {
    const search = newItem.useSearch();
    const open = useNewItem();
    const navigate = useNavigate();
    useEffect(() => {
      open(search);
      navigate({ to: "/", replace: true });
    }, [open, navigate, search]);
    return null;
  },
});

const tree = root.addChildren([
  signIn,
  changePassword,
  authed.addChildren([
    shell.addChildren([home, myWork, items, item, myAssignment, approvals, calendar, inbox, people, branches, exportPage, profile, newItem]),
  ]),
]);

export function makeRouter(qc: QueryClient) {
  return createRouter({
    routeTree: tree,
    context: { qc },
    defaultPreload: "intent",
    scrollRestoration: true,
  });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof makeRouter>;
  }
}
