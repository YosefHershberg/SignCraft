# EXPLANATIONS.md

One section per requirement in [`SignCraft_Task_Specification.md`](SignCraft_Task_Specification.md), in the order the task states them. Each says what the requirement is, where it lives, how it works, how to check it, and where it stops.

`README.md` has the setup steps, the schema, and the trade-offs; this file is the requirement-by-requirement audit.

**Live deployment:** https://signcraft-blond.vercel.app

---

## 1. Project requirements — framework, database, UI, language

> "Framework: Next.js (App Router) or Remix · Database: MongoDB (with Prisma ORM) · CSS & UI: Tailwind CSS & Shadcn UI / MUI · Language: TypeScript"

**Where.** `package.json`, `next.config.ts`, `tsconfig.json`, `prisma/schema.prisma`, `components.json`, `app/globals.css`.

**How.** Next.js 15 App Router with React 19; TypeScript with `"strict": true`; Tailwind CSS 4 with Shadcn UI components vendored into `components/ui/` (Radix primitives under the hood, `sonner` for toasts). Data access is Prisma 6 with `provider = "mongodb"` against MongoDB Atlas. The one exception to "everything through Prisma" is change streams, which Prisma does not expose: the `mongodb` native driver is imported in exactly one file, `lib/db/mongo.ts`, and shares the same `DATABASE_URL`.

**Verify.** `pnpm typecheck` (`tsc --noEmit`) passes with strict mode on. `grep -rn "from 'mongodb'" lib app components` returns one hit, `lib/db/mongo.ts`.

**Limits.** Two connection pools reach one database (Prisma's and the driver's) — the price of change streams under the mandated ORM (ADR-014).

## 2. Single-page management dashboard

> "The application consists of a single-page management dashboard featuring real-time order lifecycle tracking, asset upload status, and interactive modals…"

**Where.** `app/page.tsx` (server component: fetches bootstrap, renders `<Dashboard>`), `components/dashboard.tsx`, `components/board/kanban-board.tsx`, `components/layout/app-header.tsx`.

**How.** One route. `app/page.tsx` calls `getBootstrap()` on the server and hands the result to the client dashboard as initial data, so the first paint is populated rather than a spinner. From then on the page never navigates: orders, jobs, and assets all live in a single TanStack Query cache entry (`keys.bootstrap`) that SSE events patch in place. The board is a Kanban of the seven statuses — six live columns plus a collapsed Cancelled rail — with the header carrying per-status count pills, the connection indicator, and the persona switcher.

**Verify.** Manual: everything in the README QA checklist happens without a page navigation. `GET /api/bootstrap` returns vendors, installers, all orders with their `installJob` and `assets`, `serverTime`, and `claimTtlMs` — covered by `tests/integration/bootstrap.test.ts`.

**Limits.** There is no pagination or filtering: the whole board is loaded at once, which is right for eight seeded orders and wrong for eight thousand.

## 3. Interactive modals — order creation, status transitions, installer assignment

> "…interactive modals for Order Creation, Status Transitions, and Installer Assignment."

**Where.** `components/orders/create-order-dialog.tsx`, `components/orders/transition-dialog.tsx`, `components/jobs/claim-dialog.tsx`, `components/jobs/verification-dialog.tsx`, wired up in `components/dashboard-dialogs.tsx`; the order detail sheet is `components/orders/order-detail-sheet.tsx`.

**How.** All three are Shadcn `Dialog`s over Radix. The create dialog validates with the same Zod schema the API uses (`createOrderSchema` in `lib/domain/schemas.ts`), shows errors inline on blur, and posts to `POST /api/orders`. The transition dialog confirms the target status, re-runs `checkTransition` client-side before enabling its confirm button, and renders a server error inline (`InlineError`) rather than only as a toast — so a 400 `INVALID_TRANSITION` shows the allowed list in the dialog itself. The installer-assignment pair is the claim dialog (confirm before racing) and the verification dialog, which carries the countdown ring and the Verify / Simulate failure buttons.

**Verify.** Manual steps 1, 3, 5, 7 and 8 of the README checklist. `tests/unit/orders/calendar-day.test.ts` and `tests/unit/domain/schemas.test.ts` cover the form's date handling and validation rules.

**Limits.** The order *detail sheet* is deliberately **not** modal (`modal={false}`): it renders without a pointer-blocking overlay so a persona switch while it is open keeps it open (UI spec §7.8), which is what makes the two-persona walkthrough possible in a single window. The cost is that it has no focus trap — the board behind stays in the tab order. Focus is still restored to the trigger on close (`components/orders/use-restore-focus.ts`).

## 4. State lifecycle and validation

> "Enforce the following order state machine both on the frontend and backend… Orders can transition to [CANCELLED] only prior to entering [IN_PRODUCTION]. Invalid state jumps (e.g., [DRAFT] directly to [IN_PRODUCTION]) must be blocked with appropriate UI feedback and HTTP 400 API responses."

**Where.** `lib/domain/state-machine.ts` (the table), `lib/domain/permissions.ts` (who, and what must be true), `lib/services/orders.ts` (`transitionOrder`), `app/api/orders/[id]/transition/route.ts`, `components/orders/order-actions.tsx` and `components/orders/inline-error.tsx` (the UI side).

**How.** `TRANSITIONS` is a single record mapping each status to its legal successors. `CANCELLED` appears in the successor list of `DRAFT`, `SUBMITTED`, and `VENDOR_ACCEPTED` and nowhere else, which is exactly the "only prior to IN_PRODUCTION" rule. Because `lib/domain` is pure — no Prisma, no React, no fetch — the same module is imported by the route handler and by the buttons, so the front end can never offer a transition the back end would refuse.

On the server, `transitionOrder` reads the order, builds an `OrderCtx` (status, vendor, whether any asset is `UPLOADED`, the install job), and asks `checkTransition(persona, ctx, to, now)`. A refusal becomes an `ApiError`: `INVALID_TRANSITION` (400) with `details.allowed`, `GUARD_FAILED` (400) with a reason, or `FORBIDDEN_FOR_PERSONA` (403). Only then does it write, as one conditional `updateMany` on `{id, status: from, version}` that also pushes the history entry; `count !== 1` means someone else moved the order first and returns 409 `VERSION_CONFLICT`.

Two guards beyond the shape of the graph: `SUBMITTED` requires at least one `UPLOADED` asset (ADR-012), and `COMPLETED` requires the caller to be the job's assigned installer. Entering `READY_FOR_INSTALL` has one side effect — `ensureJobForOrder` opens the install job (ADR-009).

On the client, `orderActionsFor` returns the actions available to the current persona together with a reason for any that are disabled, which is what renders "Needs at least one uploaded file" under a greyed-out Submit.

**Verify.**
- `tests/unit/domain/state-machine.test.ts` — the table, terminality, cancellability.
- `tests/unit/domain/permissions.test.ts` and `tests/unit/domain/order-actions.test.ts` — who may do what, and the disabled reasons.
- `tests/integration/orders.test.ts › DRAFT -> IN_PRODUCTION is an invalid transition with the allowed list`.
- `tests/integration/routes.test.ts › transition DRAFT -> IN_PRODUCTION returns 400 INVALID_TRANSITION with the allowed list` — the HTTP 400 itself, through the exported handler.
- `tests/integration/orders.test.ts › cancelling from IN_PRODUCTION is not allowed`.
- Manual: README checklist step 3 (the `curl`).

**Limits.** There is no re-open or rollback: `COMPLETED` and `CANCELLED` are terminal, and history is append-only. `expectedVersion` is optional on the request; when a client omits it the server uses the version it just read, which narrows the conflict window but does not close it the way a client-supplied version does.

## 5. Concurrency and double-booking prevention

> "Implement distributed locking (e.g., Redis lock or optimistic DB locking) on the job assignment endpoint to ensure that when multiple installers accept a job simultaneously, exactly one installer is assigned."

**Where.** `lib/services/jobs.ts` (`claimJob`, `verifyJob`), `app/api/jobs/[id]/claim/route.ts`, `app/api/jobs/[id]/verify/route.ts`, `lib/domain/permissions.ts` (`jobActionsFor`), `components/jobs/claim-button.tsx`.

**How.** Optimistic DB locking on a single document — the second option the task names. `claimJob` performs exactly one write:

```ts
prisma.installJob.updateMany({
  where: { id: jobId, OR: [
    { status: 'OPEN' },
    { status: 'CLAIMED', claim: { is: { expiresAt: { lt: now } } } },
  ]},
  data: { status: 'CLAIMED', claim: { installerId, claimedAt: now, expiresAt },
          installerId: null, version: { increment: 1 } },
});
```

MongoDB applies an update to one document atomically and serialises concurrent writers on it, so each of N racing requests evaluates the filter against the current document. The first to apply sets `status: CLAIMED` with a future `expiresAt`; every later evaluation matches nothing. Exactly one caller sees `count === 1`; the rest get 409 `CLAIM_TAKEN` (or 404 if the job does not exist). There is no read-then-write window, no transaction, no lock service, and no retry loop, so there is nothing to leak or to reconcile — which is why this was chosen over an Upstash Redis `SET NX PX` (ADR-005): a Redis lock would be a second source of truth that has to agree with Mongo.

`verifyJob` uses the same one-write shape with filter `{id, status: 'CLAIMED', claim.installerId = caller, claim.expiresAt > now}`, so `pass` → `ASSIGNED` and `fail` → `OPEN` are equally race-free. A `count !== 1` is disambiguated by a follow-up read into 409 `CLAIM_EXPIRED` or 409 `NOT_CLAIMANT`.

**Verify.**
- `tests/integration/jobs.test.ts › exactly one of 50 concurrent claims wins` — one OPEN job, 50 installers, 50 `claimJob` calls through `Promise.allSettled`; asserts exactly one fulfilled, 49 rejected with `CLAIM_TAKEN`, and the stored document `CLAIMED` by the winner. Against a real Atlas replica set, not a mock.
- `tests/integration/jobs.test.ts › verify fail reopens, verify pass assigns, later claim on ASSIGNED is 409`.
- `tests/integration/jobs.test.ts › verify by a non-claimant is NOT_CLAIMANT, verify after expiry is CLAIM_EXPIRED`.
- `tests/integration/routes.test.ts › claiming a job with an ops persona returns 403 FORBIDDEN_FOR_PERSONA`.
- Manual: README checklist step 5 (two windows, two installers).

**Limits.** The guarantee is per-document, which is all this problem needs; it would not extend to a claim that had to touch two documents atomically (that would need a transaction). Installer identity comes from the `x-persona` header, so "exactly one installer wins" is exactly one *claimed identity* — real auth would replace the header with a session lookup and nothing else about the lock would change. Note for the two-window demo: the `sc_persona` cookie only seeds a tab's first render (each tab then holds its persona in React state), so reloading the first window after setting the second will make it adopt the second's persona.

## 6. The 3-minute automatic release

> "Provide a fallback mechanism: if an installer claims a job but fails identity/payment verification within 3 minutes, release the lock automatically back to the marketplace."

**Where.** `lib/domain/claims.ts` (`isClaimExpired`, `toPublicJob`, `claimRemainingMs`, `claimTtlMs`), `lib/services/dto.ts` (`toJobDTO`), `lib/services/jobs.ts` (`releaseExpired`), `lib/services/bootstrap.ts`, `app/api/events/route.ts`, `components/jobs/claim-countdown.tsx` and `components/jobs/countdown-ring.tsx`, `lib/hooks/use-now.ts`.

**How.** The claim carries `expiresAt = now + CLAIM_TTL_MS` (default 180 000 ms — three minutes — overridable by env). There is no timer on Vercel to fire at T+3 min, so expiry is enforced by predicate rather than by a process, in three layers:

1. **Every read.** `toPublicJob` maps a `CLAIMED` job whose `claim.expiresAt <= now` to `{status: 'OPEN', claim: null}`. Every job that leaves the server goes through `toJobDTO`, which calls it — REST responses, the bootstrap payload, and SSE frames alike. An expired claim is therefore never visible to any client.
2. **Every write.** The claim filter in §5 already accepts `CLAIMED AND expired`, so a different installer can take the job the instant the window lapses, whether or not anything has swept the database.
3. **A sweep, for visibility.** `releaseExpired()` flips lapsed claims to `OPEN` in the database and bumps `version`. It runs at the start of `GET /api/bootstrap` and again whenever a client connects to `GET /api/events`. That write is itself a change-stream event, so every *other* open dashboard sees the card flip back to Open live, with no one reloading. Correctness never depends on it running — it exists so the release is *observed*, not so it is *true*.

On screen, one shared 1-second clock (`useNow`, seeded from `BootstrapDTO.serverTime` so server and client agree on the first render) drives the chip countdown on the card and the ring in the verification dialog. At zero the client renders the job as OPEN, which matches what the server would say.

Verification itself is a modal with **Verify** (→ ASSIGNED) and **Simulate failure** (→ OPEN immediately), so every branch of the fallback is reachable: pass, explicit fail, and timeout (ADR-010).

**Verify.**
- `tests/unit/domain/claims.test.ts` — the expiry predicate and remaining-time maths at the boundaries.
- `tests/integration/jobs.test.ts › an expired claim can be re-claimed by another installer`.
- `tests/integration/jobs.test.ts › getJob reports an expired claim as OPEN without writing`.
- `tests/integration/jobs.test.ts › releaseExpired flips only expired claims and bumps version`.
- `tests/integration/bootstrap.test.ts › reports an expired claim as OPEN and actually releases it in the DB`.
- Manual: README checklist step 6. Set `CLAIM_TTL_MS=20000` in `.env` and restart if you do not want to watch for three minutes.

**Limits.** Between the lapse and the next sweep the raw collection can still hold a `CLAIMED` document — harmless, because nothing reads or writes it without applying the predicate, but visible to anyone inspecting Atlas directly. A Vercel Pro cron or an Upstash QStash callback would make it eager (ADR-006). "Identity/payment verification" is simulated by two buttons; there is no verification provider.

## 7. Async file upload simulation

> "Simulate direct-to-cloud asset upload (e.g., 1GB+ print files) using pre-signed URLs. Display upload progress on the dashboard in real-time using WebSockets, Server-Sent Events (SSE), or optimistic UI updates without crashing HTTP nodes or repeatedly polling the database."

**Where.** `lib/storage/r2.ts` (S3-compatible client, presigning, multipart), `lib/services/assets.ts` (`createAsset`, `presignParts`, `reportProgress`, `completeAsset`, `abortAsset`), `app/api/assets/**`, `lib/upload/plan.ts` (part maths, throttle rule, ETA), `lib/upload/part-source.ts`, `lib/upload/uploader.ts` (`MultipartUploader`, `xhrPut`), `lib/upload/use-uploads.tsx` (the provider that owns in-flight uploads), `components/uploads/*`.

**How — pre-signed, direct to cloud.** Vercel caps request bodies at 4.5 MB, so bytes cannot pass through the app, and in this implementation they never do. `POST /api/assets` creates the `Asset` row, starts an R2 `CreateMultipartUpload`, and returns `{ asset, uploadId, partSize, partCount }`. The browser then asks `POST /api/assets/:id/parts` for presigned `UploadPart` URLs in batches of 20, valid for an hour, and PUTs 10 MiB parts straight to `https://<account>.r2.cloudflarestorage.com` — four in flight — collecting each part's `ETag`. `POST /api/assets/:id/complete` hands the sorted part list to R2's `CompleteMultipartUpload`. The server's entire role is signing and bookkeeping; every byte goes browser → R2.

**How — progress without polling.** The uploader uses `XMLHttpRequest` (not `fetch`) precisely because it emits upload progress events. Those drive the local bar immediately. To reach *other* dashboards, the browser posts `bytesUploaded` to `POST /api/assets/:id/progress` at most every 2 seconds or every +5 % (`shouldReportProgress`) — roughly 20–30 small writes for a whole upload. Each write is a change-stream event that is fanned out over SSE as `asset.updated`, so a Vendor watching in another tab sees the same bar move. No client ever polls; no one queries the database on a timer. The uploading tab additionally shows throughput and time-left from `estimate()`, refreshed on a 120 ms cadence, because the server's coarse `progressPct` would look jerky to the person who started the upload.

**How — 1 GB without a 1 GB file.** "Simulate large file" offers 100 MB / 1 GB / 2 GB. `simulatedSource` allocates one zero-filled 10 MiB buffer and hands out `Blob` views of it per part, so browser memory stays at a single part while the full size really is uploaded through the identical code path. The asset is flagged `simulated: true`; give the bucket a lifecycle rule expiring `simulated-*` objects after a day so the demo does not accumulate gigabytes of zeroes.

**How — failure paths.** A part is retried 3 times with exponential backoff. If it still fails, the uploader stops, calls the abort endpoint with `{"reason":"error"}`, and the asset lands `FAILED` so the row offers **Retry** (which re-uploads the same bytes as a fresh asset, without a second file picker). A user pressing ✕ sends the default reason and the asset lands `ABORTED`. Either way the R2 multipart is abandoned, so no orphaned parts accumulate. Uploads survive closing and reopening the detail sheet, because the uploaders live in a ref in `UploadsProvider`, above the panel that renders them.

**Verify.**
- `tests/unit/upload/plan.test.ts` — part count, part ranges, and the 2 s / 5 % / 100 % throttle rule.
- `tests/unit/upload/uploader.test.ts` — parallelism, batching, retry-then-give-up, abort, progress reporting, with a fake `put`.
- `tests/unit/upload/part-source.test.ts` and `tests/unit/upload/eta.test.ts`.
- `tests/integration/assets.test.ts` — the whole service lifecycle against a real database with R2 mocked at the `lib/storage/r2.ts` boundary, including `creates an asset on a DRAFT order: PENDING -> UPLOADING with a real uploadId and correct part plan`, `completeAsset marks UPLOADED and calls completeMultipart with parts sorted by partNumber`, and `abortAsset with reason 'error' marks FAILED so the row can offer Retry`.
- `tests/integration/routes.test.ts › POST /api/assets/:id/progress returns 204`.
- Manual: README checklist steps 2 and 9. In devtools' Network tab, the PUTs go to `r2.cloudflarestorage.com`, not to the app.

**Limits.** There is no resume across sessions: reloading mid-upload leaves the asset `UPLOADING` with a live R2 multipart, and the row offers Abort. Progress deliberately travels through the database, which is a write amplification that Redis pub/sub would avoid at the cost of a second datastore (ADR-016). The R2 bucket's CORS rule must expose `ETag` or the upload can never complete — see the README for the exact JSON and why.

## 8. Realtime state changes (SSE over change streams)

> "…in real-time using WebSockets, Server-Sent Events (SSE), or optimistic UI updates without crashing HTTP nodes or repeatedly polling the database." / "Build intuitive UI indicators for real-time state changes, active uploads, and job claiming statuses."

**Where.** `app/api/events/route.ts`, `lib/realtime/sse.ts` (`createSseStream`), `lib/realtime/events.ts` (`changeToEvent`, `formatSse`), `lib/realtime/use-realtime.ts` (`useRealtime`, `reduceConnection`), `lib/realtime/apply-event.ts`, `lib/db/mongo.ts`, `components/layout/connection-indicator.tsx`.

**How.** `GET /api/events` is a Node streaming route with `maxDuration = 300`. It sweeps expired claims, then opens **one** change stream over `Order`, `InstallJob`, and `Asset` (`operationType` in `insert | update | replace`, `fullDocument: 'updateLookup'`). Change streams tail the replica-set oplog, so the server itself never issues a periodic `find` — that is what makes this "no repeated polling" rather than polling hidden behind a socket.

Each change becomes an SSE frame whose `event:` is one of `order.created`, `order.updated`, `job.created`, `job.updated`, `asset.created`, `asset.updated` and whose `data` is the same public DTO the REST API returns (lazy claim expiry included). The change-stream resume token is used as the SSE `id:`, so a reconnect resumes exactly where it stopped, via the browser's automatic `Last-Event-ID` or the explicit `?after=` parameter.

Three things keep a long-lived stream healthy on serverless:
- `: connected` on open and `: hb` comments every 15 s, so proxies do not close an idle socket.
- `event: reconnect` at 280 s followed by a clean close — inside Vercel's 300 s ceiling, so the function is never killed mid-frame and the client reopens with the last id.
- `event: resync` if Mongo reports a lost resume token (code 286 or 280): the cursor restarts from now and the client refetches the bootstrap. After 3 resyncs the stream errors instead of looping.

On the client, `useRealtime` keeps one `EventSource` per dashboard and applies each event into the query cache with `setQueryData`, so cards move without a refetch. Its connection state machine is `connecting | live | reconnecting | degraded`; `shouldRetryManually` handles the case EventSource will not retry on its own (an HTTP error status is fatal by spec), so a 500 from a dead change stream still leads somewhere. After **3** consecutive failures the client switches to refetching every **10 s** and the indicator reads "Polling every 10 s" — the only polling in the system, and off in normal operation. Returning to `live` invalidates once and stops it.

The visible indicators asked for are the connection dot in the header, the live progress bar on cards and asset rows, and the job chip with its countdown ("Open for installers" / "Claimed · Dana K. · 2:41" / "Assigned · Dana K.").

**Verify.**
- `tests/unit/realtime/events.test.ts` — change document → SSE frame, including which operations are ignored.
- `tests/unit/realtime/sse.test.ts` — heartbeat, the 280 s reconnect, resync-on-resume-error, MAX_RESYNCS, teardown.
- `tests/unit/realtime/use-realtime-state.test.ts` — the connection reducer and the manual-retry rule.
- `tests/unit/realtime/apply-event.test.ts` — cache patching.
- `tests/integration/sse.test.ts › emits a job.updated frame within 5s of a real InstallJob update` — a genuine Atlas change stream end to end.
- `tests/integration/events-route.test.ts › returns the SSE headers, a connected comment, and a real job.updated frame`.
- Manual: README checklist steps 2, 5, 6 and 10.

**Limits.** One change stream cursor per open dashboard tab. Atlas M0 allows 500 connections, so this is fine for a demo and is the first thing to change for scale: one shared stream per instance with in-memory fan-out on a long-lived host, or hosted pub/sub on Vercel (ADR-004). Streaming also requires Vercel Fluid compute; a proxy that buffers `text/event-stream` would push clients into degraded mode, which is exactly why degraded mode exists.

## 9. Responsiveness

> "Make the application responsive across mobile, tablet, and desktop views."

**Where.** `components/board/kanban-board.tsx`, `components/board/status-column.tsx`, `components/board/mobile-status-tabs.tsx`, `components/board/collapsed-rail.tsx`, `lib/board/visibility.ts`, `components/orders/order-detail-sheet.tsx`.

**How.** Three layouts, chosen with Tailwind breakpoints rather than JavaScript, so there is no hydration flash:

- **Mobile (< 768 px).** The Kanban is replaced by horizontally scrollable status tabs with counts over a single-column card list; `defaultMobileTab` opens on the first non-empty status for the persona. The detail sheet is full-screen.
- **Tablet (768–1279 px).** Kanban with fixed 280 px columns, horizontal overflow and scroll-snap per column — about three and a half columns visible at 1024 px, so it is obvious the board continues.
- **Desktop (≥ 1280 px).** Snap and overflow are turned off and the columns flex to fill the width; the detail sheet is a right-hand panel.

Which columns exist at all is a persona question, handled by the pure helpers in `lib/board/visibility.ts`: ops see everything, a vendor sees only their own orders, and an installer sees full columns only for Ready for install and Completed (everything else collapses to a 40 px rail with a count) with Completed filtered to their own installs. `mobileStatuses` derives the mobile tabs from the same rule, so the two layouts never disagree.

**Verify.** `tests/unit/board/visibility.test.ts` covers `visibleOrders`, `columnMode`, `countsByStatus`, `mobileStatuses`, and `defaultMobileTab` per persona. Manual: README checklist step 11.

**Limits.** No drag-and-drop between columns — status changes go through the confirm dialog so the transition is explicit and auditable. The layout is verified by hand and by unit tests on the visibility rules; there are no visual-regression snapshots.

## 10. Docker Compose — consciously dropped

> "Create a public or private GitHub repository containing your full codebase, including containerized execution files (`docker-compose.yml` preferred)."

**This repository contains no Dockerfile and no `docker-compose.yml`, on purpose.** It is the one deliverable that is not met as literally written, so here is the reasoning rather than an omission.

Both Prisma's MongoDB connector and change streams require a replica set. A local compose Mongo therefore cannot be `image: mongo` — it needs `--replSet rs0`, a one-shot init container running `rs.initiate()`, a healthcheck that waits for PRIMARY, and an app container that pushes the schema and seeds on first boot. That is real machinery to maintain, and it buys a *different* database from the one behind the live URL: the reviewer's compose data and the deployed data would diverge, and any change-stream behaviour proven locally would still have to be re-proven on Atlas.

Pointing every environment at one MongoDB Atlas cluster instead makes local development and production identical, and means the integration suite — including the 50-way claim race and the real change-stream SSE test — proves the production configuration. The reviewer's setup shrinks to two steps:

- **To just use the app:** open the live URL. Nothing to install.
- **To run it locally:** `cp .env.example .env`, fill in an Atlas connection string and R2 credentials, then `pnpm install && pnpm prisma db push && pnpm db:seed && pnpm dev`.

**What is lost.** There is no single `docker compose up` that boots the whole thing offline, and running locally requires credentials rather than nothing. **What is gained.** One database, one configuration, no container orchestration to debug, and a live deployment whose behaviour the test suite actually covers. If a container is required, the app is a stock Next.js 15 app with no local service dependencies: a standard Node image running `pnpm build && pnpm start` with the same `.env` is all it would take — the reason it was not included is that it would add a second, differently-configured path to keep honest, not that it would be hard.

## 11. README requirements

> "Architectural Spec & System Documentation: Include a `README.md` documenting your database schema, concurrency lock strategy and direct-to-cloud upload pipeline."

**Where.** [`README.md`](README.md) — sections "Database schema", "Concurrency lock strategy", "Direct-to-cloud upload pipeline", plus "State machine", "Realtime", "Configuration", "Tests", "Trade-offs", a manual QA checklist, and the repository layout.

**How.** The three required topics are covered with the actual code: the schema section lists every field and index and says why `InstallJob` is separate; the lock section quotes the real `updateMany` and argues the exactly-one-winner property from MongoDB's single-document atomicity, naming the test that demonstrates it; the upload section walks the six-step pipeline with the real constants (10 MiB parts, batches of 20, 4 parallel, 3 retries, 2 s / 5 % throttle) and carries the R2 CORS rule with the two fields that silently break uploads if omitted.

Deeper design material lives in `docs/superpowers/specs/`: the architecture design, 17 ADRs with the alternatives that were rejected, and the UI pages-and-flows spec. The README's "Trade-offs" section is the honest summary of those ADRs, including the ones amended during implementation.

**Verify.** Every command printed in the README was run: `pnpm test` → 274 passed; `pnpm test:integration` → 47 passed; `pnpm vitest run --project integration tests/integration/jobs.test.ts` → 7 passed.

**Limits.** The README documents the system as built; where an ADR was amended during implementation the amendment is recorded in `docs/superpowers/specs/2026-09-16-signcraft-decisions.md` rather than by rewriting the original decision.

## 12. Live deployment

> "Deploy the application to a live platform (e.g., Vercel, Render, Railway, AWS) and provide the live deployment URL."

**Live URL:** https://signcraft-blond.vercel.app

**How.** Vercel with the Node runtime and Fluid compute (required for the streaming `/api/events`, which sets `maxDuration = 300`); build command `pnpm build`, which runs `prisma generate` before `next build`. The database is MongoDB Atlas M0, the same cluster used for local development. Object storage is Cloudflare R2, whose bucket CORS `AllowedOrigins` must include both `http://localhost:3000` and `https://signcraft-blond.vercel.app` (covered by `https://*.vercel.app`) or uploads fail at the preflight. Environment variables on Vercel are exactly the list in `.env.example`: `DATABASE_URL`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `NEXT_PUBLIC_APP_URL` (set to the deployed origin), and optionally `CLAIM_TTL_MS`.

**Verify.** Open the URL and run the README's manual QA checklist against it; it is written to work on a deployment whose seeded orders have already been moved around, which is why step 1 creates a fresh order.

**Limits.** The Atlas IP allow-list is `0.0.0.0/0` because Vercel's egress addresses are not fixed — acceptable for a demo, not for production (Atlas private endpoints or a static-egress add-on would be the real answer). M0 is a free shared tier: a cold write takes 2–3 s, so the first interaction after an idle period is noticeably slow. And because the deployment is a shared demo, the database is shared: another reviewer clicking at the same time will move the same cards.
