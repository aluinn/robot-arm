# Robot Arm Simulator

A browser-based 3D simulator of a 6-axis industrial arm with a parallel gripper, inverse kinematics, and rigid-body physics.

## Run

```sh
npx serve
```

Then open the printed local URL. There is no build step; Three.js and cannon-es load from a CDN through an import map (pinned versions), so you need a network connection on first load.

## Controls

| Input | Action |
| --- | --- |
| `W` `A` `S` `D` | Move the gripper target across the table (relative to the camera) |
| `R` / `F` | Raise / lower the target |
| `Q` / `E` | Rotate the wrist |
| `Space` | Open / close the gripper |
| `Shift` (hold) | Fine, slow movement |
| `M` | Switch between Cartesian and Joints mode |
| `O` | Toggle slow auto-orbit |
| `X` | Reset the whole scene (arm and blocks) |
| `H` | Clean mode: hide all UI |
| `C` | Start / stop recording |
| `P` | Autopilot (replay the recording); pause / resume while replaying |
| `[` / `]` | Slower / faster replay (0.5×, 1×, 2×, 4×) |
| `1` `2` `3` | Camera presets: Front, Top, Hero |
| `K` | Sound on / off (off by default) |
| `T` | Show / hide the replay motion trail |
| `/` | Show / hide the controls hint |
| Mouse | Orbit (drag), zoom (wheel) |

In **Joints** mode the panel sliders drive each joint and the gripper directly.

### Feel and feedback

- **Easing:** keyboard motion accelerates and glides to a stop; joints and the gripper use critically damped springs.
- **Idle breathing:** the arm sways by a few millimetres so it never looks frozen. It fades out near the table and while gripping, so it never disturbs a grab.
- **Soft settle:** a released block is briefly extra-damped so it lands without bouncing.
- **Block highlight:** the block that a grab would pick up gets a thin outline (strong once it is inside the grasp zone) and a brief pulse when gripped.
- **Stats:** the left panel shows the tallest tower in millimetres, with a meter, and how many blocks are stacked.
- **Sound:** soft synthesized clicks for grip and place (WebAudio, no files). Off until you switch it on.
- **Camera presets:** Front, Top and Hero glide between views; dragging the camera cancels the preset.

### Challenge

Pick **Tower of 3** or **Pyramid** and press **Start**. The scene resets, a translucent ghost shows the target, and the timer runs. Each ghost slot turns green when a matching block sits in it (within about 35 mm, upright and at rest). Hold the full shape for a moment and you get the success card with your time. Best times are remembered. **Reset scene** during a challenge restarts it. Challenges can't be started while recording or replaying.

### Record and Autopilot

The recorder panel (top right) has everything on screen as well as on the keys above:

- **Record** snapshots the full scene (every block's pose, the arm pose) and logs your inputs, then **Stop** ends it. The last recording is saved to your browser (`localStorage`) automatically. Recordings stop themselves at 5 minutes. You can't start recording while holding a block.
- **Autopilot** resets to the recording's snapshot and replays the inputs through the same controller and physics, so the arm performs exactly what you did. The state indicator shows *Idle*, *Recording* or *Replaying*. When a replay finishes it is checked against the recorded end state and the result is shown under the controls.
- The **timeline** scrubs the recording (it rewinds to the snapshot and fast-forwards using the same steps, so any point is exact). Dragging it pauses the replay; **Play** resumes.
- **0.5× / 1× / 2× / 4×** (or `[` / `]`) run the same fixed physics steps, just more or fewer per frame.
- **Trail** draws a faint line behind the gripper during replay.
- **Reset scene** restores the default arm pose and block layout (it discards an in-progress recording).
- **Export** / **Import** save and load the recording as JSON; imports are validated before use. **Clear** deletes the saved recording.

## How it works

**Inverse kinematics.** The arm is a base yaw followed by a planar shoulder/elbow/wrist chain. In Cartesian mode the target position gives the base yaw directly. The wrist point is then found by stepping back from the target along the tool axis, and the shoulder and elbow come from a closed-form two-link solution (elbow up). The wrist pitch keeps the gripper pointing down; if that is out of reach or out of limits, the solver tries small tilts before giving up. Wrist roll is chosen as the equivalent angle (the gripper is symmetric under 180°) nearest the current one, so it never spins the long way round. When a move is infeasible the target slides along the edge of the workspace instead of sticking. All joints respect their limits.

**Motion.** Every joint, and the gripper, follows its target with a critically damped spring (with a speed cap), so motion accelerates and settles smoothly with no overshoot or snapping.

**Physics.** [cannon-es](https://github.com/pmndrs/cannon-es) runs at a fixed 120 Hz timestep with a high solver iteration count, tuned friction, damping and sleep thresholds so blocks stack stably. The fingers and palm are kinematic bodies that follow the arm and carry its velocity, so they can push blocks. Because cannon-es ignores slow contacts with sleeping bodies, blocks near the tool are woken before each step.

**Grasping.** When the pads close onto a block, the block is locked to the gripper frame instead of being held by friction. It eases to the centre of the grip and rotates to the nearest axis-aligned orientation, then follows the tool exactly, which avoids jitter, slipping and solver blow-ups. Opening the gripper hands the block back to the solver with the tool's velocity (capped), so it drops naturally and can be stacked.

## Replay determinism

Replays are exact (bit-for-bit in the same browser), not approximated. That relies on a few rules:

- The simulation only advances in fixed 1/120 s steps, always in the same order: commands, then arm, then physics. Replay speed and frame rate only change how many steps run per frame.
- Every run, whether a live recording or a replay, starts from a freshly built physics world created from the same snapshot, so there is no leftover contact or broadphase history and body ids match.
- The controller's output (joint targets, gripper, target pose) is logged for each step, but only when it changes, and fed straight back in on replay. Blocks are never teleported.
- Nothing in the physics uses randomness.

Recordings carry a simulator version. If the arm or physics behaviour changes in a later version, older recordings are rejected with a message instead of replaying differently. Exact replay is guaranteed within one browser and machine. A different JavaScript engine may differ in floating-point details, in which case the end-of-replay check will report the divergence.

## Layout

```
index.html        page + import map
css/style.css     UI styling
src/main.js       setup and main loop
src/config.js     dimensions, joint limits, palette
src/scene.js      renderer, lighting, environment, floor, camera
src/arm.js        arm model, IK, joint dynamics
src/physics.js    physics world, blocks, grasping, highlight query
src/stacks.js     tower height and stacked-block detection
src/challenge.js  ghost targets, timer, success detection
src/audio.js      synthesized sounds
src/input.js      keyboard handling
src/ui.js         panels, toolbar, cards, hints
src/recorder.js   scene snapshots, record/replay, import/export validation
```
