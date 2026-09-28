"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { Toaster } from "sonner";
import { ApiError } from "@/lib/api";
import { I18nProvider } from "@/lib/i18n";

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // LAN round trips are cheap; keep data fresh but avoid hammering on errors.
            staleTime: 5_000,
            refetchOnWindowFocus: true,
            retry: (count, e) => !(e instanceof ApiError && e.status >= 400 && e.status < 500) && count < 3,
          },
          mutations: { retry: false },
        },
      }),
  );
  useEffect(() => {
    // PWA shell (spec §76): cache the application shell, never API data.
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    }
  }, []);
  return (
    <QueryClientProvider client={client}>
      <I18nProvider>
        {children}
        <Toaster theme="dark" position="top-center" richColors closeButton />
      </I18nProvider>
    </QueryClientProvider>
  );
}
