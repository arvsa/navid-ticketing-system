// "Leave without saving?" for every way of losing unsaved changes. Route
// changes go through the router's blocker; switches that aren't navigation
// call guard() from lib/unsaved. Closing or reloading the tab gets the
// browser's own prompt.
import { useEffect, useState } from "react";
import { useBlocker } from "@tanstack/react-router";
import { ConfirmDialog } from "@/features/items/ItemDialogs";
import { discardUnsaved, hasUnsaved, setAsk } from "@/lib/unsaved";
import { t } from "@/i18n";

// Opening someone's panel (?person=) keeps the page, so it isn't blocked.
const page = ({ person: _, ...rest }: Record<string, unknown>) => JSON.stringify(rest);

export function UnsavedChangesDialog() {
  const [pending, setPending] = useState<(() => void) | null>(null);
  const blocker = useBlocker({
    shouldBlockFn: ({ current, next }) =>
      hasUnsaved() &&
      (current.pathname !== next.pathname ||
        page(current.search as Record<string, unknown>) !== page(next.search as Record<string, unknown>)),
    enableBeforeUnload: hasUnsaved,
    withResolver: true,
  });
  useEffect(() => {
    setAsk((onLeave) => setPending(() => onLeave));
    return () => setAsk(null);
  }, []);

  const open = blocker.status === "blocked" || pending !== null;
  const stay = () => {
    if (blocker.status === "blocked") blocker.reset();
    setPending(null);
  };
  const leave = () => {
    discardUnsaved();
    if (blocker.status === "blocked") blocker.proceed();
    pending?.();
    setPending(null);
  };
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(o) => !o && stay()}
      title={t("Leave without saving?")}
      body={t("You have changes that aren't saved yet. If you leave now, they'll be lost.")}
      confirm={t("Leave without saving")}
      cancelText={t("Keep editing")}
      danger
      onConfirm={leave}
    />
  );
}
