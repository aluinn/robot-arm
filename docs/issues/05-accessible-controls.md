---
title: "Accessible labels for controls"
labels: [good first issue]
---

## Context

The UI is generated in `src/ui.js` and currently contains no `aria-*` attributes or `title` tooltips (a search for `aria-` finds nothing). Icon-like and short labels (Orbit, Trail, the speed buttons, card headers) are hard to understand with a screen reader. Card headers are real `<button>` elements but do not say whether they are expanded.

## Task

Add accessible names and roles: `aria-label` where the visible text is not enough, `aria-pressed` on toggle buttons, `aria-expanded` on card headers, `role="status"` or `aria-live="polite"` on the toast/notification element, and a visible focus style in `css/style.css`.

## Acceptance

- All interactive elements are reachable with Tab and show a visible focus ring.
- A short manual check with VoiceOver or NVDA is described in the PR.
- No visual change at 1600x900 other than the focus ring (compare `npm run screenshots` output).

## Pointers

- `src/ui.js` (`el()` helper, `_card()`, toolbar), `css/style.css`
