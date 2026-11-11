---
title: "Auto-Build with blocks lying on their side"
labels: [enhancement]
---

## Context

Auto-Build only uses upright blocks (`isUpright` in `src/autobuild.js`; the README documents this as a limit). If you knock a block over, "Not enough blocks of the right size" can end the build. The grasp code already snaps a grasped block to the nearest of 24 axis-aligned orientations (`src/physics.js`).

## Task

Teach the planner to right a block that is lying on its side: grasp it, set it down upright in a free spot, then use it normally. Start with blocks that are exactly 90 degrees over (not leaning on other blocks).

## Acceptance

- Knock one block over by hand, start Auto-Build, and the structure completes.
- A build that cannot right a block still fails with a clear message instead of hanging.
- Builds from the default layout are unchanged: bump `SIM_VERSION` only if arm or physics behaviour changes, and note it in the PR.
- Update the limits paragraph in `docs/USAGE.md`.

## Pointers

- `src/autobuild.js` (`isUpright`, `_claims`, `_pickBlock`, `_placeAt`), `src/physics.js` (`_updateGrasp`)
