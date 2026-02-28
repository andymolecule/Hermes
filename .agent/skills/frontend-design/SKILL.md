# Hermes Frontend Design Skill

Use this skill when building or modifying any frontend component in `apps/web`.

## Visual Reference

See @docs/design-system/DESIGN-SYSTEM.md for the Molecule brand colour palette, font stack, and semantic token names. It's a soft guideline, not a rulebook.

## Key Choices

- **Palette:** Molecule Blue — Greys (A), Blues (B), Cobalts (C). Cobalt-200 (`#1399F4`) is the primary accent.
- **Fonts:** Space Grotesk (headings), Inter (body), JetBrains Mono (numeric/crypto data).
- **Styling:** Tailwind CSS 4 classes + semantic utility classes (`.bg-surface-default`, `.text-primary`, etc.) bridging CSS custom properties.
- **Hover/focus:** CSS-only via `.card-hover`, `.input-focus`, `.btn-primary`, Tailwind `hover:` / `focus:` utilities. Avoid JS `onMouseEnter`/`onMouseLeave` for styling.
- **Animation:** Keep Framer Motion (`motion/react`) to hero entrances and meaningful status feedback. Use CSS transitions for hover/focus states.
- **Icons:** Lucide React.
- **Themes:** Light (default), Dark. Theme set in `<head>` blocking script from `localStorage`.

## Implementation

- Framework: Next.js 14 (app router), SSR enabled
- `ClientLayout` wraps children in `WebProviders` (wagmi/RainbowKit, client-only)
- Status styles shared via `lib/status-styles.ts`
- Desktop-first, responsive with mobile hamburger menu at `md` breakpoint
