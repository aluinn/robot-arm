---
title: "Add more challenge shapes"
labels: [good first issue]
---

## Context

Challenges (`src/challenge.js`, `SHAPES`) are also data: a label and slots relative to `CENTER`. The shape buttons in the Challenge card are generated from `SHAPES` (`src/ui.js`). Only `tower` (3 blocks) and `pyramid` (6 blocks) exist today. A slot counts as matched when a block is within about 35 mm, upright and at rest; best times are stored in `localStorage` under `robotarm.best`, keyed by shape.

## Task

Add one or two shapes, for example a "Tower of 5" and a "Wall" (3 cubes on the floor with a brick on top). Keep them solvable with the six available blocks.

## Acceptance

- New shapes appear as buttons, show their ghost and can be completed by hand.
- Best times are stored separately per shape.
- The layout of the Challenge card still fits at 1600x900 and 390x844 (run `npm run screenshots` and look at the result).
- `docs/USAGE.md` mentions the new shapes.

## Pointers

- `src/challenge.js`, `src/ui.js` (`shapeBtns`), `css/style.css`
