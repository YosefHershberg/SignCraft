# SignCraft — B2B Signage Marketplace Management

A full-stack micro-application for managing custom-signage orders, vendor production, and installer assignment. Built as a technical assessment; see the [task statement](SignCraft_Task_Specification.md).

**Live deployment:** _URL added once deployed to Vercel._
**Status:** Architecture approved, implementation in progress. Design docs live in [`docs/superpowers/specs/`](docs/superpowers/specs/).

---

## What it does

- **Order lifecycle board.** A live Kanban of every order through `DRAFT → SUBMITTED → VENDOR_ACCEPTED → IN_PRODUCTION → READY_FOR_INSTALL → COMPLETED`, with `CANCELLED` allowed only before production starts. Invalid jumps are blocked in the UI and rejected by the API with HTTP 400.
- **Installer marketplace with double-booking prevention.** When an order is ready for install, a job opens. Any number of installers can press Claim at once; exactly one wins. The winner has 3 minutes to verify; otherwise the job is released automatically.
- **Direct-to-cloud uploads.** Print files (1 GB+) go from the browser straight to object storage through presigned multipart URLs. Progress shows live on every open dashboard.
- **Three personas, no login.** A header switcher lets you act as Ops, a Vendor, or an Installer. Open two tabs as two installers to race the claim yourself.

## Quick start

```bash
cp .env.example .env         # fill in R2 credentials (see Configuration)
docker compose up            # Mongo replica set + app, seeded, on http://localhost:3000
```

For local development outside the container:

```bash
docker compose up mongo      # replica set only
pnpm install
pnpm prisma db push && pnpm prisma db seed
pnpm dev
```

Tests:

```bash
pnpm test                    # unit tests, no infrastructure
pnpm test:integration        # needs the compose Mongo; includes the 50-way claim race
```

## Stack

| | |
|---|---|
| Framework | Next.js 15 (App Router), TypeScript |
| UI | Tailwind CSS, Shadcn UI, TanStack Query |
| Data | MongoDB (Atlas in production) via Prisma 6 |
| Storage | Cloudflare R2 (S3-compatible) with presigned multipart uploads |
| Realtime | Server-Sent Events fed by MongoDB Change Streams |
| Hosting | Vercel + MongoDB Atlas + Cloudflare R2 |
| Tests | Vitest (unit + integration against a real replica set) |

## Architecture

```
 Browser (dashboard, N tabs, each with a persona)
   │  JSON API (x-persona header)              │ PUT file parts (presigned URLs)
   │  EventSource  GET /api/events             ▼
   ▼                                      Cloudflare R2
 Vercel Functions (Node runtime)
   ├─ Route Handlers ── Prisma ──►  MongoDB Atlas (replica set)
   └─ /api/events    ── change stream ◄── oplog
```

No Redis, no worker, no cron. Everything that needs coordination is a single atomic write to MongoDB; everything that needs to be live is a change stream forwarded as SSE.

### Database schema

Four collections. Full Prisma schema in `prisma/schema.prisma`; summary:

**Order** — `orderNumber`, `title`, `customerName`, `signType`, `widthCm`, `heightCm`, `quantity`, `installAddress`, `dueDate`, `notes`, `vendorId`, `status`, `version`, embedded `history[]` of `{from, to, actorType, actorId, reason, at}`. Indexes on `status` and `(vendorId, status)`.

**InstallJob** — one per order, created when the order becomes `READY_FOR_INSTALL`. `orderId` (unique), `status: OPEN | CLAIMED | ASSIGNED`, embedded `claim {installerId, claimedAt, expiresAt}` while claimed, `installerId` once assigned, `version`.

**Asset** — `orderId`, `fileName`, `contentType`, `sizeBytes`, `storageKey`, `uploadId` (R2 multipart), `status: PENDING | UPLOADING | UPLOADED | FAILED | ABORTED`, `bytesUploaded`, `progressPct`, `simulated`.

**Vendor**, **Installer** — `name`. Seeded.

Why `InstallJob` is separate from `Order`: the claim race is a conditional write on one tiny document. Isolating it means claims never contend with order edits and the concurrency test is self-contained.

### State machine

Defined once in `lib/domain/state-machine.ts` and imported by both the React components and the API handlers.

| From | Allowed to | Who |
|---|---|---|
| DRAFT | SUBMITTED, CANCELLED | Ops |
| SUBMITTED | VENDOR_ACCEPTED, CANCELLED | Vendor (owner) accepts; Ops or Vendor cancels |
| VENDOR_ACCEPTED | IN_PRODUCTION, CANCELLED | Vendor |
| IN_PRODUCTION | READY_FOR_INSTALL | Vendor |
| READY_FOR_INSTALL | COMPLETED | Assigned installer |

Guards: `SUBMITTED` needs at least one uploaded asset; `COMPLETED` needs an assigned installer. Each transition is a single conditional update on `{id, status: from, version}`; if it matches zero documents the API returns 409 and the client refreshes. An illegal jump returns:

```json
{ "error": { "code": "INVALID_TRANSITION",
             "message": "Cannot move DRAFT to IN_PRODUCTION",
             "details": { "from": "DRAFT", "to": "IN_PRODUCTION", "allowed": ["SUBMITTED", "CANCELLED"] } } }
```

### Concurrency lock strategy

**Goal:** many installers claim the same job simultaneously; exactly one is assigned.

**Mechanism:** optimistic locking with a MongoDB atomic conditional update. The claim endpoint issues one write:

```
filter: { _id: jobId,
          $or: [ { status: "OPEN" },
                 { status: "CLAIMED", "claim.expiresAt": { $lt: now } } ] }
update: { status: "CLAIMED",
          claim: { installerId, claimedAt: now, expiresAt: now + 3 min },
          $inc: { version: 1 } }
```

MongoDB serialises writes to a single document, so every concurrent request evaluates the filter against the current state. The first one to apply flips `status` to `CLAIMED` with a future `expiresAt`; every subsequent evaluation fails the filter and modifies nothing. The endpoint asserts exactly one modified document and returns `409 CLAIM_TAKEN` otherwise. No read-then-write window, no transaction, no external lock service.

**Proof:** `tests/integration/claim-race.test.ts` fires 50 parallel claims with 50 different installers and asserts one success, 49 conflicts, and one `CLAIMED` document.

**Fallback (3-minute release):** the claim carries `expiresAt`. Three things make expiry work on a serverless host with no timers:

1. Every read maps an expired `CLAIMED` to `OPEN` before it leaves the server.
2. The claim filter above already treats an expired claim as free, so a new installer can take it the instant it expires.
3. A sweep (`releaseExpired`) runs whenever a dashboard loads or connects to the event stream. It flips expired claims in the database, which emits a change event, so every other dashboard sees the release live. The UI shows a countdown and flips the card at zero.

Verification is simulated by a modal with Verify and Simulate failure buttons; closing it and waiting shows the auto-release.

### Direct-to-cloud upload pipeline

Vercel functions cap request bodies at 4.5 MB, so file bytes never touch the app.

1. `POST /api/assets` creates an `Asset` and starts an R2 multipart upload.
2. The browser asks `POST /api/assets/:id/parts` for presigned `UploadPart` URLs in batches of 20 (10 MiB parts, 1-hour expiry).
3. The browser PUTs parts straight to R2, four in flight, tracking `XMLHttpRequest` progress and collecting each part's `ETag`.
4. At most every 2 s or every 5 %, the browser posts `bytesUploaded` to `POST /api/assets/:id/progress`. That write flows through the change stream to every open dashboard, so progress is visible everywhere without polling.
5. `POST /api/assets/:id/complete` finalises the multipart upload on R2 and marks the asset `UPLOADED`. Abort and failure paths clean up on R2 and mark the asset accordingly.

**Simulated large files:** a "Simulate large file" button (100 MB / 1 GB / 2 GB) generates zero-filled parts in the browser and pushes them through the identical pipeline. Real objects land in R2; a lifecycle rule deletes them after one day.

R2 bucket CORS rule required:

```json
[{ "AllowedOrigins": ["http://localhost:3000", "https://<your-vercel-domain>"],
   "AllowedMethods": ["PUT"],
   "AllowedHeaders": ["*"],
   "ExposeHeaders": ["ETag"],
   "MaxAgeSeconds": 3600 }]
```

### Realtime

`GET /api/events` is a Node streaming route. It opens one MongoDB change stream over `Order`, `InstallJob`, and `Asset` and forwards each change as an SSE event (`order.updated`, `job.updated`, `asset.updated`, …). The change-stream resume token is used as the SSE event id, so when Vercel's function limit approaches (the server closes cleanly at 280 s) the browser's automatic reconnect resumes with `Last-Event-ID` and misses nothing. A heartbeat every 15 s keeps proxies happy.

Clients apply events directly to their query cache, so cards move without refetching. If the stream fails three times in a row the client falls back to a 10-second refetch and the header indicator turns amber; this is the only polling in the system and it is off in normal operation.

## Configuration

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Mongo connection string. Local: `mongodb://mongo:27017/signcraft?replicaSet=rs0`. Prod: Atlas SRV string. |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` | Cloudflare R2 credentials and bucket |
| `NEXT_PUBLIC_APP_URL` | Public origin, used for CORS documentation and links |
| `CLAIM_TTL_MS` | Optional; claim window, default `180000` |

## Trade-offs

- **Serverless expiry is lazy, not scheduled.** A stale `CLAIMED` can sit in the database while nobody is connected. It is invisible because every reader and writer applies the same expiry predicate. A cron sweeper (Vercel Pro) or a delayed callback (Upstash QStash) would make it eager; neither changes correctness.
- **One change stream per connected dashboard.** Simple and correct at demo scale. On a long-lived host the natural next step is one shared stream per instance with in-memory fan-out; on Vercel that would mean a hosted pub/sub such as Ably or Pusher.
- **Upload progress travels through the database.** About 20–30 small writes per upload so other viewers see the bar move. Redis pub/sub would avoid the writes at the cost of a second datastore.
- **Personas instead of authentication.** Identity is trusted from a header so the reviewer can race two installers in two tabs. Authorisation rules are still enforced server-side per persona; swapping the header for a session lookup is the only change needed for real auth.
- **Prisma 6 plus the native driver for change streams.** Prisma does not expose `watch()`; the native client shares the connection string and lives in one file.
- **Atlas M0 allow-list is `0.0.0.0/0`.** Vercel egress IPs are not fixed; acceptable for a demo, not for production.

## Manual QA checklist

1. Ops: create order, simulate a 1 GB upload, watch the bar from a Vendor tab.
2. Ops: Submit is disabled until an asset is uploaded; the API returns 400 for a forced `DRAFT → IN_PRODUCTION`.
3. Vendor: Accept → Start production → Mark ready. Cancel disappears after production starts.
4. Two Installer tabs: Claim simultaneously; one wins, the other sees 409 and a countdown.
5. Winner closes the verification modal; both tabs see the job reopen at 0:00.
6. Winner verifies, then completes; card lands in Completed with full history.
7. Resize to mobile: status tabs replace the board; all flows still work.

## Repository layout

```
app/            pages and API route handlers
components/     feature components; ui/ is Shadcn
lib/domain      pure state machine, permissions, expiry rules (shared client/server)
lib/services    all database logic
lib/db          Prisma singleton, native Mongo client (change streams only)
lib/storage     R2 client and presigning
lib/realtime    SSE server mapping and client hook
lib/upload      browser multipart uploader
prisma/         schema and seed
tests/          unit and integration
docs/superpowers/specs   architecture, decisions (ADRs), UI pages and flows
```
