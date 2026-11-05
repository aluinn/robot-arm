// Auto-Build: plans and executes a structure using the known block positions.
//
// It is a controller, like the keyboard: every motion goes through Arm.setTargetPose (the same IK),
// once per fixed physics step, so a build can be recorded and replayed like any other input.
// The executor is a generator that yields once per step; nothing here teleports a block. Blocks are
// only ever moved by the gripper, and every grasp and placement is verified against the physics.
import { ARM, PHYS } from './config.js';
import { STRUCTURES, SITE } from './structures.js';

const DT = PHYS.step;
const OPEN = ARM.fingerHalfTravel;
const PI = Math.PI;

// finger / palm geometry (see arm.js), used for clearance tests
const FINGER_X = OPEN + 0.009;        // finger centre offset from the tool axis when open
const FINGER_HU = 0.009 + 0.007;      // half sizes plus a safety margin
const FINGER_HV = 0.025 + 0.007;
const PALM_HU = 0.1 + 0.005, PALM_HV = 0.0375 + 0.005;
const TIP_BELOW = 0.035;              // fingertip below the TCP
const PALM_ABOVE = 0.095;             // palm underside above the TCP

class BuildError extends Error {}

/* ---------- small geometry helpers ---------- */

const yawOf = (body) => {
  const q = body.quaternion;
  return Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.x * q.x));
};
const upOf = (body) => 1 - 2 * (body.quaternion.x ** 2 + body.quaternion.z ** 2);
const isUpright = (b) => upOf(b.body) > 0.95;
const heightOf = (b) => 2 * b.half.y;
const topOf = (b) => b.body.position.y + b.half.y;
const botOf = (b) => b.body.position.y - b.half.y;
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// rectangles in the ground plane: centre, axis angle, half sizes. u = (c, -s), v = (s, c).
const rect = (x, z, ang, hu, hv) => ({ x, z, c: Math.cos(ang), s: Math.sin(ang), hu, hv });
function rectsHit(a, b) {
  const dx = b.x - a.x, dz = b.z - a.z;
  const axes = [[a.c, -a.s], [a.s, a.c], [b.c, -b.s], [b.s, b.c]];
  for (const [ax, az] of axes) {
    const ra = a.hu * Math.abs(a.c * ax - a.s * az) + a.hv * Math.abs(a.s * ax + a.c * az);
    const rb = b.hu * Math.abs(b.c * ax - b.s * az) + b.hv * Math.abs(b.s * ax + b.c * az);
    if (Math.abs(dx * ax + dz * az) > ra + rb) return false;
  }
  return true;
}
const footprint = (b) => {
  const p = b.body.position;
  const e = isUpright(b) ? 0.05 : 0.09;     // a tilted block: assume a generous footprint
  return rect(p.x, p.z, yawOf(b.body), e, e);
};

const minJerk = (t) => t * t * t * (10 - 15 * t + 6 * t * t);

export class AutoBuild {
  constructor(arm, physics) {
    this.arm = arm;
    this.physics = physics;
    this.state = 'idle';        // idle | running | done | failed | cancelled
    this.key = null;
    this.slots = [];
    this.filled = [];           // which slots currently hold a correct block (for the ghost)
    this.index = 0;             // slot being built (0-based)
    this.phase = '';
    this.message = '';
    this.time = 0;              // seconds of sim time spent building
    this._gen = null;
    this._depth = 0;
  }

  get running() { return this.state === 'running'; }
  get total() { return this.slots.length; }

  /** Returns an error string, or null when the build has started. */
  start(key) {
    if (this.running) return 'Already building';
    if (this.physics.held) return 'Release the block first (Space)';
    const def = STRUCTURES[key];
    if (!def) return 'Unknown structure';
    this.key = key;
    this.slots = def.slots.map((s) => ({ ...s, wx: SITE.x + s.x, wz: SITE.z + (s.z || 0) }));
    this.filled = this.slots.map(() => false);
    this.index = 0;
    this.time = 0;
    this.message = '';
    this.phase = 'Getting ready';
    this.state = 'running';
    this._depth = 0;
    this.arm.setMode('cartesian');
    this.arm.precise = true;
    this._gen = this._run();
    return null;
  }

  cancel(message = 'Auto-Build cancelled') {
    if (!this.running) return;
    this._finish('cancelled', message);
  }

  _finish(state, message) {
    this.state = state;
    this.message = message;
    this.phase = '';
    this._gen = null;
    this.arm.precise = false;
  }

  /** Advance one physics step. Call from the fixed-step loop. */
  update() {
    if (!this.running) return;
    this.time += DT;
    try {
      const r = this._gen.next();
      if (r.done) this._finish('done', 'Build complete');
    } catch (e) {
      if (!(e instanceof BuildError)) console.error(e);
      this._finish('failed', e instanceof BuildError ? e.message : `Internal error: ${e.message}`);
    }
    if (this.running && Math.round(this.time / DT) % 30 === 0) this._refreshFilled();
  }

  /* ================== planning queries ================== */

  _blocks() { return this.physics.blocks; }

  // Which block (if any) already sits in each slot? A slot only counts if what it rests on counts.
  _claims(tolXZ = 0.012, tolY = 0.012) {
    const slots = this.slots, used = new Set(), claims = new Array(slots.length).fill(null);
    slots.forEach((s, k) => {
      const bottom = s.y - s.h / 2;
      if (bottom > 0.005) {
        for (let j = 0; j < k; j++) {
          const t = slots[j];
          if (Math.abs(t.y + t.h / 2 - bottom) < 0.004 && Math.abs(t.wx - s.wx) < 0.1 && Math.abs(t.wz - s.wz) < 0.1 && !claims[j]) return;
        }
      }
      let best = null, bd = Infinity;
      for (const b of this._blocks()) {
        if (used.has(b) || !isUpright(b) || Math.abs(heightOf(b) - s.h) > 0.01) continue;
        const p = b.body.position;
        const d = Math.hypot(p.x - s.wx, p.z - s.wz);
        if (d > tolXZ || Math.abs(p.y - s.y) > tolY || b.body.velocity.length() > 0.05) continue;
        if (d < bd) { bd = d; best = b; }
      }
      if (best) { claims[k] = best; used.add(best); }
    });
    return claims;
  }

  // do the slots that slot k rests on all hold a block?
  _supported(k, claims) {
    const slots = this.slots, s = slots[k];
    const bottom = s.y - s.h / 2;
    if (bottom <= 0.005) return true;
    for (let j = 0; j < k; j++) {
      const t = slots[j];
      if (Math.abs(t.y + t.h / 2 - bottom) < 0.004 && Math.abs(t.wx - s.wx) < 0.1 && Math.abs(t.wz - s.wz) < 0.1 && !claims[j]) return false;
    }
    return true;
  }

  _refreshFilled() {
    const c = this._claims();
    this.filled = c.map(Boolean);
    return c;
  }

  _zone() {
    const xs = this.slots.map((s) => s.wx), zs = this.slots.map((s) => s.wz);
    return { x0: Math.min(...xs) - 0.12, x1: Math.max(...xs) + 0.12, z0: Math.min(...zs) - 0.12, z1: Math.max(...zs) + 0.12 };
  }
  _inZone(b) {
    const z = this._zone(), p = b.body.position;
    return p.x > z.x0 && p.x < z.x1 && p.z > z.z0 && p.z < z.z1;
  }

  // Could b still be grasped once the structure is built? (its gripper lanes must miss the structure)
  _pickableLater(b) {
    const p = b.body.position, phi = yawOf(b.body), obs = this._structureObstacles();
    const y = Math.max(p.y, ARM.minTcpY + 0.003);
    return [phi, phi + PI / 2].some((c) => this._laneBlockers(p.x, p.z, c, y, new Set(this._blocks()), obs).length === 0);
  }

  // blocks resting on top of b
  _above(b) {
    const p = b.body.position, top = topOf(b);
    return this._blocks().filter((o) => o !== b && Math.abs(o.body.position.x - p.x) < 0.09 && Math.abs(o.body.position.z - p.z) < 0.09 &&
      botOf(o) > top - 0.02 && o.body.position.y > p.y);
  }

  // Blocks that the open gripper would hit at (x, z) with finger axis class psi and TCP height tcpY.
  _laneBlockers(x, z, psi, tcpY, ignore, extra) {
    const out = [];
    const fl = rect(x - Math.cos(psi) * FINGER_X, z + Math.sin(psi) * FINGER_X, psi, FINGER_HU, FINGER_HV);
    const fr = rect(x + Math.cos(psi) * FINGER_X, z - Math.sin(psi) * FINGER_X, psi, FINGER_HU, FINGER_HV);
    const palm = rect(x, z, psi, PALM_HU, PALM_HV);
    for (const b of this._blocks()) {
      if (ignore && ignore.has(b)) continue;
      const fp = footprint(b);
      const hitF = topOf(b) > tcpY - TIP_BELOW - 0.003 && (rectsHit(fl, fp) || rectsHit(fr, fp));
      const hitP = topOf(b) > tcpY + PALM_ABOVE - 0.003 && rectsHit(palm, fp);
      if (hitF || hitP) out.push(b);
    }
    if (extra) {
      for (const o of extra) {        // obstacles that are not blocks yet (the planned structure)
        const hitF = o.top > tcpY - TIP_BELOW - 0.003 && (rectsHit(fl, o.fp) || rectsHit(fr, o.fp));
        const hitP = o.top > tcpY + PALM_ABOVE - 0.003 && rectsHit(palm, o.fp);
        if (hitF || hitP) out.push(o);
      }
    }
    return out;
  }

  // First finger-axis class (angle mod PI) whose lanes are clear. { psi, blockers } (psi null if none).
  _laneChoice(x, z, tcpY, classes, ignore, extra, movable) {
    let pick = null;
    for (const c of classes) {
      const bl = this._laneBlockers(x, z, c, tcpY, ignore, extra);
      if (!bl.length) return { psi: c, blockers: [] };
      // otherwise remember the class we could clear with the fewest moves (all blockers movable)
      const ok = !movable || bl.every((o) => !o.fp && movable(o));
      if (ok && (!pick || bl.length < pick.length)) pick = bl;
    }
    return { psi: null, blockers: pick || [] };
  }

  // the finished structure, as obstacles, for "could this block still be picked later?"
  _structureObstacles() {
    return this.slots.map((s) => ({ fp: rect(s.wx, s.wz, 0, 0.05, 0.05), top: s.y + s.h / 2 }));
  }

  // World yaw for a finger-axis class at (x, z) that keeps the wrist roll small and continuous.
  _yawFor(x, z, cls) {
    const th = Math.atan2(x, z), cur = this.arm.q[4].t;
    let best = null;
    for (let m = -3; m <= 3; m++) {
      const r = th - cls + m * PI;
      if (Math.abs(r) > 2.6) continue;
      if (best === null || Math.abs(r - cur) < Math.abs(best - cur)) best = r;
    }
    if (best === null) throw new BuildError('Wrist cannot reach that orientation');
    return th - best;
  }

  _maxY(x, z) {
    for (let y = 0.86; y > 0.3; y -= 0.02) if (this.arm.canReach(x, y, z)) return y;
    return 0.3;
  }

  // TCP height that clears everything between two spots (and is reachable all along the way).
  _travelHeight(ax, az, bx, bz, carry, exclude) {
    const r0 = Math.hypot(ax, az), r1 = Math.hypot(bx, bz);
    const t0 = Math.atan2(ax, az), dt = wrap(Math.atan2(bx, bz) - t0);
    const arc = Math.hypot(r1 - r0, 0.5 * (r0 + r1) * dt);
    const n = Math.max(2, Math.ceil(arc / 0.04) + 1);
    let top = 0, cap = 0.86;
    for (let i = 0; i <= n; i++) {
      const f = i / n, r = r0 + (r1 - r0) * f, th = t0 + dt * f;
      const x = r * Math.sin(th), z = r * Math.cos(th);
      cap = Math.min(cap, this._maxY(x, z));
      for (const b of this._blocks()) {
        if (exclude && exclude.has(b)) continue;
        const p = b.body.position;
        if (Math.hypot(p.x - x, p.z - z) < 0.2) top = Math.max(top, topOf(b));
      }
    }
    const need = carry ? top + carry.half + Math.abs(carry.ly) + 0.05 : top + 0.075;
    const want = Math.max(need, 0.3);
    if (want <= cap) return want;
    if (need <= cap) return cap;
    throw new BuildError('Cannot clear the obstacles on that path');
  }

  _parkSpot(b) {
    const zone = this._zone(), p = b.body.position;
    let best = null, bd = Infinity;
    for (let gx = -0.65; gx <= 0.651; gx += 0.05) {
      for (let gz = 0.2; gz <= 0.851; gz += 0.05) {
        const r = Math.hypot(gx, gz);
        if (r < 0.38 || r > 0.8) continue;
        if (gx > zone.x0 - 0.05 && gx < zone.x1 + 0.05 && gz > zone.z0 - 0.05 && gz < zone.z1 + 0.05) continue;
        let ok = true;
        for (const o of this._blocks()) {
          if (o === b) continue;
          const q = o.body.position;
          if (Math.max(Math.abs(q.x - gx), Math.abs(q.z - gz)) < 0.17) { ok = false; break; }
        }
        if (!ok || !this.arm.canReach(gx, 0.05, gz)) continue;
        const d = Math.hypot(gx - p.x, gz - p.z);
        if (d < bd - 1e-9) { bd = d; best = { x: gx, z: gz }; }
      }
    }
    if (!best) throw new BuildError('No free space to move a block aside');
    return best;
  }

  /* ================== motion primitives ================== */

  _setPhase(text) { this.phase = text; }

  *_wait(seconds) {
    const n = Math.ceil(seconds / DT);
    for (let i = 0; i < n; i++) yield;
  }

  *_waitUntil(pred, maxSeconds) {
    const n = Math.ceil(maxSeconds / DT);
    for (let i = 0; i < n; i++) {
      if (pred()) return true;
      yield;
    }
    return pred();
  }

  // Smooth (minimum-jerk) move of the commanded target. Horizontal moves follow an arc around the
  // base (natural for a revolute arm, and it never swings through the base column).
  *_glide(x1, y1, z1, psi1, { vmax = 0.5, minT = 0.3, polar = true } = {}) {
    const t = this.arm.target;
    const x0 = t.pos.x, y0 = t.pos.y, z0 = t.pos.z, psi0 = t.yaw;
    const r0 = Math.hypot(x0, z0), r1 = Math.hypot(x1, z1);
    const th0 = Math.atan2(x0, z0), dth = polar ? wrap(Math.atan2(x1, z1) - th0) : 0;
    const horiz = polar ? Math.hypot(r1 - r0, 0.5 * (r0 + r1) * dth) : Math.hypot(x1 - x0, z1 - z0);
    const dist = Math.hypot(horiz, y1 - y0);
    const T = Math.max(minT, (1.875 * dist) / vmax, (1.875 * Math.abs(psi1 - psi0)) / 2.4);
    const n = Math.ceil(T / DT);
    let fails = 0;
    for (let i = 1; i <= n; i++) {
      const s = minJerk(i / n);
      let x, z;
      if (polar) {
        const r = r0 + (r1 - r0) * s, th = th0 + dth * s;
        x = r * Math.sin(th); z = r * Math.cos(th);
      } else {
        x = x0 + (x1 - x0) * s; z = z0 + (z1 - z0) * s;
      }
      const ok = this.arm.setTargetPose(x, y0 + (y1 - y0) * s, z, psi0 + (psi1 - psi0) * s);
      fails = ok ? 0 : fails + 1;
      if (fails > 6) throw new BuildError('Target out of reach');
      yield;
    }
  }

  // go to a height at the current spot (straight up or down)
  *_vertical(y, vmax = 0.4) {
    const t = this.arm.target;
    if (Math.abs(t.pos.y - y) < 0.002) return;
    yield* this._glide(t.pos.x, y, t.pos.z, t.yaw, { vmax, polar: false, minT: 0.2 });
  }

  // fast down to just above, then slow and gentle for the last few centimetres
  *_descend(y, band = 0.06) {
    const t = this.arm.target;
    if (t.pos.y > y + band + 0.004) yield* this._vertical(y + band, 0.4);
    yield* this._glide(t.pos.x, y, t.pos.z, t.yaw, { vmax: 0.12, polar: false, minT: 0.45 });
  }

  // clear travel to a spot, at a height that clears everything on the way
  *_goAbove(x, z, psi, carry, exclude) {
    const t = this.arm.target;
    const h = this._travelHeight(t.pos.x, t.pos.z, x, z, carry, exclude);
    yield* this._vertical(h, 0.45);
    yield* this._glide(x, h, z, psi, { vmax: 0.55 });
    return h;
  }

  *_openGripper() {
    this.arm.setGripperTarget(OPEN);
    yield* this._waitUntil(() => this.arm.grip.v > OPEN - 0.004, 1.2);
  }

  /* ================== pick / place ================== */

  // Get a lane-clear gripper orientation for a spot, moving (unclaimed) blockers aside if needed.
  *_clearLanes(x, z, tcpY, classes, ignore, claimed) {
    for (let guard = 0; guard < 4; guard++) {
      const lane = this._laneChoice(x, z, tcpY, classes, ignore, null, (o) => !claimed.has(o));
      if (lane.psi !== null) return lane.psi;
      if (lane.blockers.length === 0) throw new BuildError('Gripper cannot fit between the blocks there');
      yield* this._parkBlock(lane.blockers.sort((a, b) => topOf(b) - topOf(a))[0]);
    }
    throw new BuildError('Could not clear space for the gripper');
  }

  *_pickBlock(b) {
    for (let attempt = 0; attempt < 3; attempt++) {
      this._setPhase(attempt ? `Grasping again (${attempt + 1}/3)` : 'Moving above the block');
      yield* this._openGripper();
      const p = b.body.position;
      const pickY = Math.max(p.y, ARM.minTcpY + 0.003);
      const phi = yawOf(b.body);
      const claimed = new Set(this._claims().filter(Boolean));
      const cls = yield* this._clearLanes(p.x, p.z, pickY, [phi, phi + PI / 2], new Set([b]), claimed);
      const psi = this._yawFor(p.x, p.z, cls);

      yield* this._goAbove(p.x, p.z, psi, null, new Set([b]));
      this._setPhase('Descending');
      yield* this._descend(pickY);
      yield* this._wait(0.25);
      this._setPhase('Grasping');
      this.arm.setGripperTarget(0);
      const held = yield* this._waitUntil(() => this.physics.held, 1.2);
      if (held && this.physics.held.block === b) {
        yield* this._wait(0.3);                    // let it settle into the grip
        return;
      }
      // missed (or grabbed the wrong block): let go, back off and try again
      this.arm.setGripperTarget(OPEN);
      yield* this._waitUntil(() => !this.physics.held, 0.8);
      yield* this._wait(0.2);
      yield* this._vertical(this.arm.target.pos.y + 0.08, 0.3);
    }
    throw new BuildError('Could not grasp a block');
  }

  // Carry the held block to (X, Z) and set it down with its centre at yCenter. False if it was lost.
  *_placeAt(b, X, Z, yCenter, classes) {
    if (!this.physics.held || this.physics.held.block !== b) return false;
    const ly = this.physics.held.p1.y;
    const tcpY = Math.max(yCenter + ly + 0.003, ARM.minTcpY + 0.003);
    // (lanes were cleared before picking; we cannot move other blocks while holding this one)
    const lane = this._laneChoice(X, Z, tcpY + 0.03, classes, new Set([b]));
    if (lane.psi === null) throw new BuildError('No room to set the block down');
    const psi = this._yawFor(X, Z, lane.psi);
    const carry = { half: b.half.y, ly };

    this._setPhase('Lifting');
    yield* this._goAbove(X, Z, psi, carry, new Set([b]));
    if (!this.physics.held || this.physics.held.block !== b) return false;
    this._setPhase('Placing');
    yield* this._descend(tcpY);
    yield* this._wait(0.25);
    this.arm.setGripperTarget(OPEN);
    const released = yield* this._waitUntil(() => !this.physics.held, 1.5);
    if (!released) throw new BuildError('Gripper would not let go');
    yield* this._wait(0.3);
    this._setPhase('Backing off');
    const h = this._travelHeight(X, Z, X, Z, null, null);
    yield* this._vertical(h, 0.4);
    this._setPhase('Verifying');
    yield* this._waitSettle(b);
    return true;
  }

  *_waitSettle(b, maxSeconds = 3) {
    let calm = 0;
    const n = Math.ceil(maxSeconds / DT);
    for (let i = 0; i < n; i++) {
      const sp = b.body.velocity.length() + b.body.angularVelocity.length();
      calm = sp < 0.02 || b.body.sleepState === 2 ? calm + 1 : 0;
      if (calm * DT > 0.3) return;
      yield;
    }
  }

  // Move a block that is in the way to a free spot on the table.
  *_parkBlock(b) {
    if (this._depth > 3) throw new BuildError('Blocks are too tightly packed to move aside');
    this._depth++;
    try { yield* this._park(b); } finally { this._depth--; }
  }

  *_park(b) {
    this._setPhase('Moving a block aside');
    for (const o of this._above(b).sort((p, q) => topOf(q) - topOf(p))) yield* this._parkBlock(o);
    const spot = this._parkSpot(b);
    const claimed = new Set(this._claims().filter(Boolean));
    if (claimed.has(b)) throw new BuildError('A finished block is in the way');
    yield* this._pickBlock(b);
    const ok = yield* this._placeAt(b, spot.x, spot.z, b.half.y, [0, PI / 2]);
    if (!ok) { this.arm.setGripperTarget(OPEN); yield* this._wait(0.4); }
    this._setPhase('Moving a block aside');
  }

  /* ================== the build ================== */

  // block that should fill slot s: right height, upright, reachable; uncovered ones first, then nearest
  _pickSource(s, claimed) {
    const t = this.arm.target.pos;
    let best = null, bk = null;
    for (const b of this._blocks()) {
      if (claimed.has(b) || !isUpright(b) || Math.abs(heightOf(b) - s.h) > 0.01) continue;
      const p = b.body.position;
      if (!this.arm.canReach(p.x, Math.max(p.y, ARM.minTcpY + 0.003), p.z)) continue;
      const phi = yawOf(b.body), y = Math.max(p.y, ARM.minTcpY + 0.003);
      const lane = this._laneChoice(p.x, p.z, y, [phi, phi + PI / 2], new Set([b]), null, (o) => !claimed.has(o));
      if (lane.psi === null && lane.blockers.length === 0) continue;     // boxed in by finished blocks
      const near = Math.hypot(p.x - s.wx, p.z - s.wz) < 0.06 && Math.abs(p.y - s.y) < 0.03 ? 0 : 1;
      const key = [near, this._above(b).length ? 1 : 0, Math.hypot(p.x - t.x, p.z - t.z)];
      if (!best || key[0] < bk[0] || (key[0] === bk[0] && (key[1] < bk[1] || (key[1] === bk[1] && key[2] < bk[2] - 1e-9)))) { best = b; bk = key; }
    }
    return best;
  }

  *_buildSlot(k) {
    const s = this.slots[k];
    if (!this.arm.canReach(s.wx, s.y + 0.006, s.wz)) throw new BuildError('The target is out of the arm’s reach');
    for (let attempt = 0; attempt < 3; attempt++) {
      let claims = this._refreshFilled();
      if (claims[k]) return;
      const claimed = new Set(claims.filter(Boolean));
      const b = this._pickSource(s, claimed);
      if (!b) throw new BuildError('Not enough blocks of the right size');

      // make room: whatever sits above the block, and anything in the gripper lanes at the target
      for (const o of this._above(b).sort((p, q) => topOf(q) - topOf(p))) yield* this._parkBlock(o);
      yield* this._clearLanes(s.wx, s.wz, s.y + 0.036, [PI / 2, 0], new Set([b]), claimed);

      this._setPhase('Moving above the block');
      yield* this._pickBlock(b);
      const placed = yield* this._placeAt(b, s.wx, s.wz, s.y, [PI / 2, 0]);
      if (!placed) { this.arm.setGripperTarget(OPEN); yield* this._wait(0.4); continue; }

      claims = this._refreshFilled();
      if (claims[k] === b) return;
      this._setPhase('Adjusting');          // off target: pick it up again and re-place it
    }
    throw new BuildError(`Could not place block ${k + 1} within tolerance`);
  }

  *_run() {
    const n = this.slots.length;
    this._setPhase('Previewing the target');
    yield* this._wait(1.2);                   // give the ghost a moment on screen
    this._setPhase('Getting ready');
    yield* this._openGripper();

    for (let pass = 0; pass < 5; pass++) {
      let claims = this._refreshFilled();
      if (claims.every(Boolean)) break;

      // clear everything that is not part of the structure out of the build zone (top first)
      for (let guard = 0; guard < 14; guard++) {
        claims = this._refreshFilled();
        const claimed = new Set(claims.filter(Boolean));
        const strays = this._blocks().filter((b) => !claimed.has(b) && (this._inZone(b) || !this._pickableLater(b))).sort((a, c) => topOf(c) - topOf(a));
        if (!strays.length) break;
        this.index = 0;
        yield* this._parkBlock(strays[0]);
      }

      for (let k = 0; k < n; k++) {
        const cl = this._refreshFilled();
        if (cl[k]) continue;
        if (!this._supported(k, cl)) break;       // something below was knocked loose: start the pass over
        this.index = k;
        yield* this._buildSlot(k);
      }
    }
    const final = this._refreshFilled();
    if (!final.every(Boolean)) throw new BuildError(`Finished with ${final.filter((x) => !x).length} block(s) off target`);
    this.index = n - 1;
    this._setPhase('Done');
    yield* this._vertical(this._travelHeight(SITE.x, SITE.z, SITE.x, SITE.z, null, null), 0.3);   // back off upwards
  }
}
