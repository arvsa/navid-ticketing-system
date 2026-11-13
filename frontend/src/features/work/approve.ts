// Approve with a 5-second undo before the call is sent (UX_SPEC §4.5.6, D-10).
//
// Approvals waiting out their Undo window live here, outside any component,
// so leaving the page doesn't drop them: they're sent at once when the tab is
// hidden or closed (with `keepalive`, which outlives the page) and before
// signing out.
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/api/client";
import { keys } from "@/api/keys";
import type { WorkItem } from "@/api/types";
import { errorMessage } from "@/lib/labels";
import { t } from "@/i18n";

type Pending = { items: WorkItem[]; note?: string; timer: ReturnType<typeof setTimeout>; qc: QueryClient };
const pending = new Set<Pending>();

const body = (w: WorkItem, note?: string) => ({ version: w.version, note: note || undefined });

async function send(p: Pending) {
  if (!pending.delete(p)) return; // already sent or undone
  clearTimeout(p.timer);
  for (const w of p.items) {
    try {
      await api.post(`/work-items/${w.id}/approve`, body(w, p.note));
    } catch (e) {
      toast.error(errorMessage(e));
    }
    p.qc.invalidateQueries({ queryKey: keys.issue(w.issue_id) });
    p.qc.invalidateQueries({ queryKey: keys.history(w.issue_id) });
  }
  p.qc.invalidateQueries({ queryKey: keys.workItems });
  p.qc.invalidateQueries({ queryKey: ["issues", "list"] });
  p.qc.invalidateQueries({ queryKey: ["dashboard"] });
}

/** Sends every approval still in its Undo window now (before signing out). */
export async function flushApprovals() {
  await Promise.all([...pending].map(send));
}

// The page is going away: fire the requests so they finish without it.
if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => {
    for (const p of pending) {
      clearTimeout(p.timer);
      for (const w of p.items)
        fetch(`/api/work-items/${w.id}/approve`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify(body(w, p.note)),
          credentials: "same-origin",
          keepalive: true,
        });
    }
    pending.clear();
  });
}

export function useApproveWithUndo() {
  const qc = useQueryClient();
  return (items: WorkItem[], note: string | undefined, label: string) => {
    const p: Pending = { items, note, qc, timer: setTimeout(() => send(p), 5000) };
    pending.add(p);
    const id = toast.success(label, {
      duration: 5000,
      action: {
        label: t("Undo"),
        onClick: () => {
          if (!pending.delete(p)) return;
          clearTimeout(p.timer);
          toast.dismiss(id);
          toast(t("Not approved"));
        },
      },
    });
  };
}
