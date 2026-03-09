# Agora Visual Identity

**Platform:** Agora · **Themes:** Light (default), Dark

> Colour and type reference for the Agora product. Use for quick lookups — not as a rulebook.

---

## Colour Palette

The palette is warm-neutral: a light beige page background with near-black typography and minimal colour for status feedback.

### Warm Neutrals (primary scale)

| Token | Hex | Typical Use |
|-------|-----|-------------|
| `warm-50` | `#FAFAF7` | Lightest tint, inset wells |
| `warm-100` | `#F4F4F0` | **Page background** |
| `warm-200` | `#E8E6E1` | Subtle borders, dividers |
| `warm-300` | `#D4D1CB` | Default borders |
| `warm-400` | `#B0ADA6` | Muted / placeholder text |
| `warm-500` | `#8A8680` | Tertiary text, strong muted |
| `warm-600` | `#6B6862` | Secondary text |
| `warm-700` | `#4A4844` | Primary body text |
| `warm-800` | `#2D2B28` | Headings |
| `warm-900` | `#1A1917` | Near-black, primary text |

### Status Colours

| State | Text | Background |
|-------|------|------------|
| Success | `#16A34A` | `#F0FDF4` |
| Warning | `#D97706` | `#FFFBEB` |
| Error | `#DC2626` | `#FEF2F2` |

### Dark Mode Tokens (reserved)

Blues (`blue-100`–`blue-1100`) and Cobalts (`cobalt-100`–`cobalt-1000`) are defined in `@theme` for dark mode surfaces and accents only.

---

## Typography

| Role | Font | Fallback | When |
|------|------|----------|------|
| **Display** | Space Grotesk | system-ui, sans-serif | Headings, hero text |
| **Body** | Inter | system-ui, sans-serif | All UI text |
| **Data** | JetBrains Mono | monospace | Addresses, USDC, scores, hashes |

Use `font-variant-numeric: tabular-nums` on all numeric data.

---

## Buttons

| Variant | Background | Text | Border | Hover |
|---------|-----------|------|--------|-------|
| Primary | `#000` | `#FFF` | 1px `#000` | `#18181b`, lift -2px |
| Secondary | transparent | `#000` | 2px `#000` | Invert to black bg |
| Disabled | `#d4d4d8` | `#71717a` | `#d4d4d8` | none |

Border radius: `4px`. Height: `36px`. Font weight: 600.

---

## Semantic CSS Tokens

Defined in `globals.css`, swap between light/dark themes.

### Surfaces
```
--surface-base       Page background (warm-100)
--surface-default    Cards, panels (#FFF)
--surface-elevated   Elevated cards (#FFF)
--surface-inset      Inset wells (warm-50)
```

### Text
```
--text-primary       Headings, labels (warm-900)
--text-secondary     Body text (warm-700)
--text-tertiary      Captions (warm-600)
--text-muted         Placeholder (warm-400)
--text-accent        Active items (#000)
```

### Borders
```
--border-default     Standard (warm-300)
--border-subtle      Dividers (warm-200)
--border-strong      Emphasis (warm-500)
```

---

*Agora Visual Identity · Last updated March 2026*
