# SignCraft — Design System

A B2B operations dashboard for a custom-signage marketplace. Ops, vendors and installers
share one Kanban board. The mood is **logistics control room**: dense, calm, monochrome
chrome with colour reserved almost entirely for status.

## Principles

1. **Status colour is the only decoration.** Chrome is slate/zinc. Hue means state, never emphasis.
2. **Dense but calm.** Small type, tight rows, generous whitespace *between* groups, not inside them.
3. **Flat.** 1px borders and one soft shadow level. No gradients, no glass, no glow.
4. **Data over ornament.** No photography, no illustration, no hero art, no marketing copy.
5. **Numbers are monospaced.** Countdowns, percentages, file sizes and order numbers use tabular figures.

## Colour — surfaces and text (light)

| Token | Hex | Use |
|---|---|---|
| `bg/page` | `#F8FAFC` | app background |
| `bg/column` | `#F1F5F9` | Kanban column well |
| `bg/surface` | `#FFFFFF` | cards, header, sheets, dialogs |
| `bg/subtle` | `#F8FAFC` | table rows, disabled fills |
| `border` | `#E2E8F0` | all 1px hairlines |
| `border/strong` | `#CBD5E1` | inputs, dashed empty states |
| `text/primary` | `#0F172A` | titles, values |
| `text/secondary` | `#475569` | labels, body meta |
| `text/muted` | `#94A3B8` | timestamps, hints, placeholders |
| `focus` | `#0D9488` | focus ring, 2px |

Dark theme (secondary): `bg/page #0B1220`, `bg/column #111827`, `bg/surface #0F172A`,
`border #1E293B`, `text/primary #E2E8F0`, `text/secondary #94A3B8`. Status hues keep the
same names one step lighter.

## Colour — order status

Each status owns a dot, a badge and a 3px card stripe.

| Status | Label | Dot / stripe | Badge fill | Badge text |
|---|---|---|---|---|
| DRAFT | Draft | `#64748B` | `#F1F5F9` | `#475569` |
| SUBMITTED | Submitted | `#2563EB` | `#DBEAFE` | `#1D4ED8` |
| VENDOR_ACCEPTED | Accepted | `#4F46E5` | `#E0E7FF` | `#4338CA` |
| IN_PRODUCTION | In production | `#D97706` | `#FEF3C7` | `#B45309` |
| READY_FOR_INSTALL | Ready for install | `#0D9488` | `#CCFBF1` | `#0F766E` |
| COMPLETED | Completed | `#16A34A` | `#DCFCE7` | `#15803D` |
| CANCELLED | Cancelled | `#B91C1C` | `#FEE2E2` | `#991B1B` (muted, never loud) |

## Colour — install job chips

Small pill, 6px radius, 11px semibold, sits on the card and in the detail sheet.

| Job state | Style | Example text |
|---|---|---|
| OPEN | outline, 1px `#0D9488`, transparent fill, text `#0F766E` | `Open for installers` |
| CLAIMED (someone else) | solid `#FEF3C7`, text `#B45309`, monospace timer | `Claimed · Dana K. · 2:41` |
| CLAIMED (mine) | solid `#FEF3C7`, text `#B45309`, trailing link `Verify` | `Your claim · 2:41 · Verify` |
| ASSIGNED | solid `#DCFCE7`, text `#15803D` | `Assigned · Dana K.` |

## Colour — upload

Progress bar 4px tall, 2px radius, track `#E2E8F0`.
Uploading `#0D9488` · Uploaded `#16A34A` · Failed `#DC2626` · Aborted `#94A3B8` (strikethrough label).

## Typography

Inter throughout; JetBrains Mono for timers, percentages and byte counts.

| Level | Size / weight | Use |
|---|---|---|
| page-title | 20px / 600 | dialog and sheet titles |
| card-title | 13px / 600 | order title, order number |
| body | 14px / 400 | detail values, dialog copy |
| meta | 11px / 400 `text/secondary` | vendor, due date, timestamps |
| label | 11px / 600 uppercase, `0.04em` tracking | column headers, field labels |
| numeric | 13px / 500 JetBrains Mono, tabular | `2:41`, `64%`, `1.2 GB` |

## Shape, spacing, elevation

Radius: cards & inputs 8px, badges & chips 6px, dialogs & sheets 12px, avatars full.
Spacing scale: 4 / 8 / 12 / 16 / 24 / 32. Card padding 12px. Column width 280px, gap 12px.
Header height 56px. Detail sheet 480px wide on desktop.
Shadow: cards `0 1px 2px rgba(15,23,42,.06)`; overlays `0 16px 40px rgba(15,23,42,.16)`.
Borders do the work; never stack shadow on shadow.

## Core components

- **OrderCard** — white, 8px radius, 1px border, 3px status stripe on the left edge.
  Row 1: order number (bold) left, `Storefront · 3 pcs` right in meta.
  Row 2: `Customer — Title` in card-title.
  Row 3: vendor name and `Due 24 Sep` in meta.
  Optional row: upload bar, or a job chip.
  Footer right: `v3` in 10px muted and a `⋯` ghost icon button.
  Cards the current persona cannot act on render at 85% opacity.
- **StatusColumn** — `bg/column` well, 8px radius, sticky header with dot + label + count badge.
  Empty state: dashed `#CBD5E1` box, centred muted text.
- **CollapsedRail** — 40px wide well, vertical rotated label plus count.
- **AppHeader** — white, 1px bottom border; wordmark left, count pills centre,
  connection dot + persona chip + primary button right.
- **ConnectionIndicator** — 6px dot + 11px label: green `Live`, amber `Reconnecting…`, amber `Polling every 10 s`.
- **DetailSheet** — right-edge panel, 12px radius on the left corners, sections divided by 1px hairlines.
- **Dialog** — 12px radius, 24px padding, title 20px, actions right-aligned, destructive action `#DC2626`.
- **AssetRow** — filename, size, status badge, 4px progress bar, trailing ghost icon button.
- **HistoryTimeline** — 1px vertical rule with status-coloured dots, newest first, meta timestamps.
- **Toast** — bottom-right, 320px, white, 1px border, left 3px accent in green or red.

## Do / Don't

**Do** keep every surface flat and light. Do let the board breathe horizontally.
Do use real, specific content strings.
**Don't** add a left navigation sidebar, stock photos, illustrations, gradients, glassmorphism,
pill-shaped cards, emoji, large hero numbers, or purple/pink accents.
