import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { ARM, JOINTS, PALETTE } from './config.js';

const { L1, L2, tcp: TCP, shoulderY } = ARM;
const TURRET_Y = ARM.baseHeight;           // yaw group origin (world y)
const SHOULDER_LOCAL_Y = shoulderY - TURRET_Y;
const FINGER_W = 0.018;
const FINGER_LEN = 0.13;
const FINGER_Y = 0.215;                    // finger centre along tool axis
const PALM_Y = 0.13;

export const FINGER_HALF = { x: FINGER_W / 2, y: FINGER_LEN / 2, z: 0.025 };
export const PALM_HALF = { x: 0.1, y: 0.02, z: 0.0375 };
export { FINGER_Y, PALM_Y };

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const wrapPi = (a) => Math.atan2(Math.sin(a), Math.cos(a));

/* ---------- geometry helpers ---------- */

function lathe(points, seg = 64) {
  return new THREE.LatheGeometry(points.map((p) => new THREE.Vector2(p[0], p[1])), seg);
}

// Cylinder along Y centred on origin with rounded edges.
function roundedCyl(r, h, b, seg = 64) {
  b = Math.min(b, r * 0.9, h * 0.45);
  const pts = [[0, -h / 2]];
  const n = 6;
  for (let i = 0; i <= n; i++) {
    const a = -Math.PI / 2 + (i / n) * (Math.PI / 2);
    pts.push([r - b + b * Math.cos(a), -h / 2 + b + b * Math.sin(a)]);
  }
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * (Math.PI / 2);
    pts.push([r - b + b * Math.cos(a), h / 2 - b + b * Math.sin(a)]);
  }
  pts.push([0, h / 2]);
  return lathe(pts, seg);
}

// Tapered link from y=0 to y=len, soft shoulders, slight belly.
function taperedLink(len, r0, r1, seg = 64) {
  const pts = [[0, 0.002]];
  const n = 28;
  for (let i = 0; i <= n; i++) {
    const s = i / n;
    const y = 0.008 + s * (len - 0.016);
    const r = (r0 + (r1 - r0) * s) * (1 + 0.07 * Math.sin(Math.PI * s));
    pts.push([r, y]);
  }
  pts.push([0, len - 0.002]);
  return lathe(pts, seg);
}

export class Arm {
  constructor() {
    this.group = new THREE.Group();
    this.mats = {
      white: new THREE.MeshStandardMaterial({ color: PALETTE.white, roughness: 0.42, metalness: 0.02 }),
      graphite: new THREE.MeshStandardMaterial({ color: PALETTE.graphite, roughness: 0.46, metalness: 0.4 }),
      rubber: new THREE.MeshStandardMaterial({ color: PALETTE.rubber, roughness: 0.95, metalness: 0 }),
      accent: new THREE.MeshStandardMaterial({
        color: PALETTE.accent, roughness: 0.4, metalness: 0.1,
        emissive: PALETTE.accent, emissiveIntensity: 0.18,
      }),
    };
    this._build();

    this.q = JOINTS.map((j) => ({ v: j.start, vel: 0, t: j.start }));
    this.grip = { v: ARM.fingerHalfTravel, vel: 0, t: ARM.fingerHalfTravel, min: 0 };
    this.mode = 'cartesian';
    this.fine = false;
    this.target = { pos: new THREE.Vector3(0.0, 0.3, 0.5), yaw: 0 };
    this._lastValid = { pos: this.target.pos.clone(), yaw: 0 };

    const q = this.solveIK(this.target.pos, this.target.yaw, 0);
    q.forEach((v, i) => { this.q[i].v = this.q[i].t = v; });
    this._apply();
    this.group.updateMatrixWorld(true);
  }

  /* ---------- model ---------- */

  _build() {
    const { white, graphite, rubber, accent } = this.mats;
    const add = (parent, geo, mat, x = 0, y = 0, z = 0) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      parent.add(m);
      return m;
    };
    const alongX = (g) => { g.rotateZ(Math.PI / 2); return g; };
    const ring = (parent, r, tube, mat, x, y, z, axis) => {
      const t = new THREE.Mesh(new THREE.TorusGeometry(r, tube, 16, 72), mat);
      if (axis === 'x') t.rotation.y = Math.PI / 2;
      else t.rotation.x = Math.PI / 2;
      t.position.set(x, y, z);
      parent.add(t);
    };

    // Static base
    const base = new THREE.Group();
    this.group.add(base);
    add(base, roundedCyl(0.215, 0.03, 0.012), graphite, 0, 0.015, 0);
    add(base, lathe([[0, 0.03], [0.185, 0.03], [0.19, 0.04], [0.17, 0.065], [0.14, TURRET_Y - 0.01], [0.135, TURRET_Y], [0, TURRET_Y]]), white);
    ring(base, 0.178, 0.0035, accent, 0, 0.047, 0, 'y');

    // Yaw turret
    this.yawG = new THREE.Group();
    this.yawG.position.y = TURRET_Y;
    this.group.add(this.yawG);
    add(this.yawG, roundedCyl(0.125, 0.06, 0.02), graphite, 0, 0.03, 0);
    add(this.yawG, lathe([[0, 0.06], [0.115, 0.06], [0.118, 0.12], [0.105, 0.25], [0.095, SHOULDER_LOCAL_Y - 0.03], [0, SHOULDER_LOCAL_Y - 0.03]]), white);
    // Shoulder cheeks
    for (const s of [-1, 1]) {
      add(this.yawG, new RoundedBoxGeometry(0.05, 0.22, 0.2, 5, 0.02), white, s * 0.108, SHOULDER_LOCAL_Y - 0.02, 0);
      add(this.yawG, alongX(roundedCyl(0.062, 0.03, 0.009)), graphite, s * 0.145, SHOULDER_LOCAL_Y, 0);
      ring(this.yawG, 0.045, 0.0028, accent, s * 0.1615, SHOULDER_LOCAL_Y, 0, 'x');
    }

    // Shoulder
    this.shoulderG = new THREE.Group();
    this.shoulderG.position.y = SHOULDER_LOCAL_Y;
    this.yawG.add(this.shoulderG);
    add(this.shoulderG, alongX(roundedCyl(0.082, 0.17, 0.02)), graphite);
    add(this.shoulderG, taperedLink(L1, 0.07, 0.056), white);

    // Elbow
    this.elbowG = new THREE.Group();
    this.elbowG.position.y = L1;
    this.shoulderG.add(this.elbowG);
    add(this.elbowG, alongX(roundedCyl(0.07, 0.15, 0.018)), graphite);
    for (const s of [-1, 1]) {
      add(this.elbowG, alongX(roundedCyl(0.048, 0.012, 0.004)), white, s * 0.081, 0, 0);
    }
    ring(this.elbowG, 0.058, 0.003, accent, 0.0765, 0, 0, 'x');
    add(this.elbowG, taperedLink(L2, 0.054, 0.04), white);
    // cable-guide band on forearm
    add(this.elbowG, roundedCyl(0.052, 0.04, 0.012), graphite, 0, L2 * 0.14, 0);

    // Wrist pitch
    this.wristG = new THREE.Group();
    this.wristG.position.y = L2;
    this.elbowG.add(this.wristG);
    add(this.wristG, alongX(roundedCyl(0.047, 0.125, 0.014)), graphite);
    add(this.wristG, roundedCyl(0.04, 0.09, 0.014), white, 0, 0.045, 0);
    ring(this.wristG, 0.0415, 0.0025, accent, 0, 0.082, 0, 'y');

    // Wrist roll + gripper
    this.rollG = new THREE.Group();
    this.wristG.add(this.rollG);
    add(this.rollG, roundedCyl(0.044, 0.03, 0.01), graphite, 0, 0.095, 0);
    add(this.rollG, new RoundedBoxGeometry(0.2, 0.04, 0.075, 5, 0.012), white, 0, PALM_Y, 0);
    add(this.rollG, new RoundedBoxGeometry(0.19, 0.012, 0.03, 3, 0.004), graphite, 0, 0.155, 0);

    this.fingers = [];
    for (const s of [-1, 1]) {
      const f = new THREE.Group();
      f.position.y = FINGER_Y;
      this.rollG.add(f);
      add(f, new RoundedBoxGeometry(FINGER_W, FINGER_LEN, 0.05, 4, 0.006), graphite);
      // rubber pad on inner face
      add(f, new RoundedBoxGeometry(0.004, FINGER_LEN * 0.78, 0.044, 2, 0.0015), rubber, -s * (FINGER_W / 2 + 0.0005), -0.008, 0);
      this.fingers.push({ g: f, side: s });
    }

    this.palmNode = new THREE.Object3D();
    this.palmNode.position.y = PALM_Y;
    this.rollG.add(this.palmNode);

    this.tcpNode = new THREE.Object3D();
    this.tcpNode.position.y = TCP;
    this.rollG.add(this.tcpNode);

    this.group.traverse((o) => {
      if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; }
    });
  }

  /* ---------- kinematics ---------- */

  // Returns [yaw, shoulder, elbow, wrist, roll] or null if unreachable / out of limits.
  solveIK(pos, yaw, prevRoll) {
    const r = Math.hypot(pos.x, pos.z);
    if (r < 0.14 || pos.y < ARM.minTcpY - 1e-6) return null;
    const q0 = Math.atan2(pos.x, pos.z);
    const lim = JOINTS;
    if (q0 < lim[0].min || q0 > lim[0].max) return null;

    for (let k = 0; k <= 14; k++) {
      const dphi = k === 0 ? 0 : (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.05;
      const phi = Math.PI + dphi;
      const Wr = r - TCP * Math.sin(phi);
      const Wy = pos.y - TCP * Math.cos(phi) - shoulderY;
      const d2 = Wr * Wr + Wy * Wy;
      const c = (d2 - L1 * L1 - L2 * L2) / (2 * L1 * L2);
      if (c < -1 || c > 1) continue;
      const q2 = Math.acos(c);
      const q1 = Math.atan2(Wr, Wy) - Math.atan2(L2 * Math.sin(q2), L1 + L2 * c);
      const q3 = wrapPi(phi - q1 - q2);
      if (q1 < lim[1].min || q1 > lim[1].max) continue;
      if (q2 < lim[2].min || q2 > lim[2].max) continue;
      if (q3 < lim[3].min || q3 > lim[3].max) continue;
      // Gripper is symmetric under 180deg: pick the equivalent roll nearest the current one.
      const want = q0 - yaw;
      let best = null;
      for (let m = -3; m <= 3; m++) {
        const cand = want + m * Math.PI;
        if (Math.abs(cand) > lim[4].max) continue;
        if (best === null || Math.abs(cand - prevRoll) < Math.abs(best - prevRoll)) best = cand;
      }
      if (best === null) continue;
      return [q0, q1, q2, q3, best];
    }
    return null;
  }

  // Forward kinematics from joint angles -> TCP position and world yaw of the fingers.
  forward(q = this.q.map((j) => j.v)) {
    const a1 = q[1], a2 = q[1] + q[2], a3 = a2 + q[3];
    const r = L1 * Math.sin(a1) + L2 * Math.sin(a2) + TCP * Math.sin(a3);
    const y = shoulderY + L1 * Math.cos(a1) + L2 * Math.cos(a2) + TCP * Math.cos(a3);
    return {
      pos: new THREE.Vector3(r * Math.sin(q[0]), y, r * Math.cos(q[0])),
      yaw: q[0] - q[4],
    };
  }

  /* ---------- control API ---------- */

  setMode(mode) {
    if (mode === this.mode) return;
    this.mode = mode;
    if (mode === 'cartesian') this._syncTargetFromJoints();
  }

  _syncTargetFromJoints() {
    const f = this.forward();
    const roll = this.q[4].v;
    const tryPos = (p) => {
      const sol = this.solveIK(p, f.yaw, roll);
      if (sol) { this._commit(p, f.yaw, sol); return true; }
      return false;
    };
    const p = f.pos.clone();
    p.y = Math.max(p.y, ARM.minTcpY);
    for (let i = 0; i < 20; i++) {
      if (tryPos(p)) return;
      p.y += 0.02;
      p.x *= 0.98; p.z *= 0.98;
    }
    this._commit(this._lastValid.pos, f.yaw, this.solveIK(this._lastValid.pos, f.yaw, roll));
  }

  _commit(pos, yaw, sol) {
    this.target.pos.copy(pos);
    this.target.yaw = yaw;
    this._lastValid.pos.copy(pos);
    if (sol) sol.forEach((v, i) => { this.q[i].t = v; });
  }

  // Cartesian nudge. Slides along the workspace boundary instead of sticking.
  moveTarget(dx, dy, dz, dyaw) {
    const t = this.target;
    const yaw = t.yaw + dyaw;
    const roll = this.q[4].t;
    const r = Math.hypot(t.pos.x, t.pos.z) || 1;
    const ux = t.pos.x / r, uz = t.pos.z / r;
    const a = dx * ux + dz * uz;           // radial part
    const b = -dx * uz + dz * ux;          // tangential part
    const cands = [
      [dx, dy, dz],
      [-b * uz, dy, b * ux],
      [a * ux, dy, a * uz],
      [-b * uz, 0, b * ux],
      [a * ux, 0, a * uz],
      [0, dy, 0],
      [0, 0, 0],
    ];
    for (const [cx, cy, cz] of cands) {
      const p = new THREE.Vector3(
        clamp(t.pos.x + cx, -1.1, 1.1),
        clamp(t.pos.y + cy, ARM.minTcpY, 0.85),
        clamp(t.pos.z + cz, -1.1, 1.1)
      );
      const sol = this.solveIK(p, yaw, roll);
      if (sol) { this._commit(p, yaw, sol); return true; }
    }
    return false;
  }

  setJointTarget(i, v) {
    this.q[i].t = clamp(v, JOINTS[i].min, JOINTS[i].max);
  }

  setGripperTarget(half) {
    this.grip.t = clamp(half, 0, ARM.fingerHalfTravel);
  }

  /* ---------- dynamics ---------- */

  step(dt) {
    const st = this.fine ? 0.26 : 0.15;
    for (const j of this.q) smoothDamp(j, st, 4.0, dt);
    smoothDamp(this.grip, 0.07, 0.6, dt);
    if (this.grip.v < this.grip.min) {
      this.grip.v = this.grip.min;
      if (this.grip.vel < 0) this.grip.vel = 0;
    }
    this._apply();
    this.group.updateMatrixWorld(true);
  }

  _apply() {
    const q = this.q;
    this.yawG.rotation.y = q[0].v;
    this.shoulderG.rotation.x = q[1].v;
    this.elbowG.rotation.x = q[2].v;
    this.wristG.rotation.x = q[3].v;
    this.rollG.rotation.y = q[4].v;
    for (const f of this.fingers) f.g.position.x = f.side * (this.grip.v + FINGER_W / 2);
  }
}

// Critically damped spring (exact-ish SmoothDamp), with a speed cap. State is {v, vel, t}.
function smoothDamp(s, smoothTime, maxSpeed, dt) {
  const omega = 2 / smoothTime;
  const x = omega * dt;
  const e = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const maxChange = maxSpeed * smoothTime;
  const change = clamp(s.v - s.t, -maxChange, maxChange);
  const target = s.v - change;
  const temp = (s.vel + omega * change) * dt;
  s.vel = (s.vel - omega * temp) * e;
  let out = target + (change + temp) * e;
  if ((s.t - s.v > 0) === (out > s.t)) { out = s.t; s.vel = 0; }
  s.v = out;
}
