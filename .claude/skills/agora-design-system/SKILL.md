---
name: agora-design-system
description: "Agora frontend design system, UI best practices, and component guidelines. MUST activate before any change to apps/web — styling, layout, components, pages, or frontend code review. Covers visual identity, token usage, layout rules, spacing, typography, accessibility, and known anti-patterns. Canonical source for all frontend visual decisions."
allowed-tools: Read, Grep, Glob, Edit, Write
---

# Agora Frontend Design System

This is the single source of truth for all frontend visual decisions in the Agora codebase. Every change to `apps/web/` must follow these rules.

The `frontend-design` plugin (enabled in `.claude/settings.json`) provides generic creative-direction guidance. Where it conflicts with this skill — for example, it discourages Inter and Space Grotesk, both of which are Agora's canonical fonts — **this skill wins**.

---

## 1. Creative North Star: The Digital Curator

Agora rejects the cluttered industrial grid in favor of an editorial, gallery-like experience. We are designing a high-end boutique, not a warehouse.

**Core identity:**
- Warm parchment base with muted ink blue accent
- Typography-forward — technical precision (JetBrains Mono) meets humanistic geometry (Space Grotesk)
- Paper-on-glass layering philosophy — depth through tonal shifts, not shadows or borders
- Intentional asymmetry and expansive negative space
- Whisper-quiet — restrained color, restrained motion, let content breathe
- Light mode only. No dark theme.

---

## 2. Color & Surface System

### The No-Line Rule

**Strict mandate:** Never use `1px solid` borders for sectioning or containment. Structure is defined solely through background color shifts. If you feel the need to draw a line, increase the padding or shift the background tone instead.

The only exceptions:
- Data tables may use `1px` height of `var(--surface-container)` if absolutely necessary
- Ghost borders at 15% opacity when accessibility requires a container edge

### Surface Hierarchy

Treat the UI as a physical stack of fine materials. Each layer is a distinct surface tone:

| Layer | Token | Hex | Tailwind | Usage |
|-------|-------|-----|----------|-------|
| Base | `--surface` / `--surface-base` | `#fcf9f3` | `bg-[var(--surface-base)]` | Page background |
| Low | `--surface-container-low` | `#f6f3ed` | `bg-[var(--surface-container-low)]` | Secondary sections, hero areas |
| Mid | `--surface-container` | `#f0eee8` | `bg-[var(--surface-container)]` | Card backgrounds on base |
| High | `--surface-container-high` | `#ebe8e2` | `bg-[var(--surface-container-high)]` | Active nav items, table headers |
| Highest | `--surface-container-highest` | `#e8e3da` | `bg-[var(--surface-container-highest)]` | Secondary buttons |
| Lowest | `--surface-container-lowest` | `#ffffff` | `bg-[var(--surface-container-lowest)]` | Interactive cards, inputs on focus |

**Layering principle:** To lift a card, do not add a shadow. Place a `surface-container-lowest` card onto a `surface-container` background. This creates a "soft lift" that feels architectural.

### Color Palette

| Scale | Token prefix | Range | Usage |
|-------|-------------|-------|-------|
| Warm Neutral | `--color-warm-*` | 50–900 | All greys, text, borders |
| Ink Blue Accent | `--color-accent-*` | 50–800 | Links, focus rings, accent text |
| Status | `--color-success/warning/error` | bg, text, border | Status indicators only |

**No raw black.** Use `warm-900` (`#1E1B18`) for near-black. Never `#000` anywhere — text, borders, shadows, backgrounds.

### Text Color Tokens

Always use semantic tokens, never raw palette values:

| Token | Value | Usage |
|-------|-------|-------|
| `--text-primary` | `warm-900` | Headings, body text, primary content |
| `--text-secondary` | `warm-700` | Descriptions, secondary labels |
| `--text-tertiary` | `warm-600` | Tertiary info, timestamps |
| `--text-muted` | `warm-500` | Placeholder text, disabled states |
| `--text-accent` | `accent-500` | Links, accent labels |

**In Tailwind:** `text-[var(--text-primary)]`, not `text-warm-900`. The semantic token is the contract; the palette value is the implementation.

### Glass Effect

For floating elements (modals, nav bars, hover menus):
- Background: `var(--glass-bg)` (white at 80% opacity)
- Effect: `backdrop-filter: blur(12px)`
- Use the `.glass-panel` utility class in globals.css

### Shadows

Tonal layering is the primary depth mechanism, not shadows.

- **Ambient (floating elements only):** `var(--shadow-ambient)` — `0 20px 40px rgba(28, 28, 24, 0.06)`
- **Ghost border (accessibility):** `var(--ghost-border)` — `rgba(197, 198, 203, 0.15)`. Should be felt, not seen.
- Shadow tint color is always `warm-900`-based, never pure black.

---

## 3. Typography

Three fonts, strict roles:

| Font | Token | Role | Where |
|------|-------|------|-------|
| **Space Grotesk** | `--font-display` / `font-display` | Display and headline headings ONLY | h1, h2, page titles, hero text |
| **Inter** | `--font-sans` / `font-sans` | Everything else | Titles, body, buttons, nav, forms, descriptions |
| **JetBrains Mono** | `--font-mono` / `font-mono` | Technical metadata | Prices, addresses, timestamps, scores, labels, status badges |

**Do NOT use Space Grotesk for:** cards, tabs, labels, buttons, tables, nav items, form fields, or any non-heading text.

### Type Scale

| Level | Token | Font | Size | Weight | Line Height | Tracking |
|-------|-------|------|------|--------|-------------|----------|
| Display | — | Space Grotesk | 3.5rem (56px) | 700 | 1.1 | -0.02em |
| H1 | `--text-h1` | Space Grotesk | 2.5rem (40px) | 600 | 1.1 | -0.02em |
| H2 | `--text-h2` | Space Grotesk | 1.875rem (30px) | 600 | 1.2 | -0.02em |
| H3 | `--text-h3` | Space Grotesk | 1.5rem (24px) | 600 | 1.25 | -0.01em |
| H4 | `--text-h4` | Inter | 1.125rem (18px) | 600 | 1.45 | — |
| Body LG | `--text-body-lg` | Inter | 1rem (16px) | 400 | 1.625 | — |
| Body | `--text-body` | Inter | 0.9375rem (15px) | 400 | 1.6 | — |
| Body SM | `--text-body-sm` | Inter | 0.875rem (14px) | 400 | 1.57 | — |
| Label | `--text-label` | JetBrains Mono | 0.75rem (12px) | 500 | 1.38 | — |
| Mono | `--text-mono` | JetBrains Mono | 0.75rem (12px) | 500 | 1.38 | — |

### Typography Rules

- **Max line length:** Cap body text at `max-w-prose` or `65ch`. Never let prose stretch full-width on large screens.
- **Font weight hierarchy:** Skip a weight between levels. Body at 400 means headings at 600. Do not use more than 2–3 distinct weights per page.
- **Bold for emphasis:** Use `font-semibold` (600) within body, not `font-bold` (700).
- **Monospace for data:** All prices ($X USDC), wallet addresses (0x...), timestamps, scores, and technical metadata use `font-mono`. This creates a "spec-sheet" aesthetic that signals transparency and precision.
- **Monospace alignment:** Align all mono-spaced text to the top-left of its container to emphasize the technical "ledger" look.
- **Three sizes max per component.** Five sizes max per page view. Use the type scale above — do not invent intermediate sizes.

---

## 4. Spacing System

All spacing values must be multiples of 4px, using design tokens only.

| Token | Value | Usage |
|-------|-------|-------|
| `--space-1` | 4px | Icon-to-label gap, tightest inline spacing |
| `--space-2` | 8px | Related items within a group (chips, tags, badge clusters) |
| `--space-3` | 12px | Small component internal padding |
| `--space-4` | 16px | Standard component padding, form field gaps |
| `--space-5` | 20px | Card internal padding |
| `--space-6` | 24px | Comfortable component padding, card padding |
| `--space-8` | 32px | Between groups of related components |
| `--space-10` | 40px | Section sub-gaps |
| `--space-12` | 48px | Between major sections |
| `--space-16` | 64px | Page-level vertical rhythm, section margins |

### Spacing Principles

- **Law of proximity:** Related elements get smaller spacing. Unrelated elements get larger spacing. The gap between a label and its input is smaller than the gap between two form fields.
- **Start generous, then reduce.** More white space is almost always better. Err on the side of breathing room.
- **Inner < outer:** A card with 24px internal padding should have at least 24px gap between adjacent cards, usually 32px.
- **Use `gap` on parents, not `margin` on children** for sibling spacing. Margin creates invisible coupling; `gap` is explicit.
- **Heading proximity:** More space above a heading than below it. The heading belongs to the content after it. Pattern: `mt-8 mb-3` on section headings.
- **No arbitrary pixel values.** Never write `p-[13px]` or `mt-[7px]`. Every dimension must use the spacing scale.

---

## 5. Layout

### Flex vs Grid Decision

- **Grid** for page-level structure (sidebar + main + panel) and card grids (equal-height items in rows and columns)
- **Flex** for single-axis alignment inside components (nav bars, button groups, icon + text, card internals)
- If you write `flex-wrap` and care about column alignment, switch to grid
- If you write `grid-template-columns: 1fr` (single column), switch to `flex flex-col`

### Page Structure

```
<html>
  <body>
    <header>  — fixed, z-50, glass-panel, grid-cols-[auto_1fr_auto]
    <main>    — flex-1, max-w-7xl, mx-auto, px-6, py-10, pt-24
      {page content}
```

- **Content max-width:** `max-w-7xl` (80rem / 1280px) with `mx-auto` for centering
- **Page horizontal padding:** `px-6` (24px)
- **Page vertical padding:** `py-10` (40px), with `pt-24` to clear the fixed header

### Width Patterns

- **Default: fluid with max-width.** `w-full max-w-*` — element fills its container up to the max.
- **Body text containers:** `max-w-prose` or `max-w-[65ch]`
- **Forms:** `max-w-lg` (32rem) to `max-w-xl` (36rem)
- **Modals:** `max-w-md` (28rem) for small, `max-w-2xl` (42rem) for medium
- **Never use `width: 100%` without a `max-width`** on content containers.
- Use `min-w-0` on flex children to prevent text overflow.

### Alignment

- **Text alignment:** Left-align all body text and form labels. Never center text longer than 2–3 lines. Center-align only hero headings and single-line taglines.
- **Numeric data in tables:** Right-align for comparability.
- **Table headers:** Match the alignment of the column data beneath.
- **Centering:** `flex items-center justify-center` for both-axis. `mx-auto` for block-level horizontal centering.
- **Visual rails:** Left edges of stacked elements should share the same x-coordinate. In a form, all labels left-align at one position, all inputs at another.

### Responsive

- Desktop-first, responsive at `md` breakpoint (768px)
- Use Tailwind responsive prefixes: `md:grid-cols-3`, `md:flex-row`
- All sibling components in a section should be responsive together — never mix responsive and non-responsive siblings

---

## 6. Components

### Buttons

| Variant | Background | Text | Border | Radius | Class |
|---------|-----------|------|--------|--------|-------|
| Primary | `linear-gradient(145deg, var(--primary), var(--primary-container))` | `var(--on-primary)` (white) | None | `0.25rem` (4px) | `.btn-primary` |
| Secondary | `var(--surface-container-highest)` | `var(--text-primary)` | None | `0.25rem` (4px) | `.btn-secondary` |
| Tertiary | Transparent | `var(--text-primary)` | 1px underline of `var(--primary)` | — | Text-only, JetBrains Mono |

- **Height:** 40px standard
- **Padding:** `px-4 py-2` (standard), `px-6 py-3` (large)
- **One primary action per screen.** Secondary actions must be visually recessive. Destructive actions should be tertiary until confirmation.
- **Minimum clearance:** At least `--space-8` (32px) between a primary CTA and other interactive elements.
- **Hover:** Primary buttons use `opacity: 0.9`. Secondary buttons shift to `surface-container-high`. No translateY, no shadow changes.

### Cards

- Background: `var(--surface-container-lowest)` on a `var(--surface-container-low)` or `var(--surface-base)` parent
- Radius: `0.375rem` (6px) for the card, matching image radius
- Padding: 20–24px (`--space-5` to `--space-6`)
- **No divider lines.** Separate image from details using `--space-6` (24px) gap.
- **Hover:** Background shift only — `surface-container-low` to `surface-container-lowest`. Use the `.card-hover` utility class. **Never** use `translateY()` or shadow changes on hover.

### Input Fields

| State | Background | Border |
|-------|-----------|--------|
| Resting | `var(--surface-container-low)` | None |
| Focus | `var(--surface-container-lowest)` | Ghost border at 20% `var(--outline-variant)` |

- **Height:** 40–44px
- **Radius:** `0.25rem` (4px)
- **Labels:** `font-mono text-xs` (JetBrains Mono, 12px), positioned above the input, left-aligned
- Use the `.input-focus` utility class for the focus transition

### Chips / Filter Pills

- Shape: `rounded-full` (pill)
- **Active:** `var(--primary)` background, white text
- **Inactive:** `var(--surface-container-high)` background, no border
- Use `aria-pressed` for toggle state, never `role="radio"` on `<button>`

### Tables

- Header row: `bg-[var(--surface-container-high)]`
- Body rows: `.row-hover` utility (background shift on hover)
- No horizontal dividers between rows — use row hover background shift for visual separation
- Numeric columns: right-aligned, `font-mono`
- Address columns: `font-mono`, truncated with `shortAddress()`

### Status Badges

Use the `STATUS_STYLES` map from `apps/web/src/lib/status-styles.ts`:
- `open` — green dot + success text
- `scoring` — amber dot + warning text
- `finalized` — neutral
- `disputed` — red dot + error text
- `cancelled` — muted

Always use these tokens, never hardcode status colors.

### Editorial List Layout (Asymmetric Mosaic)

For long lists of cards (e.g., challenge grids), break the monotony with an asymmetric mosaic:
- Every 3rd item in the list should span 2 columns and 2 rows
- This creates visual rhythm and encourages discovery
- Use CSS Grid with `grid-column: span 2` and `grid-row: span 2` on every 3rd child

### Links

Do not use standard web blue (`#0000ff` or `#0066cc`) for links. Use `var(--text-accent)` (`accent-500: #2F4F7F`) — a muted ink blue — with a font-weight increase or subtle underline for affordance.

---

## 7. Motion & Interaction

- **Easing:** `var(--ease-out)` — `cubic-bezier(0.16, 1, 0.3, 1)` (Ease Out Expo). Smooth and weighted, never bouncy.
- **Duration:** `var(--duration-fast)` (120ms) for hover/focus, `var(--duration-normal)` (200ms) for state transitions, `var(--duration-slow)` (350ms) for entrance animations
- **CSS transitions for:** hover states, focus states, background shifts
- **Framer Motion (`motion/react`) for:** hero entrance animations, page-level staggered reveals only
- **Reduced motion:** Non-essential animations are wrapped in `@media (prefers-reduced-motion: no-preference)`. This is already handled in globals.css.
- **No bouncy animations.** Keep motion smooth and weighted.
- **One well-orchestrated page load with staggered reveals** creates more delight than scattered micro-interactions.

---

## 8. Visual Hierarchy

The four tools of hierarchy, in order of impact:

1. **Size** — larger elements are seen first. Use the type scale consistently.
2. **Weight** — bolder text draws attention. Skip a weight between hierarchy levels.
3. **Color/contrast** — high contrast (`warm-900`) = primary. Lower contrast (`warm-500`) = muted.
4. **Spacing** — more space around an element increases its perceived importance.

**Rules:**
- Every screen has exactly one primary action (one visually dominant button)
- Labels and metadata are always the lowest visual weight: smallest size, muted color, mono font
- If everything is emphasized, nothing is
- Group related items tightly, then separate groups generously

---

## 9. Accessibility

- **Focus ring:** 2px solid `var(--color-accent-500)` with 2px offset. Already in globals.css via `:focus-visible`.
- **Contrast:** Normal text must have 4.5:1 ratio against background. Large text (18px+) must have 3:1.
- **Touch/click targets:** Minimum 44x44px. Icon-only buttons need padding to expand the hit area even if the icon is 16px.
- **Spacing between targets:** Minimum 8px between adjacent interactive elements.
- **Semantic HTML:** `<button>` for actions, `<a>` for navigation. Never `<div onClick>`. Use `<nav>`, `<main>`, `<section>` for landmarks. Use heading levels (`h1`–`h6`) in order without skipping.
- **Labels:** Every form input needs `<label htmlFor="id">`.
- **Toggle buttons:** Use `aria-pressed`, not `role="radio"` + `role="radiogroup"` — Biome's `lint/a11y/useSemanticElements` rejects the latter.

---

## 10. Implementation Reference

### Tech Stack

- Next.js 14 (app router), SSR enabled
- Tailwind CSS 4 + CSS custom properties (defined in `apps/web/src/app/globals.css`)
- Animation: `motion/react` (Framer Motion) — hero entrances only
- Icons: Lucide React
- Wallet: wagmi + RainbowKit
- `ClientLayout` wraps children in `WebProviders` (wagmi/RainbowKit, client-only)

### Key Files

| File | What it contains |
|------|-----------------|
| `apps/web/src/app/globals.css` | All CSS tokens, semantic utilities, component classes |
| `apps/web/src/lib/status-styles.ts` | Status badge color map (open/scoring/finalized/disputed/cancelled) |
| `apps/web/src/lib/format.ts` | `formatUsdc()`, `formatWadToScore()`, `shortAddress()`, `formatDateTime()` |
| `apps/web/src/lib/challenge-status-copy.ts` | Human-readable status labels and timeline descriptions |
| `apps/web/src/lib/post-submission-window.ts` | `computeDeadlineIso()` for window-to-timestamp conversion |
| `apps/web/src/components/ClientLayout.tsx` | Page wrapper with fixed glass header, 3-column grid nav |
| `apps/web/src/components/ChallengeCard.tsx` | Card component — reference for card-hover, surface layering |
| `apps/web/src/components/ChallengeFilters.tsx` | Filter pills — reference for pill-shaped toggles |
| `apps/web/src/components/LeaderboardTable.tsx` | Table component — reference for header bg, row hover, mono data |

### Utility Classes in globals.css

| Class | What it does |
|-------|-------------|
| `.glass-panel` | 80% opacity white + 12px backdrop blur |
| `.btn-primary` | Gradient fill (145deg primary to primary-container), white text, 4px radius |
| `.btn-secondary` | surface-container-highest background, dark text, 4px radius |
| `.card-hover` | Background shift from surface-container-low to surface-container-lowest |
| `.input-focus` | Border color and box-shadow transition on focus |
| `.row-hover` | Table row background shift on hover |
| `.kpi-strip` | Responsive grid for KPI stat strips |
| `.kpi-cell` | Individual KPI cell with surface-container-lowest background |
| `.skeleton` | Shimmer loading animation |
| `.bg-grid` | 40px clinical grid background pattern |
| `.bg-plus-pattern` | Radial dot background pattern |

### Tailwind Token Bridge

Globals.css defines semantic utility classes that bridge CSS custom properties to Tailwind:

**Surfaces:** `.bg-surface-base`, `.bg-surface-container-lowest`, `.bg-surface-container-low`, `.bg-surface-container-high`, `.bg-surface-container-highest`

**Text:** `.text-primary`, `.text-secondary`, `.text-tertiary`, `.text-muted`, `.text-accent`

**Borders:** `.border-border-default`, `.border-border-subtle`, `.border-border-strong`

You can also reference tokens inline in Tailwind: `bg-[var(--surface-container-low)]`, `text-[var(--text-secondary)]`

---

## 11. Anti-Patterns

These are mistakes that must never appear in Agora frontend code:

### Design Anti-Patterns

1. **No containment borders.** Use surface-container tonal shifts for separation. If you feel the need to draw a line, increase padding or shift the background tone.
2. **No `translateY` hover on cards.** Card hover is a background color shift only. Never use `transform: translateY()` or offset shadows for hover.
3. **No `#000` anywhere.** Use `warm-900` (`#1E1B18`) for near-black.
4. **No hardcoded hex in components.** Always use CSS custom properties (`var(--surface-container-low)`, `var(--text-primary)`). Hardcoded hex values break consistency.
5. **No heavy drop shadows.** Depth is achieved through tonal layering, not box-shadow. The only shadow is `--shadow-ambient` for floating elements.
6. **No Space Grotesk outside headings.** Display font is for h1/h2/h3 page headings only.
7. **No centering long text.** Left-align all text longer than one line.

### Code Anti-Patterns

8. **No inline `style={}` for design tokens.** Write `bg-[var(--surface-container-low)]` in Tailwind, not `style={{ backgroundColor: "var(--surface-container-low)" }}`.
9. **No arbitrary pixel values.** Never `p-[13px]` or `mt-[7px]`. Use the 4px-based spacing scale.
10. **No `role="radio"` on `<button>`.** Biome rejects it. Use `aria-pressed` instead.
11. **No mixing raw palette and semantic tokens.** Write `text-[var(--text-secondary)]`, not `text-warm-700`. The semantic token is the contract.
12. **No `margin` for sibling spacing.** Use `gap` on the flex/grid parent.
13. **No nested flex/grid more than 3 levels deep.** Flatten the layout.

### Process Anti-Patterns

14. **No skipping this skill.** Every `apps/web/` change must reference this document.
15. **Biome-ignore comments are positional.** If you refactor the line a `biome-ignore` comment targets, the comment becomes stale. Remove or move it.
16. **Nav closing tags.** When changing a `<div>` to a semantic element like `<nav>`, update both the opening AND closing tag. Mismatched tags cause silent hydration errors.
17. **Compute deadlines at publish time, not draft time.** Use `computeDeadlineIso()` from `lib/post-submission-window.ts`.
18. **Select-type inputs use predefined options.** Deadline, distribution, and dispute window use curated option lists from `guided-prompts.ts`, not free-form text or date pickers.

---

## 12. Refactoring Signals

When reviewing existing frontend code, flag these for cleanup:

- More than 3 hardcoded arbitrary pixel values in one component
- Inline `style={}` for colors or spacing that have design tokens
- Mixed layout approaches in one section (some children use margin, others use parent gap)
- Inconsistent padding across sibling components
- More than 5 font sizes on a single page view
- `border` used for visual separation where a background shift would suffice
- Text containers without `max-width` that stretch beyond ~75 characters
- Components mixing raw palette values (`text-warm-500`) and semantic tokens (`text-[var(--text-muted)]`)
- Responsive breakpoints handled inconsistently among siblings

---

## 13. Visual Verification (Required)

After every frontend change to `apps/web/`, you **must** visually verify the result using browser tools before considering the work done. This is a lightweight evaluator pattern — code review alone is not sufficient for design quality.

**Steps:**

1. Ensure the dev server is running (`pnpm --filter @agora/web dev -- --port 3100`)
2. Use `claude-in-chrome` to navigate to the affected page(s)
3. Screenshot the result
4. Compare against this design system: check surface layering, typography roles, spacing scale, color tokens, and anti-patterns
5. If the screenshot reveals violations — wrong font on a label, a hard border where a tonal shift should be, arbitrary spacing — fix them before finishing

**What to check visually:**

- Surface hierarchy reads correctly (base → low → mid → high layers are distinguishable)
- Typography roles are correct (Space Grotesk only on h1/h2/h3, Inter for body, JetBrains Mono for data)
- No visible hard borders used for sectioning
- Spacing feels generous and consistent (no cramped or uneven gaps)
- Cards use background shift on hover, not translateY or shadow changes
- Mono-spaced data (prices, addresses, scores) is visually distinct from body text
- The page has one clear primary action, not competing CTAs
