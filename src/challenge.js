import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { PALETTE } from './config.js';

// Ghost layouts. Slot x/z are relative to CENTER; y is the block centre height; h its height.
const CENTER = { x: 0.42, z: 0.3 };
const W = 0.1;
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
const GREEN = 0x5fd38d;

export class Challenge {
  constructor(scene) {
    this.group = new THREE.Group();
    this.group.visible = false;
    scene.add(this.group);

    this.fill = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.16, depthWrite: false });
    this.fillOk = new THREE.MeshBasicMaterial({ color: GREEN, transparent: true, opacity: 0.3, depthWrite: false });
    this.edge = new THREE.LineBasicMaterial({ color: PALETTE.accent, transparent: true, opacity: 0.7 });
    this.edgeOk = new THREE.LineBasicMaterial({ color: GREEN, transparent: true, opacity: 0.95 });
    this._geo = new Map();   // height -> { box, edges }, shared by every slot of that height

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

  _geoFor(h) {
    let g = this._geo.get(h);
    if (!g) {
      const box = new RoundedBoxGeometry(W - 0.002, h - 0.002, W - 0.002, 3, 0.008);
      g = { box, edges: new THREE.EdgesGeometry(new THREE.BoxGeometry(W, h, W)) };
      this._geo.set(h, g);
    }
    return g;
  }

  start(key) {
    this._clearSlots();
    this.key = key;
    this.slots = SHAPES[key].slots.map((s) => {
      const g = this._geoFor(s.h);
      const mesh = new THREE.Mesh(g.box, this.fill);
      const lines = new THREE.LineSegments(g.edges, this.edge);
      mesh.renderOrder = lines.renderOrder = 2;
      const root = new THREE.Group();
      root.position.set(CENTER.x + s.x, s.y, CENTER.z);
      root.add(mesh, lines);
      this.group.add(root);
      return { ...s, mesh, lines, matched: false };
    });
    this.total = this.slots.length;
    this.matched = 0;
    this.active = true;
    this.done = false;
    this.time = 0;
    this._hold = 0;
    this.group.visible = true;
  }

  restart() { if (this.key) this.start(this.key); }

  cancel() {
    this.active = false;
    this.done = false;
    this.group.visible = false;
    this._clearSlots();
  }

  _clearSlots() {
    for (const s of this.slots) this.group.remove(s.mesh.parent);   // geometry/materials are shared, nothing to dispose
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
      if (ok !== s.matched) {
        s.matched = ok;
        s.mesh.material = ok ? this.fillOk : this.fill;
        s.lines.material = ok ? this.edgeOk : this.edge;
      }
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
  animate(t) {
    if (!this.active) return;
    this.fill.opacity = this.done ? 0.1 : 0.14 + 0.05 * Math.sin(t * 2.2);
    this.fillOk.opacity = this.done ? 0.4 : 0.3;
  }

  _loadBest() {
    try { return JSON.parse(localStorage.getItem('robotarm.best') || '{}') || {}; } catch (e) { return {}; }
  }
  _saveBest() {
    try { localStorage.setItem('robotarm.best', JSON.stringify(this.best)); } catch (e) { /* ignore */ }
  }
}
