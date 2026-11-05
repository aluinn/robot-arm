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

const tmpM = new THREE.Matrix4();
const tmpV = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();
const tmpQ2 = new THREE.Quaternion();

export class Physics {
  constructor(arm, specs) {
    this.arm = arm;
    this.world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.81, 0) });
    const w = this.world;
    w.broadphase = new CANNON.SAPBroadphase(w);
    w.allowSleep = true;
    w.solver.iterations = 30;
    w.solver.tolerance = 1e-5;

    const mBlock = new CANNON.Material('block');
    const mFloor = new CANNON.Material('floor');
    const mTool = new CANNON.Material('tool');
    this.mBlock = mBlock;
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
    this._kinFirst = true;

    // Blocks
    this.specs = specs;
    this.blocks = specs.map((s) => {
      const half = new CANNON.Vec3(s.size[0] / 2, s.size[1] / 2, s.size[2] / 2);
      const mass = DENSITY * s.size[0] * s.size[1] * s.size[2];
      const body = new CANNON.Body({
        mass, material: mBlock, shape: new CANNON.Box(half),
        linearDamping: 0.03, angularDamping: 0.25,
        allowSleep: true, sleepSpeedLimit: 0.12, sleepTimeLimit: 0.4,
      });
      w.addBody(body);
      return { body, half, mass, spec: s, mesh: null, blob: null };
    });
    this.held = null;
    this.reset();
  }

  reset() {
    if (this.held) this._release();
    this.blocks.forEach((b) => {
      const s = b.spec;
      b.body.type = CANNON.Body.DYNAMIC;
      b.body.mass = b.mass;
      b.body.updateMassProperties();
      b.body.position.set(s.x, s.size[1] / 2 + 0.0008, s.z);
      b.body.quaternion.setFromEuler(0, s.yaw, 0);
      b.body.velocity.setZero();
      b.body.angularVelocity.setZero();
      b.body.wakeUp();
    });
    this.arm.grip.min = 0;
  }

  step(dt) {
    this._syncKinematics(dt);
    this._updateGrasp(dt);
    this._wakeNearTool();
    this.world.step(dt);
  }

  // cannon-es ignores contacts between a sleeping body and a slow kinematic one, so a gentle
  // push would pass straight through a resting block. Wake anything the tool is touching.
  _wakeNearTool() {
    const movers = [...this.kinFingers, this.kinPalm];
    if (this.held) movers.push(this.held.block.body);
    for (const m of movers) m.updateAABB();
    const pad = 0.012;
    for (const b of this.blocks) {
      const body = b.body;
      if (body.sleepState !== CANNON.Body.SLEEPING) continue;
      body.updateAABB();
      for (const m of movers) {
        if (m === body) continue;
        const a = m.aabb, c = body.aabb;
        if (a.lowerBound.x - pad < c.upperBound.x && a.upperBound.x + pad > c.lowerBound.x &&
            a.lowerBound.y - pad < c.upperBound.y && a.upperBound.y + pad > c.lowerBound.y &&
            a.lowerBound.z - pad < c.upperBound.z && a.upperBound.z + pad > c.lowerBound.z) {
          body.wakeUp();
          break;
        }
      }
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
      tmpQ.set(body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w).invert();
      tmpQ2.copy(quat).multiply(tmpQ);
      if (tmpQ2.w < 0) { tmpQ2.x *= -1; tmpQ2.y *= -1; tmpQ2.z *= -1; tmpQ2.w *= -1; }
      const ang = 2 * Math.acos(Math.min(1, tmpQ2.w));
      const sn = Math.sqrt(Math.max(0, 1 - tmpQ2.w * tmpQ2.w));
      if (sn > 1e-6 && ang > 1e-6) {
        const k = ang / sn / dt;
        body.angularVelocity.set(tmpQ2.x * k, tmpQ2.y * k, tmpQ2.z * k);
      } else body.angularVelocity.setZero();
    }
    body.position.set(pos.x, pos.y, pos.z);
    body.quaternion.set(quat.x, quat.y, quat.z, quat.w);
    body.aabbNeedsUpdate = true;
  }

  _syncKinematics(dt) {
    const first = this._kinFirst;
    this._kinFirst = false;
    this.arm.fingers.forEach((f, i) => {
      f.g.getWorldPosition(tmpV);
      f.g.getWorldQuaternion(tmpQ);
      this._setKinematic(this.kinFingers[i], tmpV, tmpQ, dt, first);
    });
    this.arm.palmNode.getWorldPosition(tmpV);
    this.arm.palmNode.getWorldQuaternion(tmpQ);
    this._setKinematic(this.kinPalm, tmpV, tmpQ, dt, first);
  }

  /* ---------- grasping ----------
   * When the pads close onto a block, the block is welded to the tool frame with a
   * kinematic hold: it eases to the grip centre and axis-aligns with the fingers, then
   * follows the tool exactly (no solver involved -> no jitter, slip or explosions).
   * Opening the gripper hands it back to the solver with the tool's velocity.
   */

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
      tmpM.compose(tmpV, tmpQ, new THREE.Vector3(1, 1, 1));
      tmpM.premultiply(arm.tcpNode.matrixWorld);
      const pos = new THREE.Vector3(), quat = new THREE.Quaternion();
      tmpM.decompose(pos, quat, new THREE.Vector3());
      this._setKinematic(h.block.body, pos, quat, dt, false);
      return;
    }
    g.min = 0;
    if (g.t >= g.v - 1e-4) return; // only while closing

    const inv = new THREE.Matrix4().copy(arm.tcpNode.matrixWorld).invert();
    let best = null;
    for (const b of this.blocks) {
      const bp = b.body.position, bq = b.body.quaternion;
      const world = new THREE.Matrix4().compose(
        new THREE.Vector3(bp.x, bp.y, bp.z),
        new THREE.Quaternion(bq.x, bq.y, bq.z, bq.w),
        new THREE.Vector3(1, 1, 1)
      );
      const rel = inv.clone().multiply(world);
      const e = rel.elements;
      const lx = e[12], ly = e[13], lz = e[14];
      if (Math.abs(lx) > 0.05 || Math.abs(lz) > 0.04 || Math.abs(ly) > 0.05) continue;

      // pads touch the block when the half gap reaches its actual extent along the finger axis
      const hs = [b.half.x, b.half.y, b.half.z];
      const ext = Math.abs(e[0]) * hs[0] + Math.abs(e[4]) * hs[1] + Math.abs(e[8]) * hs[2];
      if (ext > ARM.fingerHalfTravel || g.v > ext + 0.002) continue;

      // nearest axis-aligned orientation relative to the tool (24 candidates)
      let cols = null, bestScore = -Infinity;
      for (const R of ROTS) {
        let sc = 0;
        for (let j = 0; j < 3; j++) sc += R[j][0] * e[j * 4] + R[j][1] * e[j * 4 + 1] + R[j][2] * e[j * 4 + 2];
        if (sc > bestScore) { bestScore = sc; cols = R; }
      }
      let hw = 0;
      for (let j = 0; j < 3; j++) if (cols[j][0] !== 0) hw = hs[j];
      const d = Math.abs(lx) + Math.abs(lz) + Math.abs(ly);
      if (!best || d < best.d) best = { b, hw, d, rel, cols, lx, ly, lz };
    }
    if (!best) return;

    const snap = new THREE.Matrix4().makeBasis(
      new THREE.Vector3(...best.cols[0]),
      new THREE.Vector3(...best.cols[1]),
      new THREE.Vector3(...best.cols[2])
    );
    const p0 = new THREE.Vector3(), q0 = new THREE.Quaternion();
    best.rel.decompose(p0, q0, new THREE.Vector3());
    const q1 = new THREE.Quaternion().setFromRotationMatrix(snap);
    const p1 = new THREE.Vector3(0, THREE.MathUtils.clamp(best.ly, -0.03, 0.03), 0);

    const body = best.b.body;
    body.type = CANNON.Body.KINEMATIC;
    body.mass = 0;
    body.updateMassProperties();
    body.allowSleep = false;
    body.wakeUp();
    this.held = { block: best.b, hw: best.hw, p0, q0, p1, q1, s: 0 };
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
  }
}
