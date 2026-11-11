# Contributing

Thanks for helping out. This is a small project with no build step, so setup is quick.

## Setup

```sh
git clone https://github.com/aluinn/robot-arm.git
cd robot-arm
npm install
npm start          # http://localhost:3000
```

Node 20 or newer is required for the tooling. The app itself is plain ES modules; Three.js and cannon-es load from a CDN, so you need a network connection when you open it.

For the end-to-end test, install a browser once: `npx playwright install chromium`. If you already have Chrome, set `PW_CHANNEL=chrome` to use it instead.

## Commands

| Command | Purpose |
| --- | --- |
| `npm start` | Dev server |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript `checkJs` |
| `npm test` | Unit tests |
| `npm run test:e2e` | Playwright smoke test |
| `npm run build` | Build `dist/` and verify it |
| `npm run screenshots` | Regenerate README screenshots |
| `npm run bench` | Simulation timing |

Open the app with `?debug` to get `window.__app` in the console (arm, physics, actions, `simStep()`), which is handy for reproducing bugs.

## Branches

Branch from `main` and name branches `type/short-description`, for example `feat/arch-structure` or `fix/ik-wrist-flip`. Use the same types as commits (below).

## Commits

[Conventional Commits](https://www.conventionalcommits.org/): `type(scope): summary` in the imperative, under about 72 characters.
Types: `feat`, `fix`, `docs`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`. Scopes are optional, for example `autobuild`, `physics`, `ik`, `ui`, `recorder`.

## Pull requests

- Keep a PR focused on one thing, and link the issue it closes.
- `npm run lint`, `npm run typecheck`, `npm test` and `npm run test:e2e` must pass; CI runs them.
- Match the existing code style and tone. Do not reformat files you are not changing.
- Add or update tests for logic you change, and update the docs and `CHANGELOG.md` (under *Unreleased*) for visible changes.
- **Replay compatibility:** if you change arm, controller or physics behaviour, bump `SIM_VERSION` in `src/recorder.js`. Otherwise old recordings would silently replay differently. See [Replay determinism](docs/ARCHITECTURE.md#replay-determinism).
- **Keep the step loop allocation-free.** `simStep()` runs about 120 times per second; reuse scratch objects as `src/physics.js` does.
- Adding a dependency needs a reason in the PR description. The runtime deliberately has none.

## Finding something to work on

Look at [docs/issues](docs/issues) for scoped drafts (about half are good first issues) and at the [roadmap](ROADMAP.md).

By contributing you agree that your contribution is licensed under the [MIT license](LICENSE) and that you will follow the [Code of Conduct](CODE_OF_CONDUCT.md).
