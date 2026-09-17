'use client';

// Dashboard shell: the app-wide provider stack `Dashboard` (dashboard.tsx)
// mounts once, above the board and every dialog it can raise.
import { useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TooltipProvider } from '@/components/ui/tooltip';
import { PersonaProvider } from '@/lib/persona/persona-context';
import { UploadsProvider } from '@/lib/upload/use-uploads';
import type { Persona } from '@/lib/domain/types';

/**
 * Root providers for the dashboard. The `QueryClient` is created inside
 * `useState`'s initializer rather than at module scope so each mount gets its
 * own instance (correct under React strict-mode double-invoke and safe for
 * future multi-instance use), and its defaults hand freshness to SSE instead
 * of TanStack's own policy: `staleTime: Infinity` because `useRealtime` keeps
 * the bootstrap cache current, and `refetchOnWindowFocus: false` because a
 * refetch-on-focus would otherwise race the change-stream frames for no
 * benefit. `UploadsProvider` sits above `children` (which includes the detail
 * sheet) so closing the sheet never tears down an in-flight upload.
 */
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
        {/* Above the board: uploads must outlive the detail sheet that starts them. */}
        <UploadsProvider>
          <TooltipProvider>{children}</TooltipProvider>
        </UploadsProvider>
      </PersonaProvider>
    </QueryClientProvider>
  );
}
