// Unsaved changes that would be lost by leaving: a page marks itself dirty,
// and anything that would throw the work away (a route change, a language or
// branch switch, another tab of the page) asks first. The dialog lives in
// UnsavedChangesDialog; route changes are caught there too.
import { useEffect } from "react";

const dirty = new Set<string>();
let ask: ((onLeave: () => void) => void) | null = null;

export const hasUnsaved = () => dirty.size > 0;

/** Marks `id` as having unsaved changes while `on` is true. */
export function useUnsaved(id: string, on: boolean) {
  useEffect(() => {
    if (on) dirty.add(id);
    else dirty.delete(id);
    return () => void dirty.delete(id);
  }, [id, on]);
}

/** Runs `action` now, or once the person agrees to drop their unsaved changes. */
export function guard(action: () => void) {
  if (!dirty.size || !ask) return action();
  ask(() => {
    dirty.clear();
    action();
  });
}

/** The dialog registers itself here. */
export function setAsk(fn: typeof ask) {
  ask = fn;
}

/** Dropping the changes on purpose (after the person agreed elsewhere). */
export function discardUnsaved() {
  dirty.clear();
}
