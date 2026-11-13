// The super admin's home: running the app, not the day's work. Branches,
// people and school-wide groups are set up here; sending something to the
// branches has its own corner for the rare times it's needed.
import { useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Building2, ChevronRight, Download, Globe, LayoutTemplate, Pencil, School, Send, Users } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/api/client";
import { useBranches, useIssueList, useSchoolGroups, useTemplates } from "@/api/hooks";
import { keys } from "@/api/keys";
import type { Settings } from "@/api/types";
import { useNewItem } from "@/app/newItemContext";
import { TypeBadge } from "@/components/badges";
import { Button, Card, Dialog, EmptyState, Field, IconButton, PageHeader, SectionLabel, inputClass } from "@/components/ui";
import { formatDay } from "@/lib/dates";
import { numberOf } from "@/lib/items";
import { errorMessage } from "@/lib/labels";
import { useSchoolName } from "@/lib/useSchoolName";
import { useViewer } from "@/lib/useViewer";
import { usePeople } from "@/people/usePeople";
import { t, tn } from "@/i18n";

export function SetupHome() {
  const viewer = useViewer();
  const openNew = useNewItem();
  const branches = useBranches();
  const groups = useSchoolGroups(true);
  const people = usePeople();
  const templates = useTemplates();
  const open = useIssueList({ state: "open" }, 100);
  const active = (branches.data ?? []).filter((b) => b.is_active);
  const schoolGroups = (groups.data ?? []).filter((g) => !g.archived_at);
  const sent = (open.data?.pages[0]?.items ?? []).filter((i) => i.created_by === viewer.me.user.id).slice(0, 5);

  return (
    <div className="space-y-8">
      <PageHeader title={t("Set up the school")} subtitle={t("Branches, people and groups. The daily work happens in the branches.")} />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <SetupCard link={<Link to="/branches" className="absolute inset-0" aria-label={t("Branches & admins")} />} icon={<Building2 className="size-5" />} title={t("Branches & admins")} detail={tn(active.length, "{n} branch", "{n} branches")} />
        <SetupCard link={<Link to="/people" search={{ tab: "members" }} className="absolute inset-0" aria-label={t("People & groups")} />} icon={<Users className="size-5" />} title={t("People & groups")} detail={tn(people.all.length, "{n} person", "{n} people")} />
        <SetupCard link={<Link to="/people" search={{ tab: "school" }} className="absolute inset-0" aria-label={t("School-wide groups")} />} icon={<Globe className="size-5" />} title={t("School-wide groups")} detail={tn(schoolGroups.length, "{n} group", "{n} groups")} />
        <SetupCard link={<Link to="/templates" className="absolute inset-0" aria-label={t("Templates")} />} icon={<LayoutTemplate className="size-5" />} title={t("Templates")} detail={tn(templates.data?.length ?? 0, "{n} template", "{n} templates")} />
        <SetupCard link={<Link to="/export" className="absolute inset-0" aria-label={t("Export to Excel")} />} icon={<Download className="size-5" />} title={t("Export to Excel")} detail={t("Every branch, or one")} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <SchoolCard />
      </div>

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <SectionLabel>{t("Send to branches")}</SectionLabel>
          <Button variant="primary" icon={<Send className="size-4 rtl:-scale-x-100" />} onClick={() => openNew()}>
            {t("Send something")}
          </Button>
        </div>
        <Card>
          {sent.length === 0 ? (
            <EmptyState title={t("Nothing sent yet.")}>{t("When you need to, send an item to whole branches or to chosen people. You approve its work.")}</EmptyState>
          ) : (
            <ul className="divide-y divide-border">
              {sent.map((i) => (
                <li key={i.id}>
                  <Link to="/items/$number" params={{ number: numberOf(i.key) }} className="group flex items-center gap-3 px-5 py-3 hover:bg-surface-2">
                    <TypeBadge type={i.type} />
                    <span dir="auto" className="min-w-0 flex-1 truncate font-medium">{i.title}</span>
                    <span className="text-[14px] text-text-3">{formatDay(i.created_at)}</span>
                    <ChevronRight className="size-4 text-text-3 rtl:-scale-x-100" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>
    </div>
  );
}

/** The school's name, shown in everyone's header and on the sign-in page. */
function SchoolCard() {
  const qc = useQueryClient();
  const name = useSchoolName();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const save = useMutation({
    mutationFn: () => api.patch<Settings>("/settings", { school_name: draft.trim() }),
    onSuccess: (s) => (qc.setQueryData(keys.settings, s), setEditing(false), toast.success(t("Saved"))),
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Card className="flex items-start gap-3 p-5">
      <span className="rounded-[12px] bg-primary-soft p-2.5 text-primary-on-soft">
        <School className="size-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[14px] text-text-2">{t("School name")}</span>
        <span className="block truncate font-semibold">{name}</span>
      </span>
      <IconButton variant="ghost" label={t("Rename the school")} hintAlign="end" icon={<Pencil className="size-4" />} onClick={() => (setDraft(name), setEditing(true))} />
      <Dialog
        open={editing}
        onOpenChange={setEditing}
        title={t("Rename the school")}
        description={t("Shown in everyone's header and on the sign-in page.")}
        footer={
          <>
            <Button onClick={() => setEditing(false)}>{t("Cancel")}</Button>
            <Button variant="primary" disabled={!draft.trim()} loading={save.isPending} onClick={() => save.mutate()}>
              {t("Save")}
            </Button>
          </>
        }
      >
        <Field label={t("School name")}>{(p) => <input {...p} value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={120} className={inputClass} />}</Field>
      </Dialog>
    </Card>
  );
}

function SetupCard({ link, icon, title, detail }: { link: ReactNode; icon: ReactNode; title: string; detail: string }) {
  return (
    <Card className="relative flex items-start gap-3 p-5 transition-colors hover:bg-surface-2">
      {link}
      <span className="rounded-[12px] bg-primary-soft p-2.5 text-primary-on-soft">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold">{title}</span>
        <span className="block text-[14px] text-text-2">{detail}</span>
      </span>
    </Card>
  );
}
