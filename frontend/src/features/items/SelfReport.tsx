// A report someone files themselves (no recipients, no assignments; UX_SPEC
// §4.5.3): the written report is the item's main content.
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/api/client";
import { useReports } from "@/api/hooks";
import { keys } from "@/api/keys";
import type { IssueDetail, Report } from "@/api/types";
import { Button, Card, Field, Skeleton, inputClass } from "@/components/ui";
import { FileList, UploadNow } from "@/components/files";
import { formatDay } from "@/lib/dates";
import { errorMessage } from "@/lib/labels";
import { useViewer } from "@/lib/useViewer";
import { usePeople } from "@/people/usePeople";

export function SelfReport({ issue }: { issue: IssueDetail }) {
  const viewer = useViewer();
  const people = usePeople();
  const reports = useReports(issue.id);
  const own = (reports.data ?? []).filter((r) => !r.work_item_id);
  const mine = own.find((r) => r.author_id === viewer.me.user.id);
  const author = issue.created_by === viewer.me.user.id;
  if (reports.isLoading) return <Skeleton className="h-40" />;
  if (author && issue.state === "open" && (!mine || !mine.submitted_at)) return <Editor issue={issue} existing={mine} />;
  if (!own.length) return <p className="text-text-2">No written report yet.</p>;
  return (
    <div className="space-y-4">
      {own.map((r) => (
        <Card key={r.id} className="p-6">
          <h2 className="text-[20px] font-semibold">{r.title}</h2>
          <p className="mt-1 text-[14px] text-text-3">
            {r.submitted_at ? `Filed by ${people.name(r.author_id)} · ${formatDay(r.submitted_at)}` : "Draft — only you can see it"}
          </p>
          <p className="mt-4 text-[17px] leading-7 whitespace-pre-wrap break-anywhere">{r.body}</p>
          {r.attachments.length > 0 && (
            <div className="mt-4">
              <FileList files={r.attachments} />
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}

function Editor({ issue, existing }: { issue: IssueDetail; existing?: Report }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState(existing?.title ?? issue.title);
  const [body, setBody] = useState(existing?.body ?? "");
  const save = async () =>
    existing
      ? api.patch<Report>(`/reports/${existing.id}`, { version: existing.version, title: title.trim(), body })
      : api.post<Report>(`/issues/${issue.id}/reports`, { title: title.trim(), body });
  const refresh = () => qc.invalidateQueries({ queryKey: keys.reports(issue.id) });
  const draft = useMutation({ mutationFn: save, onSuccess: () => (toast.success("Draft saved"), refresh()), onError: (e) => toast.error(errorMessage(e)) });
  const file = useMutation({
    mutationFn: async () => {
      const r = await save();
      await api.post(`/reports/${r.id}/submit`, { version: r.version });
    },
    onSuccess: () => (toast.success("Report filed"), refresh()),
    onError: (e) => toast.error(errorMessage(e)),
  });
  return (
    <Card className="space-y-4 p-6">
      <h2 className="text-[20px] font-semibold">Your report</h2>
      <Field label="Title">{(p) => <input {...p} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} className={inputClass} />}</Field>
      <Field label="Report">
        {(p) => <textarea {...p} value={body} onChange={(e) => setBody(e.target.value)} rows={12} maxLength={100000} className={`${inputClass} text-[17px] leading-[27px]`} />}
      </Field>
      {existing && (
        <div className="flex flex-wrap gap-2">
          <FileList files={existing.attachments} />
          <UploadNow issueId={issue.id} parent={{ report_id: existing.id }} onDone={refresh} />
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button loading={draft.isPending} disabled={!body.trim() || !title.trim()} onClick={() => draft.mutate()}>
          Save draft
        </Button>
        <span className="text-text-2">Everyone who can see this item can read it once filed.</span>
        <Button
          variant="primary"
          className="ml-auto"
          loading={file.isPending}
          disabled={!body.trim() || !title.trim()}
          onClick={() => confirm("File this report? Everyone who can see this item can read it.") && file.mutate()}
        >
          File report
        </Button>
      </div>
    </Card>
  );
}
