// components/board — what a `StatusColumn` or the mobile list shows when the
// persona has no visible orders in that status. The vendor variant says
// "No orders for you here" because their board is filtered, not empty.

/** Dashed placeholder for a column with nothing in it (UI spec §4.2). */
export function EmptyColumn({ label = 'Nothing here yet' }: { label?: string }) {
  return (
    <div className="rounded-[8px] border border-dashed border-slate-300 p-[18px] text-center text-[12px] leading-4 text-slate-400">
      {label}
    </div>
  );
}
