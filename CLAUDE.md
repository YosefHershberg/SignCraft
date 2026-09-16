# CLAUDE.md — SignCraft

Guidance for Claude Code (and humans) working in this repo. Keep it short; the specs carry the detail.

## What this is

A technical-assessment micro-app: B2B signage marketplace dashboard. A human reviewer will read the README, run `docker compose up`, open the live Vercel URL, and judge three things: the order state machine, double-booking prevention on installer claims, and the direct-to-cloud upload pipeline. Task statement: `SignCraft_Task_Specification.md`.

## Source of truth

Read these before changing behaviour. If code and spec disagree, fix one and say which.

- `docs/superpowers/specs/2026-09-16-signcraft-architecture-design.md` — data model, API, locking, realtime, upload pipeline, folder layout.
- `docs/superpowers/specs/2026-09-16-signcraft-decisions.md` — 17 ADRs with alternatives. Do not re-litigate a decision silently; add or amend an ADR.
- `docs/superpowers/specs/2026-09-16-signcraft-ui-pages-and-flows.md` — every screen, state, and flow.
- `docs/design/` — visual design from Claude Design: `DESIGN.md` (tokens) plus any exported screens. Use it for how things look; the UI spec wins on behaviour. Rebuild screens with Tailwind + Shadcn instead of pasting in exported HTML.

## Stack (mandated, do not swap)

Next.js 15 App Router · TypeScript strict · Tailwind + Shadcn · Prisma 6 (`provider = "mongodb"`) · MongoDB replica set · Cloudflare R2 via AWS SDK · TanStack Query · Zod · Vitest · pnpm.

The `mongodb` native driver is allowed **only** in `lib/db/mongo.ts` for change streams.

## Invariants (never break)

1. **Server is authoritative.** Every state change is validated by `lib/domain/state-machine.ts` and `lib/domain/permissions.ts` on the server, regardless of what the UI allows. Invalid transitions return HTTP 400 with the allowed list.
2. **Claims are one conditional update.** `services/jobs.claim` must remain a single `updateMany` (or `findAndModify`) whose filter is `OPEN OR (CLAIMED AND expired)`, asserting `count === 1`. No read-then-write, no transaction, no Redis.
3. **Expiry is lazy.** Any code that reads an `InstallJob` must pass it through `toPublicJob` so an expired claim is shown as OPEN. Do not add timers or crons to "fix" expiry.
4. **No DB polling.** Realtime is SSE over change streams. The only polling is the explicit degraded-mode fallback in `useRealtime`.
5. **Bytes never pass through the app.** Uploads go browser → R2 with presigned part URLs. Route handlers only presign, record progress, and complete/abort.
6. **`lib/domain` is pure.** No Prisma, no React, no fetch. It is shared by client and server and fully unit-tested.
7. **Route handlers are thin.** Parse → persona → `lib/services/*` → respond. Business logic lives in services so integration tests can call them directly.

## Layout

See architecture spec §13. Short version: `app/` (pages + `api/` routes), `components/` (by feature, `ui/` is Shadcn), `lib/` (`domain`, `services`, `db`, `storage`, `realtime`, `upload`, `api`, `query`), `prisma/`, `tests/{unit,integration}`.

## Commands (once implemented)

```
pnpm dev                 # needs .env with the Atlas DATABASE_URL
pnpm test                # unit, no infra
pnpm test:integration    # hits Atlas (use a dedicated DB name via DATABASE_URL); runs claim race etc.
pnpm prisma db push      # schema sync (Mongo has no migrations)
pnpm prisma db seed      # idempotent seed: 3 vendors, 4 installers, 8 orders
docker compose up        # app container against Atlas, seeded on start, on :3000
```

## Working conventions

- TDD for domain and services: write the failing test first (`superpowers:test-driven-development`).
- Before claiming anything works, run the relevant command and show its output.
- Keep files focused; a route file over ~30 lines or a component over ~200 lines is a smell.
- Errors use `ApiError(status, code, details?)` from `lib/api/errors.ts`; never throw raw strings.
- BigInt fields (`sizeBytes`, `bytesUploaded`) are serialised as numbers at the API boundary.
- Persona comes from the `x-persona` header (`ops` | `vendor:<id>` | `installer:<id>`), parsed only in `lib/api/persona.ts`.
- Update the README "Trade-offs" section whenever an ADR changes.

## Environment

`.env.example` is the list of truth: `DATABASE_URL`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `NEXT_PUBLIC_APP_URL`, optional `CLAIM_TTL_MS`. Never commit `.env`.

## Deployment

Vercel (Node runtime, Fluid compute, `maxDuration = 300` on `/api/events`) + MongoDB Atlas M0 + Cloudflare R2 with the CORS rule from the README.
