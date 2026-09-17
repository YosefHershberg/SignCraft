// components/board — the loading state of an order card. Shown by
// `StatusColumn` and the mobile list while `KanbanBoard.loading` is true,
// i.e. between the server-rendered shell and the client bootstrap query.

import { Skeleton } from '@/components/ui/skeleton';

/** First-paint placeholder with the order card's silhouette (UI spec §4.2). */
export function SkeletonCard() {
  return (
    <div className="flex overflow-hidden rounded-[8px] border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.06)]">
      <Skeleton className="h-auto w-[3px] rounded-none" />
      <div className="flex flex-1 flex-col gap-1.5 p-3">
        <div className="flex items-center justify-between gap-2">
          <Skeleton className="h-[18px] w-16" />
          <Skeleton className="h-4 w-20" />
        </div>
        <Skeleton className="h-[18px] w-full" />
        <Skeleton className="h-4 w-2/3" />
      </div>
    </div>
  );
}
