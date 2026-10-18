// Profile (UX_SPEC §4.16): who I am, where, what I can do, password, theme.
import { useState } from "react";
import { Shield } from "lucide-react";
import { toast } from "sonner";
import { useChangePassword, useLogout, useSession } from "@/auth/session";
import { getTheme, setTheme, type Theme } from "@/app/theme";
import { Avatar } from "@/components/badges";
import { Button, Card, Field, PageHeader, Segmented, inputClass } from "@/components/ui";
import { formatDateTime } from "@/lib/dates";
import { errorMessage, permissionInfo, scopeLabel, typeLabel } from "@/lib/labels";

export function ProfilePage() {
  const me = useSession();
  const logout = useLogout();
  const change = useChangePassword();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [theme, setT] = useState<Theme>(getTheme);
  const u = me.user;
  return (
    <div className="mx-auto max-w-[860px] space-y-6">
      <PageHeader title="Your profile" />
      <Card className="flex items-center gap-4 p-6">
        <Avatar first={u.first_name} last={u.last_name} id={u.id} size={56} />
        <div>
          <p className="text-[20px] font-semibold">
            {u.first_name} {u.last_name}
          </p>
          <p className="text-text-2">{u.email}</p>
          <p className="text-[14px] text-text-3">
            {u.is_super_admin && "Super admin · "}
            {u.last_login_at && `Last signed in ${formatDateTime(u.last_login_at)}`} · Ask your admin to change your name or email.
          </p>
        </div>
      </Card>

      <Card className="p-6">
        <h2 className="mb-4 text-[20px] font-semibold">What you can do</h2>
        {me.memberships.length === 0 && <p className="text-text-2">You aren't a member of any branch.</p>}
        <div className="space-y-6">
          {me.memberships.map((m) => (
            <section key={m.branch.id}>
              <h3 className="font-semibold">
                {m.branch.name} <span className="font-normal text-text-3">· {m.is_admin ? "Admin" : "Member"}</span>
              </h3>
              {m.is_admin ? (
                <p className="mt-1 flex items-center gap-2 text-text-2">
                  <Shield className="size-4" /> You can do everything here except school-level tasks.
                </p>
              ) : (
                <ul className="mt-2 grid gap-x-6 gap-y-1 text-text-2 sm:grid-cols-2">
                  {m.grants.map((g, i) => (
                    <li key={i}>
                      {permissionInfo[g.permission]?.title ?? g.permission}
                      <span className="text-text-3">
                        {" "}
                        · {scopeLabel[g.scope].toLowerCase()}
                        {g.issue_type && ` · ${typeLabel[g.issue_type]}s`}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>
      </Card>

      <Card className="p-6">
        <h2 className="mb-1 text-[20px] font-semibold">Password</h2>
        <p className="mb-4 text-text-2">Changing it signs you out on your other devices.</p>
        <form
          className="grid gap-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (next.length < 8 || next.length > 128) return toast.error("Use 8 to 128 characters.");
            change.mutate(
              { current_password: current, new_password: next },
              { onSuccess: () => (toast.success("Password changed"), setCurrent(""), setNext("")), onError: (err) => toast.error(errorMessage(err)) },
            );
          }}
        >
          <Field label="Current password">{(p) => <input {...p} type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} className={inputClass} />}</Field>
          <Field label="New password" hint="8 to 128 characters.">
            {(p) => <input {...p} type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} className={inputClass} />}
          </Field>
          <div>
            <Button type="submit" variant="primary" loading={change.isPending} disabled={!current || !next}>
              Change password
            </Button>
          </div>
        </form>
      </Card>

      <Card className="flex flex-wrap items-center justify-between gap-4 p-6">
        <div>
          <h2 className="text-[20px] font-semibold">Appearance</h2>
          <p className="text-text-2">Follows your device unless you choose.</p>
        </div>
        <Segmented<Theme>
          label="Theme"
          value={theme}
          onChange={(t) => (setTheme(t), setT(t))}
          options={[
            { value: "system", label: "System" },
            { value: "light", label: "Light" },
            { value: "dark", label: "Dark" },
          ]}
        />
      </Card>

      <Button variant="ghost-danger" onClick={() => logout.mutate()}>
        Sign out
      </Button>
    </div>
  );
}
