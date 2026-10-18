// id → person, built from the member lists of every branch the viewer can see
// (gap G-2: responses carry user ids only).
import { useQuery } from "@tanstack/react-query";
import { getAll } from "@/api/client";
import { keys } from "@/api/keys";
import type { Member } from "@/api/types";
import { useSession } from "@/auth/session";
import { useBranch } from "@/app/BranchContext";

export type Person = {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  is_active: boolean;
  /** Branches this person is a current member of. */
  branchIds: string[];
  adminOf: string[];
};

export type Directory = {
  get: (id?: string | null) => Person | undefined;
  name: (id?: string | null) => string;
  short: (id?: string | null) => string;
  inBranch: (branchId: string) => Person[];
  all: Person[];
};

export function usePeople(): Directory {
  const me = useSession();
  const { options } = useBranch();
  const branchIds = options.map((o) => o.id).sort();
  const { data } = useQuery({
    queryKey: [...keys.people, branchIds],
    staleTime: 5 * 60_000,
    enabled: branchIds.length > 0,
    queryFn: async () => {
      const map = new Map<string, Person>();
      await Promise.all(
        options.map(async (o) => {
          const canSeeLeft = me.user.is_super_admin || o.membership?.is_admin;
          let members: Member[];
          try {
            members = await getAll<Member>(`/branches/${o.id}/members`, {
              include_left: canSeeLeft || undefined,
            });
          } catch {
            return; // no member.view here
          }
          for (const m of members) {
            const p = map.get(m.user_id) ?? {
              id: m.user_id,
              first_name: m.first_name,
              last_name: m.last_name,
              email: m.email,
              is_active: m.is_active,
              branchIds: [],
              adminOf: [],
            };
            if (!m.left_at) p.branchIds.push(o.id);
            if (m.is_admin && !m.left_at) p.adminOf.push(o.id);
            map.set(m.user_id, p);
          }
        }),
      );
      return map;
    },
  });

  const map = data ?? new Map<string, Person>();
  const self: Person = {
    id: me.user.id,
    first_name: me.user.first_name,
    last_name: me.user.last_name,
    email: me.user.email,
    is_active: true,
    branchIds: me.memberships.map((m) => m.branch.id),
    adminOf: me.memberships.filter((m) => m.is_admin).map((m) => m.branch.id),
  };
  const get = (id?: string | null) => (id === me.user.id ? map.get(id) ?? self : id ? map.get(id) : undefined);
  return {
    get,
    name: (id) => {
      const p = get(id);
      return p ? `${p.first_name} ${p.last_name}`.trim() : "Former member";
    },
    short: (id) => {
      const p = get(id);
      return p ? shortName(p.first_name, p.last_name) : "Former member";
    },
    inBranch: (branchId) => [...map.values()].filter((p) => p.branchIds.includes(branchId)),
    all: [...map.values()],
  };
}

/** "Sara K." */
export function shortName(first: string, last: string) {
  return last ? `${first} ${last[0]}.` : first;
}

export function initials(first?: string, last?: string) {
  return `${first?.[0] ?? ""}${last?.[0] ?? ""}`.toUpperCase() || "?";
}
