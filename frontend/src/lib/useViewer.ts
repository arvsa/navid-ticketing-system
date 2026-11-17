import { useSession } from "@/auth/session";
import type { Viewer } from "./can";

/** The signed-in person: memberships, grants, departments and heads all come
 * with `/api/me`. */
export function useViewer(): Viewer {
  return { me: useSession() };
}
