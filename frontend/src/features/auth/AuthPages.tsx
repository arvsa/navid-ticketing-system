// Sign in, and the forced "Choose your own password" screen (UX_SPEC §4.1).
import { useEffect, useState, type ReactNode } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { CalendarDays, Eye, EyeOff, Languages, ListChecks, MessageCircleQuestion } from "lucide-react";
import { ApiError } from "@/api/client";
import { useChangePassword, useLogin, useLogout, useMe, takeTemporaryPassword } from "@/auth/session";
import { Button, Field, inputClass } from "@/components/ui";
import { BrandMark, Butterfly } from "@/components/brand";
import { APP_NAME, errorMessage, typePlural } from "@/lib/labels";
import { useSchoolName } from "@/lib/useSchoolName";
import { lang, setLang, t } from "@/i18n";

/** The school's side of the page: logo, motto and what the app is for. On
 * phones it shrinks to a band above the form. */
function BrandPanel() {
  const schoolName = useSchoolName();
  const features = [
    { icon: <MessageCircleQuestion className="size-4" />, label: typePlural.ticket },
    { icon: <ListChecks className="size-4" />, label: typePlural.action },
    { icon: <CalendarDays className="size-4" />, label: typePlural.event },
  ];
  return (
    <section
      className="relative isolate overflow-hidden px-6 pt-8 pb-10 text-white sm:px-10 lg:flex lg:w-[46%] lg:flex-col lg:px-14 lg:py-12"
      style={{ background: "linear-gradient(155deg, var(--brand-deep) 0%, var(--brand) 55%, #0b7d6c 100%)" }}
    >
      {/* The dark flag from the logo, and soft rings behind everything. */}
      <svg viewBox="0 0 400 400" className="absolute -end-24 -bottom-28 -z-10 w-[420px] text-brand-ink opacity-30 rtl:-scale-x-100 lg:w-[560px]" aria-hidden>
        <path d="M60 340 L260 60 L360 60 L360 340 Z" fill="currentColor" />
      </svg>
      <svg viewBox="0 0 200 200" className="absolute -start-20 -top-20 -z-10 w-[320px] opacity-[0.12]" aria-hidden>
        <circle cx="100" cy="100" r="60" fill="none" stroke="white" strokeWidth="1.5" />
        <circle cx="100" cy="100" r="80" fill="none" stroke="white" strokeWidth="1" />
        <circle cx="100" cy="100" r="98" fill="none" stroke="white" strokeWidth="0.75" />
      </svg>
      <Butterfly className="drift absolute end-[12%] top-[18%] -z-10 hidden w-14 text-brand-cream opacity-80 lg:block" />
      <Butterfly className="drift-slow absolute end-[30%] top-[52%] -z-10 hidden w-8 text-brand-teal lg:block" />
      <Butterfly className="drift absolute start-[8%] bottom-[14%] -z-10 hidden w-10 text-brand-cream opacity-40 lg:block" />

      <div className="flex items-center gap-3">
        <BrandMark size={52} className="rounded-[14px] shadow-2" />
        <div className="leading-tight">
          <div className="text-[17px] font-bold">{schoolName}</div>
          <div className="text-[14px] text-white/75">{APP_NAME}</div>
        </div>
      </div>

      <div className="mt-8 max-w-[460px] lg:my-auto lg:pt-10">
        <p className="text-[28px] leading-[1.25] font-extrabold sm:text-[34px] lg:text-[44px]">{t("We are all one family.")}</p>
        <svg viewBox="0 0 220 14" className="mt-3 w-40 text-brand-cream lg:w-56" aria-hidden>
          <path d="M2 9C40 2 70 13 110 7S180 2 218 8" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
        </svg>
        <p className="mt-5 hidden text-[17px] leading-relaxed text-white/85 sm:block">
          {t("Requests, tasks and events for every Navid branch, all in one place.")}
        </p>
        <ul className="mt-6 hidden flex-wrap gap-2 sm:flex">
          {features.map((f) => (
            <li key={f.label} className="inline-flex items-center gap-2 rounded-full bg-white/12 px-3.5 py-1.5 text-[14px] font-medium ring-1 ring-white/20 backdrop-blur-sm">
              {f.icon}
              {f.label}
            </li>
          ))}
        </ul>
      </div>

      <p className="mt-10 hidden text-[14px] text-white/70 italic lg:block">{t("You are as beautiful as a butterfly in the making.")}</p>
    </section>
  );
}

function AuthCard({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  const schoolName = useSchoolName();
  return (
    <div className="flex min-h-screen flex-col bg-bg lg:flex-row">
      <BrandPanel />
      <main className="relative flex flex-1 flex-col px-5 py-8 sm:px-10">
        <div className="flex justify-end">
          {/* Shown in the other language, so it can be found without reading this one. */}
          <button
            type="button"
            onClick={() => setLang(lang === "fa" ? "en" : "fa")}
            className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3.5 py-1.5 text-[14px] font-medium text-primary hover:bg-sunken"
            lang={lang === "fa" ? "en" : "fa"}
          >
            <Languages className="size-4" aria-hidden />
            {lang === "fa" ? "English" : "فارسی"}
          </button>
        </div>
        <div className="mx-auto my-auto w-full max-w-[400px] py-10">
          <h1 className="text-[28px] font-extrabold tracking-tight">{title}</h1>
          {subtitle && <p className="mt-1.5 text-text-2">{subtitle}</p>}
          <div className="mt-7">{children}</div>
        </div>
        <p className="text-center text-[13px] text-text-3">{schoolName}</p>
      </main>
    </div>
  );
}

function PasswordInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input {...props} type={show ? "text" : "password"} className={`${inputClass} pe-11`} />
      <button
        type="button"
        onClick={() => setShow(!show)}
        className="absolute top-1/2 end-2 -translate-y-1/2 rounded-md p-1.5 text-text-3 hover:bg-sunken"
        aria-label={show ? t("Hide password") : t("Show password")}
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
    <AuthCard title={t("Welcome back")} subtitle={t("Sign in with the email and password your school gave you.")}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field label={t("Email")}>
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
        <Field label={t("Password")}>
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
          {login.isPending ? t("Signing in…") : t("Sign in")}
        </Button>
        <p className="rounded-[12px] border border-dashed border-border-strong px-4 py-3 text-[14px] text-text-2">
          <span className="font-semibold text-text">{t("Forgot your password?")}</span>{" "}{t("Ask your branch admin to reset it.")}
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
      <AuthCard title={t("Choose your own password")}>
        <p className="mb-5 text-text-2">{t("To keep your account safe, sign in again with your temporary password, then choose your own.")}</p>
        <Button variant="primary" size="lg" className="w-full" loading={logout.isPending} onClick={() => logout.mutate()}>
          {t("Sign in again")}
        </Button>
      </AuthCard>
    );
  }

  const submit = (e: { preventDefault(): void }) => {
    e.preventDefault();
    setLocalError(null);
    if (next.length < 8 || next.length > 128) return setLocalError(t("Use 8 to 128 characters."));
    if (next !== confirm) return setLocalError(t("The two passwords don't match."));
    change.mutate({ current_password: temp, new_password: next }, { onSuccess: () => navigate({ to: "/" }) });
  };
  const code = (change.error as ApiError | null)?.code;
  const serverError =
    code === "password_unchanged"
      ? t("Pick a password different from the temporary one.")
      : code === "invalid_current_password"
        ? t("Your temporary password has expired. Sign out and ask your admin for a new one.")
        : change.error
          ? errorMessage(change.error)
          : null;

  return (
    <AuthCard title={t("Choose your own password")}>
      <p className="mb-5 text-text-2">{t("You signed in with a temporary password. Pick a new one that only you know.")}</p>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field label={t("New password")} hint={t("8 to 128 characters.")} error={localError}>
          {(p) => <PasswordInput {...p} autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />}
        </Field>
        <Field label={t("Confirm new password")}>
          {(p) => <PasswordInput {...p} autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />}
        </Field>
        {serverError && (
          <p role="alert" className="rounded-[10px] bg-danger-soft px-3 py-2 text-[14px] text-danger">
            {serverError}
          </p>
        )}
        <Button type="submit" variant="primary" size="lg" className="w-full" loading={change.isPending}>
          {t("Save and continue")}
        </Button>
        <button type="button" className="w-full text-center text-[14px] text-primary hover:underline" onClick={() => logout.mutate()}>
          {t("Sign out")}
        </button>
      </form>
    </AuthCard>
  );
}
