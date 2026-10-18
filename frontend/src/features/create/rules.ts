import type { IssueType } from "@/api/types";
import { hasGrant, isAdminOf, isSuper, type Viewer } from "@/lib/can";

export { canSendType, creatableTypes, isSuper } from "@/lib/can";

export function canSetPrivateIn(v: Viewer, branchId: string | null, type?: IssueType) {
  if (isSuper(v)) return true;
  if (!branchId) return false;
  return isAdminOf(v, branchId) || hasGrant(v, branchId, "issue.set_private", type);
}
