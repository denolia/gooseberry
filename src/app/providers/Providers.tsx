"use client";

import React, { useEffect, useRef, useState } from "react";
import { SessionProvider, useSession } from "next-auth/react";
import type { Session } from "next-auth";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LanguageStore } from "@/lib/languages/languageStore";
import type { SourceLanguage, TargetLanguage } from "@/components/ui/Languages";

interface ProvidersProps {
  children: React.ReactNode;
  session?: Session | null;
}

function PreferenceHydrator() {
  const { data: session, status } = useSession();
  const hydratedUserId = useRef<string | null>(null);

  useEffect(() => {
    const userId = session?.user?.id;
    if (
      status !== "authenticated" ||
      !userId ||
      hydratedUserId.current === userId
    ) {
      return;
    }
    hydratedUserId.current = userId;
    void fetch("/api/profile")
      .then((response) => (response.ok ? response.json() : null))
      .then((body) => {
        const preferences = body?.profile?.preferences as
          | {
              defaultSourceLang: SourceLanguage;
              defaultTargetLang: TargetLanguage;
            }
          | undefined;
        if (preferences) {
          LanguageStore.applyServerDefaults(
            preferences.defaultSourceLang,
            preferences.defaultTargetLang,
          );
        }
      })
      .catch((error) =>
        console.error("Failed to load language defaults", error),
      );
  }, [session?.user?.id, status]);

  return null;
}

export function Providers({ children, session }: ProvidersProps) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60_000,
            gcTime: 10 * 60_000,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );

  return (
    <SessionProvider session={session}>
      <QueryClientProvider client={queryClient}>
        <PreferenceHydrator />
        {children}
      </QueryClientProvider>
    </SessionProvider>
  );
}
