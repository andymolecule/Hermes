---
name: hermes-frontend-design
description: Build the Hermes web UI following the canonical Molecule Blue design system. Use this skill when implementing any frontend component, page, or layout for the Hermes platform.
---

# Hermes Frontend Design Skill

This skill guides creation of the Hermes web interface — an agent-native, on-chain science bounty platform. Every screen must feel like institutional-grade biotech infrastructure, not a generic SaaS dashboard.

## Canonical Reference

**The single source of truth for all design decisions is:**

📄 `docs/design-system/DESIGN-SYSTEM.md`

This document governs: color palette, typography, spacing, shadows, motion, component patterns, iconography, accessibility standards, and anti-patterns.

**Always read `docs/design-system/DESIGN-SYSTEM.md` before implementing any visual component.**

---

## Quick Reference

### Design Identity

**Theme:** Light (primary), Dark (secondary via `[data-theme="dark"]` or `.dark`)
**Vibe:** Scientific credibility meets crypto infrastructure — Bloomberg Terminal × DeepMind research dashboard × on-chain escrow system.

### Color System (Molecule Blue)

Three ranges derived from a single spectral hue:

| Range | Role | Example Tokens |
|-------|------|----------------|
| **A-range (Greys)** | Neutral infrastructure | `--grey-100` to `--grey-1100` |
| **B-range (Blues)** | Platform structure | `--blue-100` to `--blue-1100` |
| **C-range (Cobalts)** | Brand emphasis & CTAs | `--cobalt-100` to `--cobalt-1100` |

Accents: `--purple-100`, `--purple-250`, `--turquoise` (status only — never in gradients).

Use CSS custom properties exclusively. Never hardcode hex values outside `:root`.

### Typography

| Role | Font | Usage |
|------|------|-------|
| **Display** | Space Grotesk | Headings (`text-xl` and above), hero text, wordmark |
| **Body** | Inter | All UI text, labels, descriptions, body copy |
| **Mono** | JetBrains Mono | Wallet addresses, hashes, USDC values, scores, code |

### Key Rules

1. **4px base unit** — all spacing must be multiples of 4px
2. **Max 8px radius** on cards, 12px on page containers, no exceptions
3. **Skeleton loading** — never spinners for page content
4. **Lucide React** for all icons, no mixing with other libraries
5. **WCAG AA minimum** on all text contrast
6. **`prefers-reduced-motion`** respected in all animations
7. **Tabular nums** on all financial/score data: `font-variant-numeric: tabular-nums`

### CSS Custom Properties

All design tokens are defined in `apps/web/src/app/globals.css`. Use semantic tokens (e.g., `--surface-base`, `--text-primary`, `--interactive-default`) rather than raw palette tokens when possible.

---

## Anti-Patterns

**NEVER produce these patterns:**

| ❌ Avoid | ✅ Instead |
|----------|-----------| 
| Rounded 16px+ cards | Max `radius-lg` (8px) on cards |
| Pastel gradients (pink, lavender, mint) | Molecule Blue range only |
| Purple-to-turquoise gradients | Same-hue two-step gradients |
| Turquoise in gradients | Turquoise for status indicators only |
| Decorative or display-only fonts | Space Grotesk / Inter / JetBrains Mono only |
| Proportional numbers for financial data | Monospace + tabular-nums |
| Bounce/spring animations | ease-out enters, ease-in exits |
| Generic loading spinners | Skeleton shimmer screens |
| Cookie-cutter equal-width card grids | Bento grid with size hierarchy |
| Arbitrary spacing values | Multiples of 4px only |
| Colorful/tinted shadows | Monochromatic shadows using grey-800 at low opacity |

---

## Technical Notes

- **Framework**: Next.js 14 (production), React + Vite (mockup prototype)
- **Styling**: CSS custom properties in `globals.css` (no Tailwind)
- **Fonts**: Google Fonts import in globals.css
- **Icons**: Lucide React, outline style only
- **Responsive**: Desktop-first (agent users are on desktop), tablet/mobile supported
