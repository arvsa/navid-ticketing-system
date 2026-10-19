// Going / Maybe / Can't go, optimistic (UX_SPEC §4.5.4).
import { Check } from "lucide-react";
import { toast } from "sonner";
import { useRsvp } from "@/api/hooks";
import type { RsvpResponse } from "@/api/types";
import { cx } from "@/components/ui";
import { errorMessage, rsvpLabel } from "@/lib/labels";
import { t } from "@/i18n";

const CHOICES: RsvpResponse[] = ["going", "maybe", "declined"];

export function RsvpButtons({
  issueId,
  current,
  note,
  disabled,
  size = "md",
}: {
  issueId: string;
  current: RsvpResponse;
  note?: string;
  disabled?: boolean;
  size?: "md" | "lg";
}) {
  const rsvp = useRsvp(issueId);
  const chosen = rsvp.isPending ? rsvp.variables?.response : current;
  return (
    <div role="radiogroup" aria-label={t("Are you coming?")} className="grid grid-cols-3 gap-3">
      {CHOICES.map((r) => {
        const on = chosen === r;
        return (
          <button
            key={r}
            role="radio"
            aria-checked={on}
            disabled={disabled}
            onClick={() =>
              rsvp.mutate(
                { response: r, note: note || undefined },
                {
                  onSuccess: () => toast.success(r === "going" ? t("You're going") : r === "maybe" ? t("Marked as maybe") : t("Marked as can't go")),
                  onError: (e) => toast.error(errorMessage(e)),
                },
              )
            }
            className={cx(
              "flex items-center justify-center gap-2 rounded-[12px] border font-medium disabled:opacity-60",
              size === "lg" ? "h-16 text-[18px]" : "h-12",
              on && r === "going" && "border-2 border-success bg-success-soft font-semibold text-success",
              on && r === "maybe" && "border-2 border-warning-edge bg-warning-soft font-semibold text-warning",
              on && r === "declined" && "border-2 border-text-3 bg-sunken font-semibold",
              !on && "border-border-strong bg-surface hover:bg-surface-2",
            )}
          >
            {on && <Check className="size-5" aria-hidden />}
            {rsvpLabel[r]}
          </button>
        );
      })}
    </div>
  );
}
