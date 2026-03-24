---
name: agora-design-system
description: "Agora frontend design system and component guidelines. Use when building or modifying any frontend component in apps/web, styling UI, or reviewing frontend code for design consistency. Canonical spec: docs/design/design-system/DESIGN-SYSTEM.md."
allowed-tools: Read, Grep, Glob
---

# Agora Frontend Design Skill

## Visual Reference

See @docs/design/design-system/DESIGN-SYSTEM.md for full specs. That document is the single source of truth for all visual decisions.

## Design Direction

**"The Digital Curator"** — an editorial, gallery-like experience. Warm parchment base with muted ink blue accent. Typography-forward. Restrained colour usage. Paper-on-glass layering philosophy. Light mode only.

## Core Rules

| Area | Rule |
|------|------|
| **No-Line Rule** | No 1px solid borders for sectioning or containment. Structure via background color shifts only. |
| **Surface Hierarchy** | `surface` (#fcf9f3) > `surface-container-low` (#f6f3ed) > `surface-container` (#f0eee8) > `surface-container-high` (#ebe8e2) > `surface-container-lowest` (#ffffff for cards). |
| **Palette** | Warm Neutral (`warm-50`–`warm-900`) + Ink Blue accent (`accent-500: #2F4F7F`). |
| **No raw black** | Use `warm-900` (`#1E1B18`) for CTAs, headings. Never `#000` in new code. |
| **Fonts** | Space Grotesk (display/headline headings only), Inter (titles, body, everything else), JetBrains Mono (labels, prices, data, technical metadata). |
| **Radius** | Buttons/inputs: `0.25rem` (4px). Card images: `0.375rem` (6px). Panels: `--radius-xl` (16px). |
| **Height** | Buttons: 40px. Inputs: 40–44px. |
| **Shadows** | Tonal layering only — NO heavy drop shadows. Ambient: `0 20px 40px rgba(28,28,24,0.06)` for floating elements. Ghost border: `#c5c6cb` at 15% opacity when accessibility requires a container edge. |
| **Buttons (primary)** | Gradient fill: `linear-gradient(145deg, #111519, #25292e)`. White text. No border. `0.25rem` radius. |
| **Buttons (secondary)** | `surface-container-highest` background. Dark text. No border. `0.25rem` radius. |
| **Buttons (tertiary)** | Text-only. JetBrains Mono. 1px underline of `primary`, spaced 4px from baseline. |
| **Card hover** | Background shift from `surface-container-low` to `surface-container-lowest`. NO shadow lift, NO translateY. |
| **Chips (filters)** | Pill-shaped (`rounded-full`). Active: `primary` bg + white text. Inactive: `surface-container-high` bg, no border. |
| **Glass** | `surface-container-lowest` at 80% opacity + `backdrop-filter: blur(12px)`. For modals, nav bars, hover menus. |
| **Spacing** | Use `--space-*` tokens (4/8/12/16/24/32/48/64). Card padding: 20–24px. Section gaps: 32–48px. Section margins: `spacing-20` (5rem) to breathe. |
| **Motion** | 300ms `cubic-bezier(0.16, 1, 0.3, 1)` (Ease Out Expo). CSS transitions for hover/focus. Framer Motion for hero entrances only. |
| **Icons** | Lucide React. |
| **Theme** | Light only. No dark mode. |

## Typography Hierarchy

| Level | Font Family | Size | Weight | Character |
|-------|-------------|------|--------|-----------|
| **Display** | Space Grotesk | 3.5rem | Bold | Tight tracking (-2%) |
| **Headline** | Space Grotesk | 1.75rem | Bold | Product categories |
| **Title** | Inter | 1.125rem | 600 | High readability for names |
| **Label/Code** | JetBrains Mono | 0.75rem | 500 | Prices, SKUs, technical metadata |
| **Body** | Inter | 0.875rem | 400 | Descriptions |

Do NOT use Space Grotesk for cards, tabs, labels, buttons, or tables.

## Input Fields

| State | Background | Border |
|-------|-----------|--------|
| **Resting** | `surface-container-low` (#f6f3ed) | None |
| **Focus** | `surface-container-lowest` (#ffffff) | Ghost border (20% `outline-variant`) |

Labels on inputs use `label-md` (JetBrains Mono, 0.75rem).

## Implementation

- Next.js 14 (app router), SSR enabled
- `ClientLayout` wraps children in `WebProviders` (wagmi/RainbowKit, client-only)
- Status styles shared via `lib/status-styles.ts`
- Desktop-first, responsive at `md` breakpoint
- Tailwind CSS 4 + CSS custom properties
- Animation: `motion/react` (Framer Motion)

## Gotchas

These are common mistakes discovered during development. Avoid them:

1. **No containment borders.** Use `surface-container-low` on `surface` for visual separation. If you feel the need to draw a line, increase padding or shift the background tone instead.

2. **No translateY hover on cards.** Card hover is a background color shift only (`surface-container-low` to `surface-container-lowest`). Never use `transform: translateY()` or offset shadows for hover.

3. **No `role="radio"` on `<button>`.** Biome's `lint/a11y/useSemanticElements` rejects this. Use `aria-pressed` on buttons instead of `role="radio"` + `role="radiogroup"`.

4. **No `#000` anywhere.** Use `warm-900` (`#1E1B18`) for near-black. This applies to text, borders, shadows, and backgrounds.

5. **No hardcoded hex in components.** Always use CSS custom properties (`var(--surface-container-low)`, `var(--text-primary)`, etc.). Hardcoded hex values break consistency and are not maintainable.

6. **Select-type inputs use predefined options, not free-form.** Deadline, distribution, and dispute window all use curated option lists from `guided-prompts.ts`, not date pickers or free text.

7. **Nav closing tags.** When changing a `<div>` to a semantic element like `<nav>`, update both the opening AND closing tag. Mismatched tags cause silent hydration errors.

8. **Biome-ignore comments are positional.** If you refactor the line a `biome-ignore` comment targets, the comment becomes stale and Biome will flag it. Remove or move the comment when you change the code beneath it.

9. **Compute deadlines at publish time, not draft time.** Use `computeDeadlineIso()` from `lib/post-submission-window.ts` to convert window keys (e.g. `"7"`, `"14"`, `"15m"`) to ISO timestamps when the user publishes, not when they select.
