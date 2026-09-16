# SignCraft Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the SignCraft dashboard end to end: order state machine, atomic installer claims with 3-minute lazy release, direct-to-R2 multipart uploads with live progress, SSE realtime, Docker Compose, and a Vercel deployment.

**Architecture:** Next.js 15 App Router serves a single dashboard page plus thin JSON route handlers. All business logic lives in `lib/services/*` on top of Prisma 6 (MongoDB); `lib/domain/*` is pure and shared by client and server. Realtime is one SSE route per tab backed by a MongoDB change stream; uploads go browser → Cloudflare R2 through presigned multipart URLs and only progress metadata touches the app.

**Tech Stack:** Next.js 15.5 · React 19 · TypeScript 5.9 strict · Tailwind CSS 4 · Shadcn UI · Prisma 6.19 (`provider = "mongodb"`) · `mongodb` 6 driver (change streams only) · `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` · TanStack Query 5 · Zod 4 · Vitest 3 · pnpm 11 · Docker Compose · Vercel + MongoDB Atlas + Cloudflare R2.

**Spec:** `docs/superpowers/specs/2026-09-16-signcraft-architecture-design.md` (behaviour, data, API), `docs/superpowers/specs/2026-09-16-signcraft-ui-pages-and-flows.md` (screens and flows), `docs/superpowers/specs/2026-09-16-signcraft-decisions.md` (ADRs), `docs/design/DESIGN.md` + `docs/design/screens/*.html` (visuals). `CLAUDE.md` lists the seven invariants; they apply to every task.

## Global Constraints

- Next.js **15.x** App Router (not 16). React 19. TypeScript **5.x** strict (`"strict": true`). Do not install TypeScript 7.
- Prisma **6.x** with `provider = "mongodb"`. Never Prisma 7/8. The `mongodb` npm driver is imported **only** in `lib/db/mongo.ts`.
- MongoDB must run as a replica set. Local URL: `mongodb://localhost:27017/signcraft?directConnection=true` (host) / `mongodb://mongo:27017/signcraft?directConnection=true` (inside compose).
- Tailwind CSS 4 + Shadcn UI (CLI `shadcn@latest`, base colour `slate`, CSS variables). Use the Shadcn MCP (`mcp__Shadcn_UI__get_component`, `get_component_demo`) to look up component source and usage before writing UI.
- Package manager: **pnpm**. Node 20+ (Vercel default 22).
- Every route handler: `export const runtime = 'nodejs'`; reads also `export const dynamic = 'force-dynamic'`. Handlers are ≤ ~30 lines: parse → persona → service → respond.
- Errors: throw `ApiError(status, code, details?)` from `lib/api/errors.ts`; the wire format is `{ "error": { "code", "message", "details" } }`.
- BigInt fields (`sizeBytes`, `bytesUploaded`) are `BigInt` in Prisma and `number` at the API boundary.
- Persona header `x-persona`: `ops` | `vendor:<id>` | `installer:<id>`; cookie `sc_persona` holds the same string. Parsed only in `lib/api/persona.ts` (server) via `lib/domain/personas.ts` (pure).
- Constants: `CLAIM_TTL_MS` default 180 000 (env override), `PART_SIZE` 10 MiB, presign batch 20, 4 parallel parts, progress report every 2 s or +5 %, 3 part retries, SSE close at 280 s, heartbeat 15 s.
- Status colours (hex, from DESIGN.md): DRAFT `#64748B`/`#F1F5F9`/`#475569`; SUBMITTED `#2563EB`/`#DBEAFE`/`#1D4ED8`; VENDOR_ACCEPTED `#4F46E5`/`#E0E7FF`/`#4338CA`; IN_PRODUCTION `#D97706`/`#FEF3C7`/`#B45309`; READY_FOR_INSTALL `#0D9488`/`#CCFBF1`/`#0F766E`; COMPLETED `#16A34A`/`#DCFCE7`/`#15803D`; CANCELLED `#B91C1C`/`#FEE2E2`/`#991B1B` (dot/stripe, badge fill, badge text).
- Fonts: Inter (UI) and JetBrains Mono (numerics) via `next/font/google`. Tabular numerals everywhere.
- Commit after every task with a conventional message. Never commit `.env`.
- Windows host: use forward slashes in scripts; shell commands in this plan are POSIX (Git Bash).

## Dependency graph (for parallel execution)

```
T1 setup ─► T2 prisma+docker ─► T3 domain ──┬─► T7 jobs service ─► T8 orders+bootstrap ─► T10 routes+SSE ─► T11 shell ─► T12 board ┐
                                            │                                                                            ├─► T13 sheet+dialogs ┤
                                 T4 api plumbing (parallel with T3)                                                      ├─► T14 jobs UI  ┤
                                 T5 storage+uploader (parallel with T3)  ─► T9 assets service ─┘                        └─► T15 uploads UI ┘
                                 T6 dto+realtime mapping (after T3, parallel with T7)                                    ─► T16 docker ─► T17 QA ─► T18 deploy ─► T19 docs
```

Parallel groups: {T3, T4, T5} · {T6, T7} · {T8, T9} · {T12, T13} · {T14, T15}.

---

## File structure

```
package.json, pnpm-lock.yaml, tsconfig.json, next.config.ts, postcss.config.mjs, eslint.config.mjs
components.json                      Shadcn config
vitest.config.ts                     projects: unit (tests/unit) and integration (tests/integration)
.env.example, .gitignore, .dockerignore, Dockerfile, docker-compose.yml
.claude/launch.json                  dev server for the in-app browser
app/
  layout.tsx                         fonts, Providers, Toaster
  page.tsx                           Server Component: getBootstrap() → <Dashboard initialData persona>
  globals.css                        Tailwind 4 + Shadcn tokens + status colour variables
  api/bootstrap/route.ts
  api/orders/route.ts                POST create
  api/orders/[id]/transition/route.ts
  api/jobs/[id]/claim/route.ts
  api/jobs/[id]/verify/route.ts
  api/assets/route.ts                POST create
  api/assets/[id]/parts/route.ts
  api/assets/[id]/progress/route.ts
  api/assets/[id]/complete/route.ts
  api/assets/[id]/abort/route.ts
  api/events/route.ts                SSE
components/
  providers.tsx                      QueryClientProvider + PersonaProvider + TooltipProvider
  dashboard.tsx                      client root: useBootstrap, useRealtime, layout switch, sheet state
  layout/app-header.tsx, persona-switcher.tsx, connection-indicator.tsx, status-summary-pills.tsx
  board/kanban-board.tsx, status-column.tsx, collapsed-rail.tsx, order-card.tsx, mobile-status-tabs.tsx, skeleton-card.tsx, empty-column.tsx
  jobs/job-chip.tsx, claim-countdown.tsx, claim-dialog.tsx, verification-dialog.tsx
  orders/order-detail-sheet.tsx, order-actions.tsx, details-grid.tsx, history-timeline.tsx, create-order-dialog.tsx, transition-dialog.tsx
  uploads/upload-panel.tsx, asset-row.tsx, upload-progress-bar.tsx, simulate-upload-dialog.tsx
  ui/*                               Shadcn generated
lib/
  domain/types.ts, constants.ts, state-machine.ts, personas.ts, claims.ts, permissions.ts, status-meta.ts, schemas.ts, format.ts
  api/errors.ts, persona.ts, validate.ts, respond.ts
  db/prisma.ts, mongo.ts
  storage/r2.ts
  services/dto.ts, jobs.ts, orders.ts, assets.ts, bootstrap.ts
  realtime/events.ts (server mapping), sse.ts (stream), apply-event.ts (client pure), use-realtime.ts
  upload/plan.ts, part-source.ts, uploader.ts, use-uploads.ts
  query/keys.ts, api-client.ts, hooks.ts
  persona/persona-context.tsx, cookie.ts
  utils.ts                           cn()
prisma/schema.prisma, seed.ts
tests/unit/**, tests/integration/**, tests/helpers/db.ts
```

---

### Task 1: Project scaffold, GitHub remote, tooling

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `postcss.config.mjs`, `eslint.config.mjs`, `app/layout.tsx`, `app/page.tsx`, `app/globals.css`, `lib/utils.ts`, `vitest.config.ts`, `.claude/launch.json`, `.dockerignore`
- Modify: `.gitignore`, `.env.example`
- Commit the pending working-tree changes first (CLAUDE.md, UI spec edit, `docs/design/`, removed `docs/stitch/`).

**Interfaces:**
- Produces: `pnpm dev|build|start|lint|test|test:integration|db:push|db:seed`, `@/*` path alias, Shadcn `components.json`, Vitest projects `unit` and `integration`.

- [ ] **Step 1: Commit the pending design changes and create the GitHub remote**

```bash
git add -A
git commit -m "docs: add Claude Design export and per-screen references"
gh repo create SignCraft --public --source=. --remote=origin --description "SignCraft: B2B signage marketplace dashboard (technical assessment)"
git push -u origin main
git remote -v
```
Expected: `origin` points at `https://github.com/YosefHershberg/SignCraft.git`, `main` tracks `origin/main`.

- [ ] **Step 2: Write `package.json`**

```json
{
  "name": "signcraft",
  "version": "0.1.0",
  "private": true,
  "packageManager": "pnpm@11.1.3",
  "scripts": {
    "dev": "next dev",
    "build": "prisma generate && next build",
    "start": "next start",
    "lint": "next lint",
    "typecheck": "tsc --noEmit",
    "test": "vitest run --project unit",
    "test:watch": "vitest --project unit",
    "test:integration": "vitest run --project integration",
    "db:push": "prisma db push --skip-generate",
    "db:seed": "tsx prisma/seed.ts",
    "postinstall": "prisma generate"
  },
  "prisma": { "seed": "tsx prisma/seed.ts" },
  "dependencies": {
    "@aws-sdk/client-s3": "^3.700.0",
    "@aws-sdk/s3-request-presigner": "^3.700.0",
    "@prisma/client": "^6.19.0",
    "@tanstack/react-query": "^5.90.0",
    "class-variance-authority": "^0.7.1",
    "clsx": "^2.1.1",
    "lucide-react": "^0.500.0",
    "mongodb": "^6.20.0",
    "next": "^15.5.0",
    "react": "^19.1.0",
    "react-dom": "^19.1.0",
    "sonner": "^2.0.0",
    "tailwind-merge": "^3.3.0",
    "zod": "^4.1.0"
  },
  "devDependencies": {
    "@tailwindcss/postcss": "^4.1.0",
    "@types/node": "^22.0.0",
    "@types/react": "^19.1.0",
    "@types/react-dom": "^19.1.0",
    "dotenv": "^16.4.0",
    "eslint": "^9.0.0",
    "eslint-config-next": "^15.5.0",
    "prisma": "^6.19.0",
    "tailwindcss": "^4.1.0",
    "tsx": "^4.19.0",
    "tw-animate-css": "^1.3.0",
    "typescript": "^5.9.0",
    "vitest": "^3.2.0"
  }
}
```
Then `pnpm install`. If a caret range resolves to a version that no longer exists, run `npm view <pkg> versions --json | tail` and pick the latest matching major.

- [ ] **Step 3: Write `tsconfig.json`, `next.config.ts`, `postcss.config.mjs`, `eslint.config.mjs`**

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": false,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```
`next.config.ts`:
```ts
import type { NextConfig } from 'next';
const nextConfig: NextConfig = {
  output: 'standalone',
  serverExternalPackages: ['@prisma/client', 'mongodb'],
};
export default nextConfig;
```
`postcss.config.mjs`:
```js
export default { plugins: { '@tailwindcss/postcss': {} } };
```
`eslint.config.mjs`:
```js
import { dirname } from 'path';
import { fileURLToPath } from 'url';
import { FlatCompat } from '@eslint/eslintrc';
const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) });
export default [...compat.extends('next/core-web-vitals', 'next/typescript')];
```
(add `@eslint/eslintrc` as a devDependency if `pnpm lint` complains).

- [ ] **Step 4: Minimal app + globals.css + Shadcn init**

`app/globals.css` (Shadcn init will extend this; keep the status variables):
```css
@import "tailwindcss";
@import "tw-animate-css";

:root {
  --status-draft: #64748B; --status-draft-bg: #F1F5F9; --status-draft-fg: #475569;
  --status-submitted: #2563EB; --status-submitted-bg: #DBEAFE; --status-submitted-fg: #1D4ED8;
  --status-accepted: #4F46E5; --status-accepted-bg: #E0E7FF; --status-accepted-fg: #4338CA;
  --status-production: #D97706; --status-production-bg: #FEF3C7; --status-production-fg: #B45309;
  --status-ready: #0D9488; --status-ready-bg: #CCFBF1; --status-ready-fg: #0F766E;
  --status-completed: #16A34A; --status-completed-bg: #DCFCE7; --status-completed-fg: #15803D;
  --status-cancelled: #B91C1C; --status-cancelled-bg: #FEE2E2; --status-cancelled-fg: #991B1B;
}
body { font-variant-numeric: tabular-nums; }
```
`app/layout.tsx`:
```tsx
import type { Metadata } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import './globals.css';
const inter = Inter({ subsets: ['latin'], variable: '--font-sans' });
const mono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono' });
export const metadata: Metadata = { title: 'SignCraft', description: 'Signage marketplace ops console' };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${mono.variable}`}>
      <body className="min-h-screen bg-slate-50 font-sans text-slate-900 antialiased">{children}</body>
    </html>
  );
}
```
`app/page.tsx` (placeholder until Task 11): `export default function Page() { return <main className="p-6">SignCraft</main>; }`
`lib/utils.ts`:
```ts
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
export function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)); }
```
Run:
```bash
pnpm dlx shadcn@latest init --yes --defaults --base-color slate
pnpm dlx shadcn@latest add --yes button badge dialog sheet dropdown-menu select input textarea label popover calendar progress tabs tooltip skeleton sonner radio-group separator scroll-area
```
If `init` cannot detect the framework, write `components.json` by hand:
```json
{ "$schema": "https://ui.shadcn.com/schema.json", "style": "new-york", "rsc": true, "tsx": true,
  "tailwind": { "config": "", "css": "app/globals.css", "baseColor": "slate", "cssVariables": true, "prefix": "" },
  "aliases": { "components": "@/components", "utils": "@/lib/utils", "ui": "@/components/ui", "lib": "@/lib", "hooks": "@/hooks" },
  "iconLibrary": "lucide" }
```
and re-run `add`. After init, make sure `globals.css` still contains the `--status-*` variables and that `--font-sans`/`--font-mono` are wired into `@theme inline` as `--font-sans: var(--font-sans)` and `--font-mono: var(--font-mono)`.

- [ ] **Step 5: Vitest config, launch config, ignores, env example**

`vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';
import path from 'node:path';
const alias = { '@': path.resolve(__dirname, '.') };
export default defineConfig({
  test: {
    projects: [
      { test: { name: 'unit', include: ['tests/unit/**/*.test.ts'], environment: 'node' }, resolve: { alias } },
      { test: { name: 'integration', include: ['tests/integration/**/*.test.ts'], environment: 'node',
          setupFiles: ['tests/helpers/env.ts'], fileParallelism: false, testTimeout: 30_000 }, resolve: { alias } },
    ],
  },
});
```
`tests/helpers/env.ts`:
```ts
import { config } from 'dotenv';
config({ path: '.env' });
```
`.claude/launch.json`:
```json
{ "version": "0.0.1", "configurations": [ { "name": "dev", "runtimeExecutable": "pnpm", "runtimeArgs": ["dev"], "port": 3000 } ] }
```
`.gitignore` add: `next-env.d.ts`, `*.tsbuildinfo`, `.vercel`, `/lib/generated`. `.dockerignore`: `node_modules`, `.next`, `.git`, `.env`, `docs`, `*.docx`.
`.env.example`: change `DATABASE_URL` to `mongodb://localhost:27017/signcraft?directConnection=true` and add the comment `# inside docker compose the app uses mongodb://mongo:27017/signcraft?directConnection=true`. Update the user's `.env` the same way (it currently points at `mongo:27017`, which does not resolve on the host).

- [ ] **Step 6: Verify and commit**

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```
Expected: typecheck/lint clean, vitest reports "No test files found" without failing (add `passWithNoTests: true` to both projects), build succeeds. Then:
```bash
git add -A && git commit -m "chore: scaffold Next.js 15, Tailwind 4, Shadcn, Vitest" && git push
```

---

### Task 2: Prisma schema, DB clients, Docker Mongo, seed

**Files:**
- Create: `prisma/schema.prisma`, `prisma/seed.ts`, `lib/db/prisma.ts`, `lib/db/mongo.ts`, `docker-compose.yml` (mongo service only for now), `tests/helpers/db.ts`
- Test: `tests/integration/seed.test.ts`

**Interfaces:**
- Produces: `prisma` singleton (`@/lib/db/prisma`), `getMongoDb(): Promise<Db>` (`@/lib/db/mongo`), `resetDb()` and `seedBase()` helpers, seeded ids via names.

- [ ] **Step 1: `prisma/schema.prisma`**

```prisma
generator client { provider = "prisma-client-js" }
datasource db { provider = "mongodb"  url = env("DATABASE_URL") }

enum OrderStatus { DRAFT SUBMITTED VENDOR_ACCEPTED IN_PRODUCTION READY_FOR_INSTALL COMPLETED CANCELLED }
enum JobStatus   { OPEN CLAIMED ASSIGNED }
enum AssetStatus { PENDING UPLOADING UPLOADED FAILED ABORTED }
enum SignType    { STOREFRONT WAYFINDING VEHICLE_WRAP BANNER MONUMENT }
enum ActorType   { OPS VENDOR INSTALLER SYSTEM }

model Vendor {
  id     String  @id @default(auto()) @map("_id") @db.ObjectId
  name   String  @unique
  orders Order[]
}

model Installer {
  id   String @id @default(auto()) @map("_id") @db.ObjectId
  name String @unique
}

type Transition {
  from      OrderStatus?
  to        OrderStatus
  actorType ActorType
  actorId   String?
  reason    String?
  at        DateTime
}

model Order {
  id             String       @id @default(auto()) @map("_id") @db.ObjectId
  orderNumber    String       @unique
  title          String
  customerName   String
  signType       SignType
  widthCm        Int
  heightCm       Int
  quantity       Int
  installAddress String
  dueDate        DateTime
  notes          String?
  vendorId       String       @db.ObjectId
  vendor         Vendor       @relation(fields: [vendorId], references: [id])
  status         OrderStatus  @default(DRAFT)
  version        Int          @default(0)
  history        Transition[]
  assets         Asset[]
  installJob     InstallJob?
  createdAt      DateTime     @default(now())
  updatedAt      DateTime     @updatedAt
  @@index([status])
  @@index([vendorId, status])
}

type Claim {
  installerId String   @db.ObjectId
  claimedAt   DateTime
  expiresAt   DateTime
}

model InstallJob {
  id          String    @id @default(auto()) @map("_id") @db.ObjectId
  orderId     String    @unique @db.ObjectId
  order       Order     @relation(fields: [orderId], references: [id])
  status      JobStatus @default(OPEN)
  claim       Claim?
  installerId String?   @db.ObjectId
  version     Int       @default(0)
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt
  @@index([status])
}

model Asset {
  id            String      @id @default(auto()) @map("_id") @db.ObjectId
  orderId       String      @db.ObjectId
  order         Order       @relation(fields: [orderId], references: [id])
  fileName      String
  contentType   String
  sizeBytes     BigInt
  storageKey    String
  uploadId      String?
  status        AssetStatus @default(PENDING)
  bytesUploaded BigInt      @default(0)
  progressPct   Int         @default(0)
  simulated     Boolean     @default(false)
  createdAt     DateTime    @default(now())
  updatedAt     DateTime    @updatedAt
  @@index([orderId])
}
```

- [ ] **Step 2: DB clients**

`lib/db/prisma.ts`:
```ts
import { PrismaClient } from '@prisma/client';
const g = globalThis as unknown as { prisma?: PrismaClient };
export const prisma = g.prisma ?? new PrismaClient({ log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'] });
if (process.env.NODE_ENV !== 'production') g.prisma = prisma;
```
`lib/db/mongo.ts` (the only file allowed to import `mongodb`):
```ts
import { MongoClient, type Db } from 'mongodb';
const g = globalThis as unknown as { mongoClient?: MongoClient };
export async function getMongoDb(): Promise<Db> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  if (!g.mongoClient) g.mongoClient = new MongoClient(url, { maxPoolSize: 5 });
  await g.mongoClient.connect();
  return g.mongoClient.db(); // db name comes from the connection string
}
```

- [ ] **Step 3: `docker-compose.yml` (mongo only; the app service is added in Task 16)**

```yaml
services:
  mongo:
    image: mongo:7
    command: ["--replSet", "rs0", "--bind_ip_all"]
    ports: ["27017:27017"]
    volumes: ["mongo-data:/data/db"]
    healthcheck:
      test: ["CMD-SHELL", "mongosh --quiet --eval \"try { rs.status().ok } catch (e) { rs.initiate({_id:'rs0',members:[{_id:0,host:'localhost:27017'}]}).ok }\""]
      interval: 5s
      timeout: 10s
      retries: 20
      start_period: 5s
volumes:
  mongo-data: {}
```
Note `host:'localhost:27017'` so that both the host machine and the compose network can use `directConnection=true`. Run `docker compose up -d mongo` and wait for `healthy` (`docker compose ps`).

- [ ] **Step 4: Seed (idempotent)**

`prisma/seed.ts`:
```ts
import { PrismaClient, type OrderStatus, type SignType } from '@prisma/client';
const prisma = new PrismaClient();
const VENDORS = ['Acme Signs', 'Brightline Fab', 'Metro Signworks'];
const INSTALLERS = ['Dana K.', 'Omar S.', 'Priya N.', 'Luis M.'];
const DAY = 86_400_000;
type SeedOrder = { n: number; title: string; customer: string; signType: SignType; w: number; h: number; qty: number; address: string; dueIn: number; vendor: string; status: OrderStatus; notes?: string };
const ORDERS: SeedOrder[] = [
  { n: 1, title: 'Fascia sign', customer: 'Riverside Bakery', signType: 'STOREFRONT', w: 320, h: 60, qty: 1, address: '12 River St, Leeds', dueIn: 10, vendor: 'Acme Signs', status: 'SUBMITTED' },
  { n: 2, title: 'Window decal set', customer: 'Cedar & Co', signType: 'STOREFRONT', w: 120, h: 80, qty: 4, address: '4 Cedar Row, York', dueIn: 8, vendor: 'Brightline Fab', status: 'DRAFT' },
  { n: 3, title: 'Monument base', customer: 'Northwind Dental', signType: 'MONUMENT', w: 180, h: 120, qty: 1, address: '88 Harbour Rd, Hull', dueIn: 21, vendor: 'Metro Signworks', status: 'DRAFT' },
  { n: 4, title: 'Pylon refacing', customer: 'Grove Market', signType: 'WAYFINDING', w: 90, h: 240, qty: 2, address: '1 Grove Sq, Sheffield', dueIn: 14, vendor: 'Acme Signs', status: 'VENDOR_ACCEPTED' },
  { n: 5, title: 'Lobby letters', customer: 'Halcyon Hotel', signType: 'STOREFRONT', w: 200, h: 40, qty: 1, address: '30 Park Ln, Leeds', dueIn: 12, vendor: 'Brightline Fab', status: 'VENDOR_ACCEPTED' },
  { n: 6, title: 'Directory panel', customer: 'Lakeshore Clinic', signType: 'WAYFINDING', w: 60, h: 150, qty: 3, address: '7 Lake Dr, Bradford', dueIn: 6, vendor: 'Metro Signworks', status: 'IN_PRODUCTION' },
  { n: 7, title: 'Blade sign', customer: "Otto's Garage", signType: 'BANNER', w: 50, h: 100, qty: 1, address: '19 Otto St, Wakefield', dueIn: 5, vendor: 'Acme Signs', status: 'READY_FOR_INSTALL' },
  { n: 8, title: 'Van wrap', customer: 'Peak Couriers', signType: 'VEHICLE_WRAP', w: 500, h: 200, qty: 2, address: '2 Summit Way, Leeds', dueIn: 3, vendor: 'Brightline Fab', status: 'COMPLETED' },
];
const CHAIN: OrderStatus[] = ['DRAFT', 'SUBMITTED', 'VENDOR_ACCEPTED', 'IN_PRODUCTION', 'READY_FOR_INSTALL', 'COMPLETED'];
export async function seed() {
  const vendors = new Map<string, string>();
  for (const name of VENDORS) vendors.set(name, (await prisma.vendor.upsert({ where: { name }, update: {}, create: { name } })).id);
  const installers = new Map<string, string>();
  for (const name of INSTALLERS) installers.set(name, (await prisma.installer.upsert({ where: { name }, update: {}, create: { name } })).id);
  const now = Date.now();
  for (const o of ORDERS) {
    const orderNumber = `SC-${String(o.n).padStart(4, '0')}`;
    if (await prisma.order.findUnique({ where: { orderNumber } })) continue;
    const idx = CHAIN.indexOf(o.status);
    const history = CHAIN.slice(0, idx + 1).map((to, i) => ({
      from: i === 0 ? null : CHAIN[i - 1], to,
      actorType: i === 0 ? 'SYSTEM' : i === 1 ? 'OPS' : i === 5 ? 'INSTALLER' : 'VENDOR',
      actorId: null, reason: null, at: new Date(now - (idx - i + 1) * 3_600_000),
    })) as { from: OrderStatus | null; to: OrderStatus; actorType: 'OPS' | 'VENDOR' | 'INSTALLER' | 'SYSTEM'; actorId: null; reason: null; at: Date }[];
    const order = await prisma.order.create({ data: {
      orderNumber, title: o.title, customerName: o.customer, signType: o.signType, widthCm: o.w, heightCm: o.h, quantity: o.qty,
      installAddress: o.address, dueDate: new Date(now + o.dueIn * DAY), notes: o.notes ?? null,
      vendorId: vendors.get(o.vendor)!, status: o.status, version: idx, history } });
    if (idx >= 1) await prisma.asset.create({ data: {
      orderId: order.id, fileName: `${orderNumber.toLowerCase()}-print.pdf`, contentType: 'application/pdf', sizeBytes: BigInt(4_200_000 + o.n * 10_000),
      storageKey: `orders/${order.id}/seed/${orderNumber.toLowerCase()}-print.pdf`, status: 'UPLOADED', bytesUploaded: BigInt(4_200_000 + o.n * 10_000), progressPct: 100 } });
    if (o.status === 'READY_FOR_INSTALL') await prisma.installJob.create({ data: { orderId: order.id, status: 'OPEN' } });
    if (o.status === 'COMPLETED') await prisma.installJob.create({ data: { orderId: order.id, status: 'ASSIGNED', installerId: installers.get('Dana K.')! } });
  }
  // one DRAFT with an uploaded asset (SC-0002) so Submit is demonstrable immediately
  const draft = await prisma.order.findUnique({ where: { orderNumber: 'SC-0002' } });
  if (draft && !(await prisma.asset.findFirst({ where: { orderId: draft.id } })))
    await prisma.asset.create({ data: { orderId: draft.id, fileName: 'print_v3.pdf', contentType: 'application/pdf', sizeBytes: BigInt(12_600_000), storageKey: `orders/${draft.id}/seed/print_v3.pdf`, status: 'UPLOADED', bytesUploaded: BigInt(12_600_000), progressPct: 100 } });
}
if (process.argv[1]?.endsWith('seed.ts')) seed().then(() => prisma.$disconnect()).catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 5: Test helpers and a seed test**

`tests/helpers/db.ts`:
```ts
import { prisma } from '@/lib/db/prisma';
export async function resetDb() {
  await prisma.asset.deleteMany(); await prisma.installJob.deleteMany(); await prisma.order.deleteMany();
  await prisma.installer.deleteMany(); await prisma.vendor.deleteMany();
}
export async function makeVendor(name = 'Vendor A') { return prisma.vendor.create({ data: { name } }); }
export async function makeInstaller(name = 'Installer A') { return prisma.installer.create({ data: { name } }); }
export async function makeOrder(vendorId: string, over: Partial<Parameters<typeof prisma.order.create>[0]['data']> = {}) {
  const n = Math.floor(Math.random() * 1e9);
  return prisma.order.create({ data: { orderNumber: `T-${n}`, title: 'Test', customerName: 'Cust', signType: 'BANNER', widthCm: 10, heightCm: 10, quantity: 1,
    installAddress: 'x', dueDate: new Date(), vendorId, status: 'DRAFT', version: 0, history: [{ from: null, to: 'DRAFT', actorType: 'OPS', actorId: null, reason: null, at: new Date() }], ...over } });
}
```
`tests/integration/seed.test.ts`:
```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { seed } from '@/prisma/seed';
import { prisma } from '@/lib/db/prisma';
import { resetDb } from '@/tests/helpers/db';
describe('seed', () => {
  beforeAll(async () => { await resetDb(); });
  it('is idempotent and creates the documented fixture', async () => {
    await seed(); await seed();
    expect(await prisma.vendor.count()).toBe(3);
    expect(await prisma.installer.count()).toBe(4);
    expect(await prisma.order.count()).toBe(8);
    const ready = await prisma.order.findFirst({ where: { status: 'READY_FOR_INSTALL' }, include: { installJob: true } });
    expect(ready?.installJob?.status).toBe('OPEN');
    const draft = await prisma.order.findUnique({ where: { orderNumber: 'SC-0002' }, include: { assets: true } });
    expect(draft?.assets.some((a) => a.status === 'UPLOADED')).toBe(true);
  });
});
```

- [ ] **Step 6: Run and commit**

```bash
pnpm prisma generate && pnpm db:push && pnpm db:seed && pnpm test:integration
```
Expected: `db push` creates collections and indexes; seed prints nothing and exits 0; the seed test passes. Verify with the MongoDB MCP or `mongosh --eval 'db.getSiblingDB("signcraft").Order.countDocuments()'` = 8.
```bash
git add -A && git commit -m "feat: prisma schema, db clients, docker mongo replica set, idempotent seed" && git push
```

---

### Task 3: Pure domain layer

**Files:**
- Create: `lib/domain/types.ts`, `constants.ts`, `state-machine.ts`, `personas.ts`, `claims.ts`, `permissions.ts`, `status-meta.ts`, `schemas.ts`, `format.ts`
- Test: `tests/unit/domain/state-machine.test.ts`, `personas.test.ts`, `claims.test.ts`, `permissions.test.ts`, `schemas.test.ts`

**Interfaces (Produces, used by every later task):**

`lib/domain/types.ts`:
```ts
export const ORDER_STATUSES = ['DRAFT','SUBMITTED','VENDOR_ACCEPTED','IN_PRODUCTION','READY_FOR_INSTALL','COMPLETED','CANCELLED'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];
export type JobStatus = 'OPEN' | 'CLAIMED' | 'ASSIGNED';
export type AssetStatus = 'PENDING' | 'UPLOADING' | 'UPLOADED' | 'FAILED' | 'ABORTED';
export const SIGN_TYPES = ['STOREFRONT','WAYFINDING','VEHICLE_WRAP','BANNER','MONUMENT'] as const;
export type SignType = (typeof SIGN_TYPES)[number];
export type ActorType = 'OPS' | 'VENDOR' | 'INSTALLER' | 'SYSTEM';
export type Persona = { kind: 'ops' } | { kind: 'vendor'; id: string } | { kind: 'installer'; id: string };
export interface TransitionDTO { from: OrderStatus | null; to: OrderStatus; actorType: ActorType; actorId: string | null; reason: string | null; at: string }
export interface VendorDTO { id: string; name: string }
export interface InstallerDTO { id: string; name: string }
export interface ClaimDTO { installerId: string; claimedAt: string; expiresAt: string }
export interface JobDTO { id: string; orderId: string; status: JobStatus; claim: ClaimDTO | null; installerId: string | null; version: number; createdAt: string; updatedAt: string }
export interface AssetDTO { id: string; orderId: string; fileName: string; contentType: string; sizeBytes: number; storageKey: string; status: AssetStatus; bytesUploaded: number; progressPct: number; simulated: boolean; createdAt: string; updatedAt: string }
export interface OrderDTO { id: string; orderNumber: string; title: string; customerName: string; signType: SignType; widthCm: number; heightCm: number; quantity: number; installAddress: string; dueDate: string; notes: string | null; vendorId: string; status: OrderStatus; version: number; history: TransitionDTO[]; createdAt: string; updatedAt: string; installJob: JobDTO | null; assets: AssetDTO[] }
export interface BootstrapDTO { vendors: VendorDTO[]; installers: InstallerDTO[]; orders: OrderDTO[]; serverTime: string }
export type OrderAction = 'submit' | 'accept' | 'start_production' | 'mark_ready' | 'complete' | 'cancel';
export type JobAction = 'claim' | 'verify' | 'complete';
export interface ActionAvailability { action: OrderAction; enabled: boolean; reason: string | null }
export type SseEvent =
  | { type: 'order.created' | 'order.updated'; doc: OrderDTO }
  | { type: 'job.created' | 'job.updated'; doc: JobDTO }
  | { type: 'asset.created' | 'asset.updated'; doc: AssetDTO };
```

`lib/domain/constants.ts`:
```ts
export const DEFAULT_CLAIM_TTL_MS = 180_000;
export const PART_SIZE = 10 * 1024 * 1024;
export const PRESIGN_BATCH = 20;
export const MAX_PARALLEL_PARTS = 4;
export const PROGRESS_INTERVAL_MS = 2_000;
export const PROGRESS_STEP_PCT = 5;
export const MAX_PART_RETRIES = 3;
export const PRESIGN_EXPIRY_S = 3_600;
export const SSE_MAX_AGE_MS = 280_000;
export const SSE_HEARTBEAT_MS = 15_000;
export const DEGRADED_AFTER_FAILURES = 3;
export const DEGRADED_POLL_MS = 10_000;
export const UPLOADABLE_STATUSES = ['DRAFT', 'SUBMITTED'] as const;
export const SIMULATED_SIZES = [{ label: '100 MB', bytes: 100 * 1024 * 1024 }, { label: '1 GB', bytes: 1024 ** 3 }, { label: '2 GB', bytes: 2 * 1024 ** 3 }] as const;
```

`lib/domain/state-machine.ts`:
```ts
export const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = { DRAFT: ['SUBMITTED','CANCELLED'], SUBMITTED: ['VENDOR_ACCEPTED','CANCELLED'], VENDOR_ACCEPTED: ['IN_PRODUCTION','CANCELLED'], IN_PRODUCTION: ['READY_FOR_INSTALL'], READY_FOR_INSTALL: ['COMPLETED'], COMPLETED: [], CANCELLED: [] };
export function allowedTransitions(from: OrderStatus): OrderStatus[]
export function canTransition(from: OrderStatus, to: OrderStatus): boolean
export function isTerminal(s: OrderStatus): boolean
export function canCancel(s: OrderStatus): boolean            // true only for DRAFT, SUBMITTED, VENDOR_ACCEPTED
export const ACTION_TARGET: Record<OrderAction, OrderStatus> = { submit: 'SUBMITTED', accept: 'VENDOR_ACCEPTED', start_production: 'IN_PRODUCTION', mark_ready: 'READY_FOR_INSTALL', complete: 'COMPLETED', cancel: 'CANCELLED' };
export function actionForTransition(from: OrderStatus, to: OrderStatus): OrderAction | null
```

`lib/domain/personas.ts`:
```ts
export function parsePersona(raw: string | null | undefined): Persona | null   // 'ops' | 'vendor:<id>' | 'installer:<id>', ids must be 24 hex chars; anything else → null
export function serialisePersona(p: Persona): string
export function actorTypeOf(p: Persona): ActorType
export function actorIdOf(p: Persona): string | null
export function personaLabel(p: Persona, vendors: VendorDTO[], installers: InstallerDTO[]): { name: string; role: 'Ops' | 'Vendor' | 'Installer' }
```

`lib/domain/claims.ts`:
```ts
export interface JobLike { status: JobStatus; claim: { installerId: string; expiresAt: string | Date; claimedAt: string | Date } | null; installerId: string | null }
export function isClaimExpired(job: JobLike, now: Date): boolean       // CLAIMED && claim && expiresAt <= now
export function toPublicJob<T extends JobLike>(job: T, now: Date): T   // expired → { ...job, status: 'OPEN', claim: null }
export function claimRemainingMs(job: JobLike, now: Date): number      // 0 when not CLAIMED
export function claimTtlMs(env: { CLAIM_TTL_MS?: string } = {}): number // parse env or DEFAULT_CLAIM_TTL_MS
```

`lib/domain/permissions.ts`:
```ts
export interface OrderCtx { status: OrderStatus; vendorId: string; hasUploadedAsset: boolean; installJob: JobLike | null }
export type Denial = { ok: false; code: 'FORBIDDEN_FOR_PERSONA' | 'INVALID_TRANSITION' | 'GUARD_FAILED'; reason?: 'NO_UPLOADED_ASSET' | 'NO_ASSIGNED_INSTALLER' | 'ORDER_NOT_UPLOADABLE'; allowed?: OrderStatus[] }
export type Verdict = { ok: true } | Denial
export function checkTransition(persona: Persona, order: OrderCtx, to: OrderStatus, now: Date): Verdict
   // order of checks: INVALID_TRANSITION (table) → FORBIDDEN_FOR_PERSONA (table §6 of arch spec; vendor must own order; complete requires installer === installJob.installerId after toPublicJob) → GUARD_FAILED (SUBMITTED needs hasUploadedAsset; COMPLETED needs installJob.status ASSIGNED)
export function orderActionsFor(persona: Persona, order: OrderCtx, now: Date): ActionAvailability[]
   // only actions the persona may take in this status (UI table §6); enabled=false with reason text when only a guard fails
   // reason texts: 'Needs at least one uploaded file' | 'Needs an assigned installer'
export function checkUpload(persona: Persona, status: OrderStatus): Verdict   // ops only; UPLOADABLE_STATUSES else GUARD_FAILED/ORDER_NOT_UPLOADABLE
export function jobActionsFor(persona: Persona, job: JobLike | null, now: Date): { canClaim: boolean; canVerify: boolean; canComplete: boolean; claimDisabledReason: string | null }
   // installer only. canClaim: job public status OPEN. canVerify: CLAIMED by me and not expired. canComplete: ASSIGNED to me.
   // claimDisabledReason: 'Claimed by another installer' when CLAIMED by someone else, 'Assigned' when ASSIGNED.
```

`lib/domain/status-meta.ts`:
```ts
export const STATUS_META: Record<OrderStatus, { label: string; short: string; dot: string; bg: string; fg: string; cssVar: string }>
  // labels: Draft, Submitted, Accepted, In production, Ready for install, Completed, Cancelled; hex values from Global Constraints; cssVar e.g. 'draft' → var(--status-draft)
export const SIGN_TYPE_LABEL: Record<SignType, string>  // Storefront, Wayfinding, Vehicle wrap, Banner, Monument
export const ACTION_LABEL: Record<OrderAction, string>  // Submit, Accept, Start production, Mark ready for install, Complete, Cancel
export const ACTION_CONSEQUENCE: Record<OrderAction, string> // 'The vendor will be notified' | 'Production can start' | 'The order enters production; it can no longer be cancelled' | 'The job will be posted to installers' | 'The order will be closed' | 'The order will be cancelled'
```

`lib/domain/schemas.ts` (Zod 4):
```ts
export const objectIdSchema = z.string().regex(/^[0-9a-f]{24}$/);
export const createOrderSchema = z.object({ title: z.string().trim().min(1).max(120), customerName: z.string().trim().min(1).max(120), signType: z.enum(SIGN_TYPES), widthCm: z.number().int().min(1).max(10_000), heightCm: z.number().int().min(1).max(10_000), quantity: z.number().int().min(1).max(1_000), vendorId: objectIdSchema, installAddress: z.string().trim().min(1).max(300), dueDate: z.string().refine((s) => !Number.isNaN(Date.parse(s)), 'Invalid date'), notes: z.string().trim().max(2_000).optional().nullable() });
export const transitionSchema = z.object({ to: z.enum(ORDER_STATUSES), expectedVersion: z.number().int().min(0).optional(), reason: z.string().trim().max(500).optional() });
export const verifySchema = z.object({ outcome: z.enum(['pass', 'fail']) });
export const createAssetSchema = z.object({ orderId: objectIdSchema, fileName: z.string().trim().min(1).max(255), contentType: z.string().min(1).max(120), sizeBytes: z.number().int().min(1).max(50 * 1024 ** 3), simulated: z.boolean().default(false) });
export const partsSchema = z.object({ partNumbers: z.array(z.number().int().min(1).max(10_000)).min(1).max(PRESIGN_BATCH) });
export const progressSchema = z.object({ bytesUploaded: z.number().int().min(0) });
export const completeSchema = z.object({ parts: z.array(z.object({ partNumber: z.number().int().min(1), etag: z.string().min(1) })).min(1) });
export type CreateOrderInput = z.infer<typeof createOrderSchema>; // etc. for each
```

`lib/domain/format.ts`: `formatBytes(n)` ('1.0 GB', '640 MB', '12.6 MB'), `formatCountdown(ms)` ('2:41'), `formatDue(iso)` ('24 Sep'), `formatTime(iso)` ('12:04'), `sanitiseFileName(name)` (keep `[A-Za-z0-9._-]`, collapse others to `_`, max 120 chars).

- [ ] **Step 1: Write failing tests** (one file per module; here are the required cases, write them as real `it()` blocks)

`state-machine.test.ts`: every row of `TRANSITIONS` matches the spec table; `canTransition('DRAFT','IN_PRODUCTION')` false; `canCancel` true for DRAFT/SUBMITTED/VENDOR_ACCEPTED and false for the other four; `isTerminal` true for COMPLETED/CANCELLED; `actionForTransition('IN_PRODUCTION','READY_FOR_INSTALL') === 'mark_ready'`.

`personas.test.ts`: `parsePersona('ops')` → `{kind:'ops'}`; `parsePersona('vendor:'+'a'.repeat(24))` → vendor; `parsePersona('vendor:nope')`, `parsePersona('')`, `parsePersona(null)`, `parsePersona('admin')` → null; round-trip `serialisePersona(parsePersona(x)) === x`; `actorTypeOf` mapping.

`claims.test.ts`: a CLAIMED job with `expiresAt` 1 ms in the past is expired and `toPublicJob` returns OPEN with `claim: null` and the original untouched; a future claim is unchanged; OPEN/ASSIGNED never expired; `claimRemainingMs` clamps at 0; `claimTtlMs({CLAIM_TTL_MS:'5000'})` = 5000, invalid → default.

`permissions.test.ts` (use a helper `order(status, extra)`): ops may DRAFT→SUBMITTED only with `hasUploadedAsset` (else `GUARD_FAILED`/`NO_UPLOADED_ASSET`); vendor owner may SUBMITTED→VENDOR_ACCEPTED, a different vendor gets `FORBIDDEN_FOR_PERSONA`; ops cannot accept; installer assigned may READY→COMPLETED, unassigned installer gets `GUARD_FAILED`/`NO_ASSIGNED_INSTALLER` when job OPEN and `FORBIDDEN_FOR_PERSONA` when assigned to someone else; anyone DRAFT→IN_PRODUCTION gets `INVALID_TRANSITION` with `allowed: ['SUBMITTED','CANCELLED']`; IN_PRODUCTION→CANCELLED is `INVALID_TRANSITION`; vendor owner may cancel SUBMITTED; installer cannot cancel; `orderActionsFor(ops, DRAFT no asset)` = `[submit disabled 'Needs at least one uploaded file', cancel enabled]`; `orderActionsFor(vendor owner, IN_PRODUCTION)` = `[mark_ready]` only; `checkUpload(ops,'IN_PRODUCTION')` → `ORDER_NOT_UPLOADABLE`; `checkUpload(vendor,'DRAFT')` → forbidden; `jobActionsFor(installer A, CLAIMED by B future)` → `canClaim:false, claimDisabledReason:'Claimed by another installer'`; same but expired → `canClaim:true`; `jobActionsFor(installer A, CLAIMED by A)` → `canVerify:true`; ASSIGNED to A → `canComplete:true`.

`schemas.test.ts`: `createOrderSchema` rejects `widthCm: 0`, accepts a valid payload; `transitionSchema` rejects `to: 'FOO'`; `partsSchema` rejects 21 part numbers.

`format.test.ts`: `formatBytes(1024**3) === '1.0 GB'`, `formatCountdown(161_000) === '2:41'`, `formatCountdown(0) === '0:00'`, `sanitiseFileName('my file (1).pdf') === 'my_file_1_.pdf'`.

- [ ] **Step 2: Run to verify they fail** — `pnpm test` → module-not-found failures.

- [ ] **Step 3: Implement all modules** exactly to the interfaces above. `checkTransition` implementation outline:

```ts
export function checkTransition(persona: Persona, order: OrderCtx, to: OrderStatus, now: Date): Verdict {
  if (!canTransition(order.status, to)) return { ok: false, code: 'INVALID_TRANSITION', allowed: allowedTransitions(order.status) };
  const job = order.installJob ? toPublicJob(order.installJob, now) : null;
  const isOwner = persona.kind === 'vendor' && persona.id === order.vendorId;
  const forbidden = (): Denial => ({ ok: false, code: 'FORBIDDEN_FOR_PERSONA' });
  switch (to) {
    case 'SUBMITTED': if (persona.kind !== 'ops') return forbidden(); if (!order.hasUploadedAsset) return { ok: false, code: 'GUARD_FAILED', reason: 'NO_UPLOADED_ASSET' }; return { ok: true };
    case 'VENDOR_ACCEPTED': case 'IN_PRODUCTION': case 'READY_FOR_INSTALL': return isOwner ? { ok: true } : forbidden();
    case 'COMPLETED': if (persona.kind !== 'installer') return forbidden();
      if (!job || job.status !== 'ASSIGNED') return { ok: false, code: 'GUARD_FAILED', reason: 'NO_ASSIGNED_INSTALLER' };
      return job.installerId === persona.id ? { ok: true } : forbidden();
    case 'CANCELLED': return persona.kind === 'ops' || isOwner ? { ok: true } : forbidden();
    default: return forbidden();
  }
}
```
`orderActionsFor`: iterate `allowedTransitions(order.status)`, map to action via `actionForTransition`, call `checkTransition`; include when ok (enabled) or when the only failure is `GUARD_FAILED` (disabled with reason text); skip when forbidden.

- [ ] **Step 4: Run tests** — `pnpm test` → all green. `pnpm typecheck` clean.

- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(domain): state machine, personas, claims, permissions, schemas" && git push`

---

### Task 4: API plumbing (errors, persona header, validation, responses)

**Files:**
- Create: `lib/api/errors.ts`, `lib/api/persona.ts`, `lib/api/validate.ts`, `lib/api/respond.ts`
- Test: `tests/unit/api/errors.test.ts`, `tests/unit/api/persona.test.ts`, `tests/unit/api/validate.test.ts`

**Interfaces:**
- Produces:
```ts
// lib/api/errors.ts
export type ErrorCode = 'VALIDATION_ERROR'|'INVALID_TRANSITION'|'GUARD_FAILED'|'FORBIDDEN_FOR_PERSONA'|'NOT_FOUND'|'VERSION_CONFLICT'|'CLAIM_TAKEN'|'CLAIM_EXPIRED'|'NOT_CLAIMANT'|'STORAGE_ERROR'|'INTERNAL';
export class ApiError extends Error { constructor(public status: number, public code: ErrorCode, public details?: Record<string, unknown>, message?: string) }
   // default messages per code, e.g. INVALID_TRANSITION → `Cannot move ${details.from} to ${details.to}`, CLAIM_TAKEN → 'Another installer claimed this job a moment ago', CLAIM_EXPIRED → 'Your claim has expired', VERSION_CONFLICT → 'The order changed; refresh and try again', GUARD_FAILED → per reason ('Needs at least one uploaded file' | 'Needs an assigned installer' | 'Files can only be uploaded while the order is Draft or Submitted')
export function errorResponse(err: unknown): Response   // ApiError → its status + {error:{code,message,details}}; ZodError → 400 VALIDATION_ERROR with details = z.flattenError(err); anything else → 500 INTERNAL (console.error)
export function withErrorHandling<T extends unknown[]>(fn: (...a: T) => Promise<Response>): (...a: T) => Promise<Response>
export function fromVerdict(v: Denial): ApiError  // INVALID_TRANSITION→400 with {from,to,allowed}; GUARD_FAILED→400 {reason}; FORBIDDEN_FOR_PERSONA→403
// lib/api/persona.ts
export function getPersona(req: Request): Persona | null        // header x-persona, fallback cookie sc_persona
export function requirePersona(req: Request): Persona           // throws ApiError(403,'FORBIDDEN_FOR_PERSONA') when missing/invalid
export function requireKind<K extends Persona['kind']>(req: Request, kind: K): Extract<Persona, { kind: K }>
// lib/api/validate.ts
export async function parseBody<S extends z.ZodType>(req: Request, schema: S): Promise<z.infer<S>>  // invalid JSON → ApiError(400,'VALIDATION_ERROR')
// lib/api/respond.ts
export function json(data: unknown, status = 200): Response   // JSON.stringify with a replacer that turns bigint → Number
export function noContent(): Response  // 204
```
`fromVerdict(v)` takes the `from`/`to` for INVALID_TRANSITION from an extra argument: `fromVerdict(v, { from, to })`.

- [ ] **Step 1: Failing tests.** `errors.test.ts`: `errorResponse(new ApiError(409,'CLAIM_TAKEN'))` → status 409 and body `{error:{code:'CLAIM_TAKEN',message:...}}`; ZodError → 400 with `details.fieldErrors`; `new Error('x')` → 500 INTERNAL. `persona.test.ts`: header `x-persona: ops` → ops; cookie only `sc_persona=installer:<24hex>` → installer; header wins over cookie; `requireKind(req,'ops')` with a vendor header throws 403. `validate.test.ts`: valid body parses; `'{bad'` → 400 VALIDATION_ERROR; schema failure → ZodError propagates and `errorResponse` maps it to 400.
- [ ] **Step 2: Run** — fails (modules missing).
- [ ] **Step 3: Implement** as specified. Cookie parsing: split `req.headers.get('cookie')` on `; ` and find `sc_persona=`; decodeURIComponent.
- [ ] **Step 4: Run** — green. **Step 5: Commit** — `git commit -m "feat(api): ApiError contract, persona header parsing, validation helpers"`.

---

### Task 5: R2 storage client, upload plan math, browser multipart uploader

**Files:**
- Create: `lib/storage/r2.ts`, `lib/upload/plan.ts`, `lib/upload/part-source.ts`, `lib/upload/uploader.ts`
- Test: `tests/unit/upload/plan.test.ts`, `tests/unit/upload/part-source.test.ts`, `tests/unit/upload/uploader.test.ts`

**Interfaces:**
- Produces:
```ts
// lib/storage/r2.ts (server only)
export interface Storage {
  createMultipart(key: string, contentType: string): Promise<{ uploadId: string }>;
  presignPart(key: string, uploadId: string, partNumber: number): Promise<string>;   // URL valid PRESIGN_EXPIRY_S
  completeMultipart(key: string, uploadId: string, parts: { partNumber: number; etag: string }[]): Promise<void>;
  abortMultipart(key: string, uploadId: string): Promise<void>;
}
export const storage: Storage;      // S3Client({ region:'auto', endpoint:`https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`, credentials, forcePathStyle: true }); every method wraps SDK errors as ApiError(502,'STORAGE_ERROR',{op})
export function storageKeyFor(orderId: string, assetId: string, fileName: string): string  // orders/<orderId>/<assetId>/<sanitiseFileName(fileName)>
// lib/upload/plan.ts (pure)
export interface UploadPlan { partSize: number; partCount: number; lastPartSize: number }
export function planParts(sizeBytes: number, partSize = PART_SIZE): UploadPlan   // partCount = ceil(size/partSize); lastPartSize = size - (partCount-1)*partSize
export function partRange(plan: UploadPlan, partNumber: number): { start: number; end: number; size: number }
export function shouldReportProgress(prev: { at: number; pct: number }, now: number, pct: number): boolean  // now-prev.at >= PROGRESS_INTERVAL_MS || pct-prev.pct >= PROGRESS_STEP_PCT || pct === 100
// lib/upload/part-source.ts (browser)
export type PartSource = (partNumber: number) => Blob;
export function fileSource(file: File, plan: UploadPlan): PartSource        // file.slice(start,end)
export function simulatedSource(plan: UploadPlan): PartSource               // one shared zero-filled Uint8Array(partSize); last part sliced to lastPartSize
// lib/upload/uploader.ts (browser, but written with an injectable transport so it is unit-testable in Node)
export interface UploaderApi {
  presign(assetId: string, partNumbers: number[]): Promise<{ partNumber: number; url: string }[]>;
  progress(assetId: string, bytesUploaded: number): Promise<void>;
  complete(assetId: string, parts: { partNumber: number; etag: string }[]): Promise<void>;
  abort(assetId: string): Promise<void>;
}
export interface PutPart { (url: string, body: Blob, onProgress: (loaded: number) => void, signal: AbortSignal): Promise<{ etag: string }> }
export interface UploaderOptions { assetId: string; sizeBytes: number; plan: UploadPlan; source: PartSource; api: UploaderApi; put: PutPart; parallel?: number; batch?: number; maxRetries?: number; now?: () => number; onProgress?: (p: { bytesUploaded: number; pct: number; bytesPerSecond: number; etaMs: number }) => void; onDone?: () => void; onError?: (err: Error) => void; onAborted?: () => void }
export class MultipartUploader { constructor(o: UploaderOptions); start(): Promise<void>; abort(): void; readonly state: 'idle'|'running'|'done'|'failed'|'aborted' }
export const xhrPut: PutPart;   // XMLHttpRequest PUT, upload.onprogress → onProgress(e.loaded); resolves with getResponseHeader('ETag') stripped of quotes; rejects on status ≥ 300 / network error; aborts on signal
```
Uploader algorithm: presign in batches of `batch` (20) lazily as parts are needed; keep `parallel` (4) PUTs in flight; each part retries up to `maxRetries` with backoff `500 * 2^attempt` ms (use `now`/setTimeout, in tests pass a tiny backoff via `maxRetries` and fake timers); per-part loaded bytes tracked in a `Map<partNumber, number>`; total = sum of completed part sizes + in-flight loaded; call `onProgress` on every XHR progress event (UI) and `api.progress` only when `shouldReportProgress` says so; after all parts complete call `api.progress(size)` then `api.complete(parts sorted by partNumber)`; on failure after retries: `api.abort`, state `failed`, `onError`; on `abort()`: abort in-flight signals, `api.abort`, state `aborted`, `onAborted`.

- [ ] **Step 1: Failing tests.** `plan.test.ts`: `planParts(1024**3)` → 103 parts (`Math.ceil(1073741824/10485760) = 103`), last part `1073741824 - 102*10485760 = 3_670_016`; `planParts(10*1024*1024)` → 1 part; `partRange` for part 103; `shouldReportProgress` true after 2 s, true after +5 %, true at 100, false otherwise. `part-source.test.ts`: `simulatedSource(planParts(25*1024*1024))` → part 1 size 10 MiB, part 3 size 5 MiB, and parts 1 and 2 share the same underlying buffer (check by size and `blob.type`; construct with a small custom partSize like 4 bytes to keep tests fast). `uploader.test.ts` with a fake `put` that resolves after recording calls and a fake `api`: (a) a 3-part plan uploads all parts, calls `presign` once with `[1,2,3]`, calls `complete` with 3 etags in order, `state === 'done'`; (b) with 45 parts and `batch: 20` presign is called with `[1..20]`, `[21..40]`, `[41..45]`; (c) `put` failing twice then succeeding still completes and `put` was called 3 times for that part; (d) `put` always failing → `api.abort` called, `state === 'failed'`, `onError` called; (e) `abort()` while running → `api.abort` called once and `complete` never called; (f) `api.progress` is called with the final size before `complete`.
- [ ] **Step 2: Run** — fails.
- [ ] **Step 3: Implement.** `r2.ts` uses `CreateMultipartUploadCommand`, `UploadPartCommand` + `getSignedUrl(client, cmd, { expiresIn: PRESIGN_EXPIRY_S })`, `CompleteMultipartUploadCommand` with `MultipartUpload: { Parts: parts.map(p => ({ PartNumber: p.partNumber, ETag: p.etag })) }`, `AbortMultipartUploadCommand`. Read env lazily inside a `getClient()` so importing the module without env does not throw.
- [ ] **Step 4: Run** — green. Also verify R2 credentials from `.env` work with a one-off script in the scratchpad (`tsx` a script that calls `storage.createMultipart('healthcheck/x.bin','application/octet-stream')` then `abortMultipart`) — expected: no error. Confirm the bucket via the Cloudflare MCP `r2_bucket_get` (`signcraft-bucket`).
- [ ] **Step 5: Commit** — `git commit -m "feat(upload): R2 client, part planning, multipart uploader engine"`.

---

### Task 6: DTO mapping and realtime event mapping (server + client pure)

**Files:**
- Create: `lib/services/dto.ts`, `lib/realtime/events.ts`, `lib/realtime/apply-event.ts`
- Test: `tests/unit/services/dto.test.ts`, `tests/unit/realtime/events.test.ts`, `tests/unit/realtime/apply-event.test.ts`

**Interfaces:**
- Consumes: `lib/domain/types.ts`, `toPublicJob`.
- Produces:
```ts
// lib/services/dto.ts (no Prisma import needed; works on plain objects from Prisma or from the change stream)
export function normalise<T = unknown>(value: unknown): T
   // recursive: ObjectId-like (has toHexString) → string; Date → ISO; bigint → Number; Long-like (has toNumber) → number; key '_id' → 'id'; arrays/objects recursed
export function toJobDTO(raw: unknown, now: Date): JobDTO           // normalise then toPublicJob; ensure claim null when absent, installerId null when absent
export function toAssetDTO(raw: unknown): AssetDTO
export function toOrderDTO(raw: unknown, now: Date): OrderDTO       // installJob → toJobDTO or null; assets → map or []; notes null default; history [] default
// lib/realtime/events.ts (server)
export interface ChangeLike { operationType: string; ns: { coll: string }; fullDocument?: unknown; _id: { _data: string } }
export function changeToEvent(change: ChangeLike, now: Date): { id: string; event: SseEvent } | null
   // coll Order → order.created/updated, InstallJob → job.*, Asset → asset.*; insert → created, update|replace → updated; delete or missing fullDocument → null; id = change._id._data
export function formatSse(frame: { id?: string; event: string; data: unknown }): string   // `id: ..\nevent: ..\ndata: <json>\n\n`
// lib/realtime/apply-event.ts (client, pure)
export function applyEvent(data: BootstrapDTO, ev: SseEvent): BootstrapDTO
   // order.created: prepend if id unknown, keep installJob:null/assets:[] from event; order.updated: replace fields but PRESERVE existing installJob and assets; ignore if incoming.version < existing.version
   // job.*: find order by doc.orderId; set installJob = doc unless existing.version > doc.version
   // asset.*: upsert into that order's assets by id (replace when found, append when new); ignore if order unknown
   // must return a new object when changed and the SAME object when nothing changed (so React Query can skip re-renders)
export function shouldToastNewJob(prev: BootstrapDTO, ev: SseEvent, persona: Persona): boolean  // installer persona && ev.type==='job.created'
```

- [ ] **Step 1: Failing tests** — `dto.test.ts`: normalise converts a fake ObjectId `{ toHexString: () => 'abc' }`, a Date, a bigint, `_id` rename, nested arrays; `toOrderDTO` on a Prisma-shaped object with `installJob` CLAIMED expired → `installJob.status === 'OPEN'`; `sizeBytes` bigint → number. `events.test.ts`: insert on `Order` → `order.created`; update on `InstallJob` → `job.updated` with lazy expiry applied; delete → null; unknown collection → null; `formatSse` output exact string. `apply-event.test.ts`: the six event types plus the version-ignore rule, the preserve-installJob/assets rule, identity return when unchanged, `shouldToastNewJob`.
- [ ] **Step 2: Run** — fails. **Step 3: Implement.** **Step 4: Run** — green. **Step 5: Commit** — `git commit -m "feat(realtime): DTO normalisation, change-stream to SSE mapping, client cache patching"`.

---

### Task 7: Jobs service (claim, verify, lazy release) with the race test

**Files:**
- Create: `lib/services/jobs.ts`
- Test: `tests/integration/jobs.test.ts`

**Interfaces:**
- Consumes: `prisma`, `toJobDTO`, `claimTtlMs`, `ApiError`.
- Produces:
```ts
export async function claimJob(jobId: string, installerId: string, now = new Date()): Promise<JobDTO>     // 409 CLAIM_TAKEN, 404 NOT_FOUND
export async function verifyJob(jobId: string, installerId: string, outcome: 'pass'|'fail', now = new Date()): Promise<JobDTO>  // 409 CLAIM_EXPIRED | NOT_CLAIMANT, 404
export async function releaseExpired(now = new Date()): Promise<number>   // count released
export async function ensureJobForOrder(orderId: string): Promise<JobDTO> // upsert OPEN job (idempotent)
export async function getJob(jobId: string, now = new Date()): Promise<JobDTO>
```

- [ ] **Step 1: Failing tests** (`beforeEach(resetDb)`, create vendor + order in READY_FOR_INSTALL + job OPEN + 50 installers):
```ts
it('exactly one of 50 concurrent claims wins', async () => {
  const results = await Promise.allSettled(installers.map((i) => claimJob(job.id, i.id)));
  const won = results.filter((r) => r.status === 'fulfilled');
  const lost = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
  expect(won).toHaveLength(1); expect(lost).toHaveLength(49);
  expect(lost.every((r) => r.reason instanceof ApiError && r.reason.code === 'CLAIM_TAKEN')).toBe(true);
  const db = await prisma.installJob.findUniqueOrThrow({ where: { id: job.id } });
  expect(db.status).toBe('CLAIMED'); expect(db.claim?.installerId).toBe((won[0] as PromiseFulfilledResult<JobDTO>).value.claim!.installerId);
});
it('an expired claim can be re-claimed by another installer'...)   // set claim.expiresAt = now-1s via prisma.installJob.update, then claimJob(other) succeeds and claim.installerId = other
it('getJob reports an expired claim as OPEN without writing'...)  // lazy view
it('verify fail reopens, verify pass assigns, later claim on ASSIGNED is 409'...)
it('verify by a non-claimant is NOT_CLAIMANT, verify after expiry is CLAIM_EXPIRED'...)
it('releaseExpired flips only expired claims and bumps version'...)
it('ensureJobForOrder is idempotent'...)
```
- [ ] **Step 2: Run** `pnpm test:integration` — fails.
- [ ] **Step 3: Implement**:
```ts
export async function claimJob(jobId, installerId, now = new Date()) {
  const expiresAt = new Date(now.getTime() + claimTtlMs(process.env));
  const res = await prisma.installJob.updateMany({
    where: { id: jobId, OR: [{ status: 'OPEN' }, { status: 'CLAIMED', claim: { is: { expiresAt: { lt: now } } } }] },
    data: { status: 'CLAIMED', claim: { installerId, claimedAt: now, expiresAt }, installerId: null, version: { increment: 1 } },
  });
  if (res.count !== 1) {
    const exists = await prisma.installJob.findUnique({ where: { id: jobId } });
    throw exists ? new ApiError(409, 'CLAIM_TAKEN') : new ApiError(404, 'NOT_FOUND');
  }
  return getJob(jobId, now);
}
```
If Prisma rejects the composite `claim: { is: ... }` filter at runtime, use the documented fallback: `prisma.$runCommandRaw({ findAndModify: 'InstallJob', query: { _id: { $oid: jobId }, $or: [{ status: 'OPEN' }, { status: 'CLAIMED', 'claim.expiresAt': { $lt: { $date: now.toISOString() } } }] }, update: { $set: {...}, $inc: { version: 1 } }, new: true })` and check `value !== null`. Record which one was used in the README (Task 19). `verifyJob`: `updateMany` with `where: { id, status: 'CLAIMED', claim: { is: { installerId, expiresAt: { gt: now } } } }`; pass → `{ status: 'ASSIGNED', installerId, claim: { unset: true }, version: +1 }`; fail → `{ status: 'OPEN', claim: { unset: true }, version: +1 }`; on `count !== 1` read the job: not found → 404; `status !== 'CLAIMED' || !claim || claim.expiresAt <= now` → `CLAIM_EXPIRED`; else `NOT_CLAIMANT`. `releaseExpired`: `updateMany({ where: { status: 'CLAIMED', claim: { is: { expiresAt: { lt: now } } } }, data: { status: 'OPEN', claim: { unset: true }, version: { increment: 1 } } })`. `ensureJobForOrder`: `upsert({ where: { orderId }, update: {}, create: { orderId, status: 'OPEN' } })`.
- [ ] **Step 4: Run** — green (the 50-way race must pass 3 runs in a row: `for i in 1 2 3; do pnpm test:integration -- jobs; done`).
- [ ] **Step 5: Commit** — `git commit -m "feat(jobs): atomic claim, verify, lazy release with 50-way race test"`.

---

### Task 8: Orders service and bootstrap

**Files:**
- Create: `lib/services/orders.ts`, `lib/services/bootstrap.ts`
- Test: `tests/integration/orders.test.ts`, `tests/integration/bootstrap.test.ts`

**Interfaces:**
- Consumes: `checkTransition`, `fromVerdict`, `ensureJobForOrder`, `releaseExpired`, `toOrderDTO`, `actorTypeOf/actorIdOf`.
- Produces:
```ts
export async function createOrder(input: CreateOrderInput, persona: Persona): Promise<OrderDTO>   // ops only (403 otherwise); orderNumber = 'SC-' + zero-padded (count+1), retry once on unique collision; history [{from:null,to:'DRAFT',actorType:'OPS'}]
export async function transitionOrder(id: string, body: TransitionInput, persona: Persona, now = new Date()): Promise<OrderDTO>
export async function getOrderDTO(id: string, now = new Date()): Promise<OrderDTO>   // 404
export const ORDER_INCLUDE = { installJob: true, assets: { orderBy: { createdAt: 'asc' } } } as const;
// bootstrap.ts
export async function getBootstrap(now = new Date()): Promise<BootstrapDTO>   // releaseExpired() first; vendors/installers sorted by name; orders sorted createdAt desc
```
`transitionOrder` algorithm: load order with include (404 if missing); `hasUploadedAsset = assets.some(status==='UPLOADED')`; `verdict = checkTransition(persona, ctx, body.to, now)`; if not ok throw `fromVerdict(verdict, {from: order.status, to})`; `expectedVersion = body.expectedVersion ?? order.version`; `updateMany({ where: { id, status: order.status, version: expectedVersion }, data: { status: to, version: {increment:1}, history: { push: { from: order.status, to, actorType: actorTypeOf(persona), actorId: actorIdOf(persona), reason: body.reason ?? null, at: now } } } })`; `count !== 1` → `ApiError(409,'VERSION_CONFLICT')`; if `to === 'READY_FOR_INSTALL'` → `ensureJobForOrder(id)`; return `getOrderDTO(id, now)`.

- [ ] **Step 1: Failing tests**: create as ops returns DRAFT with `orderNumber` matching `/^SC-\d{4}$/` and one history entry; create as vendor → 403; DRAFT→SUBMITTED without asset → 400 GUARD_FAILED `reason NO_UPLOADED_ASSET`; with an UPLOADED asset → 200 and history has 2 entries, version 1; DRAFT→IN_PRODUCTION → 400 INVALID_TRANSITION with `details.allowed = ['SUBMITTED','CANCELLED']`; stale `expectedVersion` → 409 VERSION_CONFLICT; IN_PRODUCTION→READY_FOR_INSTALL by owner vendor creates an OPEN job (`installJob.status === 'OPEN'`), and calling it again on the same order (now READY) → 400 INVALID_TRANSITION with the job untouched; READY→COMPLETED by the assigned installer works after `claimJob` + `verifyJob('pass')`; by another installer → 403; cancel from IN_PRODUCTION → 400; `getBootstrap` returns 3 arrays and `serverTime`, and reports an expired claim as OPEN and has actually released it in the DB.
- [ ] **Step 2: Run** — fails. **Step 3: Implement.** **Step 4: Run** — green. **Step 5: Commit** — `git commit -m "feat(orders): create, guarded transitions, job side effect, bootstrap"`.

---

### Task 9: Assets service (multipart lifecycle) with mocked storage

**Files:**
- Create: `lib/services/assets.ts`
- Test: `tests/integration/assets.test.ts` (uses `vi.mock('@/lib/storage/r2')`)

**Interfaces:**
- Consumes: `storage`, `storageKeyFor`, `planParts`, `checkUpload`.
- Produces:
```ts
export async function createAsset(input: CreateAssetInput, persona: Persona): Promise<{ asset: AssetDTO; uploadId: string; partSize: number; partCount: number }>
   // 403 unless ops; 404 order; checkUpload(persona, order.status) → 400 GUARD_FAILED ORDER_NOT_UPLOADABLE; create Asset PENDING (storageKey computed after id known: create then update), storage.createMultipart, save uploadId, status UPLOADING
export async function presignParts(assetId: string, partNumbers: number[]): Promise<{ partNumber: number; url: string }[]>  // 404 if missing; asset must be PENDING|UPLOADING else ApiError(409,'VERSION_CONFLICT', { status: asset.status })
export async function reportProgress(assetId: string, bytesUploaded: number): Promise<void>   // update bytesUploaded (BigInt), progressPct = min(100, floor(bytes*100/size)); no-op unless UPLOADING
export async function completeAsset(assetId: string, parts: {partNumber:number; etag:string}[]): Promise<AssetDTO>  // storage.completeMultipart; on STORAGE_ERROR set FAILED and rethrow; success → UPLOADED, bytesUploaded=size, pct 100, uploadId null
export async function abortAsset(assetId: string): Promise<void>   // storage.abortMultipart (ignore errors), status ABORTED, uploadId null; no-op if already terminal
```
- [ ] **Step 1: Failing tests** with `vi.mock('@/lib/storage/r2', () => ({ storage: { createMultipart: vi.fn(async () => ({ uploadId: 'u1' })), presignPart: vi.fn(async (_k,_u,n) => `https://r2.example/part/${n}`), completeMultipart: vi.fn(async () => {}), abortMultipart: vi.fn(async () => {}) }, storageKeyFor: (o,a,f) => `orders/${o}/${a}/${f}` }))`: create on DRAFT returns partCount 103 for 1 GiB and asset UPLOADING with `uploadId 'u1'`; create on IN_PRODUCTION → 400 ORDER_NOT_UPLOADABLE; create as vendor → 403; presign returns 3 urls; progress sets pct 50 for half the bytes; complete → UPLOADED and `completeMultipart` called with sorted parts; complete when storage throws `ApiError(502,'STORAGE_ERROR')` → asset FAILED and error rethrown; abort → ABORTED and `abortMultipart` called.
- [ ] **Step 2: Run** — fails. **Step 3: Implement.** **Step 4: Run** — green. **Step 5: Commit** — `git commit -m "feat(assets): presigned multipart lifecycle with progress"`.

---

### Task 10: Route handlers and the SSE endpoint

**Files:**
- Create: all `app/api/**/route.ts` listed in the file structure, `lib/realtime/sse.ts`
- Test: `tests/integration/routes.test.ts` (calls the exported `POST`/`GET` functions with `new Request(...)`), `tests/integration/sse.test.ts`

**Interfaces:**
- Consumes: services, `withErrorHandling`, `requireKind`, `parseBody`, `json`, `changeToEvent`, `formatSse`, `getMongoDb`.
- Produces: the HTTP API from arch spec §8, and `createSseStream(opts)`.

Pattern for every handler (example `app/api/orders/[id]/transition/route.ts`):
```ts
import { withErrorHandling } from '@/lib/api/errors';
import { requirePersona } from '@/lib/api/persona';
import { parseBody } from '@/lib/api/validate';
import { json } from '@/lib/api/respond';
import { transitionSchema } from '@/lib/domain/schemas';
import { transitionOrder } from '@/lib/services/orders';
export const runtime = 'nodejs';
export const POST = withErrorHandling(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const persona = requirePersona(req);
  const body = await parseBody(req, transitionSchema);
  return json(await transitionOrder(id, body, persona));
});
```
Route table: `GET /api/bootstrap` (`dynamic='force-dynamic'`, `json(await getBootstrap())`); `POST /api/orders` → 201; `POST /api/orders/[id]/transition`; `POST /api/jobs/[id]/claim` (`requireKind(req,'installer')` → `claimJob(id, persona.id)`); `POST /api/jobs/[id]/verify`; `POST /api/assets` → 201 `{ asset, uploadId, partSize, partCount }`; `POST /api/assets/[id]/parts` → `{ urls }`; `POST /api/assets/[id]/progress` → 204; `POST /api/assets/[id]/complete` → asset; `POST /api/assets/[id]/abort` → 204. Persona for asset routes: `requireKind(req,'ops')`.

`lib/realtime/sse.ts`:
```ts
export interface SseDeps { watch: (resumeToken: string | null) => AsyncIterable<ChangeLike> & { close(): Promise<void> }; now: () => Date; heartbeatMs?: number; maxAgeMs?: number }
export function createSseStream(deps: SseDeps, resumeToken: string | null, signal: AbortSignal): ReadableStream<Uint8Array>
   // on start: write `: connected\n\n`; iterate changes → changeToEvent → formatSse; heartbeat `: hb\n\n` every heartbeatMs; after maxAgeMs write `event: reconnect\ndata: {}\n\n` and close; on watch error whose message includes 'resume' or code 280/286 (ChangeStreamHistoryLost / invalid resume token) → write `event: resync\ndata: {}\n\n` and restart watch(null); on signal abort → close cursor and controller
```
`app/api/events/route.ts`:
```ts
export const runtime = 'nodejs'; export const dynamic = 'force-dynamic'; export const maxDuration = 300;
export async function GET(req: Request) {
  await releaseExpired();
  const url = new URL(req.url);
  const token = req.headers.get('last-event-id') ?? url.searchParams.get('after');
  const db = await getMongoDb();
  const watch = (resume: string | null) => db.watch(
    [{ $match: { 'ns.coll': { $in: ['Order', 'InstallJob', 'Asset'] }, operationType: { $in: ['insert', 'update', 'replace'] } } }],
    { fullDocument: 'updateLookup', ...(resume ? { resumeAfter: { _data: resume } } : {}) });
  const stream = createSseStream({ watch: (r) => watch(r) as never, now: () => new Date() }, token, req.signal);
  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' } });
}
```
The driver's `ChangeStream` is async-iterable and has `close()`; wrap it so the `watch` dependency shape matches.

- [ ] **Step 1: Failing tests.** `routes.test.ts`: `POST /api/orders` with `x-persona: ops` → 201 body has `orderNumber`; without persona → 403 `FORBIDDEN_FOR_PERSONA`; transition DRAFT→IN_PRODUCTION → 400 with `error.details.allowed`; claim with `x-persona: ops` → 403; full claim→verify→complete via handlers; `POST /api/assets/:id/progress` → 204; malformed JSON → 400 VALIDATION_ERROR. `sse.test.ts` (unit-style, fake `watch` that yields two canned changes then hangs; fake timers): the stream emits `: connected`, two frames with `id:` and `event:`, a heartbeat after 15 s, and `event: reconnect` after `maxAgeMs`; aborting the signal calls `close()`. Plus one real integration test: open the stream against the Docker Mongo, insert a Vendor-free `InstallJob` update via Prisma, read the stream with a reader and assert a `job.updated` frame arrives within 5 s.
- [ ] **Step 2: Run** — fails. **Step 3: Implement.** **Step 4: Run** `pnpm test && pnpm test:integration && pnpm typecheck` — green. Also smoke-test by hand: `pnpm dev`, then `curl -N http://localhost:3000/api/events` in one shell and `curl -X POST -H 'x-persona: ops' -H 'content-type: application/json' localhost:3000/api/orders -d '{...}'` in another → an `order.created` frame appears.
- [ ] **Step 5: Commit** — `git commit -m "feat(api): route handlers and SSE change-stream endpoint"`.

---

### Task 11: App shell — providers, persona, query hooks, realtime hook, header, page

**Files:**
- Create: `lib/persona/cookie.ts`, `lib/persona/persona-context.tsx`, `lib/query/keys.ts`, `lib/query/api-client.ts`, `lib/query/hooks.ts`, `lib/realtime/use-realtime.ts`, `components/providers.tsx`, `components/dashboard.tsx`, `components/layout/app-header.tsx`, `components/layout/persona-switcher.tsx`, `components/layout/connection-indicator.tsx`, `components/layout/status-summary-pills.tsx`
- Modify: `app/layout.tsx` (Toaster), `app/page.tsx`
- Test: `tests/unit/query/api-client.test.ts` (header injection + error parsing), `tests/unit/realtime/use-realtime-state.test.ts` (the pure connection state reducer)

Visual reference: `docs/design/screens/1a-desktop-board-ops.html` header block (56 px, white, `#E2E8F0` bottom border, wordmark 16 px/700 tracking -0.02em, "Ops console" 11 px `#94A3B8`, count pills `#F1F5F9` with 6 px dots, connection dot + label, persona chip with 24 px round avatar initials, teal primary button `#0D9488`). Use Shadcn `Button`, `DropdownMenu`, `Tooltip`, `Badge`; check `mcp__Shadcn_UI__get_component_demo` for `dropdown-menu` before writing the switcher.

**Interfaces:**
- Produces:
```ts
// lib/persona/cookie.ts
export const PERSONA_COOKIE = 'sc_persona';
export function readPersonaCookie(): string | null;  export function writePersonaCookie(v: string): void;  // document.cookie, path=/, max-age 1y, SameSite=Lax
// lib/persona/persona-context.tsx
export function PersonaProvider({ initial, children }: { initial: Persona; children: ReactNode })
export function usePersona(): { persona: Persona; setPersona: (p: Persona) => void }
// lib/query/keys.ts
export const keys = { bootstrap: ['bootstrap'] as const };
// lib/query/api-client.ts
export class ApiClientError extends Error { status: number; code: string; details?: Record<string, unknown> }
export async function api<T>(path: string, init: { method?: string; body?: unknown; persona: Persona }): Promise<T>   // sets content-type + x-persona; parses {error} into ApiClientError; 204 → undefined
// lib/query/hooks.ts
export function useBootstrap(initialData: BootstrapDTO): UseQueryResult<BootstrapDTO>     // staleTime Infinity; refetchInterval controlled by realtime status (see useRealtime)
export function useCreateOrder(); useTransition(); useClaim(); useVerify(); useCreateAsset(); useAbortAsset()   // useMutation wrappers; on success each patches the cache via applyEvent-style helpers: setOrder(dto) / setJob(dto) / setAsset(dto); on ApiClientError with status 409 invalidate keys.bootstrap
export function setOrderInCache(qc, order: OrderDTO), setJobInCache(qc, job), setAssetInCache(qc, asset)   // reuse applyEvent with synthetic events
// lib/realtime/use-realtime.ts
export type ConnectionStatus = 'connecting' | 'live' | 'reconnecting' | 'degraded';
export function reduceConnection(s: { status: ConnectionStatus; failures: number }, action: 'open' | 'error' | 'reconnect'): { status: ConnectionStatus; failures: number }
   // open → live,0; error → failures+1; status = failures >= DEGRADED_AFTER_FAILURES ? 'degraded' : 'reconnecting'; reconnect → keep failures, 'reconnecting'
export function useRealtime(): ConnectionStatus
   // EventSource(`/api/events${lastId ? `?after=${lastId}` : ''}`); listen to the six event names + 'reconnect' + 'resync'; each data → applyEvent into keys.bootstrap cache (skip no-op identity); remember e.lastEventId; 'reconnect' → close and reopen with ?after=; 'resync' → invalidate bootstrap; on onerror → reduce 'error'; when status becomes degraded set refetchInterval DEGRADED_POLL_MS on the bootstrap query (qc.setQueryDefaults or a state flag consumed by useBootstrap) and when back to live invalidate once and clear the interval; installer persona toasts 'A new job is open for installers' on job.created (shouldToastNewJob)
```
`components/dashboard.tsx` props: `{ initialData: BootstrapDTO; initialPersona: Persona }`. Holds `selectedOrderId` state, renders `AppHeader`, then a placeholder board area (`<KanbanBoard>` arrives in Task 12; until then render a simple list of order numbers so the page works). Exposes `useSelectedOrder()` via context? Keep it simple: pass `onOpenOrder(id)` down and `selectedOrderId` to the sheet (Task 13).

`app/page.tsx`:
```tsx
import { cookies } from 'next/headers';
import { getBootstrap } from '@/lib/services/bootstrap';
import { parsePersona } from '@/lib/domain/personas';
import { Dashboard } from '@/components/dashboard';
export const dynamic = 'force-dynamic';
export default async function Page() {
  const [data, jar] = await Promise.all([getBootstrap(), cookies()]);
  const persona = parsePersona(jar.get('sc_persona')?.value) ?? { kind: 'ops' as const };
  return <Dashboard initialData={data} initialPersona={persona} />;
}
```
Header behaviour (UI spec §4.1): pills desktop only (`hidden xl:flex`); persona switcher groups Ops / Vendors / Installers with the hint line; "New order" only for ops (desktop button; on mobile a fixed bottom-right FAB rendered by `Dashboard`); indicator: Live (green `#16A34A`), Reconnecting… (amber pulsing), Polling every 10 s (amber, tooltip "Realtime stream unavailable; falling back to polling").

- [ ] **Step 1: Failing tests** for `api()` (fetch mocked: header present, error body → `ApiClientError` with code) and `reduceConnection` (sequence open, error, error, error → degraded; then open → live).
- [ ] **Step 2: Run** — fails. **Step 3: Implement** everything above; `Providers` creates one `QueryClient` per app instance (`useState(() => new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, refetchOnWindowFocus: false } } }))`) and wraps `PersonaProvider` + `TooltipProvider`; `app/layout.tsx` adds `<Toaster richColors position="bottom-right" />` from `@/components/ui/sonner`.
- [ ] **Step 4: Verify** — `pnpm test`, `pnpm typecheck`, then `pnpm dev` and open `http://localhost:3000` in the in-app browser (`preview_start` name `dev`): header renders, persona switch persists across reload (cookie), indicator shows Live, and creating an order via curl makes the placeholder list update without reload.
- [ ] **Step 5: Commit** — `git commit -m "feat(ui): app shell, persona switcher, query hooks, realtime hook"`.

---

### Task 12: Kanban board, cards, mobile tabs

**Files:**
- Create: `components/board/kanban-board.tsx`, `status-column.tsx`, `collapsed-rail.tsx`, `order-card.tsx`, `mobile-status-tabs.tsx`, `skeleton-card.tsx`, `empty-column.tsx`, `components/jobs/job-chip.tsx`, `components/jobs/claim-countdown.tsx`, `components/uploads/upload-progress-bar.tsx`, `lib/board/visibility.ts`
- Modify: `components/dashboard.tsx` (replace placeholder)
- Test: `tests/unit/board/visibility.test.ts`

Visual reference: `docs/design/screens/1a-desktop-board-ops.html`, `1b-desktop-board-installer.html`, `1g-mobile.html`, `1h-tablet.html`, plus DESIGN.md "Order card", "Status column and rail".

**Interfaces:**
- Produces:
```ts
// lib/board/visibility.ts (pure)
export function visibleOrders(orders: OrderDTO[], persona: Persona): OrderDTO[]     // vendor → own orders; others → all
export function columnMode(status: OrderStatus, persona: Persona, expandedCancelled: boolean): 'column' | 'rail'
   // CANCELLED → rail unless expandedCancelled; installer → rail for everything except READY_FOR_INSTALL and COMPLETED
export function countsByStatus(orders: OrderDTO[]): Record<OrderStatus, number>
export function defaultMobileTab(orders: OrderDTO[], persona: Persona): OrderStatus   // first non-empty status for the persona in ORDER_STATUSES order, else DRAFT
// components
<KanbanBoard orders persona onOpenOrder(id) highlightId />     // desktop/tablet: flex row, gap 12px, overflow-x auto, snap-x on <xl; columns 280px; xl: 6 columns + rail
<StatusColumn status orders onOpenOrder highlightId />          // #F1F5F9 well, radius 8, sticky header (dot, uppercase 11px label tracking .04em, count badge), EmptyColumn when empty
<CollapsedRail status count onExpand? />                        // 40px wide, rotated label, count
<OrderCard order persona onOpen highlight />                    // per DESIGN.md: white, radius 8, 1px #E2E8F0, 12px padding, 3px status stripe left; line1 orderNumber mono 13/600 + "Storefront · 3 pcs" 11px grey; line2 "Customer — Title"; line3 vendor + "Due 24 Sep"; optional UploadProgressBar (first UPLOADING asset) ; JobChip when status READY_FOR_INSTALL or COMPLETED; footer "v3" 10px + overflow (⋯) DropdownMenu listing orderActionsFor(...) (wired in Task 13 via onAction prop; until then hidden); opacity-85 when orderActionsFor returns [] and jobActionsFor has nothing; highlight ring 600ms when order.id === highlightId
<MobileStatusTabs orders persona value onChange />              // scrollable pill tabs with counts
<JobChip job persona installers now />                          // OPEN outline teal "Open for installers"; CLAIMED by other: amber solid "Claimed · Dana K. · 2:41"; CLAIMED by me: "Your claim · 2:41 · Verify" (click → onVerify); ASSIGNED: green "Assigned · Dana K."
<ClaimCountdown expiresAt onExpire />                           // 1s tick, mono, calls onExpire once at 0 (parent invalidates bootstrap)
<UploadProgressBar asset compact? />                            // 4px bar: teal uploading, green complete, red failed, #94A3B8 aborted; label "print_v3.pdf · 64%"
```
`useNow()` hook (in `lib/hooks/use-now.ts`): `Date.now()` re-evaluated every second, shared by chips so one interval drives all countdowns.

Card motion: keep a `prevStatusById` ref in `Dashboard`; when an order's status changes via cache update set `highlightId` for 600 ms. Use `tw-animate-css` `animate-in fade-in slide-in-from-left-2` on the card when it mounts in a new column (key = `${order.id}:${order.status}`).

- [ ] **Step 1: Failing tests** for `visibility.ts` (vendor filtering, installer rails, cancelled rail, counts, default tab).
- [ ] **Step 2: Run** — fails. **Step 3: Implement** the pure module, then the components. Read the reference HTML for exact spacing/colours; use Tailwind arbitrary values where a token is missing (e.g. `text-[11px] leading-4`). Responsive: `<md` → `MobileStatusTabs` + single column list; `md..xl` → horizontal scroll with `snap-x snap-mandatory`, each column `snap-start`; `xl` → all columns visible.
- [ ] **Step 4: Verify** — `pnpm test`, `pnpm typecheck`; in the in-app browser: board shows seeded orders in six columns with the Cancelled rail; switching to a vendor filters; switching to an installer collapses rails; resize to 390 px shows tabs; the seeded READY job shows "Open for installers". Take screenshots at desktop and mobile and compare against `1a` and `1g`.
- [ ] **Step 5: Commit** — `git commit -m "feat(ui): kanban board, order cards, job chips, mobile tabs"`.

---

### Task 13: Order detail sheet, create/transition/cancel dialogs, history

**Files:**
- Create: `components/orders/order-detail-sheet.tsx`, `order-actions.tsx`, `details-grid.tsx`, `history-timeline.tsx`, `create-order-dialog.tsx`, `transition-dialog.tsx`, `components/orders/inline-error.tsx`
- Modify: `components/dashboard.tsx` (sheet + create dialog state, FAB), `components/board/order-card.tsx` (overflow menu → onAction)

Visual reference: `1c-order-detail-sheet.html`, `1e-create-order-dialog.html`, `1f-transition-cancel-claim-simulate-dialogs.html`, DESIGN.md "Detail sheet", "Dialogs".

**Interfaces:**
- Produces:
```ts
<OrderDetailSheet orderId open onOpenChange onAction(order, action) vendors installers persona />   // Shadcn Sheet side="right", w-full sm:w-[90vw] xl:w-[480px]; sections: header (orderNumber mono, status Badge, title, customer), OrderActions, install job panel slot (Task 14 fills; render <JobPanel> import from components/jobs/job-panel when present), DetailsGrid, assets slot (Task 15: <UploadPanel>), HistoryTimeline. Reads the live order from the bootstrap cache by id so realtime updates re-render it.
<OrderActions order persona onAction />          // buttons from orderActionsFor(); disabled ones wrapped in Tooltip with reason; cancel = variant destructive-outline
<DetailsGrid order vendorName />                 // two-column, label-caps 11px labels: Sign type, Size (W × H cm), Quantity, Install address, Due date, Vendor, Notes
<HistoryTimeline history />                      // newest first, 1px vertical rule, status-coloured dots, "Submitted by Ops · 12:04"
<CreateOrderDialog open onOpenChange vendors />  // fields in spec order; Zod validation on blur via createOrderSchema.safeParse per field; Select for signType/vendor; Calendar+Popover for dueDate; submit "Create draft" → useCreateOrder → toast `Order ${orderNumber} created` → highlight new card
<TransitionDialog open onOpenChange order action persona />
   // from → to badges, ACTION_CONSEQUENCE text, Reason field (required when action==='cancel'; destructive styling, copy from UI spec §4.7), Confirm/Back; on ApiClientError render <InlineError error /> with allowed list for INVALID_TRANSITION and a "Refresh order" link (invalidates bootstrap) for 409; dialog stays open on error
<InlineError error: ApiClientError />            // #FEF2F2 panel, 1px #FECACA border, message + details.allowed rendered as labels
```
`Dashboard` wires: card click → `setSelectedOrderId`; card overflow / sheet action → `setPendingAction({orderId, action})` → `TransitionDialog`; FAB/“New order” → `CreateOrderDialog`. Persona switch keeps the sheet open (UI spec §7.8).

- [ ] **Step 1: Failing test** — `tests/unit/orders/history-format.test.ts` for a pure helper `historyLine(t: TransitionDTO, vendors, installers)` → `'Submitted by Ops'`, `'Accepted by Acme Signs'`, `'Completed by Dana K.'`, `'Cancelled by Ops — reason'` (export it from `history-timeline.tsx`'s sibling `lib/domain/history.ts`).
- [ ] **Step 2: Run** — fails. **Step 3: Implement.** **Step 4: Verify** in the browser: create an order (validation on blur, toast, highlight); open sheet; Submit disabled with tooltip on a DRAFT without assets; Submit on SC-0002 succeeds and the card moves; force `curl -X POST .../transition -d '{"to":"IN_PRODUCTION"}'` on a DRAFT → 400 with allowed list; the same from a stale tab shows the inline error; cancel requires a reason; IN_PRODUCTION shows no Cancel anywhere.
- [ ] **Step 5: Commit** — `git commit -m "feat(ui): order detail sheet, create/transition dialogs, history"`.

---

### Task 14: Installer flows — claim dialog, verification dialog, job panel

**Files:**
- Create: `components/jobs/job-panel.tsx`, `components/jobs/claim-dialog.tsx`, `components/jobs/verification-dialog.tsx`, `components/jobs/countdown-ring.tsx`
- Modify: `components/orders/order-detail-sheet.tsx` (render `JobPanel`), `components/jobs/job-chip.tsx` (Verify click opens dialog through an `onVerify` prop), `components/dashboard.tsx` (dialog state)

Visual reference: `1c-order-detail-sheet.html` (job panel "Your claim · 2:41"), `1d-verification-dialog.html`, `1f-...` (claim 409).

**Interfaces:**
- Produces:
```ts
<JobPanel order persona installers onClaim onVerify onComplete />   // only when status READY_FOR_INSTALL or COMPLETED; chip + claimant/assignee + countdown + buttons from jobActionsFor(); Claim disabled tooltip "Claimed by Dana K., releases in 2:41 unless verified"
<ClaimDialog open onOpenChange job onClaimed(job) />               // copy from UI spec §4.8; useClaim; on 409 CLAIM_TAKEN show InlineError "Another installer claimed this job a moment ago." and invalidate bootstrap; on success onOpenChange(false) then open VerificationDialog
<VerificationDialog open onOpenChange job persona />               // <CountdownRing remainingMs totalMs /> (SVG ring, stroke teal → amber (<60s) → red (<30s)), mono countdown 32px; buttons Verify (primary) / Simulate failure (ghost, red text); useVerify('pass') → success state "You're assigned" 800ms then close; 'fail' → close, toast 'Verification failed — job released'; at 0 → terminal state "Claim expired — job returned to marketplace" + Close; closing early keeps the claim ticking (chip shows "Your claim · 2:41 · Verify")
<CountdownRing remainingMs totalMs size=120 />
```
Complete: `onComplete` opens the standard `TransitionDialog` with action `complete`.

- [ ] **Step 1: Failing test** — `tests/unit/jobs/ring.test.ts` for pure `ringColour(remainingMs)` (`> 60_000` teal `#0D9488`, `≤ 60_000` amber `#D97706`, `≤ 30_000` red `#DC2626`) and `ringOffset(remainingMs, totalMs, circumference)`; export both from `lib/domain/ring.ts`.
- [ ] **Step 2: Run** — fails. **Step 3: Implement.** **Step 4: Verify** in two browser tabs (open the app twice with `tabs_create`, set installer Dana in one and Omar in the other): both click Claim on SC-0007 — one gets the verification dialog, the other the inline 409 and a counting chip; close the dialog and set `CLAIM_TTL_MS=20000` in `.env` (restart dev) to watch both chips flip to Open at 0:00; Simulate failure releases instantly; Verify assigns; Complete moves to Completed. Reset `CLAIM_TTL_MS` afterwards.
- [ ] **Step 5: Commit** — `git commit -m "feat(ui): claim and verification dialogs with countdown ring"`.

---

### Task 15: Upload UI — upload panel, asset rows, simulate dialog

**Files:**
- Create: `components/uploads/upload-panel.tsx`, `asset-row.tsx`, `simulate-upload-dialog.tsx`, `lib/upload/use-uploads.tsx` (context holding running `MultipartUploader`s per assetId so the sheet can close and reopen)
- Modify: `components/orders/order-detail-sheet.tsx` (render `UploadPanel`), `components/providers.tsx` (UploadsProvider)

Visual reference: `1f-...html` (simulate dialog), DESIGN.md "Asset row".

**Interfaces:**
- Produces:
```ts
// lib/upload/use-uploads.tsx
export function UploadsProvider({ children })
export function useUploads(): { start(opts: { orderId: string; file?: File; simulatedBytes?: number }): Promise<void>; abort(assetId: string): void; local: Record<string, { bytesUploaded: number; pct: number; bytesPerSecond: number; etaMs: number; state: string }> }
   // start: POST /api/assets (useCreateAsset) → setAssetInCache → build plan (planParts(sizeBytes, partSize from server)) → source = file ? fileSource : simulatedSource → new MultipartUploader({ api: { presign: POST parts, progress: POST progress, complete: POST complete, abort: POST abort }, put: xhrPut, onProgress → local state (UI), onDone → setAssetInCache(server response), onError → toast + cache asset FAILED, onAborted → cache ABORTED })
<UploadPanel order persona />       // list of <AssetRow> (order.assets, newest first) + for ops in UPLOADABLE_STATUSES: "Upload file" (hidden <input type=file>) and "Simulate large file" buttons
<AssetRow asset local? onAbort onRetry />   // filename (mono), formatBytes(size), status Badge (Pending grey / Uploading teal / Uploaded green check / Failed red + Retry / Aborted grey strikethrough), 4px bar, caption "640 MB of 1.0 GB · 12.4 MB/s · 0:31 left" while uploading (local values if present, else server progressPct), "simulated" badge, abort (x) while uploading
<SimulateUploadDialog open onOpenChange onStart(bytes) />   // RadioGroup 100 MB / 1 GB / 2 GB (SIMULATED_SIZES), explanatory copy from UI spec §4.10, Start
```
Retry (UI spec §7.6) starts a fresh asset with the same file/size. Local progress state wins over the server's coarse `progressPct` in the tab that uploads; other tabs render `progressPct` from the SSE-updated cache.

- [ ] **Step 1: Failing test** — `tests/unit/upload/eta.test.ts` for pure `estimate(bytesUploaded, total, startedAt, now)` → `{ bytesPerSecond, etaMs }` (export from `lib/upload/plan.ts`).
- [ ] **Step 2: Run** — fails. **Step 3: Implement.** **Step 4: Verify** in the browser with the real R2 bucket: Simulate 100 MB on a DRAFT → row appears at 0 %, bar climbs, caption shows speed/ETA, card shows the compact bar; open a second tab as Vendor and confirm the bar moves there (SSE); Abort at ~30 % → Aborted in both tabs; run a 1 GB simulation to completion (leave it running while doing other checks) → Uploaded with size; check the object exists with the Cloudflare MCP / `aws s3api list-multipart-uploads` equivalent (`storage` helper script listing `orders/` keys via `ListObjectsV2Command`).
- [ ] **Step 5: Commit** — `git commit -m "feat(ui): upload panel, asset rows, simulated large-file upload"`.

---

### Task 16: Dockerfile and full Compose

**Files:**
- Create: `Dockerfile`, `docker/entrypoint.sh`
- Modify: `docker-compose.yml` (add `app`), `.env.example` (compose note), `README` later

- [ ] **Step 1: `Dockerfile`**
```dockerfile
FROM node:22-alpine AS base
RUN corepack enable && apk add --no-cache openssl libc6-compat
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml ./
COPY prisma ./prisma
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm build

FROM base AS runner
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY package.json pnpm-lock.yaml next.config.ts ./
COPY prisma ./prisma
COPY docker/entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh
EXPOSE 3000
CMD ["./entrypoint.sh"]
```
`docker/entrypoint.sh`:
```sh
#!/bin/sh
set -e
echo "Syncing schema..." && pnpm prisma db push --skip-generate --accept-data-loss
echo "Seeding..." && pnpm db:seed
exec pnpm start
```
(`public/` must exist; create `public/.gitkeep`.) Keep `output: 'standalone'` for Vercel but run `next start` in the container so the Prisma CLI and seed are available without a second image — note this in README.

- [ ] **Step 2: compose `app` service**
```yaml
  app:
    build: .
    ports: ["3000:3000"]
    environment:
      DATABASE_URL: mongodb://mongo:27017/signcraft?directConnection=true
      NEXT_PUBLIC_APP_URL: http://localhost:3000
      R2_ACCOUNT_ID: ${R2_ACCOUNT_ID}
      R2_ACCESS_KEY_ID: ${R2_ACCESS_KEY_ID}
      R2_SECRET_ACCESS_KEY: ${R2_SECRET_ACCESS_KEY}
      R2_BUCKET: ${R2_BUCKET}
      CLAIM_TTL_MS: ${CLAIM_TTL_MS:-180000}
    depends_on:
      mongo: { condition: service_healthy }
```
Because the replica set member is registered as `localhost:27017`, in-container connections must use `directConnection=true` (they do).

- [ ] **Step 3: Verify** — `docker compose up --build -d`, wait, `curl -s localhost:3000/api/bootstrap | head -c 300` returns JSON with 8 orders, `docker compose logs app | tail` shows seed + ready. Then `docker compose down`. Restart `pnpm dev` afterwards for the remaining tasks (port 3000).
- [ ] **Step 4: Commit** — `git commit -m "chore: dockerfile and compose app service with db push + seed on start"`.

---

### Task 17: Browser QA pass against the UI spec flows

**Files:** whatever the fixes touch. Use the in-app browser (`preview_start` name `dev`, `tabs_create` for the second tab, `resize_window` for mobile/tablet).

- [ ] Run every flow from UI spec §7 (7.1 happy path, 7.2 race, 7.3 timeout with `CLAIM_TTL_MS=20000`, 7.4 simulate failure, 7.5 invalid transition via curl and stale tab, 7.6 abort, 7.7 degradation by stopping the change stream: `docker compose stop mongo` for 30 s → indicator goes Reconnecting → Polling; `docker compose start mongo` → Live), 7.8 persona switch with sheet open. Check mobile (390×844) and tablet (1024×768) layouts against `1g`/`1h`.
- [ ] Check the console for errors/warnings (`read_console_messages`) and fix them.
- [ ] Run `pnpm lint && pnpm typecheck && pnpm test && pnpm test:integration && pnpm build`.
- [ ] Commit fixes: `git commit -m "fix(ui): QA fixes from flow walkthrough"`.

---

### Task 18: Deploy — Atlas, Vercel, live URL

- [ ] **Step 1: Atlas.** Ask the user for a `mongodb+srv://` connection string for a database named `signcraft` (they can create a DB user in the Atlas UI; network access `0.0.0.0/0`). With it: `DATABASE_URL=<srv> pnpm db:push && DATABASE_URL=<srv> pnpm db:seed`. Verify with the MongoDB MCP (`atlas-list-clusters`, then `list-databases`/`count` on `signcraft.Order` = 8).
- [ ] **Step 2: Vercel project.** Prefer the Vercel MCP `create_git_project` (team `team_PG59rFFIMSSFe5fvK0aqZyBk`, repo `YosefHershberg/SignCraft`, framework `nextjs`). If the GitHub integration is not installed on Vercel, fall back to `pnpm dlx vercel link` + `pnpm dlx vercel --prod` (asks the user to `vercel login` once). Set env vars (`DATABASE_URL`, `R2_*`, `NEXT_PUBLIC_APP_URL=https://<project>.vercel.app`, `CLAIM_TTL_MS`) via the Vercel dashboard or `vercel env add`; the MCP has no env tool, so tell the user exactly which values to paste if the CLI is unavailable.
- [ ] **Step 3: Fluid compute** is on by default for new projects; confirm in project settings. `maxDuration = 300` is in the route. Build command `pnpm build` (runs `prisma generate`).
- [ ] **Step 4: R2 CORS.** Add the production origin to the bucket CORS `AllowedOrigins` (README already documents the JSON; `https://*.vercel.app` is included).
- [ ] **Step 5: Verify live**: `get_deployment` shows READY; open the URL in the browser; run the race flow once against production; `curl -N https://<url>/api/events` streams `: connected`.
- [ ] **Step 6: Record** the URL in README and commit.

---

### Task 19: Documentation — README, CLAUDE.md, EXPLANATIONS.md

**Files:**
- Rewrite: `README.md` (live URL, quick start with compose, stack, schema, state machine, concurrency lock strategy exactly as implemented incl. which Prisma filter/fallback was used, upload pipeline, realtime, config, trade-offs, QA checklist, repo layout, test commands and what the race test proves)
- Rewrite: `CLAUDE.md` (keep invariants; update commands to the real ones; add "how to run one integration test", the `.env` host URL, the two-tab QA recipe, and the docs/design usage)
- Create: `EXPLANATIONS.md` — one section per requirement in `SignCraft_Task_Specification.md`, each with: the requirement quoted, where it is implemented (file paths), how it works, how to verify (test name or manual step), and known limits. Sections: Tech stack; Single-page dashboard & realtime; Modals; State machine (UI + HTTP 400); Distributed locking & exactly-one-winner; 3-minute auto-release; Direct-to-cloud upload with presigned URLs & progress without polling; Responsiveness; Docker Compose; README requirements; Live deployment.
- Update ADRs if anything changed during implementation (e.g. `directConnection`, non-standalone container).
- [ ] Verify every command in README actually runs (`docker compose up`, `pnpm test`, `pnpm test:integration`).
- [ ] `git commit -m "docs: rewrite README and CLAUDE.md, add EXPLANATIONS.md" && git push`.

---

## Self-review notes

- Spec coverage: state machine (T3/T8/T10/T13), permissions (T3/T8), guards (T3/T8), job side effect (T8), claim atomicity + race test (T7), lazy expiry + sweep + countdown (T3/T7/T8/T10/T12/T14), SSE with resume/heartbeat/reconnect/degraded (T6/T10/T11), upload pipeline incl. simulate, abort, retry, CORS (T5/T9/T15/T18), personas (T3/T4/T11), responsive layouts (T12/T13), Docker (T2/T16), Vercel/Atlas/R2 (T18), README + EXPLANATIONS (T19).
- Names used consistently: `claimJob/verifyJob/releaseExpired/ensureJobForOrder`, `transitionOrder/createOrder/getOrderDTO/getBootstrap`, `createAsset/presignParts/reportProgress/completeAsset/abortAsset`, `toOrderDTO/toJobDTO/toAssetDTO/normalise`, `changeToEvent/formatSse/applyEvent/createSseStream`, `checkTransition/orderActionsFor/checkUpload/jobActionsFor`, `planParts/partRange/shouldReportProgress/MultipartUploader/xhrPut`, `api/useBootstrap/useRealtime/reduceConnection`, `setOrderInCache/setJobInCache/setAssetInCache`.
