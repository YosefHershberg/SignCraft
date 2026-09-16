# SignCraft — Architecture Decision Records

**Date:** 2026-09-16
**Status:** Accepted, with the amendments recorded below
**Companion docs:** [Architecture](2026-09-16-signcraft-architecture-design.md) · [UI Pages & Flows](2026-09-16-signcraft-ui-pages-and-flows.md) · [README](../../../README.md) · [EXPLANATIONS](../../../EXPLANATIONS.md)

Each record: context, decision, alternatives considered, consequences. Records are numbered in the order the decisions were made; later records assume earlier ones. The README's "Trade-offs" section is derived from the Consequences here.

Decisions made or changed during implementation are appended to the record they affect as an **Amended 2026-09-16** paragraph, and new decisions are added as ADR-018 onward. Original text is never rewritten, so the reasoning that was superseded stays readable.

---

## ADR-001 — Next.js App Router over Remix

**Context.** The task allows Next.js (App Router) or Remix.

**Decision.** Next.js 15 App Router.

**Alternatives.** Remix: excellent form/action model, but SSE route handlers, Vercel deployment, and Shadcn tooling are all first-class on Next.js and the reviewer is more likely to be fluent in it.

**Consequences.** Route Handlers must declare `runtime = 'nodejs'` (Prisma). Streaming responses use the Web `ReadableStream` API. Server Components fetch the initial dashboard state.

## ADR-002 — Shadcn UI + Tailwind over MUI

**Context.** The task allows Shadcn or MUI with Tailwind.

**Decision.** Shadcn UI (Radix primitives) with Tailwind CSS.

**Alternatives.** MUI: heavier bundle, its own styling system fights Tailwind, and theming a Kanban board is more work.

**Consequences.** Components are copied into `components/ui` and owned by the repo. Dialog, Sheet, Select, Badge, Progress, Tabs, Toast (`sonner`) cover every UI need in the spec.

## ADR-003 — Deploy to Vercel with MongoDB Atlas

**Context.** Deliverable requires a live URL. Options: Railway (long-lived container), Vercel (serverless), AWS.

**Decision.** Vercel for the app, MongoDB Atlas M0 for the database.

**Alternatives.**
- Railway: long-lived Node makes WebSockets and in-memory pub/sub trivial and docker-compose maps 1:1. Rejected by the author in favour of the platform they want to demonstrate.
- AWS ECS/App Runner: most control, most setup, nothing extra to show for a micro-app.

**Consequences.** No WebSockets, no in-process state, no background worker, no long-lived change stream. Every later decision on realtime (ADR-004), locking (ADR-005), and expiry (ADR-006) is shaped by this. The docker-compose file is for local execution, not a mirror of production.

**Amended 2026-09-16 — Atlas everywhere, Docker dropped.** The last sentence above turned out to be the problem rather than the plan: a compose Mongo is not a mirror of production, so anything proven against it (especially change-stream behaviour, which needs `--replSet rs0`, an `rs.initiate()` init container and a PRIMARY healthcheck) would have to be re-proven on Atlas anyway, while the reviewer's compose data and the deployed data diverged. Every Docker artifact was therefore removed and **one Atlas M0 cluster now serves every environment**, with integration tests on a dedicated database name on the same cluster. Consequences: local and deployed behaviour are identical and the integration suite exercises the production configuration; the reviewer's setup is `.env` + `pnpm dev` rather than `docker compose up`; there is no offline/credential-free way to run the app locally, and the deliverable's "containerized execution files (docker-compose.yml preferred)" is knowingly unmet — stated plainly in EXPLANATIONS.md §10. The app has no local service dependencies, so a stock Node image running `pnpm build && pnpm start` would containerise it if required; it was left out rather than kept as a second, differently-configured path to maintain.

## ADR-004 — Realtime via SSE backed by MongoDB Change Streams

**Context.** Dashboard must show state changes, claim status, and upload progress live, "without repeatedly polling the database". On Vercel a long-lived socket is only possible as a streaming function invocation.

**Decision.** `GET /api/events` is a Node streaming Route Handler that opens a change stream over the three collections and forwards typed events as SSE. Resume token doubles as the SSE event id so reconnects resume from where they stopped. Server closes at 280 s (before Vercel's 300 s limit) with a `reconnect` event.

**Alternatives.**
- Pusher / Ably: bulletproof on serverless, but the realtime layer would be a vendor's, and it is an extra account for the reviewer to reason about.
- Supabase Realtime as a broadcast bus: works but drags Postgres tooling into a Mongo project.
- Client polling every N seconds: explicitly discouraged by the spec.

**Consequences.**
- One change stream cursor per open dashboard tab. Fine at demo scale; documented as the first thing to change for real scale.
- Vercel Fluid compute must be on and `maxDuration` set on the route.
- A degraded mode (10 s refetch) exists only when SSE fails three times in a row, so the app still works if a proxy blocks streaming.

**Amended 2026-09-16 — resync and explicit reopen.** Two mechanisms were added during implementation. (1) `event: resync`: a change stream can lose its resume token (Mongo 286 `ChangeStreamHistoryLost`, or 280 for an invalid token), which the original design had no answer for; the server now restarts the cursor from now and tells the client to refetch the bootstrap, giving up after `MAX_RESYNCS = 3` rather than looping. (2) The client reopens the stream itself with `?after=<lastEventId>` instead of relying on the browser: `EventSource` only auto-retries transport failures, and an HTTP error status — exactly what `/api/events` returns when the change stream dies — is fatal by spec, so without our own retry the app would sit on "Reconnecting…" forever and never reach the three failures that enable degraded polling. Also: the change-stream `$match` covers `insert | update | replace` only, since nothing deletes and a delete change carries no `fullDocument`.

## ADR-005 — Double-booking prevention with a MongoDB atomic conditional update (optimistic DB locking)

**Context.** Spec asks for distributed locking, "e.g., Redis lock or optimistic DB locking". Exactly one installer must win concurrent claims.

**Decision.** The claim is a single `updateMany` on the `InstallJob` document with filter `status = OPEN OR (status = CLAIMED AND claim.expiresAt < now)`, asserting `count === 1`. MongoDB's single-document atomicity guarantees one winner.

**Alternatives.**
- Upstash Redis `SET NX PX`: gives the TTL for free but introduces a second source of truth that must be reconciled with Mongo, plus another vendor.
- Both Redis and the conditional write: belt and braces with two code paths to explain and test.
- Multi-document transaction: unnecessary; the race is on one document.

**Consequences.** Zero extra infrastructure. The guarantee is testable in-process with 50 parallel calls. A `version` counter on every mutable document extends the same optimistic pattern to order transitions (409 `VERSION_CONFLICT`).

**Amended 2026-09-16 — the Prisma path held.** The design kept `prisma.$runCommandRaw({ findAndModify })` in reserve in case Prisma's composite-type filter (`claim: { is: { expiresAt: { lt: now } } }`) misbehaved on the Mongo connector. It did not; `claimJob` is the plain `updateMany` and the raw fallback was never written. The implemented update also clears `installerId` (so a job re-claimed after a failed verification carries no stale assignee) and, on `count !== 1`, reads the job once to return 404 `NOT_FOUND` rather than 409 `CLAIM_TAKEN` for an id that does not exist. Proven by `tests/integration/jobs.test.ts › exactly one of 50 concurrent claims wins`, run against Atlas.

## ADR-006 — 3-minute claim release via lazy expiry plus on-demand sweep

**Context.** A claim that is not verified within 3 minutes must return to the marketplace. Vercel has no long-running process; Hobby cron runs once a day.

**Decision.** `claim.expiresAt` is stored on the job. Every reader (`toPublicJob`) and every writer (the claim filter) treats an expired claim as OPEN. A `releaseExpired()` sweep runs on each bootstrap fetch and each SSE connect so the DB catches up and a change event fires. The client shows a countdown and flips the card locally at zero.

**Alternatives.**
- Vercel Cron sweeper: only meaningful on Pro (per-minute crons); would still need the lazy check.
- Upstash QStash delayed callback at T+3 min: precise and event-driven, but a second vendor and a webhook to secure.
- Mongo TTL index on a separate `Claim` collection: TTL deletion runs every ~60 s and deletes the record rather than transitioning it, losing history.

**Consequences.** Correctness never depends on a timer. The DB can hold a stale CLAIMED while nobody is connected, which is invisible because every access applies the same predicate. Documented in README as the honest serverless trade-off.

## ADR-007 — Cloudflare R2 with presigned multipart uploads

**Context.** Spec asks to simulate direct-to-cloud upload of 1 GB+ files with presigned URLs. Vercel functions cap request bodies at 4.5 MB, so bytes cannot pass through the app.

**Decision.** Cloudflare R2 (S3-compatible) via the AWS SDK. Server creates a multipart upload and presigns `UploadPart` URLs in batches of 20; the browser PUTs 10 MiB parts directly to R2 with up to 4 in flight, then the server completes the upload. A "simulate large file" mode generates zero-filled parts client-side so a reviewer never needs a real gigabyte file.

**Alternatives.**
- AWS S3: identical code, but egress and account setup are less free.
- Vercel Blob client uploads: simplest SDK, but hides the presigned-URL mechanism the spec names explicitly.
- Fully mocked storage: cheapest, but a reviewer would see nothing real happen.

**Consequences.** Real objects land in R2 (lifecycle rule deletes simulated ones after a day). Bucket needs a CORS rule exposing `ETag`. R2 is mocked at the `lib/storage/r2.ts` boundary in tests.

**Amended 2026-09-16 — the abort endpoint carries a reason.** `POST /api/assets/:id/abort` takes an optional `{ reason?: 'user' | 'error' }`. The uploader calls the same endpoint from two places — the user pressing ✕, and its own give-up path after 3 failed part retries — and only the caller knows which happened. `'error'` records the asset **FAILED** so the row offers Retry (UI spec §7.6); the default `'user'` records **ABORTED**, which offers nothing. The body is optional so a bare `POST` (curl, `navigator.sendBeacon`) still means a user abort. Either way the R2 multipart is abandoned, so no orphaned parts accumulate. A failure inside `createAsset` keeps the row and marks it FAILED rather than deleting it, for the same reason.

## ADR-008 — Persona switcher instead of authentication

**Context.** Three actors (ops, vendor, installer) act on one dashboard; the spec never mentions login.

**Decision.** No auth. A header dropdown selects `ops`, `vendor:<id>`, or `installer:<id>`; stored in a cookie and sent as `x-persona`. The server validates the persona on every mutation and enforces per-action rules.

**Alternatives.**
- NextAuth / Clerk with seeded users per role: realistic, but a day of work and makes the two-installer race demo awkward.
- Single ops user pressing simulated buttons: hides the multi-actor concurrency the spec is testing.

**Consequences.** A reviewer can open two tabs as two installers and race the claim button. Authorisation logic is still real and server-side; only identity is trusted from the header. The README states this is a demo affordance, not a security model.

## ADR-009 — Install job opens on the marketplace at READY_FOR_INSTALL

**Context.** The spec does not say when installers may claim.

**Decision.** The `InstallJob` is created (status OPEN) as a side effect of the transition into `READY_FOR_INSTALL`. Claim and verification happen inside that state. `COMPLETED` requires an ASSIGNED installer.

**Alternatives.** Open the job from `VENDOR_ACCEPTED` so installers can be booked during production. More realistic, but adds a second visible axis (order status × job status) across four order states.

**Consequences.** Job state is only visible on cards in one column, which keeps the board legible. Cancel can never collide with an existing job because cancel is impossible from `IN_PRODUCTION` onward.

## ADR-010 — Verification is a manual modal with pass/fail

**Context.** "Fails identity/payment verification within 3 minutes" must be demonstrable.

**Decision.** After claiming, the installer sees a modal with a 3:00 countdown and two buttons: Verify (→ ASSIGNED) and Simulate failure (→ OPEN immediately). Closing the modal leaves the claim ticking; letting it hit zero demonstrates auto-release.

**Alternatives.** Server-side random outcome after a random delay: feels live but the reviewer cannot force the timeout path.

**Consequences.** Every branch of the fallback is reachable by a button or by waiting.

## ADR-011 — Vendor is chosen at order creation

**Context.** `VENDOR_ACCEPTED` implies a vendor acts on the order; the spec does not say how the vendor is selected.

**Decision.** The Create Order form has a vendor select over seeded vendors. Only that vendor's persona may accept and progress the order.

**Alternatives.** Open pool where the first vendor to accept wins, reusing the atomic-claim pattern. Doubles the concurrency surface for no extra credit.

**Consequences.** The vendor persona filter on the board is simple: "orders where vendorId = me".

## ADR-012 — SUBMITTED requires at least one UPLOADED asset

**Context.** Uploads and the state machine are separate requirements; connecting them gives the upload pipeline a consequence.

**Decision.** Guard on DRAFT → SUBMITTED: at least one asset with status UPLOADED, else 400 `GUARD_FAILED / NO_UPLOADED_ASSET`. Uploads are allowed only in DRAFT and SUBMITTED.

**Alternatives.** Keep uploads fully independent. Fewer rules, weaker demo.

**Consequences.** The Submit button explains why it is disabled. One more guard to unit-test.

## ADR-013 — Kanban board as the primary layout

**Context.** Spec: single-page dashboard with real-time lifecycle tracking, responsive on mobile.

**Decision.** Six live status columns plus a collapsed Cancelled column on desktop; status tabs over a card list on mobile. Cards carry status, vendor, claim state with countdown, and upload progress.

**Alternatives.** Data table with filters (denser, less visible motion); table with stat header (middle ground).

**Consequences.** Realtime changes are visually obvious (cards move). Column widths need care at tablet size (horizontal scroll with snap).

**Amended 2026-09-16 — the detail sheet is non-modal.** `components/orders/order-detail-sheet.tsx` renders with `modal={false}`, i.e. without a pointer-blocking overlay. A modal sheet makes the header unreachable, which would break the flow the whole demo rests on: switching persona while the sheet is open and keeping it open (UI spec §7.8), so one window can drive an order through two personas. The cost is no focus trap — the board behind stays in the tab order — partially offset by restoring focus to the trigger on close (`use-restore-focus.ts`). Alternatives: a modal sheet plus a persona control duplicated inside it (more UI, same problem elsewhere); closing and reopening the sheet on every persona switch (loses scroll position and in-progress state).

**Amended 2026-09-16 — one shared clock, board-wide re-render.** Every countdown (card chip, job panel, verification ring) reads a `now` prop threaded down from a single `useNow()` 1 s interval rather than owning a timer. The consequence is that the whole board re-renders once per second whenever any claim is counting down. Accepted at demo scale (eight orders, at most one live claim); a real board would memoise the countdown subtree or run the animation in CSS. The alternative — a timer per chip — trades the re-render for N unsynchronised intervals whose digits visibly disagree.

## ADR-014 — Prisma 6 for CRUD, native driver only for change streams

**Context.** The task mandates Prisma with MongoDB. Prisma does not expose `watch()`.

**Decision.** Prisma 6.x (`provider = "mongodb"`) for all reads and writes including the conditional updates; the `mongodb` driver, sharing `DATABASE_URL`, only in `lib/db/mongo.ts` for change streams.

**Alternatives.** Prisma 7: changed configuration model and less battle-tested Mongo path at the time of writing; not worth the risk in an assessment. Native driver everywhere: violates the mandated stack.

**Consequences.** Two connection pools to one database. Collection names in the change-stream filter must match Prisma model names (`Order`, `InstallJob`, `Asset`).

## ADR-015 — `InstallJob` is a separate collection, `history` is embedded

**Context.** Where do claim state and transition history live?

**Decision.** `InstallJob` is its own collection with a unique `orderId`; `history` is an embedded array on `Order`.

**Alternatives.** Embed the job in the order: the claim race would then contend with order edits and the filter would be nested. Separate history collection: an extra query for a bounded, read-with-parent list.

**Consequences.** Claim logic and its test touch one small document. Bootstrap does one `include` to join jobs and assets.

**Amended 2026-09-16 — how `orderNumber` is generated.** Human-readable order numbers (`SC-0001`) were needed and the ADR never said where they come from. `createOrder` does `prisma.order.count()` then `create`, with a single retry at `count + 2` when the unique index rejects the first attempt (`P2002`). This is a read-then-write and is *not* safe under heavy concurrent creation — deliberately different from the claim, which is contended and therefore atomic. Order creation is a one-at-a-time human action by a single Ops persona, and the unique index means a collision fails loudly rather than duplicating. The proper fixes, if it ever mattered: a counters collection updated with `$inc` in one `findAndModify`, or a random suffix instead of a sequence. Covered by `tests/integration/orders.test.ts › retries once on an orderNumber collision`.

## ADR-016 — Upload progress reaches other dashboards through throttled DB writes

**Context.** XHR progress is only known to the uploading tab. Other tabs must see it without polling.

**Decision.** The uploader posts `bytesUploaded` at most every 2 s or every 5 %; the write flows through the change stream to every dashboard.

**Alternatives.** Redis pub/sub (avoids DB writes, adds a datastore); show progress only in the uploading tab (fails the "on the dashboard" requirement for other viewers).

**Consequences.** About 20–30 small writes per upload. Acceptable and explicitly documented.

## ADR-017 — Testing scope: unit plus integration, no browser e2e

**Context.** The concurrency guarantee is the most scrutinised claim in the README.

**Decision.** Vitest unit tests for pure domain modules; Vitest integration tests against the Docker Mongo replica set for the claim race, expiry, verification, transitions, and guards. Playwright is out of scope.

**Alternatives.** Add Playwright for the two-tab race: most convincing, about a day more. Unit only: leaves the guarantee unproven.

**Consequences.** `pnpm test` is fast; `pnpm test:integration` needs `docker compose up mongo`. Manual QA checklist in README covers the browser flows.

**Amended 2026-09-16 — Atlas, and a third test category.** `pnpm test:integration` needs no Docker: it runs against a **dedicated database name on the Atlas cluster** (`signcraft_test`), derived from `.env` by rewriting the path segment of `DATABASE_URL`. The override is mandatory because `resetDb()` wipes every collection. The cost is latency — an M0 write round trip is 2–3 s, so the suite takes about 4.5 minutes and runs serially (`fileParallelism: false`, 30 s timeout) — bought against never having a second, differently-configured database to reason about.

A third category was added below the "no Playwright" line: a small number of **component tests** with `@testing-library/react` under jsdom (`tests/unit/jobs/job-chip.test.tsx`, via a per-file `// @vitest-environment jsdom` pragma). Rationale: the job chip renders claim state that is only correct if the lazy-expiry view and the countdown formatting agree, and that is cheap to assert on rendered output and expensive to assert any other way. It stays a handful of tests rather than a component-testing strategy: the invariants live in `lib/domain`, which is tested directly. Totals: **274 unit** tests in 25 files, **47 integration** tests in 8 files.
