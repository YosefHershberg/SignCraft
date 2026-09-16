# SignCraft — Architecture Decision Records

**Date:** 2026-09-16
**Status:** Accepted
**Companion docs:** [Architecture](2026-09-16-signcraft-architecture-design.md) · [UI Pages & Flows](2026-09-16-signcraft-ui-pages-and-flows.md)

Each record: context, decision, alternatives considered, consequences. Records are numbered in the order the decisions were made; later records assume earlier ones. The README's "Trade-offs" section is derived from the Consequences here.

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

## ADR-005 — Double-booking prevention with a MongoDB atomic conditional update (optimistic DB locking)

**Context.** Spec asks for distributed locking, "e.g., Redis lock or optimistic DB locking". Exactly one installer must win concurrent claims.

**Decision.** The claim is a single `updateMany` on the `InstallJob` document with filter `status = OPEN OR (status = CLAIMED AND claim.expiresAt < now)`, asserting `count === 1`. MongoDB's single-document atomicity guarantees one winner.

**Alternatives.**
- Upstash Redis `SET NX PX`: gives the TTL for free but introduces a second source of truth that must be reconciled with Mongo, plus another vendor.
- Both Redis and the conditional write: belt and braces with two code paths to explain and test.
- Multi-document transaction: unnecessary; the race is on one document.

**Consequences.** Zero extra infrastructure. The guarantee is testable in-process with 50 parallel calls. A `version` counter on every mutable document extends the same optimistic pattern to order transitions (409 `VERSION_CONFLICT`).

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
