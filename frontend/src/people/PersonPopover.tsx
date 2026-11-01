// Click a person's name or avatar to see who they are: email and branches.
import type { ReactNode } from "react";
import * as Popover from "@radix-ui/react-popover";
import { Copy, Mail, Shield } from "lucide-react";
import { toast } from "sonner";
import { useBranch } from "@/app/BranchContext";
import { Avatar } from "@/components/badges";
import { IconButton, cx } from "@/components/ui";
import { t } from "@/i18n";
import { usePeople } from "./usePeople";

/** A person's name that opens their card. `label` overrides the shown text. */
export function PersonName({ id, label, short = true, className }: { id?: string | null; label?: string; short?: boolean; className?: string }) {
  const people = usePeople();
  return (
    <PersonPopover id={id} className={className}>
      {label ?? (short ? people.short(id) : people.name(id))}
    </PersonPopover>
  );
}

export function PersonPopover({ id, children, className }: { id?: string | null; children: ReactNode; className?: string }) {
  const people = usePeople();
  const { branchById, options } = useBranch();
  const p = people.get(id);
  // Someone we can't name has nothing more to show.
  if (!p) return <span className={className}>{children}</span>;
  const branchName = (b: string) => branchById.get(b)?.name ?? options.find((o) => o.id === b)?.name;
  const branches = p.branchIds.map((b) => ({ id: b, name: branchName(b), admin: p.adminOf.includes(b) })).filter((b) => b.name);
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button type="button" className={cx("rounded-md text-start hover:underline focus-visible:underline", className)} aria-label={t("About {name}", { name: `${p.first_name} ${p.last_name}`.trim() })}>
          {children}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="start" sideOffset={6} className="z-[80] w-[300px] rounded-[14px] border border-border bg-surface p-4 shadow-2">
          <div className="flex items-center gap-3">
            <Avatar first={p.first_name} last={p.last_name} id={p.id} size={44} />
            <div className="min-w-0">
              <div className="truncate font-semibold">
                {p.first_name} {p.last_name}
              </div>
              {!p.is_active && <div className="text-[13px] text-text-3">{t("Deactivated")}</div>}
            </div>
          </div>
          {p.email && (
            <div className="mt-3 flex items-center gap-1">
              <a href={`mailto:${p.email}`} dir="ltr" className="flex min-w-0 flex-1 items-center gap-2 text-[14px] text-text-2 hover:text-text">
                <Mail className="size-4 shrink-0" aria-hidden />
                <span className="truncate">{p.email}</span>
              </a>
              <IconButton
                size="sm"
                variant="ghost"
                label={t("Copy email")}
                hintAlign="end"
                icon={<Copy className="size-3.5" />}
                onClick={() => {
                  navigator.clipboard?.writeText(p.email);
                  toast.success(t("Copied"));
                }}
              />
            </div>
          )}
          {branches.length > 0 && (
            <ul className="mt-3 flex flex-wrap gap-1.5 border-t border-border pt-3">
              {branches.map((b) => (
                <li key={b.id} className="inline-flex items-center gap-1 rounded-full bg-sunken px-2.5 py-0.5 text-[13px]">
                  {b.admin && <Shield className="size-3.5 text-text-2" aria-label={t("Admin")} />}
                  {b.name}
                </li>
              ))}
            </ul>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
