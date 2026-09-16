
# SignCraft — UI Pages & Flows (Stitch handoff)

**Date:** 2026-09-16
**Status:** Approved
**Audience:** Stitch (screen design), then the implementer
**Companion docs:** [Architecture](2026-09-16-signcraft-architecture-design.md) · [Decisions](2026-09-16-signcraft-decisions.md)

This document describes every screen, component state, and user flow. It is deliberately implementation-agnostic so a designer can work from it; the component-to-Shadcn mapping at the end is for the implementer.

---

## 1. Product framing

SignCraft is an operations dashboard for a B2B custom-signage marketplace. Three kinds of people use the same screen:

- **Ops** creates orders, uploads print files, submits, cancels.
- **Vendor** (a sign fabricator) accepts submitted orders, moves them through production, marks them ready.
- **Installer** claims ready jobs from a marketplace, verifies, completes the install.

One dashboard, one persona active at a time, switchable from the header. The app must feel *live*: cards move between columns, countdowns tick, progress bars fill, without the user refreshing.

**Tone.** Industrial-clean. Dense but calm. Think logistics control room, not consumer app. Status colour is the main visual language.

## 2. Design tokens (recommendations, not constraints)

| Token | Suggestion |
|---|---|
| Base | Neutral slate / zinc surfaces, light theme default, dark theme supported |
| Type | Inter or Geist; 14 px body, 12 px meta, 20 px page title |
| Radius | 8 px cards, 6 px badges, 12 px dialogs |
| Density | Cards 12–16 px padding; columns 280 px wide on desktop |

**Status colours** (used for column headers, badges, card accent stripe):

| Status | Hue | Label |
|---|---|---|
| DRAFT | Gray | Draft |
| SUBMITTED | Blue | Submitted |
| VENDOR_ACCEPTED | Indigo | Accepted |
| IN_PRODUCTION | Amber | In production |
| READY_FOR_INSTALL | Teal | Ready for install |
| COMPLETED | Green | Completed |
| CANCELLED | Red (muted) | Cancelled |

**Job claim colours** (chip on READY_FOR_INSTALL cards):

| Job state | Chip |
|---|---|
| OPEN | Outline teal "Open for installers" |
| CLAIMED (by someone else) | Solid amber "Claimed · 2:41" (live countdown) |
| CLAIMED (by me) | Solid amber "Your claim · 2:41 · Verify" |
| ASSIGNED | Solid green "Assigned · Dana K." |

**Upload colours:** progress bar teal while uploading, green on complete, red on failed/aborted.

## 3. Breakpoints and layout modes

| Mode | Width | Board layout |
|---|---|---|
| Mobile | < 768 px | Status tabs (horizontally scrollable pills) above a single-column card list. Detail opens as a full-screen sheet. |
| Tablet | 768–1279 px | Kanban with horizontal scroll and scroll-snap per column; 2.5 columns visible. Detail opens as a right sheet, 90 % width. |
| Desktop | ≥ 1280 px | Full Kanban, 6 columns visible, Cancelled collapsed as a thin rail on the far right. Detail opens as a right sheet, 480 px. |

## 4. Screens

### 4.1 App shell (all modes)

**Header** (sticky, 56 px):
- Left: wordmark "SignCraft" + small "Ops console" subtitle.
- Centre (desktop only): summary counts per status as tiny pills ("Draft 2 · Submitted 1 · ...").
- Right: **Connection indicator** (dot + label: Live / Reconnecting / Degraded) and **Persona switcher** (avatar + name + role, dropdown).
- Primary action: "New order" button, visible only for the Ops persona. On mobile it becomes a floating action button bottom-right.

**Persona switcher dropdown:** three groups — Ops (one entry), Vendors (seeded list), Installers (seeded list). Selecting swaps the persona instantly; the board re-filters and action buttons change. A one-line hint at the bottom: "Personas stand in for login in this demo."

**Connection indicator states:**
- Live: green dot, "Live".
- Reconnecting: amber pulsing dot, "Reconnecting…".
- Degraded: amber dot, "Polling every 10 s" with a tooltip explaining SSE is unavailable.

### 4.2 Dashboard board (desktop / tablet)

Columns left to right: Draft, Submitted, Accepted, In production, Ready for install, Completed, then a collapsed **Cancelled** rail (vertical label + count; click expands to a normal column).

**Column header:** status colour dot, label, count badge. Ops sees all orders; Vendor sees only their orders (empty columns show "No orders for you here"); Installer sees only the Ready for install and Completed columns expanded, others collapsed to rails with counts (they cannot act there).

**Order card** (the central component):
```
┌─────────────────────────────────────────┐
│▌ SC-0042            Storefront · 3 pcs   │  ← accent stripe = status colour
│  Riverside Bakery — Fascia sign          │  ← customer — title
│  Vendor: Acme Signs   Due 24 Sep         │
│  [upload bar 64 % · print_v3.pdf]        │  ← only while an upload is active
│  [Claimed · 2:41]  or  [Open]  ...       │  ← only in Ready for install
│                                   v3 ⋯   │  ← version (subtle), overflow menu
└─────────────────────────────────────────┘
```
- Whole card is clickable → detail sheet.
- When a card changes column via a realtime event, it animates: fade out of old column, slide into new, brief highlight ring (600 ms).
- Cards the current persona cannot act on are slightly muted (opacity 0.85) but still openable.
- Overflow menu (⋯) lists the same actions as the detail sheet, for speed.

**Empty column:** dashed placeholder "Nothing here yet".

**Loading:** skeleton cards (3 per column) on first paint; realtime reconnects never show skeletons.

### 4.3 Dashboard (mobile)

- Status tabs as horizontally scrollable pills with counts; default tab is the first non-empty status for the persona.
- Card list, full width, same card anatomy but the vendor/due row wraps.
- FAB "＋" for Ops.
- Pull-to-refresh is not needed; the connection indicator lives in the header as a dot only.

### 4.4 Order detail sheet

Right sheet (desktop/tablet) or full-screen (mobile). Sections top to bottom:

1. **Header:** order number, status badge, title, customer. Close button.
2. **Actions bar:** the persona-specific primary action (see §6) plus a secondary Cancel when allowed. Disabled actions show the reason on hover/tap ("Needs at least one uploaded file").
3. **Details grid:** sign type, size (W × H cm), quantity, install address, due date, vendor, notes.
4. **Install job panel** (only when status is Ready for install or Completed): job state chip, claimant/assignee, countdown when claimed, and the installer actions (Claim / Verify / Complete).
5. **Assets panel:** list of assets with name, size, status badge, progress bar (live), and per-asset Abort (while uploading). For Ops in Draft/Submitted: "Upload file" and "Simulate large file" buttons.
6. **History timeline:** vertical list, newest first: "Submitted by Ops · 12:04", "Accepted by Acme Signs · 12:20", each with the status colour dot.

### 4.5 Create Order dialog (Ops)

Fields, in order: Title, Customer name, Sign type (select), Width cm, Height cm, Quantity, Vendor (select), Install address, Due date (date picker), Notes (textarea, optional). Validation inline on blur; submit button "Create draft". On success: dialog closes, new card appears in Draft with the highlight ring, toast "Order SC-0043 created".

### 4.6 Transition confirm dialog (all personas)

Opened by any state-change action. Shows: from → to badges, a one-line consequence ("The vendor will be notified" / "The job will be posted to installers"), optional Reason field (required for Cancel), Confirm and Back buttons. If the server returns 400/409, the dialog stays open and renders the error inline (e.g. "Cannot move Draft to In production. Allowed: Submitted, Cancelled") with a "Refresh order" link on 409.

### 4.7 Cancel confirm dialog

Destructive variant of 4.6: red confirm button, Reason required, text "Orders cannot be cancelled once production starts. This one is still in Submitted, so cancelling is allowed."

### 4.8 Claim job dialog (Installer)

Compact confirm: "Claim this job? You'll have 3 minutes to verify your identity and payment details, otherwise it returns to the marketplace." Buttons: Claim, Back. On 409 (someone else won the race): inline "Another installer claimed this job a moment ago." and the card chip updates to Claimed by them.

### 4.9 Verification dialog (Installer, after a successful claim)

The centrepiece of the concurrency demo.
- Large countdown "2:58" in monospace, ring progress around it draining from teal to amber to red in the final 30 s.
- Copy: "Verify identity and payment to lock in this job."
- Two buttons: **Verify** (primary) and **Simulate failure** (ghost, red text).
- Closing the dialog is allowed; the claim keeps ticking on the card ("Your claim · 2:41 · Verify" chip reopens it).
- At 0:00: dialog switches to a terminal state "Claim expired — job returned to marketplace" with a Close button; the card chip flips to Open.
- On Verify: brief success state "You're assigned" then closes; card chip becomes Assigned.
- On Simulate failure: closes immediately, toast "Verification failed — job released", chip Open.

### 4.10 Upload panel and Simulate dialog (Ops)

- **Upload file:** native file picker. After selection the asset row appears immediately at 0 % with "Starting…", then the progress bar animates. Shows MB uploaded / total, speed, ETA. Abort button (x) on the row.
- **Simulate large file dialog:** radio 100 MB / 1 GB / 2 GB, explanatory text "Generates a synthetic file in the browser and uploads it through the same presigned multipart pipeline. No real file needed.", Start button.
- Asset row states: Pending (grey), Uploading (teal bar), Uploaded (green check, file size), Failed (red, Retry), Aborted (grey strikethrough).
- Other tabs/personas see the same bar moving on the card and in the sheet.

### 4.11 Toasts

Bottom-right (desktop), top (mobile). Success green, error red with the server `message`. Realtime events for *other* people's actions do not toast (the board motion is the notification), except one: for the Installer persona, "A new job is open for installers" when a job appears.

## 5. Component inventory

| Component | Where | Notes |
|---|---|---|
| AppHeader | shell | contains ConnectionIndicator, PersonaSwitcher, NewOrderButton |
| PersonaSwitcher | header | grouped dropdown |
| ConnectionIndicator | header | 3 states |
| StatusSummaryPills | header (desktop) | counts |
| KanbanBoard / StatusColumn / CollapsedRail | board | horizontal scroll on tablet |
| MobileStatusTabs | board (mobile) | scrollable pills |
| OrderCard | board | accent stripe, chips, progress |
| JobChip + ClaimCountdown | card, sheet | live countdown |
| UploadProgressBar | card, sheet | teal/green/red |
| OrderDetailSheet | overlay | six sections |
| CreateOrderDialog | overlay | form |
| TransitionDialog / CancelDialog | overlay | inline errors |
| ClaimDialog | overlay | 409 handling |
| VerificationDialog | overlay | countdown ring, pass/fail |
| SimulateUploadDialog | overlay | size radio |
| AssetRow | sheet | states, abort/retry |
| HistoryTimeline | sheet | |
| EmptyState / SkeletonCard | board | |

**Shadcn mapping:** Sheet (detail), Dialog (all modals), DropdownMenu (persona, overflow), Select, Input, Textarea, Calendar + Popover (date), Badge (status/chips), Progress (upload), Tabs (mobile), Tooltip (disabled reasons), Skeleton, `sonner` (toasts), Button variants (default / destructive / ghost / outline).

## 6. Actions by persona and state

| Order status | Ops | Vendor (owner) | Installer |
|---|---|---|---|
| DRAFT | Upload, Simulate upload, Submit (needs uploaded asset), Cancel | — | — |
| SUBMITTED | Upload, Simulate upload, Cancel | Accept, Cancel | — |
| VENDOR_ACCEPTED | Cancel | Start production, Cancel | — |
| IN_PRODUCTION | — | Mark ready for install | — |
| READY_FOR_INSTALL | — | — | Claim (if job OPEN or expired) · Verify / Simulate failure (if my claim) · Complete (if assigned to me) |
| COMPLETED | — | — | — |
| CANCELLED | — | — | — |

Buttons for actions not in this table are not rendered. Buttons in the table that fail a guard are rendered disabled with a tooltip reason.

## 7. Flows

### 7.1 Happy path (three personas, one order)

1. **Ops**: New order → fill form → Create draft. Card appears in Draft.
2. **Ops**: open card → Simulate large file (1 GB) → progress bar climbs on the card. Switch persona to a vendor in another tab: the same bar moves there.
3. **Ops**: Submit → Transition dialog → Confirm. Card slides to Submitted.
4. **Vendor (Acme)**: card visible in Submitted → Accept → Confirm. Slides to Accepted.
5. **Vendor**: Start production → Confirm. Slides to In production. Cancel is no longer offered anywhere.
6. **Vendor**: Mark ready for install → Confirm. Slides to Ready for install; chip "Open for installers" appears. Installer tabs get the toast.
7. **Installer (Dana)**: Claim → Confirm → Verification dialog with countdown → Verify. Chip "Assigned · Dana K."
8. **Installer (Dana)**: Complete → Confirm. Slides to Completed. History shows the full trail.

### 7.2 Double-claim race (the concurrency demo)

Two browser tabs, Installer Dana and Installer Omar, same Ready job.
1. Both press Claim within the same second.
2. Exactly one Claim dialog proceeds to the Verification dialog. The other shows the inline 409 message and its card chip updates to "Claimed · Dana · 2:59".
3. Omar's Claim button is disabled while the chip counts down; tooltip "Claimed by Dana K., releases in 2:41 unless verified".

### 7.3 Verification timeout (the fallback demo)

1. Dana claims, closes the Verification dialog without verifying.
2. Both tabs show the chip counting down.
3. At 0:00 both chips flip to "Open for installers"; Omar's Claim button re-enables. Reopening the sheet shows no claimant. History does not record claims (they are job events, not order transitions).
4. Omar claims successfully.

### 7.4 Simulate failure

Same as 7.3 but Dana presses Simulate failure: instant release, toast, both chips Open.

### 7.5 Invalid transition (UI + API)

1. Ops opens a Draft order with no uploaded asset. Submit is disabled with tooltip "Needs at least one uploaded file".
2. Reviewer forces the request (curl `POST /api/orders/:id/transition {"to":"IN_PRODUCTION"}`) → 400 body with allowed list. If sent from the UI via an outdated tab, the Transition dialog shows the same message inline.

### 7.6 Upload abort / failure

1. Ops starts a 2 GB simulated upload, presses Abort at 30 %. Row shows Aborted, card bar disappears in every tab.
2. A failed part after retries marks the row Failed with Retry (Retry starts a fresh asset).

### 7.7 Realtime degradation

Reviewer blocks `/api/events` (devtools). Indicator goes Reconnecting, then Degraded with "Polling every 10 s". Board still updates, just slower. Unblock → Live.

### 7.8 Persona switch mid-view

Switching persona while the sheet is open keeps the sheet open and re-renders its action bar for the new persona. The board re-filters with a quick crossfade.

## 8. Stitch generation notes

Suggested screens to generate, in order:
1. Desktop dashboard, Ops persona, populated board with one active upload and one claimed job.
2. Desktop dashboard, Installer persona (rails collapsed, Ready column prominent).
3. Order detail sheet open over the board (Ready for install, job panel showing "Your claim · 2:41").
4. Verification dialog (countdown ring at 2:41, then a variant at 0:14 in red).
5. Create Order dialog.
6. Transition dialog with an inline 400 error.
7. Mobile dashboard (status tabs) and mobile detail sheet.
8. Tablet board mid-scroll.

Prompt seed for Stitch: "Logistics-style operations dashboard for a custom signage marketplace. Kanban of order statuses with colour-coded columns, compact order cards with accent stripe, live countdown chips and upload progress bars, right-side detail sheet, header with persona switcher and live connection dot. Clean, dense, slate neutrals with status hues (gray, blue, indigo, amber, teal, green, muted red). Light theme."
