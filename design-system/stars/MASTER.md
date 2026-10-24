# Design System Master File

> **LOGIC:** When building a specific page, first check `design-system/pages/[page-name].md`.
> If that file exists, its rules **override** this Master file.
> If not, strictly follow the rules below.

---

**Project:** Stars
**Generated:** 2026-10-22 15:40:38
**Category:** AI/Chatbot Platform
**Design Dials:** Motion 2/10 (Reduced / Functional) | Density 9/10 (Dense / Pixel Workbench)

---

## Global Rules

### Color Palette

| Role | Hex | CSS Variable |
|------|-----|--------------|
| Primary | `#CCFF00` | `--pixel-lime` |
| On Primary | `#050505` | `--pixel-bg` |
| Secondary | `#243DFF` | `--pixel-blue` |
| Accent/CTA | `#20C8FF` | `--pixel-cyan` |
| Status | `#FF1493` | `--pixel-magenta` |
| Background | `#050505` | `--pixel-bg` |
| Foreground | `#F3F5F2` | `--pixel-text` |
| Card | `#10121A` | `--pixel-panel` |
| Muted | `#8A91A3` | `--pixel-muted` |
| Border | `#202A52` | `--pixel-border` |
| Destructive | `#FF5C5C` | `--pixel-danger` |
| Hard Shadow | `4px 4px 0 rgba(0,0,0,.6)` | `--pixel-shadow` |

**Color Notes:** The selected reference theme is lime-on-black with Royal Blue structure. Cyan and magenta are reserved for secondary information and status accents.

### Stars Pixel Override

The current Stars workbench uses the pixel tokens above as the source of truth. Components are rectangular (`border-radius: 0`), use 1px borders, and use hard offset shadows only. Hover/focus/selected states use `--pixel-lime`; workflow connectors are dashed Royal Blue lines; progress is rendered as discrete segments. The older rounded-card examples below are historical generic guidance and do not apply to `stars-demo/src/styles.css`.

### Typography

- **Heading Font:** Roboto Mono / Courier New
- **Body Font:** Roboto Mono / Courier New
- **Mood:** hard-edged, technical, dense, scan-friendly, developer utility
- **External fonts:** none by default; use the local fallback stack to keep the preview deterministic.

**CSS Import:** None. Use the local monospace fallback stack so the workbench does not depend on external font requests.

### Spacing Variables

*Density: 8/10 — Dense / Dashboard*

| Token | Value | Usage |
|-------|-------|-------|
| `--space-xs` | `2px` / `0.125rem` | Tight gaps |
| `--space-sm` | `4px` / `0.25rem` | Icon gaps, inline spacing |
| `--space-md` | `8px` / `0.5rem` | Standard padding |
| `--space-lg` | `12px` / `0.75rem` | Section padding |
| `--space-xl` | `16px` / `1rem` | Large gaps |
| `--space-2xl` | `24px` / `1.5rem` | Section margins |
| `--space-3xl` | `32px` / `2rem` | Hero padding |

### Pixel Component Rules

- All components have square corners (`border-radius: 0`) and 1px borders.
- Resting borders use `--pixel-border`; hover, focus and selected states use `--pixel-lime`.
- Use `--pixel-shadow` or a smaller hard offset shadow. Never use blurred box-shadows.
- Primary button press feedback is `transform: translate(1px, 1px)`.
- The workflow connector is dashed Royal Blue; current step is a solid lime block; progress is segmented.
- Keep hover, focus-visible, active, disabled, loading, error and reduced-motion states legible.

---

## Component Specs

Component-level selector and state details live in `stars-demo/src/styles.css`; that file is the implementation source of truth for this theme.

---

## Style Guidelines

**Style:** AI-Native UI

**Keywords:** Chatbot, conversational, voice, assistant, agentic, ambient, minimal chrome, streaming text, AI interactions

**Best For:** AI products, chatbots, voice assistants, copilots, AI-powered tools, conversational interfaces

**Key Effects:** Typing indicators (3-dot pulse), streaming text animations, pulse animations, context cards, smooth reveals

### Page Pattern

**Pattern Name:** Product Demo + Features

- **Conversion Strategy:** Use an interactive demo only when it explains value better than static media. Provide captions, transcript, visible play/pause controls, and a non-video fallback; do not autoplay under reduced motion. Pause media when offscreen or hidden and keep the final product state available as static content.
- **CTA Placement:** Video center + CTA right/bottom
- **Section Order:** Hero > Product video/mockup (center) > Feature breakdown per section > Comparison (optional) > CTA

---

## Motion

**Stagger List** (Standard) — Trigger: load or scroll | Duration: 300-450ms | Easing: `back.out(1.4)`

```js
gsap.from('.grid-item', { opacity: 0, scale: 0.92, y: 16, duration: 0.4, stagger: { each: 0.06, from: 'start', grid: 'auto' }, ease: 'back.out(1.4)' });
```

**Framework notes:** grid: 'auto' lets GSAP infer rows/columns from a CSS grid layout for a natural wave stagger; Use matchMedia('(prefers-reduced-motion: reduce)') to skip non-essential motion and render the final state immediately

- ✅ Combine with from: 'center' for a bento-grid layout to draw the eye inward first
- ❌ Don't use back.out on dense data tables; the overshoot reads as sloppy on informational UI
- ⚡ Group DOM writes; avoid interleaving layout reads (getBoundingClientRect) between staggered tweens

---

## Anti-Patterns (Do NOT Use)

- ❌ Heavy chrome
- ❌ Slow response feedback

### Additional Forbidden Patterns

- ❌ **Emojis as icons** — Use SVG icons (Heroicons, Lucide, Simple Icons)
- ❌ **Missing cursor:pointer** — All clickable elements must have cursor:pointer
- ❌ **Layout-shifting hovers** — Avoid scale transforms that shift layout
- ❌ **Low contrast text** — Maintain 4.5:1 minimum contrast ratio
- ❌ **Instant state changes** — Always use transitions (150-300ms)
- ❌ **Invisible focus states** — Focus states must be visible for a11y

---

## Pre-Delivery Checklist

Before delivering any UI code, verify:

- [ ] No emojis used as icons (use SVG instead)
- [ ] All icons from consistent icon set (Heroicons/Lucide)
- [ ] `cursor-pointer` on all clickable elements
- [ ] Hover states with smooth transitions (150-300ms)
- [ ] Light mode: text contrast 4.5:1 minimum
- [ ] Focus states visible for keyboard navigation
- [ ] `prefers-reduced-motion` respected
- [ ] Responsive: 375px, 768px, 1024px, 1440px
- [ ] No content hidden behind fixed navbars
- [ ] No horizontal scroll on mobile
