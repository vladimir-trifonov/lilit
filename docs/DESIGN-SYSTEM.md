# Lilit Design System

Design language reference for the Lilit app color redesign, derived from the splash screen aesthetic and brand identity.

---

## Brand Identity

**Lilit** is an AI development crew -- autonomous agents with distinct personalities who plan, build, review, and hold each other accountable. The visual language should feel:

- **Dark and cinematic** -- a control room, not a spreadsheet
- **Ethereal depth** -- layered glows, soft particle fields, not flat surfaces
- **Quietly confident** -- restrained color, generous whitespace, nothing screams
- **Alive** -- subtle motion, breathing glows, agents feel present

The splash screen establishes the tone: black void, indigo/purple atmospheric glow, floating particles, glass-morphism surfaces, staggered reveals. The app should feel like stepping into that same space.

---

## Color Foundation

### Primary Palette

All colors defined in OKLCH for perceptual uniformity.

| Token | OKLCH | Hex Approx | Usage |
|-------|-------|------------|-------|
| `--brand` | `oklch(0.55 0.20 270)` | `#6366f1` | Primary interactive elements, focus rings, active states |
| `--brand-soft` | `oklch(0.55 0.20 270 / 15%)` | — | Subtle backgrounds, hover states |
| `--brand-muted` | `oklch(0.55 0.20 270 / 8%)` | — | Card tints, selected row backgrounds |
| `--accent` | `oklch(0.55 0.17 300)` | `#8b5cf6` | Secondary emphasis, agent highlights, gradient endpoints |
| `--accent-soft` | `oklch(0.55 0.17 300 / 12%)` | — | Subtle accent backgrounds |

The indigo-to-purple gradient is the brand signature. Used sparingly -- ambient glows, active borders, focus rings. Never as large solid fills in the app chrome.

### Neutral Palette (Dark Mode)

Replace the current achromatic grays with slightly tinted neutrals. A tiny amount of blue chroma gives depth without being noticeable as "blue."

| Token | Current (OKLCH) | Proposed (OKLCH) | Role |
|-------|-----------------|------------------|------|
| `--background` | `0.145 0 0` | `0.13 0.008 270` | App background -- near-black with faint blue undertone |
| `--surface` | `0.20 0 0` | `0.18 0.010 270` | Cards, panels, elevated surfaces |
| `--surface-raised` | (none) | `0.22 0.012 270` | Modals, popovers, dropdowns |
| `--sidebar` | `0.205 0 0` | `0.16 0.010 270` | Sidebar background -- slightly darker than surface |
| `--border` | `1 0 0 / 10%` | `0.40 0.015 270 / 12%` | Default borders -- faint blue-tinted |
| `--border-subtle` | (none) | `0.40 0.015 270 / 6%` | Dividers, separators |
| `--muted` | `0.269 0 0` | `0.25 0.012 270` | Disabled backgrounds, chips |
| `--foreground` | `0.985 0 0` | `0.96 0.005 270` | Primary text -- near-white with warmth |
| `--muted-foreground` | `0.708 0 0` | `0.60 0.010 270` | Secondary text, labels, timestamps |
| `--faint` | (none) | `0.45 0.010 270` | Tertiary text, placeholders, metadata |

### Semantic Status Colors

Currently ad-hoc. Standardize into tokens:

| Token | OKLCH | Hex Approx | Usage |
|-------|-------|------------|-------|
| `--success` | `oklch(0.65 0.18 155)` | `#22c55e` | Pipeline complete, tests passing, agent done |
| `--success-soft` | `oklch(0.65 0.18 155 / 12%)` | — | Success badge/chip backgrounds |
| `--warning` | `oklch(0.75 0.16 80)` | `#eab308` | Awaiting approval, paused, adaptation |
| `--warning-soft` | `oklch(0.75 0.16 80 / 12%)` | — | Warning badge backgrounds |
| `--destructive` | `oklch(0.65 0.22 25)` | `#ef4444` | Errors, failed tests, abort |
| `--destructive-soft` | `oklch(0.65 0.22 25 / 12%)` | — | Error badge backgrounds |
| `--info` | `oklch(0.65 0.15 230)` | `#3b82f6` | Informational, neutral status |
| `--info-soft` | `oklch(0.65 0.15 230 / 12%)` | — | Info badge backgrounds |

Each status color has a `-soft` variant at ~12% opacity for backgrounds, keeping text in the full-chroma version.

### Agent Identity Colors

Each agent has a signature color for avatars, activity indicators, and standup message attribution. These are chromatic but muted -- presence, not decoration.

| Agent | Codename | OKLCH | Hex Approx | Character |
|-------|----------|-------|------------|-----------|
| PM | Sasha | `oklch(0.65 0.15 270)` | `#818cf8` | Indigo -- authority, orchestration |
| Architect | Marcus | `oklch(0.60 0.12 200)` | `#38bdf8` | Sky blue -- structure, clarity |
| Developer | Kai | `oklch(0.65 0.18 155)` | `#34d399` | Emerald -- energy, creation |
| QA | River | `oklch(0.65 0.15 45)` | `#fb923c` | Amber -- caution, precision |

Use at 100% for agent name labels, avatar borders. Use at 15% opacity for background tints in standup messages and agent cards.

---

## Typography

| Role | Font | Size | Weight | Tracking | Color Token |
|------|------|------|--------|----------|-------------|
| Page title | Geist Sans | 18px / `text-lg` | 600 | tight | `--foreground` |
| Section label | Geist Sans | 14px / `text-sm` | 600 | normal | `--foreground` |
| Body text | Geist Sans | 14px / `text-sm` | 400 | normal | `--foreground` |
| Secondary text | Geist Sans | 13px / `text-[13px]` | 400 | normal | `--muted-foreground` |
| Caption / metadata | Geist Sans | 12px / `text-xs` | 400 | normal | `--faint` |
| Badge / chip | Geist Sans | 11px / `text-[11px]` | 500 | wide `0.02em` | varies |
| Code / logs | Geist Mono | 13px / `text-[13px]` | 400 | normal | `--foreground` |
| Cost values | Geist Mono | 14px / `text-sm` | 500 | normal | `--foreground` |
| Splash title | Geist Sans | 2.8rem | 600 | `0.4em` | white/90 |
| Splash tagline | Geist Mono | 14px | 400 | `0.25em` | white/30 |

---

## Surface Hierarchy

Three elevation levels, differentiated by background lightness and border presence:

```
Level 0: --background     (app canvas, chat scroll area)
Level 1: --surface        (sidebar, cards, panels, header bar)
Level 2: --surface-raised (modals, popovers, dropdowns, tooltips)
```

| Level | Background | Border | Shadow | Example |
|-------|-----------|--------|--------|---------|
| 0 | `--background` | none | none | Chat message area, main canvas |
| 1 | `--surface` | `--border-subtle` | none | Sidebar, header bar, log panel sections |
| 2 | `--surface-raised` | `--border` | `shadow-2xl shadow-black/20` | Settings modal, plan confirmation, agent panel |

All elevated surfaces use `backdrop-blur-sm` when overlaying content.

---

## Glow & Atmosphere

The splash screen's atmospheric effects should carry into the app at reduced intensity:

### Ambient Glow
A single, very subtle indigo glow behind the main content area. Not visible as a distinct shape -- just a faint warmth:

```css
/* Applied to the main content wrapper */
.app-glow::before {
  content: "";
  position: fixed;
  top: 30%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 600px;
  height: 400px;
  background: oklch(0.55 0.20 270 / 3%);
  filter: blur(120px);
  pointer-events: none;
  z-index: 0;
}
```

### Active Element Glow
Interactive elements in focus or active state get a faint brand-colored glow:

```css
--ring: oklch(0.55 0.20 270 / 40%);
/* Focus ring: ring-2 ring-ring/50 */
```

### Pipeline Running Glow
When a pipeline is active, the header or project indicator gets a subtle breathing animation:

```css
@keyframes breathe {
  0%, 100% { opacity: 0.4; }
  50% { opacity: 0.8; }
}
```

---

## Component Patterns

### Cards
```
bg-surface border border-border-subtle rounded-xl
```
No shadow at Level 1. Content padding: `p-4` minimum.

### Modals
```
bg-surface-raised border border-border rounded-xl shadow-2xl shadow-black/20 backdrop-blur-sm
```
Overlay: `bg-black/60 backdrop-blur-sm`. Entry animation: `animate-fade-in-scale`.

### Badges / Chips
```
rounded-full px-2.5 py-0.5 text-[11px] font-medium tracking-wide
```
Status badges use `bg-{status}-soft text-{status}`. Agent badges use the agent color at 15% bg.

### Buttons
Primary: `bg-brand text-white hover:bg-brand/90`
Secondary: `bg-surface border border-border text-foreground hover:bg-muted`
Ghost: `text-muted-foreground hover:text-foreground hover:bg-muted`

### Input Fields
```
bg-surface border border-border rounded-lg
focus:border-brand focus:ring-2 focus:ring-brand/20
placeholder:text-faint
```

### Agent Avatars
```
h-8 w-8 rounded-full border border-{agent-color}/30 bg-{agent-color}/10
text-xs font-semibold text-{agent-color}
```
Single letter initial. The border and background use the agent's identity color at low opacity.

### Pipeline Step Indicators
```
Running:  bg-brand-soft border-brand text-brand (+ breathing animation)
Done:     bg-success-soft border-success text-success
Failed:   bg-destructive-soft border-destructive text-destructive
Pending:  bg-muted border-border-subtle text-muted-foreground
Skipped:  bg-muted/50 border-border-subtle text-faint
```

---

## Gradient Usage

Gradients are reserved for emphasis moments, not structural elements:

| Where | Gradient |
|-------|----------|
| Splash title shimmer | `linear-gradient(90deg, white/60, white/95, lavender/90, white/95, white/60)` |
| Video glow ring | `from-brand/20 via-accent/15 to-brand/20` |
| Active project border | `from-brand/30 via-accent/20 to-brand/30` |
| Decorative dividers | `from-transparent via-border to-transparent` |
| Ambient backdrop | Radial `brand/3%` centered, extreme blur |

Never use gradients for button fills, card backgrounds, or text (except the splash title).

---

## Motion

| Animation | Duration | Easing | Usage |
|-----------|----------|--------|-------|
| `fade-in` | 600ms | `ease-out` | Default entrance |
| `fade-in-up` | 500ms | `ease-out` | Content appearing (cards, messages) |
| `fade-in-scale` | 400ms | `ease-out` | Modals, popovers |
| `breathe` | 4-6s | `ease-in-out` infinite | Running indicators, ambient glow |
| `pulse-ring` | 2.5s | `ease-out` infinite | Call-to-action emphasis |
| Exit transitions | 300ms | `ease-in` | Closing modals, dismissing alerts |

All motion respects `prefers-reduced-motion`.

---

## Liquid Glass

Inspired by Apple's WWDC 2025 "Liquid Glass" design language. Surfaces feel like frosted translucent panels floating over the dark void -- not opaque cards sitting on a background.

### The Lilit Glass Material

Three layers compose the glass effect:

```css
/* Base glass material -- use as a Tailwind utility */
@utility glass {
  background: oklch(0.18 0.010 270 / 0.55);
  backdrop-filter: blur(16px) saturate(1.4);
  -webkit-backdrop-filter: blur(16px) saturate(1.4);
  border: 1px solid oklch(1 0 0 / 0.06);
}

/* Elevated glass -- modals, popovers */
@utility glass-raised {
  background: oklch(0.22 0.012 270 / 0.65);
  backdrop-filter: blur(24px) saturate(1.5);
  -webkit-backdrop-filter: blur(24px) saturate(1.5);
  border: 1px solid oklch(1 0 0 / 0.08);
  box-shadow:
    0 0 0 1px oklch(0 0 0 / 0.3),
    0 8px 32px oklch(0 0 0 / 0.4);
}

/* Subtle glass -- sidebar, header */
@utility glass-subtle {
  background: oklch(0.16 0.010 270 / 0.40);
  backdrop-filter: blur(12px) saturate(1.3);
  -webkit-backdrop-filter: blur(12px) saturate(1.3);
  border: 1px solid oklch(1 0 0 / 0.04);
}
```

### Inner Highlight

The top edge of glass surfaces gets a 1px inset highlight to simulate light refraction:

```css
/* Add as inner glow via box-shadow or pseudo-element */
box-shadow:
  inset 0 1px 0 0 oklch(1 0 0 / 0.06),    /* top highlight */
  inset 0 -1px 0 0 oklch(0 0 0 / 0.1);     /* bottom shadow */
```

### Noise Texture

A subtle SVG noise overlay prevents gradient banding and adds materiality:

```css
@utility glass-noise {
  position: relative;
}
/* Applied via pseudo-element */
.glass-noise::after {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.03'/%3E%3C/svg%3E");
  pointer-events: none;
  mix-blend-mode: overlay;
}
```

### Where to Apply Glass

| Surface | Glass Level | Notes |
|---------|------------|-------|
| Sidebar | `glass-subtle` | Content behind should bleed through faintly |
| Header bar | `glass-subtle` | Sits over scrolling chat content |
| Cards (log sections, plan) | `glass` | Primary elevated surfaces |
| Modals (settings, agents) | `glass-raised` | Highest elevation, deepest blur |
| Tooltips | `glass-raised` | Small, brief appearances |
| Badges / chips | No glass | Too small; glass at this scale looks muddy |
| Buttons | No glass | Keep opaque for clear affordance |

### Performance Rules

- **Max 3 glass surfaces visible simultaneously** -- each `backdrop-filter` composites a new layer
- **Never animate an element with `backdrop-filter`** -- animate a wrapper instead, or animate opacity on a non-glass child
- **Reduce blur to 8px on mobile** (`@media (max-width: 768px)`)
- **Provide fallback** for `backdrop-filter` -- use solid `bg-surface` when unsupported:
  ```css
  @supports not (backdrop-filter: blur(1px)) {
    .glass { background: var(--surface); }
  }
  ```

---

## Advanced Motion & Micro-Interactions

### Spring Physics via CSS `linear()`

Replace `ease-out` with spring-based easing for interactive elements. The `linear()` function accepts sampled data points from a spring simulation:

```css
/* Bouncy spring: stiffness 300, damping 15, mass 1 */
--spring-bounce: linear(
  0, 0.009, 0.035, 0.078, 0.136, 0.207,
  0.290, 0.381, 0.478, 0.578, 0.678,
  0.775, 0.865, 0.946, 1.014, 1.069,
  1.109, 1.134, 1.145, 1.144, 1.132,
  1.112, 1.087, 1.058, 1.029, 1.002,
  0.978, 0.959, 0.946, 0.938, 0.935,
  0.937, 0.943, 0.953, 0.964, 0.977,
  0.990, 1.001, 1.010, 1.016, 1.019,
  1.018, 1.014, 1.009, 1.003, 0.998,
  0.995, 0.993, 0.993, 0.995, 0.998, 1
);

/* Snappy spring: quick settle, no overshoot */
--spring-snappy: linear(
  0, 0.063, 0.233, 0.455, 0.658, 0.810,
  0.907, 0.961, 0.987, 0.998, 1
);
```

**Use spring easing for:**
- Button press/release (`transform: scale`)
- Modal entrance (`transform: scale + opacity`)
- Panel slide-in (`transform: translateX`)
- Badge count changes (`transform: scale`)

**Keep `ease-out` for:**
- Opacity-only transitions (fade-in/out)
- Color transitions
- Border/shadow transitions

### Scroll-Driven Animations

Fade the header bar's border as the user scrolls the chat area:

```css
/* Header gets a border that appears as content scrolls underneath */
.header-scroll-border {
  border-bottom: 1px solid oklch(1 0 0 / 0);
  animation: reveal-border linear both;
  animation-timeline: scroll(nearest block);
  animation-range: 0px 40px;
}

@keyframes reveal-border {
  to { border-bottom-color: oklch(1 0 0 / 0.06); }
}
```

### View Transitions

For panel switches (chat to settings, project to project):

```css
::view-transition-old(main-content) {
  animation: 200ms ease-in both fade-out-scale;
}
::view-transition-new(main-content) {
  animation: 300ms var(--spring-snappy) both fade-in-scale;
}
```

### Micro-Interaction Patterns

| Element | Trigger | Effect | Duration |
|---------|---------|--------|----------|
| Button | Press | `scale(0.97)` | 100ms spring |
| Button | Release | `scale(1)` | 300ms spring-bounce |
| Badge count | Value change | `scale(1.15)` then settle | 400ms spring-bounce |
| Card | Hover | `translateY(-1px)` + shadow deepen | 200ms spring-snappy |
| Agent avatar | Pipeline active | `ring-2 ring-{agent-color}/40` + breathe | 4s infinite |
| Chat message | Appear | `translateY(8px) + opacity(0)` to rest | 300ms spring-snappy |
| Modal | Open | `scale(0.95) opacity(0)` to rest | 350ms spring-bounce |
| Modal | Close | `scale(1) opacity(1)` to away | 200ms ease-in |
| Sidebar toggle | Click | `width` transition | 300ms spring-snappy |
| Pipeline step | Complete | Flash `bg-success/20` then fade | 600ms ease-out |

### Streaming Text (AI-Native)

For agent output streaming in the chat:

```css
/* Blinking cursor at end of streaming text */
@keyframes blink-cursor {
  0%, 100% { opacity: 1; }
  50% { opacity: 0; }
}

.streaming-cursor::after {
  content: "▋";
  animation: blink-cursor 1s step-end infinite;
  color: var(--brand);
}
```

### `prefers-reduced-motion` Override

All animated utilities must respect user preferences:

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

---

## Depth & Volumetric Effects

### Layered Elevation Model

Dark UIs communicate depth through three coordinated signals:

```
Signal 1: Surface lightness   (higher = lighter)
Signal 2: Border opacity      (higher = more visible)
Signal 3: Shadow depth        (higher = deeper shadow)
```

| Level | Surface | Border | Shadow | Blur | Element |
|-------|---------|--------|--------|------|---------|
| -1 | `--background` | none | none | none | Canvas, scroll areas |
| 0 | `glass-subtle` | `white/4%` | none | 12px | Sidebar, header |
| 1 | `glass` | `white/6%` | `0 2px 8px black/10` | 16px | Cards, panels |
| 2 | `glass-raised` | `white/8%` | `0 8px 32px black/40` | 24px | Modals, popovers |
| 3 | (reserved) | `white/10%` | `0 16px 48px black/50` | 32px | Command palette |

### Inner Glow on Active Elements

When an agent is running or a pipeline step is active, its container gets a subtle inner glow:

```css
/* Active agent card */
.agent-active {
  box-shadow:
    inset 0 0 20px oklch(var(--agent-color) / 0.05),
    inset 0 1px 0 oklch(1 0 0 / 0.06);
}
```

### Parallax Depth in Chat

Messages at the top of the scroll area could have slightly reduced opacity/scale, creating a sense of depth:

```css
.chat-message {
  animation: message-depth linear;
  animation-timeline: view();
  animation-range: exit -100px exit 0px;
}

@keyframes message-depth {
  to { opacity: 0.5; scale: 0.98; }
}
```

Use sparingly -- only if it doesn't interfere with readability.

---

## Hardcoded Colors to Replace

Current codebase audit -- these hardcoded colors should migrate to tokens:

| Current | Replace With | Files |
|---------|-------------|-------|
| `text-zinc-400/500/600` | `text-muted-foreground` or `text-faint` | chat, pipeline-steps, cost-display |
| `border-zinc-700/800` | `border-border` or `border-border-subtle` | chat, settings, agents |
| `bg-zinc-900` | `bg-surface` or `bg-surface-raised` | settings, agents (loading state) |
| `bg-yellow-500/* text-yellow-400` | `bg-warning-soft text-warning` | chat (resume banner) |
| `bg-amber-500/* text-amber-700` | `bg-warning-soft text-warning` | chat (adaptation badges) |
| `border-yellow-500/* text-yellow-400` | `border-warning text-warning` | plan-confirmation |
| `bg-amber-950/* text-amber-200/*` | `bg-warning-soft text-warning` | provider-alert |
| `bg-green-400/500` | `bg-success` | project-selector (running dot) |
| Project avatar COLORS array | Keep -- distinct from theme; could use agent identity palette for agent cards |

---

## Dark Mode Only

The app ships with `className="dark"` on `<html>` and the splash screen is inherently dark. The design system is dark-mode-first. Light mode tokens exist in globals.css but are not actively used or maintained. Recommendation: **remove light mode tokens** to reduce surface area, or mark them as unsupported.

---

## Implementation Priority

### Phase 1: Token Foundation
1. Add new tokens to `globals.css` (`--brand`, `--accent`, status colors, agent colors, `--surface-raised`, `--border-subtle`, `--faint`)
2. Tint neutrals -- shift existing grayscale tokens to blue-tinted OKLCH values
3. Add spring easing custom properties (`--spring-bounce`, `--spring-snappy`)
4. Add `prefers-reduced-motion` global override

### Phase 2: Glass Material
5. Add `glass`, `glass-raised`, `glass-subtle` utilities to globals.css
6. Add noise texture pseudo-element utility
7. Apply `glass-subtle` to sidebar and header bar
8. Apply `glass` to cards and panels
9. Apply `glass-raised` to modals with updated overlay (`bg-black/60 backdrop-blur-sm`)

### Phase 3: Color Migration
10. Replace hardcoded `zinc-*` across 6 components with semantic tokens
11. Replace hardcoded status colors (yellow/amber/green) with status tokens
12. Add agent identity colors to avatars, standup messages, agent panel
13. Update focus/ring styles to use brand color

### Phase 4: Motion & Depth
14. Add ambient glow to main app wrapper
15. Replace `ease-out` with spring easing on interactive elements (buttons, modals, panels)
16. Add micro-interactions (button press scale, card hover lift, badge count pop)
17. Add scroll-driven header border fade
18. Add streaming cursor for agent output
19. Add breathing animation to active agent indicators

### Phase 5: Polish
20. Add inner highlight to glass surfaces (inset `box-shadow`)
21. Add chat message scroll-depth parallax (optional, test for readability)
22. Add view transitions for panel switches
23. Performance audit -- verify max 3 glass surfaces per viewport, test mobile blur reduction
24. Remove unused light mode tokens from globals.css
