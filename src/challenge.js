import { Ghost } from './ghost.js';

// Ghost layouts. Slot x/z are relative to CENTER; y is the block centre height; h its height.
const CENTER = { x: 0.42, z: 0.3 };
export const SHAPES = {
  tower: {
    label: 'Tower of 3',
    slots: [
      { x: 0, y: 0.05, h: 0.1 }, { x: 0, y: 0.15, h: 0.1 }, { x: 0, y: 0.25, h: 0.1 },
    ],
  },
  pyramid: {
    label: 'Pyramid',
    slots: [
      { x: -0.11, y: 0.05, h: 0.1 }, { x: 0, y: 0.05, h: 0.1 }, { x: 0.11, y: 0.05, h: 0.1 },
      { x: -0.055, y: 0.17, h: 0.14 }, { x: 0.055, y: 0.17, h: 0.14 },
      { x: 0, y: 0.29, h: 0.1 },
    ],
  },
};

// tolerances
const TOL_XZ = 0.035, TOL_Y = 0.03, TOL_UP = 0.94, TOL_SPEED = 0.08, HOLD_TIME = 0.6;

export class Challenge {
  constructor(scene) {
    this.ghost = new Ghost(scene);
    this.key = null;
    this.slots = [];
    this.active = false;
    this.done = false;
    this.time = 0;
    this.matched = 0;
    this.total = 0;
    this.newBest = false;
    this._hold = 0;
    this._used = [];
    this.best = this._loadBest();
  }

  get label() { return this.key ? SHAPES[this.key].label : ''; }
  get bestTime() { return this.key ? this.best[this.key] : undefined; }

  start(key) {
    this.key = key;
    this.slots = SHAPES[key].slots.map((s) => ({ ...s, matched: false }));
    this.ghost.show(this.slots, CENTER);
    this.total = this.slots.length;
    this.matched = 0;
    this.active = true;
    this.done = false;
    this.time = 0;
    this._hold = 0;
  }

  restart() { if (this.key) this.start(this.key); }

  cancel() {
    this.active = false;
    this.done = false;
    this.ghost.hide();
    this.slots = [];
  }

  /** Advance the timer by one simulation step (called only for live play). */
  tick(dt) { if (this.active && !this.done) this.time += dt; }

  /** Check the blocks against the ghost. Returns true on the frame the challenge is completed. */
  evaluate(blocks, held, dt) {
    if (!this.active || this.done) return false;
    const used = this._used;
    used.length = blocks.length;
    used.fill(false);
    let matched = 0;
    for (const s of this.slots) {
      let best = -1, bd = Infinity;
      for (let i = 0; i < blocks.length; i++) {
        if (used[i]) continue;
        const b = blocks[i];
        if (held && held.block === b) continue;
        if (Math.abs(b.half.y * 2 - s.h) > 0.01) continue;
        const p = b.body.position, q = b.body.quaternion;
        const dxz = Math.hypot(p.x - (CENTER.x + s.x), p.z - CENTER.z);
        if (dxz > TOL_XZ || Math.abs(p.y - s.y) > TOL_Y) continue;
        if (1 - 2 * (q.x * q.x + q.z * q.z) < TOL_UP) continue;
        if (b.body.velocity.length() > TOL_SPEED) continue;
        if (dxz < bd) { bd = dxz; best = i; }
      }
      const ok = best >= 0;
      if (ok) { used[best] = true; matched++; }
      s.matched = ok;
      this.ghost.setMatched(this.slots.indexOf(s), ok);
    }
    this.matched = matched;
    this._hold = matched === this.total ? this._hold + dt : 0;
    if (this._hold >= HOLD_TIME) {
      this.done = true;
      const prev = this.best[this.key];
      this.newBest = prev === undefined || this.time < prev;
      if (this.newBest) { this.best[this.key] = this.time; this._saveBest(); }
      return true;
    }
    return false;
  }

  /** Gentle pulse while a challenge is running. */
  animate(t) { if (this.active) this.ghost.animate(t, this.done); }

  _loadBest() {
    try { return JSON.parse(localStorage.getItem('robotarm.best') || '{}') || {}; } catch (e) { return {}; }
  }
  _saveBest() {
    try { localStorage.setItem('robotarm.best', JSON.stringify(this.best)); } catch (e) { /* ignore */ }
  }
}
