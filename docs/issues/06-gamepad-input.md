---
title: "Gamepad input"
labels: [enhancement]
---

## Context

Input is keyboard only (`src/input.js`). The controller produces eased velocity commands in `this.v = { fwd, side, lift, yaw }` that `update(dt)` feeds to `arm.moveTarget`. Anything that can fill those four numbers can drive the arm.

## Task

Read the Gamepad API each step: left stick for fwd/side (camera-relative, as the keyboard is), right stick vertical for lift and horizontal for yaw, a button for the gripper toggle, another for the fine-motion modifier. Dead-zone the sticks.

## Acceptance

- A connected gamepad can pick and place a block.
- Keyboard still works, and both can be used together.
- Recording and replay still work: the recorder logs the controller's outputs, not raw input, so check that a recording made with a gamepad replays with `Replay verified`.
- A short section in `docs/USAGE.md` lists the mapping.

## Pointers

- `src/input.js` (`update`, `toggleGripper`), `src/recorder.js` (`sample`), [Replay determinism](../ARCHITECTURE.md#replay-determinism)
