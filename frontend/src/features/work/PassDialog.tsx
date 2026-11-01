// Passing on what you hold: work (to someone in its branch, who hands it in
// to you for review) or a question you were asked (to someone who answers
// instead of you).
import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/api/client";
import { useTransition } from "@/api/hooks";
import { keys } from "@/api/keys";
import type { IssueDetail, WorkItem } from "@/api/types";
import { PersonSelect } from "@/components/pickers";
import { Button, Dialog } from "@/components/ui";
import { numberOf } from "@/lib/items";
import { errorMessage } from "@/lib/labels";
import { useViewer } from "@/lib/useViewer";
import { usePeople } from "@/people/usePeople";
import { t } from "@/i18n";

export function PassDialog({ issue, work, open, onOpenChange }: { issue: IssueDetail; work?: WorkItem; open: boolean; onOpenChange: (v: boolean) => void }) {
  const viewer = useViewer();
  const people = usePeople();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const tr = useTransition();
  const [pick, setPick] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const me = viewer.me.user.id;
  // Work stays in its branch; a question goes to someone in the branch it was asked in.
  const branchId = work?.branch_id ?? issue.targets.find((x) => x.kind === "user" && x.user_id === me)?.branch_id ?? issue.branch_id ?? "";
  // Never back up the chain, nor to yourself.
  const above = work ? work.handoff_chain.slice(0, Math.max(0, work.handoff_chain.indexOf(me))) : [];
  // A question skips the people already asked.
  const asked = work ? [] : issue.targets.filter((x) => x.kind === "user").map((x) => x.user_id ?? "");
  const exclude = [me, ...above, ...asked];

  const done = (name: string) => {
    toast.success(t("Passed to {name}", { name }));
    setPick(null);
    onOpenChange(false);
    // It isn't yours to work on any more: show the item, where you follow it.
    if (work) navigate({ to: "/items/$number", params: { number: numberOf(issue.key) } });
  };
  const pass = async () => {
    if (!pick) return;
    const name = people.short(pick);
    if (work) {
      tr.mutate({ item: work, transition: "pass", assignee_id: pick }, { onSuccess: () => done(name), onError: (e) => toast.error(errorMessage(e)) });
      return;
    }
    setBusy(true);
    try {
      await api.post(`/issues/${issue.id}/pass`, { user_id: pick });
      qc.invalidateQueries({ queryKey: keys.issue(issue.id) });
      done(name);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={work ? t("Pass this work on") : t("Pass this question on")}
      description={
        work
          ? t("They do the work and hand it in to you. You review it before it goes on.")
          : t("They answer instead of you. You can still follow the conversation.")
      }
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>{t("Cancel")}</Button>
          <Button variant="primary" disabled={!pick} loading={tr.isPending || busy} onClick={pass}>
            {t("Pass it on")}
          </Button>
        </>
      }
    >
      <PersonSelect people={people.inBranch(branchId)} value={pick} onChange={setPick} exclude={exclude} />
    </Dialog>
  );
}
