# Agora Frontend Design Skill

Use this skill when building or modifying any frontend component in `apps/web`.

## Visual Reference

See @docs/design/design-system/DESIGN-SYSTEM.md for the full colour palette, font stack, and semantic token names.

## Key Choices

- **Palette:** Warm Neutral — beige base (`--color-warm-100 / #F4F4F0`) with near-black text, warm grey borders, and white card surfaces.
- **Primary accent:** Black (`#000`) for CTAs and active states. Status colours (green/amber/red) for state feedback.
- **Fonts:** Space Grotesk (headings/display), Inter (body), JetBrains Mono (numeric/crypto data).
- **Styling:** Tailwind CSS 4 classes + semantic utility classes bridging CSS custom properties in `globals.css`.
- **Hover/focus:** CSS-only. Avoid JS `onMouseEnter`/`onMouseLeave` for styling.
- **Animation:** Framer Motion (`motion/react`) for hero entrances only. CSS transitions for hover/focus.
- **Icons:** Lucide React.
- **Themes:** Light (default), Dark. Set via `<head>` blocking script from `localStorage`.

## Warm Neutral Token Scale

| Token | Hex | Use |
|-------|-----|-----|
| `warm-50` | `#FAFAF7` | Lightest tint, inset wells |
| `warm-100` | `#F4F4F0` | **Page background** |
| `warm-200` | `#E8E6E1` | Subtle borders |
| `warm-300` | `#D4D1CB` | Default borders |
| `warm-400` | `#B0ADA6` | Muted/placeholder text |
| `warm-500` | `#8A8680` | Tertiary text |
| `warm-600` | `#6B6862` | Secondary text |
| `warm-700` | `#4A4844` | Primary body text |
| `warm-800` | `#2D2B28` | Headings |
| `warm-900` | `#1A1917` | Near-black |

## Buttons

- **Primary:** `#000` bg, white text, `4px` radius, `36px` height.
- **Secondary:** Transparent bg, black text, 2px black border. Hover inverts.
- **Disabled:** `#d4d4d8` bg, `#71717a` text.

## Implementation

- Next.js 14 (app router), SSR enabled
- `ClientLayout` wraps children in `WebProviders` (wagmi/RainbowKit, client-only)
- Status styles shared via `lib/status-styles.ts`
- Desktop-first, responsive at `md` breakpoint
