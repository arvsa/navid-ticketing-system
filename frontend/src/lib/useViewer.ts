import { useQueries } from "@tanstack/react-query";
import { getAll } from "@/api/client";
import { keys } from "@/api/keys";
import type { Group, Member } from "@/api/types";
import { useSession } from "@/auth/session";
import type { Viewer } from "./can";

/** The signed-in person plus the groups they're in (for "sent to me" checks). */
export function useViewer(): Viewer {
  const me = useSession();
  const results = useQueries({
    queries: me.memberships.map((m) => ({
      queryKey: keys.myGroups(m.branch.id),
      staleTime: 5 * 60_000,
      queryFn: async () => {
        const groups = await getAll<Group>(`/branches/${m.branch.id}/groups`);
        const mine: string[] = [];
        await Promise.all(
          groups.map(async (g) => {
            if (g.is_default) return void mine.push(g.id);
            const members = await getAll<Member>(`/branches/${m.branch.id}/members`, { group_id: g.id });
            if (members.some((x) => x.user_id === me.user.id)) mine.push(g.id);
          }),
        );
        return mine;
      },
    })),
  });
  const myGroups: Record<string, string[] | undefined> = {};
  me.memberships.forEach((m, i) => (myGroups[m.branch.id] = results[i]?.data));
  return { me, myGroups };
}
