---
title: "Add a new Auto-Build structure"
labels: [good first issue]
---

## Context

Auto-Build structures are plain data in `src/structures.js` (`STRUCTURES`): a label and a list of slots, bottom layer first. The dropdown in the Auto-Build card is generated from that object (`src/ui.js`, `Object.entries(STRUCTURES)`), so a new entry shows up with no UI work. There are six blocks: four 100 mm cubes and two 140 mm bricks, so a structure may use at most four slots of height `0.1` and two of height `0.14`.

## Task

Add one new structure, for example a 2-high arch-like "Gate" (two pillars and a lintel) or a "Zigzag". Slots use `x` (relative to `SITE`), `y` (block centre height) and `h` (block height). Each slot must rest on the floor or on a lower slot, and slots must not overlap.

## Acceptance

- The new structure appears in the dropdown and shows its ghost.
- Auto-Build completes it from the default layout (`npm start`, open with `?debug`, check `__app.build.state === 'done'`).
- A unit test checks that every slot in every structure is supported and that block counts stay within what exists (add to `tests/unit/structures.test.js`).
- Add a line for it to the structure list in `docs/USAGE.md`.

## Pointers

- `src/structures.js`, `src/autobuild.js` (`_claims`, `_run`), `src/ghost.js`
