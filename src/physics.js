import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { ARM, PALETTE } from './config.js';
import { FINGER_HALF, PALM_HALF } from './arm.js';

const DENSITY = 350;           // kg/m^3 (light wood-like)
const GRASP_BLEND = 0.2;       // seconds to ease a block to the grip centre

/* ---------- fixed-seed block layout ---------- */

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeBlockSpecs(seed = 7) {
  const rnd = mulberry32(seed);
  const xs = [-0.27, 0, 0.27];
  const rows = [0.5, 0.74];
  const heights = [0.1, 0.14, 0.1, 0.14, 0.1, 0.1];
  const specs = [];
  let i = 0;
  for (const z of rows) {
    for (const x of xs) {
      specs.push({
        x: x + (rnd() - 0.5) * 0.02,
        z: z + (rnd() - 0.5) * 0.02,
        yaw: (rnd() - 0.5) * 0.12,
        size: [0.1, heights[i], 0.1],
        color: PALETTE.blocks[i % PALETTE.blocks.length],
      });
      i++;
    }
  }
  return specs;
}

/* ---------- the 24 axis-aligned rotations (for snapping a grasped block) ---------- */

// column vectors of all proper rotations that map the axes onto the axes
const ROTS = (() => {
  const out = [];
  const perms = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
  for (const p of perms) {
    for (let sg = 0; sg < 8; sg++) {
      const sign = [sg & 1 ? -1 : 1, sg & 2 ? -1 : 1, sg & 4 ? -1 : 1];
      const cols = p.map((k, j) => { const v = [0, 0, 0]; v[k] = sign[j]; return v; });
      const det = new THREE.Matrix4().makeBasis(
        new THREE.Vector3(...cols[0]), new THREE.Vector3(...cols[1]), new THREE.Vector3(...cols[2])
      ).determinant();
      if (det > 0) out.push(cols);
    }
  }
  return out;
})();

// Scratch objects: the step loop runs ~120x per second, so nothing in it may allocate.
const tmpM = new THREE.Matrix4();
const tmpInv = new THREE.Matrix4();
const tmpWorld = new THREE.Matrix4();
const tmpRel = new THREE.Matrix4();
const bestRel = new THREE.Matrix4();
const tmpV = new THREE.Vector3();
const tmpP = new THREE.Vector3();
const tmpS = new THREE.Vector3();
const ONE = new THREE.Vector3(1, 1, 1);
const tmpQ = new THREE.Quaternion();
const tmpQ2 = new THREE.Quaternion();
const tmpQ3 = new THREE.Quaternion();
const kInv = new THREE.Quaternion();   // _setKinematic only
const kDelta = new THREE.Quaternion();
const tmpBasis = new THREE.Matrix4();
const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();
const tmpC = new THREE.Vector3();

// Blocks that are nearly at rest get heavy damping so residual rocking (a tall stack after a
// placement) dies out and they fall asleep. Fast-moving blocks keep the light base damping.
const REST_LIN = 0.5, REST_ANG = 0.9;
const BASE_LIN = 0.03, BASE_ANG = 0.25;
const REST_SPEED = 0.15, REST_SPIN = 1.5;      // m/s, rad/s
// A block that is resting on something and calm for this long is put to sleep. The solver's own
// sleep test never triggers for a tall stack because of tiny high-frequency contact jitter, and an
// awake stack slowly creeps and topples.
const CALM_SPEED = 0.1, CALM_SPIN = 1.0, CALM_STEPS = 30;

export class Physics {
  constructor(arm, specs) {
    this.arm = arm;
    this.blocks = specs.map((s) => ({
      spec: s,
      half: new CANNON.Vec3(s.size[0] / 2, s.size[1] / 2, s.size[2] / 2),
      mass: DENSITY * s.size[0] * s.size[1] * s.size[2],
      body: null, mesh: null, blob: null,
    }));
    this.held = null;
    this.onGrasp = null;    // (block) => void
    this.onRelease = null;  // (block) => void
    this.rebuild(null);
  }

  /**
   * Build a brand-new physics world, optionally from a captured block state.
   * Starting every run (live recording and replay alike) from a fresh world with the same
   * body ids and no leftover broadphase/contact history is what makes replays exact.
   */
  rebuild(state) {
    CANNON.Body.idCounter = 0;
    CANNON.Shape.idCounter = 0;
    CANNON.Material.idCounter = 0;
    this.held = null;
    this._kinFirst = true;
    this._touched = new Set();

    const w = this.world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.81, 0) });
    w.broadphase = new CANNON.SAPBroadphase(w);
    w.allowSleep = true;
    // @ts-expect-error untyped JS (checkJs): array spread / ad-hoc property
    w.solver.iterations = 30;
    // @ts-expect-error untyped JS (checkJs): array spread / ad-hoc property
    w.solver.tolerance = 1e-5;

    const mBlock = new CANNON.Material('block');
    const mFloor = new CANNON.Material('floor');
    const mTool = new CANNON.Material('tool');
    const contact = (a, b, friction) =>
      w.addContactMaterial(new CANNON.ContactMaterial(a, b, {
        friction, restitution: 0.0,
        contactEquationStiffness: 1e7, contactEquationRelaxation: 4,
        frictionEquationStiffness: 1e7, frictionEquationRelaxation: 4,
      }));
    contact(mBlock, mFloor, 0.7);
    contact(mBlock, mBlock, 0.6);
    contact(mBlock, mTool, 0.8);

    // Floor
    const floor = new CANNON.Body({ mass: 0, material: mFloor, shape: new CANNON.Plane() });
    floor.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    w.addBody(floor);

    // Pedestal / turret column (static; it is rotationally symmetric)
    const col = new CANNON.Body({ mass: 0, material: mFloor });
    col.addShape(new CANNON.Cylinder(0.215, 0.215, 0.06, 20), new CANNON.Vec3(0, 0.03, 0));
    col.addShape(new CANNON.Cylinder(0.13, 0.15, 0.5, 20), new CANNON.Vec3(0, 0.25, 0));
    w.addBody(col);

    // Kinematic gripper bodies
    const kin = (half) => {
      const b = new CANNON.Body({
        mass: 0, type: CANNON.Body.KINEMATIC, material: mTool,
        shape: new CANNON.Box(new CANNON.Vec3(half.x, half.y, half.z)),
      });
      w.addBody(b);
      return b;
    };
    this.kinFingers = [kin(FINGER_HALF), kin(FINGER_HALF)];
    this.kinPalm = kin(PALM_HALF);
    this._tools = [...this.kinFingers, this.kinPalm];
    // @ts-expect-error untyped JS (checkJs): array spread / ad-hoc property
    this._tools.forEach((t) => { t.isTool = true; });

    // Blocks (state === null -> the default layout)
    this.blocks.forEach((b, i) => {
      const s = b.spec;
      const body = new CANNON.Body({
        mass: b.mass, material: mBlock, shape: new CANNON.Box(b.half),
        linearDamping: BASE_LIN, angularDamping: BASE_ANG,
        allowSleep: true, sleepSpeedLimit: 0.12, sleepTimeLimit: 0.4,
      });
      const st = state && state[i];
      if (st) {
        // @ts-expect-error untyped JS (checkJs): array spread / ad-hoc property
        body.position.set(...st.p);
        // @ts-expect-error untyped JS (checkJs): array spread / ad-hoc property
        body.quaternion.set(...st.q);
        // @ts-expect-error untyped JS (checkJs): array spread / ad-hoc property
        body.velocity.set(...st.v);
        // @ts-expect-error untyped JS (checkJs): array spread / ad-hoc property
        body.angularVelocity.set(...st.w);
      } else {
        body.position.set(s.x, s.size[1] / 2 + 0.0008, s.z);
        body.quaternion.setFromEuler(0, s.yaw, 0);
      }
      body.previousPosition.copy(body.position);
      body.interpolatedPosition.copy(body.position);
      w.addBody(body);
      if (st && st.s === CANNON.Body.SLEEPING) body.sleep();
      b.body = body;
      b.calm = 0;
    });
    this.arm.grip.min = 0;
  }

  /** Exact, JSON-safe state of every block. */
  capture() {
    return this.blocks.map((b) => {
      const o = b.body;
      return {
        p: [o.position.x, o.position.y, o.position.z],
        q: [o.quaternion.x, o.quaternion.y, o.quaternion.z, o.quaternion.w],
        v: [o.velocity.x, o.velocity.y, o.velocity.z],
        w: [o.angularVelocity.x, o.angularVelocity.y, o.angularVelocity.z],
        s: o.sleepState,
      };
    });
  }

  step(dt) {
    this._syncKinematics(dt);
    this._updateGrasp(dt);
    this._wakeNearTool();
    this.world.step(dt);
    this._updateRest();
    this._updateToolState();
  }

  _updateRest() {
    const touched = this._touched;
    touched.clear();
    const cs = this.world.contacts;
    for (let i = 0; i < cs.length; i++) { touched.add(cs[i].bi); touched.add(cs[i].bj); }
    for (const b of this.blocks) {
      const o = b.body;
      if (o.type !== CANNON.Body.DYNAMIC || o.sleepState === CANNON.Body.SLEEPING) { b.calm = 0; continue; }
      const v2 = o.velocity.lengthSquared(), w2 = o.angularVelocity.lengthSquared();
      const resting = v2 < REST_SPEED * REST_SPEED && w2 < REST_SPIN * REST_SPIN;
      o.linearDamping = resting ? REST_LIN : BASE_LIN;
      o.angularDamping = resting ? REST_ANG : BASE_ANG;
      const calm = v2 < CALM_SPEED * CALM_SPEED && w2 < CALM_SPIN * CALM_SPIN && touched.has(o);
      b.calm = calm ? b.calm + 1 : 0;
      if (b.calm >= CALM_STEPS) { o.sleep(); b.calm = 0; }
    }
  }

  // Tells the arm when it is working near blocks, so its idle "breathing" can fade out.
  _updateToolState() {
    const arm = this.arm;
    let busy = !!this.held || arm.grip.t < arm.grip.v - 1e-4 || arm.tcpNode.matrixWorld.elements[13] < 0.1;
    if (!busy) {
      const cs = this.world.contacts;
      for (let i = 0; i < cs.length; i++) {
        // @ts-expect-error untyped JS (checkJs): array spread / ad-hoc property
        if (cs[i].bi.isTool || cs[i].bj.isTool) { busy = true; break; }
      }
    }
    arm.breathT = busy || arm.precise ? 0 : 1;
  }

  // cannon-es ignores contacts between a sleeping body and a slow kinematic one, so a gentle
  // push would pass straight through a resting block. Wake anything the tool is touching.
  _wakeNearTool() {
    for (const m of this._tools) m.updateAABB();
    const held = this.held ? this.held.block.body : null;
    if (held) held.updateAABB();
    const pad = 0.012;
    for (const b of this.blocks) {
      const body = b.body;
      if (body.sleepState !== CANNON.Body.SLEEPING) continue;
      body.updateAABB();
      if (touches(this._tools[0], body, pad) || touches(this._tools[1], body, pad) ||
          touches(this._tools[2], body, pad) || (held && touches(held, body, pad))) body.wakeUp();
    }
  }

  /* ---------- kinematic tool bodies ---------- */

  _setKinematic(body, pos, quat, dt, first) {
    if (first) {
      body.velocity.setZero();
      body.angularVelocity.setZero();
    } else {
      body.velocity.set(
        (pos.x - body.position.x) / dt,
        (pos.y - body.position.y) / dt,
        (pos.z - body.position.z) / dt
      );
      // angular velocity from quaternion delta
      kInv.set(body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w).invert();
      kDelta.copy(quat).multiply(kInv);
      if (kDelta.w < 0) { kDelta.x *= -1; kDelta.y *= -1; kDelta.z *= -1; kDelta.w *= -1; }
      const ang = 2 * Math.acos(Math.min(1, kDelta.w));
      const sn = Math.sqrt(Math.max(0, 1 - kDelta.w * kDelta.w));
      if (sn > 1e-6 && ang > 1e-6) {
        const k = ang / sn / dt;
        body.angularVelocity.set(kDelta.x * k, kDelta.y * k, kDelta.z * k);
      } else body.angularVelocity.setZero();
    }
    body.position.set(pos.x, pos.y, pos.z);
    body.quaternion.set(quat.x, quat.y, quat.z, quat.w);
    body.aabbNeedsUpdate = true;
  }

  _syncKinematics(dt) {
    const first = this._kinFirst;
    this._kinFirst = false;
    for (let i = 0; i < 2; i++) {
      const g = this.arm.fingers[i].g;
      g.getWorldPosition(tmpV);
      g.getWorldQuaternion(tmpQ3);
      this._setKinematic(this.kinFingers[i], tmpV, tmpQ3, dt, first);
    }
    this.arm.palmNode.getWorldPosition(tmpV);
    this.arm.palmNode.getWorldQuaternion(tmpQ3);
    this._setKinematic(this.kinPalm, tmpV, tmpQ3, dt, first);
  }

  /* ---------- grasping ----------
   * When the pads close onto a block, the block is welded to the tool frame with a
   * kinematic hold: it eases to the grip centre and axis-aligns with the fingers, then
   * follows the tool exactly (no solver involved -> no jitter, slip or explosions).
   * Opening the gripper hands it back to the solver with the tool's velocity.
   */

  // Block pose in the tool-centre frame -> tmpRel
  _relTo(b) {
    const bp = b.body.position, bq = b.body.quaternion;
    tmpWorld.compose(tmpP.set(bp.x, bp.y, bp.z), tmpQ3.set(bq.x, bq.y, bq.z, bq.w), ONE);
    tmpRel.copy(tmpInv).multiply(tmpWorld);
    return tmpRel.elements;
  }

  _updateGrasp(dt) {
    const arm = this.arm, g = arm.grip;
    arm.tcpNode.updateWorldMatrix(true, false);

    if (this.held) {
      const h = this.held;
      if (g.t > h.hw + 0.006) { this._release(); g.min = 0; return; }
      g.min = h.hw;
      h.s = Math.min(1, h.s + dt / GRASP_BLEND);
      const e = h.s * h.s * (3 - 2 * h.s);
      tmpV.copy(h.p0).lerp(h.p1, e);
      tmpQ.copy(h.q0).slerp(h.q1, e);
      tmpM.compose(tmpV, tmpQ, ONE);
      tmpM.premultiply(arm.tcpNode.matrixWorld);
      tmpM.decompose(tmpA, tmpQ2, tmpS);
      this._setKinematic(h.block.body, tmpA, tmpQ2, dt, false);
      return;
    }
    g.min = 0;
    if (g.t >= g.v - 1e-4) return; // only while closing

    tmpInv.copy(arm.tcpNode.matrixWorld).invert();
    let best = null;
    for (const b of this.blocks) {
      const e = this._relTo(b);
      const lx = e[12], ly = e[13], lz = e[14];
      if (Math.abs(lx) > 0.05 || Math.abs(lz) > 0.04 || Math.abs(ly) > 0.05) continue;

      // pads touch the block when the half gap reaches its actual extent along the finger axis
      const ext = Math.abs(e[0]) * b.half.x + Math.abs(e[4]) * b.half.y + Math.abs(e[8]) * b.half.z;
      if (ext > ARM.fingerHalfTravel || g.v > ext + 0.002) continue;

      // nearest axis-aligned orientation relative to the tool (24 candidates)
      let cols = null, bestScore = -Infinity;
      for (const R of ROTS) {
        let sc = 0;
        for (let j = 0; j < 3; j++) sc += R[j][0] * e[j * 4] + R[j][1] * e[j * 4 + 1] + R[j][2] * e[j * 4 + 2];
        if (sc > bestScore) { bestScore = sc; cols = R; }
      }
      let hw;
      if (cols[0][0] !== 0) hw = b.half.x; else if (cols[1][0] !== 0) hw = b.half.y; else hw = b.half.z;
      const d = Math.abs(lx) + Math.abs(lz) + Math.abs(ly);
      if (!best || d < best.d) { best = { b, hw, d, cols, ly }; bestRel.copy(tmpRel); }
    }
    if (!best) return;

    // @ts-expect-error untyped JS (checkJs): array spread / ad-hoc property
    tmpBasis.makeBasis(tmpA.set(...best.cols[0]), tmpB.set(...best.cols[1]), tmpC.set(...best.cols[2]));
    const p0 = new THREE.Vector3(), q0 = new THREE.Quaternion();   // once per grasp
    bestRel.decompose(p0, q0, tmpS);
    const q1 = new THREE.Quaternion().setFromRotationMatrix(tmpBasis);
    const p1 = new THREE.Vector3(0, THREE.MathUtils.clamp(best.ly, -0.03, 0.03), 0);

    const body = best.b.body;
    body.type = CANNON.Body.KINEMATIC;
    body.mass = 0;
    body.updateMassProperties();
    body.allowSleep = false;
    body.wakeUp();
    this.held = { block: best.b, hw: best.hw, p0, q0, p1, q1, s: 0 };
    if (this.onGrasp) this.onGrasp(best.b);
  }

  _release() {
    const b = this.held.block;
    const body = b.body;
    body.type = CANNON.Body.DYNAMIC;
    body.mass = b.mass;
    body.updateMassProperties();
    body.allowSleep = true;
    body.wakeUp();
    // limit hand-off velocity so a fast release cannot launch the block
    const v = body.velocity;
    const sp = v.length();
    if (sp > 1.5) v.scale(1.5 / sp, v);
    this.held = null;
    if (this.onRelease) this.onRelease(b);
  }

  /**
   * Which block would a grab pick right now? (visual feedback only)
   * Returns { block, ready } or null. `ready` means it is inside the grasp zone.
   */
  candidate() {
    if (this.held) return null;
    this.arm.tcpNode.updateWorldMatrix(true, false);
    tmpInv.copy(this.arm.tcpNode.matrixWorld).invert();
    let best = null, bd = 0.2;
    for (const b of this.blocks) {
      const e = this._relTo(b);
      const lx = e[12], ly = e[13], lz = e[14];
      const d = Math.hypot(lx, ly, lz);
      if (d >= bd) continue;
      bd = d;
      const ext = Math.abs(e[0]) * b.half.x + Math.abs(e[4]) * b.half.y + Math.abs(e[8]) * b.half.z;
      best = { block: b, ready: Math.abs(lx) < 0.05 && Math.abs(lz) < 0.04 && Math.abs(ly) < 0.05 && ext <= ARM.fingerHalfTravel };
    }
    return best;
  }
}

function touches(m, body, pad) {
  const a = m.aabb, c = body.aabb;
  return a.lowerBound.x - pad < c.upperBound.x && a.upperBound.x + pad > c.lowerBound.x &&
         a.lowerBound.y - pad < c.upperBound.y && a.upperBound.y + pad > c.lowerBound.y &&
         a.lowerBound.z - pad < c.upperBound.z && a.upperBound.z + pad > c.lowerBound.z;
}
