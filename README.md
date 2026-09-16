# SignCraft — B2B Signage Marketplace Management

A single-page management dashboard for custom-signage orders: order lifecycle, installer job claiming, and direct-to-cloud upload of very large print files. Built as a technical assessment against [`SignCraft_Task_Specification.md`](SignCraft_Task_Specification.md).

**Live deployment:** https://signcraft-blond.vercel.app

A requirement-by-requirement walkthrough (what each rule means, where it lives, how to verify it) is in [`EXPLANATIONS.md`](EXPLANATIONS.md).

---

## What it does

Three things the assessment asks to be judged on:

1. **A strictly enforced order state machine.** `DRAFT → SUBMITTED → VENDOR_ACCEPTED → IN_PRODUCTION → READY_FOR_INSTALL → COMPLETED`, with `CANCELLED` reachable only before production starts. The rules live once in `lib/domain/state-machine.ts` and are applied by both the React components and the API. An illegal jump is refused with HTTP 400 and the allowed list.
2. **Double-booking prevention on installer claims.** When an order reaches `READY_FOR_INSTALL` a job opens. Any number of installers may press Claim at the same instant; exactly one wins, because the claim is a single conditional MongoDB update. The winner has 3 minutes to verify, otherwise the job returns to the marketplace.
3. **Direct-to-cloud uploads.** Print files (1 GB+) travel browser → Cloudflare R2 over presigned multipart URLs. Bytes never pass through the app. Progress appears live on every open dashboard without any client polling the database.

There is no login: a header switcher acts as **Ops**, a **Vendor**, or an **Installer**, so a reviewer can open two tabs and race a claim against themselves.

## Quick start

Needs Node 20+ and pnpm 11, a MongoDB Atlas cluster (M0 free tier is enough), and a Cloudflare R2 bucket.

```bash
cp .env.example .env      # fill in DATABASE_URL and the four R2_* values
pnpm install
pnpm prisma db push       # create collections and indexes
pnpm db:seed              # ONCE: 3 vendors, 4 installers, 8 orders
pnpm dev                  # http://localhost:3000
```

Notes:

- **Atlas, not a local Mongo.** Prisma's MongoDB connector and change streams both require a replica set; every Atlas cluster is one. The same `DATABASE_URL` is used for local development and for Vercel. There is no Docker in this repo — see [Trade-offs](#trade-offs).
- **Seed once.** `pnpm db:seed` is idempotent by `orderNumber`: it skips orders that already exist. It does **not** move orders back to their original status, so running it again after you have driven orders through the board changes nothing.
- **pnpm 11.** `pnpm-workspace.yaml` carries an `allowBuilds` map. pnpm 11 ignores the older `onlyBuiltDependencies` list, and without `allowBuilds` a clean install silently skips Prisma's build scripts and `prisma generate` fails.
- **R2 CORS** must be configured on the bucket before any upload will work; the exact JSON is under [Direct-to-cloud upload pipeline](#direct-to-cloud-upload-pipeline).

## Personas and the two-tab recipe

A persona is sent with every request as an `x-persona` header (`ops`, `vendor:<id>`, `installer:<id>`) and parsed server-side in `lib/api/persona.ts`. Every mutation re-checks it; the UI only mirrors what the server would allow.

The `sc_persona` cookie only *seeds* the first render of a tab; after that each tab keeps its persona in React state. That is what lets two tabs be two different installers — just do not reload the first tab afterwards, or it will pick up the persona the second tab wrote to the shared cookie.

| Persona | Sees | Can do |
|---|---|---|
| Ops | every order | create orders, upload/simulate files, Submit, Cancel |
| Vendor | only their own orders | Accept, Start production, Mark ready, Cancel (before production) |
| Installer | the marketplace, plus their own completed installs | Claim, Verify, Complete |

**Race a claim yourself:** open `http://localhost:3000` in two browser windows, set one to installer *Dana K.* and the other to *Omar S.*, drive an order to Ready for install (as Ops then as its Vendor), then press **Claim** in both windows as close together as you can. One gets the job and a 3:00 countdown; the other gets "Claimed by another installer" and watches the same countdown. Close the verification dialog and wait for zero: both windows show the job reopen, live.

## Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 15 (App Router), React 19, TypeScript strict |
| UI | Tailwind CSS 4, Shadcn UI (Radix), TanStack Query, sonner |
| Data | MongoDB Atlas via Prisma 6 (`provider = "mongodb"`) |
| Change streams | `mongodb` native driver, imported only in `lib/db/mongo.ts` |
| Object storage | Cloudflare R2 via `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` |
| Validation | Zod 4 (`lib/domain/schemas.ts`, shared by API and forms) |
| Tests | Vitest (unit + integration), `@testing-library/react` + jsdom for component tests |
| Hosting | Vercel (Node runtime, Fluid compute) |

## Architecture

```
 Browser (dashboard, N tabs, each with a persona)
   │  JSON API (x-persona header)          │ PUT parts (presigned URLs)
   │  EventSource  GET /api/events         ▼
   ▼                                  Cloudflare R2
 Vercel Functions (Node runtime)
   ├─ Route handlers ── Prisma ──► MongoDB Atlas (replica set)
   └─ /api/events    ── change stream ◄── oplog
```

No Redis, no worker, no cron. Everything that needs coordination is one atomic write to MongoDB; everything that needs to be live is a change stream forwarded as SSE.

Layering is enforced by convention and by the tests: `lib/domain` is pure (no Prisma, no React, no fetch) and is imported by both client and server; `lib/services` is the only place that talks to the database; route handlers parse, resolve the persona, call a service, and respond — the largest file under `app/api` is 33 lines, most are under 20.

### Database schema

Five models in `prisma/schema.prisma`.

**Order** — `orderNumber` (unique, `SC-0001` style), `title`, `customerName`, `signType`, `widthCm`, `heightCm`, `quantity`, `installAddress`, `dueDate`, `notes`, `vendorId`, `status`, `version`, and an embedded `history[]` of `{from, to, actorType, actorId, reason, at}`. Indexed on `status` and on `(vendorId, status)`.

**InstallJob** — at most one per order (`orderId` is unique), created as a side effect of the transition into `READY_FOR_INSTALL`. `status: OPEN | CLAIMED | ASSIGNED`, an embedded `claim {installerId, claimedAt, expiresAt}` while claimed, `installerId` once assigned, `version`. Indexed on `status`.

**Asset** — `orderId`, `fileName`, `contentType`, `sizeBytes`, `storageKey`, `uploadId` (the R2 multipart id, cleared when the upload ends), `status: PENDING | UPLOADING | UPLOADED | FAILED | ABORTED`, `bytesUploaded`, `progressPct`, `simulated`. Indexed on `orderId`.

**Vendor**, **Installer** — just a unique `name`; both seeded.

`sizeBytes` and `bytesUploaded` are `BigInt` in Prisma and plain numbers at the API boundary (`normalise` in `lib/services/dto.ts`).

Why `InstallJob` is a separate collection: the claim race is then a conditional write on one tiny document that never contends with order edits, and the concurrency test is self-contained (ADR-015).

### State machine

`lib/domain/state-machine.ts` holds the transition table; `lib/domain/permissions.ts` decides who may take each transition and what must be true first.

| From | Allowed to | Who |
|---|---|---|
| DRAFT | SUBMITTED, CANCELLED | Ops submits; Ops or the owning vendor cancels |
| SUBMITTED | VENDOR_ACCEPTED, CANCELLED | the owning vendor accepts |
| VENDOR_ACCEPTED | IN_PRODUCTION, CANCELLED | the owning vendor |
| IN_PRODUCTION | READY_FOR_INSTALL | the owning vendor |
| READY_FOR_INSTALL | COMPLETED | the installer assigned to the job |
| COMPLETED, CANCELLED | — | terminal |

Two guards: `SUBMITTED` needs at least one asset in `UPLOADED` (`NO_UPLOADED_ASSET`), and `COMPLETED` needs an `ASSIGNED` job whose installer is the caller (`NO_ASSIGNED_INSTALLER`).

The write itself is one conditional `updateMany` on `{id, status: from, version: expectedVersion}` that also pushes the history entry. `count !== 1` means the order moved underneath the caller, and returns 409 `VERSION_CONFLICT`.

An illegal jump never reaches the database:

```json
{ "error": { "code": "INVALID_TRANSITION",
             "message": "Cannot move DRAFT to IN_PRODUCTION",
             "details": { "from": "DRAFT", "to": "IN_PRODUCTION", "allowed": ["SUBMITTED", "CANCELLED"] } } }
```

The same `allowedTransitions` function drives the buttons in `components/orders/order-actions.tsx`, so the UI never offers a transition the server would refuse — and refuses again on the server when someone calls the API directly.

### Concurrency lock strategy

**Goal.** Many installers claim the same job at the same instant; exactly one is assigned.

**Mechanism.** Optimistic DB locking on a single document. `claimJob` in `lib/services/jobs.ts` issues exactly one write:

```ts
const res = await prisma.installJob.updateMany({
  where: {
    id: jobId,
    OR: [
      { status: 'OPEN' },
      { status: 'CLAIMED', claim: { is: { expiresAt: { lt: now } } } }, // an expired claim is free
    ],
  },
  data: {
    status: 'CLAIMED',
    claim: { installerId, claimedAt: now, expiresAt },  // now + CLAIM_TTL_MS (180 000 ms)
    installerId: null,
    version: { increment: 1 },
  },
});
if (res.count !== 1) { /* 409 CLAIM_TAKEN, or 404 if the job does not exist */ }
```

MongoDB applies an update to one document atomically and serialises concurrent writers on it. Each of N concurrent requests evaluates the filter against the *current* document: the first to apply flips `status` to `CLAIMED` with a future `expiresAt`, so every later evaluation matches zero documents. Exactly one caller ever sees `count === 1`. No read-then-write window, no transaction, no Redis, no retry loop. Prisma's composite-type filter (`claim: { is: {...} }`) compiles down to the nested `claim.expiresAt` predicate and works on the Mongo connector, so the `$runCommandRaw`/`findAndModify` fallback the design spec kept in reserve was not needed.

`verifyJob` uses the same shape — filter `{id, status: 'CLAIMED', claim.installerId = me, claim.expiresAt > now}` — so `pass` (→ `ASSIGNED`) and `fail` (→ `OPEN`) are equally race-free, and a `count !== 1` is disambiguated into 409 `CLAIM_EXPIRED` or 409 `NOT_CLAIMANT` by a follow-up read.

**What the race test proves.** `tests/integration/jobs.test.ts › exactly one of 50 concurrent claims wins` creates one OPEN job and 50 installers, fires all 50 `claimJob` calls with `Promise.allSettled`, and asserts: exactly one fulfilled, 49 rejected with `CLAIM_TAKEN`, and the document in Atlas left `CLAIMED` by the winner. It runs against a real Atlas replica set, not a mock.

**The 3-minute release.** Vercel has no process to wake up at T+3 min, so expiry is *lazy* rather than scheduled, and three mechanisms make that correct:

1. **Every read applies the predicate.** `toPublicJob` (`lib/domain/claims.ts`) maps a `CLAIMED` job whose `claim.expiresAt <= now` to `{status: 'OPEN', claim: null}` before it leaves the server. Every job that reaches a client goes through `toJobDTO`, which calls it — including jobs pushed over SSE.
2. **Every write applies it too.** The claim filter above already treats an expired claim as free, so a second installer can take the job the moment it lapses, whether or not anything swept the database.
3. **A sweep makes it visible.** `releaseExpired()` flips lapsed claims to `OPEN` in the database; it runs at the start of `GET /api/bootstrap` and again whenever a client connects to `GET /api/events`. That write goes through the change stream, so every *other* open dashboard sees the card flip back to Open without reloading. Correctness never depends on the sweep running.

On screen, one shared 1-second clock (`lib/hooks/use-now.ts`) drives every countdown chip and the ring in the verification dialog; at zero the client renders the job as OPEN, which is exactly what the server would say.

### Direct-to-cloud upload pipeline

Vercel caps request bodies at 4.5 MB, so file bytes must never touch the app. They do not: the route handlers only presign, record progress, and complete or abort.

1. `POST /api/assets` → `createAsset` writes the `Asset` (PENDING), calls R2 `CreateMultipartUpload`, stores the `uploadId`, flips the asset to `UPLOADING`, and returns `{ asset, uploadId, partSize, partCount }`. If R2 fails, the row is kept and marked `FAILED` so the UI can offer Retry.
2. The browser requests presigned `UploadPart` URLs from `POST /api/assets/:id/parts` in batches of **20** (`PRESIGN_BATCH`), each valid for 1 hour (`PRESIGN_EXPIRY_S`).
3. `MultipartUploader` (`lib/upload/uploader.ts`) PUTs **10 MiB** parts (`PART_SIZE`) straight to R2, **4 in flight** (`MAX_PARALLEL_PARTS`), via `XMLHttpRequest` so it gets byte-level progress events, collecting each part's `ETag`. A failing part is retried up to **3** times with exponential backoff (`MAX_PART_RETRIES`, 1 s / 2 s / 4 s).
4. At most every **2 seconds or every +5 %** (`shouldReportProgress`), the browser posts `bytesUploaded` to `POST /api/assets/:id/progress` (204). That one small write flows through the change stream to every other dashboard — which is how a Vendor tab sees an Ops upload move without polling. The uploading tab itself renders a finer local estimate (throughput and ETA from `estimate()`), refreshed on a 120 ms cadence.
5. `POST /api/assets/:id/complete` sends the sorted part list to R2 `CompleteMultipartUpload` and marks the asset `UPLOADED`.
6. `POST /api/assets/:id/abort` abandons the R2 multipart so no orphaned parts are left, and records the outcome: the default (`{"reason":"user"}` or an empty body) is `ABORTED`, while `{"reason":"error"}` — what the uploader sends when it has exhausted its retries — is `FAILED`, so the row offers **Retry** (which re-uploads the same bytes as a fresh asset).

Objects are keyed `orders/<orderId>/<assetId>/<sanitised file name>`.

**Simulating a large file.** "Simulate large file" offers 100 MB / 1 GB / 2 GB (`SIMULATED_SIZES`). `simulatedSource` allocates one zero-filled 10 MiB buffer and hands out `Blob` views of it per part, so browser memory stays at one part while genuinely uploading the full size through the identical pipeline. The asset is flagged `simulated: true` and named `simulated-1gb.bin`. Real objects land in R2, so give the bucket a lifecycle rule expiring `simulated-*` objects after a day unless you want to pay to store gigabytes of zeroes.

**Required R2 bucket CORS rule:**

```json
[{ "AllowedOrigins": ["http://localhost:3000", "https://*.vercel.app"],
   "AllowedMethods": ["GET", "PUT", "HEAD"],
   "AllowedHeaders": ["*"],
   "ExposeHeaders": ["ETag"],
   "MaxAgeSeconds": 3600 }]
```

`https://*.vercel.app` covers the deployed origin `https://signcraft-blond.vercel.app`; list that origin explicitly if you prefer not to wildcard. Set the rule in the Cloudflare dashboard on the bucket's Settings tab. An R2 API token scoped to *Object Read & Write* cannot change bucket configuration, so `PutBucketCors` over the S3 API returns 403 with those credentials.

Two fields are easy to leave out and each breaks uploads differently. Without `AllowedHeaders` the preflight fails as soon as the browser announces `Content-Type`, which it does on every part. Without `ExposeHeaders` the PUT succeeds but JavaScript cannot read the `ETag` off the response, so there are no part tags to complete the upload with and it can never finish. `Access-Control-Expose-Headers` comes back on the real response rather than on the preflight, so verify it with an actual cross-origin PUT, not an `OPTIONS` probe.

### Realtime

`GET /api/events` is a Node streaming route (`maxDuration = 300`). It sweeps expired claims, then opens **one** change stream over `Order`, `InstallJob`, and `Asset` filtered to `insert | update | replace` with `fullDocument: 'updateLookup'`, and maps each change to a typed SSE frame (`order.created`, `order.updated`, `job.created`, `job.updated`, `asset.created`, `asset.updated`) whose `data` is the same public DTO the REST API returns — lazy claim expiry included.

- The change-stream resume token is the SSE `id:`, so a reconnect resumes exactly where the stream stopped, via `Last-Event-ID` or the `?after=` query parameter.
- `: hb` comment lines every 15 s keep proxies from closing the socket; the stream opens with `: connected`.
- At 280 s (inside Vercel's 300 s ceiling) the server sends `event: reconnect` and closes cleanly; the client reopens with the last id and misses nothing.
- If Mongo reports a lost resume token (error 286 or 280), the server emits `event: resync`, restarts the cursor from now, and the client refetches the bootstrap. It gives up after 3 resyncs rather than looping.

Clients (`lib/realtime/use-realtime.ts`) apply each event straight into the TanStack Query cache with `setQueryData`, so cards move without a refetch. The connection indicator runs a four-state machine — `connecting | live | reconnecting | degraded` — and after **3** consecutive failures falls back to refetching every **10 s** and shows an amber "Polling every 10 s". That fallback is the only polling in the system, and it is off in normal operation; returning to `live` invalidates the cache once and stops it.

## Configuration

`.env.example` is the list of truth. Never commit `.env`.

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes | MongoDB Atlas SRV string, e.g. `mongodb+srv://…/signcraft?retryWrites=true&w=majority`. Used by Prisma and by the native driver. |
| `R2_ACCOUNT_ID` | yes | Cloudflare account id; forms the S3 endpoint `https://<id>.r2.cloudflarestorage.com` |
| `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | yes | R2 API token pair (Object Read & Write is enough) |
| `R2_BUCKET` | yes | bucket name |
| `NEXT_PUBLIC_APP_URL` | yes | public origin; must match an entry in the bucket's CORS `AllowedOrigins`. `http://localhost:3000` locally; on Vercel it is set to `https://signcraft-blond.vercel.app` |
| `CLAIM_TTL_MS` | no | claim window in ms; default 180 000. Set it to e.g. `20000` to watch the auto-release without waiting 3 minutes. |

## Tests

```bash
pnpm test                 # 274 unit tests, no infrastructure, ~12 s
pnpm test:integration     # 47 integration tests against Atlas, ~4.5 min
pnpm typecheck            # tsc --noEmit
```

Unit tests (`tests/unit/`, 25 files) cover the pure modules: the transition table and guards, the persona parser, the claim-expiry predicate, the SSE frame mapping and connection state machine, the DTO normaliser, the part plan and ETA maths, the uploader (with a fake `put`), and a handful of component tests under jsdom.

Integration tests (`tests/integration/`, 8 files) run against a real MongoDB replica set and mock R2 at the `lib/storage/r2.ts` boundary. They cover the claim race and expiry, verification outcomes, every transition rule through both the services and the exported route handlers, the asset lifecycle, the seed, and a real change-stream round trip (`tests/integration/sse.test.ts › emits a job.updated frame within 5s of a real InstallJob update`).

**Integration tests need their own database.** They call `resetDb()` before each test, which deletes every document — so point them at a separate database name on the same Atlas cluster, never at your demo data. From the repo root:

```bash
export DATABASE_URL="$(node -e "require('dotenv').config({path:'.env'});const u=process.env.DATABASE_URL;const [b,q]=u.split('?');process.stdout.write(b.replace(/\/signcraft$/,'/signcraft_test')+(q?'?'+q:''))")"
pnpm test:integration
```

That rewrites the database name in your `.env` string from `signcraft` to `signcraft_test` and leaves the credentials and query string alone. (If your database is not called `signcraft`, edit the `/signcraft$` pattern or just export the test string yourself.) To run one file, with the same override in the shell:

```bash
pnpm vitest run --project integration tests/integration/jobs.test.ts
```

Integration tests are deliberately serial (`fileParallelism: false`) with a 30 s timeout: every assertion is a real round trip to Atlas, and an M0 cluster takes roughly 2–3 s per write batch.

## Trade-offs

Each of these is an ADR in [`docs/superpowers/specs/2026-09-16-signcraft-decisions.md`](docs/superpowers/specs/2026-09-16-signcraft-decisions.md); the amendments recorded there during implementation are summarised here.

- **No Docker; MongoDB Atlas everywhere.** The task asks for containerised execution files, and this repo has none. Prisma-on-Mongo and change streams both require a replica set, which means a local `docker compose` Mongo needs a `--replSet` flag plus a one-shot `rs.initiate()` and a healthcheck, and then the seeded data in the container is not the data behind the live URL. Pointing every environment at one Atlas cluster makes local and production identical, cuts the reviewer's setup to `.env` + `pnpm dev`, and means the change-stream behaviour proven by the integration suite is the behaviour in production. The cost: no `docker compose up`, and you need a connection string to run locally. If you only want to *see* the app, the live URL needs nothing at all.
- **Expiry is lazy, not scheduled.** A stale `CLAIMED` can sit in the database while nobody is connected. It is invisible because every reader and every writer applies the same predicate, but an inspection of the raw collection can show one. A Vercel Pro cron sweeper or an Upstash QStash callback at T+3 min would make it eager; neither changes correctness.
- **One change stream per connected dashboard.** Correct and simple at demo scale; Atlas M0 allows 500 connections. On a long-lived host the next step is one shared stream per instance with in-memory fan-out; on Vercel it would mean hosted pub/sub (Ably, Pusher).
- **Upload progress travels through the database.** Roughly 20–30 small writes per upload so other viewers see the bar move. Redis pub/sub would avoid the writes at the cost of a second datastore and a second source of truth.
- **Personas instead of authentication.** Identity is trusted from a header so two installers can race in two tabs. Authorisation is still enforced server-side per persona; swapping the header for a session lookup in `lib/api/persona.ts` is the only change real auth would need. This is a demo affordance, not a security model.
- **Prisma 6 plus the native driver.** Prisma does not expose `watch()`, so the `mongodb` driver shares the same connection string in `lib/db/mongo.ts` — two pools to one database, one file.
- **Atlas M0 latency.** A cold write to an M0 cluster takes 2–3 s, which is why the integration suite runs about 4.5 minutes and why the first interaction after an idle period feels slow. It does not affect the claim guarantee, only the wall clock.
- **The detail sheet is non-modal.** It renders without a pointer-blocking overlay so that switching persona while it is open keeps it open (UI spec §7.8) and lets you drive a second persona against the same order. The cost is no focus trap: the board behind stays in the tab order.
- **The whole board re-renders once per second while any claim is counting down.** One shared `useNow` clock threads `now` down as a prop rather than giving every chip its own timer. At eight orders this is free; a real board would memoise the countdown subtree or move it to CSS.
- **`orderNumber` is generated with `count()` then `create`,** with a single retry on a unique-index collision. Not safe under heavy concurrent order creation (a sequence collection or a random suffix would be), but order creation is a one-at-a-time human action while the claim — which *is* contended — is properly atomic.
- **No browser end-to-end tests.** Playwright would prove the two-tab race most convincingly, at about a day's work. The guarantee is proven in-process instead by the 50-way claim race, and the browser flows are covered by the checklist below.

## Manual QA checklist

Roughly 10 minutes, and it exercises every flow in UI spec §7. Start here even on a freshly seeded database — the demo data may have been moved on by earlier walkthroughs, so create your own order first.

1. **Create and submit** (Ops). "New order" → fill the form → Create draft. The card appears in Draft with a highlight ring. Open it: **Submit** is disabled with "Needs at least one uploaded file".
2. **Upload** (Ops). In the detail sheet, "Simulate large file" → 100 MB. The progress bar moves in the sheet and on the card. Switch a second window to the order's Vendor and watch the same bar move there — that is the change stream, not polling. Now Submit is enabled; press it.
3. **Invalid transition.** With the order in Submitted, `curl -X POST localhost:3000/api/orders/<id>/transition -H 'x-persona: ops' -H 'content-type: application/json' -d '{"to":"COMPLETED"}'` → HTTP 400 `INVALID_TRANSITION` with the allowed list.
4. **Vendor flow.** Switch to the order's vendor: Accept → Start production → Mark ready. Cancel disappears once production starts. At Mark ready an install job opens.
5. **The race** (two windows, two installers). Press **Claim** in both at once. One wins and gets the verification dialog with a 3:00 ring; the other gets a 409 and sees "Claimed by another installer" with the same countdown.
6. **Auto-release.** The winner closes the dialog without verifying. Both windows count down and flip the job back to Open at zero. (Set `CLAIM_TTL_MS=20000` in `.env` and restart if you do not want to wait.)
7. **Verify and complete.** Claim again, press **Verify** → the job shows Assigned to you. **Complete** moves the order to Completed; the history timeline shows every step with actor and time.
8. **Simulate failure.** On a fresh claim, press "Simulate failure" in the dialog — the job reopens immediately.
9. **Abort and retry.** Start a 1 GB simulated upload and press ✕ at ~30 %: the row shows Aborted and the card bar disappears everywhere. A failed upload shows Failed with **Retry**.
10. **Degraded realtime.** Block `/api/events` in devtools. The indicator goes Reconnecting, then "Polling every 10 s" after three failures; the board still updates. Unblock → Live.
11. **Responsive.** Resize below 768 px: the board becomes status tabs over a card list and the sheet goes full-screen. Between 768 and 1279 px the columns scroll horizontally with snap. All flows still work.

## Repository layout

```
app/
  page.tsx                 server component: bootstrap fetch, renders <Dashboard>
  api/                     route handlers (thin: parse → persona → service → respond)
components/
  board/                   kanban board, columns, cards, mobile tabs
  orders/                  detail sheet, create/transition dialogs, history
  jobs/                    claim button, countdown, verification dialog
  uploads/                 upload panel, asset rows, simulate dialog
  ui/                      Shadcn primitives
lib/
  domain/                  pure: state machine, permissions, claims, constants, schemas
  services/                all database logic (orders, jobs, assets, bootstrap, dto)
  db/                      Prisma singleton; native Mongo client for change streams only
  storage/                 R2 client, presigning, multipart
  realtime/                SSE stream + event mapping (server), useRealtime (client)
  upload/                  browser multipart uploader, part sources, plan maths
  api/                     ApiError, persona parsing, Zod validation, responses
  query/                   TanStack Query keys, hooks, fetch client
prisma/                    schema.prisma, seed.ts
tests/                     unit/ (no infra) and integration/ (real Atlas)
docs/superpowers/specs/    architecture, ADRs, UI pages and flows
docs/design/               visual design tokens and exported screens
EXPLANATIONS.md            requirement-by-requirement walkthrough
```
