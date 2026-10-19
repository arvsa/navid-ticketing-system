import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { Toaster } from "sonner";
import { ApiError, onApiError } from "@/api/client";
import { keys } from "@/api/keys";
import { makeRouter } from "@/app/router";
import { applyTheme, watchSystemTheme } from "@/app/theme";
import { applyLang, isRtl } from "@/i18n";
import "@fontsource-variable/vazirmatn";
import "@/styles/globals.css";

applyLang();
applyTheme();
watchSystemTheme();

const qc = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
    },
  },
});
const router = makeRouter(qc);

// Errors every screen handles the same way (FRONTEND_PLAN §4.2).
onApiError((e) => {
  const here = location.pathname;
  if (e.code === "unauthenticated" && here !== "/sign-in") {
    qc.clear();
    router.navigate({ to: "/sign-in", search: { redirect: here + location.search } });
  } else if (e.code === "password_change_required" && here !== "/change-password") {
    router.navigate({ to: "/change-password" });
  } else if (e.code === "forbidden") {
    qc.invalidateQueries({ queryKey: keys.me });
  }
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={qc}>
      <RouterProvider router={router} />
      {/* Radix dialogs and menus switch off pointer events outside themselves;
          toasts must stay clickable (close, Undo) while one is open. */}
      <Toaster
        position={isRtl ? "bottom-left" : "bottom-right"}
        dir={isRtl ? "rtl" : "ltr"}
        closeButton
        style={{ pointerEvents: "auto" }}
        toastOptions={{ duration: 6000, style: { pointerEvents: "auto" } }}
      />
    </QueryClientProvider>
  </StrictMode>,
);
