import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import { keys } from "@/api/keys";
import type { MeResponse } from "@/api/types";

export function useMe() {
  return useQuery({
    queryKey: keys.me,
    queryFn: () => api.get<MeResponse>("/me"),
    retry: false,
    staleTime: 60_000,
  });
}

/** For screens inside the signed-in shell, where /me is always loaded. */
export function useSession(): MeResponse {
  const { data } = useMe();
  if (!data) throw new Error("useSession used outside the signed-in shell");
  return data;
}

// The temporary password typed at sign-in, held in memory only, so the forced
// change screen doesn't ask for it again (UX_SPEC §4.1).
let temporaryPassword: string | null = null;
export const takeTemporaryPassword = () => temporaryPassword;
export const clearTemporaryPassword = () => {
  temporaryPassword = null;
};

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { email: string; password: string }) => api.post<MeResponse>("/auth/login", v),
    onSuccess: (me, v) => {
      qc.clear();
      qc.setQueryData(keys.me, me);
      temporaryPassword = me.user.must_change_password ? v.password : null;
    },
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post("/auth/logout"),
    onSettled: () => {
      clearTemporaryPassword();
      qc.clear();
      window.location.assign("/sign-in");
    },
  });
}

export function useChangePassword() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { current_password: string; new_password: string }) => api.post("/me/password", v),
    // Update the cached flag before anyone navigates, so the password gate
    // doesn't send the person straight back here with stale data.
    onSuccess: async () => {
      qc.setQueryData<MeResponse>(keys.me, (old) => (old ? { ...old, user: { ...old.user, must_change_password: false } } : old));
      await qc.invalidateQueries({ queryKey: keys.me });
      clearTemporaryPassword();
    },
  });
}
