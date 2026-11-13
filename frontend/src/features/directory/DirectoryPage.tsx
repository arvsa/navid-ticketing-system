// The school directory: every branch, its departments and the people in
// them, for everyone. A person opens as a profile card (cover, picture, bio,
// where they work).
import { useMemo, useState, type ReactNode } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { Building2, ChevronRight, Clock, Layers, Mail, Search, Shield, Users } from "lucide-react";
import { useDirectory, useUserProfile } from "@/api/hooks";
import type { DirectoryBranch, DirectoryPerson } from "@/api/types";
import { useBranch } from "@/app/BranchContext";
import { Avatar, Cover } from "@/components/badges";
import { Card, Chip, Dialog, EmptyState, ErrorPanel, LoadingRows, PageHeader, SectionLabel, cx, inputClass } from "@/components/ui";
import type { DirectorySearch } from "@/app/router";
import { localeTag, num, quote, t, tn } from "@/i18n";

/** Where someone works: each branch, whether they run it, their departments. */
type Place = { branch: DirectoryBranch; admin: boolean; departments: string[] };

function placesOf(branches: DirectoryBranch[], userId: string): Place[] {
  return branches.flatMap((b) => {
    const me = b.people.find((p) => p.user_id === userId);
    if (!me) return [];
    return [{ branch: b, admin: me.is_admin, departments: b.groups.filter((g) => g.member_ids.includes(userId)).map((g) => g.name) }];
  });
}

const fullName = (p: { first_name: string; last_name: string }) => `${p.first_name} ${p.last_name}`.trim();

export function DirectoryPage() {
  const search = useSearch({ from: "/authed/shell/directory" });
  const navigate = useNavigate({ from: "/directory" });
  const set = (patch: Partial<DirectorySearch>) => navigate({ search: (s: DirectorySearch) => ({ ...s, ...patch }), replace: true });
  const directory = useDirectory();
  const { branchId } = useBranch();
  const [q, setQ] = useState("");
  const branches = useMemo(() => directory.data ?? [], [directory.data]);
  const selected = branches.find((b) => b.id === search.branch) ?? branches.find((b) => b.id === branchId) ?? branches[0];
  const term = q.trim().toLowerCase();

  const matches = useMemo(() => {
    if (!term) return [];
    const seen = new Set<string>();
    const out: { person: DirectoryPerson; branch: DirectoryBranch }[] = [];
    for (const b of branches)
      for (const p of b.people) {
        const departments = b.groups.filter((g) => g.member_ids.includes(p.user_id)).map((g) => g.name);
        const hay = `${fullName(p)} ${p.email} ${b.name} ${departments.join(" ")}`.toLowerCase();
        if (hay.includes(term) && !seen.has(p.user_id)) {
          seen.add(p.user_id);
          out.push({ person: p, branch: b });
        }
      }
    return out.sort((a, b) => fullName(a.person).localeCompare(fullName(b.person), localeTag));
  }, [term, branches]);

  return (
    <div className="space-y-6">
      <PageHeader title={t("Directory")} subtitle={t("Every branch, its departments and the people in them.")} />
      <div className="relative max-w-[480px]">
        <Search className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-text-3" />
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("Find a person or department in any branch…")}
          aria-label={t("Find a person or department")}
          className={cx(inputClass, "ps-9")}
        />
      </div>

      {directory.isLoading ? (
        <LoadingRows />
      ) : directory.error ? (
        <ErrorPanel error={directory.error} onRetry={() => directory.refetch()} />
      ) : !selected ? (
        <EmptyState title={t("No branches yet.")} />
      ) : term ? (
        matches.length === 0 ? (
          <EmptyState title={t("No one matches {q}.", { q: quote(q.trim()) })} />
        ) : (
          <Card className="overflow-hidden">
            <ul className="divide-y divide-border">
              {matches.map((m) => (
                <li key={m.person.user_id}>
                  <PersonRow person={m.person} note={`${m.branch.name} · ${m.person.email}`} onOpen={(id) => set({ person: id })} />
                </li>
              ))}
            </ul>
          </Card>
        )
      ) : (
        <>
          {/* Toggle buttons (pressed = shown), so a group rather than tabs. */}
          <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none" role="group" aria-label={t("Branches")}>
            {branches.map((b) => (
              <Chip key={b.id} active={b.id === selected.id} onClick={() => set({ branch: b.id })}>
                {b.name}
                <span className="ms-2 opacity-70" aria-hidden>
                  {num(b.people.length)}
                </span>
                <span className="sr-only">
                  {t(", ")}
                  {tn(b.people.length, "{n} person", "{n} people")}
                </span>
              </Chip>
            ))}
          </div>
          <BranchView branch={selected} onOpen={(id) => set({ person: id })} />
        </>
      )}

      {search.person && directory.data && <ProfileDialog userId={search.person} branches={branches} onClose={() => set({ person: undefined })} />}
    </div>
  );
}

function BranchView({ branch, onOpen }: { branch: DirectoryBranch; onOpen: (id: string) => void }) {
  const byId = new Map(branch.people.map((p) => [p.user_id, p]));
  const inSome = new Set(branch.groups.flatMap((g) => g.member_ids));
  const others = branch.people.filter((p) => !inSome.has(p.user_id));
  return (
    <div className="space-y-5">
      <BranchCard branch={branch} onOpen={onOpen} />
      <div className="grid items-start gap-5 lg:grid-cols-2">
        {branch.groups.map((g) => (
          <DepartmentCard
            key={g.id}
            title={g.name}
            description={g.description}
            heads={g.head_ids}
            people={g.member_ids.map((id) => byId.get(id)).filter((p): p is DirectoryPerson => !!p)}
            onOpen={onOpen}
          />
        ))}
        {others.length > 0 && (
          <DepartmentCard
            title={branch.groups.length ? t("Not in a department") : t("Everyone")}
            muted
            people={others}
            onOpen={onOpen}
          />
        )}
      </div>
    </div>
  );
}

/** Local time in the branch, e.g. "10:42". */
function localTime(zone: string) {
  try {
    return new Intl.DateTimeFormat(localeTag, { timeZone: zone, hour: "2-digit", minute: "2-digit" }).format(new Date());
  } catch {
    return "";
  }
}

function BranchCard({ branch, onOpen }: { branch: DirectoryBranch; onOpen: (id: string) => void }) {
  const admins = branch.people.filter((p) => p.is_admin);
  const time = localTime(branch.timezone);
  const stats = [
    { icon: <Users className="size-4" />, value: branch.people.length, label: tn(branch.people.length, "person", "people") },
    { icon: <Layers className="size-4" />, value: branch.groups.length, label: tn(branch.groups.length, "department", "departments") },
    { icon: <Shield className="size-4" />, value: admins.length, label: tn(admins.length, "admin", "admins") },
  ];
  return (
    <Card className="overflow-hidden">
      <div className="relative h-24">
        <Cover userId={branch.id} className="absolute inset-0 size-full" />
      </div>
      <div className="px-6 pb-6">
        <div className="-mt-8 flex flex-wrap items-end gap-4">
          <span className="relative z-10 flex size-16 items-center justify-center rounded-[18px] border-4 border-surface bg-primary-soft text-primary-on-soft shadow-2">
            <Building2 className="size-7" />
          </span>
          <div className="min-w-0 flex-1 pb-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-[22px] leading-tight font-bold break-anywhere">{branch.name}</h2>
              <span className="rounded-md bg-sunken px-2 py-0.5 font-mono text-[13px] text-text-2">{branch.code}</span>
            </div>
          </div>
        </div>

        <dl className="mt-5 grid gap-3 sm:grid-cols-2">
          <InfoRow icon={<Mail className="size-4" />} label={t("Email")}>
            {branch.email ? (
              <a href={`mailto:${branch.email}`} dir="ltr" className="truncate text-primary hover:underline">
                {branch.email}
              </a>
            ) : (
              <span className="text-text-3">{t("No branch email")}</span>
            )}
          </InfoRow>
          <InfoRow icon={<Clock className="size-4" />} label={t("Local time")}>
            <span>
              {time && <b className="tabular">{time}</b>} <span className="text-text-3" dir="ltr">{branch.timezone}</span>
            </span>
          </InfoRow>
        </dl>

        <div className="mt-4 grid grid-cols-3 gap-3">
          {stats.map((x) => (
            <div key={x.label} className="rounded-[14px] bg-sunken px-4 py-3">
              <div className="flex items-center gap-1.5 text-text-3">{x.icon}</div>
              <div className="mt-1 text-[24px] leading-none font-bold tabular">{num(x.value)}</div>
              <div className="mt-1 text-[13px] text-text-2">{x.label}</div>
            </div>
          ))}
        </div>

        {admins.length > 0 && (
          <div className="mt-5 border-t border-border pt-4">
            <SectionLabel className="mb-3">{t("Runs this branch")}</SectionLabel>
            <div className="flex flex-wrap gap-2">
              {admins.map((p) => (
                <button
                  key={p.user_id}
                  type="button"
                  onClick={() => onOpen(p.user_id)}
                  className="inline-flex items-center gap-2 rounded-full border border-border py-1 ps-1 pe-3.5 hover:border-border-strong hover:bg-surface-2"
                >
                  <Avatar first={p.first_name} last={p.last_name} id={p.user_id} size={30} />
                  <span className="font-medium">{fullName(p)}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

function InfoRow({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 items-center gap-3 rounded-[14px] border border-border px-4 py-3">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-sunken text-text-2">{icon}</span>
      <div className="min-w-0">
        <dt className="text-[13px] text-text-3">{label}</dt>
        <dd className="flex min-w-0">{children}</dd>
      </div>
    </div>
  );
}

function DepartmentCard({
  title,
  description,
  people,
  heads = [],
  muted,
  onOpen,
}: {
  title: string;
  description?: string | null;
  people: DirectoryPerson[];
  /** Who runs it: listed first, marked Head. */
  heads?: string[];
  muted?: boolean;
  onOpen: (id: string) => void;
}) {
  return (
    <Card className="overflow-hidden">
      <div className="flex items-start gap-3 border-b border-border px-5 py-4">
        <span className={cx("flex size-10 shrink-0 items-center justify-center rounded-[12px]", muted ? "bg-sunken text-text-3" : "bg-accent-soft text-accent-on-soft")}>
          <Users className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-[17px] font-semibold break-anywhere">{title}</h3>
          <p className="text-[13px] text-text-3">
            {tn(people.length, "{n} person", "{n} people")}
            {description && <span className="text-text-2">{" · "}{description}</span>}
          </p>
        </div>
        <AvatarStack people={people} />
      </div>
      {people.length ? (
        <ul className="divide-y divide-border">
          {[...people].sort((a, b) => Number(heads.includes(b.user_id)) - Number(heads.includes(a.user_id))).map((p) => (
            <li key={p.user_id}>
              <PersonRow person={p} note={heads.includes(p.user_id) ? `${t("Head")} · ${p.email}` : undefined} onOpen={onOpen} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-5 py-4 text-text-3">{t("No one yet.")}</p>
      )}
    </Card>
  );
}

function AvatarStack({ people }: { people: DirectoryPerson[] }) {
  const shown = people.slice(0, 4);
  if (shown.length < 2) return null;
  return (
    <span className="hidden shrink-0 items-center sm:flex" aria-hidden>
      {shown.map((p, i) => (
        <span key={p.user_id} className={cx("rounded-full ring-2 ring-surface", i > 0 && "-ms-2.5")}>
          <Avatar first={p.first_name} last={p.last_name} id={p.user_id} size={28} />
        </span>
      ))}
      {people.length > shown.length && <span className="ms-1.5 text-[13px] text-text-3">+{num(people.length - shown.length)}</span>}
    </span>
  );
}

function PersonRow({ person: p, note, onOpen }: { person: DirectoryPerson; note?: string; onOpen: (id: string) => void }) {
  return (
    <button type="button" onClick={() => onOpen(p.user_id)} className="group flex w-full items-center gap-3 px-5 py-3 text-start hover:bg-surface-2">
      <Avatar first={p.first_name} last={p.last_name} id={p.user_id} size={40} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 font-semibold">
          <span className="truncate">{fullName(p)}</span>
          {p.is_admin && (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-sunken px-2 text-[12px] font-medium text-text-2">
              <Shield className="size-3" />
              {t("Admin")}
            </span>
          )}
        </span>
        <span className="block truncate text-[13px] text-text-3">{note ?? <span dir="ltr">{p.email}</span>}</span>
      </span>
      <ChevronRight className="size-4 shrink-0 text-text-3 opacity-0 transition-opacity group-hover:opacity-100 rtl:-scale-x-100" aria-hidden />
    </button>
  );
}

function ProfileDialog({ userId, branches, onClose }: { userId: string; branches: DirectoryBranch[]; onClose: () => void }) {
  const profile = useUserProfile(userId);
  const places = placesOf(branches, userId);
  const person = places[0] && places[0].branch.people.find((p) => p.user_id === userId);
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()} title={person ? fullName(person) : t("Profile")}>
      {!person ? (
        <p className="text-text-2">{t("This person isn't in any branch.")}</p>
      ) : (
        <div className="-mx-5 -mt-4">
          <div className="relative h-32">
            <Cover userId={userId} version={profile.data?.cover_version} className="absolute inset-0 size-full" />
          </div>
          <div className="px-5">
            <span className="relative z-10 -mt-10 inline-block rounded-full bg-surface p-1 shadow-2">
              <Avatar first={person.first_name} last={person.last_name} id={userId} size={80} />
            </span>
            <h3 className="mt-2 text-[22px] font-bold break-anywhere">{fullName(person)}</h3>
            <a href={`mailto:${person.email}`} dir="ltr" className="mt-1 inline-flex items-center gap-2 text-text-2 hover:text-text">
              <Mail className="size-4" />
              {person.email}
            </a>
            <ul className="mt-4 space-y-2 border-t border-border pt-4">
              {places.map((pl) => (
                <li key={pl.branch.id} className="flex flex-wrap items-center gap-1.5">
                  <span className="inline-flex items-center gap-1.5 font-semibold">
                    <Building2 className="size-4 text-text-3" />
                    {pl.branch.name}
                  </span>
                  {pl.admin && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-sunken px-2.5 py-0.5 text-[13px]">
                      <Shield className="size-3.5" />
                      {t("Admin")}
                    </span>
                  )}
                  {pl.departments.map((d) => (
                    <span key={d} className="rounded-full bg-sunken px-2.5 py-0.5 text-[13px]">
                      {d}
                    </span>
                  ))}
                </li>
              ))}
            </ul>
            {profile.data?.bio && (
              <section className="mt-4 border-t border-border pt-4">
                <h4 className="mb-1 font-semibold">{t("About")}</h4>
                <p className="whitespace-pre-line break-anywhere text-text-2">{profile.data.bio}</p>
              </section>
            )}
          </div>
        </div>
      )}
    </Dialog>
  );
}
