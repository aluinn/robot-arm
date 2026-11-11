# Using the simulator

Full reference for controls and features. Back to the [README](../README.md).

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
| `Esc` | Cancel Auto-Build |
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

### Auto-Build

Unlike Autopilot (which replays a recording), Auto-Build **plans and carries out a task itself** from wherever the blocks currently are.

Pick a structure in the **Auto-Build** card: *Tower (all 6)*, *Pyramid (3-2-1)*, *Wall (3 × 2)* or *Staircase (1-2-3)*. A translucent ghost of it appears at the build site, so you can see the target. Press **Auto-Build** to start; the arm waits a moment on the ghost, then builds from the bottom layer up. Progress shows as "Block 3 of 6" with the current step, and slots turn green as they fill. **Esc** or **Cancel** stops it at any time (the arm freezes where it is; if it is holding a block, press `Space` to set it down).

For every block it:

1. moves above it at a height that clears everything on the way (travelling in an arc around the base, with smooth ease-in/ease-out motion),
2. descends slowly and pauses, closes the gripper and checks that the block really is held (retrying up to 2 more times if not),
3. lifts, carries it above the target, descends gently, pauses, opens and backs off,
4. waits for the block to settle and checks it against the target (within about 12 mm). If it is off, it picks the block up again and re-places it.

It works from any layout, including one you rearranged by hand:

- a block already in its target position is left alone;
- blocks sitting on the build site, blocks stacked on top of the one it needs, and blocks that would stop the gripper fitting are moved aside first, to a free spot on the table;
- the gripper rotates to the orientation that fits between neighbours, and picks whichever blocks are the right size.

It uses the arm only through the same inverse kinematics as the keyboard, and the blocks are only ever moved by the gripper (nothing is teleported). Keyboard control is locked while it runs. Because it is just another controller, a build can be recorded and replayed. Limits: blocks need to be upright (a block lying on its side is not used) and within the arm's reach, and a tall pile you built by hand elsewhere is taken apart top-first as needed.

### Record and Autopilot

The recorder panel (top right) has everything on screen as well as on the keys above:

- **Record** snapshots the full scene (every block's pose, the arm pose) and logs your inputs, then **Stop** ends it. The last recording is saved to your browser (`localStorage`) automatically. Recordings stop themselves at 5 minutes. You can't start recording while holding a block.
- **Autopilot** resets to the recording's snapshot and replays the inputs through the same controller and physics, so the arm performs exactly what you did. The state indicator shows *Idle*, *Recording* or *Replaying*. When a replay finishes it is checked against the recorded end state and the result is shown under the controls.
- The **timeline** scrubs the recording (it rewinds to the snapshot and fast-forwards using the same steps, so any point is exact). Dragging it pauses the replay; **Play** resumes.
- **0.5× / 1× / 2× / 4×** (or `[` / `]`) run the same fixed physics steps, just more or fewer per frame.
- **Trail** draws a faint line behind the gripper during replay.
- **Reset scene** restores the default arm pose and block layout (it discards an in-progress recording).
- **Export** / **Import** save and load the recording as JSON; imports are validated before use. **Clear** deletes the saved recording.
