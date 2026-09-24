# FlowForge Open — Design System

## § 0. Soul

FlowForge Open is a precision control panel for freelance operations automation: dark, dense, exact, with one warm amber accent — the forge — that tells you where the action is. It feels like a machine shop at night, not a marketing dashboard. See `SOUL.md` for the full brief.

---

## § 1. Reference anchor

**Reference:** [Cron Calendar](https://cron.com) — the scheduling app acquired by Notion, known for its restrained, precision-instrument UI.

**Why this one:** Cron embodies the feeling Maya needs at hour 14: a tool that respects attention by being legible at a glance. Every pixel earns its place. The type is confident, the spacing is deliberate, the interactions are instant. There is no ornament — only information and action. Cron's dark mode is a deep, warm-tinted charcoal (not slate-blue, not pure black), with a single accent that guides the eye. That is the forge.

**Five pixel-level patterns we mirror:**

1. **Sidebar density.** Cron's sidebar is 256px expanded, 56px collapsed. Nav items are 36px tall with 10px left padding, icon at 16px, label at 13px medium-weight. Active state is a subtle filled pill (`bg-accent/10`) with accent-colored text, NOT a left border bar. The brand sits in a 52px header zone with the logo mark at 20px. *Mirror: sidebar 240px/56px, 36px nav rows, filled-pill active state.*

2. **Number column discipline.** Cron's event counts and time labels use `font-variant-numeric: tabular-nums` so digits align in columns. Labels are 12px tertiary-color, values are 14px primary-color medium. *Mirror: all counts (run_count, trigger_count, version numbers) use tabular-nums, right-aligned where in a column, with the label in tertiary text above or beside.*

3. **Compact stat strip.** Cron does NOT use big KPI cards. It shows counts inline in a horizontal strip: small icon + label + number, separated by hairline dividers, all on one row. Each stat is ~120px wide. *Mirror: dashboard stats as a compact horizontal strip, not four floating cards. The `.stat-card` class renders as a tight inline block, not a hero.*

4. **Modal precision.** Cron's modals are 440px wide, centered with a subtle backdrop blur (`backdrop-filter: blur(8px)`), 12px radius, 1px border, no double shadow. Title at 16px semibold, body at 14px, button row at the bottom with the primary action right-aligned. *Mirror: command palette and confirmation dialogs at 440-560px, backdrop blur, single 1px border, no nested shadow.*

5. **Keyboard-first feel.** Cron shows `⌘K` hints inline in the sidebar. Every primary action has a visible keyboard affordance. Focus rings are 2px accent-colored, offset 2px — visible but not aggressive. *Mirror: ⌘K hint in sidebar footer, 2px focus rings on all interactive elements, keyboard navigation through every primary flow.*

**Three patterns we deliberately diverge from:**

1. **Cron's light-mode default.** Cron ships light-first. FlowForge is dark-first because Maya works at 11 PM and the forge is a night-time tool. A light theme exists in the token layer for future use, but the default and primary design target is dark.

2. **Cron's single-purpose surface.** Cron shows one thing (a calendar). FlowForge shows many things (workflows, runs, credentials, audit, templates). We diverge by adding a persistent sidebar with seven nav items where Cron has three. The density is the same; the information breadth is wider.

3. **Cron's rounded-everything.** Cron uses 8px radius on most elements and 12px on modals. FlowForge uses a tighter radius scale (4px on inputs/buttons, 6px on cards, 12px on modals) because a forge is more precise than a calendar — the shapes should feel machined, not soft.

---

## § 2. Density

**Dense.** This is an operator console, not a marketing page. Information per screen is high. Whitespace is deliberate, not generous. Every section's margin-bottom is larger than its margin-top. Vertical rhythm flows downward.

---

## § 3. Color tokens

### Dark theme (primary, default)

| Role | Token | Value | Usage |
|------|-------|-------|-------|
| Base background | `--bg-base` | `#0D0D11` | App background, sidebar |
| Elevated surface | `--bg-elevated` | `#16161E` | Cards, panels, table headers |
| Overlay surface | `--bg-overlay` | `#1E1E28` | Modals, dropdowns, popovers |
| Foreground primary | `--fg-primary` | `#E6E6EC` | Headlines, primary text |
| Foreground secondary | `--fg-secondary` | `#9898A4` | Body text, labels |
| Foreground tertiary | `--fg-tertiary` | `#868692` | Metadata, timestamps, IDs |
| Foreground disabled | `--fg-disabled` | `#3E3E48` | Disabled text |
| Accent | `--accent` | `#E09132` | Primary actions, active nav, focus rings |
| Accent hover | `--accent-hover` | `#F0A040` | Hover state of accent elements |
| Accent pressed | `--accent-pressed` | `#C07E28` | Active/pressed state |
| Border subtle | `--border-subtle` | `#1E1E28` | Table row dividers, subtle separators |
| Border default | `--border-default` | `#2A2A36` | Card borders, input borders |
| Border strong | `--border-strong` | `#3A3A48` | Active input borders, emphasis |
| Border focus | `--border-focus` | `#E09132` | Focus ring border |
| Status running | `--status-running` | `#4A9EE8` | Queued, running, waiting |
| Status paused | `--status-paused` | `#E09132` | Paused, pending approval |
| Status halted | `--status-halted` | `#E84A4A` | Canceled, halted |
| Status complete | `--status-complete` | `#3DBA6A` | Succeeded, completed |
| Status failed | `--status-failed` | `#E84A4A` | Failed |
| Status orphan | `--status-orphan` | `#9898A4` | Unknown, skipped, disabled |

### Light theme (available via `[data-theme="light"]`)

| Role | Token | Value |
|------|-------|-------|
| `--bg-base` | `#FAFAFC` |
| `--bg-elevated` | `#FFFFFF` |
| `--bg-overlay` | `#FFFFFF` |
| `--fg-primary` | `#1A1A22` |
| `--fg-secondary` | `#5A5A66` |
| `--fg-tertiary` | `#6A6A76` |
| `--fg-disabled` | `#C0C0C8` |
| `--accent` | `#C07828` |
| `--accent-hover` | `#D08830` |
| `--accent-pressed` | `#A06820` |
| `--border-subtle` | `#EAEAEF` |
| `--border-default` | `#D8D8E0` |
| `--border-strong` | `#C0C0CC` |
| `--border-focus` | `#C07828` |

All light + dark designed together. WCAG AA contrast verified: `--fg-primary` on `--bg-base` = 11.8:1 (dark), 14.2:1 (light). `--fg-secondary` on `--bg-elevated` = 6.31:1 (dark), 6.52:1 (light). `--fg-tertiary` on `--bg-elevated` = 5.00:1 (dark), 5.34:1 (light) — ≥4.5:1 on base, elevated, and overlay in both themes. `--accent` on `--bg-base` = 6.1:1 (dark). Hierarchy preserved: primary > secondary > tertiary > disabled (luminance-ordered in both themes).

---

## § 4. Type tokens

| Token | Value | Usage |
|-------|-------|-------|
| `--font-display` | `'Space Grotesk', sans-serif` | Headings, brand, hero text |
| `--font-body` | `'Space Grotesk', sans-serif` | Body text, UI labels, buttons |
| `--font-mono` | `'JetBrains Mono', monospace` | Code, manifest editor, IDs, paths |

| Token | Value | Usage |
|-------|-------|-------|
| `--text-xs` | `11px` | Metadata, timestamps, badges |
| `--text-sm` | `13px` | Body text, table cells, labels |
| `--text-base` | `14px` | Primary body, button labels |
| `--text-lg` | `16px` | Section headings, modal titles |
| `--text-xl` | `18px` | Page titles |
| `--text-2xl` | `22px` | Hero text (landing page) |
| `--text-3xl` | `28px` | Landing page hero |

| Token | Value |
|-------|-------|
| `--weight-regular` | `400` |
| `--weight-medium` | `500` |
| `--weight-semibold` | `600` |
| `--weight-bold` | `700` |

| Token | Value |
|-------|-------|
| `--line-tight` | `1.2` |
| `--line-snug` | `1.35` |
| `--line-normal` | `1.5` |
| `--line-relaxed` | `1.65` |

Mobile body text uses `--text-base` (14px). The viewport meta tag allows user zoom (no `maximum-scale` restriction). The manifest editor uses `13px` mono — a deliberate coding-surface size, not body text.

---

## § 5. Spacing tokens

4pt scale:

| Token | Value |
|-------|-------|
| `--space-1` | `4px` |
| `--space-2` | `8px` |
| `--space-3` | `12px` |
| `--space-4` | `16px` |
| `--space-5` | `20px` |
| `--space-6` | `24px` |
| `--space-8` | `32px` |
| `--space-10` | `40px` |
| `--space-12` | `48px` |
| `--space-16` | `64px` |
| `--space-20` | `80px` |
| `--space-hairline` | `2px` |
| `--border-width` | `1px` |

### Focus, hover, and overlay detail tokens

| Token | Value | Usage |
|-------|-------|-------|
| `--focus-ring-w` | `2px` | Focus outline width |
| `--focus-ring-offset` | `2px` | Focus outline offset |
| `--focus-ring-offset-in` | `-1px` | Input focus ring (inset) offset |
| `--hover-lift` | `1px` | Primary-button hover translateY |
| `--enter-offset` | `8px` | Entrance-animation translateY |
| `--backdrop-blur` | `8px` | Modal/palette backdrop blur |
| `--btn-height` | `36px` | Base button min-height |
| `--toast-max-w` | `380px` | Toast max-width |
| `--logo-auth` | `32px` | Auth-page brand mark size |
| `--logo-landing` | `48px` | Landing-page forge mark size |

### Layout & structural tokens

All inline dimension values in components MUST reference these tokens — no raw px/rem in JSX style props.

| Token | Value | Usage |
|-------|-------|-------|
| `--sidebar-width` | `240px` | Expanded sidebar |
| `--sidebar-width-collapsed` | `56px` | Collapsed sidebar |
| `--topbar-height` | `52px` | Top navigation bar |
| `--content-max` | `1024px` | Standard page content max-width |
| `--content-max-wide` | `1152px` | Wider pages (Templates, WorkflowNew) |
| `--content-max-audit` | `1200px` | Audit log page (wider table) |
| `--content-narrow` | `420px` | Landing value-sentence max-width |
| `--hero-max` | `560px` | Landing page hero text |
| `--empty-max` | `360px` | Empty-state illustration/text max-width |
| `--empty-icon` | `40px` | Empty-state icon size |
| `--header-nav-h` | `56px` | Landing page header height |
| `--palette-max` | `448px` | Command palette / modal max-width (§1: 440–560 band) |
| `--btn-sm-height` | `32px` | Compact button min-height |
| `--btn-touch-min` | `44px` | Touch-device button min-height |
| `--col-side` | `320px` | Two-column page side rail (Dashboard) |
| `--col-versions-list` | `220px` | Version history list column |
| `--col-gutter` | `40px` | Table status-dot gutter |
| `--col-cards-min` | `140px` | Run-detail meta card minimum |
| `--col-plan-min` | `220px` | Plan upgrade card minimum |
| `--flow-node-w` | `220px` | Auto-generated flow diagram node width |
| `--z-sidebar` | `10` | Desktop sidebar z-index |

### Icon size tokens

| Token | Value | Usage |
|-------|-------|-------|
| `--icon-xs` | `12px` | Inline metadata icons |
| `--icon-sm` | `14px` | Toolbar/action icons |
| `--icon-md` | `16px` | Standard content icons |
| `--icon-lg` | `20px` | Feature/section icons |
| `--icon-xl` | `24px` | Large feature icons |

### Skeleton & detail tokens

| Token | Value | Usage |
|-------|-------|-------|
| `--skeleton-row-h` | `24px` | Skeleton row height |
| `--skeleton-card-h` | `56px` | Skeleton card height |
| `--skeleton-tile-h` | `280px` | Skeleton tile height |
| `--skeleton-block-h` | `320px` | Skeleton block height |
| `--skeleton-section-sm` | `120px` | Small skeleton section |
| `--skeleton-section-md` | `180px` | Medium skeleton section |
| `--skeleton-section-lg` | `200px` | Large skeleton section |
| `--skeleton-input-h` | `48px` | Skeleton input height |
| `--skeleton-field-h` | `40px` | Skeleton field height |
| `--status-dot` | `6px` | Status indicator dot |
| `--progress-bar-h` | `6px` | Progress bar height |
| `--progress-bar-plan-h` | `8px` | Plan progress bar height |
| `--divider-h` | `28px` | Vertical divider height |
| `--step-check` | `10px` | Step wizard check icon |
| `--step-connector-w` | `24px` | Step wizard connector line |
| `--yaml-editor-h` | `35rem` | YAML editor textarea height |
| `--yaml-editor-new-h` | `32.5rem` | New-workflow YAML editor height |
| `--scroll-list-max-h` | `560px` | Scrollable list max-height |
| `--col-seq` | `64px` | Audit table Seq column |
| `--col-when` | `180px` | Audit table When column |
| `--col-actor` | `180px` | Audit table Actor column |
| `--col-action` | `130px` | SSO form field width |
| `--col-event-max` | `280px` | Audit metadata preview max-width |
| `--col-detail-max` | `420px` | Audit detail `<pre>` max-width |

---

## § 6. Component states

### Button (`.btn-primary`, `.btn-secondary`, `.btn-ghost`, `.btn-danger`)

| State | Primary | Secondary | Ghost | Danger |
|-------|---------|-----------|-------|--------|
| Default | `bg: --accent`, `fg: #0D0D11` (dark text on amber) | `bg: transparent`, `border: --border-default`, `fg: --fg-primary` | `bg: transparent`, `fg: --fg-secondary` | `bg: transparent`, `border: --status-failed/40`, `fg: --status-failed` |
| Hover | `bg: --accent-hover`, `translateY(-1px)` | `border: --border-strong`, `bg: --bg-elevated` | `fg: --fg-primary`, `bg: --bg-elevated` | `bg: --status-failed/10` |
| Focus-visible | `2px outline --border-focus, offset 2px` | same | same | same |
| Active/pressed | `bg: --accent-pressed`, `translateY(0)` | `bg: --bg-overlay` | `bg: --bg-overlay` | `bg: --status-failed/15` |
| Disabled | `opacity: 0.4`, `cursor: not-allowed` | same | same | same |
| Loading | `opacity: 0.7` + `Loader2` spinner (`animate-spin`) + labeled text ("Saving…", "Starting…", "Promoting…") + `pointer-events: none` | same | same | same |

**Loading-state ARIA rule (§7b):** `aria-label` stays set to the **base action** even while the visible label switches to the gerund form. A screen-reader user hears "Run Now" not "Starting run" — the visible text communicates the async state; the ARIA label identifies the control.

### Button modifiers

**`.btn-sm`** — Compact button for toolbar/dense-row contexts. Sets `min-height: var(--btn-sm-height)` (32px), `padding: var(--space-1) var(--space-2)`, `font-size: var(--text-xs)`. On touch devices (`@media (pointer: coarse)`), bumps to `min-height: var(--btn-touch-min)` (44px) with `padding: var(--space-2) var(--space-3)`. Always combine with a base button class (e.g., `className="btn-primary btn-sm"`). Inline `minHeight` styles are forbidden on buttons — they defeat the touch media query.

### Input (`.input-field`)

| State | Visual |
|-------|--------|
| Default | `bg: --bg-base`, `border: --border-default`, `fg: --fg-primary`, `radius: --radius-sm`, `font: --text-sm`, `min-height: --btn-height` (36px) |
| Hover | `border: --border-strong` |
| Focus-visible | `border: --border-focus`, `2px ring --border-focus/30` |
| Disabled | `opacity: 0.4`, `cursor: not-allowed` |
| Error | `border: --status-failed`, `aria-describedby` error text below |
| Mobile (`@media max-width: 768px`) | `font-size: --text-lg` (16px, prevents iOS auto-zoom) |
| Touch (`@media pointer: coarse`) | `min-height: --btn-touch-min` (44px hit target) |

**Input modifier `.input-compact`** — dense form controls (table-row selects, short fields). Sets `min-height: var(--btn-sm-height)`, `padding: var(--space-1) var(--space-2)`, `font-size: var(--text-xs)`. Always combine with `.input-field`. Font-size/min-height are owned by the class (not inline) so the mobile 16px bump and touch-height media queries reach it — inline sizing on inputs is forbidden (§9 #14).

### Card (`.surface-card`)

| State | Visual |
|-------|--------|
| Default | `bg: --bg-elevated`, `border: --border-default 1px`, `radius: --radius-md` |
| Hover (interactive) | `border: --accent/40`, `translateY(-1px)` |
| Focus-visible (interactive) | `2px ring --border-focus, offset 2px` |

### Modal

| State | Visual |
|-------|--------|
| Backdrop | `bg: rgba(13,13,17,0.7)`, `backdrop-filter: blur(8px)` |
| Panel | `bg: --bg-overlay`, `border: --border-default var(--border-width)`, `radius: --radius-xl` (12px — §1 mirror), `shadow: --shadow-3` |
| Open animation | `opacity 0→1`, `scale 0.97→1`, `200ms --ease-default` |
| Close | Esc key + click-outside, focus trap, focus restore |

### Nav item

| State | Visual |
|-------|--------|
| Default | `fg: --fg-secondary`, no background |
| Hover | `fg: --fg-primary`, `bg: --bg-elevated` |
| Active | `fg: --accent`, `bg: --accent/10` (filled pill) |
| Focus-visible | `2px ring --border-focus, offset 2px` |

### Table row

| State | Visual |
|-------|--------|
| Default | `border-bottom: --border-subtle 1px` |
| Hover | `bg: --bg-elevated/50` |

### Badge / status pill

| State | Visual |
|-------|--------|
| Default | `text-xs`, `px-2 py-0.5`, `radius: --radius-sm`, `border: 1px` in status color at 30% opacity, `bg` in status color at 10%, `fg` in status color |

### Manifest editor (`.manifest-editor`)

| State | Visual |
|-------|--------|
| Default | `bg: --bg-base`, `border: none`, `fg: --fg-primary`, `font: --font-mono`, `font-size: --text-code` (13px), sits inside `.surface-panel` |
| Focus / focus-visible | `outline: 2px solid --border-focus` (inset offset -1px), `inset box-shadow: 0 0 0 2px --accent-border` — visible amber ring inside the panel edge |
| Mobile (`@media max-width: 768px`) | `font-size: --text-lg` (16px, prevents iOS auto-zoom) |

Font-size is owned by the CSS class (not inline) so the mobile media query can override it.

Labelled via `aria-labelledby` pointing to the pane header `id="manifest-editor-label"` (the visible "Manifest (YAML)" text), not `aria-label`.

### Command palette input (`.palette-input`)

| State | Visual |
|-------|--------|
| Default | `bg: transparent`, `border: none`, `fg: --fg-primary`, `font-size: --text-base` (14px), `min-height: --btn-height` (36px), auto-focused on palette open |
| Focus / focus-visible | `outline: 2px solid --border-focus` (inset offset -1px), `box-shadow: 0 0 0 2px --accent-border` — visible amber ring around the search input |
| Mobile (`@media max-width: 768px`) | `font-size: --text-lg` (16px, prevents iOS auto-zoom) |
| Touch (`@media pointer: coarse`) | `min-height: --btn-touch-min` (44px hit target) |

Font-size and min-height are owned by the CSS class (not inline) so media queries can override them.

### Command palette item (`.palette-item`)

| State | Visual |
|-------|--------|
| Default | `bg: transparent`, `border: none`, `cursor: pointer` |
| Hover | `bg: --bg-elevated` |
| Focus-visible | `outline: 2px solid --border-focus`, `offset: 2px`, `radius: --radius-sm` |
| Selected (programmatic) | `bg: --bg-elevated`, `fg: --fg-primary` (Arrow-key navigation sets this; mouse hover syncs it) |

### Toast

| State | Visual |
|-------|--------|
| Default | `bg: --bg-overlay`, `border: --border-default`, `fg: --fg-primary`, `shadow: --shadow-3` |
| Enter | `translateX(100%)→0`, `opacity 0→1`, `200ms --ease-default` |
| Exit | `translateX(0)→100%`, `opacity 1→0`, `150ms --ease-default` |

---

## § 7. Motion

| Token | Value | Usage |
|-------|-------|-------|
| `--dur-instant` | `50ms` | State toggles, color changes |
| `--dur-fast` | `150ms` | Hover transitions, small UI |
| `--dur-base` | `200ms` | Modals, palette, page transitions |
| `--dur-slow` | `350ms` | Sidebar collapse, large panels |
| `--dur-pulse` | `1.5s` | Skeleton pulse cycle |
| `--stagger-step` | `40ms` | Entrance stagger increments |
| `--dur-copied-hint` | `1500ms` | Transient "copied" hint |
| `--dur-redirect` | `1200ms` | Post-action auto-redirect delay |
| `--dur-poll-run` | `1500ms` | Run-detail SSE fallback poll |
| `--dur-poll-notifications` | `30000ms` | Unread-notification poll |
| `--ease-default` | `cubic-bezier(0.4, 0, 0.2, 1)` | Standard easing |
| `--ease-emphasized` | `cubic-bezier(0.2, 0, 0, 1)` | Enter animations |

**Framer Motion integration:** JS-driven animation cannot consume CSS
custom properties directly, so `apps/web/src/lib/motion-tokens.ts` reads
`--dur-*`/`--ease-*`/`--enter-offset` from the live stylesheet at call time
(`dur('base')`, `ease('default')`, `enterOffset()`, `pacing('dur-poll-run')`).
Because the token layer zeroes durations under `prefers-reduced-motion`, the
reader inherits that behavior for free. Components never hard-code a duration,
a bezier, or an entrance distance.

**Choreographed entrance:** Page content staggers: title (0ms), subtitle (60ms), primary action (120ms), content cards (180ms). Each uses `opacity 0→1` + `translateY(enterOffset())→0` over 200ms with `--ease-emphasized`. The `enterOffset()` function reads `--enter-offset` (8px) from tokens.css — all entrance distances flow through this single token.

**Skeletons not spinners:** Loading states use skeleton blocks (`bg: --bg-elevated`, `animate: pulse 1.5s`) matching the layout shape. Spinners only for inline button loading where the layout is unknown.

**`prefers-reduced-motion: reduce`:** All transitions reduced to `opacity` only, 0ms duration. Entrance animations disabled. Implemented globally via `<MotionConfig reducedMotion="user">` wrapping the entire app in `main.tsx` — Framer Motion automatically skips transforms for users with the OS-level reduced-motion preference.

---

## § 7b. Accessibility

### Focus indicators
All interactive elements (buttons, links, inputs, nav items) show a visible `2px solid var(--border-focus)` outline with `2px` offset on `:focus-visible`. The outline uses `outline` (not `box-shadow`) so it renders even when `box-shadow` is consumed by other states. Removed on `:focus:not(:focus-visible)` to avoid showing on mouse clicks.

Custom borderless inputs (manifest YAML editors `.manifest-editor`, command palette search `.palette-input`) use the same `outline` token with `outline-offset: var(--focus-ring-offset-in)` (-1px, inset) plus a complementary `box-shadow` ring — `inset` for the manifest editor (inside a panel with `overflow: hidden`), outset for the palette input. Both use `:focus` AND `:focus-visible` so the ring is visible on programmatic focus (the palette input auto-focuses on open; the manifest editor receives focus on edit-mode entry). The `.palette-item` result buttons use `outline` with the standard 2px offset. No `outline: none` exists in any component without a `:focus-visible` replacement — the CSS class owns the base `outline: none` and the `:focus-visible` override, never inline styles.

### Touch targets
On touch devices (`@media (pointer: coarse)`), all button classes (`.btn-primary`, `.btn-secondary`, `.btn-ghost`, `.btn-danger`) and `.btn-sm` bump to `min-height: var(--btn-touch-min)` (44px) — the Apple HIG minimum. Nav items also bump to 44px. Input fields (`.input-field`, `.palette-input`) bump to 44px min-height on touch devices. The manifest editor (`.manifest-editor`) is a textarea with a fixed height of 35rem — its hit target already far exceeds 44px, so it is excluded. **Inline `minHeight` on buttons is forbidden** — it overrides the media query and prevents the touch bump. Use the `.btn-sm` class instead. **Inline `fontSize` on inputs is forbidden** — it overrides the mobile `@media (max-width: 768px)` font-size bump that prevents iOS auto-zoom. The CSS class owns font-size; components must not set it inline.

### ARIA patterns
- **Buttons with conditional text** (loading states, async labels) MUST have `aria-label` set to the base action (e.g., `aria-label="Sign in"` even when children render "Signing…").
- **Form inputs with validation errors** MUST set `aria-invalid={true}` and reference the error message via `aria-describedby="{fieldId}-error"`.
- **Icon-only buttons** MUST have `aria-label` describing the action.
- **Loading skeletons** SHOULD have an `aria-label` on the container describing what's loading.
- **Modal dialogs** (including the command palette) MUST capture `document.activeElement` on open and restore focus to it on close. The `CommandPalette` component owns this via its mount/unmount `useEffect` cleanup — the previously focused element is saved in a ref on open and `.focus()`-ed when the palette unmounts (WAI-ARIA dialog pattern).

### Viewport
The viewport meta tag does NOT include `maximum-scale=1.0` — users must be able to zoom. Mobile body text uses `--text-base` (14px); the manifest editor uses `--text-code` (13px) as a deliberate coding-surface size on desktop. On mobile (`@media max-width: 768px`), all input fields (`.input-field`, `.manifest-editor`, `.palette-input`) bump to `--text-lg` (16px) to prevent iOS Safari auto-zoom on focus.

---

## § 8. Voice & copy

**Voice in one sentence:** Direct, precise, operator-grade — tell Maya what happened, what to do next, and nothing else.

**Three empty-state strings:**
- "No runs yet. Pick a template from the gallery and run your first workflow."
- "No workflows yet. Create one from a template or author the YAML yourself."
- "No credentials stored. Add one to reference from your manifests as `secrets.{name}`."

**Three error strings:**
- "Could not reach the server. Check your connection and try again."
- "Save failed: manifest YAML is invalid. Fix the syntax and retry."
- "Could not start run: workflow is disabled. Enable it first."

**Three button labels:**
- "Run Now"
- "Save version"
- "Browse templates"

---

## § 9. Anti-defaults forbidden in this project

From SOUL.md ¶3:
1. **Vercel marketing dashboard** — hero gradient, three KPI cards, blurred aurora. Stats are a compact strip, not hero cards.
2. **Notion greige document** — soft shadows, rounded-everything, "Welcome back" heading. This is a control panel with machined shapes.
3. **Modern SaaS template** — floating-pill nav, glassmorphic sidebar, indigo-to-violet gradients. The accent is amber, the sidebar is solid.
4. **Seven-color status rainbow** — every state in a different neon. Status uses icon + label + one restrained color.

Project-specific anti-defaults:
5. **Inter font** — replaced with Space Grotesk (distinctive, geometric, engineered).
6. **Pure `#000` as black** — replaced with `#0D0D11` (warm-tinted dark).
7. **Pure `#FFF` as white text on dark** — replaced with `#E6E6EC` (off-white, no harshness).
8. **`text-gray-500 on bg-gray-50`** — no Tailwind default gray-on-gray. All text uses semantic tokens.
9. **Soft drop shadow on every card** — one shadow scale, used only for overlay surfaces. Cards use 1px borders.
10. **Emoji as functional icons** — Lucide icons only, one stroke weight, one set.
11. **"Oops!" / "Loading magic…" / "We're so glad you're here!"** — operator-grade voice only.
12. **Animating `width`/`height`/`top`/`left`** — transform and opacity only. Sidebar transitions use `transform` (translateX), never `width`.
13. **Inline `minHeight` on buttons** — use the `.btn-sm` class instead. Inline styles defeat the `@media (pointer: coarse)` touch-target bump.
14. **Inline `fontSize` on inputs** — the CSS class (`.input-field`, `.manifest-editor`, `.palette-input`) owns font-size so the `@media (max-width: 768px)` override can bump it to 16px on mobile (iOS auto-zoom prevention). Inline `fontSize` defeats this media query.
15. **Raw px/rem in JSX style props** — all dimensions must reference `tokens.css` custom properties. The only file with raw values is `tokens.css`. SVG coordinate geometry (`viewBox`, `strokeWidth`, path data) is exempt when declared as a named module-level constant with a comment — SVG needs literal numbers for its coordinate system, and CSS custom properties are strings.
16. **`maximum-scale=1.0` in viewport** — users must be able to zoom. Removed from `index.html`.
17. **Invisible focus indicators** — `outline: 2px solid var(--border-focus)` on all `:focus-visible` states, never `outline: none` without a replacement.
18. **Raw Tailwind z-index utilities** (`z-10`, `z-20`, etc.) — use `style={{ zIndex: 'var(--z-sticky)' }}` etc. instead. Tailwind z-index utilities bypass the closed token layer.
19. **Off-scale Tailwind spacing** (`gap-2.5`, `py-2.5`, etc. = 10px) — 10px is not on the 4pt scale. Use `style={{ gap: 'var(--space-2)' }}` (8px) or `var(--space-3)` (12px) instead.

---

## § 10. Audit

Manual audit only — no automated CSS lint or axe-core pipeline is configured in this stack. The closed-token rule is enforced by manual review: no raw hex, px, or duration values may appear outside `apps/web/src/styles/tokens.css`. The `tsc --noEmit` type check and `vite build` serve as the compile-time gate.

### Verified compliance
- **Zero raw px/rem values** in `pages/` and `components/` — all inline style dimensions reference CSS custom properties. SVG coordinate geometry (`SPARKLINE_W/H/STROKE`, `FLOW_ROW_SPACING`) declared as named module-level constants per §9 #14 exemption.
- **`MotionConfig reducedMotion="user"`** wraps the entire app in `main.tsx`.
- **Entrance motion distance** centralized via `enterOffset()` in `motion-tokens.ts` — reads `--enter-offset` (8px) from tokens.css. No hardcoded `y: 8` or `y: 12` remains in any page.
- **Viewport** has no `maximum-scale` restriction.
- **Focus indicators** use `outline: 2px solid var(--border-focus)` on all interactive `:focus-visible` states.
- **Touch targets** bump to 44px on `@media (pointer: coarse)` for all button classes, nav items, and input fields (`.input-field`, `.palette-input`). The manifest editor textarea is excluded (fixed 35rem height already exceeds 44px).
- **Input font-size on mobile** — `.input-field`, `.manifest-editor`, and `.palette-input` all bump to `--text-lg` (16px) at `@media (max-width: 768px)` to prevent iOS Safari auto-zoom on focus. Font-size is owned by the CSS class, not inline, so the media query can override it.
- **`.btn-sm` class** replaces all inline `minHeight` on buttons — touch media query applies correctly.
- **`aria-label`** on all buttons with conditional/loading text, set to the base action (not the gerund) per §7b. Verified: ConfirmDialog cancel/confirm, RunDetail cancel/approve, Credentials submit, Templates use, WorkflowEditor Run/Save/Promote, Workflows per-row Run, SettingsApprovals approve/reject.
- **Async loading labels** on all async buttons: visible gerund text ("Starting…", "Saving…", "Promoting…", "Deciding…", "Rejecting…", "Storing…", "Creating…", "Signing in…") + `Loader2` spinner with `animate-spin`. Not just a disabled state.
- **`aria-labelledby`** on the manifest YAML textareas (both `WorkflowNew` and `WorkflowEditor`) pointing to the visible "Manifest (YAML)" pane header — replaces the former `aria-label` with a real label association per WCAG 1.3.1.
- **Visible focus** on all custom borderless inputs: `.manifest-editor:focus-visible` (inset amber ring), `.palette-input:focus`/`:focus-visible` (outset amber ring), `.palette-item:focus-visible` (2px outline). No `outline: none` without a `:focus-visible` replacement remains in any component.
- **Command palette focus restore** — `CommandPalette` captures `document.activeElement` on mount and restores focus on unmount (WAI-ARIA dialog pattern, §7b).
- **`prefers-reduced-motion`** zeroes `animate-spin` alongside skeleton and entrance animations.
- **Semantic `<button>`** for modal/command-palette backdrops (ConfirmDialog, CommandPalette) with `tabIndex={-1}` so they are clickable for dismissal but not in the tab order.
- **`aria-invalid`** on all form inputs with field-level validation errors.
- **`ConfirmDialog`** component (`components/ConfirmDialog.tsx`) provides reusable destructive-action confirmation with focus trap, Esc-to-close, click-outside, focus restore to the trigger, and initial focus on the non-destructive action.
- **Off-canvas mobile sidebar** is `inert` + `aria-hidden` while closed, so hidden nav links never appear in the keyboard tab order.
- **Mobile tables** scroll horizontally inside their panel with the table itself as the scroll container (`display: block` + `overflow-x: auto`, content-driven). No forced `min-width` floor: a fixed 560px minimum widened the table past the panel and the panel's `overflow: hidden` clipped the rightmost columns with no way to reach them (regression found and fixed in the pair-coder pass; probe-pinned at 375px that the last column is reachable via table scroll).
