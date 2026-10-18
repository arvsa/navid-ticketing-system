// The branch the person is looking at (UX_SPEC §3.3). "all" means every branch
// they belong to; for super admins it means the whole school.
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useBranches } from "@/api/hooks";
import { useSession } from "@/auth/session";
import type { Branch, MembershipView } from "@/api/types";

const STORAGE_KEY = "st.branch";

export type BranchOption = { id: string; code: string; name: string; membership?: MembershipView };

type BranchCtx = {
  /** Current branch, or undefined in "all". */
  branchId: string | undefined;
  branch: BranchOption | undefined;
  isAll: boolean;
  options: BranchOption[];
  /** Branch rows from GET /branches (time zones). */
  branchById: Map<string, Branch>;
  canChooseAll: boolean;
  setBranch: (id: string | "all") => void;
  zoneOf: (branchId?: string | null) => string | undefined;
};

const Ctx = createContext<BranchCtx | null>(null);

function readStored(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function BranchProvider({ children }: { children: ReactNode }) {
  const me = useSession();
  const qc = useQueryClient();
  const branches = useBranches();
  const [stored, setStored] = useState<string | null>(readStored);

  const value = useMemo<BranchCtx>(() => {
    const branchById = new Map((branches.data ?? []).map((b) => [b.id, b]));
    const memberships = new Map(me.memberships.map((m) => [m.branch.id, m]));
    const options: BranchOption[] = me.user.is_super_admin
      ? (branches.data ?? [])
          .filter((b) => b.is_active)
          .map((b) => ({ id: b.id, code: b.code, name: b.name, membership: memberships.get(b.id) }))
      : me.memberships.map((m) => ({ ...m.branch, membership: m }));
    const canChooseAll = me.user.is_super_admin || options.length > 1;
    let current: string | "all" | undefined = stored ?? undefined;
    if (current === "all" && !canChooseAll) current = undefined;
    if (current && current !== "all" && !options.some((o) => o.id === current)) current = undefined;
    if (!current) current = me.user.is_super_admin ? "all" : options[0]?.id ?? "all";
    const branch = current === "all" ? undefined : options.find((o) => o.id === current);
    return {
      branchId: branch?.id,
      branch,
      isAll: !branch,
      options,
      branchById,
      canChooseAll,
      setBranch: (id) => {
        try {
          localStorage.setItem(STORAGE_KEY, id);
        } catch {
          // storage unavailable: keep it for this tab only
        }
        setStored(id);
        qc.invalidateQueries({ queryKey: ["dashboard"] });
      },
      zoneOf: (id) => (id ? branchById.get(id)?.timezone : undefined),
    };
  }, [me, branches.data, stored, qc]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useBranch() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useBranch outside BranchProvider");
  return v;
}
