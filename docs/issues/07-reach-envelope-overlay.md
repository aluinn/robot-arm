---
title: "Show the arm's reachable workspace as an overlay"
labels: [enhancement]
---

## Context

`Arm.canReach(x, y, z)` in `src/arm.js` tells whether a tool position is reachable (tool down, any wrist roll) without touching controller state. It is used by Auto-Build but nothing visualises it, so users only find the workspace edge by running into it (the target then slides along the edge).

## Task

Add a toggleable overlay that draws the reachable region on the table, for example the outline of the reachable area at a few heights, computed by sampling `canReach` on a grid when the overlay is switched on (not every frame). Add a toolbar button and a key.

## Acceptance

- The overlay matches reality: a gripper target placed just outside it cannot be reached, just inside it can.
- No cost per step while the overlay is off, and no allocation in the step loop.
- Works in the Top camera preset.
- Document the key in `docs/USAGE.md` and the in-app hint.

## Pointers

- `src/arm.js` (`canReach`, `solveIK`), `src/scene.js`, `src/ui.js` (toolbar), `src/input.js`
