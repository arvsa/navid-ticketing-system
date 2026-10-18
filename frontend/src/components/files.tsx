// Attachment chips and the upload button (≤ 25 MB, uploaded after the parent exists).
import { useRef, useState } from "react";
import { Paperclip } from "lucide-react";
import { toast } from "sonner";
import { upload } from "@/api/client";
import type { AttachmentMeta } from "@/api/types";
import { errorMessage } from "@/lib/labels";
import { cx } from "./ui";

export const MAX_FILE = 25 * 1024 * 1024;

export function fileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function FileChip({ file, wide }: { file: AttachmentMeta; wide?: boolean }) {
  return (
    <a
      href={`/api/attachments/${file.id}`}
      className={cx(
        "inline-flex min-w-0 items-center gap-2 rounded-[10px] border border-border bg-surface px-3 py-2 hover:border-border-strong",
        wide && "flex w-full justify-between",
      )}
      download={file.file_name}
    >
      <span className="flex min-w-0 items-center gap-2">
        <Paperclip className="size-4 shrink-0 text-text-2" aria-hidden />
        <span className="truncate">{file.file_name}</span>
      </span>
      <span className="shrink-0 text-[13px] text-text-3">{fileSize(file.file_size_bytes)}</span>
    </a>
  );
}

export function FileList({ files, wide }: { files: AttachmentMeta[]; wide?: boolean }) {
  if (!files.length) return null;
  return (
    <div className={cx("flex flex-wrap gap-2", wide && "flex-col")}>
      {files.map((f) => (
        <FileChip key={f.id} file={f} wide={wide} />
      ))}
    </div>
  );
}

/** Picks files and keeps them until `uploadAll` is called with the parent. */
export function useFilePicker() {
  const [files, setFiles] = useState<File[]>([]);
  return {
    files,
    add: (list: FileList | null) => {
      const ok: File[] = [];
      for (const f of Array.from(list ?? [])) {
        if (f.size > MAX_FILE) toast.error(`${f.name} is too big. The limit is 25 MB.`);
        else if (f.size === 0) toast.error(`${f.name} is empty.`);
        else ok.push(f);
      }
      setFiles((prev) => [...prev, ...ok]);
    },
    remove: (i: number) => setFiles((prev) => prev.filter((_, j) => j !== i)),
    clear: () => setFiles([]),
  };
}

export async function uploadAll(issueId: string, files: File[], parent: { comment_id?: string; report_id?: string } = {}) {
  let failed = 0;
  for (const f of files) {
    try {
      await upload(issueId, f, parent);
    } catch (e) {
      failed++;
      toast.error(`${f.name}: ${errorMessage(e)}`);
    }
  }
  return failed;
}

export function AttachButton({ onPick, label = "Attach files", dashed = true }: { onPick: (files: FileList | null) => void; label?: string; dashed?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <input ref={ref} type="file" multiple className="sr-only" tabIndex={-1} onChange={(e) => (onPick(e.target.files), (e.target.value = ""))} />
      <button
        type="button"
        onClick={() => ref.current?.click()}
        className={cx(
          "inline-flex h-10 items-center gap-2 rounded-[10px] px-3 text-text-2 hover:bg-surface-2",
          dashed ? "border border-dashed border-border-strong" : "",
        )}
      >
        <Paperclip className="size-4" aria-hidden />
        {label}
      </button>
    </>
  );
}

export function PendingFiles({ files, onRemove }: { files: File[]; onRemove: (i: number) => void }) {
  if (!files.length) return null;
  return (
    <ul className="flex flex-wrap gap-2">
      {files.map((f, i) => (
        <li key={`${f.name}-${i}`} className="inline-flex items-center gap-2 rounded-[10px] border border-border bg-surface-2 px-3 py-1.5 text-[14px]">
          <Paperclip className="size-3.5" aria-hidden /> {f.name}
          <span className="text-text-3">{fileSize(f.size)}</span>
          <button type="button" onClick={() => onRemove(i)} className="text-text-3 hover:text-danger" aria-label={`Remove ${f.name}`}>
            ×
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Upload straight to an existing parent (Files tab, report editor). */
export function UploadNow({ issueId, parent, onDone, label }: { issueId: string; parent?: { report_id?: string }; onDone: () => void; label?: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <AttachButton
      label={busy ? "Uploading…" : label ?? "+ Attach a file"}
      onPick={async (list) => {
        const files = Array.from(list ?? []).filter((f) => {
          if (f.size > MAX_FILE) toast.error(`${f.name} is too big. The limit is 25 MB.`);
          return f.size > 0 && f.size <= MAX_FILE;
        });
        if (!files.length) return;
        setBusy(true);
        const failed = await uploadAll(issueId, files, parent);
        setBusy(false);
        if (failed < files.length) toast.success(files.length - failed === 1 ? "File attached" : `${files.length - failed} files attached`);
        onDone();
      }}
    />
  );
}
