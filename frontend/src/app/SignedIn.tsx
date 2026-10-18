// Everything inside here has /me loaded and a live connection.
import { Outlet, useRouter } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { LiveProvider } from "@/realtime/live";
import { useMe } from "@/auth/session";
import { BranchProvider } from "./BranchContext";

export function SignedIn() {
  const me = useMe();
  const qc = useQueryClient();
  const router = useRouter();
  if (!me.data) return null;
  return (
    <LiveProvider
      onSessionEnded={() => {
        qc.clear();
        toast("You were signed out. Please sign in again.");
        router.navigate({ to: "/sign-in", search: { redirect: location.pathname } });
      }}
    >
      <BranchProvider>
        <Outlet />
      </BranchProvider>
    </LiveProvider>
  );
}
