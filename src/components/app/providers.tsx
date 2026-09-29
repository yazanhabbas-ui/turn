"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { useState } from "react";
import { Toaster } from "@/components/ui/sonner";

export function Providers({ children, dir }: { children: React.ReactNode; dir: "rtl" | "ltr" }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { staleTime: 15_000, retry: 2, refetchOnWindowFocus: false } },
      }),
  );
  return (
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false}>
      <QueryClientProvider client={client}>
        {children}
        <Toaster position={dir === "rtl" ? "top-left" : "top-right"} dir={dir} richColors />
      </QueryClientProvider>
    </ThemeProvider>
  );
}
