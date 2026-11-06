// Profile (UX_SPEC §4.16): who I am (cover, name, bio), my branches and
// groups, password, theme, language and calendar.
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Camera, Pencil, Shield, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api, request } from "@/api/client";
import { keys } from "@/api/keys";
import type { MeResponse, MyProfilePatch } from "@/api/types";
import { useChangePassword, useLogout, useSession } from "@/auth/session";
import { getTheme, setTheme, type Theme } from "@/app/theme";
import { Avatar, Cover } from "@/components/badges";
import { Button, Card, Field, Segmented, cx, inputClass } from "@/components/ui";
import { formatDateTime } from "@/lib/dates";
import { errorMessage } from "@/lib/labels";
import { useGroupDirectory } from "@/lib/items";
import { useViewer } from "@/lib/useViewer";
import { calendar, lang, localeTag, num, setCalendar, setLang, t, type CalendarSystem, type Lang } from "@/i18n";

const BIO_MAX = 500;
const COVER_MAX_BYTES = 5 * 1024 * 1024;
const AVATAR_MAX_BYTES = 2 * 1024 * 1024;

/** The top of the page: cover, picture, name, roles and bio. */
function ProfileHero() {
  const me = useSession();
  const u = me.user;
  const qc = useQueryClient();
  const [editingName, setEditingName] = useState(false);
  const [first, setFirst] = useState(u.first_name);
  const [last, setLast] = useState(u.last_name);
  const [editingBio, setEditingBio] = useState(false);
  const [bio, setBio] = useState(u.bio ?? "");
  const save = useMutation({
    mutationFn: (patch: MyProfilePatch) => api.patch<MeResponse>("/me", patch),
    onSuccess: (res) => (qc.setQueryData(keys.me, res), toast.success(t("Saved")), setEditingName(false), setEditingBio(false)),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const cover = useMutation({
    mutationFn: (file: File | null) => {
      if (!file) return api.del("/me/cover");
      const form = new FormData();
      form.append("file", file);
      return request<void>("PUT", "/me/cover", { form });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.me }),
    onError: (e) => toast.error(errorMessage(e)),
  });
  const avatar = useMutation({
    mutationFn: (file: File | null) => {
      if (!file) return api.del("/me/avatar");
      const form = new FormData();
      form.append("file", file);
      return request<void>("PUT", "/me/avatar", { form });
    },
    onSuccess: (_, file) => {
      qc.invalidateQueries({ queryKey: keys.me });
      qc.invalidateQueries({ queryKey: keys.avatars });
      toast.success(file ? t("Profile picture updated") : t("Profile picture removed"));
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const adminOf = me.memberships.filter((m) => m.is_admin);

  return (
    <Card className="overflow-hidden">
      <div className="relative h-40 sm:h-56">
        <Cover userId={u.id} version={u.cover_version} className="absolute inset-0 size-full" />
        <div className="absolute end-3 top-3 z-10 flex gap-2">
          <label className={cx("inline-flex h-9 cursor-pointer items-center gap-2 rounded-full bg-black/45 px-3.5 text-[14px] font-semibold text-white backdrop-blur hover:bg-black/60", cover.isPending && "pointer-events-none opacity-60")}>
            <Camera className="size-4" />
            {u.cover_version ? t("Change cover") : t("Add a cover")}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="sr-only"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) return;
                if (file.size > COVER_MAX_BYTES) return void toast.error(t("Cover images are limited to 5 MB."));
                cover.mutate(file);
              }}
            />
          </label>
          {u.cover_version && (
            <button onClick={() => cover.mutate(null)} aria-label={t("Remove cover")} className="inline-flex size-9 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur hover:bg-black/60">
              <Trash2 className="size-4" />
            </button>
          )}
        </div>
      </div>

      <div className="px-6 pb-6">
        <div className="-mt-12 flex flex-wrap items-end justify-between gap-3 sm:-mt-14">
          <div className="relative z-10 flex items-end gap-2">
            <label
              className={cx("group relative block cursor-pointer rounded-full bg-surface p-1 shadow-2", avatar.isPending && "pointer-events-none opacity-60")}
              aria-label={u.avatar_version ? t("Change profile picture") : t("Add a profile picture")}
            >
              <Avatar first={u.first_name} last={u.last_name} id={u.id} size={104} />
              <span className="absolute inset-1 flex items-center justify-center rounded-full bg-black/45 text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                <Camera className="size-6" />
              </span>
              <span className="absolute end-1 bottom-1 flex size-8 items-center justify-center rounded-full border-2 border-surface bg-primary text-on-primary group-hover:opacity-0">
                <Camera className="size-4" />
              </span>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="sr-only"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (!file) return;
                  if (file.size > AVATAR_MAX_BYTES) return void toast.error(t("Profile pictures are limited to 2 MB."));
                  avatar.mutate(file);
                }}
              />
            </label>
            {u.avatar_version && (
              <button onClick={() => avatar.mutate(null)} className="mb-1 rounded-full px-2 py-1 text-[13px] text-text-2 hover:bg-sunken hover:text-danger">
                {t("Remove picture")}
              </button>
            )}
          </div>
          {u.is_super_admin && !editingName && (
            <Button size="sm" icon={<Pencil className="size-4" />} onClick={() => (setFirst(u.first_name), setLast(u.last_name), setEditingName(true))}>
              {t("Edit name")}
            </Button>
          )}
        </div>

        {editingName ? (
          <form
            className="mt-4 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
            onSubmit={(e) => (e.preventDefault(), save.mutate({ first_name: first, last_name: last }))}
          >
            <Field label={t("First name")}>{(p) => <input {...p} value={first} onChange={(e) => setFirst(e.target.value)} maxLength={100} className={inputClass} autoFocus />}</Field>
            <Field label={t("Last name")}>{(p) => <input {...p} value={last} onChange={(e) => setLast(e.target.value)} maxLength={100} className={inputClass} />}</Field>
            <div className="flex gap-2">
              <Button onClick={() => setEditingName(false)}>{t("Cancel")}</Button>
              <Button type="submit" variant="primary" loading={save.isPending} disabled={!first.trim() || !last.trim()}>
                {t("Save")}
              </Button>
            </div>
          </form>
        ) : (
          <h1 className="mt-3 text-[28px] leading-tight font-bold tracking-tight break-anywhere sm:text-[32px]">
            {u.first_name} {u.last_name}
          </h1>
        )}
        <p className="mt-1 text-text-2" dir="ltr" style={{ textAlign: "start" }}>
          {u.email}
        </p>

        <div className="mt-3 flex flex-wrap gap-2">
          {u.is_super_admin && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-3 py-1 text-[14px] font-semibold text-accent-on-soft">
              <Shield className="size-3.5" />
              {t("Super admin")}
            </span>
          )}
          {adminOf.map((m) => (
            <span key={m.branch.id} className="inline-flex items-center gap-1.5 rounded-full bg-sunken px-3 py-1 text-[14px]">
              <Shield className="size-3.5 text-text-3" />
              {t("Admin of {branch}", { branch: m.branch.name })}
            </span>
          ))}
          {me.memberships.length > 0 && (
            <span className="rounded-full bg-sunken px-3 py-1 text-[14px] text-text-2">{t("{n} branches", { n: num(me.memberships.length) })}</span>
          )}
        </div>

        <section className="mt-5 border-t border-border pt-5">
          <div className="mb-2 flex items-center justify-between gap-3">
            <h2 className="font-semibold">{t("About")}</h2>
            {!editingBio && u.bio && (
              <Button size="sm" variant="ghost" icon={<Pencil className="size-4" />} onClick={() => (setBio(u.bio ?? ""), setEditingBio(true))}>
                {t("Edit")}
              </Button>
            )}
          </div>
          {editingBio ? (
            <form onSubmit={(e) => (e.preventDefault(), save.mutate({ bio: bio.trim() || null }))} className="space-y-2">
              <textarea
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                maxLength={BIO_MAX}
                rows={4}
                autoFocus
                aria-label={t("About")}
                placeholder={t("What you teach or look after, how to reach you, anything colleagues should know.")}
                className={cx(inputClass, "resize-y")}
              />
              <div className="flex flex-wrap items-center gap-2">
                <span className="me-auto text-[13px] text-text-3 tabular">
                  {num(bio.length)}/{num(BIO_MAX)}
                </span>
                <Button onClick={() => setEditingBio(false)}>{t("Cancel")}</Button>
                <Button type="submit" variant="primary" loading={save.isPending}>
                  {t("Save")}
                </Button>
              </div>
            </form>
          ) : u.bio ? (
            <p className="whitespace-pre-line break-anywhere">{u.bio}</p>
          ) : (
            <button onClick={() => (setBio(""), setEditingBio(true))} className="w-full rounded-[12px] border border-dashed border-border px-4 py-4 text-start text-text-2 hover:border-border-strong hover:text-text">
              {t("Add a short bio so colleagues know who you are.")}
            </button>
          )}
        </section>

        <p className="mt-5 text-[13px] text-text-3">
          {u.last_login_at && `${t("Last signed in {when}", { when: formatDateTime(u.last_login_at) })}`}
          {!u.is_super_admin && ` · ${t("Ask your admin to change your name or email.")}`}
        </p>
      </div>
    </Card>
  );
}

export function ProfilePage() {
  const me = useSession();
  const logout = useLogout();
  const change = useChangePassword();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [theme, setT] = useState<Theme>(getTheme);
  const viewer = useViewer();
  const groups = useGroupDirectory();
  const u = me.user;
  return (
    <div className="mx-auto max-w-[860px] space-y-6">
      <ProfileHero />

      <Card className="p-6">
        <h2 className="mb-1 text-[20px] font-semibold">{t("Your branches and groups")}</h2>
        <p className="mb-4 text-text-2">{t("Work sent to these groups comes to you. Ask an admin if one is missing.")}</p>
        {me.memberships.length === 0 && <p className="text-text-2">{u.is_super_admin ? t("As a super admin you work across every branch.") : t("You aren't a member of any branch.")}</p>}
        <ul className="space-y-4">
          {me.memberships.map((m) => {
            const mine = (viewer.myGroups?.[m.branch.id] ?? []).map((id) => groups.get(id)).filter(Boolean);
            return (
              <li key={m.branch.id}>
                <p className="font-semibold">
                  {m.branch.name} <span className="font-normal text-text-3">· {m.is_admin ? t("Admin") : t("Member")}</span>
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {viewer.myGroups?.[m.branch.id] === undefined ? (
                    <span className="text-text-3">{t("Loading…")}</span>
                  ) : (
                    mine
                      .sort((a, b) => Number(b!.is_default) - Number(a!.is_default) || a!.name.localeCompare(b!.name, localeTag))
                      .map((g) => (
                        <span key={g!.id} className="rounded-full bg-sunken px-3 py-1">
                          {g!.is_default ? t("All members") : g!.name}
                        </span>
                      ))
                  )}
                  {m.is_admin && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-primary-soft px-3 py-1 text-primary-on-soft">
                      <Shield className="size-3.5" />{" "}{t("Branch admin")}
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </Card>

      <Card className="p-6">
        <h2 className="mb-1 text-[20px] font-semibold">{t("Password")}</h2>
        <p className="mb-4 text-text-2">{t("Changing it signs you out on your other devices.")}</p>
        <form
          className="grid gap-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (next.length < 8 || next.length > 128) return toast.error(t("Use 8 to 128 characters."));
            change.mutate(
              { current_password: current, new_password: next },
              { onSuccess: () => (toast.success(t("Password changed")), setCurrent(""), setNext("")), onError: (err) => toast.error(errorMessage(err)) },
            );
          }}
        >
          <Field label={t("Current password")}>{(p) => <input {...p} type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} className={inputClass} />}</Field>
          <Field label={t("New password")} hint={t("8 to 128 characters.")}>
            {(p) => <input {...p} type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} className={inputClass} />}
          </Field>
          <div>
            <Button type="submit" variant="primary" loading={change.isPending} disabled={!current || !next}>
              {t("Change password")}
            </Button>
          </div>
        </form>
      </Card>

      <Card className="flex flex-wrap items-center justify-between gap-4 p-6">
        <div>
          <h2 className="text-[20px] font-semibold">{t("Appearance")}</h2>
          <p className="text-text-2">{t("Follows your device unless you choose.")}</p>
        </div>
        <Segmented<Theme>
          label={t("Theme")}
          value={theme}
          onChange={(t) => (setTheme(t), setT(t))}
          options={[
            { value: "system", label: t("System") },
            { value: "light", label: t("Light") },
            { value: "dark", label: t("Dark") },
          ]}
        />
      </Card>

      <Card className="space-y-5 p-6">
        <div>
          <h2 className="text-[20px] font-semibold">{t("Language and calendar")}</h2>
          <p className="text-text-2">{t("Saved on this device. The page reloads to apply it.")}</p>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="font-semibold">{t("Language")}</span>
          <Segmented<Lang>
            label={t("Language")}
            value={lang}
            onChange={setLang}
            options={[
              { value: "en", label: <span lang="en">English</span> },
              { value: "fa", label: <span lang="fa">فارسی</span> },
            ]}
          />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="font-semibold">{t("Calendar")}</span>
          <Segmented<CalendarSystem>
            label={t("Calendar")}
            value={calendar}
            onChange={setCalendar}
            options={[
              { value: "gregorian", label: t("Gregorian") },
              { value: "persian", label: t("Persian (Solar Hijri)") },
            ]}
          />
        </div>
      </Card>

      <Button variant="ghost-danger" onClick={() => logout.mutate()}>
        {t("Sign out")}
      </Button>
    </div>
  );
}
