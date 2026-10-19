// Inbox (UX_SPEC §4.10): updates grouped by day, mark read, mark all read.
import { useNavigate } from "@tanstack/react-router";
import { isThisWeek, isToday, isYesterday } from "date-fns";
import { useState } from "react";
import { useMarkRead, useNotifications, useUnreadCount } from "@/api/hooks";
import type { Notification } from "@/api/types";
import { Button, Card, EmptyState, ErrorPanel, LoadingRows, PageHeader, Tabs, cx } from "@/components/ui";
import { timeAgo, weekStartsOn } from "@/lib/dates";
import { numberOf } from "@/lib/items";
import { describeNotification } from "@/lib/notifications";
import { usePeople } from "@/people/usePeople";
import { t } from "@/i18n";

function bucket(n: Notification) {
  const d = new Date(n.created_at);
  if (isToday(d)) return t("Today");
  if (isYesterday(d)) return t("Yesterday");
  if (isThisWeek(d, { weekStartsOn })) return t("This week");
  return t("Earlier");
}

export function InboxPage() {
  const [tab, setTab] = useState<"all" | "unread">("all");
  const list = useNotifications(tab === "unread", 30);
  const unread = useUnreadCount();
  const mark = useMarkRead();
  const people = usePeople();
  const navigate = useNavigate();
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];
  const groups = new Map<string, Notification[]>();
  for (const n of items) groups.set(bucket(n), [...(groups.get(bucket(n)) ?? []), n]);

  return (
    <div className="mx-auto max-w-[900px]">
      <PageHeader
        title={t("Inbox")}
        actions={
          (unread.data ?? 0) > 0 && (
            <Button onClick={() => mark.mutate("all")} loading={mark.isPending && mark.variables === "all"}>
              {t("Mark all as read")}
            </Button>
          )
        }
      />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: "all", label: t("All") },
          { value: "unread", label: t("Unread"), count: unread.data ?? null, badge: true },
        ]}
      />
      <div className="mt-6 space-y-6">
        {list.isLoading ? (
          <Card>
            <LoadingRows />
          </Card>
        ) : list.error ? (
          <ErrorPanel error={list.error} onRetry={() => list.refetch()} />
        ) : items.length === 0 ? (
          <Card>
            <EmptyState title={tab === "unread" ? t("You've read everything.") : t("No updates yet.")}>
              {tab === "all" && t("New work, mentions and reminders will show here.")}
            </EmptyState>
          </Card>
        ) : (
          [...groups.entries()].map(([title, ns]) => (
            <section key={title}>
              <h2 className="mb-2 text-[13px] font-semibold tracking-[0.08em] text-text-3 uppercase">{title}</h2>
              <Card>
                <ul className="divide-y divide-border">
                  {ns.map((n) => {
                    const d = describeNotification(n, people.short);
                    return (
                      <li key={n.id}>
                        <button
                          className="flex w-full items-start gap-3 px-5 py-4 text-start hover:bg-surface-2"
                          onClick={() => {
                            if (!n.read_at) mark.mutate(n.id);
                            if (n.issue_key) navigate({ to: "/items/$number", params: { number: numberOf(n.issue_key) } });
                          }}
                        >
                          <span
                            className={cx("mt-2 size-2.5 shrink-0 rounded-full")}
                            style={{ background: n.read_at ? "var(--border-strong)" : d.tone === "danger" ? "var(--danger)" : "var(--primary)" }}
                            aria-hidden
                          />
                          <span className="min-w-0 flex-1">
                            <span className={cx("block break-anywhere", !n.read_at && "font-medium")}>
                              {d.actor && <b>{d.actor}</b>}
                              {d.before}
                              {d.item && <span className="text-primary">{d.item}</span>}
                              {d.after}
                            </span>
                            <span className="text-[14px] text-text-3">
                              {n.issue_key && `${n.issue_key} · `}
                              {timeAgo(n.created_at)}
                            </span>
                          </span>
                          {!n.read_at && <span className="sr-only">{t("Unread")}</span>}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </Card>
            </section>
          ))
        )}
        {list.hasNextPage && (
          <div className="text-center">
            <Button onClick={() => list.fetchNextPage()} loading={list.isFetchingNextPage}>
              {t("Load more")}
            </Button>
          </div>
        )}
        <p className="text-center text-[13px] text-text-3">{t("Read updates are kept for 90 days.")}</p>
      </div>
    </div>
  );
}
