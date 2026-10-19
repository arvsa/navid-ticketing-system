// A floating top bar with pill navigation (desktop) and a bottom bar (phones).
// Search, New item and the bell all open in place, so you rarely leave the page.
import { useEffect, useState, type ReactNode } from "react";
import { Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import * as Popover from "@radix-ui/react-popover";
import {
  Bell,
  Calendar,
  Check,
  ChevronDown,
  Download,
  Home,
  Inbox,
  Languages,
  List,
  ListChecks,
  LogOut,
  Monitor,
  Moon,
  Plus,
  Search,
  Shield,
  Sun,
  User,
  Users,
} from "lucide-react";
import { useDashboard, useIssueList, useNotifications, useUnreadCount, useMarkRead } from "@/api/hooks";
import { useLogout, useSession } from "@/auth/session";
import { Avatar, TypeBadge } from "@/components/badges";
import { Drawer, Menu, MenuItem, MenuLabel, MenuSeparator, cx } from "@/components/ui";
import { hasGrant, hasGrantAnywhere, isAdminOf, isSuper } from "@/lib/can";
import { APP_NAME } from "@/lib/labels";
import { describeNotification } from "@/lib/notifications";
import { timeAgo } from "@/lib/dates";
import { numberOf } from "@/lib/items";
import { useLiveStatus } from "@/realtime/live";
import { usePeople, shortName } from "@/people/usePeople";
import { useBranch } from "./BranchContext";
import { NewItemProvider } from "./NewItem";
import { useNewItem } from "./newItemContext";
import { setTheme, getTheme, type Theme } from "./theme";
import { lang, num, quote, setLang, t } from "@/i18n";

type NavEntry = { to: string; label: string; icon: ReactNode; count?: number | null; exact?: boolean };

function useNav() {
  const me = useSession();
  const v = { me };
  const { branchId, branch, isAll } = useBranch();
  const dash = useDashboard(branchId);
  const mine = dash.data?.mine;
  const pendingRsvps = mine?.upcoming_events.filter((e) => e.my_rsvp === "pending").length ?? 0;
  const superAdmin = isSuper(v);
  const canApprove = superAdmin || (branchId ? hasGrant(v, branchId, "work_item.approve") : hasGrantAnywhere(v, "work_item.approve"));

  const main: NavEntry[] = [
    { to: "/", label: superAdmin && isAll ? t("Overview") : t("Home"), icon: <Home className="size-[18px]" />, exact: true },
    { to: "/my-work", label: t("My work"), icon: <ListChecks className="size-[18px]" />, count: mine?.open_work_items || null },
    { to: "/items", label: t("Items"), icon: <List className="size-[18px]" /> },
  ];
  if (canApprove) main.push({ to: "/approvals", label: t("To approve"), icon: <Check className="size-[18px]" />, count: mine?.awaiting_my_approval || null });
  main.push({ to: "/calendar", label: t("Calendar"), icon: <Calendar className="size-[18px]" />, count: pendingRsvps || null });

  const manage: NavEntry[] = [];
  const canPeople = branchId ? isAdminOf(v, branchId) || hasGrant(v, branchId, "member.manage") : me.memberships.some((m) => m.is_admin) || superAdmin;
  if (canPeople) manage.push({ to: "/people", label: t("People & groups"), icon: <Users className="size-4" /> });
  if (superAdmin) manage.push({ to: "/branches", label: t("Branches & admins"), icon: <Shield className="size-4" /> });
  const canExport = superAdmin || (branchId ? hasGrant(v, branchId, "export.run") : hasGrantAnywhere(v, "export.run"));
  if (canExport) manage.push({ to: "/export", label: t("Export to Excel"), icon: <Download className="size-4" /> });
  const manageTitle = superAdmin && isAll ? t("Run the school") : branch ? t("Run {name}", { name: branch.name }) : t("Manage");
  return { main, manage, manageTitle };
}

function useActive(to: string, exact?: boolean) {
  const path = useRouterState({ select: (s) => s.location.pathname });
  return exact ? path === to : path === to || path.startsWith(`${to}/`);
}

function NavPill({ entry }: { entry: NavEntry }) {
  const active = useActive(entry.to, entry.exact);
  return (
    <Link
      to={entry.to}
      aria-current={active ? "page" : undefined}
      className={cx(
        "inline-flex h-10 items-center gap-2 rounded-full px-3.5 text-[15px] font-medium whitespace-nowrap transition-colors",
        active ? "bg-text text-surface" : "text-text-2 hover:bg-sunken hover:text-text",
      )}
    >
      {entry.icon}
      {entry.label}
      {entry.count != null && (
        <span
          className={cx(
            "min-w-5 rounded-full px-1.5 text-center text-[12px] leading-5 font-bold tabular",
            active ? "bg-surface/20 text-surface" : "bg-warning-soft text-warning",
          )}
        >
          {num(entry.count)}
        </span>
      )}
    </Link>
  );
}

function ManageMenu({ entries, title }: { entries: NavEntry[]; title: string }) {
  const navigate = useNavigate();
  const active = useRouterState({ select: (s) => entries.some((e) => s.location.pathname.startsWith(e.to)) });
  if (!entries.length) return null;
  return (
    <Menu
      align="start"
      trigger={
        <button
          className={cx(
            "inline-flex h-10 items-center gap-1.5 rounded-full px-3.5 text-[15px] font-medium",
            active ? "bg-text text-surface" : "text-text-2 hover:bg-sunken hover:text-text",
          )}
        >
          {t("Manage")}{" "}<ChevronDown className="size-4" />
        </button>
      }
    >
      <MenuLabel>{title}</MenuLabel>
      {entries.map((e) => (
        <MenuItem key={e.to} onSelect={() => navigate({ to: e.to })}>
          {e.icon} {e.label}
        </MenuItem>
      ))}
    </Menu>
  );
}

function BranchChip() {
  const me = useSession();
  const ctx = useBranch();
  const superAdmin = me.user.is_super_admin;
  const title = ctx.branch?.name ?? (superAdmin ? t("Whole school") : t("All my branches"));
  const chip = "inline-flex h-10 max-w-[220px] items-center gap-2 rounded-full border border-border bg-surface-2 px-3.5 text-[14px] font-semibold";
  if (!ctx.canChooseAll && ctx.options.length <= 1) return <span className={chip}><span className="truncate">{title}</span></span>;
  return (
    <Menu
      align="start"
      trigger={
        <button className={cx(chip, "hover:border-border-strong")} aria-label={t("Branch: {title}. Change branch", { title })}>
          <span className="size-2 shrink-0 rounded-full bg-primary" aria-hidden />
          <span className="truncate">{title}</span>
          <ChevronDown className="size-4 shrink-0 text-text-3" />
        </button>
      }
    >
      {ctx.canChooseAll && (
        <MenuItem onSelect={() => ctx.setBranch("all")}>
          <span className="flex-1">{superAdmin ? t("Whole school ({n} branches)", { n: ctx.options.length }) : t("All my branches")}</span>
          {ctx.isAll && <Check className="size-4" />}
        </MenuItem>
      )}
      <MenuSeparator />
      {ctx.options.map((o) => (
        <MenuItem key={o.id} onSelect={() => ctx.setBranch(o.id)}>
          <span className="flex-1">{o.name}</span>
          {o.membership?.is_admin && <span className="text-[12px] text-text-3">{t("Admin")}</span>}
          {ctx.branchId === o.id && <Check className="size-4" />}
        </MenuItem>
      ))}
    </Menu>
  );
}

function AccountMenu({ extra }: { extra?: NavEntry[] }) {
  const me = useSession();
  const logout = useLogout();
  const navigate = useNavigate();
  const [theme, setT] = useState<Theme>(getTheme);
  const pick = (t: Theme) => (setTheme(t), setT(t));
  return (
    <Menu
      trigger={
        <button className="rounded-full ring-offset-2 hover:ring-2 hover:ring-border-strong" aria-label={t("Your account")}>
          <Avatar first={me.user.first_name} last={me.user.last_name} id={me.user.id} size={40} />
        </button>
      }
    >
      <MenuLabel>
        {shortName(me.user.first_name, me.user.last_name)} · {me.user.email}
      </MenuLabel>
      <MenuItem onSelect={() => navigate({ to: "/profile" })}>
        <User className="size-4" />{" "}{t("Your profile")}
      </MenuItem>
      {extra && extra.length > 0 && (
        <>
          <MenuSeparator />
          {extra.map((e) => (
            <MenuItem key={e.to} onSelect={() => navigate({ to: e.to })}>
              {e.icon} {e.label}
            </MenuItem>
          ))}
        </>
      )}
      <MenuSeparator />
      <MenuLabel>{t("Theme")}</MenuLabel>
      {(
        [
          ["system", t("System"), <Monitor key="m" className="size-4" />],
          ["light", t("Light"), <Sun key="s" className="size-4" />],
          ["dark", t("Dark"), <Moon key="d" className="size-4" />],
        ] as const
      ).map(([t, label, icon]) => (
        <MenuItem key={t} onSelect={() => pick(t)}>
          {icon}
          <span className="flex-1">{label}</span>
          {theme === t && <Check className="size-4" />}
        </MenuItem>
      ))}
      <MenuSeparator />
      <MenuLabel>{t("Language")}</MenuLabel>
      {(
        [
          ["en", "English"],
          ["fa", "فارسی"],
        ] as const
      ).map(([l, label]) => (
        <MenuItem key={l} onSelect={() => setLang(l)}>
          <Languages className="size-4" />
          <span className="flex-1" lang={l}>
            {label}
          </span>
          {lang === l && <Check className="size-4" />}
        </MenuItem>
      ))}
      <MenuSeparator />
      <MenuItem onSelect={() => logout.mutate()}>
        <LogOut className="size-4" />{" "}{t("Sign out")}
      </MenuItem>
    </Menu>
  );
}

export function LivePill() {
  const status = useLiveStatus();
  const map = {
    live: [t("Live"), "var(--success)"],
    connecting: [t("Connecting…"), "var(--text-3)"],
    reconnecting: [t("Reconnecting…"), "var(--warning)"],
    offline: [t("Offline"), "var(--text-3)"],
  } as const;
  const [text, color] = map[status];
  return (
    <span className="inline-flex items-center gap-1.5 text-[13px] font-medium" style={{ color }} role="status" title={text}>
      <span className={cx("size-2 rounded-full", status === "live" && "animate-pulse")} style={{ background: color }} aria-hidden />
      <span className="hidden xl:inline">{text}</span>
    </span>
  );
}

/** Quick search: type a number to jump, or a few words to find a title. */
function QuickSearch({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const navigate = useNavigate();
  const { branchId } = useBranch();
  const [q, setQ] = useState("");
  const [term, setTerm] = useState("");
  useEffect(() => {
    const id = setTimeout(() => setTerm(q.trim()), 250);
    return () => clearTimeout(id);
  }, [q]);
  useEffect(() => {
    if (!open) setQ("");
  }, [open]);
  const number = term.match(/^(?:#|iss-)?(\d+)$/i)?.[1];
  const results = useIssueList({ branch_id: branchId, q: term && !number ? term : undefined }, 8);
  const items = term && !number ? (results.data?.pages[0]?.items ?? []) : [];
  const go = (n: string) => (onOpenChange(false), navigate({ to: "/items/$number", params: { number: n } }));
  return (
    <Drawer open={open} onOpenChange={onOpenChange} label={t("Search")} size="md">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (number) go(number);
          else if (items[0]) go(numberOf(items[0].key));
          else if (q.trim()) (onOpenChange(false), navigate({ to: "/items", search: { q: q.trim() } }));
        }}
        className="flex items-center gap-3 border-b border-border px-5"
      >
        <Search className="size-5 text-text-3" aria-hidden />
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("Search titles, or type a number like 1042")}
          aria-label={t("Search items")}
          className="h-16 flex-1 bg-transparent text-[17px] outline-none placeholder:text-text-3 focus-visible:outline-none"
        />
      </form>
      <div className="max-h-[50vh] overflow-y-auto p-2">
        {number && (
          <button onClick={() => go(number)} className="flex w-full items-center gap-3 rounded-[12px] px-3 py-3 text-start hover:bg-sunken">
            <span className="font-mono text-text-3">ISS-{number}</span> {t("Open item {n}", { n: number })}
          </button>
        )}
        {items.map((i) => (
          <button key={i.id} onClick={() => go(numberOf(i.key))} className="flex w-full items-center gap-3 rounded-[12px] px-3 py-2.5 text-start hover:bg-sunken">
            <TypeBadge type={i.type} />
            <span className="min-w-0 flex-1 truncate">{i.title}</span>
            <span className="font-mono text-[13px] text-text-3">{i.key}</span>
          </button>
        ))}
        {term && !number && !results.isLoading && items.length === 0 && <p className="px-3 py-6 text-center text-text-2">{t("No titles match {term}.", { term: quote(term) })}</p>}
        {!term && <p className="px-3 py-6 text-center text-text-3">{t("Press Enter to search. Esc closes.")}</p>}
      </div>
    </Drawer>
  );
}

function BellPopover() {
  const unread = useUnreadCount();
  const list = useNotifications(false, 8);
  const people = usePeople();
  const mark = useMarkRead();
  const navigate = useNavigate();
  const count = unread.data ?? 0;
  const items = list.data?.pages[0]?.items ?? [];
  useEffect(() => {
    document.title = count > 0 ? `(${count}) ${APP_NAME}` : APP_NAME;
  }, [count]);
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button className="relative flex size-10 items-center justify-center rounded-full text-text-2 hover:bg-sunken hover:text-text" aria-label={count ? t("Notifications, {n} unread", { n: count }) : t("Notifications")}>
          <Bell className="size-5" aria-hidden />
          {count > 0 && (
            <span className="absolute -top-0.5 -end-0.5 flex h-5 min-w-5 items-center justify-center rounded-full border-2 border-surface bg-danger-solid px-1 text-[11px] font-bold text-white tabular">
              {count > 99 ? num("99+") : num(count)}
            </span>
          )}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="end" sideOffset={10} className="z-[80] w-[400px] max-w-[calc(100vw-24px)] overflow-hidden rounded-[18px] border border-border bg-surface shadow-3">
          <div className="flex items-center justify-between px-4 py-3">
            <span className="font-semibold">{t("Updates")}</span>
            {count > 0 && (
              <button className="text-[14px] text-primary hover:underline" onClick={() => mark.mutate("all")}>
                {t("Mark all as read")}
              </button>
            )}
          </div>
          <ul className="max-h-[420px] overflow-y-auto px-2">
            {items.length === 0 && <li className="px-3 py-6 text-center text-text-2">{t("No updates yet.")}</li>}
            {items.map((n) => (
              <li key={n.id}>
                <Popover.Close asChild>
                  <button
                    className="flex w-full gap-3 rounded-[12px] px-3 py-2.5 text-start hover:bg-sunken"
                    onClick={() => {
                      if (!n.read_at) mark.mutate(n.id);
                      if (n.issue_key) navigate({ to: "/items/$number", params: { number: numberOf(n.issue_key) } });
                    }}
                  >
                    <span className={cx("mt-2 size-2 shrink-0 rounded-full", n.read_at ? "bg-transparent" : "bg-primary")} aria-hidden />
                    <span className="min-w-0">
                      <span className="block text-[15px] break-anywhere">{describeNotification(n, people.short).plain}</span>
                      <span className="text-[13px] text-text-3">{timeAgo(n.created_at)}</span>
                    </span>
                  </button>
                </Popover.Close>
              </li>
            ))}
          </ul>
          <Popover.Close asChild>
            <Link to="/inbox" className="m-2 block rounded-[12px] py-2.5 text-center font-semibold text-primary hover:bg-sunken">
              {t("Open inbox")}
            </Link>
          </Popover.Close>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function PhoneBottomNav() {
  const unread = useUnreadCount();
  const openNew = useNewItem();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const item = (to: string, label: string, icon: ReactNode, badge?: number) => {
    const active = to === "/" ? path === "/" : path.startsWith(to);
    return (
      <Link to={to} className={cx("relative flex flex-1 flex-col items-center gap-0.5 py-2 text-[12px]", active ? "font-semibold text-primary" : "text-text-2")}>
        {icon}
        {label}
        {!!badge && <span className="absolute top-0.5 start-1/2 ms-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-danger-solid px-1 text-[11px] font-bold text-white">{num(badge)}</span>}
      </Link>
    );
  };
  return (
    <nav aria-label={t("Main")} className="fixed inset-x-3 bottom-3 z-30 flex items-center rounded-[22px] border border-border bg-surface/95 px-1 pb-[env(safe-area-inset-bottom)] shadow-2 backdrop-blur md:hidden">
      {item("/", t("Home"), <Home className="size-6" />)}
      {item("/my-work", t("My work"), <ListChecks className="size-6" />)}
      <div className="flex flex-1 justify-center">
        <button onClick={() => openNew()} aria-label={t("New item")} className="flex size-12 items-center justify-center rounded-full bg-primary text-on-primary shadow-2">
          <Plus className="size-6" />
        </button>
      </div>
      {item("/calendar", t("Calendar"), <Calendar className="size-6" />)}
      {item("/inbox", t("Inbox"), <Inbox className="size-6" />, unread.data)}
    </nav>
  );
}

function TopBar({ onSearch }: { onSearch: () => void }) {
  const { main, manage, manageTitle } = useNav();
  const openNew = useNewItem();
  return (
    <header className="sticky top-0 z-30 px-3 pt-3 md:px-6">
      <div className="mx-auto flex h-16 max-w-[1320px] items-center gap-2 rounded-[22px] border border-border bg-surface/90 px-3 shadow-2 backdrop-blur-md">
        <Link to="/" className="flex shrink-0 items-center gap-2 pe-1" aria-label={APP_NAME}>
          <span className="flex size-10 items-center justify-center rounded-full bg-[#2f55d4] text-[14px] font-bold text-white">{t("ST")}</span>
        </Link>
        <BranchChip />
        <nav aria-label={t("Main")} className="mx-2 hidden min-w-0 items-center gap-1 overflow-x-auto scrollbar-none lg:flex">
          {main.map((e) => (
            <NavPill key={e.to} entry={e} />
          ))}
          <ManageMenu entries={manage} title={manageTitle} />
        </nav>
        <div className="ms-auto flex items-center gap-1.5">
          <button
            onClick={onSearch}
            className="hidden h-10 items-center gap-2 rounded-full bg-sunken px-3.5 text-[14px] text-text-3 hover:text-text-2 sm:inline-flex"
            aria-label={t("Search (press /)")}
          >
            <Search className="size-4" />
            <span className="hidden xl:inline">{t("Search")}</span>
            <kbd className="rounded-md border border-border-strong px-1.5 text-[12px]">/</kbd>
          </button>
          <button onClick={onSearch} className="flex size-10 items-center justify-center rounded-full text-text-2 hover:bg-sunken sm:hidden" aria-label={t("Search")}>
            <Search className="size-5" />
          </button>
          <span className="hidden px-1 sm:block">
            <LivePill />
          </span>
          <BellPopover />
          <button
            onClick={() => openNew()}
            className="hidden h-10 items-center gap-1.5 rounded-full bg-primary pe-4 ps-3 font-semibold text-on-primary hover:bg-primary-hover md:inline-flex"
          >
            <Plus className="size-5" />{" "}{t("New")}
          </button>
          <AccountMenu extra={[...main.filter((e) => e.to === "/items" || e.to === "/approvals"), ...manage]} />
        </div>
      </div>
      {/* Tablets: the pills move to their own scrollable row. */}
      <nav aria-label={t("Sections")} className="mx-auto mt-2 flex max-w-[1320px] gap-1 overflow-x-auto px-1 scrollbar-none max-md:hidden lg:hidden">
        {main.map((e) => (
          <NavPill key={e.to} entry={e} />
        ))}
        <ManageMenu entries={manage} title={manageTitle} />
      </nav>
    </header>
  );
}

function Shell() {
  const [search, setSearch] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const typing = /input|textarea|select/i.test(t.tagName) || t.isContentEditable;
      if ((e.key === "/" && !typing) || (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey))) {
        e.preventDefault();
        setSearch(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <div className="min-h-screen">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:start-2 focus:z-50 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2">
        {t("Skip to content")}
      </a>
      <TopBar onSearch={() => setSearch(true)} />
      <main id="main" className="mx-auto max-w-[1200px] px-4 pt-8 pb-28 md:px-8 md:pt-10 md:pb-16">
        <Outlet />
      </main>
      <PhoneBottomNav />
      <QuickSearch open={search} onOpenChange={setSearch} />
    </div>
  );
}

export function AppShell() {
  return (
    <NewItemProvider>
      <Shell />
    </NewItemProvider>
  );
}
