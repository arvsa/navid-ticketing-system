// Export to Excel (UX_SPEC §4.14). Downloaded with fetch so JSON errors such as
// export_too_large can be shown.
import { useState } from "react";
import { Download } from "lucide-react";
import { toast } from "sonner";
import { endOfDay, startOfDay, startOfMonth, subMonths, endOfMonth } from "date-fns";
import { ApiError, qs } from "@/api/client";
import type { IssueType } from "@/api/types";
import { useBranch } from "@/app/BranchContext";
import { Button, Card, Chip, EmptyState, Field, PageHeader, cx, inputClass } from "@/components/ui";
import { hasGrant, isAdminOf, isSuper } from "@/lib/can";
import { errorMessage, typePlural } from "@/lib/labels";
import { useViewer } from "@/lib/useViewer";

type Range = "this" | "last" | "three" | "sept" | "custom";

function rangeOf(r: Range, from: string, to: string): [Date, Date] {
  const now = new Date();
  if (r === "this") return [startOfMonth(now), now];
  if (r === "last") return [startOfMonth(subMonths(now, 1)), endOfMonth(subMonths(now, 1))];
  if (r === "three") return [startOfMonth(subMonths(now, 2)), now];
  if (r === "sept") {
    const y = now.getMonth() >= 8 ? now.getFullYear() : now.getFullYear() - 1;
    return [new Date(y, 8, 1), now];
  }
  return [startOfDay(new Date(from)), endOfDay(new Date(to))];
}

export function ExportPage() {
  const viewer = useViewer();
  const { options, branchId } = useBranch();
  const superAdmin = isSuper(viewer);
  const allowed = options.filter((o) => superAdmin || isAdminOf(viewer, o.id) || hasGrant(viewer, o.id, "export.run"));
  const [chosen, setChosen] = useState<string[]>(() => (branchId && allowed.some((o) => o.id === branchId) ? [branchId] : superAdmin ? [] : allowed.slice(0, 1).map((o) => o.id)));
  const [types, setTypes] = useState<IssueType[]>(["ticket", "action", "report", "event"]);
  const [range, setRange] = useState<Range>("this");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);

  if (!allowed.length) return <EmptyState title="You can't export from any branch." />;
  const wholeSchool = superAdmin && chosen.length === 0;

  const run = async () => {
    const [a, b] = rangeOf(range, from, to);
    if (b <= a) return toast.error("The end date must be after the start date.");
    setBusy(true);
    try {
      const res = await fetch(
        `/api/exports${qs({
          branch_ids: wholeSchool ? undefined : chosen.join(","),
          types: types.length === 4 ? undefined : types.join(","),
          from: a.toISOString(),
          to: b.toISOString(),
        })}`,
        { credentials: "same-origin" },
      );
      if (!res.ok) {
        let code = "internal_error";
        try {
          code = (await res.json()).error.code;
        } catch {
          // not JSON
        }
        throw new ApiError(res.status, code, "", res.headers.get("x-request-id"));
      }
      const blob = await res.blob();
      const name = res.headers.get("content-disposition")?.match(/filename="([^"]+)"/)?.[1] ?? "export.xlsx";
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = name;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast.success("Export downloaded");
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  return (
    <div className="mx-auto max-w-[760px]">
      <PageHeader title="Export to Excel" subtitle="Tickets, actions, reports and events for a date range." />
      <Card className="space-y-8 p-6">
        <fieldset>
          <legend className="mb-3 text-[17px] font-semibold">Branches</legend>
          {allowed.length === 1 && !superAdmin ? (
            <p>{allowed[0].name}</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {superAdmin && (
                <Chip active={wholeSchool} onClick={() => setChosen([])}>
                  Whole school
                </Chip>
              )}
              {allowed.map((o) => (
                <Chip key={o.id} active={chosen.includes(o.id)} onClick={() => setChosen(superAdmin ? toggle(chosen, o.id) : [o.id])}>
                  {o.name}
                </Chip>
              ))}
            </div>
          )}
          {!superAdmin && allowed.length > 1 && <p className="mt-2 text-[14px] text-text-3">Only super admins can export several branches at once.</p>}
        </fieldset>
        <fieldset>
          <legend className="mb-3 text-[17px] font-semibold">Include</legend>
          <div className="flex flex-wrap gap-4">
            {(["ticket", "action", "report", "event"] as IssueType[]).map((t) => (
              <label key={t} className="inline-flex items-center gap-2">
                <input type="checkbox" className="size-5" checked={types.includes(t)} onChange={() => setTypes(toggle(types, t))} />
                {typePlural[t]}
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend className="mb-3 text-[17px] font-semibold">Dates</legend>
          <div className="flex flex-wrap gap-2">
            {(
              [
                ["this", "This month"],
                ["last", "Last month"],
                ["three", "Last 3 months"],
                ["sept", "Since 1 September"],
                ["custom", "Custom"],
              ] as [Range, string][]
            ).map(([v, l]) => (
              <Chip key={v} active={range === v} onClick={() => setRange(v)}>
                {l}
              </Chip>
            ))}
          </div>
          {range === "custom" && (
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <Field label="From">{(p) => <input {...p} type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={inputClass} />}</Field>
              <Field label="To">{(p) => <input {...p} type="date" value={to} onChange={(e) => setTo(e.target.value)} className={inputClass} />}</Field>
            </div>
          )}
        </fieldset>
        <p className="rounded-[10px] bg-sunken px-4 py-3 text-text-2">Private items and staff-only comments are included only if you can see them. This export is recorded in the history.</p>
        <Button
          variant="primary"
          size="lg"
          className={cx("w-full")}
          icon={<Download className="size-5" />}
          loading={busy}
          disabled={!types.length || (!wholeSchool && !chosen.length) || (range === "custom" && (!from || !to))}
          onClick={run}
        >
          {busy ? "Preparing your file…" : "Download Excel file"}
        </Button>
      </Card>
    </div>
  );
}
