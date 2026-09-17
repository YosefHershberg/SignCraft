// Client-side query layer: the query keys `lib/query/hooks.ts` and
// `lib/realtime/*` share.
/** There is exactly one query key because the whole board is one snapshot (`BootstrapDTO`) kept in sync by SSE, not a collection of per-entity queries. */
export const keys = { bootstrap: ['bootstrap'] as const };
