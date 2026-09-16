'use client';

import { useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TooltipProvider } from '@/components/ui/tooltip';
import { PersonaProvider } from '@/lib/persona/persona-context';
import type { Persona } from '@/lib/domain/types';

export function Providers({ initialPersona, children }: { initialPersona: Persona; children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { staleTime: Infinity, refetchOnWindowFocus: false } },
      })
  );

  return (
    <QueryClientProvider client={queryClient}>
      <PersonaProvider initial={initialPersona}>
        <TooltipProvider>{children}</TooltipProvider>
      </PersonaProvider>
    </QueryClientProvider>
  );
}
