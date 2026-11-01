// The whole school at a glance (super admins): activity per branch, how
// quickly and how punctually work gets done, and who has the most on.
// Hand-built charts on the --viz-* tokens (validated for both themes):
// small multiples on a shared scale, ranked bars with their values written
// out, and a table for every chart.
import { useState } from "react";
import { useAnalytics } from "@/api/hooks";
import type { BranchAnalytics, Workload } from "@/api/types";
import { useBranch } from "@/app/BranchContext";
import { Card, EmptyState, ErrorPanel, PageHeader, Segmented, SectionLabel, Skeleton, cx } from "@/components/ui";
import { formatDay } from "@/lib/dates";
import { isSuper } from "@/lib/can";
import { useViewer } from "@/lib/useViewer";
import { PersonName } from "@/people/PersonPopover";
import { num, t, tn } from "@/i18n";

const PERIODS = [4, 12, 26] as const;

export function AnalyticsPage() {
  const viewer = useViewer();
  const [weeks, setWeeks] = useState<(typeof PERIODS)[number]>(12);
  const data = useAnalytics(weeks, isSuper(viewer));
  if (!isSuper(viewer)) return <EmptyState title={t("Only super admins see the school's analytics.")} />;

  return (
    <div className="space-y-8">
      <PageHeader
        title={t("School analytics")}
        subtitle={data.data ? t("Since {date}", { date: formatDay(data.data.since) }) : undefined}
        actions={
          <Segmented
            label={t("Period")}
            value={String(weeks)}
            onChange={(v) => setWeeks(Number(v) as (typeof PERIODS)[number])}
            options={PERIODS.map((w) => ({ value: String(w), label: tn(w, "{n} week", "{n} weeks") }))}
          />
        }
      />
      {data.error ? (
        <ErrorPanel error={data.error} onRetry={() => data.refetch()} />
      ) : !data.data ? (
        <Skeleton className="h-96" />
      ) : data.data.branches.length === 0 ? (
        <EmptyState title={t("No branches yet.")} />
      ) : (
        <>
          <Activity branches={data.data.branches} />
          <div className="grid gap-6 lg:grid-cols-2">
            <OnTime branches={data.data.branches} />
            <TimeToFinish branches={data.data.branches} />
          </div>
          <WorkloadChart workload={data.data.workload} />
        </>
      )}
    </div>
  );
}

/** A section with a chart and, on request, the same numbers as a table. */
function Section({ title, legend, table, children }: { title: string; legend?: React.ReactNode; table: React.ReactNode; children: React.ReactNode }) {
  const [asTable, setAsTable] = useState(false);
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SectionLabel>{title}</SectionLabel>
        <div className="flex items-center gap-4">
          {legend}
          <button className="text-[14px] font-semibold text-primary hover:underline" onClick={() => setAsTable(!asTable)}>
            {asTable ? t("Show the chart") : t("Show as a table")}
          </button>
        </div>
      </div>
      {asTable ? <Card className="overflow-x-auto">{table}</Card> : children}
    </section>
  );
}

function Swatch({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[14px] text-text-2">
      <span className="size-2.5 rounded-[2px]" style={{ background: color }} aria-hidden />
      {label}
    </span>
  );
}

const tableCls = "w-full text-start text-[14px] [&_td]:px-4 [&_td]:py-2 [&_th]:px-4 [&_th]:py-2 [&_th]:text-start [&_th]:font-semibold [&_th]:text-text-2 [&_tr]:border-b [&_tr]:border-border";

// ---------- activity: small multiples, one shared scale ----------

function Activity({ branches }: { branches: BranchAnalytics[] }) {
  const max = Math.max(1, ...branches.flatMap((b) => b.activity.flatMap((w) => [w.created, w.finished])));
  return (
    <Section
      title={t("Activity per branch")}
      legend={
        <>
          <Swatch color="var(--viz-1)" label={t("Items created")} />
          <Swatch color="var(--viz-2)" label={t("Work finished")} />
        </>
      }
      table={
        <table className={tableCls}>
          <thead>
            <tr>
              <th>{t("Branch")}</th>
              <th>{t("Week of")}</th>
              <th>{t("Items created")}</th>
              <th>{t("Work finished")}</th>
            </tr>
          </thead>
          <tbody>
            {branches.flatMap((b) =>
              b.activity.map((w) => (
                <tr key={`${b.branch_id}-${w.week_start}`}>
                  <td>{b.name}</td>
                  <td>{formatDay(w.week_start)}</td>
                  <td className="tabular">{num(w.created)}</td>
                  <td className="tabular">{num(w.finished)}</td>
                </tr>
              )),
            )}
          </tbody>
        </table>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {branches.map((b) => (
          <BranchActivity key={b.branch_id} branch={b} max={max} />
        ))}
      </div>
    </Section>
  );
}

function BranchActivity({ branch, max }: { branch: BranchAnalytics; max: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const created = branch.activity.reduce((n, w) => n + w.created, 0);
  const finished = branch.activity.reduce((n, w) => n + w.finished, 0);
  const shown = hover === null ? null : branch.activity[hover];
  const H = 96;
  return (
    <Card className="p-4">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-semibold">{branch.name}</span>
        <span className="text-[13px] text-text-2 tabular">
          {num(created)} · {num(finished)}
        </span>
      </div>
      <div className="relative mt-3" onMouseLeave={() => setHover(null)}>
        {shown && (
          <div className="pointer-events-none absolute -top-2 left-1/2 z-10 -translate-x-1/2 -translate-y-full rounded-md bg-selected px-2.5 py-1.5 text-[12px] whitespace-nowrap text-on-selected shadow-2">
            <div className="font-semibold">{t("Week of {date}", { date: formatDay(shown.week_start) })}</div>
            <div>
              {t("Items created")}: {num(shown.created)} · {t("Work finished")}: {num(shown.finished)}
            </div>
          </div>
        )}
        <div className="flex items-end gap-[3px] border-b border-border-strong" style={{ height: H }} role="img" aria-label={t("{name}: {created} items created and {finished} pieces of work finished", { name: branch.name, created: num(created), finished: num(finished) })}>
          {branch.activity.map((w, i) => (
            <div
              key={w.week_start}
              className={cx("flex h-full flex-1 items-end justify-center gap-[2px] rounded-t-[4px]", hover === i && "bg-sunken")}
              onMouseEnter={() => setHover(i)}
            >
              {([["created", "var(--viz-1)"], ["finished", "var(--viz-2)"]] as const).map(([k, color]) => (
                <span
                  key={k}
                  className="w-full max-w-[10px] rounded-t-[4px]"
                  style={{ height: w[k] ? Math.max(2, (w[k] / max) * (H - 4)) : 0, background: color }}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}

// ---------- ranked bars ----------

function Bars({ rows }: { rows: { key: string; label: React.ReactNode; value: number | null; text: string; note?: string }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.value ?? 0));
  return (
    <Card className="divide-y divide-border">
      {rows.map((r) => (
        <div key={r.key} className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] items-center gap-3 px-4 py-3">
          <span className="truncate font-medium">{r.label}</span>
          {r.value === null ? (
            <span className="text-[14px] text-text-3">{r.text}</span>
          ) : (
            <span className="flex items-center gap-2">
              <span className="h-3 flex-1 rounded-full bg-[var(--bar-track)]">
                <span className="block h-full rounded-full" style={{ width: `${(r.value / max) * 100}%`, background: "var(--viz-1)" }} />
              </span>
              <span className="w-28 shrink-0 text-end text-[14px] tabular">
                <b>{r.text}</b>
                {r.note && <span className="block text-[12px] text-text-3">{r.note}</span>}
              </span>
            </span>
          )}
        </div>
      ))}
    </Card>
  );
}

function OnTime({ branches }: { branches: BranchAnalytics[] }) {
  const rows = [...branches]
    .sort((a, b) => (b.on_time_rate ?? -1) - (a.on_time_rate ?? -1))
    .map((b) => ({
      key: b.branch_id,
      label: b.name,
      value: b.on_time_rate === null || b.on_time_rate === undefined ? null : b.on_time_rate * 100,
      text: b.on_time_rate === null || b.on_time_rate === undefined ? t("Nothing finished with a due date") : `${num(Math.round(b.on_time_rate * 100))}%`,
      note: t("{done} of {total} on time", { done: num(Math.round((b.on_time_rate ?? 0) * b.finished_with_due_date)), total: num(b.finished_with_due_date) }),
    }));
  return (
    <Section
      title={t("On-time rate")}
      table={
        <table className={tableCls}>
          <thead>
            <tr>
              <th>{t("Branch")}</th>
              <th>{t("On time")}</th>
              <th>{t("Finished with a due date")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td>{r.label}</td>
                <td className="tabular">{r.value === null ? "—" : r.text}</td>
                <td className="tabular">{num(branches.find((b) => b.branch_id === r.key)?.finished_with_due_date ?? 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      }
    >
      <Bars rows={rows} />
    </Section>
  );
}

/** "5 h" under two days, else "3.5 days". */
function duration(hours: number) {
  return hours < 48 ? t("{n} h", { n: num(Math.round(hours)) }) : t("{n} days", { n: num(Math.round((hours / 24) * 10) / 10) });
}

function TimeToFinish({ branches }: { branches: BranchAnalytics[] }) {
  const rows = [...branches]
    .sort((a, b) => (a.avg_hours_to_finish ?? Infinity) - (b.avg_hours_to_finish ?? Infinity))
    .map((b) => ({
      key: b.branch_id,
      label: b.name,
      value: b.avg_hours_to_finish ?? null,
      text: b.avg_hours_to_finish === null || b.avg_hours_to_finish === undefined ? t("Nothing finished yet") : duration(b.avg_hours_to_finish),
      note: tn(b.finished, "{n} finished", "{n} finished"),
    }));
  return (
    <Section
      title={t("Average time to finish")}
      table={
        <table className={tableCls}>
          <thead>
            <tr>
              <th>{t("Branch")}</th>
              <th>{t("Average")}</th>
              <th>{t("Finished")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td>{r.label}</td>
                <td className="tabular">{r.value === null ? "—" : r.text}</td>
                <td className="tabular">{num(branches.find((b) => b.branch_id === r.key)?.finished ?? 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      }
    >
      <Bars rows={rows} />
    </Section>
  );
}

// ---------- workload: open work, the overdue part marked ----------

function WorkloadChart({ workload }: { workload: Workload[] }) {
  const { branchById } = useBranch();
  const max = Math.max(1, ...workload.map((w) => w.open));
  return (
    <Section
      title={t("Workload per person")}
      legend={
        <>
          <Swatch color="var(--viz-1)" label={t("Open")} />
          <Swatch color="var(--viz-critical)" label={t("Overdue")} />
        </>
      }
      table={
        <table className={tableCls}>
          <thead>
            <tr>
              <th>{t("Person")}</th>
              <th>{t("Branch")}</th>
              <th>{t("Open")}</th>
              <th>{t("Overdue")}</th>
              <th>{t("Handed in")}</th>
            </tr>
          </thead>
          <tbody>
            {workload.map((w) => (
              <tr key={`${w.user_id}-${w.branch_id}`}>
                <td>
                  {w.first_name} {w.last_name}
                </td>
                <td>{branchById.get(w.branch_id)?.name ?? ""}</td>
                <td className="tabular">{num(w.open)}</td>
                <td className="tabular">{num(w.overdue)}</td>
                <td className="tabular">{num(w.handed_in)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      }
    >
      {workload.length === 0 ? (
        <Card>
          <EmptyState title={t("Nobody has open work right now.")} />
        </Card>
      ) : (
        <Card className="divide-y divide-border">
          {workload.map((w) => (
            <div key={`${w.user_id}-${w.branch_id}`} className="grid grid-cols-[minmax(0,11rem)_minmax(0,1fr)] items-center gap-3 px-4 py-3">
              <span className="min-w-0">
                <PersonName id={w.user_id} label={`${w.first_name} ${w.last_name}`} className="block truncate font-medium" />
                <span className="block truncate text-[12px] text-text-3">{branchById.get(w.branch_id)?.name ?? ""}</span>
              </span>
              <span className="flex items-center gap-2">
                <span className="flex h-3 flex-1 overflow-hidden rounded-full bg-[var(--bar-track)]">
                  {/* Open work, with its overdue part first; a 2px gap between the two. */}
                  <span className="flex h-full gap-[2px]" style={{ width: `${(w.open / max) * 100}%` }}>
                    {w.overdue > 0 && <span className="h-full rounded-full" style={{ flex: w.overdue, background: "var(--viz-critical)" }} />}
                    {w.open > w.overdue && <span className="h-full rounded-full" style={{ flex: w.open - w.overdue, background: "var(--viz-1)" }} />}
                  </span>
                </span>
                <span className="w-40 shrink-0 text-end text-[13px] text-text-2 tabular">
                  <b className="text-text">{tn(w.open, "{n} open", "{n} open")}</b>
                  {w.overdue > 0 && <> · {tn(w.overdue, "{n} overdue", "{n} overdue")}</>}
                  {w.handed_in > 0 && <span className="block text-[12px] text-text-3">{tn(w.handed_in, "{n} handed in", "{n} handed in")}</span>}
                </span>
              </span>
            </div>
          ))}
        </Card>
      )}
    </Section>
  );
}
