---
name: SignCraft Control Room
colors:
  surface: '#f8fafc'
  surface-dim: '#e2e8f0'
  surface-bright: '#ffffff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f8fafc'
  surface-container: '#f1f5f9'
  surface-container-high: '#e2e8f0'
  surface-container-highest: '#cbd5e1'
  on-surface: '#0f172a'
  on-surface-variant: '#475569'
  inverse-surface: '#1e293b'
  inverse-on-surface: '#f1f5f9'
  outline: '#cbd5e1'
  outline-variant: '#e2e8f0'
  surface-tint: '#0d9488'
  primary: '#0d9488'
  on-primary: '#ffffff'
  primary-container: '#ccfbf1'
  on-primary-container: '#0f766e'
  inverse-primary: '#5eead4'
  secondary: '#2563eb'
  on-secondary: '#ffffff'
  secondary-container: '#dbeafe'
  on-secondary-container: '#1d4ed8'
  tertiary: '#d97706'
  on-tertiary: '#ffffff'
  tertiary-container: '#fef3c7'
  on-tertiary-container: '#b45309'
  error: '#dc2626'
  on-error: '#ffffff'
  error-container: '#fee2e2'
  on-error-container: '#991b1b'
  background: '#f8fafc'
  on-background: '#0f172a'
  surface-variant: '#f1f5f9'
typography:
  page-title:
    fontFamily: Inter
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
    letterSpacing: -0.01em
  card-title:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: '600'
    lineHeight: 18px
  body-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  meta:
    fontFamily: Inter
    fontSize: 11px
    fontWeight: '400'
    lineHeight: 16px
  label-caps:
    fontFamily: Inter
    fontSize: 11px
    fontWeight: '600'
    lineHeight: 16px
    letterSpacing: 0.04em
  numeric:
    fontFamily: JetBrains Mono
    fontSize: 13px
    fontWeight: '500'
    lineHeight: 18px
rounded:
  sm: 0.25rem
  DEFAULT: 0.375rem
  md: 0.5rem
  lg: 0.75rem
  xl: 1rem
  full: 9999px
spacing:
  base: 4px
  xs: 8px
  sm: 12px
  md: 16px
  lg: 24px
  xl: 32px
  card-padding: 12px
  column-width: 280px
  column-gap: 12px
  header-height: 56px
  sheet-width: 480px
---

## Brand & Style

SignCraft is a B2B operations dashboard for a custom-signage marketplace, where ops staff,
sign fabricators and installers all work the same Kanban board. The personality is a
**logistics control room**: dense, calm, factual, built for someone watching many orders at
once rather than reading one page.

The style is strict corporate minimalism with high information density. Chrome is
slate-neutral and recedes; colour is spent almost entirely on order status, so that hue
carries meaning instead of decoration. Nothing is playful, nothing is marketed. Surfaces are
flat, borders are hairlines, and the eye is guided by column structure and status stripes
rather than by size or shadow.

## Colors

The palette is a slate chrome with a teal primary. Teal is the action colour — primary
buttons, focus rings, active uploads, and the "ready for install" status all share it.
Secondary blue and tertiary amber are not decorative: blue means "submitted" and amber means
"in production" or "claimed, counting down".

Seven order statuses each own a dot, a badge and a 3px card stripe:

| Status | Label | Dot / stripe | Badge fill | Badge text |
|---|---|---|---|---|
| DRAFT | Draft | #64748B | #F1F5F9 | #475569 |
| SUBMITTED | Submitted | #2563EB | #DBEAFE | #1D4ED8 |
| VENDOR_ACCEPTED | Accepted | #4F46E5 | #E0E7FF | #4338CA |
| IN_PRODUCTION | In production | #D97706 | #FEF3C7 | #B45309 |
| READY_FOR_INSTALL | Ready for install | #0D9488 | #CCFBF1 | #0F766E |
| COMPLETED | Completed | #16A34A | #DCFCE7 | #15803D |
| CANCELLED | Cancelled | #B91C1C | #FEE2E2 | #991B1B |

Install-job chips sit on cards and in the detail sheet: OPEN is an outlined teal pill
reading "Open for installers"; CLAIMED is a solid #FEF3C7 pill with #B45309 text and a
monospace countdown; ASSIGNED is a solid #DCFCE7 pill with #15803D text.

Upload progress bars are 4px tall on an #E2E8F0 track: teal while uploading, #16A34A when
complete, #DC2626 on failure, #94A3B8 when aborted with the filename struck through.

## Typography

Inter throughout, with JetBrains Mono reserved for anything numeric that must align or be
read at a glance: countdowns, percentages, byte counts and order numbers. Numerals are
tabular everywhere.

The hierarchy is deliberately shallow. Page and dialog titles are 20px; card titles are
13px; body values are 14px; metadata, column headers and field labels are 11px. Column
headers and field labels use the uppercase `label-caps` style with slight tracking, which is
what separates structure from content at this density. Nothing on the board is larger than
20px — there are no hero numbers and no display type.

## Layout & Spacing

The board is a horizontal Kanban of 280px columns with a 12px gap, sitting on a #F8FAFC
page with 16px padding, under a fixed 56px header. Columns are #F1F5F9 wells; cards inside
them are white with 12px padding and 12px between them. The detail sheet is a 480px panel
docked to the right edge on desktop.

Spacing follows a 4px scale, staying tight inside a component (4, 8, 12) and opening up
between groups (16, 24, 32). Density is the point: a reviewer should see six columns and a
dozen orders without scrolling vertically.

Breakpoints: below 768px the board becomes a scrollable pill tab bar over a single card
column and the sheet goes full-screen; 768–1279px shows about two and a half columns with
horizontal scroll and a 90% sheet; 1280px and up shows six columns with Cancelled collapsed
to a narrow vertical rail on the far right.

## Elevation & Depth

Depth comes from tonal layering, not shadow. The page is #F8FAFC, column wells step down to
#F1F5F9, and cards step up to pure white — that three-step stack is the entire elevation
model on the board.

Only two real shadows exist. Cards carry `0 1px 2px rgba(15,23,42,0.06)`. Overlays — the
detail sheet, dialogs and toasts — carry `0 16px 40px rgba(15,23,42,0.16)` above a dark
scrim. Never stack shadow on shadow, and never use blur, glass or gradient to suggest
layering.

## Shapes

The shape language is restrained and grid-aligned. Badges, status chips and pills use a 6px
radius; cards, buttons and inputs use 8px; dialogs and sheets use 12px. Avatars are the only
fully round element. Cards are never pill-shaped, and icons stay at 16px with 1.5px strokes.

## Components

### Order card
White, 8px radius, 1px #E2E8F0 border, 12px padding, with a 3px status-colour stripe down
the left edge. Line 1: order number in bold 13px left, sign type and quantity in 11px grey
right. Line 2: "Customer — Title". Line 3: vendor name and due date in 11px grey. Optional
row: an upload progress bar with its filename and percentage, or an install-job chip.
Footer right: a version like "v3" in 10px grey and a small overflow button. Cards the
current persona cannot act on render at 85% opacity.

### Status column and rail
A #F1F5F9 well with 8px radius and a sticky header of status dot, uppercase 11px label and a
count badge. Empty columns show a dashed 1px #CBD5E1 box with centred 12px grey text. A
collapsed column becomes a 40px rail with rotated label and count.

### Header
White, 56px, 1px bottom border. Wordmark and console name left, small grey count pills
centre, then a 6px connection dot with its label, a persona chip of avatar plus name and
role, and the primary button. The connection dot is green "Live", amber "Reconnecting…", or
amber "Polling every 10 s".

### Detail sheet
A right-docked panel, 12px radius on its left corners, sections divided by 1px hairlines:
header with status badge, action bar, install-job panel, two-column details grid, assets
list, and a history timeline drawn as a 1px vertical rule with status-coloured dots, newest
first.

### Dialogs
12px radius, 24px padding, title 20px, actions right-aligned with a ghost button before the
solid one. Destructive confirmations use a solid #DC2626 button and require a reason field.
Server errors render inline as a #FEF2F2 panel with a 1px #FECACA border, never as a toast.

### Asset row
Filename, size, a status badge and a 4px progress bar, with a caption showing bytes, speed
and ETA while uploading, and a trailing abort or retry control.

### Toasts
Bottom-right on desktop, top on mobile: a 320px white card with a 1px border and a 3px left
accent, green for success and red for failure.

## Do not

No photography, illustrations, stock imagery or empty-state art. No gradients, glass, blur
or glow. No left navigation sidebar. No marketing or hero copy. No emoji. No pill-shaped
cards, no display-size numbers, no purple or pink accents, and no icon larger than 16px.
