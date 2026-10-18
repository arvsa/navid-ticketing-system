// One EventSource per tab (FRONTEND_PLAN §6). Events carry ids only, so they
// turn into debounced query invalidations; the API applies permissions on refetch.
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/api/client";
import { keys } from "@/api/keys";
import type { Notification, Page } from "@/api/types";
import { describeNotification } from "@/lib/notifications";

export type LiveStatus = "connecting" | "live" | "reconnecting" | "offline";
const LiveCtx = createContext<LiveStatus>("connecting");
export const useLiveStatus = () => useContext(LiveCtx);

const ISSUE_EVENTS = [
  "issue_created",
  "issue_updated",
  "issue_closed",
  "issue_cancelled",
  "work_item_updated",
  "comment_created",
  "comment_updated",
  "comment_deleted",
  "report_created",
  "report_updated",
  "report_submitted",
  "rsvp_changed",
  "attachment_added",
  "target_added",
  "target_removed",
];
const ORG_EVENTS = ["permissions_changed", "member_changed", "member_removed", "group_changed", "branch_changed"];
const TOAST_KINDS = new Set([
  "assigned",
  "mentioned",
  "submitted_for_approval",
  "approved",
  "rejected",
  "event_invited",
  "event_cancelled",
  "sla_breached",
]);
const HEARTBEAT_TIMEOUT = 60_000;
const BACKOFF = [1000, 2000, 5000, 10000, 30000];

type Pending = { issueIds: Set<string>; issues: boolean; notifications: boolean; org: boolean; all: boolean };

function flush(qc: QueryClient, p: Pending, onNotifications: () => void) {
  if (p.all) {
    qc.invalidateQueries();
    return;
  }
  if (p.issues) {
    for (const id of p.issueIds) {
      qc.invalidateQueries({ queryKey: keys.issue(id) });
      qc.invalidateQueries({ queryKey: ["issues", id] });
      qc.invalidateQueries({ queryKey: keys.rsvps(id) });
    }
    qc.invalidateQueries({ queryKey: ["issues", "list"] });
    qc.invalidateQueries({ queryKey: keys.workItems });
    qc.invalidateQueries({ queryKey: ["calendar"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
  }
  if (p.notifications) {
    qc.invalidateQueries({ queryKey: keys.unread });
    qc.invalidateQueries({ queryKey: ["notifications"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
    onNotifications();
  }
  if (p.org) {
    qc.invalidateQueries({ queryKey: keys.me });
    qc.invalidateQueries({ queryKey: keys.branches });
    qc.invalidateQueries({ queryKey: keys.people });
    qc.invalidateQueries({ queryKey: ["my-groups"] });
    qc.invalidateQueries({ queryKey: ["groups"] });
    qc.invalidateQueries({ queryKey: ["effective-permissions"] });
  }
}

export function LiveProvider({ children, onSessionEnded }: { children: ReactNode; onSessionEnded: () => void }) {
  const qc = useQueryClient();
  const [status, setStatus] = useState<LiveStatus>("connecting");
  const seenNotification = useRef<number>(0);
  const endedRef = useRef(onSessionEnded);
  endedRef.current = onSessionEnded;

  useEffect(() => {
    let es: EventSource | null = null;
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let debounce: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    let stopped = false;
    let pending: Pending = { issueIds: new Set(), issues: false, notifications: false, org: false, all: false };
    let lastFlush = 0;

    // Toast new notifications addressed to me, once.
    const toastNew = async () => {
      try {
        const page = await api.get<Page<Notification>>("/notifications", { unread: true, limit: 5 });
        const fresh = page.items.filter((n) => n.id > seenNotification.current && TOAST_KINDS.has(n.kind));
        if (page.items[0]) seenNotification.current = Math.max(seenNotification.current, page.items[0].id);
        const first = fresh[0];
        if (first && !location.pathname.includes(`/items/${first.issue_key?.replace("ISS-", "")}`)) {
          const text = describeNotification(first, () => "Someone").plain;
          toast(text, {
            description: fresh.length > 1 ? `+${fresh.length - 1} more updates in your inbox` : undefined,
            action: first.issue_key
              ? { label: "Open", onClick: () => location.assign(`/items/${first.issue_key!.replace("ISS-", "")}`) }
              : undefined,
          });
        }
      } catch {
        // ignore: the inbox still shows it
      }
    };

    const schedule = () => {
      const run = () => {
        const p = pending;
        pending = { issueIds: new Set(), issues: false, notifications: false, org: false, all: false };
        lastFlush = Date.now();
        flush(qc, p, toastNew);
      };
      if (debounce) return;
      const wait = Math.max(0, 2000 - (Date.now() - lastFlush));
      debounce = setTimeout(() => {
        debounce = undefined;
        run();
      }, wait);
    };

    const kick = () => {
      if (watchdog) clearTimeout(watchdog);
      watchdog = setTimeout(() => {
        es?.close();
        reconnect();
      }, HEARTBEAT_TIMEOUT);
    };

    const reconnect = () => {
      if (stopped) return;
      setStatus(attempt >= 3 ? "offline" : "reconnecting");
      const wait = BACKOFF[Math.min(attempt, BACKOFF.length - 1)];
      attempt++;
      retry = setTimeout(connect, wait);
    };

    const connect = () => {
      if (stopped) return;
      es = new EventSource("/api/stream", { withCredentials: true });
      es.onopen = kick;
      es.onmessage = kick; // heartbeat comments don't fire events; any data does
      es.addEventListener("ready", () => {
        const reconnected = attempt > 0;
        attempt = 0;
        setStatus("live");
        kick();
        if (reconnected) {
          pending.all = true;
          schedule();
        }
      });
      for (const name of ISSUE_EVENTS) {
        es.addEventListener(name, (e) => {
          kick();
          try {
            const data = JSON.parse((e as MessageEvent).data);
            if (data.issue_id) pending.issueIds.add(data.issue_id);
          } catch {
            // ignore
          }
          pending.issues = true;
          schedule();
        });
      }
      es.addEventListener("notification", () => {
        kick();
        pending.notifications = true;
        schedule();
      });
      for (const name of ORG_EVENTS) {
        es.addEventListener(name, () => {
          kick();
          pending.org = true;
          schedule();
        });
      }
      es.addEventListener("resync", () => {
        kick();
        pending.all = true;
        schedule();
      });
      es.addEventListener("session_ended", () => {
        stopped = true;
        es?.close();
        endedRef.current();
      });
      es.onerror = () => {
        es?.close();
        if (watchdog) clearTimeout(watchdog);
        reconnect();
      };
    };

    // Remember the newest notification so only later ones toast.
    api
      .get<Page<Notification>>("/notifications", { limit: 1 })
      .then((p) => (seenNotification.current = p.items[0]?.id ?? 0))
      .catch(() => {});
    connect();

    return () => {
      stopped = true;
      es?.close();
      clearTimeout(watchdog);
      clearTimeout(retry);
      clearTimeout(debounce);
    };
  }, [qc]);

  return <LiveCtx.Provider value={status}>{children}</LiveCtx.Provider>;
}
