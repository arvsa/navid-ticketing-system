// Export to Excel (UX_SPEC §4.14). Downloaded with fetch so JSON errors such as
// export_too_large can be shown.
import { useState } from "react";
import { Download } from "lucide-react";
import { toast } from "sonner";
import { addDays, endOfDay, startOfDay } from "date-fns";
import { ApiError, qs } from "@/api/client";
import type { IssueType } from "@/api/types";
import { useBranch } from "@/app/BranchContext";
import { Button, Card, Chip, EmptyState, Field, PageHeader, cx } from "@/components/ui";
import { hasGrant, isAdminOf, isSuper } from "@/lib/can";
import { errorMessage, typePlural } from "@/lib/labels";
import { useViewer } from "@/lib/useViewer";
import { calendar, t } from "@/i18n";
import { addMonthsTo, dateIn, monthOf } from "@/lib/dates";
import { DateInput } from "@/components/DateInput";

type Range = "this" | "last" | "three" | "sept" | "custom";

function rangeOf(r: Range, from: string, to: string): [Date, Date] {
  // Months follow the reader's calendar; the school year starts 1 September, or 1 Mehr.
  const now = new Date();
  const month = monthOf(now);
  if (r === "this") return [dateIn(month, 1), now];
  if (r === "last") return [dateIn(addMonthsTo(month, -1), 1), endOfDay(addDays(dateIn(month, 1), -1))];
  if (r === "three") return [dateIn(addMonthsTo(month, -2), 1), now];
  if (r === "sept") {
    const startMonth = calendar === "persian" ? 7 : 9;
    const y = month.m >= startMonth ? month.y : month.y - 1;
    return [dateIn({ y, m: startMonth }, 1), now];
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

  if (!allowed.length) return <EmptyState title={t("You can't export from any branch.")} />;
  const wholeSchool = superAdmin && chosen.length === 0;

  const run = async () => {
    const [a, b] = rangeOf(range, from, to);
    if (b <= a) return toast.error(t("The end date must be after the start date."));
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
      toast.success(t("Export downloaded"));
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  return (
    <div className="mx-auto max-w-[760px]">
      <PageHeader title={t("Export to Excel")} subtitle={t("Tickets, actions, reports and events for a date range.")} />
      <Card className="space-y-8 p-6">
        <fieldset>
          <legend className="mb-3 text-[17px] font-semibold">{t("Branches")}</legend>
          {allowed.length === 1 && !superAdmin ? (
            <p>{allowed[0].name}</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {superAdmin && (
                <Chip active={wholeSchool} onClick={() => setChosen([])}>
                  {t("Whole school")}
                </Chip>
              )}
              {allowed.map((o) => (
                <Chip key={o.id} active={chosen.includes(o.id)} onClick={() => setChosen(superAdmin ? toggle(chosen, o.id) : [o.id])}>
                  {o.name}
                </Chip>
              ))}
            </div>
          )}
          {!superAdmin && allowed.length > 1 && <p className="mt-2 text-[14px] text-text-3">{t("Only super admins can export several branches at once.")}</p>}
        </fieldset>
        <fieldset>
          <legend className="mb-3 text-[17px] font-semibold">{t("Include")}</legend>
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
          <legend className="mb-3 text-[17px] font-semibold">{t("Dates")}</legend>
          <div className="flex flex-wrap gap-2">
            {(
              [
                ["this", t("This month")],
                ["last", t("Last month")],
                ["three", t("Last 3 months")],
                ["sept", calendar === "persian" ? t("Since 1 Mehr") : t("Since 1 September")],
                ["custom", t("Custom")],
              ] as [Range, string][]
            ).map(([v, l]) => (
              <Chip key={v} active={range === v} onClick={() => setRange(v)}>
                {l}
              </Chip>
            ))}
          </div>
          {range === "custom" && (
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <Field label={t("From")}>{(p) => <DateInput {...p} mode="date" value={from} onChange={setFrom} />}</Field>
              <Field label={t("To")}>{(p) => <DateInput {...p} mode="date" value={to} onChange={setTo} />}</Field>
            </div>
          )}
        </fieldset>
        <p className="rounded-[10px] bg-sunken px-4 py-3 text-text-2">{t("Private items and staff-only comments are included only if you can see them. This export is recorded in the history.")}</p>
        <Button
          variant="primary"
          size="lg"
          className={cx("w-full")}
          icon={<Download className="size-5" />}
          loading={busy}
          disabled={!types.length || (!wholeSchool && !chosen.length) || (range === "custom" && (!from || !to))}
          onClick={run}
        >
          {busy ? t("Preparing your file…") : t("Download Excel file")}
        </Button>
      </Card>
    </div>
  );
}
