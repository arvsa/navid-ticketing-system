// Sign in, and the forced "Choose your own password" screen (UX_SPEC §4.1).
import { useEffect, useState, type ReactNode } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { Eye, EyeOff } from "lucide-react";
import { ApiError } from "@/api/client";
import { useChangePassword, useLogin, useLogout, useMe, takeTemporaryPassword } from "@/auth/session";
import { Button, Field, inputClass } from "@/components/ui";
import { APP_NAME, errorMessage } from "@/lib/labels";

function AuthCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-4 py-10">
      <div className="w-full max-w-[420px] rounded-[16px] border border-border bg-surface p-6 shadow-2 sm:p-8">
        <div className="mb-6 flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-[10px] bg-[#2f55d4] font-bold text-white">ST</span>
          <span className="text-[18px] font-semibold">{APP_NAME}</span>
        </div>
        <h1 className="mb-5 text-[24px] font-bold">{title}</h1>
        {children}
      </div>
    </div>
  );
}

function PasswordInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input {...props} type={show ? "text" : "password"} className={`${inputClass} pr-11`} />
      <button
        type="button"
        onClick={() => setShow(!show)}
        className="absolute top-1/2 right-2 -translate-y-1/2 rounded-md p-1.5 text-text-3 hover:bg-sunken"
        aria-label={show ? "Hide password" : "Show password"}
      >
        {show ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
      </button>
    </div>
  );
}

export function SignInPage() {
  const search = useSearch({ from: "/sign-in" });
  const navigate = useNavigate();
  const login = useLogin();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const submit = (e: { preventDefault(): void }) => {
    e.preventDefault();
    login.mutate(
      { email: email.trim(), password },
      {
        onSuccess: (me) => {
          if (me.user.must_change_password) navigate({ to: "/change-password" });
          else if (search.redirect?.startsWith("/") && !search.redirect.startsWith("/sign-in")) window.location.assign(search.redirect);
          else navigate({ to: "/" });
        },
      },
    );
  };

  return (
    <AuthCard title="Sign in">
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field label="Email">
          {(p) => (
            <input
              {...p}
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={login.isPending}
              className={inputClass}
            />
          )}
        </Field>
        <Field label="Password">
          {(p) => (
            <PasswordInput
              {...p}
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={login.isPending}
            />
          )}
        </Field>
        {login.error && (
          <p role="alert" className="rounded-[10px] bg-danger-soft px-3 py-2 text-[14px] text-danger">
            {errorMessage(login.error)}
          </p>
        )}
        <Button type="submit" variant="primary" size="lg" className="w-full" loading={login.isPending} disabled={!email || !password}>
          {login.isPending ? "Signing in…" : "Sign in"}
        </Button>
        <p className="text-[14px] text-text-2">
          <span className="font-semibold">Forgot your password?</span> Ask your branch admin to reset it.
        </p>
      </form>
    </AuthCard>
  );
}

/** The forced "Choose your own password" screen. It never asks for the current
 * password: the temporary one typed at sign-in is sent for the person. If it's
 * no longer in memory (the page was reloaded), they sign in again instead. */
export function ChangePasswordPage() {
  const me = useMe();
  const change = useChangePassword();
  const logout = useLogout();
  const navigate = useNavigate();
  const temp = takeTemporaryPassword();
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const status = (me.error as ApiError | null)?.status;
  const notForced = me.data && !me.data.user.must_change_password && !change.isPending;

  useEffect(() => {
    if (status === 401) navigate({ to: "/sign-in", search: {} });
    else if (notForced) navigate({ to: "/" });
  }, [status, notForced, navigate]);
  if (status === 401 || notForced) return null;

  if (!temp) {
    return (
      <AuthCard title="Choose your own password">
        <p className="mb-5 text-text-2">To keep your account safe, sign in again with your temporary password, then choose your own.</p>
        <Button variant="primary" size="lg" className="w-full" loading={logout.isPending} onClick={() => logout.mutate()}>
          Sign in again
        </Button>
      </AuthCard>
    );
  }

  const submit = (e: { preventDefault(): void }) => {
    e.preventDefault();
    setLocalError(null);
    if (next.length < 8 || next.length > 128) return setLocalError("Use 8 to 128 characters.");
    if (next !== confirm) return setLocalError("The two passwords don't match.");
    change.mutate({ current_password: temp, new_password: next }, { onSuccess: () => navigate({ to: "/" }) });
  };
  const code = (change.error as ApiError | null)?.code;
  const serverError =
    code === "password_unchanged"
      ? "Pick a password different from the temporary one."
      : code === "invalid_current_password"
        ? "Your temporary password has expired. Sign out and ask your admin for a new one."
        : change.error
          ? errorMessage(change.error)
          : null;

  return (
    <AuthCard title="Choose your own password">
      <p className="mb-5 text-text-2">You signed in with a temporary password. Pick a new one that only you know.</p>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field label="New password" hint="8 to 128 characters." error={localError}>
          {(p) => <PasswordInput {...p} autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />}
        </Field>
        <Field label="Confirm new password">
          {(p) => <PasswordInput {...p} autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />}
        </Field>
        {serverError && (
          <p role="alert" className="rounded-[10px] bg-danger-soft px-3 py-2 text-[14px] text-danger">
            {serverError}
          </p>
        )}
        <Button type="submit" variant="primary" size="lg" className="w-full" loading={change.isPending}>
          Save and continue
        </Button>
        <button type="button" className="w-full text-center text-[14px] text-primary hover:underline" onClick={() => logout.mutate()}>
          Sign out
        </button>
      </form>
    </AuthCard>
  );
}
