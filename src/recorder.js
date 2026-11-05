// Record / replay of user input, plus scene snapshots.
//
// Determinism recipe:
//  * the simulation only ever advances in fixed steps (see PHYS.step), in one fixed order:
//      commands -> arm.step -> physics.step
//  * a run (live recording or replay) always starts from a *fresh* physics world rebuilt from the
//    same snapshot, so there is no hidden history (broadphase order, contact caches, body ids)
//  * the controller's outputs are logged per step (only changes are stored), and replay feeds
//    exactly those values back in, so nothing is teleported or faked
//  * physics contains no randomness
import { PHYS } from './config.js';

export const MAX_STEPS = 36000;            // 5 minutes at 120 Hz
const STORAGE_KEY = 'robotarm.recording.v1';
const CMD_LEN = 12;

export function captureScene(arm, physics) {
  return { arm: arm.capture(), blocks: physics.capture() };
}

export function restoreScene(arm, physics, scene) {
  physics.rebuild(scene.blocks);
  arm.restore(scene.arm);
}

/** Largest block position difference (metres) between two block-state arrays. */
export function blockDrift(a, b) {
  let m = 0;
  for (let i = 0; i < a.length; i++) {
    for (let k = 0; k < 3; k++) m = Math.max(m, Math.abs(a[i].p[k] - b[i].p[k]));
  }
  return m;
}

export class Recorder {
  constructor() {
    this.state = 'idle';       // 'idle' | 'recording' | 'replaying'
    this.paused = false;
    this.speed = 1;
    this.data = null;
    this.step = 0;
    this.seekTarget = null;
    this.result = null;        // { ok, drift } after a replay finishes
    this._last = null;
    this._ptr = 0;
    this._cmd = null;
  }

  get recording() { return this.state === 'recording'; }
  get replaying() { return this.state === 'replaying'; }
  get hasData() { return !!this.data && this.data.steps > 0; }
  get totalSteps() { return this.data ? this.data.steps : 0; }
  get seconds() { return this.step * PHYS.step; }

  /* ---------- recording ---------- */

  startRecording(scene) {
    this.data = { v: 1, dt: PHYS.step, snapshot: scene, events: [], steps: 0, final: null };
    this.state = 'recording';
    this.step = 0;
    this._last = null;
    this.result = null;
  }

  /** Call once per fixed step, after the live controller has produced this step's command. */
  sample(arm) {
    const c = arm.command();
    const l = this._last;
    let changed = !l;
    if (l) for (let i = 0; i < CMD_LEN; i++) if (c[i] !== l[i]) { changed = true; break; }
    if (changed) this.data.events.push([this.step, ...c]);
    this._last = c;
  }

  stopRecording(finalScene) {
    this.data.steps = this.step;
    this.data.final = finalScene.blocks;
    this.state = 'idle';
    if (this.data.steps === 0) this.data = null;
    return this.data !== null;
  }

  discard() {
    this.state = 'idle';
    this.data = null;
    this.step = 0;
  }

  /* ---------- replay ---------- */

  beginReplay(paused = false) {
    this.state = 'replaying';
    this.paused = paused;
    this.step = 0;
    this._ptr = 0;
    this._cmd = null;
    this.result = null;
  }

  /** Feed this step's recorded command into the arm (idempotent; applied every step). */
  applyReplay(arm) {
    const ev = this.data.events;
    while (this._ptr < ev.length && ev[this._ptr][0] <= this.step) {
      this._cmd = ev[this._ptr].slice(1);
      this._ptr++;
    }
    if (this._cmd) arm.applyCommand(this._cmd);
  }

  get replayDone() { return this.step >= this.data.steps; }

  endReplay(physics) {
    this.state = 'idle';
    this.paused = false;
    this.seekTarget = null;
    if (this.step >= this.data.steps) {
      const drift = blockDrift(physics.capture(), this.data.final);
      this.result = { ok: drift < 1e-6, drift };
    }
  }

  stopReplay() {
    this.state = 'idle';
    this.paused = false;
    this.seekTarget = null;
  }

  /* ---------- persistence ---------- */

  save() {
    if (!this.hasData) return { ok: false, reason: 'nothing to save' };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data));
      return { ok: true };
    } catch (e) {
      return { ok: false, reason: 'too large for browser storage (export it instead)' };
    }
  }

  loadSaved() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;
      const d = JSON.parse(raw);
      if (validate(d) === true) { this.data = d; this.step = 0; return true; }
    } catch (e) { /* ignore */ }
    return false;
  }

  clearSaved() {
    try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* ignore */ }
    this.data = null;
    this.step = 0;
    this.result = null;
  }

  toJSON() { return JSON.stringify(this.data); }

  /** Returns an error string, or null on success. */
  importJSON(text) {
    let d;
    try { d = JSON.parse(text); } catch (e) { return 'not valid JSON'; }
    const err = validate(d);
    if (err !== true) return err;
    this.data = d;
    this.step = 0;
    this.result = null;
    this.save();
    return null;
  }
}

/* ---------- validation (imported files are untrusted) ---------- */

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const numArr = (a, n) => Array.isArray(a) && a.length === n && a.every(isNum);

function validBlocks(b) {
  return Array.isArray(b) && b.length === 6 && b.every((o) =>
    o && numArr(o.p, 3) && numArr(o.q, 4) && numArr(o.v, 3) && numArr(o.w, 3) && [0, 1, 2].includes(o.s));
}

function validate(d) {
  if (!d || typeof d !== 'object') return 'not a recording';
  if (d.v !== 1) return 'unsupported recording version';
  if (d.dt !== PHYS.step) return 'recorded at a different physics rate';
  if (!Number.isInteger(d.steps) || d.steps < 1 || d.steps > MAX_STEPS) return 'invalid length';
  const s = d.snapshot;
  if (!s || !validBlocks(s.blocks)) return 'invalid block snapshot';
  const a = s.arm;
  if (!a || !Array.isArray(a.q) || a.q.length !== 5 || !a.q.every((j) => numArr(j, 3)) ||
      !numArr(a.grip, 4) || !numArr(a.target, 4) || !numArr(a.lastValid, 3) || !isNum(a.tilt) ||
      !['cartesian', 'joints'].includes(a.mode) || typeof a.fine !== 'boolean') return 'invalid arm snapshot';
  if (!validBlocks(d.final)) return 'invalid final state';
  if (!Array.isArray(d.events) || d.events.length < 1 || d.events.length > MAX_STEPS) return 'invalid events';
  let prev = -1;
  for (const e of d.events) {
    if (!numArr(e, CMD_LEN + 1) || !Number.isInteger(e[0]) || e[0] <= prev || e[0] >= d.steps) return 'invalid events';
    if ((e[7] !== 0 && e[7] !== 1) || (e[12] !== 0 && e[12] !== 1)) return 'invalid events';
    prev = e[0];
  }
  if (d.events[0][0] !== 0) return 'invalid events';
  return true;
}
