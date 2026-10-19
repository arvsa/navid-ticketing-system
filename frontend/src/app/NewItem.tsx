// "+ New" opens the create modal over whatever page you're on.
import { lazy, Suspense, useCallback, useState, type ReactNode } from "react";
import { Drawer } from "@/components/ui";
import { NewItemContext, type NewItemOptions } from "./newItemContext";
import { t } from "@/i18n";

const NewItemModal = lazy(() => import("@/features/create/NewItemModal").then((m) => ({ default: m.NewItemModal })));

export function NewItemProvider({ children }: { children: ReactNode }) {
  const [opts, setOpts] = useState<NewItemOptions | null>(null);
  const open = useCallback((o: NewItemOptions = {}) => setOpts(o), []);
  return (
    <NewItemContext.Provider value={open}>
      {children}
      <Drawer open={!!opts} onOpenChange={(o) => !o && setOpts(null)} label={t("New item")} size="xl">
        {opts && (
          <Suspense fallback={<div className="h-64" />}>
            <NewItemModal initial={opts} onClose={() => setOpts(null)} />
          </Suspense>
        )}
      </Drawer>
    </NewItemContext.Provider>
  );
}
