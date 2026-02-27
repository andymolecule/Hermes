# Hermes Design System

**Version:** 1.0 · **Platform:** Hermes by Molecule · **Theme:** Light (primary), Dark (secondary)

> The canonical reference for all Hermes frontend decisions. This document governs visual language, component patterns, and interaction behavior across the platform.

---

## Table of Contents

1. [Design Principles](#1-design-principles)
2. [Color System](#2-color-system)
3. [Typography](#3-typography)
4. [Spacing & Layout](#4-spacing--layout)
5. [Shadows & Elevation](#5-shadows--elevation)
6. [Border & Radius](#6-border--radius)
7. [Motion & Animation](#7-motion--animation)
8. [Component Patterns](#8-component-patterns)
9. [Iconography](#9-iconography)
10. [Accessibility](#10-accessibility)
11. [Anti-Patterns](#11-anti-patterns)
12. [CSS Custom Properties Reference](#12-css-custom-properties-reference)

---

## 1. Design Principles

These principles are not aspirational — they are constraints. Every design decision should be traceable back to at least one.

### 1.1 Precision Over Decoration
Infrastructure software earns trust through clarity, not ornament. Every visual element must serve a function: communicate state, establish hierarchy, or guide attention. If it cannot justify its presence, remove it.

### 1.2 Data-First Density
Researchers and AI agents are high-context users. The interface should surface maximum signal in minimum space — dense information tables over sparse card grids, exact values over rounded approximations, tabular numbers over proportional type.

### 1.3 Scientific Credibility
Hermes operates at the intersection of computational science and crypto infrastructure. The visual language borrows from technical blueprints: measured grids, cool blues, monospace data, and schematic precision. This is not a consumer app.

### 1.4 Contextual Depth
Depth communicates meaning, not style. Elevated surfaces indicate interactivity or focus. Flat surfaces are passive. Shadows respond to state — an element lifts when hovered, retreats when active. The Z-axis has semantics.

### 1.5 Restrained Expressiveness
The palette is intentionally narrow: Molecule Blue neutrals, core blues, and a single Cobalt accent. Reserve saturated color for status (success, error, warning) and primary CTAs. Visual emphasis is relative — it works only because most of the surface is quiet.

### 1.6 Motion With Purpose
Transitions confirm actions, reveal hierarchy, and reduce cognitive load between states. Motion is never decorative. Animations that users cannot perceive as meaningful should be removed. Always respect `prefers-reduced-motion`.

---

## 2. Color System

### 2.1 Palette Overview

The Hermes palette derives entirely from **Molecule Blue** — a single spectral hue point expressed across three ranges:

| Range | Role | Use |
|-------|------|-----|
| **A-range (Greys)** | Neutral infrastructure | Backgrounds, surfaces, borders, text |
| **B-range (Blues)** | Platform structure | Navigation, structural elements, headers |
| **C-range (Cobalts)** | Brand emphasis | CTAs, active states, interactive highlights |

### 2.2 Complete Palette

#### Greys (A-range)

| Token | Hex | Usage |
|-------|-----|-------|
| `grey-100` | `#F4F6F7` | Page background (light theme) |
| `grey-200` | `#C5C7D9` | Disabled states, placeholder text |
| `grey-300` | `#A0A5B9` | Secondary text, captions |
| `grey-400` | `#646872` | Body text (secondary) |
| `grey-500` | `#464B52` | Body text (primary) |
| `grey-600` | `#1C2A3E` | Headings, high-emphasis text |
| `grey-700` | `#162731` | Dark surface background |
| `grey-800` | `#0E1A21` | Dark page background |
| `grey-900` | `#0A1419` | Deep dark background |
| `grey-1000` | `#050B0D` | Near-black |
| `grey-1100` | `#011706` | Absolute dark |

#### Blues (B-range)

| Token | Hex | Usage |
|-------|-----|-------|
| `blue-100` | `#F4F6FC` | Subtle blue tint on surfaces |
| `blue-200` | `#BBC6F4` | Inactive tab highlights |
| `blue-300` | `#8697F7` | Secondary interactive elements |
| `blue-400` | `#6066D5` | Focus ring color |
| `blue-500` | `#3E4BA1` | Navigation active state |
| `blue-600` | `#242E6D` | Dark navigation background |
| `blue-700` | `#1E2A61` | Deep structural elements |
| `blue-800` | `#0D1648` | Dark mode surface |
| `blue-900` | `#112F3F` | Dark mode elevated surface |
| `blue-1000` | `#061726` | Dark mode deep background |
| `blue-1100` | `#0D0F20` | Dark mode page background |

#### Cobalts (C-range)

| Token | Hex | Usage |
|-------|-----|-------|
| `cobalt-100` | `#E0F3FF` | Info background tint |
| `cobalt-200` | `#1399F4` | **Primary CTA fill**, interactive accent |
| `cobalt-300` | `#0F86D9` | CTA hover state |
| `cobalt-400` | `#0A6BB5` | CTA active/pressed state |
| `cobalt-500` | `#006581` | Secondary interactive elements |
| `cobalt-600` | `#0D4B6E` | Dark accent |
| `cobalt-700` | `#044A58` | Dark accent hover |
| `cobalt-800` | `#022C3E` | Dark accent deep |
| `cobalt-900` | `#033A45` | Dark surface accent |
| `cobalt-1000` | `#012B31` | Deep dark accent |
| `cobalt-1100` | `#012B31` | Deepest dark accent |

#### Accent Colors

| Token | Hex | Usage |
|-------|-----|-------|
| `purple-100` | `#9562F7` | Secondary accent, AI indicators |
| `purple-250` | `#6F1CE3` | Strong purple emphasis |
| `turquoise` | `#11F1F1` | Status indicator only — never in gradients |
| `white` | `#F1F1F1` | White text on dark surfaces |

### 2.3 Gradient Rules

1. Gradients originate from Molecule color chips only
2. Saturation and brightness may be adjusted within the same hue
3. Keep color values within approximately two steps of brightness
4. Gradients are always two colors — never more
5. **Never use turquoise in gradients**
6. **Never create purple-to-turquoise gradients**

**Approved gradient examples:**
```css
/* Blueprint gradient — headers, hero sections */
background: linear-gradient(135deg, #242E6D, #3E4BA1);

/* Cobalt action gradient — CTA hover effects */
background: linear-gradient(135deg, #0F86D9, #1399F4);

/* Subtle surface gradient — elevated cards */
background: linear-gradient(180deg, #FFFFFF, #F4F6FC);
```

### 2.4 Semantic Color Tokens

#### Light Theme

```css
/* Status colors */
--color-success:        #16A34A;
--color-success-bg:     #F0FDF4;
--color-success-border: #BBF7D0;

--color-warning:        #D97706;
--color-warning-bg:     #FFFBEB;
--color-warning-border: #FDE68A;

--color-error:          #DC2626;
--color-error-bg:       #FEF2F2;
--color-error-border:   #FECACA;

--color-info:           #1399F4; /* cobalt-200 */
--color-info-bg:        #E0F3FF; /* cobalt-100 */
--color-info-border:    #BBC6F4; /* blue-200 */
```

#### Surface Hierarchy (Light Theme)

```css
--surface-base:     #F4F6F7;   /* grey-100 — page background */
--surface-default:  #FFFFFF;   /* card/panel surfaces */
--surface-elevated: #FFFFFF;   /* elevated cards (with shadow) */
--surface-overlay:  rgba(255, 255, 255, 0.85); /* glassmorphism overlays */
--surface-inset:    #F4F6FC;   /* blue-100 — inset wells, code blocks */
```

### 2.5 Interactive State Colors

| State | Color | Token |
|-------|-------|-------|
| Default | `#1399F4` | `cobalt-200` |
| Hover | `#0F86D9` | `cobalt-300` |
| Active/Pressed | `#0A6BB5` | `cobalt-400` |
| Focus ring | `#6066D5` | `blue-400` |
| Disabled text | `#A0A5B9` | `grey-300` |
| Disabled background | `#F4F6F7` | `grey-100` |

---

## 3. Typography

### 3.1 Font Stack

| Role | Font | Fallback | Use Case |
|------|------|----------|----------|
| **Display** | Space Grotesk | system-ui, sans-serif | Headings, hero text, wordmark |
| **Body** | Inter | system-ui, sans-serif | All UI text, labels, descriptions |
| **Mono** | JetBrains Mono | 'Courier New', monospace | Addresses, hashes, USDC values, code |

```css
--font-display: 'Space Grotesk', system-ui, -apple-system, sans-serif;
--font-body:    'Inter', system-ui, -apple-system, sans-serif;
--font-mono:    'JetBrains Mono', 'Fira Code', 'Courier New', monospace;
```

### 3.2 Type Scale

| Token | Size | Weight | Line Height | Letter Spacing | Usage |
|-------|------|--------|-------------|----------------|-------|
| `text-xs` | 11px | 400/500 | 1.4 | +0.02em | Labels, captions, metadata |
| `text-sm` | 13px | 400/500 | 1.5 | +0.01em | Secondary body, form labels |
| `text-base` | 15px | 400 | 1.6 | 0 | Primary body text |
| `text-md` | 17px | 400/500 | 1.5 | 0 | Lead text, emphasized body |
| `text-lg` | 20px | 500/600 | 1.4 | -0.01em | Card titles, section headers |
| `text-xl` | 24px | 600 | 1.3 | -0.02em | Page subheadings |
| `text-2xl` | 30px | 600/700 | 1.2 | -0.03em | Page headings |
| `text-3xl` | 36px | 700 | 1.15 | -0.03em | Hero text, stat values |
| `text-4xl` | 48px | 700 | 1.1 | -0.04em | Hero numbers, landing display |

```css
--text-xs:   0.6875rem;  /* 11px */
--text-sm:   0.8125rem;  /* 13px */
--text-base: 0.9375rem;  /* 15px */
--text-md:   1.0625rem;  /* 17px */
--text-lg:   1.25rem;    /* 20px */
--text-xl:   1.5rem;     /* 24px */
--text-2xl:  1.875rem;   /* 30px */
--text-3xl:  2.25rem;    /* 36px */
--text-4xl:  3rem;       /* 48px */
```

### 3.3 Font Weight Scale

```css
--weight-regular:   400;
--weight-medium:    500;
--weight-semibold:  600;
--weight-bold:      700;
```

### 3.4 Usage Rules

**Display (Space Grotesk):** Reserved for `text-xl` and above. Use for page titles, section headings, the platform wordmark, and hero statistics. Never use for body text or labels.

**Body (Inter):** All text below `text-xl`. Form labels, descriptions, table cells, navigation links, tooltips, and all UI copy.

**Mono (JetBrains Mono):** Mandatory for all crypto-specific data:

| Data Type | Formatting Rule |
|-----------|----------------|
| Wallet addresses | Monospace, truncated (`0x1a2b…9f0a`), `text-sm` |
| Transaction hashes | Monospace, truncated, `text-xs` |
| USDC reward amounts | Monospace, `font-variant-numeric: tabular-nums` |
| Scores / metrics | Monospace, tabular-nums |
| Code snippets | Monospace, `surface-inset` background |

```css
/* Crypto data base style */
.crypto-data {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  font-feature-settings: "tnum";
  letter-spacing: -0.01em;
}
```

### 3.5 Text Color Hierarchy

| Token | Color | Use |
|-------|-------|-----|
| `text-primary` | `#1C2A3E` (grey-600) | Headings, labels |
| `text-secondary` | `#464B52` (grey-500) | Body text |
| `text-tertiary` | `#646872` (grey-400) | Captions, metadata |
| `text-muted` | `#A0A5B9` (grey-300) | Placeholder, disabled |
| `text-accent` | `#1399F4` (cobalt-200) | Links, active items |
| `text-inverse` | `#F1F1F1` (white) | Text on dark surfaces |

---

## 4. Spacing & Layout

### 4.1 Base Unit

All spacing derives from a **4px base unit**. Never use arbitrary values — every margin, padding, and gap should be a multiple of 4px.

```css
--space-1:   4px;
--space-2:   8px;
--space-3:   12px;
--space-4:   16px;
--space-5:   20px;
--space-6:   24px;
--space-8:   32px;
--space-10:  40px;
--space-12:  48px;
--space-16:  64px;
--space-20:  80px;
--space-24:  96px;
--space-32:  128px;
```

### 4.2 Breakpoints

| Token | Value | Context |
|-------|-------|---------|
| `sm` | 640px | Mobile landscape |
| `md` | 768px | Tablet |
| `lg` | 1024px | Small desktop |
| `xl` | 1280px | Desktop (primary) |
| `2xl` | 1536px | Wide desktop |

### 4.3 Container Widths

```css
--container-sm:   640px;
--container-md:   768px;
--container-lg:   1024px;
--container-xl:   1280px;
--container-2xl:  1440px;
--container-full: 100%;

/* Page content max-width */
--page-max-width: 1280px;
--page-padding-x: var(--space-6);  /* 24px on mobile */
--page-padding-x-lg: var(--space-8); /* 32px on desktop */
```

### 4.4 Grid System

**Standard 12-column grid:**
```css
.grid-12 {
  display: grid;
  grid-template-columns: repeat(12, 1fr);
  gap: var(--space-6);
}
```

**Bento grid variants** — asymmetric layouts for the dashboard:

```css
/* Challenge grid: 3 wide + 1 featured */
.grid-bento-challenges {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  grid-template-rows: auto;
  gap: var(--space-4);
}

.grid-bento-challenges .card--featured {
  grid-column: span 2;
  grid-row: span 2;
}

/* Stats bento: 4-2-4 rhythm */
.grid-bento-stats {
  display: grid;
  grid-template-columns: 2fr 1fr 1fr 2fr;
  gap: var(--space-4);
}

/* Dashboard overview: mixed sizes */
.grid-bento-dashboard {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  grid-auto-rows: minmax(120px, auto);
  gap: var(--space-4);
}
```

### 4.5 Component Spacing Guidelines

| Component | Internal Padding | Gap |
|-----------|-----------------|-----|
| Card (default) | `24px` (space-6) | — |
| Card (compact) | `16px` (space-4) | — |
| Form group | `16px` (space-4) | `8px` (space-2) |
| Table cell | `12px 16px` (space-3/4) | — |
| Button (md) | `10px 20px` | — |
| Button (sm) | `6px 12px` | — |
| Navigation item | `8px 12px` | — |
| Section heading | `0 0 24px` | — |

---

## 5. Shadows & Elevation

Shadows communicate interactive potential. Flat elements are passive; elevated elements are interactive or focused.

### 5.1 Elevation Scale

| Level | Token | CSS Value | Use Case |
|-------|-------|-----------|----------|
| 0 | `shadow-none` | `none` | Static, non-interactive surfaces |
| 1 | `shadow-xs` | `0 1px 2px rgba(14,26,33,0.06), 0 1px 3px rgba(14,26,33,0.04)` | Subtle card lift, form inputs |
| 2 | `shadow-sm` | `0 2px 4px rgba(14,26,33,0.08), 0 4px 8px rgba(14,26,33,0.05)` | Cards at rest |
| 3 | `shadow-md` | `0 4px 12px rgba(14,26,33,0.10), 0 8px 16px rgba(14,26,33,0.06)` | Cards on hover |
| 4 | `shadow-lg` | `0 8px 24px rgba(14,26,33,0.12), 0 16px 32px rgba(14,26,33,0.07)` | Dropdowns, popovers |
| 5 | `shadow-xl` | `0 16px 48px rgba(14,26,33,0.15), 0 32px 64px rgba(14,26,33,0.08)` | Modals, dialogs |

```css
--shadow-none: none;
--shadow-xs:   0 1px 2px rgba(14, 26, 33, 0.06), 0 1px 3px rgba(14, 26, 33, 0.04);
--shadow-sm:   0 2px 4px rgba(14, 26, 33, 0.08), 0 4px 8px rgba(14, 26, 33, 0.05);
--shadow-md:   0 4px 12px rgba(14, 26, 33, 0.10), 0 8px 16px rgba(14, 26, 33, 0.06);
--shadow-lg:   0 8px 24px rgba(14, 26, 33, 0.12), 0 16px 32px rgba(14, 26, 33, 0.07);
--shadow-xl:   0 16px 48px rgba(14, 26, 33, 0.15), 0 32px 64px rgba(14, 26, 33, 0.08);
```

### 5.2 Focus Glow

Focus states use a cobalt glow, not a border ring:

```css
--shadow-focus: 0 0 0 3px rgba(19, 153, 244, 0.25);  /* cobalt-200 at 25% */
--shadow-focus-error: 0 0 0 3px rgba(220, 38, 38, 0.20);
```

### 5.3 Glassmorphism (Elevated Overlays Only)

Used exclusively on overlay surfaces (modals, dropdown panels, sticky headers on scroll):

```css
--glass-bg:     rgba(255, 255, 255, 0.80);
--glass-blur:   backdrop-filter: blur(12px) saturate(180%);
--glass-border: 1px solid rgba(255, 255, 255, 0.60);
```

**Rule:** Never apply glass effects to card surfaces in the main content area. Glass is reserved for UI chrome that floats above content.

---

## 6. Border & Radius

### 6.1 Border Tokens

```css
--border-width-1: 1px;
--border-width-2: 2px;

--border-default: 1px solid #C5C7D9;      /* grey-200 */
--border-subtle:  1px solid #F4F6F7;      /* grey-100 */
--border-strong:  1px solid #A0A5B9;      /* grey-300 */
--border-focus:   2px solid #6066D5;      /* blue-400 */
--border-accent:  1px solid #1399F4;      /* cobalt-200 */
--border-error:   1px solid #DC2626;
--border-success: 1px solid #16A34A;
```

### 6.2 Radius Scale

This is infrastructure software — radii are tight and deliberate.

| Token | Value | Use Case |
|-------|-------|----------|
| `radius-none` | `0px` | Tables, code blocks, inset wells |
| `radius-xs` | `2px` | Badges, tags, inline chips |
| `radius-sm` | `4px` | Buttons (small), form inputs |
| `radius-md` | `6px` | Cards, panels, default components |
| `radius-lg` | `8px` | Modals, large containers |
| `radius-xl` | `12px` | Maximum allowed — full-page containers |
| `radius-full` | `9999px` | Pills, avatar frames only |

```css
--radius-none: 0px;
--radius-xs:   2px;
--radius-sm:   4px;
--radius-md:   6px;
--radius-lg:   8px;
--radius-xl:   12px;
--radius-full: 9999px;
```

**Hard rule:** No card should have a border radius greater than `8px`. The `radius-xl` (12px) is reserved for page-level containers or promotional modules — never standard data cards.

---

## 7. Motion & Animation

### 7.1 Principles

- Enters use **ease-out** (start fast, decelerate to rest)
- Exits use **ease-in** (start slow, accelerate out of view)
- State changes use **ease-in-out**
- Duration scales with spatial distance and element size
- Never animate layout properties (`width`, `height`) — use `transform` and `opacity`

### 7.2 Easing Curves

```css
--ease-out:     cubic-bezier(0.16, 1, 0.3, 1);      /* Enters */
--ease-in:      cubic-bezier(0.7, 0, 0.84, 0);      /* Exits */
--ease-in-out:  cubic-bezier(0.45, 0, 0.55, 1);     /* State changes */
--ease-linear:  linear;                               /* Progress bars, countdowns */
```

### 7.3 Duration Scale

```css
--duration-instant:  50ms;   /* Immediate feedback (button press ripple) */
--duration-fast:     120ms;  /* Micro-interactions (hover state, focus ring) */
--duration-normal:   200ms;  /* Standard transitions (card lift, color change) */
--duration-slow:     350ms;  /* Page elements, modals appearing */
--duration-slower:   500ms;  /* Scroll reveals, skeleton-to-content */
```

### 7.4 Stagger Delay

When animating lists or card grids, stagger items to create a cascade effect:

```css
--stagger-base: 60ms;

/* Applied via nth-child in JS or CSS */
.card:nth-child(1) { animation-delay: 0ms; }
.card:nth-child(2) { animation-delay: 60ms; }
.card:nth-child(3) { animation-delay: 120ms; }
.card:nth-child(4) { animation-delay: 180ms; }
/* Cap at 5th element — beyond that, no additional delay */
```

### 7.5 Animation Patterns

#### Page Load — Staggered Card Reveals

```css
@keyframes card-reveal {
  from {
    opacity: 0;
    transform: translateY(12px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.card-enter {
  animation: card-reveal var(--duration-slow) var(--ease-out) both;
}
```

#### Card Hover — Subtle Lift + Border Glow

```css
.card {
  transition:
    transform var(--duration-fast) var(--ease-out),
    box-shadow var(--duration-fast) var(--ease-out),
    border-color var(--duration-fast) var(--ease-out);
}

.card:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-md);
  border-color: var(--border-accent); /* cobalt-200 */
}
```

#### Data Updates — Smooth Number Transitions

```css
@keyframes number-update {
  0%   { opacity: 0.4; transform: translateY(-4px) scale(0.97); }
  100% { opacity: 1;   transform: translateY(0) scale(1); }
}

.value-updating {
  animation: number-update var(--duration-normal) var(--ease-out);
}
```

#### Status Changes — Color Fade

```css
.status-badge {
  transition:
    background-color var(--duration-normal) var(--ease-in-out),
    color var(--duration-normal) var(--ease-in-out),
    border-color var(--duration-normal) var(--ease-in-out);
}
```

#### Loading States — Skeleton Shimmer

```css
@keyframes skeleton-shimmer {
  0%   { background-position: -400px 0; }
  100% { background-position: 400px 0; }
}

.skeleton {
  background: linear-gradient(
    90deg,
    #F4F6F7 25%,
    #E8ECF0 50%,
    #F4F6F7 75%
  );
  background-size: 400px 100%;
  animation: skeleton-shimmer 1.4s ease-in-out infinite;
  border-radius: var(--radius-xs);
}
```

#### Scroll Reveals — Intersection Observer

```css
@keyframes scroll-reveal {
  from {
    opacity: 0;
    transform: translateY(20px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.reveal {
  opacity: 0;
}

.reveal.is-visible {
  animation: scroll-reveal var(--duration-slower) var(--ease-out) both;
}
```

#### Focus Ring

```css
:focus-visible {
  outline: none;
  box-shadow: var(--shadow-focus);
  border-radius: var(--radius-sm);
}
```

### 7.6 Reduced Motion

All animations must be wrapped in a motion preference check:

```css
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

### 7.7 Anti-Patterns

| Never Do | Reason |
|----------|--------|
| Bounce / spring easing | Consumer-app feel, inconsistent with scientific tone |
| 3D transforms (`rotateX`, `rotateY`) | Disorienting, no semantic value |
| Infinite pulsing animations (except skeleton) | Distracting in data-dense contexts |
| Animating `width` or `height` | Performance, layout thrashing |
| Durations > 600ms on UI interactions | Feels broken, not intentional |
| Scale > 1.04 on hover | Too aggressive for infrastructure UI |

---

## 8. Component Patterns

All components use the same foundational tokens. This section defines visual structure and state behaviors — not React implementation.

### 8.1 Challenge Card

**Anatomy:**
- Domain tag (top-left badge, `radius-xs`)
- Status indicator pill (top-right, color-coded)
- Challenge title (`text-lg`, `font-semibold`, Space Grotesk, max 2 lines)
- Description (`text-sm`, `text-secondary`, max 3 lines, truncated)
- Reward badge (Cobalt 200 background, monospace USDC amount)
- Deadline (`text-xs`, `text-tertiary`, clock icon prefix)
- Submission count (`text-xs`, `text-muted`)
- Hover: `translateY(-2px)`, `shadow-md`, `border-color: cobalt-200`

**Status pill colors:**
| Status | Background | Text | Border |
|--------|-----------|------|--------|
| Open | `#F0FDF4` | `#16A34A` | `#BBF7D0` |
| Closed | `#F4F6F7` | `#646872` | `#C5C7D9` |
| Review | `#FFFBEB` | `#D97706` | `#FDE68A` |
| Awarded | `cobalt-100` | `cobalt-500` | `cobalt-200` |

### 8.2 Stat Card

**Anatomy:**
- Label (`text-xs`, uppercase, `letter-spacing: +0.08em`, `text-tertiary`)
- Primary value (`text-3xl` or `text-4xl`, Space Grotesk, `text-primary`)
- Unit suffix (`text-lg`, `text-secondary`, inline)
- Trend indicator (arrow icon + delta value, `text-sm`)
  - Positive: green (`#16A34A`)
  - Negative: red (`#DC2626`)
  - Neutral: `text-muted`
- Subtle sparkline (optional, `grey-200` stroke, no fill)

**Layout:** Generous padding (`space-6`), flat surface, `shadow-xs`, `radius-md`.

### 8.3 Leaderboard Table

**Anatomy:**
- Header row: `text-xs`, uppercase, `text-tertiary`, `border-bottom: border-default`
- Row hover: `surface-inset` background tint
- Rank: `text-sm`, `font-mono`, fixed-width, right-aligned
- Address: `text-sm`, `font-mono`, truncated `(0x1a2b…9f0a)`, with copy-on-click
- Score: `text-sm`, `font-mono`, `tabular-nums`, right-aligned
- Status badge: inline pill, same color system as Challenge Card status
- Row dividers: `border-subtle` (not `border-default` — keep it light)

```
| Rank | Address         | Score    | Status   |
|------|-----------------|----------|----------|
| #1   | 0x1a2b…9f0a    | 98.742   | Awarded  |
| #2   | 0x3c4d…1e2f    | 94.100   | Review   |
```

### 8.4 Form Controls

**Text Input:**
- Background: `#FFFFFF`
- Border: `border-default` at rest
- Border on focus: `border-focus` (blue-400) + `shadow-focus`
- Border on error: `border-error` + `shadow-focus-error`
- Padding: `10px 14px`
- Radius: `radius-sm` (4px)
- Font: Inter, `text-base`
- Placeholder: `text-muted`
- Transition: border-color and box-shadow, `duration-fast`

**Select:** Same as input, custom chevron icon (Lucide `ChevronDown`, `grey-400`).

**Textarea:** Same as input, `min-height: 96px`, `resize: vertical` only.

**Form Label:** `text-sm`, `font-medium`, `text-primary`, `margin-bottom: space-2`.

**Helper text:** `text-xs`, `text-tertiary`, `margin-top: space-1`.

**Error message:** `text-xs`, `color: --color-error`, Lucide `AlertCircle` icon prefix.

### 8.5 Buttons

| Variant | Background | Text | Border | Hover |
|---------|-----------|------|--------|-------|
| **Primary** | `cobalt-200` (`#1399F4`) | White | none | `cobalt-300` bg |
| **Secondary** | Transparent | `cobalt-200` | `border-accent` | `cobalt-100` bg tint |
| **Ghost** | Transparent | `text-secondary` | none | `surface-inset` bg |
| **Danger** | Transparent | `#DC2626` | `1px solid #DC2626` | `#FEF2F2` bg |

**Shared rules:**
- Radius: `radius-sm` (4px)
- Font: Inter, `font-medium`, `text-sm`
- Transition: background, color, shadow — `duration-fast`
- Disabled: 40% opacity, `cursor: not-allowed`
- Focus: `shadow-focus`
- Loading state: replace label with skeleton shimmer width, never a spinner

**Size variants:**

| Size | Padding | Font size |
|------|---------|-----------|
| sm | `6px 12px` | `text-xs` |
| md | `10px 20px` | `text-sm` |
| lg | `12px 24px` | `text-base` |

### 8.6 Badges & Tags

**Domain tags** (e.g., "Genomics", "Protein Folding", "ML"):
- Background: `blue-100` (`#F4F6FC`)
- Text: `blue-500` (`#3E4BA1`)
- Border: `1px solid #BBC6F4` (blue-200)
- Radius: `radius-xs` (2px)
- Font: `text-xs`, `font-medium`
- Padding: `2px 8px`

**Status pills:** See Challenge Card status table above.

**Reward badge:**
- Background: `cobalt-100` (`#E0F3FF`)
- Text: `cobalt-500` (`#006581`), monospace, tabular-nums
- Border: `1px solid #1399F4` (cobalt-200)
- Radius: `radius-xs`
- Prefix: USDC logo icon or "$" mark

### 8.7 Navigation

**Structure:**
```
[Hermes wordmark]  [Challenges] [Leaderboard] [Docs]        [Connect Wallet]
```

- Background: `#FFFFFF`, `border-bottom: border-default`
- Sticky on scroll with glass effect: `--glass-bg` + `--glass-blur`
- Height: `64px`
- Wordmark: Space Grotesk, `font-bold`, `text-xl`, `text-primary`
- Nav links: Inter, `text-sm`, `font-medium`, `text-secondary`
- Nav link active: `text-accent` (cobalt-200), bottom border `2px solid cobalt-200`
- Nav link hover: `text-primary`, `duration-fast`
- Connect Wallet button: Primary button variant, `text-sm`
- Mobile: hamburger at `md` breakpoint, drawer pattern

### 8.8 Challenge Timeline

Vertical step indicator for challenge lifecycle (Post → Open → Submission → Review → Award):

- Container: left-aligned, `padding-left: space-8`
- Step line: `1px solid border-default`, runs between nodes
- Completed step node: `cobalt-200` fill, white check icon
- Active step node: `cobalt-200` border, white fill, pulsing glow `shadow-focus`
- Future step node: `grey-200` fill, `grey-300` border
- Step label: `text-sm`, `font-medium`, `text-primary` (active), `text-muted` (future)
- Step date: `text-xs`, `text-tertiary`

### 8.9 Toast / Notifications

Positioned: top-right, `space-4` from edge. Stack with `space-2` gap.

| Type | Left accent | Icon | Background |
|------|------------|------|------------|
| Success | `#16A34A` | `CheckCircle` | `#FFFFFF` |
| Error | `#DC2626` | `XCircle` | `#FFFFFF` |
| Warning | `#D97706` | `AlertTriangle` | `#FFFFFF` |
| Info | `cobalt-200` | `Info` | `#FFFFFF` |

- Structure: `shadow-lg`, `radius-md`, `border-default`, `padding: space-4`
- Left colored stripe: `4px wide`, `radius-xs` on left edge
- Title: `text-sm`, `font-semibold`
- Body: `text-sm`, `text-secondary`
- Auto-dismiss: 5000ms, progress bar at bottom (linear, `duration: 5000ms`)
- Enter: slide from right, `translateX(calc(100% + space-4))` to `0`, `duration-slow`
- Exit: slide to right, `duration-normal`

### 8.10 Empty States

Terminal-style aesthetic — sparse, purposeful:

```
╔════════════════════════════╗
║  $ hermes query --open     ║
║  > No challenges found.    ║
║  > Try adjusting filters.  ║
║  _                         ║
╚════════════════════════════╝
```

- Background: `surface-inset` (`blue-100`)
- Font: JetBrains Mono, `text-sm`
- Text: `text-tertiary`
- Blinking cursor: CSS animation, `1s step-end infinite`
- CTA below: Ghost button or Secondary button
- Max width: `480px`, centered

### 8.11 Loading / Skeleton States

**Rule:** Always use skeletons — never spinners for page-level content.

Skeleton elements match the exact dimensions of the content they replace:

```css
/* Skeleton for a card title */
.skeleton-title {
  height: 20px;
  width: 65%;
}

/* Skeleton for a stat value */
.skeleton-stat {
  height: 36px;
  width: 120px;
}

/* Skeleton for body text (2-3 lines) */
.skeleton-body > * { height: 14px; margin-bottom: 8px; }
.skeleton-body > *:last-child { width: 75%; }
```

Apply `skeleton` class (shimmer keyframe from Section 7.5) to all skeleton elements.

---

## 9. Iconography

### 9.1 Library

Use **Lucide React** exclusively. No mixing with other icon libraries.

```tsx
import { ArrowRight, CheckCircle, AlertTriangle } from 'lucide-react';
```

### 9.2 Size Scale

| Size token | px value | Context |
|------------|----------|---------|
| `icon-xs` | 12px | Inline with `text-xs`, metadata |
| `icon-sm` | 14px | Inline with `text-sm`, form labels |
| `icon-md` | 16px | Default — inline with body text, buttons |
| `icon-lg` | 20px | Card headers, section titles |
| `icon-xl` | 24px | Navigation, prominent UI elements |
| `icon-2xl` | 32px | Empty states, feature callouts |

### 9.3 Usage Rules

- Icons are always paired with a visible label unless the action is universally understood (close, copy) — and even then, include `aria-label`
- Icon color inherits from text color by default. Never set icon color independently of its label
- Use `stroke-width={1.5}` on icons at `icon-xl` and above; default `stroke-width={2}` below
- Never use filled/solid icon variants — Lucide's outline style matches the schematic aesthetic

### 9.4 Icons vs. Text

| Use icon | Use text |
|----------|----------|
| Status indicators (alongside text label) | Primary navigation links |
| Action buttons with space constraints | Data table column headers |
| Empty state illustration | Form labels (icon prefix only) |
| Toast notification type | Headings and titles |

---

## 10. Accessibility

### 10.1 Contrast Ratios

All text must meet **WCAG AA** minimum. Critical interactive elements should meet **AAA**.

| Combination | Ratio | Grade |
|-------------|-------|-------|
| grey-600 `#1C2A3E` on white | 12.4:1 | AAA |
| grey-500 `#464B52` on white | 7.5:1 | AAA |
| grey-400 `#646872` on white | 4.8:1 | AA |
| grey-300 `#A0A5B9` on white | 3.2:1 | AA (large text only) |
| cobalt-200 `#1399F4` on white | 3.1:1 | AA (large text only) |
| White on cobalt-200 `#1399F4` | 3.1:1 | AA (large text only — use for buttons only) |
| White on cobalt-500 `#006581` | 5.8:1 | AA |
| White on blue-500 `#3E4BA1` | 7.2:1 | AAA |

**Rule:** Never use `grey-300` or lighter as body text. `grey-300` is only acceptable at `text-lg` and above, or as placeholder text.

### 10.2 Focus Indicators

All interactive elements must have a visible, non-color-only focus indicator:

```css
/* Global focus-visible rule */
:focus-visible {
  outline: none;
  box-shadow: 0 0 0 3px rgba(19, 153, 244, 0.30),
              0 0 0 1px #1399F4;
}

/* High-contrast override */
@media (forced-colors: active) {
  :focus-visible {
    outline: 3px solid ButtonText;
  }
}
```

### 10.3 Reduced Motion

```css
@media (prefers-reduced-motion: reduce) {
  .skeleton {
    animation: none;
    background: #F4F6F7;
  }
  
  .card-enter,
  .reveal {
    animation: none;
    opacity: 1;
    transform: none;
  }
}
```

### 10.4 Keyboard Navigation

| Pattern | Implementation |
|---------|----------------|
| Tab order | Logical DOM order — never use `tabindex > 0` |
| Modal trap | Focus trapped within modal; `Escape` closes |
| Dropdown | Arrow keys navigate options; `Enter` selects; `Escape` closes |
| Table | Row focus with arrow key navigation for data tables |
| Skip link | Visible on focus: "Skip to main content" at page top |

### 10.5 ARIA Patterns

- All icon-only buttons: `aria-label` required
- Status badges: `aria-label="Status: Open"` (not just visual color)
- Loading skeletons: `aria-busy="true"` on the container, `aria-label="Loading..."` 
- Toast notifications: `role="alert"` for errors, `role="status"` for info/success
- Countdown timers: `aria-live="polite"` updates

---

## 11. Anti-Patterns

Clear rules for what this design system explicitly prohibits.

| Category | Don't | Do Instead |
|----------|-------|-----------|
| **Radius** | Cards with 16px+ corner radius | Max 8px on cards (`radius-lg`), max 12px on page containers |
| **Color** | Pastel gradients (pink, lavender, mint) | Molecule Blue range only |
| **Color** | Purple-to-turquoise gradients | Same-hue two-step gradients |
| **Color** | Turquoise (`#11F1F1`) in gradients | Use turquoise for status indicators only |
| **Color** | Arbitrary brand colors not in the palette | Molecule Blue A/B/C range chips |
| **Typography** | Decorative or display-only fonts | Space Grotesk (display), Inter (body), JetBrains Mono (data) |
| **Typography** | Proportional numbers for financial data | `font-variant-numeric: tabular-nums` + JetBrains Mono |
| **Typography** | ALL CAPS body text | Uppercase reserved for `text-xs` metadata labels only |
| **Animation** | Bounce or spring easing | `ease-out` for enters, `ease-in` for exits |
| **Animation** | 3D CSS transforms | `translateY` and `opacity` only |
| **Animation** | Spinners for page content | Skeleton shimmer screens |
| **Animation** | Durations > 600ms on user interactions | Max `duration-slow` (350ms) for UI responses |
| **Animation** | Infinite pulsing/bouncing UI elements | Static with hover-triggered transitions |
| **Layout** | Cookie-cutter equal-width card grids | Bento grid with intentional size hierarchy |
| **Layout** | Arbitrary spacing values | Multiples of 4px only |
| **Images** | Generic stock photography | Data visualizations, diagrams, schematics |
| **Components** | Spinners as primary loading state | Skeleton screens |
| **Components** | Toast notifications that require interaction | Auto-dismiss (5s) with progress indicator |
| **Density** | Excessive whitespace in data tables | Compact table rows (`12px 16px` padding) |
| **Shadows** | Colorful or tinted shadows | Monochromatic shadows using `grey-800` at low opacity |

---

## 12. CSS Custom Properties Reference

Complete `:root` block. Copy-paste into `globals.css`. Dark theme overrides follow.

```css
/* ============================================================
   HERMES DESIGN SYSTEM — CSS CUSTOM PROPERTIES
   v1.0 | Light theme (default) + Dark theme override
   ============================================================ */

:root {
  /* ----------------------------------------------------------
     MOLECULE BLUE PALETTE
  ---------------------------------------------------------- */

  /* A-range: Grey Neutrals */
  --grey-100:  #F4F6F7;
  --grey-200:  #C5C7D9;
  --grey-300:  #A0A5B9;
  --grey-400:  #646872;
  --grey-500:  #464B52;
  --grey-600:  #1C2A3E;
  --grey-700:  #162731;
  --grey-800:  #0E1A21;
  --grey-900:  #0A1419;
  --grey-1000: #050B0D;
  --grey-1100: #011706;

  /* B-range: Core Blues */
  --blue-100:  #F4F6FC;
  --blue-200:  #BBC6F4;
  --blue-300:  #8697F7;
  --blue-400:  #6066D5;
  --blue-500:  #3E4BA1;
  --blue-600:  #242E6D;
  --blue-700:  #1E2A61;
  --blue-800:  #0D1648;
  --blue-900:  #112F3F;
  --blue-1000: #061726;
  --blue-1100: #0D0F20;

  /* C-range: Cobalts */
  --cobalt-100:  #E0F3FF;
  --cobalt-200:  #1399F4;
  --cobalt-300:  #0F86D9;
  --cobalt-400:  #0A6BB5;
  --cobalt-500:  #006581;
  --cobalt-600:  #0D4B6E;
  --cobalt-700:  #044A58;
  --cobalt-800:  #022C3E;
  --cobalt-900:  #033A45;
  --cobalt-1000: #012B31;
  --cobalt-1100: #012B31;

  /* Accents */
  --purple-100: #9562F7;
  --purple-250: #6F1CE3;
  --turquoise:  #11F1F1;
  --white:      #F1F1F1;

  /* ----------------------------------------------------------
     SEMANTIC TOKENS — LIGHT THEME
  ---------------------------------------------------------- */

  /* Surfaces */
  --surface-base:     var(--grey-100);
  --surface-default:  #FFFFFF;
  --surface-elevated: #FFFFFF;
  --surface-overlay:  rgba(255, 255, 255, 0.85);
  --surface-inset:    var(--blue-100);

  /* Text */
  --text-primary:   var(--grey-600);
  --text-secondary: var(--grey-500);
  --text-tertiary:  var(--grey-400);
  --text-muted:     var(--grey-300);
  --text-accent:    var(--cobalt-200);
  --text-inverse:   var(--white);

  /* Borders */
  --border-default: 1px solid var(--grey-200);
  --border-subtle:  1px solid var(--grey-100);
  --border-strong:  1px solid var(--grey-300);
  --border-focus:   2px solid var(--blue-400);
  --border-accent:  1px solid var(--cobalt-200);
  --border-error:   1px solid #DC2626;
  --border-success: 1px solid #16A34A;

  /* Interactive */
  --interactive-default: var(--cobalt-200);
  --interactive-hover:   var(--cobalt-300);
  --interactive-active:  var(--cobalt-400);
  --interactive-focus:   var(--blue-400);
  --interactive-disabled-bg:   var(--grey-100);
  --interactive-disabled-text: var(--grey-300);

  /* Status */
  --status-success:        #16A34A;
  --status-success-bg:     #F0FDF4;
  --status-success-border: #BBF7D0;
  --status-warning:        #D97706;
  --status-warning-bg:     #FFFBEB;
  --status-warning-border: #FDE68A;
  --status-error:          #DC2626;
  --status-error-bg:       #FEF2F2;
  --status-error-border:   #FECACA;
  --status-info:           var(--cobalt-200);
  --status-info-bg:        var(--cobalt-100);
  --status-info-border:    var(--blue-200);

  /* ----------------------------------------------------------
     TYPOGRAPHY
  ---------------------------------------------------------- */

  --font-display: 'Space Grotesk', system-ui, -apple-system, sans-serif;
  --font-body:    'Inter', system-ui, -apple-system, sans-serif;
  --font-mono:    'JetBrains Mono', 'Fira Code', 'Courier New', monospace;

  --text-xs:   0.6875rem;  /* 11px */
  --text-sm:   0.8125rem;  /* 13px */
  --text-base: 0.9375rem;  /* 15px */
  --text-md:   1.0625rem;  /* 17px */
  --text-lg:   1.25rem;    /* 20px */
  --text-xl:   1.5rem;     /* 24px */
  --text-2xl:  1.875rem;   /* 30px */
  --text-3xl:  2.25rem;    /* 36px */
  --text-4xl:  3rem;       /* 48px */

  --weight-regular:  400;
  --weight-medium:   500;
  --weight-semibold: 600;
  --weight-bold:     700;

  /* ----------------------------------------------------------
     SPACING
  ---------------------------------------------------------- */

  --space-1:  4px;
  --space-2:  8px;
  --space-3:  12px;
  --space-4:  16px;
  --space-5:  20px;
  --space-6:  24px;
  --space-8:  32px;
  --space-10: 40px;
  --space-12: 48px;
  --space-16: 64px;
  --space-20: 80px;
  --space-24: 96px;
  --space-32: 128px;

  /* ----------------------------------------------------------
     BORDER RADIUS
  ---------------------------------------------------------- */

  --radius-none: 0px;
  --radius-xs:   2px;
  --radius-sm:   4px;
  --radius-md:   6px;
  --radius-lg:   8px;
  --radius-xl:   12px;
  --radius-full: 9999px;

  /* ----------------------------------------------------------
     SHADOWS
  ---------------------------------------------------------- */

  --shadow-none: none;
  --shadow-xs:   0 1px 2px rgba(14, 26, 33, 0.06), 0 1px 3px rgba(14, 26, 33, 0.04);
  --shadow-sm:   0 2px 4px rgba(14, 26, 33, 0.08), 0 4px 8px rgba(14, 26, 33, 0.05);
  --shadow-md:   0 4px 12px rgba(14, 26, 33, 0.10), 0 8px 16px rgba(14, 26, 33, 0.06);
  --shadow-lg:   0 8px 24px rgba(14, 26, 33, 0.12), 0 16px 32px rgba(14, 26, 33, 0.07);
  --shadow-xl:   0 16px 48px rgba(14, 26, 33, 0.15), 0 32px 64px rgba(14, 26, 33, 0.08);
  --shadow-focus:       0 0 0 3px rgba(19, 153, 244, 0.25);
  --shadow-focus-error: 0 0 0 3px rgba(220, 38, 38, 0.20);

  /* ----------------------------------------------------------
     MOTION
  ---------------------------------------------------------- */

  --ease-out:    cubic-bezier(0.16, 1, 0.3, 1);
  --ease-in:     cubic-bezier(0.7, 0, 0.84, 0);
  --ease-in-out: cubic-bezier(0.45, 0, 0.55, 1);
  --ease-linear: linear;

  --duration-instant: 50ms;
  --duration-fast:    120ms;
  --duration-normal:  200ms;
  --duration-slow:    350ms;
  --duration-slower:  500ms;

  --stagger-base: 60ms;

  /* ----------------------------------------------------------
     GLASSMORPHISM
  ---------------------------------------------------------- */

  --glass-bg:     rgba(255, 255, 255, 0.80);
  --glass-border: rgba(255, 255, 255, 0.60);

  /* ----------------------------------------------------------
     LAYOUT
  ---------------------------------------------------------- */

  --page-max-width:    1280px;
  --page-padding-x:    var(--space-6);
  --page-padding-x-lg: var(--space-8);

  --container-sm:  640px;
  --container-md:  768px;
  --container-lg:  1024px;
  --container-xl:  1280px;
  --container-2xl: 1440px;

  /* ----------------------------------------------------------
     ICON SIZES
  ---------------------------------------------------------- */

  --icon-xs:  12px;
  --icon-sm:  14px;
  --icon-md:  16px;
  --icon-lg:  20px;
  --icon-xl:  24px;
  --icon-2xl: 32px;
}

/* ============================================================
   DARK THEME OVERRIDES
   Apply via [data-theme="dark"] or .dark class on <html>
   ============================================================ */

[data-theme="dark"],
.dark {
  /* Surfaces */
  --surface-base:     var(--blue-1100);  /* #0D0F20 */
  --surface-default:  var(--blue-1000);  /* #061726 */
  --surface-elevated: var(--blue-900);   /* #112F3F */
  --surface-overlay:  rgba(13, 15, 32, 0.85);
  --surface-inset:    var(--blue-800);   /* #0D1648 */

  /* Text */
  --text-primary:   #F1F1F1;
  --text-secondary: var(--grey-200);     /* #C5C7D9 */
  --text-tertiary:  var(--grey-300);     /* #A0A5B9 */
  --text-muted:     var(--grey-400);     /* #646872 */
  --text-accent:    var(--cobalt-200);   /* #1399F4 */
  --text-inverse:   var(--grey-600);     /* #1C2A3E */

  /* Borders */
  --border-default: 1px solid var(--blue-700);  /* #1E2A61 */
  --border-subtle:  1px solid var(--blue-800);  /* #0D1648 */
  --border-strong:  1px solid var(--blue-600);  /* #242E6D */

  /* Shadows (adjusted for dark bg) */
  --shadow-xs: 0 1px 2px rgba(0, 0, 0, 0.30), 0 1px 3px rgba(0, 0, 0, 0.20);
  --shadow-sm: 0 2px 4px rgba(0, 0, 0, 0.35), 0 4px 8px rgba(0, 0, 0, 0.25);
  --shadow-md: 0 4px 12px rgba(0, 0, 0, 0.40), 0 8px 16px rgba(0, 0, 0, 0.28);
  --shadow-lg: 0 8px 24px rgba(0, 0, 0, 0.45), 0 16px 32px rgba(0, 0, 0, 0.30);
  --shadow-xl: 0 16px 48px rgba(0, 0, 0, 0.50), 0 32px 64px rgba(0, 0, 0, 0.35);

  /* Glassmorphism (dark) */
  --glass-bg:     rgba(13, 15, 32, 0.80);
  --glass-border: rgba(255, 255, 255, 0.08);

  /* Status backgrounds (darkened for dark theme) */
  --status-success-bg:     rgba(22, 163, 74, 0.12);
  --status-warning-bg:     rgba(217, 119, 6, 0.12);
  --status-error-bg:       rgba(220, 38, 38, 0.12);
  --status-info-bg:        rgba(19, 153, 244, 0.12);
}

/* ============================================================
   REDUCED MOTION OVERRIDE
   ============================================================ */

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

---

*Hermes Design System · Molecule · Last updated February 2026*
