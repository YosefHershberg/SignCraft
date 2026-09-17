# SignCraft — Architecture Design Spec

**Date:** 2026-09-16
**Status:** Implemented. The design below is as approved; paragraphs marked **Amended 2026-09-16** record where the implementation differs and are authoritative over the text around them.
**Companion docs:** [Decisions (ADRs)](2026-09-16-signcraft-decisions.md) · [UI Pages & Flows](2026-09-16-signcraft-ui-pages-and-flows.md) · [README](../../../README.md) · [EXPLANATIONS](../../../EXPLANATIONS.md)

> **Amended 2026-09-16 (repo-wide):** Docker was removed from the project. MongoDB Atlas is the database in **every** environment; there is no local Mongo container, no `Dockerfile` and no `docker-compose.yml`. Local development is `.env` + `pnpm dev`; integration tests use a dedicated database name on the same Atlas cluster. `directConnection` is not used anywhere, and Next's `output: 'standalone'` is not used. Every "Docker" or "compose" reference below should be read as "Atlas". Rationale and what is lost: EXPLANATIONS.md §10.

---

## 1. Purpose

SignCraft is a B2B marketplace management micro-application for custom physical signage. It is a technical assessment: a single-page dashboard plus API that demonstrates three things a reviewer will look for explicitly:

1. A strictly enforced order **state machine** (client and server).
2. **Double-booking prevention** on installer job assignment under concurrent claims, with an automatic 3-minute release when verification does not complete.
3. A **direct-to-cloud upload pipeline** for very large files using pre-signed URLs, with live progress on the dashboard and no database polling.

Everything else (persona model, seed data, layout) exists to make those three things easy to see and easy to test.

## 2. Goals and non-goals

**Goals**
- Every rule from the task specification is enforced server-side and mirrored in the UI.
- A reviewer can run the whole thing with `docker compose up` and also open a live Vercel URL.
  - **Amended 2026-09-16:** the containerised path was dropped. A reviewer either opens the live Vercel URL (nothing to install) or runs `cp .env.example .env` + `pnpm install && pnpm prisma db push && pnpm db:seed && pnpm dev` against Atlas.
- The concurrency guarantee is proven by an automated test, not just described.
- The README explains schema, lock strategy, and upload pipeline with honest trade-offs.

**Non-goals**
- Real authentication or multi-tenant security. A persona switcher stands in for login (ADR-008).
- Payments, invoicing, notifications, real identity verification.
- Horizontal-scale realtime fan-out (one change stream per connected dashboard is acceptable at demo scale; see §10.4).

## 3. Stack

| Layer | Choice | Notes |
|---|---|---|
| Framework | Next.js 15, App Router, TypeScript strict | Route Handlers for API, Server Components for initial data |
| UI | Tailwind CSS + Shadcn UI | Radix primitives, `sonner` for toasts |
| Client state | TanStack Query + a small SSE hook | Query cache is the single client store; SSE events patch it |
| ORM | Prisma 6.x, `provider = "mongodb"` | All CRUD and the conditional updates |
| Driver | `mongodb` native driver | Only for change streams (`db.watch`), which Prisma does not expose |
| Database | MongoDB (Atlas in prod, single-node replica set in Docker) | Replica set is mandatory: Prisma on Mongo and change streams both require it |
| Object storage | Cloudflare R2 via `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` | S3-compatible; multipart upload with presigned part URLs |
| Validation | Zod | Shared schemas for API bodies and forms |
| Tests | Vitest | Integration tests hit the Docker replica set, not an in-memory Mongo |
| Hosting | Vercel (app) + MongoDB Atlas + Cloudflare R2 | |
| Containers | `Dockerfile` (multi-stage, standalone output) + `docker-compose.yml` | |

**Amended 2026-09-16:** the Database row reads "MongoDB Atlas (every environment)" — M0 is a replica set, which satisfies the Prisma-on-Mongo and change-stream requirement without a local container. The Tests row reads "integration tests hit a dedicated database on the same Atlas cluster". The Containers row is void: there are no container files, and `output: 'standalone'` is not set in `next.config.ts` (which only sets `serverExternalPackages`).

Exact package versions are pinned at implementation time; the constraint that matters is **Prisma 6.x** (ADR-014).

## 4. Runtime topology

```
 Browser (dashboard, N tabs, each with a persona)
   │  HTTPS JSON (x-persona header)           │ PUT parts (presigned)
   │  EventSource  GET /api/events            ▼
   ▼                                     Cloudflare R2 bucket
 Vercel Functions (Node runtime)
   ├─ Route Handlers  ── Prisma ──►  MongoDB Atlas (replica set)
   └─ /api/events     ── native driver change stream ◄── oplog
```

Local development replaces Atlas with the Docker Mongo replica set and keeps R2 (a dev bucket). There is no Redis, no worker process, no cron.

**Amended 2026-09-16:** local development uses the *same* Atlas cluster as production (same `DATABASE_URL`), so the topology above is the topology everywhere; only the app process moves (Vercel function vs. `next dev`). Still no Redis, worker, or cron.

## 5. Domain model

Four collections. Prisma schema sketch (field types are indicative; exact decorators at implementation):

```prisma
enum OrderStatus { DRAFT SUBMITTED VENDOR_ACCEPTED IN_PRODUCTION READY_FOR_INSTALL COMPLETED CANCELLED }
enum JobStatus   { OPEN CLAIMED ASSIGNED }
enum AssetStatus { PENDING UPLOADING UPLOADED FAILED ABORTED }
enum SignType    { STOREFRONT WAYFINDING VEHICLE_WRAP BANNER MONUMENT }
enum ActorType   { OPS VENDOR INSTALLER SYSTEM }

model Vendor    { id String @id @default(auto()) @map("_id") @db.ObjectId
                  name String
                  orders Order[] }

model Installer { id String @id @default(auto()) @map("_id") @db.ObjectId
                  name String }

type Transition { from OrderStatus?   // null for creation
                  to   OrderStatus
                  actorType ActorType
                  actorId   String?
                  reason    String?
                  at        DateTime }

model Order {
  id             String @id @default(auto()) @map("_id") @db.ObjectId
  orderNumber    String @unique          // "SC-0001", human-friendly
  title          String
  customerName   String
  signType       SignType
  widthCm        Int
  heightCm       Int
  quantity       Int
  installAddress String
  dueDate        DateTime
  notes          String?
  vendorId       String @db.ObjectId
  vendor         Vendor @relation(fields: [vendorId], references: [id])
  status         OrderStatus @default(DRAFT)
  version        Int @default(0)         // optimistic concurrency
  history        Transition[]
  assets         Asset[]
  installJob     InstallJob?
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
  @@index([status])
  @@index([vendorId, status])
}

type Claim { installerId String @db.ObjectId
             claimedAt   DateTime
             expiresAt   DateTime }

model InstallJob {
  id          String @id @default(auto()) @map("_id") @db.ObjectId
  orderId     String @unique @db.ObjectId
  order       Order @relation(fields: [orderId], references: [id])
  status      JobStatus @default(OPEN)
  claim       Claim?                     // present only while CLAIMED
  installerId String? @db.ObjectId       // set only when ASSIGNED
  version     Int @default(0)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  @@index([status])
}

model Asset {
  id            String @id @default(auto()) @map("_id") @db.ObjectId
  orderId       String @db.ObjectId
  order         Order @relation(fields: [orderId], references: [id])
  fileName      String
  contentType   String
  sizeBytes     BigInt                  // 1 GB+ files; BigInt so >2^31 never overflows
  storageKey    String                  // orders/{orderId}/{assetId}/{fileName}
  uploadId      String?                 // R2 multipart upload id, null after complete/abort
  status        AssetStatus @default(PENDING)
  bytesUploaded BigInt @default(0)
  progressPct   Int @default(0)
  simulated     Boolean @default(false)
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  @@index([orderId])
}
```

BigInt fields are serialised as numbers at the API boundary (values stay far below 2^53).

**Why `InstallJob` is its own collection (ADR-015):** the claim race is a write on exactly one small document with a tight filter. Keeping it out of `Order` means the claim update never contends with order edits, the filter is trivially indexable, and the concurrency test is isolated.

**Why `history` is embedded:** it is append-only, read only with its parent, and bounded (at most 7 entries in normal flow).

## 6. State machine

Single pure module `lib/domain/state-machine.ts`, imported by both API handlers and React components. No I/O.

```
DRAFT ─► SUBMITTED ─► VENDOR_ACCEPTED ─► IN_PRODUCTION ─► READY_FOR_INSTALL ─► COMPLETED
  │           │              │
  └───────────┴──────────────┴──► CANCELLED
```

```ts
export const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  DRAFT:             ['SUBMITTED', 'CANCELLED'],
  SUBMITTED:         ['VENDOR_ACCEPTED', 'CANCELLED'],
  VENDOR_ACCEPTED:   ['IN_PRODUCTION', 'CANCELLED'],
  IN_PRODUCTION:     ['READY_FOR_INSTALL'],
  READY_FOR_INSTALL: ['COMPLETED'],
  COMPLETED:         [],
  CANCELLED:         [],
};
```

**Who may perform which transition** (`lib/domain/permissions.ts`):

| Transition | Allowed persona |
|---|---|
| DRAFT → SUBMITTED | OPS |
| SUBMITTED → VENDOR_ACCEPTED | VENDOR (must be `order.vendorId`) |
| VENDOR_ACCEPTED → IN_PRODUCTION | VENDOR (owner) |
| IN_PRODUCTION → READY_FOR_INSTALL | VENDOR (owner) |
| READY_FOR_INSTALL → COMPLETED | INSTALLER (must be `installJob.installerId`, i.e. ASSIGNED) |
| DRAFT / SUBMITTED / VENDOR_ACCEPTED → CANCELLED | OPS, or VENDOR (owner) |

**Guards** (evaluated after the transition table, before the write):

| Transition | Guard | Error code |
|---|---|---|
| → SUBMITTED | at least one `Asset` with status `UPLOADED` | `GUARD_FAILED` / `NO_UPLOADED_ASSET` |
| → COMPLETED | `installJob.status === 'ASSIGNED'` | `GUARD_FAILED` / `NO_ASSIGNED_INSTALLER` |
| → CANCELLED from IN_PRODUCTION or later | not in the table | `INVALID_TRANSITION` |

**Side effects** (same request, after the successful write):
- → READY_FOR_INSTALL creates the `InstallJob` with status OPEN. Idempotent via `upsert` on `orderId`.
- → CANCELLED never has a job to clean up (cancel is only reachable before READY_FOR_INSTALL), so no job side effect exists.

**Write protocol.** Every transition is one conditional update:

```ts
const res = await prisma.order.updateMany({
  where: { id, status: from, version: expectedVersion },
  data:  { status: to, version: { increment: 1 }, history: { push: transition } },
});
if (res.count !== 1) throw new ApiError(409, 'VERSION_CONFLICT');
```

`expectedVersion` comes from the client (it holds the current card). If omitted, the server reads the order first and uses the fresh version; the `status: from` predicate still prevents illegal jumps under races.

## 7. Personas and authorisation

No login. The header dropdown selects one of:

- `ops` — operations / customer side
- `vendor:<vendorId>`
- `installer:<installerId>`

The choice is stored in the `sc_persona` cookie and sent as the `x-persona` header on every mutating request (the fetch wrapper adds it). `lib/domain/personas.ts` parses and validates it; unknown ids → 403.

Server rule: **the UI is advisory, the server is authoritative.** Every mutating handler calls `assertPersonaMay(persona, action, resource)` before touching the DB.

## 8. API surface

All routes under `app/api/`. JSON in and out. Errors follow §12.

| Method and path | Persona | Purpose | Success | Errors |
|---|---|---|---|---|
| `GET /api/bootstrap` | any | vendors, installers, all orders with `installJob` and `assets` | 200 | |
| `POST /api/orders` | OPS | create DRAFT order | 201 | 400 validation |
| `POST /api/orders/:id/transition` body `{to, expectedVersion?, reason?}` | per §6 | state transition | 200 order | 400 `INVALID_TRANSITION` or `GUARD_FAILED`, 403, 409 |
| `POST /api/jobs/:id/claim` | INSTALLER | atomic claim | 200 job | 409 `CLAIM_TAKEN`, 403 |
| `POST /api/jobs/:id/verify` body `{outcome: 'pass' or 'fail'}` | INSTALLER (the claimant) | resolve verification | 200 job | 409 `CLAIM_EXPIRED` or `NOT_CLAIMANT` |
| `POST /api/assets` body `{orderId, fileName, contentType, sizeBytes, simulated}` | OPS | create Asset and start R2 multipart | 201 `{assetId, uploadId, partSize, partCount}` | 400 `GUARD_FAILED` / `ORDER_NOT_UPLOADABLE` |
| `POST /api/assets/:id/parts` body `{partNumbers: number[]}` | OPS | presign a batch of part URLs (max 20) | 200 `{urls: {partNumber, url}[]}` | 409 if not PENDING/UPLOADING |
| `POST /api/assets/:id/progress` body `{bytesUploaded}` | OPS | throttled progress write | 204 | |
| `POST /api/assets/:id/complete` body `{parts: {partNumber, etag}[]}` | OPS | complete multipart, mark UPLOADED | 200 asset | 502 `STORAGE_ERROR` → asset FAILED |
| `POST /api/assets/:id/abort` | OPS | abort multipart, mark ABORTED | 204 | |
| `GET /api/events` | any | SSE stream (§10) | 200 `text/event-stream` | |

**Amended 2026-09-16 (as implemented):**

- `POST /api/assets` returns **201** with `{ asset: AssetDTO, uploadId, partSize, partCount }` — the whole asset DTO, not a bare `{assetId}`, so the client can render the row without a second fetch.
- `POST /api/orders` returns **201**.
- `POST /api/assets/:id/progress` and `POST /api/assets/:id/abort` return **204**.
- `POST /api/assets/:id/abort` accepts an **optional** body `{ reason?: 'user' | 'error' }`. `'error'` — what the uploader sends once it has exhausted its part retries — records the asset **FAILED** so the row offers Retry (UI spec §7.6); the default `'user'` records **ABORTED**. An empty body is valid and means `'user'`, so a bare `POST` (curl, `navigator.sendBeacon`) still works.
- `POST /api/jobs/:id/claim` also returns **404 `NOT_FOUND`** when the job id does not exist (distinguished from 409 `CLAIM_TAKEN` by a follow-up read).

**Amended 2026-09-17 (OpenAPI):** the surface above is now also described by `public/openapi.yaml`, rendered interactively at `/api-docs` (Swagger UI). That spec, not this table, is the normative and test-enforced description of the surface — `tests/unit/api/openapi.test.ts` fails the build if a route file and the spec drift on path, method or error codes. Contract detail the table above and §12 do not carry:

- `409 VERSION_CONFLICT` is not only the order-transition conflict: `POST /api/assets/:id/parts` and `POST /api/assets/:id/complete` also return it, with `details.status`, when the asset is no longer `PENDING`/`UPLOADING`.
- `502 STORAGE_ERROR` carries `details.op`, the name of the failed S3 operation.
- `parts` and `complete` re-check the order on every call (`assertOrderStillUploadable`), not just at create, and can return 403 or 400 `GUARD_FAILED`/`ORDER_NOT_UPLOADABLE` if the vendor accepted the order while parts were still in flight.
- `POST /api/assets/:id/progress` is a silent `204` for a well-formed but unknown asset id (only a malformed id is 404), whereas `POST /api/assets/:id/abort` on an unknown id is `404`.
- `POST /api/assets` is `404` for an unknown `orderId`.
- `GET /api/bootstrap` and `GET /api/events` read no persona at all, and bootstrap returns every order to every persona — read filtering is client-side by design (§7).
- Any unhandled throw anywhere in the API surface is `500 INTERNAL`.

Route Handler conventions: `export const runtime = 'nodejs'` everywhere (Prisma needs Node), `dynamic = 'force-dynamic'` on reads. One handler file per route, thin: parse → persona → call a function in `lib/services/*` → respond. Business logic lives in `lib/services`, never in route files, so integration tests call services directly.

## 9. Concurrency: claim locking and expiry

### 9.1 The claim (double-booking prevention)

`services/jobs.claim(jobId, installerId)`:

```ts
const now = new Date();
const expiresAt = new Date(now.getTime() + CLAIM_TTL_MS); // 3 minutes
const res = await prisma.installJob.updateMany({
  where: {
    id: jobId,
    OR: [
      { status: 'OPEN' },
      { status: 'CLAIMED', claim: { is: { expiresAt: { lt: now } } } },   // stale claim is free
    ],
  },
  data: {
    status: 'CLAIMED',
    claim: { installerId, claimedAt: now, expiresAt },
    version: { increment: 1 },
  },
});
if (res.count !== 1) throw new ApiError(409, 'CLAIM_TAKEN');
```

Correctness argument: MongoDB applies an update to a single document atomically and serialises concurrent writers on that document. N concurrent requests each evaluate the filter against the *current* document; the first to apply sets `status` to `CLAIMED` with a future `expiresAt`, so every later evaluation fails the filter and matches zero documents. Exactly one request sees `count === 1`. No transaction, no external lock, no retry loop.

If Prisma's composite-type filter (`claim: { is: {...} }`) proves awkward on the Mongo connector, the fallback is `prisma.$runCommandRaw({ findAndModify: ... })` with the same filter. The README documents whichever is used. Either way the guarantee comes from Mongo's single-document atomicity, not from Prisma.

**Amended 2026-09-16:** the composite-type filter works as written — the `$runCommandRaw` fallback was **not** needed. The implemented `claimJob` (`lib/services/jobs.ts`) matches the sketch above and additionally sets `installerId: null` in the update (so a job re-claimed after a failed verification does not keep a stale assignee), and on `count !== 1` reads the job once to return 404 `NOT_FOUND` rather than 409 `CLAIM_TAKEN` when the id does not exist.

### 9.2 Verification

`services/jobs.verify(jobId, installerId, outcome)`:

- Filter: `{ id, status: 'CLAIMED', claim.installerId: installerId, claim.expiresAt: { gt: now } }`.
- `pass` → `status: 'ASSIGNED', installerId, claim: null`.
- `fail` → `status: 'OPEN', claim: null`.
- `count !== 1` → read the job to distinguish `CLAIM_EXPIRED` (claim gone or expired) from `NOT_CLAIMANT`, return 409 with that code.

### 9.3 The 3-minute release (lazy expiry plus sweep)

There is no process to wake up at T+3 min on Vercel. Three mechanisms together make expiry correct and observable:

1. **Lazy read.** `toPublicJob(job)` maps `CLAIMED` with `claim.expiresAt < now` to `{status: 'OPEN', claim: null}` before it leaves the server. The claim filter in §9.1 already treats it as free. Correctness never depends on the sweep.
2. **Sweep.** `services/jobs.releaseExpired()` runs `updateMany({ status: 'CLAIMED', claim: { is: { expiresAt: { lt: now } } } }, { status: 'OPEN', claim: null, version: +1 })`. It is called at the start of `GET /api/bootstrap` and whenever an SSE client connects. The write produces a change event, so every connected dashboard sees the card flip back to Open without any client reloading.
3. **Client countdown.** The card and the verification modal show `expiresAt − now` ticking down. At zero the client renders the job as OPEN (matching what the server would say) and invalidates the query; the next sweep reconciles the DB.

Consequence: the DB may hold a stale `CLAIMED` for a while when nobody is looking, which is harmless because every reader and writer applies the same predicate. This is documented as a trade-off in the README with the cron and QStash alternatives (ADR-006).

### 9.4 Constants

| Name | Value |
|---|---|
| `CLAIM_TTL_MS` | 180 000 |
| Countdown tick | 1 s |

### 9.5 Test (integration)

Job OPEN → `Promise.allSettled` of 50 `claim()` calls with 50 distinct installer ids → assert exactly one fulfilled, 49 rejected with `CLAIM_TAKEN`, DB shows one `CLAIMED` with that installer. Second test: set `claim.expiresAt` in the past → a new claim succeeds. Third: `verify('fail')` reopens; `verify('pass')` assigns and a later claim gets 409.

## 10. Realtime: SSE over MongoDB change streams

### 10.1 Server (`app/api/events/route.ts`)

- `runtime = 'nodejs'`, `dynamic = 'force-dynamic'`, `maxDuration = 300` (Vercel Fluid compute limit on Hobby; 800 on Pro).
- On request: call `releaseExpired()` (§9.3), then open **one** change stream:
  ```ts
  db.watch(
    [{ $match: { 'ns.coll': { $in: ['Order', 'InstallJob', 'Asset'] },
                 operationType: { $in: ['insert', 'update', 'replace', 'delete'] } } }],
    { fullDocument: 'updateLookup', ...(lastEventId ? { resumeAfter: decode(lastEventId) } : {}) }
  )
  ```
- Each change is mapped to an SSE frame:
  ```
  id: <base64 resume token>
  event: order.created | order.updated | job.created | job.updated | asset.created | asset.updated
  data: {"id": "...", "doc": <public DTO>}
  ```
  DTO mapping applies the lazy-expiry view (§9.3) so clients never see a stale CLAIMED.
- A `: heartbeat` comment every 15 s keeps proxies from closing the socket.
- At 280 s the server sends `event: reconnect` and closes cleanly so the client resumes with `Last-Event-ID` before Vercel ends the function.
- `request.signal` abort → close the change stream and the Mongo cursor.

**Amended 2026-09-16 (as implemented in `app/api/events/route.ts` + `lib/realtime/sse.ts`):**

- The `$match` covers `insert | update | replace` only. `delete` was dropped: nothing in the app deletes a document, and a delete change carries no `fullDocument` to map into a DTO.
- The comment lines are `: connected` (once, on open) and `: hb` (every 15 s), not `: heartbeat`.
- Resume works from `Last-Event-ID` **or** the `?after=<token>` query parameter, because the client reopens the stream explicitly after a `reconnect` frame rather than relying on the browser's automatic retry.
- Added `event: resync`: when the cursor throws a resumable error (Mongo code 286 `ChangeStreamHistoryLost` or 280 invalid resume token) the server closes the stale cursor, restarts from now, and tells the client to refetch the bootstrap. `MAX_RESYNCS = 3`, after which the stream errors rather than looping.

### 10.2 Client (`lib/realtime/useRealtime.ts`)

- One `EventSource('/api/events')` per tab (the browser sends `Last-Event-ID` automatically on reconnect).
- Handlers patch the TanStack Query cache in place (`setQueryData`) so cards move without a refetch.
- Connection state machine: `connecting | live | reconnecting | degraded`. After 3 consecutive failures → `degraded`: enable `refetchInterval: 10_000` on the bootstrap query and show an amber indicator. Returning to `live` disables polling.
- Same-tab optimism: a mutating request applies the returned document immediately; the later SSE event is idempotent (same `version`).

### 10.3 Why this satisfies "no repeated polling"

Change streams tail the replica-set oplog; the server never issues periodic `find`s. The only periodic client polling is the explicit degraded-mode fallback, which is off in normal operation.

### 10.4 Known limits (documented in README)

- One change stream cursor per open dashboard. Atlas M0 caps connections at 500, so this is fine for a demo. The obvious scale-up is a single shared stream per server instance with in-memory fan-out, which is trivial on a long-lived host but not on Vercel.
- Upload progress writes (§11) go through the DB to reach other tabs. A Redis pub/sub would avoid those writes; not worth a second datastore here.

## 11. Upload pipeline (direct-to-cloud, multipart, presigned)

### 11.1 Sequence

```
Browser (OPS)                       API (Vercel)                              R2
  │ POST /api/assets ────────────────►│ create Asset(PENDING)                   │
  │                                   │ CreateMultipartUpload ─────────────────►│
  │◄── {assetId, uploadId, partSize}  │◄── uploadId                             │
  │ POST /assets/:id/parts [1..20] ──►│ presign UploadPart x20 (local signing)  │
  │◄── urls                           │                                         │
  │ PUT part (XHR, progress events) ─────────────────────────────────────────►│
  │   ... 4 in flight, ETag collected per part                                  │
  │ POST /assets/:id/progress ───────►│ update Asset ──► change stream ──► every dashboard
  │   (at most every 2 s or +5 %)     │                                         │
  │ POST /assets/:id/complete {parts}►│ CompleteMultipartUpload ───────────────►│
  │◄── Asset UPLOADED                 │                                         │
```

### 11.2 Parameters

| Name | Value | Why |
|---|---|---|
| `PART_SIZE` | 10 MiB | R2/S3 minimum is 5 MiB; 10 MiB keeps 1 GB at about 100 parts |
| Parallel parts | 4 | Saturates a typical uplink without hammering the browser |
| Presign batch | 20 URLs per call | Fewer round-trips; URLs expire in 1 h |
| Progress report throttle | every 2 s **or** every +5 % | Bounds DB writes to roughly 20–30 per upload |
| Max retries per part | 3 with backoff | Then the asset is marked FAILED and the upload aborted |

### 11.3 Simulated 1 GB file

"Simulate large file" (size selectable: 100 MB / 1 GB / 2 GB) creates the same Asset with `simulated: true` and `fileName: simulated-<size>.bin`. The client uploader's part source is a generator that yields `new Blob([sharedZeroBuffer])` per part, so browser memory stays at one part. Real bytes really land in R2 and the object is real; a reviewer can watch progress from another tab or persona. The assets list shows a "simulated" badge. An R2 lifecycle rule deletes `simulated-*` objects after 1 day to control storage cost.

> **Amended 2026-09-16:** two claims above are superseded — objects are keyed `orders/<orderId>/<assetId>/<file>`, so a `simulated-*` lifecycle rule cannot match (see §16); and up to four part Blobs are in flight at once, so peak browser memory is about 40 MiB, not one part.

### 11.4 Rules

- Uploads are allowed only while the order is `DRAFT` or `SUBMITTED` (400 otherwise).
- Only `OPS` uploads.
- `SUBMITTED` requires at least one `UPLOADED` asset (§6 guard).
- Leaving the page mid-upload leaves the asset `UPLOADING`; the detail drawer offers Abort (calls R2 abort). There is no cross-session resume in this scope.
- The R2 bucket CORS rule must allow `PUT` from the app origin and expose `ETag`. The README carries the exact JSON.

### 11.5 Storage layout

`orders/<orderId>/<assetId>/<sanitisedFileName>`. The client's file name is sanitised before it becomes part of the key.

## 12. Error contract

```json
{ "error": { "code": "INVALID_TRANSITION", "message": "Cannot move DRAFT to IN_PRODUCTION",
             "details": { "from": "DRAFT", "to": "IN_PRODUCTION", "allowed": ["SUBMITTED", "CANCELLED"] } } }
```

| HTTP | code | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Zod failure; `details` = flattened issues |
| 400 | `INVALID_TRANSITION` | `to` not in `TRANSITIONS[from]` |
| 400 | `GUARD_FAILED` | `details.reason` is one of `NO_UPLOADED_ASSET`, `NO_ASSIGNED_INSTALLER`, `ORDER_NOT_UPLOADABLE` |
| 403 | `FORBIDDEN_FOR_PERSONA` | persona may not perform the action |
| 404 | `NOT_FOUND` | |
| 409 | `VERSION_CONFLICT` | order changed underneath the client |
| 409 | `CLAIM_TAKEN`, `CLAIM_EXPIRED`, `NOT_CLAIMANT` | job race outcomes |
| 502 | `STORAGE_ERROR` | R2 call failed |

Client behaviour: toast with `message`; modals additionally render `details` inline (for example the allowed list). On 409 the client invalidates the affected query so the user sees the true state.

## 13. Frontend architecture

```
app/
  layout.tsx            providers (QueryClient, persona), header
  page.tsx              Server Component: fetch bootstrap, render <Dashboard initialData>
  api/...               route handlers (§8)
components/
  layout/   PersonaSwitcher, ConnectionIndicator, AppHeader
  board/    KanbanBoard, StatusColumn, OrderCard, MobileStatusTabs
  orders/   OrderDetailDrawer, CreateOrderDialog, TransitionDialog, CancelDialog, HistoryList
  jobs/     ClaimButton, VerificationDialog, ClaimCountdown
  uploads/  UploadPanel, AssetRow, UploadProgressBar, SimulateUploadDialog
  ui/       shadcn generated
lib/
  domain/   state-machine.ts, permissions.ts, personas.ts, claims.ts (expiry predicate), constants.ts
  services/ orders.ts, jobs.ts, assets.ts, bootstrap.ts   (all DB logic, testable without HTTP)
  db/       prisma.ts (singleton), mongo.ts (native client for watch)
  storage/  r2.ts (client, presign, multipart helpers)
  realtime/ events.ts (server mapping), useRealtime.ts (client)
  upload/   uploader.ts (browser multipart engine, part sources)
  api/      errors.ts (ApiError, toResponse), persona.ts (header parsing), validate.ts
  query/    keys.ts, hooks (useBootstrap, useTransition, useClaim, ...)
prisma/     schema.prisma, seed.ts
tests/      unit/, integration/
```

Principles: `lib/domain` has zero imports from Prisma or React. `lib/services` is the only place that talks to the DB. Route handlers stay under about 30 lines. Components never compute permissions themselves; they call `canPersonaDo(...)` from `lib/domain`.

**Amended 2026-09-16 (file names as built):** `lib/realtime/` is `sse.ts` (stream construction), `events.ts` (change → frame), `use-realtime.ts` (client hook) and `apply-event.ts` (cache patching) — kebab-case, not `useRealtime.ts`. `lib/upload/` is `uploader.ts`, `part-source.ts` and `plan.ts`. The permission helpers are `checkTransition` / `orderActionsFor` / `checkUpload` / `jobActionsFor` in `lib/domain/permissions.ts`, not a single `canPersonaDo`. Additional directories that earned their own place: `lib/board/visibility.ts` (which columns a persona sees), `lib/persona/` (cookie + React context), `lib/hooks/use-now.ts` (the shared 1 s clock), `lib/domain/schemas.ts` (Zod), `lib/domain/status-meta.ts`, `format.ts`, `history.ts`, `ring.ts`, `order-actions.ts`, `types.ts`.

## 14. Testing strategy

| Level | Tool | Covers |
|---|---|---|
| Unit | Vitest | `TRANSITIONS`, guards, `canPersonaDo`, expiry predicate, SSE event mapping, uploader part math |
| Integration | Vitest + Docker Mongo (`DATABASE_URL` from compose) | claim race (50 parallel → 1 winner), expiry reclaim, verify pass/fail, transition write protocol (400/409), submit guard, job creation on READY_FOR_INSTALL |
| Manual | checklist in README | two-tab race, countdown release, upload from tab A visible in tab B, mobile layout |

Integration tests reset the DB before each test and run serially. R2 is mocked at the `lib/storage/r2.ts` boundary in tests.

**Amended 2026-09-16 (as built):** integration tests run against a **dedicated database name on the Atlas cluster** (`signcraft_test`), derived from `.env` by rewriting the path segment of `DATABASE_URL`; the exact shell line is in the README and CLAUDE.md. `resetDb()` deletes every collection, which is why the override is mandatory. Serial execution is enforced by `fileParallelism: false` in `vitest.config.ts` with a 30 s per-test timeout, because each assertion is a real round trip to an M0 cluster. A third unit category was added: a handful of component tests (`tests/unit/jobs/job-chip.test.tsx`) using `@testing-library/react` under jsdom via a per-file `// @vitest-environment jsdom` pragma. Totals at the time of writing: **274 unit** tests in 25 files, **47 integration** tests in 8 files.

## 15. Local development and containers

> **Amended 2026-09-16:** this section is void. There are no container files in the repo. Local development is: `cp .env.example .env` (Atlas SRV string + R2 credentials), `pnpm install`, `pnpm prisma db push`, `pnpm db:seed` **once**, `pnpm dev`. Note that `pnpm install` depends on the `allowBuilds` map in `pnpm-workspace.yaml` — pnpm 11 ignores the older `onlyBuiltDependencies` list, and without it Prisma's build scripts are skipped. The seed paragraph below still holds; the compose description does not.

`docker-compose.yml` services:

- `mongo`: `mongo:7`, started with `--replSet rs0`, plus a one-shot `mongo-init` that runs `rs.initiate()`; healthcheck waits for PRIMARY.
- `app`: built from `Dockerfile` (Next standalone output), depends on `mongo` healthy, runs `prisma db push` and the seed on first start, listens on 3000.

`.env.example` lists every variable (§16). `pnpm dev` outside Docker works against the compose Mongo.

Seed (`prisma/seed.ts`, idempotent): 3 vendors, 4 installers, 8 orders spread across every status, including one `READY_FOR_INSTALL` with an OPEN job and one `DRAFT` with an UPLOADED asset.

**Amended 2026-09-16:** the seed is a **one-time manual step**, never part of app start. It is idempotent by `orderNumber` — it skips orders that already exist — which means it does **not** restore orders that have since been moved through the board. Re-running it is not a reset.

## 16. Deployment and configuration

| Variable | Used by | Notes |
|---|---|---|
| `DATABASE_URL` | Prisma and native driver | Atlas SRV string in prod; `mongodb://mongo:27017/signcraft?replicaSet=rs0` locally — **amended 2026-09-16:** the Atlas SRV string is used locally too; there is no local Mongo and no `directConnection` parameter anywhere |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` | `lib/storage/r2.ts` | endpoint `https://<account>.r2.cloudflarestorage.com` |
| `NEXT_PUBLIC_APP_URL` | CORS docs, absolute links | |
| `CLAIM_TTL_MS` | optional override | default 180000 |

Vercel: Node runtime for all API routes, Fluid compute on, `maxDuration` set on `/api/events`. Atlas: M0 free tier, IP allow-list `0.0.0.0/0` for Vercel egress (documented as demo-only). R2: bucket with the CORS rule and a 1-day lifecycle on `simulated-*` objects.

**Amended 2026-09-16 — the `simulated-*` lifecycle rule is not implementable.** Objects are keyed `orders/<orderId>/<assetId>/<sanitised file name>` (`storageKeyFor`, `lib/storage/r2.ts`), so `simulated-1gb.bin` is the last path segment and an R2/S3 lifecycle rule — which matches by key *prefix* — can never single it out. The only rule that would fire is one on the `orders/` prefix, and that expires real uploads too. Either accept that (a demo bucket holds nothing worth keeping) or delete simulated objects by hand; `scripts/list-r2.ts` lists what is there. A key layout that put `simulated/` first would have made the rule possible and was not chosen.

**Amended 2026-09-16:** build command is `pnpm build` (`prisma generate && next build`); `maxDuration = 300` is set on `/api/events`. R2 CORS `AllowedOrigins` must list both `http://localhost:3000` and the Vercel origin (`https://*.vercel.app` is acceptable), with `AllowedHeaders: ["*"]` and `ExposeHeaders: ["ETag"]` — omitting either breaks uploads in a different way (README, upload section). Windows note for local work: `pnpm build` can fail with `EPERM` on the Prisma query-engine DLL while `pnpm dev` holds it; stop the dev server first.

## 17. Out of scope (explicitly)

Auth, multi-tenancy, vendor pool bidding, installer scheduling, payments, email, resumable uploads across sessions, i18n, Redis, cron.
