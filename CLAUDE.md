# CLAUDE.md — SignCraft

Guidance for Claude Code (and humans) working in this repo. Keep it short; the specs carry the detail.

## What this is

A technical-assessment micro-app: B2B signage marketplace dashboard. A human reviewer will read `README.md` and `EXPLANATIONS.md`, open the live Vercel URL, and judge three things: the order state machine, double-booking prevention on installer claims, and the direct-to-cloud upload pipeline. Task statement: `SignCraft_Task_Specification.md`.

## Source of truth

Read these before changing behaviour. If code and spec disagree, fix one and say which.

- `docs/superpowers/specs/2026-09-16-signcraft-architecture-design.md` — data model, API, locking, realtime, upload pipeline, folder layout.
- `docs/superpowers/specs/2026-09-16-signcraft-decisions.md` — 18 ADRs with alternatives. Do not re-litigate a decision silently; add or amend an ADR.
- `docs/superpowers/specs/2026-09-16-signcraft-ui-pages-and-flows.md` — every screen, state, and flow.
- `docs/design/` — visual design from Claude Design: `DESIGN.md` (tokens: colours, type scale, spacing, status hues) plus `screens/1a`–`1h` as reference HTML (board, detail sheet, dialogs, mobile, tablet). Use it for how things look; the UI spec wins on behaviour. Rebuild screens with Tailwind + Shadcn — never paste exported HTML into a component.
- `public/openapi.yaml` — the API contract as implemented, rendered at `/api-docs`. `tests/unit/api/openapi.test.ts` fails if a route and the spec drift. When you add or change a route, update the spec in the same change.
- `README.md` / `EXPLANATIONS.md` — what the reviewer is told. If you change behaviour, change these.

## Stack (mandated, do not swap)

Next.js 15 App Router · React 19 · TypeScript strict · Tailwind 4 + Shadcn · Prisma 6 (`provider = "mongodb"`) · MongoDB Atlas · Cloudflare R2 via AWS SDK · TanStack Query · Zod 4 · Vitest · pnpm 11.

The `mongodb` native driver is allowed **only** in `lib/db/mongo.ts` for change streams.

## Invariants (never break)

1. **Server is authoritative.** Every state change is validated by `lib/domain/state-machine.ts` and `lib/domain/permissions.ts` on the server, regardless of what the UI allows. Invalid transitions return HTTP 400 with the allowed list.
2. **Claims are one conditional update.** `claimJob` in `lib/services/jobs.ts` must remain a single `updateMany` (or `findAndModify`) whose filter is `OPEN OR (CLAIMED AND expired)`, asserting `count === 1`. No read-then-write, no transaction, no Redis.
3. **Expiry is lazy.** Any code that reads an `InstallJob` must pass it through `toPublicJob` (via `toJobDTO`) so an expired claim is shown as OPEN. Do not add timers or crons to "fix" expiry.
4. **No DB polling.** Realtime is SSE over change streams. The only polling is the explicit degraded-mode fallback in `useRealtime`.
5. **Bytes never pass through the app.** Uploads go browser → R2 with presigned part URLs. Route handlers only presign, record progress, and complete/abort.
6. **`lib/domain` is pure.** No Prisma, no React, no fetch. It is shared by client and server and fully unit-tested.
7. **Route handlers are thin.** Parse → persona → `lib/services/*` → respond. Business logic lives in services so integration tests can call them directly.

## Layout

See architecture spec §13. Short version: `app/` (page + `api/` routes + `api-docs/`, the Swagger UI page), `components/` (by feature, `ui/` is Shadcn), `lib/` (`domain`, `services`, `db`, `storage`, `realtime`, `upload`, `api`, `query`, `board`, `persona`, `hooks`), `prisma/`, `public/openapi.yaml`, `tests/{unit,integration}`.

## Commands

```
pnpm dev                 # needs .env with an Atlas DATABASE_URL and R2 credentials
pnpm test                # 325 unit tests, no infrastructure, ~12 s
pnpm test:integration    # 47 integration tests against Atlas, ~4.5 min — needs the override below
pnpm typecheck           # tsc --noEmit
pnpm build               # prisma generate && next build
pnpm prisma db push      # schema sync (Mongo has no migrations)
pnpm db:seed             # idempotent seed: 3 vendors, 4 installers, 8 orders — a ONE-TIME step
pnpm --package=@redocly/cli dlx redocly lint public/openapi.yaml   # validate the OpenAPI spec
```

`pnpm db:seed` skips orders whose `orderNumber` already exists, so re-running it will **not** restore orders that were moved through the board. Do not re-seed to "reset" the demo.

### Running integration tests

They call `resetDb()` before each test, which wipes every collection. Always point them at a dedicated database on the same cluster — the suite refuses to start unless the database name ends with `_test` (`tests/helpers/db-name.ts`; `ALLOW_DESTRUCTIVE_TESTS=1` overrides, do not):

```bash
export DATABASE_URL="$(node -e "require('dotenv').config({path:'.env'});const u=process.env.DATABASE_URL;const [b,q]=u.split('?');process.stdout.write(b.replace(/\/signcraft$/,'/signcraft_test')+(q?'?'+q:''))")"
pnpm test:integration
```

PowerShell:

```powershell
$env:DATABASE_URL = node -e "require('dotenv').config({path:'.env'});const u=process.env.DATABASE_URL;const [b,q]=u.split('?');process.stdout.write(b.replace(/\/signcraft$/,'/signcraft_test')+(q?'?'+q:''))"
pnpm test:integration
```

One file, same override in the shell:

```bash
pnpm vitest run --project integration tests/integration/jobs.test.ts
```

Never echo `$DATABASE_URL` — it carries credentials.

### Windows note

`pnpm build` fails with `EPERM` on `query_engine-windows.dll.node` while `pnpm dev` holds it. Stop the dev server before building.

## Two-tab QA recipe

The fastest way to see the three graded behaviours by hand (full checklist in `README.md`):

1. Ops: New order → Simulate large file (100 MB) → Submit.
2. Switch to that order's vendor: Accept → Start production → Mark ready (this opens the install job).
3. Open a second browser window; set one to installer *Dana K.*, the other to *Omar S.*; press Claim in both at once. One wins with a 3:00 countdown, the other sees "Claimed by another installer". (The `sc_persona` cookie only seeds a tab's first render — each tab then holds its persona in React state — so do not reload the first window or it adopts the second's persona.)
4. Let the countdown hit zero (or set `CLAIM_TTL_MS=20000`) to watch the auto-release land in both windows.

## Working conventions

- TDD for domain and services: write the failing test first (`superpowers:test-driven-development`).
- Before claiming anything works, run the relevant command and show its output.
- Keep files focused; a route file over ~30 lines or a component over ~200 lines is a smell.
- Errors use `ApiError(status, code, details?)` from `lib/api/errors.ts`; never throw raw strings. Wire format: `{ "error": { "code", "message", "details" } }`.
- BigInt fields (`sizeBytes`, `bytesUploaded`) are serialised as numbers at the API boundary by `normalise` in `lib/services/dto.ts`.
- Persona comes from the `x-persona` header (`ops` | `vendor:<id>` | `installer:<id>`), parsed only in `lib/api/persona.ts` over the pure `lib/domain/personas.ts`.
- Tuning constants live in `lib/domain/constants.ts`. Change them there, not inline.
- Update the README "Trade-offs" section whenever an ADR changes.
- Every module carries a file header and JSDoc on its exports explaining its role in the pipeline; keep them accurate when you change behaviour.

## Environment

`.env.example` is the list of truth: `DATABASE_URL`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `NEXT_PUBLIC_APP_URL`, optional `CLAIM_TTL_MS`. Never print or commit `.env`.

MongoDB is Atlas in every environment; there is no local Mongo and no Docker in this repo. `pnpm-workspace.yaml` needs its `allowBuilds` map for pnpm 11 (which ignores `onlyBuiltDependencies`), or Prisma's postinstall is skipped.

## Deployment

Vercel (Node runtime, Fluid compute, `maxDuration = 300` on `/api/events`, build command `pnpm build`) + MongoDB Atlas M0 + Cloudflare R2. Vercel env vars are the same list as `.env.example`. The R2 bucket needs the CORS rule from the README, with both `http://localhost:3000` and the Vercel origin in `AllowedOrigins`, `AllowedHeaders: ["*"]`, and `ExposeHeaders: ["ETag"]`.

CI is `.github/workflows/ci.yml` (ADR-018, README › CI/CD): `verify` (lint, typecheck, unit, build; no secrets) on every PR and push to `main`, then `integration` against `signcraft_test` when the `TEST_DATABASE_URL` repo secret exists. Deploys come from Vercel's GitHub integration, not from the workflow. Keep the workflow's Node version equal to the Vercel project's (24.x); if you add a GET route or page that reads the database at build time, `verify` will fail without secrets — make it `force-dynamic`.
