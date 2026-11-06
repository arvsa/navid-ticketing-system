// Templates, for super admins: named starting points for new items. A
// template fixes the kind, puts its tag on every item made from it and, for
// actions, can ask for a written report (the built-in Report template).
// Custom fields come later; the API already keeps a place for them.
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Archive, MoreHorizontal, Pencil, Plus, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { ApiError, api } from "@/api/client";
import { useTemplates } from "@/api/hooks";
import type { IssueType, NewTemplate, Template, TemplatePatch } from "@/api/types";
import { TagList, TypeBadge } from "@/components/badges";
import { Button, Card, Dialog, EmptyState, ErrorPanel, Field, IconButton, LoadingRows, Menu, MenuItem, PageHeader, Switch, cx, inputClass } from "@/components/ui";
import { isSuper } from "@/lib/can";
import { errorMessage, templateName, typeLabel } from "@/lib/labels";
import { useViewer } from "@/lib/useViewer";
import { num, t } from "@/i18n";

export function TemplatesPage() {
  const viewer = useViewer();
  const templates = useTemplates(true);
  const [editing, setEditing] = useState<Template | "new" | null>(null);
  if (!isSuper(viewer)) return <EmptyState title={t("Only super admins manage templates.")} />;
  const list = templates.data ?? [];
  return (
    <div className="space-y-6">
      <PageHeader
        title={t("Templates")}
        subtitle={t("Starting points for new items. Each one sets the kind and adds its tag.")}
        actions={
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEditing("new")}>
            {t("New template")}
          </Button>
        }
      />
      {templates.isLoading ? (
        <LoadingRows />
      ) : templates.error ? (
        <ErrorPanel error={templates.error} onRetry={() => templates.refetch()} />
      ) : list.length === 0 ? (
        <EmptyState title={t("No templates yet.")} />
      ) : (
        <Card className="overflow-hidden">
          <ul className="divide-y divide-border">
            {list.map((x) => (
              <TemplateRow key={x.id} template={x} onEdit={() => setEditing(x)} />
            ))}
          </ul>
        </Card>
      )}
      {editing && <TemplateDialog template={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function TemplateRow({ template: x, onEdit }: { template: Template; onEdit: () => void }) {
  const qc = useQueryClient();
  const archive = useMutation({
    mutationFn: (archived: boolean) => api.patch<Template>(`/templates/${x.id}`, { version: x.version, archived } satisfies TemplatePatch),
    onSuccess: (_, archived) => {
      toast.success(archived ? t("Template archived") : t("Template restored"));
      qc.invalidateQueries({ queryKey: ["templates"] });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const archived = !!x.archived_at;
  return (
    <li className={cx("flex items-start gap-4 px-5 py-4", archived && "opacity-60")}>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[17px] font-semibold">{templateName(x)}</span>
          <TypeBadge type={x.type} />
          {x.tag && <TagList tags={[x.tag]} />}
          {archived && <span className="rounded-md bg-sunken px-2 text-[13px] text-text-2">{t("Archived")}</span>}
        </div>
        {x.description && <p className="mt-1 text-text-2">{t(x.description)}</p>}
        <p className="mt-1 text-[14px] text-text-3">
          {[
            x.requires_report ? t("Each person hands in a written report") : null,
            x.default_sla_hours ? t("Due {n} days after sending", { n: num(Math.round(x.default_sla_hours / 24)) }) : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </div>
      <Menu trigger={<IconButton variant="ghost" size="sm" label={t("More actions")} icon={<MoreHorizontal className="size-5" />} />}>
        {!archived && (
          <MenuItem onSelect={onEdit}>
            <Pencil className="size-4" />
            {t("Edit")}
          </MenuItem>
        )}
        <MenuItem onSelect={() => archive.mutate(!archived)}>
          {archived ? <RotateCcw className="size-4" /> : <Archive className="size-4" />}
          {archived ? t("Restore") : t("Archive")}
        </MenuItem>
      </Menu>
    </li>
  );
}

function TemplateDialog({ template, onClose }: { template: Template | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState(template ? templateName(template) : "");
  const [type, setType] = useState<IssueType>(template?.type ?? "action");
  const [description, setDescription] = useState(template?.description ? t(template.description) : "");
  const [tag, setTag] = useState(template?.tag ?? "");
  const [requiresReport, setRequiresReport] = useState(template?.requires_report ?? false);
  const [days, setDays] = useState(template?.default_sla_hours ? String(Math.round(template.default_sla_hours / 24)) : "");
  const [error, setError] = useState<{ field?: string; text: string } | null>(null);
  const isAction = type === "action";
  const save = useMutation({
    mutationFn: () => {
      const hours = isAction && days.trim() ? Math.round(Number(days) * 24) : null;
      // Built-in names and descriptions are shown translated: only send them when changed.
      const nameOut = template && name.trim() === templateName(template) ? undefined : name.trim();
      const descOut = template?.description && description.trim() === t(template.description) ? undefined : description.trim() || null;
      if (!template) {
        const body: NewTemplate = { name: name.trim(), type, description: descOut ?? null, tag: tag.trim() || null, requires_report: isAction && requiresReport, default_sla_hours: hours };
        return api.post<Template>("/templates", body);
      }
      const body: TemplatePatch = {
        version: template.version,
        name: nameOut,
        description: descOut,
        tag: tag.trim() || null,
        requires_report: isAction && requiresReport,
        default_sla_hours: hours,
      };
      return api.patch<Template>(`/templates/${template.id}`, body);
    },
    onSuccess: () => {
      toast.success(template ? t("Saved") : t("Template created"));
      qc.invalidateQueries({ queryKey: ["templates"] });
      onClose();
    },
    onError: (e) => {
      const code = e instanceof ApiError ? e.code : "";
      const field = code === "invalid_name" || code === "template_name_taken" ? "name" : code === "invalid_tag" ? "tag" : undefined;
      setError({ field, text: errorMessage(e) });
    },
  });
  const badDays = isAction && !!days.trim() && !(Number(days) >= 1 && Number(days) <= 365);
  return (
    <Dialog
      open
      onOpenChange={(v) => !v && onClose()}
      title={template ? t("Edit template") : t("New template")}
      footer={
        <>
          <Button onClick={onClose}>{t("Cancel")}</Button>
          <Button variant="primary" loading={save.isPending} disabled={!name.trim() || badDays} onClick={() => (setError(null), save.mutate())}>
            {template ? t("Save changes") : t("Create template")}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && !error.field && <p className="text-danger" role="alert">{error.text}</p>}
        <Field label={t("Name")} error={error?.field === "name" ? error.text : null}>
          {(p) => <input {...p} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder={t("Field trip")} className={inputClass} />}
        </Field>
        <Field label={t("Kind")} hint={template ? t("The kind can't change once a template exists.") : undefined}>
          {(p) => (
            <select {...p} value={type} disabled={!!template} onChange={(e) => setType(e.target.value as IssueType)} className={inputClass}>
              {(["ticket", "action", "event"] as IssueType[]).map((k) => (
                <option key={k} value={k}>
                  {typeLabel[k]}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label={t("Description")} optional>
          {(p) => <textarea {...p} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} rows={2} className={inputClass} />}
        </Field>
        <Field label={t("Tag")} optional hint={t("Added to every item made from this template, to find them later.")} error={error?.field === "tag" ? error.text : null}>
          {(p) => <input {...p} value={tag} onChange={(e) => setTag(e.target.value)} maxLength={40} placeholder={t("field trip")} className={inputClass} />}
        </Field>
        {isAction && (
          <>
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="font-semibold">{t("Needs a written report")}</p>
                <p className="text-[14px] text-text-2">{t("Each person writes and hands in a report before their work goes for approval.")}</p>
              </div>
              <Switch checked={requiresReport} onChange={setRequiresReport} label={t("Needs a written report")} />
            </div>
            <Field label={t("Due after (days)")} optional hint={t("The usual time to do it. Senders can still pick a date.")} error={badDays ? t("1 to 365 days.") : null}>
              {(p) => <input {...p} type="number" min={1} max={365} value={days} onChange={(e) => setDays(e.target.value)} className={cx(inputClass, "w-32")} />}
            </Field>
          </>
        )}
        {template && <p className="text-[14px] text-text-3">{t("Changes apply to new items only.")}</p>}
      </div>
    </Dialog>
  );
}
