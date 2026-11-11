# Performance

The simulation advances in fixed 1/120 s steps (about 8.33 ms of wall time per step if it were to run exactly in real time). This page measures how much of that budget a step actually uses.

## What is measured

One step is everything `simStep()` in `src/main.js` does: input and Auto-Build commands, `arm.step` (joint springs, floor guard) and `physics.step` (cannon-es, grasp and kinematic sync). **Rendering is not included**; it is GPU-bound and varies a lot between machines.

The script drives `window.__app.simStep()` (exposed by `?debug`) in a headless Chromium, in three scenarios. Browsers coarsen `performance.now()` (0.1 ms in headless Chromium), so the script times batches of 50 steps and divides.

## Results

Run on the machine below, one run, no other heavy load. Treat them as an order of magnitude, not a benchmark suite.

```text

Machine: Apple M1 Pro, 8 logical cores, 16 GB RAM, darwin 24.6.0
Browser: Chromium 157.0.8103.39 (headless), Node v24.20.0
Real-time budget per step at 120 Hz: 8.33 ms

| Scenario | Steps | Mean ms/step | p95 ms/step | Worst ms/step |
| --- | ---: | ---: | ---: | ---: |
| Idle scene, 6 blocks at rest | 6000 | 0.010 | 0.012 | 0.108 |
| Auto-Build pyramid (start to finish) | 7885 | 0.019 | 0.048 | 0.130 |
| Auto-Build tower of 6 (start to finish) | 8158 | 0.017 | 0.038 | 0.072 |
```

Reading it:

- A step costs about 0.01 to 0.02 ms on average, roughly **400 times** under the 8.33 ms budget on this machine. The slowest 50-step batch averaged 0.13 ms per step.
- The idle scene is cheapest because resting blocks are put to sleep (see below). The Auto-Build runs cost more because blocks are carried and stacked, so contacts stay active.
- 7885 steps is 65.7 s of simulated time, so the pyramid takes about 66 s of sim time end to end; the tower of 6 takes about 68 s (8158 steps).
- Because the step is cheap, replay at 4x (up to 24 steps per frame, the cap in `frame()`) is not CPU-limited here. On a much slower device the per-frame cap (`PHYS.maxSteps`) makes the simulation run slower than real time instead of spiralling.

## Why it is this cheap

- **Allocation-free step loop.** `src/physics.js` uses module-level scratch vectors, matrices and quaternions so the 120 Hz path does not create garbage.
- **Deliberate sleeping.** A block that is resting and calm for 30 steps is put to sleep by hand (the solver's own sleep test never triggers for a tall stack because of contact jitter). Blocks near the tool are woken before each step.
- **Small world.** Six boxes, a floor, and a few kinematic bodies for the fingers and palm.

## Reproduce

```sh
npm install
npx playwright install chromium    # or: PW_CHANNEL=chrome to use installed Chrome
npm run bench
```

Numbers will differ by machine and browser version; include both when you compare.
