// Admin screens always work on one branch (UX_SPEC §3.3, D-07). In "all" they
// show their own branch picker, defaulting to the first branch I may manage.
import { useState } from "react";
import { useBranch } from "@/app/BranchContext";
import { hasGrant, isAdminOf, membership, type Viewer } from "@/lib/can";
import type { Permission } from "@/api/types";
import { cx, inputClass } from "@/components/ui";
import { guard } from "@/lib/unsaved";
import { t } from "@/i18n";

/** `withHeads`: also branches where the viewer heads a department. */
export function useManagedBranch(viewer: Viewer, perm?: Permission, preferred?: string, withHeads = false) {
  const { branchId, options } = useBranch();
  const manageable = options.filter(
    (o) => isAdminOf(viewer, o.id) || (perm && hasGrant(viewer, o.id, perm)) || (withHeads && !!membership(viewer, o.id)?.heads.length),
  );
  const [picked, setPicked] = useState<string | undefined>(preferred);
  const current = branchId && manageable.some((o) => o.id === branchId) ? branchId : picked ?? manageable[0]?.id;
  const picker =
    !branchId && manageable.length > 1 ? (
      <select
        value={current}
        onChange={(e) => {
          const next = e.target.value;
          guard(() => setPicked(next));
        }}
        className={cx(inputClass, "h-11 w-auto")}
        aria-label={t("Branch")}
      >
        {manageable.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
    ) : null;
  // For pages that build their own picker: the branches it offers, and a raw
  // setter (callers guard unsaved changes themselves).
  const choices = branchId && manageable.some((o) => o.id === branchId) ? manageable.filter((o) => o.id === branchId) : manageable;
  return { branchId: current, branch: options.find((o) => o.id === current), picker, manageable, choices, pick: setPicked };
}
