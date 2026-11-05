import * as THREE from 'three';
import { ARM } from './config.js';

const SPEED = { move: 0.5, lift: 0.4, yaw: 2.0 };
const FINE = 0.25;
const EASE = 0.09;   // seconds

/** Keyboard handling. Cartesian motion is camera-relative so W always means "away from the viewer". */
export class Input {
  constructor({ arm, camera, actions }) {
    this.arm = arm;
    this.camera = camera;
    this.actions = actions;
    this.keys = new Set();
    this.gripOpen = true;
    this._f = new THREE.Vector3();
    // eased command velocities in [-1, 1]: fwd, side, lift, yaw
    this.v = { fwd: 0, side: 0, lift: 0, yaw: 0 };

    window.addEventListener('keydown', (e) => this._down(e));
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  _down(e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const c = e.code;
    const handled = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyR', 'KeyF', 'KeyQ', 'KeyE', 'Space'];
    if (handled.includes(c)) e.preventDefault();
    if (e.repeat) { this.keys.add(c); return; }
    this.keys.add(c);
    switch (c) {
      case 'Space': this.toggleGripper(); break;
      case 'KeyM': this.actions.toggleMode(); break;
      case 'KeyC': this.actions.record(); break;
      case 'KeyP': this.actions.autopilot(); break;
      case 'KeyT': this.actions.toggleTrail(); break;
      case 'Digit1': this.actions.setPreset('front'); break;
      case 'Digit2': this.actions.setPreset('top'); break;
      case 'Digit3': this.actions.setPreset('hero'); break;
      case 'BracketLeft': this.actions.cycleSpeed(-1); break;
      case 'BracketRight': this.actions.cycleSpeed(1); break;
      case 'KeyK': this.actions.toggleSound(); break;
      case 'Escape': this.actions.cancelBuild(); break;
      case 'KeyH': this.actions.toggleClean(); break;
      case 'KeyO': this.actions.toggleOrbit(); break;
      case 'KeyX': this.actions.reset(); break;
      case 'Slash': this.actions.toggleHint(); break;
      default: break;
    }
  }

  toggleGripper(open = !this.gripOpen) {
    if (this.actions.isLocked()) return;
    this.gripOpen = open;
    this.arm.setGripperTarget(open ? ARM.fingerHalfTravel : 0);
  }

  isDown(code) { return this.keys.has(code); }

  get fine() { return this.keys.has('ShiftLeft') || this.keys.has('ShiftRight'); }

  update(dt) {
    const arm = this.arm;
    if (this.actions.isLocked()) return;
    arm.fine = this.fine;
    if (arm.mode !== 'cartesian') { this.v.fwd = this.v.side = this.v.lift = this.v.yaw = 0; return; }
    const k = this.fine ? FINE : 1;
    let fwd = 0, side = 0, lift = 0, yaw = 0;
    if (this.isDown('KeyW')) fwd += 1;
    if (this.isDown('KeyS')) fwd -= 1;
    if (this.isDown('KeyD')) side += 1;
    if (this.isDown('KeyA')) side -= 1;
    if (this.isDown('KeyR')) lift += 1;
    if (this.isDown('KeyF')) lift -= 1;
    if (this.isDown('KeyE')) yaw += 1;
    if (this.isDown('KeyQ')) yaw -= 1;

    // Ease toward the commanded direction: a soft start and a short glide to a stop.
    const v = this.v;
    const a = 1 - Math.exp(-dt / EASE);
    v.fwd += (fwd - v.fwd) * a;
    v.side += (side - v.side) * a;
    v.lift += (lift - v.lift) * a;
    v.yaw += (yaw - v.yaw) * a;
    fwd = v.fwd; side = v.side; lift = v.lift; yaw = v.yaw;
    if (Math.abs(fwd) + Math.abs(side) + Math.abs(lift) + Math.abs(yaw) < 1e-3) {
      v.fwd = v.side = v.lift = v.yaw = 0;
      return;
    }

    // camera-relative ground axes
    this.camera.getWorldDirection(this._f);
    this._f.y = 0;
    if (this._f.lengthSq() < 1e-6) this._f.set(0, 0, 1);
    this._f.normalize();
    const fx = this._f.x, fz = this._f.z;
    const rx = -fz, rz = fx;
    let mx = fx * fwd + rx * side;
    let mz = fz * fwd + rz * side;
    const len = Math.hypot(mx, mz);
    if (len > 1) { mx /= len; mz /= len; }

    arm.moveTarget(
      mx * SPEED.move * k * dt,
      lift * SPEED.lift * k * dt,
      mz * SPEED.move * k * dt,
      yaw * SPEED.yaw * k * dt
    );
  }
}
