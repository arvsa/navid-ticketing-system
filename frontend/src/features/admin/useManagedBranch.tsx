// Admin screens always work on one branch (UX_SPEC §3.3, D-07). In "all" they
// show their own branch picker, defaulting to the first branch I may manage.
import { useState } from "react";
import { useBranch } from "@/app/BranchContext";
import { hasGrant, isAdminOf, type Viewer } from "@/lib/can";
import type { Permission } from "@/api/types";
import { cx, inputClass } from "@/components/ui";
import { t } from "@/i18n";

export function useManagedBranch(viewer: Viewer, perm?: Permission, preferred?: string) {
  const { branchId, options } = useBranch();
  const manageable = options.filter((o) => isAdminOf(viewer, o.id) || (perm && hasGrant(viewer, o.id, perm)));
  const [picked, setPicked] = useState<string | undefined>(preferred);
  const current = branchId && manageable.some((o) => o.id === branchId) ? branchId : picked ?? manageable[0]?.id;
  const picker =
    !branchId && manageable.length > 1 ? (
      <select value={current} onChange={(e) => setPicked(e.target.value)} className={cx(inputClass, "h-11 w-auto")} aria-label={t("Branch")}>
        {manageable.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
    ) : null;
  return { branchId: current, branch: options.find((o) => o.id === current), picker, manageable };
}
