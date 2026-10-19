// The inline primary button for one assignment in lists (Start / Continue /
// Write report / Send for approval / I'll take it), from the §4.6 matrix.
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { useTransition } from "@/api/hooks";
import type { IssueDetail, WorkItem } from "@/api/types";
import { Button } from "@/components/ui";
import { canClaim, isMine, type Viewer } from "@/lib/can";
import { numberOf } from "@/lib/items";
import { errorMessage } from "@/lib/labels";
import { t } from "@/i18n";

export function WorkButton({
  issue,
  work,
  viewer,
  size = "md",
  wide,
}: {
  issue?: IssueDetail;
  work: WorkItem;
  viewer: Viewer;
  size?: "sm" | "md" | "lg";
  wide?: boolean;
}) {
  const tr = useTransition();
  const navigate = useNavigate();
  if (!issue || issue.state !== "open") return null;
  const n = numberOf(issue.key);
  const run = (transition: "start" | "claim" | "unblock", done: string) =>
    tr.mutate(
      { item: work, transition },
      {
        onSuccess: () => toast.success(done),
        onError: (e) => toast.error(errorMessage(e)),
      },
    );
  const cls = wide ? "w-full" : undefined;
  if (isMine(viewer, work)) {
    if (work.status === "open")
      return (
        <Button size={size} variant={wide ? "primary" : "secondary"} className={cls} loading={tr.isPending} onClick={() => run("start", t("Started"))}>
          {t("Start")}
        </Button>
      );
    if (work.status === "blocked")
      return (
        <Button size={size} className={cls} loading={tr.isPending} onClick={() => run("unblock", t("Back in progress"))}>
          {t("Continue")}
        </Button>
      );
    if (work.status === "in_progress")
      return (
        <Button size={size} className={cls} onClick={() => navigate({ to: "/items/$number/mine", params: { number: n } })}>
          {issue.type === "report" ? t("Continue report") : t("Send for approval")}
        </Button>
      );
    return null;
  }
  if (canClaim(viewer, issue, work))
    return (
      <Button size={size} className={cls} loading={tr.isPending} onClick={() => run("claim", t("It's yours now"))}>
        {t("I'll take it")}
      </Button>
    );
  return null;
}
