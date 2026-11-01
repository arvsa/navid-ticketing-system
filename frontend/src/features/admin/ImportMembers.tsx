// Bulk add: an Excel or CSV file of email, first_name, last_name. The file is
// checked first (dry run), then imported all or nothing.
import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Download, FileSpreadsheet } from "lucide-react";
import { toast } from "sonner";
import { ApiError, request } from "@/api/client";
import type { ImportOutcome, ImportReport, ImportRow } from "@/api/types";
import { Pill } from "@/components/badges";
import { Button, Dialog, cx } from "@/components/ui";
import { errorMessage } from "@/lib/labels";
import { ConfirmDialog } from "@/features/items/ItemDialogs";
import { num, t, tn } from "@/i18n";

const ACCEPT = ".xlsx,.xls,.ods,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv";

const outcomeInfo: Record<ImportOutcome, { label: string; fg: string; bg: string }> = {
  create: { label: t("New account"), fg: "var(--success)", bg: "var(--success-soft)" },
  add: { label: t("From another branch"), fg: "var(--primary-on-soft)", bg: "var(--primary-soft)" },
  reactivate: { label: t("Coming back"), fg: "var(--primary-on-soft)", bg: "var(--primary-soft)" },
  skip: { label: t("Already a member"), fg: "var(--text-2)", bg: "var(--sunken)" },
  error: { label: t("Problem"), fg: "var(--danger)", bg: "var(--danger-soft)" },
};

function rowError(row: ImportRow): string {
  switch (row.error?.code) {
    case "duplicate_email":
      return t("This email is on an earlier row too.");
    case "invalid_name":
      return t("New accounts need a first and last name.");
    case "forbidden":
      return t("You can't add this person here.");
    default:
      return errorMessage(row.error);
  }
}

function importError(e: unknown): string {
  const code = (e as ApiError | null)?.code;
  if (code === "invalid_import")
    return t("We couldn't read that file. Use the template: the first row names the columns email, first_name and last_name, with up to 500 people.");
  if (code === "payload_too_large") return t("That file is too big. The limit is 2 MB.");
  return errorMessage(e);
}

/** `skipErrors`: import the good rows and leave out the ones with a problem. */
function importFile(branchId: string, file: File, dryRun: boolean, skipErrors = false) {
  const form = new FormData();
  form.append("dry_run", String(dryRun));
  form.append("skip_errors", String(skipErrors));
  form.append("file", file, file.name);
  return request<ImportReport>("POST", `/branches/${branchId}/members/import`, { form });
}

/** The new accounts and their temporary passwords, for Excel (BOM for Farsi names). */
function downloadPasswords(rows: ImportRow[], branchName: string) {
  const cell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = [["email", "first_name", "last_name", "temporary_password"].join(",")];
  for (const r of rows) if (r.temporary_password) lines.push([r.email, r.first_name, r.last_name, r.temporary_password].map(cell).join(","));
  const url = URL.createObjectURL(new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `${branchName || "branch"} - temporary passwords.csv`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ImportMembersDialog({ open, onOpenChange, branchId, branchName }: { open: boolean; onOpenChange: (v: boolean) => void; branchId: string; branchName: string }) {
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [saved, setSaved] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const reset = () => {
    setFile(null);
    setReport(null);
    setSaved(false);
    setLeaving(false);
  };
  const check = useMutation({
    mutationFn: (f: File) => importFile(branchId, f, true),
    onSuccess: setReport,
    onError: (e) => toast.error(importError(e)),
  });
  const run = useMutation({
    mutationFn: () => importFile(branchId, file!, false, problems > 0),
    onSuccess: (r) => {
      setReport(r);
      if (!r.imported) return; // someone changed in the meantime; the rows say why
      qc.invalidateQueries({ queryKey: ["branches", branchId, "members"] });
      qc.invalidateQueries({ queryKey: ["people"] });
      const added = r.rows.filter((x) => x.user_id).length;
      toast.success(tn(added, "{n} person was added to {branch}.", "{n} people were added to {branch}.", { branch: branchName }));
    },
    onError: (e) => toast.error(importError(e)),
  });
  const pick = (f: File | undefined) => {
    if (!f) return;
    setFile(f);
    setReport(null);
    check.mutate(f);
  };

  const rows = report?.rows ?? [];
  const count = (o: ImportOutcome) => rows.filter((r) => r.outcome === o).length;
  const problems = count("error");
  const toAdd = rows.length - problems - count("skip");
  const done = !!report?.imported;
  const passwords = rows.filter((r) => r.temporary_password).length;
  const finish = () => {
    onOpenChange(false);
    reset();
  };
  const close = (v: boolean) => {
    if (v) onOpenChange(true);
    else if (done && passwords && !saved) setLeaving(true);
    else finish();
  };

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={close}
        wide
        title={done ? t("Imported to {name}", { name: branchName }) : t("Import people to {name}", { name: branchName })}
        description={
          done
            ? passwords
              ? t("Give each new person their temporary password. They'll choose their own when they first sign in. These won't be shown again.")
              : undefined
            : t("Add many people at once from an Excel or CSV file.")
        }
        footer={
          done ? (
            <>
              {passwords > 0 && (
                <Button
                  icon={<Download className="size-4" />}
                  onClick={() => {
                    downloadPasswords(rows, branchName);
                    setSaved(true);
                  }}
                >
                  {t("Download passwords")}
                </Button>
              )}
              <Button variant="primary" onClick={() => close(false)}>
                {t("Done")}
              </Button>
            </>
          ) : (
            <>
              <Button onClick={() => close(false)}>{t("Cancel")}</Button>
              {report && (
                <Button variant="primary" disabled={toAdd === 0} loading={run.isPending} onClick={() => run.mutate()}>
                  {tn(toAdd, "Import {n} person", "Import {n} people")}
                </Button>
              )}
            </>
          )
        }
      >
        <input ref={input} type="file" accept={ACCEPT} className="sr-only" tabIndex={-1} onChange={(e) => (pick(e.target.files?.[0]), (e.target.value = ""))} />
        {!done && (
          <div className="space-y-3">
            <ol className="list-decimal space-y-1 ps-5 text-text-2">
              <li>
                {t("Use the template, or any sheet with the columns email, first_name and last_name.")}{" "}
                <a href="/api/members/import-template" download className="font-semibold text-primary hover:underline">
                  {t("Download template")}
                </a>
              </li>
              <li>{t("Fill in one person per row, up to 500. Names are only needed for people who don't have an account yet.")}</li>
              <li>{t("Choose the file to check it.")}</li>
            </ol>
            <Button icon={<FileSpreadsheet className="size-4" />} loading={check.isPending} onClick={() => input.current?.click()}>
              {file ? t("Choose another file") : t("Choose file")}
            </Button>
            {file && <span className="ms-3 text-[14px] text-text-2">{file.name}</span>}
          </div>
        )}
        {report && (
          <div className={cx(!done && "mt-5")}>
            <div className="mb-3 flex flex-wrap gap-2">
              {(["create", "add", "reactivate", "skip", "error"] as const).map((o) =>
                count(o) ? (
                  <Pill key={o} fg={outcomeInfo[o].fg} bg={outcomeInfo[o].bg}>
                    {outcomeInfo[o].label} · {num(count(o))}
                  </Pill>
                ) : null,
              )}
            </div>
            {!done && problems > 0 && (
              <p className="mb-3 rounded-[12px] bg-danger-soft px-3.5 py-2.5 text-danger">
                {tn(
                  problems,
                  "{n} row has a problem and will be left out. To include it, fix the file and choose it again.",
                  "{n} rows have a problem and will be left out. To include them, fix the file and choose it again.",
                )}
              </p>
            )}
            <ul className="divide-y divide-border rounded-[12px] border border-border">
              {rows
                .filter((r) => !done || r.temporary_password || r.outcome !== "skip")
                .map((r) => (
                  <li key={r.row} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3.5 py-2.5">
                    <span className="w-16 shrink-0 text-[13px] text-text-3 tabular-nums">{t("Row {n}", { n: num(r.row) })}</span>
                    <div className="min-w-0 flex-1">
                      {`${r.first_name} ${r.last_name}`.trim() ? (
                        <>
                          <div className="truncate font-semibold">{`${r.first_name} ${r.last_name}`.trim()}</div>
                          <div className="truncate text-[14px] text-text-2" dir="ltr">
                            {r.email}
                          </div>
                        </>
                      ) : (
                        <div className="truncate font-semibold" dir="ltr">
                          {r.email}
                        </div>
                      )}
                      {r.error && <div className="text-[14px] text-danger">{rowError(r)}</div>}
                    </div>
                    {r.temporary_password ? (
                      <code className="rounded-md bg-sunken px-2 py-1 font-mono text-[15px] select-all" dir="ltr">
                        {r.temporary_password}
                      </code>
                    ) : (
                      <Pill fg={outcomeInfo[r.outcome].fg} bg={outcomeInfo[r.outcome].bg}>
                        {done && r.outcome === "error" ? t("Not imported") : outcomeInfo[r.outcome].label}
                      </Pill>
                    )}
                  </li>
                ))}
            </ul>
          </div>
        )}
      </Dialog>
      <ConfirmDialog
        open={leaving}
        onOpenChange={setLeaving}
        title={t("Close without the passwords?")}
        body={t("The temporary passwords won't be shown again. You can reset someone's password later from their profile.")}
        confirm={t("Close")}
        cancelText={t("Go back")}
        onConfirm={finish}
      />
    </>
  );
}
