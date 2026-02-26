---
name: hermes-frontend-design
description: Build the Hermes web UI with production-grade aesthetics rooted in the Molecule Blue / Institutional Cybernetics identity. Use this skill when implementing any frontend component, page, or layout for the Hermes platform.
---

# Hermes Frontend Design Skill

This skill guides creation of the Hermes web interface — an agent-native, on-chain science bounty platform. Every screen must feel like institutional-grade biotech infrastructure, not a generic SaaS dashboard.

**Read `docs/ui-specs/hermes-ui-vibe.md` first** — it is the canonical visual identity spec.

---

## Design Identity: Institutional Cybernetics

**Vibe:** Clean Bio-Tech terminal meets cryptographic settlement layer.
**Feel:** Bloomberg Terminal × DeepMind research dashboard × on-chain escrow system.

### Colour System (Molecule Blue)

Use CSS custom properties. Never hardcode hex values outside `:root`.

```css
:root {
  /* Backgrounds */
  --bg-deep:       #0A192F;   /* Near-black blue — primary canvas */
  --bg-surface:    #112240;   /* Card/panel surfaces */
  --bg-elevated:   #1E3A8A;   /* Hover states, active panels */

  /* Accents */
  --accent-cyan:   #00FFFF;   /* Primary action — Active bounties, CTAs, "hm post" */
  --accent-purple: #9D7CFF;   /* Verification, cryptographic hashes, completed states */
  --accent-green:  #00FF88;   /* Success states, score matches */
  --accent-red:    #FF3366;   /* Errors, disputes, mismatches */

  /* Text */
  --text-primary:  #FFFFFF;   /* Headers, primary reading */
  --text-secondary:#94A3B8;   /* Muted labels, timestamps */
  --text-mono:     #00FFFF;   /* Wallet addresses, hashes, USDC amounts */
}
```

### Typography

Two font tracks — never mix them:

| Track | Font | Usage |
|-------|------|-------|
| **Structural** | Roobert, Inter, or equivalent grotesque sans-serif | Nav, headers, descriptions, labels |
| **Cryptographic** | JetBrains Mono or Space Mono | Wallet addresses (`0x4B...`), IPFS hashes (`ipfs://Qm...`), USDC amounts, container digests, scores |

- Leaderboard scores and agent wallets must use **strict tabular alignment** (monospace + `font-variant-numeric: tabular-nums`)
- USDC amounts always rendered in monospace with 2 decimal places: `500.00 USDC`

> **Anti-pattern:** Do NOT use decorative or display fonts. This is infrastructure, not a landing page. Readability > personality.

---

## Motion & Animation

Borrow from the Anthropic frontend-design playbook but constrain to the Hermes identity:

### Page Load
- **Staggered reveals**: Cards and data rows fade-slide up with `animation-delay` increments (30–50ms per item)
- Background gradient should shift subtly on load (deep blue → slightly lighter) to suggest the system "powering on"

### Terminal Feed (Activity Log)
- New entries **slide in from bottom**, pushing older entries up
- Use `translateY` + `opacity` transition, 200ms ease-out
- Optional: monospace characters "type in" letter by letter for dramatic entries (finalization, disputes)

### Hover & Interaction
- Challenge cards: subtle gradient shift + glowing `1px` border (cyan or purple depending on status)
- Buttons: `box-shadow` glow pulse on hover (use `--accent-cyan` with varying opacity)
- Hash/address links: gentle underline slide-in on hover

### Scroll
- Parallax-lite: background grid or noise texture scrolls at 0.3× speed for depth
- Leaderboard rows highlight as they enter viewport

### Constraints
- **No bounce/spring animations** — too playful for this aesthetic
- **No 3D transforms** — keep it flat, terminal-like
- **Prefer CSS-only** animations. Use `framer-motion` or `Motion` only for orchestrated sequences

---

## Spatial Composition & Layout

### Grid Philosophy: "The Matrix"
- Use visible `1px` borders (`rgba(0, 255, 255, 0.08)`) for structural grid lines
- Users should feel the underlying data grid
- Hard edges: `border-radius: 0px` to `4px` max — brutalist infrastructure, not rounded consumer UI

### Density
- **High information density** — this platform is for agents and technical researchers
- Compact spacing in leaderboards and terminal feeds
- Generous whitespace only in hero/header areas for breathing room

### Glassmorphism (Selective)
- Card surfaces: `backdrop-filter: blur(12px)` + `background: rgba(17, 34, 64, 0.7)`
- Use sparingly — 1–2 elevated panels per view, not everywhere

---

## Background & Depth

Create atmosphere, never use flat solid backgrounds:

- **Base layer**: Deep blue (`--bg-deep`) with a subtle radial gradient (slightly lighter at center)
- **Grid overlay**: Faint geometric grid lines (`rgba(0, 255, 255, 0.03)`) — simulates a data matrix
- **Noise texture**: Subtle grain overlay at 2–5% opacity for analog warmth
- **Accent glow**: Soft radial gradient from `--accent-cyan` or `--accent-purple` behind key focal elements (hero stats, active challenge count)

---

## Key Component Patterns

### Challenge Card (Feed View)
- Sharp corners, `1px` border (`rgba(0, 255, 255, 0.15)`)
- Title: bold sans-serif, white
- Reward: prominent, monospace, cyan — `500.00 USDC`
- Domain tags: small pills with subtle background (`longevity`, `drug_discovery`)
- Status indicator: coloured dot (cyan = active, purple = scoring, green = finalized)
- Hover: gradient shift + border glow

### Leaderboard Table
- Strict tabular alignment (monospace for all numeric/address columns)
- Alternating row backgrounds with near-invisible contrast
- Rank column: `#1` highlighted with accent glow
- Score column: right-aligned, fixed 4 decimal places
- Wallet column: truncated with tooltip (`0x4B2f...8a3C`)

### Terminal Feed / Activity Log
- Styled as a polished real-time console
- Timestamp in muted text: `[04:22:11]`
- Action in white: `Agent 0x4B... submitted proof`
- Hash links in cyan monospace: `→ QmXy...`
- New entries animate in from bottom

### Action Buttons (CTAs)
- Primary: solid `--accent-cyan` background, dark text, subtle glow
- Secondary: transparent with `1px` cyan border
- Danger: `--accent-red` treatment for disputes/cancellations
- All buttons: no border-radius or max `2px`

---

## Anti-Slop Guardrails

**NEVER produce these generic patterns:**

| ❌ Avoid | ✅ Instead |
|----------|-----------|
| Purple gradient on white background | Deep blue canvas with cyan/purple accents |
| Rounded `16px` cards everywhere | Sharp `0–4px` corners, visible borders |
| Generic hero with stock photo | Data-driven hero: live stats, active challenge count |
| Evenly distributed pastel palette | Dominant dark blue + sharp cyan/purple accents |
| Empty placeholder states | Zero-data states with terminal aesthetic (`No active bounties. Run hm post to create one.`) |
| Generic loading spinners | Terminal-style progress (`Indexing block 14,522,301...`) |
| Cookie-cutter grid of identical cards | Varied card densities — featured challenges get more space |

---

## Technical Notes

- **Framework**: React (Vite for mockup, Next.js 14 for production)
- **Styling**: CSS Modules or vanilla CSS with CSS custom properties (no Tailwind unless project migrates)
- **Fonts**: Load via Google Fonts or self-host (Roobert may need self-hosting)
- **Icons**: Minimal — use text symbols and unicode where possible (terminal aesthetic)
- **Responsive**: Desktop-first (agent users are on desktop), but ensure tablet readability
