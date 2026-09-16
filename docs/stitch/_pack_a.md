# SignCraft — Stitch Prompt Pack

**Date:** 2026-09-16 · **Source of truth:** [UI Pages & Flows](../superpowers/specs/2026-09-16-signcraft-ui-pages-and-flows.md)
**Companion:** [DESIGN.md](DESIGN.md) — upload this to Stitch as the design system.

This is the UI spec rewritten for a generator that draws **one static screen per text
prompt**. No new design decisions are made here; the spec is re-cut along the axis Stitch
can actually execute.

---

## 1. How Stitch consumes this

Four constraints drove every rewrite in this document:

| Stitch behaviour | Consequence for the prompts |
|---|---|
| One screen per `generate_screen_from_text` call | Every overlay, breakpoint and persona view is its own numbered prompt. |
| Output is a still frame — no motion, no timers, no state machine | Animation and countdowns become **literal frozen values** (`2:41`, `64%`). A moving thing becomes two screens. |
| Renders text literally, and invents filler wherever text is missing | Every string is supplied verbatim. Not "a list of orders" — nine named orders. |
| Conditionals confuse it ("if the job is claimed…") | Each prompt states exactly one persona, one moment, one state. |
| Style drifts between calls unless anchored | Style lives in the design system and `DESIGN.md`; prompts carry a one-line style anchor and then pure content. |

**Order of operations**

1. `create_project` → title `SignCraft`.
2. `create_design_system` with the JSON in §2, then `update_design_system`.
3. `upload_design_md` (base64 of `DESIGN.md`) → `create_design_system_from_design_md`.
4. Generate P0 screens S01–S09 in order, passing `designSystem` on every call.
5. Apply state variants with `edit_screens` (§6). Use `generate_variants` only for
   exploration — it drifts from the spec.

Generation takes minutes per screen. On timeout, poll `get_screen`; do not retry the call.

---

## 2. Design system parameters

`create_design_system` payload:

```json
{
  "displayName": "SignCraft Control Room",
  "theme": {
    "colorMode": "LIGHT",
    "colorVariant": "NEUTRAL",
    "headlineFont": "INTER",
    "bodyFont": "INTER",
    "labelFont": "INTER",
    "roundness": "ROUND_EIGHT",
    "customColor": "#0D9488",
    "overridePrimaryColor": "#0D9488",
    "overrideSecondaryColor": "#2563EB",
    "overrideTertiaryColor": "#D97706",
    "overrideNeutralColor": "#64748B"
  }
}
```

Teal is the seed colour because it carries both the "ready for install" status and every
active-upload affordance. `NEUTRAL` keeps the chrome grey so the seven status hues stay
legible against it. `LIGHT` is the primary theme; the dark pass is §7.

---

## 3. Canonical display set

Every prompt draws from this one dataset. Using it verbatim is what makes nine
independently generated screens look like one product.

| Order | Customer — Title | Type · Qty | Vendor | Due | Status |
|---|---|---|---|---|---|
| SC-0046 | Summit Auto Group — Pylon refit | Monument · 1 pc | Northline Fabrication | 3 Oct | Draft |
| SC-0045 | Orchard Street Market — Window graphics set | Storefront · 4 pcs | Vantage Wraps | 30 Sep | Draft |
| SC-0044 | Lakeside Brewing — Blade sign | Storefront · 1 pc | Acme Signs | 28 Sep | Submitted |
| SC-0043 | Pinecrest Clinic — Entrance banner | Banner · 2 pcs | Northline Fabrication | 26 Sep | Accepted |
| SC-0041 | Grayson Fitness — Van fleet wrap | Vehicle wrap · 3 pcs | Vantage Wraps | 22 Sep | In production |
| SC-0042 | Riverside Bakery — Fascia sign | Storefront · 3 pcs | Acme Signs | 24 Sep | Ready for install |
| SC-0040 | Harbour Point Mall — Wayfinding pylons | Wayfinding · 6 pcs | Acme Signs | 19 Sep | Ready for install |
| SC-0039 | Cedar & Co. Dental — Monument sign | Monument · 1 pc | Northline Fabrication | 12 Sep | Completed |
| SC-0038 | Tidewater Cafe — Awning lettering | Storefront · 2 pcs | Acme Signs | 10 Sep | Cancelled |

Nine orders, so the header pill row reads "Draft 2" as the spec's example does, and every
status owns at least one card. The seed script may hold more; these nine are the display set.

**Personas.** Ops: Morgan Reyes (MR). Vendors: Acme Signs, Northline Fabrication,
Vantage Wraps. Installers: Dana K., Omar S., Priya N., Luis M.

**Recurring live details.** SC-0045 has an upload in flight: `print_v3.pdf · 64%`.
SC-0040's job is already assigned to Dana K. SC-0042 is the demo order; its job state is
what moves along the timeline below.

### The frozen timeline

Motion in the spec becomes a position on this timeline. Each screen declares its moment.

| Moment | SC-0042 job state | Chip text |
|---|---|---|
| **T0** | OPEN | `Open for installers` (outline teal) |
| **T1** | CLAIMED by Dana, 2:41 left | `Claimed · Dana K. · 2:41`, or `Your claim · 2:41 · Verify` in Dana's own view |
| **T2** | CLAIMED, 0:14 left | same chip, timer in red |
| **T3** | ASSIGNED to Dana | `Assigned · Dana K.` |

---

## 4. The two reusable blocks

Paste **A** at the top and **B** at the bottom of every screen prompt. They are short on
purpose: the design system carries the rest, and repeated style prose crowds out content.

**Block A — style anchor**

> Light-theme B2B operations dashboard for a custom-signage marketplace. Logistics
> control-room feel: dense, flat, slate-neutral chrome with colour used only for status.
> Inter type, 8px radii, 1px #E2E8F0 hairlines, page background #F8FAFC.

**Block B — negative constraints**

> No photography, no illustrations, no icons larger than 16px, no gradients, no glass or
> blur effects, no left navigation sidebar, no marketing or hero copy, no emoji, no
> placeholder lorem text. Every label and value must be exactly the text given above.

---

## 5. P0 screen prompts

Nine prompts in generation order, each a single copy-paste block. `deviceType` per screen.

### S01 · Ops board, moment T1 — `DESKTOP`

```text
Light-theme B2B operations dashboard for a custom-signage marketplace. Logistics control-room feel: dense, flat, slate-neutral chrome with colour used only for status. Inter type, 8px radii, 1px #E2E8F0 hairlines, page background #F8FAFC.

Screen: a Kanban board of signage orders, 1440x900.

Sticky 56px white header with a 1px bottom border. Left: "SignCraft" in bold 16px with "Ops console" under it in 11px grey. Centre: seven small grey count pills reading "Draft 2", "Submitted 1", "Accepted 1", "In production 1", "Ready 2", "Completed 1", "Cancelled 1". Right, in order: a 6px green dot with the label "Live"; a 24px circular avatar with the initials "MR" followed by "Morgan Reyes" and "Ops" in grey and a small chevron; a solid teal #0D9488 button labelled "New order".

Below the header, six columns of 280px on a #F8FAFC background. Each column is a #F1F5F9 well with 8px radius and a header made of a status dot, an uppercase 11px label and a count badge. Far right, a narrow 40px vertical rail with rotated text "Cancelled 1".

Every card is white with 8px radius, a 1px border, 12px padding and a 3px status-colour stripe down its left edge. Card line 1: order number in bold 13px on the left, type and quantity in 11px grey on the right. Line 2: "Customer — Title" in 13px. Line 3: vendor name and due date in 11px grey. Bottom-right of each card: "v3" in 10px grey and a small "..." button.

Columns and cards:
- DRAFT (2), grey dot: "SC-0046 / Monument · 1 pc / Summit Auto Group — Pylon refit / Northline Fabrication / Due 3 Oct". Then "SC-0045 / Storefront · 4 pcs / Orchard Street Market — Window graphics set / Vantage Wraps / Due 30 Sep", which also shows a 4px teal progress bar filled to 64% with the caption "print_v3.pdf · 64%".
- SUBMITTED (1), blue dot: "SC-0044 / Storefront · 1 pc / Lakeside Brewing — Blade sign / Acme Signs / Due 28 Sep".
- ACCEPTED (1), indigo dot: "SC-0043 / Banner · 2 pcs / Pinecrest Clinic — Entrance banner / Northline Fabrication / Due 26 Sep".
- IN PRODUCTION (1), amber dot: "SC-0041 / Vehicle wrap · 3 pcs / Grayson Fitness — Van fleet wrap / Vantage Wraps / Due 22 Sep".
- READY FOR INSTALL (2), teal dot: "SC-0042 / Storefront · 3 pcs / Riverside Bakery — Fascia sign / Acme Signs / Due 24 Sep" with a solid amber pill "Claimed · Dana K. · 2:41" and a 2px teal highlight ring around the whole card. Then "SC-0040 / Wayfinding · 6 pcs / Harbour Point Mall — Wayfinding pylons / Acme Signs / Due 19 Sep" with a solid green pill "Assigned · Dana K.".
- COMPLETED (1), green dot: "SC-0039 / Monument · 1 pc / Cedar & Co. Dental — Monument sign / Northline Fabrication / Due 12 Sep".

No photography, no illustrations, no icons larger than 16px, no gradients, no glass or blur effects, no left navigation sidebar, no marketing or hero copy, no emoji, no placeholder lorem text. Every label and value must be exactly the text given above.
```

### S02 · Installer board, Omar at T1 — `DESKTOP`

```text
Light-theme B2B operations dashboard for a custom-signage marketplace. Logistics control-room feel: dense, flat, slate-neutral chrome with colour used only for status. Inter type, 8px radii, 1px #E2E8F0 hairlines, page background #F8FAFC.

Screen: the same Kanban board seen by an installer, 1440x900. An installer can only act on installation jobs, so most columns are collapsed.

Sticky 56px white header. Left: "SignCraft" bold 16px with "Installer console" under it in 11px grey. Right: a 6px green dot labelled "Live", then a 24px avatar with initials "OS" followed by "Omar S." and "Installer" in grey with a chevron. There is no "New order" button.

Board area: four narrow 40px vertical rails on the left, each a #F1F5F9 well with rotated grey text reading "Draft 2", "Submitted 1", "Accepted 1", "In production 1". To their right, two full 320px columns.

Column "READY FOR INSTALL" with a teal dot and a count badge of 2, holding two white cards with 8px radius, 1px border, 12px padding and a 3px teal stripe on the left edge:
- "SC-0042 / Storefront · 3 pcs / Riverside Bakery — Fascia sign / Acme Signs / Due 24 Sep", with a solid amber pill reading "Claimed · Dana K. · 2:41" where 2:41 is monospaced, and below it a full-width outlined button labelled "Claim" rendered disabled in grey, with a small dark tooltip open above it reading "Claimed by Dana K., releases in 2:41 unless verified".
- "SC-0040 / Wayfinding · 6 pcs / Harbour Point Mall — Wayfinding pylons / Acme Signs / Due 19 Sep", with a solid green pill "Assigned · Dana K.", the whole card at 85% opacity.

Column "COMPLETED" with a green dot and a count badge of 1, holding one card at 85% opacity: "SC-0039 / Monument · 1 pc / Cedar & Co. Dental — Monument sign / Northline Fabrication / Due 12 Sep".

A toast sits in the bottom-right corner: a 320px white card, 1px border, 3px teal left accent, text "A new job is open for installers".

No photography, no illustrations, no icons larger than 16px, no gradients, no glass or blur effects, no left navigation sidebar, no marketing or hero copy, no emoji, no placeholder lorem text. Every label and value must be exactly the text given above.
```

### S03 · Order detail sheet over the board, Dana at T1 — `DESKTOP`

```text
Light-theme B2B operations dashboard for a custom-signage marketplace. Logistics control-room feel: dense, flat, slate-neutral chrome with colour used only for status. Inter type, 8px radii, 1px #E2E8F0 hairlines, page background #F8FAFC.

Screen: 1440x900. A Kanban board of signage order cards is visible behind a dark 20% scrim. A 480px white detail panel is docked to the right edge, full height, 12px radius on its left corners, with a soft shadow. Design the panel in detail; the board behind it is dimmed by the scrim only, not blurred.

Panel contents, top to bottom, separated by 1px hairlines:

1. Header: "SC-0042" in monospace 13px grey, a teal badge reading "Ready for install", the title "Riverside Bakery — Fascia sign" in 20px semibold, "Customer: Riverside Bakery" in 11px grey, and a small close "X" button top-right.

2. Action bar: a solid teal button "Verify claim" and a ghost button with red text "Simulate failure".

3. Install job panel on a #F8FAFC inset: a solid amber pill reading "Your claim · 2:41 · Verify" with 2:41 monospaced, the line "Claimed by you at 12:41" in 11px grey, and a thin amber progress bar about 90% full.

4. Details grid, two columns of label-over-value pairs with 11px uppercase grey labels and 14px values: "Sign type / Storefront", "Size / 320 x 60 cm", "Quantity / 3", "Vendor / Acme Signs", "Due date / 24 Sep 2026", "Install address / 118 Riverside Ave, Unit 2". Below the grid, "Notes / Match the existing awning font; access via rear lane before 9am".

5. Assets panel titled "Assets": two rows. Row one: a small file icon, "print_v3.pdf", "182 MB", a green "Uploaded" badge. Row two: "wrap_proof.ai", "44 MB", a green "Uploaded" badge.

6. History timeline titled "History", newest first, a 1px vertical rule with small status-coloured dots: "Marked ready for install — Acme Signs · 12:38", "Started production — Acme Signs · 11:02", "Accepted — Acme Signs · 10:20", "Submitted — Ops · 10:04", "Created — Ops · 09:47".

No photography, no illustrations, no icons larger than 16px, no gradients, no glass or blur effects, no left navigation sidebar, no marketing or hero copy, no emoji, no placeholder lorem text. Every label and value must be exactly the text given above.
```

### S04 · Verification dialog at 2:41 — `DESKTOP`

```text
Light-theme B2B operations dashboard for a custom-signage marketplace. Logistics control-room feel: dense, flat, slate-neutral chrome with colour used only for status. Inter type, 8px radii, 1px #E2E8F0 hairlines.

Screen: 1440x900, a dimmed Kanban board behind a dark 40% scrim, with one centred modal dialog.

The dialog is 440px wide, white, 12px radius, 24px padding, with a soft shadow. Contents, centred, top to bottom:

- A small uppercase 11px grey label "SC-0042 · Riverside Bakery".
- A 160px circular progress ring, 8px stroke, track #E2E8F0, drawn about 88% complete in teal #0D9488, with the countdown "2:41" centred inside it in 40px monospace semibold dark slate.
- A 20px semibold heading "Verify identity and payment".
- A line of 14px grey body copy: "Verify identity and payment to lock in this job. If the timer runs out the job returns to the marketplace."
- A full-width solid teal button "Verify".
- A full-width ghost button with red #DC2626 text "Simulate failure".
- An 11px grey footnote: "You can close this — your claim keeps its timer."

No photography, no illustrations, no icons larger than 16px, no gradients, no glass or blur effects, no left navigation sidebar, no marketing or hero copy, no emoji, no placeholder lorem text. Every label and value must be exactly the text given above.
```

### S05 · Create Order dialog — `DESKTOP`

```text
Light-theme B2B operations dashboard for a custom-signage marketplace. Logistics control-room feel: dense, flat, slate-neutral chrome with colour used only for status. Inter type, 8px radii, 1px #E2E8F0 hairlines.

Screen: 1440x900, a dimmed Kanban board behind a dark 40% scrim, with one centred modal dialog.

The dialog is 560px wide, white, 12px radius, 24px padding, soft shadow. Title "New order" in 20px semibold with the subtitle "Creates a draft. You can upload files before submitting." in 11px grey, and a close "X" button top-right.

Form fields, each an 11px uppercase grey label above a 40px input with 8px radius and a 1px #CBD5E1 border, laid out as:
- Full width: "Title" containing "Fascia sign".
- Full width: "Customer name" containing "Riverside Bakery".
- Three across: "Sign type" as a select showing "Storefront"; "Width (cm)" containing "320"; "Height (cm)" containing "60".
- Two across: "Quantity" containing "3"; "Vendor" as a select showing "Acme Signs".
- Full width: "Install address" containing "118 Riverside Ave, Unit 2".
- Full width: "Due date" as a date input showing "24 Sep 2026" with a small calendar icon on the right.
- Full width: "Notes (optional)" as a 72px textarea containing "Match the existing awning font".

One field shows a validation error: "Quantity" has a red 1px border and 11px red helper text below it reading "Must be at least 1".

Footer, right aligned: a ghost button "Cancel" and a solid teal button "Create draft".

No photography, no illustrations, no icons larger than 16px, no gradients, no glass or blur effects, no left navigation sidebar, no marketing or hero copy, no emoji, no placeholder lorem text. Every label and value must be exactly the text given above.
```

### S06 · Transition dialog with a server error — `DESKTOP`

```text
Light-theme B2B operations dashboard for a custom-signage marketplace. Logistics control-room feel: dense, flat, slate-neutral chrome with colour used only for status. Inter type, 8px radii, 1px #E2E8F0 hairlines.

Screen: 1440x900, a dimmed Kanban board behind a dark 40% scrim, with one centred modal dialog.

The dialog is 440px wide, white, 12px radius, 24px padding, soft shadow. Contents top to bottom:

- Title "Move order to In production" in 20px semibold, with "SC-0041 · Grayson Fitness — Van fleet wrap" in 11px grey beneath it.
- A row of two status badges with a small grey arrow between them: a grey badge "Draft", then an amber badge "In production".
- A 14px grey line: "The vendor will be notified and the order can no longer be cancelled."
- A red error panel: #FEF2F2 fill, 1px #FECACA border, 8px radius, 12px padding, containing a 13px semibold dark-red line "Cannot move Draft to In production", beneath it a 12px line "Allowed from Draft: Submitted, Cancelled.", and a small red underlined link "Refresh order".
- A field labelled "Reason (optional)" with a 40px empty input.
- Footer, right aligned: a ghost button "Back" and a solid teal button "Confirm".

No photography, no illustrations, no icons larger than 16px, no gradients, no glass or blur effects, no left navigation sidebar, no marketing or hero copy, no emoji, no placeholder lorem text. Every label and value must be exactly the text given above.
```

### S07 · Mobile board — `MOBILE`

```text
Light-theme B2B operations dashboard for a custom-signage marketplace. Logistics control-room feel: dense, flat, slate-neutral chrome with colour used only for status. Inter type, 8px radii, 1px #E2E8F0 hairlines, page background #F8FAFC.

Screen: a mobile phone view, 390x844.

Top: a 56px white header with a 1px bottom border. Left: "SignCraft" bold 15px. Right: a 6px green dot and a 28px circular avatar with the initials "MR".

Under it, a horizontally scrollable row of tab pills, 32px tall, 6px radius, the row running off the right edge to show that it scrolls: "Draft 2" selected with a dark slate fill and white text, then "Submitted 1", "Accepted 1", "In production 1", "Ready 2", "Completed 1" as grey outline pills.

Below the tabs, a single column of full-width white order cards, 8px radius, 1px border, 12px padding, a 3px grey status stripe on the left edge, 12px gap between them:
- "SC-0046" bold with "Monument · 1 pc" in grey on the same line; "Summit Auto Group — Pylon refit"; then a wrapped two-line meta block "Northline Fabrication" and "Due 3 Oct"; "v1" and a "..." button bottom-right.
- "SC-0045" bold with "Storefront · 4 pcs" in grey; "Orchard Street Market — Window graphics set"; "Vantage Wraps" and "Due 30 Sep"; a 4px teal progress bar filled 64% with the caption "print_v3.pdf · 64%"; "v3" and a "..." button bottom-right.

Bottom-right, floating above the content: a 56px circular solid teal floating action button containing a thin plus glyph.

No photography, no illustrations, no icons larger than 16px, no gradients, no glass or blur effects, no bottom tab bar, no marketing or hero copy, no emoji, no placeholder lorem text. Every label and value must be exactly the text given above.
```

### S08 · Mobile detail sheet — `MOBILE`

```text
Light-theme B2B operations dashboard for a custom-signage marketplace. Logistics control-room feel: dense, flat, slate-neutral chrome with colour used only for status. Inter type, 8px radii, 1px #E2E8F0 hairlines.

Screen: a mobile phone view, 390x844, showing a full-screen white detail sheet with a small grey drag handle centred at the top.

Contents, top to bottom, separated by 1px hairlines:

- A row with "SC-0042" in monospace 12px grey and a close "X" button on the right. Below it a teal badge "Ready for install", the title "Riverside Bakery — Fascia sign" in 18px semibold, and "Riverside Bakery" in 11px grey.
- An action bar of two stacked full-width buttons: solid teal "Verify claim", then a ghost button with red text "Simulate failure".
- An install job block on a #F8FAFC inset: a solid amber pill "Your claim · 2:41 · Verify" with 2:41 monospaced, and "Claimed by you at 12:41" in 11px grey.
- A details list of label-and-value rows, label 11px uppercase grey on the left, value 14px dark on the right: "Sign type / Storefront", "Size / 320 x 60 cm", "Quantity / 3", "Vendor / Acme Signs", "Due / 24 Sep 2026", "Address / 118 Riverside Ave, Unit 2".
- An "Assets" section with two rows: "print_v3.pdf · 182 MB" with a green "Uploaded" badge, and "wrap_proof.ai · 44 MB" with a green "Uploaded" badge.
- A "History" section, a 1px vertical rule with small status-coloured dots: "Marked ready for install — Acme Signs · 12:38", "Started production — Acme Signs · 11:02", "Accepted — Acme Signs · 10:20", "Submitted — Ops · 10:04".

No photography, no illustrations, no icons larger than 16px, no gradients, no glass or blur effects, no bottom tab bar, no marketing or hero copy, no emoji, no placeholder lorem text. Every label and value must be exactly the text given above.
```

### S09 · Tablet board mid-scroll — `TABLET`

```text
Light-theme B2B operations dashboard for a custom-signage marketplace. Logistics control-room feel: dense, flat, slate-neutral chrome with colour used only for status. Inter type, 8px radii, 1px #E2E8F0 hairlines, page background #F8FAFC.

Screen: a tablet view, 1024x768, showing the Kanban board scrolled horizontally so it is caught mid-scroll.

Top: a 56px white header with a 1px bottom border. Left: "SignCraft" bold 16px with "Ops console" beneath in 11px grey. Right: a 6px green dot labelled "Live", a 24px avatar with initials "MR" and the name "Morgan Reyes", and a solid teal "New order" button. No count pills at this width.

Board: two and a half 280px columns are visible. The leftmost column is clipped by the left edge to about half its width, showing the right-hand part of two cards, which makes the horizontal scroll obvious. Columns are #F1F5F9 wells with 8px radius and headers made of a status dot, an uppercase 11px label and a count badge.

- The clipped left column header reads "SUBMITTED 1".
- The first full column, "ACCEPTED 1" with an indigo dot, holds one white card with a 3px indigo stripe: "SC-0043 / Banner · 2 pcs / Pinecrest Clinic — Entrance banner / Northline Fabrication / Due 26 Sep", with "v2" and a "..." button bottom-right.
- The second full column, "IN PRODUCTION 1" with an amber dot, holds one white card with a 3px amber stripe: "SC-0041 / Vehicle wrap · 3 pcs / Grayson Fitness — Van fleet wrap / Vantage Wraps / Due 22 Sep".
- A third column begins at the right edge and is cut off, its header reading "READY FOR INSTALL 2", with the top of a card showing a teal stripe and the text "SC-0042".

A thin 4px horizontal scrollbar sits under the board, its thumb about one third along.

No photography, no illustrations, no icons larger than 16px, no gradients, no glass or blur effects, no left navigation sidebar, no marketing or hero copy, no emoji, no placeholder lorem text. Every label and value must be exactly the text given above.
```
