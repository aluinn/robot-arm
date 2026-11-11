---
title: "Drag the gripper target on touch screens"
labels: [enhancement]
---

## Context

On touch devices (`pointer: coarse`) the app starts in Joints mode (`src/main.js`) because there is no keyboard; moving in Cartesian mode needs W/A/S/D. On a phone the slider panel also overlaps the top of the arm in the default view (see the phone screenshot).

## Task

Add an on-screen way to move the Cartesian target: for example, a drag on the table plane that moves the target (raycast to the table, then `arm.setTargetPose` or `moveTarget`), with the camera still orbitable by a two-finger gesture. Keep orbit and target drag from fighting each other.

## Acceptance

- On a 390x844 touch emulation, a one-finger drag on the table moves the gripper and a two-finger gesture orbits.
- Moving with touch does not break recording: the target is driven through the same arm API the keyboard uses.
- Unreachable positions slide along the workspace edge as with the keyboard.
- Playwright test using touch emulation (`hasTouch`) added to `tests/e2e/`.

## Pointers

- `src/main.js` (touch check), `src/scene.js` (OrbitControls), `src/arm.js` (`moveTarget`, `setTargetPose`), `src/input.js`
