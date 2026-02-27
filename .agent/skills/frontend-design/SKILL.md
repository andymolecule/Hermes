---
name: hermes-frontend-design
description: Build the Hermes web UI following the Molecule Blue design system. Use when implementing any frontend component, page, or layout.
---

# Hermes Frontend Design Skill

Use this skill when building or modifying any frontend component in `apps/web`.

## Canonical Reference

**Read this first:** @docs/design-system/DESIGN-SYSTEM.md

That document is the single source of truth for all visual decisions: colors, typography, spacing, motion, component patterns, and accessibility.

## Quick Rules

- **Light theme** is primary, dark is secondary
- **Molecule Blue palette:** Greys (A-range), Blues (B-range), Cobalts (C-range)
- **Typography:** Space Grotesk for headings, Inter for body, JetBrains Mono for crypto data
- **Border radius:** max `8px` for cards, `12px` only for page containers
- **Monospace** mandatory for: wallet addresses, USDC amounts, scores, hashes
- **Animations:** Framer Motion for reveals/transitions, CSS transitions for hovers

## Anti-Patterns (never do)

- Rounded 16px cards everywhere
- Purple-to-turquoise gradients
- Generic loading spinners (use skeleton shimmer)
- 3D transforms
- Bounce/spring easing
- Duration > 600ms on interactions

## Implementation

- Framework: Next.js 14 (app router)
- Styling: Tailwind CSS 4 with CSS custom properties for design tokens
- Animation: Framer Motion (`motion/react`)
- Icons: Lucide React
- Fonts: loaded via Google Fonts (Space Grotesk, Inter, JetBrains Mono)
- Desktop-first, tablet-readable
