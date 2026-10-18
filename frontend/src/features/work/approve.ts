// Approve with a 5-second undo before the call is sent (UX_SPEC §4.5.6, D-10).
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/api/client";
import { keys } from "@/api/keys";
import type { WorkItem } from "@/api/types";
import { errorMessage } from "@/lib/labels";

export function useApproveWithUndo() {
  const qc = useQueryClient();
  return (items: WorkItem[], note: string | undefined, label: string) => {
    let undone = false;
    const id = toast.success(label, {
      duration: 5000,
      action: { label: "Undo", onClick: () => (undone = true) },
    });
    setTimeout(async () => {
      if (undone) {
        toast.dismiss(id);
        toast("Not approved");
        return;
      }
      for (const w of items) {
        try {
          await api.post(`/work-items/${w.id}/approve`, { version: w.version, note: note || undefined });
        } catch (e) {
          toast.error(errorMessage(e));
        }
        qc.invalidateQueries({ queryKey: keys.issue(w.issue_id) });
        qc.invalidateQueries({ queryKey: keys.history(w.issue_id) });
      }
      qc.invalidateQueries({ queryKey: keys.workItems });
      qc.invalidateQueries({ queryKey: ["issues", "list"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    }, 5000);
  };
}
