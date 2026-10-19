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

// The backend accepts only these types and trusts the type the browser
// reports (backend/src/domain/attachments.rs, ALLOWED_TYPES). Browsers report
// no type for some files, so known extensions are mapped here.
const TYPE_BY_EXT: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  txt: "text/plain",
  csv: "text/csv",
  doc: "application/msword",
  xls: "application/vnd.ms-excel",
  ppt: "application/vnd.ms-powerpoint",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  odt: "application/vnd.oasis.opendocument.text",
  ods: "application/vnd.oasis.opendocument.spreadsheet",
  odp: "application/vnd.oasis.opendocument.presentation",
};
const ALLOWED = new Set(Object.values(TYPE_BY_EXT));
export const ACCEPT = Object.keys(TYPE_BY_EXT).map((e) => `.${e}`).join(",");
export const ACCEPTED_HINT = "PDF, images (PNG, JPG, GIF, WebP), Word, Excel, PowerPoint, OpenDocument, CSV or text, up to 25 MB.";

/** The file ready to send, or why it can't be attached. */
export function checkFile(f: File): { file: File } | { reason: string } {
  if (f.size === 0) return { reason: `${f.name} is empty.` };
  if (f.size > MAX_FILE) return { reason: `${f.name} is too big. The limit is 25 MB.` };
  const ext = f.name.split(".").pop()?.toLowerCase() ?? "";
  const type = f.type.toLowerCase();
  if (ALLOWED.has(type)) return { file: f };
  const mapped = TYPE_BY_EXT[ext];
  if (mapped) return { file: new File([f], f.name, { type: mapped, lastModified: f.lastModified }) };
  const what = ext === "heic" || ext === "heif" ? "iPhone HEIC photos" : ext ? `.${ext} files` : "Files of this kind";
  return { reason: `${f.name}: ${what} can't be attached. Use ${ACCEPTED_HINT}` };
}

/** Picks files and keeps them until `uploadAll` is called with the parent. */
export function useFilePicker() {
  const [files, setFiles] = useState<File[]>([]);
  return {
    files,
    add: (list: FileList | null) => {
      const ok: File[] = [];
      for (const f of Array.from(list ?? [])) {
        const r = checkFile(f);
        if ("file" in r) ok.push(r.file);
        else toast.error(r.reason, { duration: 10000 });
      }
      setFiles((prev) => [...prev, ...ok]);
    },
    remove: (i: number) => setFiles((prev) => prev.filter((_, j) => j !== i)),
    clear: () => setFiles([]),
  };
}

/** Uploads in turn; returns the files that failed, with the reason. */
export async function uploadAll(
  issueId: string,
  files: File[],
  parent: { comment_id?: string; report_id?: string } = {},
): Promise<{ name: string; reason: string }[]> {
  const failed: { name: string; reason: string }[] = [];
  for (const f of files) {
    const r = checkFile(f);
    if ("reason" in r) {
      failed.push({ name: f.name, reason: r.reason });
      continue;
    }
    try {
      await upload(issueId, r.file, parent);
    } catch (e) {
      failed.push({ name: f.name, reason: errorMessage(e) });
    }
  }
  return failed;
}

/** A toast that stays until dismissed, listing files that didn't upload. */
export function reportFailedUploads(failed: { name: string; reason: string }[], context: string) {
  if (!failed.length) return;
  toast.error(`${context} ${failed.length === 1 ? "1 file didn't" : `${failed.length} files didn't`} upload`, {
    description: failed.map((f) => f.reason).join(" · "),
    duration: Infinity,
  });
}

export function AttachButton({ onPick, label = "Attach files", dashed = true }: { onPick: (files: FileList | null) => void; label?: string; dashed?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <input ref={ref} type="file" multiple accept={ACCEPT} className="sr-only" tabIndex={-1} onChange={(e) => (onPick(e.target.files), (e.target.value = ""))} />
      <button
        type="button"
        title={`You can attach ${ACCEPTED_HINT}`}
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
        const files: File[] = [];
        for (const f of Array.from(list ?? [])) {
          const r = checkFile(f);
          if ("file" in r) files.push(r.file);
          else toast.error(r.reason, { duration: 10000 });
        }
        if (!files.length) return;
        setBusy(true);
        const failed = await uploadAll(issueId, files, parent);
        setBusy(false);
        const done = files.length - failed.length;
        if (done) toast.success(done === 1 ? "File attached" : `${done} files attached`);
        reportFailedUploads(failed, "");
        onDone();
      }}
    />
  );
}
