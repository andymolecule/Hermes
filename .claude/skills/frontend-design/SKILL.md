---
name: frontend-design
description: "Agora frontend design system and component guidelines. Use when building or modifying any frontend component in apps/web, styling UI, or reviewing frontend code for design consistency."
allowed-tools: Read, Grep, Glob
---

# Agora Frontend Design Skill

## Visual Reference

See @docs/design/design-system/DESIGN-SYSTEM.md for full specs.

## Design Direction

Warm editorial product UI — calm, premium, intentional. Beige base with muted ink blue accent. Typography-forward. Restrained colour usage.

## Core Rules

| Area | Rule |
|------|------|
| **Palette** | Warm Neutral (`warm-50`–`warm-900`) + Ink Blue accent (`accent-500: #2F4F7F`) |
| **No raw black** | Use `warm-900` (`#1E1B18`) for CTAs, headings. Never `#000` in new code. |
| **Fonts** | Space Grotesk (headings only), Inter (everything else), JetBrains Mono (data) |
| **Radius** | Buttons/inputs: `--radius-md` (8px). Cards: `--radius-lg` (12px). Panels: `--radius-xl` (16px). |
| **Height** | Buttons: 40px. Inputs: 40–44px. |
| **Shadows** | Cards: border only → `--shadow-md` on hover. Modals: `--shadow-lg`. |
| **Spacing** | Use `--space-*` tokens (4/8/12/16/24/32/48/64). Card padding: 20–24px. Section gaps: 32–48px. |
| **Motion** | CSS transitions for hover/focus. Framer Motion for hero entrances only. |
| **Icons** | Lucide React |
| **Themes** | Light (default), Dark. All semantic tokens swap via CSS custom properties. |

## Typography Hierarchy

- **H1–H3:** Space Grotesk, 600 weight, negative tracking
- **H4:** Inter, 600 weight
- **Body:** Inter, 400 weight, 14–16px
- **Label:** Inter, 500 weight, 13px
- **Mono:** JetBrains Mono, 500 weight, 13px

Do NOT use Space Grotesk for cards, tabs, labels, buttons, or tables.

## Neo-Brutalist Patterns

Pages using the brutalist variant follow these additional rules:

| Pattern | Implementation |
|---------|---------------|
| **Border radius** | `rounded-[2px]` (not the design system's 8/12/16px) |
| **Borders** | `border border-warm-900` (strong, not subtle) |
| **Offset shadows** | `shadow-[4px_4px_0px_var(--color-warm-900)]` |
| **Button press** | Use `.btn-primary` / `.btn-secondary` classes from `globals.css` |
| **KPI strips** | 2.5px borders, 5px offset shadows, inner cell borders via `nth-child` |

## Implementation

- Next.js 14 (app router), SSR enabled
- `ClientLayout` wraps children in `WebProviders` (wagmi/RainbowKit, client-only)
- Status styles shared via `lib/status-styles.ts`
- Desktop-first, responsive at `md` breakpoint
- Tailwind CSS 4 + CSS custom properties
- Animation: `motion/react` (Framer Motion)

## Gotchas

These are common mistakes discovered during development. Avoid them:

1. **No raw hex in shadows.** Tailwind arbitrary shadow values like `shadow-[4px_4px_0px_#16a34a]` break theme switching. Always use CSS vars: `shadow-[4px_4px_0px_var(--color-emerald-600)]`.

2. **No `role="radio"` on `<button>`.** Biome's `lint/a11y/useSemanticElements` rejects this. Use `aria-pressed` on buttons instead of `role="radio"` + `role="radiogroup"`.

3. **No `#000` anywhere.** Use `warm-900` (`#1E1B18`) for near-black. This applies to text, borders, shadows, and backgrounds.

4. **Select-type inputs use predefined options, not free-form.** Deadline, distribution, and dispute window all use curated option lists from `guided-prompts.ts`, not date pickers or free text.

5. **Nav closing tags.** When changing a `<div>` to a semantic element like `<nav>`, update both the opening AND closing tag. Mismatched tags cause silent hydration errors.

6. **Biome-ignore comments are positional.** If you refactor the line a `biome-ignore` comment targets, the comment becomes stale and Biome will flag it. Remove or move the comment when you change the code beneath it.

7. **Compute deadlines at publish time, not draft time.** Use `computeDeadlineIso()` from `lib/post-submission-window.ts` to convert window keys (e.g. `"7"`, `"14"`, `"15m"`) to ISO timestamps when the user publishes, not when they select.
