# Hermes Visual Identity — Molecule Brand Reference

**Platform:** Hermes by Molecule · **Themes:** Light (default), Dark

> A soft reference guide to the Molecule visual identity used across Hermes. Use this for quick colour lookups and font choices — not as a rulebook.

---

## Colour Palette

The palette derives from **Molecule Blue** — a single spectral hue expressed across three ranges.

### A-range: Greys (Neutral Infrastructure)

| Token | Hex | Typical Use |
|-------|-----|-------------|
| `grey-100` | `#F4F6F7` | Light page background |
| `grey-200` | `#C5C7D9` | Borders, disabled text |
| `grey-300` | `#A0A5B9` | Muted / placeholder text |
| `grey-400` | `#646872` | Secondary body text |
| `grey-500` | `#464B52` | Primary body text |
| `grey-600` | `#1C2A3E` | Headings |
| `grey-700` | `#162731` | Dark surfaces |
| `grey-800` | `#0E1A21` | Dark backgrounds |
| `grey-900` | `#0A1419` | Deep dark |
| `grey-1000` | `#050B0D` | Near-black |

### B-range: Blues (Platform Structure)

| Token | Hex | Typical Use |
|-------|-----|-------------|
| `blue-100` | `#F4F6FC` | Subtle surface tint, inset wells |
| `blue-200` | `#BBC6F4` | Inactive highlights |
| `blue-300` | `#8697F7` | Secondary interactive |
| `blue-400` | `#6066D5` | Focus rings |
| `blue-500` | `#3E4BA1` | Active nav states |
| `blue-600` | `#242E6D` | Dark nav background |
| `blue-700` | `#1E2A61` | Dark mode borders |
| `blue-800` | `#0D1648` | Dark mode surfaces |
| `blue-900` | `#112F3F` | Dark mode elevated |
| `blue-1000` | `#061726` | Dark mode deep bg |
| `blue-1100` | `#0D0F20` | Dark mode page bg |

### C-range: Cobalts (Brand Accent)

| Token | Hex | Typical Use |
|-------|-----|-------------|
| `cobalt-100` | `#E0F3FF` | Info tint, light accent bg |
| `cobalt-200` | `#1399F4` | **Primary accent** — CTAs, links, active states |
| `cobalt-300` | `#0F86D9` | Hover state |
| `cobalt-400` | `#0A6BB5` | Pressed state |
| `cobalt-500` | `#006581` | Secondary accent |
| `cobalt-600–1000` | `#0D4B6E`–`#012B31` | Dark-mode accent range |

### Accent Colours

| Token | Hex | Notes |
|-------|-----|-------|
| `purple-500` | `#9562F7` | Secondary accent |
| `purple-700` | `#6F1CE3` | Strong purple |
| `turquoise` | `#11F1F1` | Status indicator only |

### Status Colours

| State | Text | Background |
|-------|------|------------|
| Success | `#16A34A` | `#F0FDF4` |
| Warning | `#D97706` | `#FFFBEB` |
| Error | `#DC2626` | `#FEF2F2` |

---

## Gradients

Guidelines for gradients derived from Molecule colour chips:

- Keep within the same hue, adjusting saturation/brightness
- Two colours only — never three+
- Turquoise is for status indicators, not gradients

Example combos:
```
Blueprint:   linear-gradient(135deg, #242E6D, #3E4BA1)
Cobalt CTA:  linear-gradient(135deg, #0F86D9, #1399F4)
Subtle card:  linear-gradient(180deg, #FFFFFF, #F4F6FC)
```

---

## Typography

| Role | Font | Fallback | When |
|------|------|----------|------|
| **Display** | Space Grotesk | system-ui, sans-serif | Headings, hero text |
| **Body** | Inter | system-ui, sans-serif | All UI text |
| **Data** | JetBrains Mono | monospace | Addresses, USDC, scores, hashes |

Use `font-variant-numeric: tabular-nums` on all numeric data.

---

## Semantic CSS Tokens

These custom properties are defined in `globals.css` and swap automatically between light/dark themes.

### Surfaces
```
--surface-base       Page background
--surface-default    Card / panel backgrounds
--surface-elevated   Elevated cards
--surface-inset      Inset wells, code blocks
```

### Text
```
--text-primary       Headings, labels
--text-secondary     Body text
--text-tertiary      Captions, metadata
--text-muted         Placeholder, disabled
--text-accent        Links, active items (cobalt-200)
```

### Borders
```
--border-default     Standard borders
--border-subtle      Light dividers
--border-strong      Emphasis borders
```

### Glass (Header / Overlays)
```
--glass-bg           Semi-transparent background
--glass-border       Frosted border
```

---

## Quick Reference: Utility Classes

Defined in `globals.css` to bridge CSS custom properties with class-based styling:

```
.bg-surface-default   .text-primary     .border-border-default
.bg-surface-inset     .text-secondary   .border-border-subtle
.bg-surface-elevated  .text-tertiary    .border-border-strong
                      .text-muted
                      .text-accent

.card-hover           Lift + shadow + accent border on hover
.input-focus          Cobalt focus ring
.btn-primary          Cobalt CTA button
.row-hover            Table row highlight
```

---

*Hermes Visual Identity · Molecule · Last updated February 2026*
