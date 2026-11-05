import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { PALETTE } from './config.js';

const W = 0.1;
const GREEN = 0x5fd38d;

/** A translucent "ghost" of a block structure. Slots turn green as they are filled. */
export class Ghost {
  constructor(scene) {
    this.group = new THREE.Group();
    this.group.visible = false;
    scene.add(this.group);
    this.fill = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.16, depthWrite: false });
    this.fillOk = new THREE.MeshBasicMaterial({ color: GREEN, transparent: true, opacity: 0.3, depthWrite: false });
    this.edge = new THREE.LineBasicMaterial({ color: PALETTE.accent, transparent: true, opacity: 0.7 });
    this.edgeOk = new THREE.LineBasicMaterial({ color: GREEN, transparent: true, opacity: 0.95 });
    this._geo = new Map();    // height -> shared geometry
    this.slots = [];
  }

  get visible() { return this.group.visible; }

  _geoFor(h) {
    let g = this._geo.get(h);
    if (!g) {
      g = {
        box: new RoundedBoxGeometry(W - 0.002, h - 0.002, W - 0.002, 3, 0.008),
        edges: new THREE.EdgesGeometry(new THREE.BoxGeometry(W, h, W)),
      };
      this._geo.set(h, g);
    }
    return g;
  }

  /** slots: [{ x, z?, y, h }] relative to center {x, z}. */
  show(slots, center) {
    this.clear();
    this.slots = slots.map((s) => {
      const g = this._geoFor(s.h);
      const mesh = new THREE.Mesh(g.box, this.fill);
      const lines = new THREE.LineSegments(g.edges, this.edge);
      mesh.renderOrder = lines.renderOrder = 2;
      const root = new THREE.Group();
      root.position.set(center.x + s.x, s.y, center.z + (s.z || 0));
      root.add(mesh, lines);
      this.group.add(root);
      return { mesh, lines, root, matched: false };
    });
    this.group.visible = true;
  }

  hide() { this.clear(); this.group.visible = false; }

  clear() {
    for (const s of this.slots) this.group.remove(s.root);   // geometry and materials are shared
    this.slots = [];
  }

  setMatched(i, ok) {
    const s = this.slots[i];
    if (!s || s.matched === ok) return;
    s.matched = ok;
    s.mesh.material = ok ? this.fillOk : this.fill;
    s.lines.material = ok ? this.edgeOk : this.edge;
  }

  /** Gentle pulse; calmer once everything is placed. */
  animate(t, calm = false) {
    if (!this.group.visible) return;
    this.fill.opacity = calm ? 0.1 : 0.14 + 0.05 * Math.sin(t * 2.2);
    this.fillOk.opacity = calm ? 0.4 : 0.3;
  }
}
