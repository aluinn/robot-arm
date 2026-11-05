import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { createScene, makeBlob } from './scene.js';
import { Arm } from './arm.js';
import { Physics, makeBlockSpecs } from './physics.js';
import { Input } from './input.js';
import { UI } from './ui.js';
import { Recorder, captureScene, restoreScene, MAX_STEPS } from './recorder.js';
import { PHYS, PALETTE, ARM } from './config.js';

const canvas = document.getElementById('view');
const { renderer, scene, camera, controls, blobTex } = createScene(canvas);

const arm = new Arm();
scene.add(arm.group);

const physics = new Physics(arm, makeBlockSpecs());

// ----- block visuals -----
physics.blocks.forEach((b) => {
  const [w, h, d] = b.spec.size;
  const mesh = new THREE.Mesh(
    new RoundedBoxGeometry(w, h, d, 5, 0.009),
    new THREE.MeshStandardMaterial({ color: b.spec.color, roughness: 0.68, metalness: 0 })
  );
  mesh.castShadow = mesh.receiveShadow = true;
  scene.add(mesh);
  b.mesh = mesh;
  b.blob = makeBlob(blobTex, Math.max(w, d) * 2.1, 0.4);
  scene.add(b.blob);
});

// ----- target marker (Cartesian mode) -----
const marker = new THREE.Group();
const markMat = new THREE.MeshBasicMaterial({ color: PALETTE.accent, transparent: true, opacity: 0.85, depthWrite: false });
const ringM = new THREE.Mesh(new THREE.RingGeometry(0.04, 0.047, 48), markMat);
ringM.rotation.x = -Math.PI / 2;
const diamond = new THREE.Mesh(new THREE.OctahedronGeometry(0.012), markMat);
const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.0012, 0.0012, 1, 6), new THREE.MeshBasicMaterial({ color: PALETTE.accent, transparent: true, opacity: 0.35, depthWrite: false }));
const ticks = new THREE.Group();
for (const s of [-1, 1]) {
  const t = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.0015, 0.004), markMat);
  t.position.x = s * 0.062;
  ticks.add(t);
}
marker.add(ringM, diamond, stem, ticks);
scene.add(marker);

function updateMarker() {
  const p = arm.target.pos;
  marker.visible = arm.mode === 'cartesian' && markerOn;
  marker.position.set(p.x, 0, p.z);
  ringM.position.y = 0.002;
  ticks.position.y = 0.002;
  ticks.rotation.y = arm.target.yaw;
  diamond.position.y = p.y;
  diamond.rotation.y += 0.02;
  stem.scale.y = Math.max(0.001, p.y);
  stem.position.y = p.y / 2;
}
let markerOn = true;

// ----- motion trail (replay) -----
const TRAIL_MAX = 6000;
const trailGeo = new THREE.BufferGeometry();
trailGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TRAIL_MAX * 3), 3));
trailGeo.setDrawRange(0, 0);
const trail = new THREE.Line(trailGeo, new THREE.LineBasicMaterial({ color: PALETTE.accent, transparent: true, opacity: 0.4, depthWrite: false }));
trail.frustumCulled = false;
scene.add(trail);
let trailCount = 0;
const trailClear = () => { trailCount = 0; trailGeo.setDrawRange(0, 0); };
const trailAdd = (v) => {
  if (trailCount >= TRAIL_MAX) return;
  trailGeo.attributes.position.setXYZ(trailCount++, v.x, v.y, v.z);
  trailGeo.attributes.position.needsUpdate = true;
  trailGeo.setDrawRange(0, trailCount);
};
const _tip = new THREE.Vector3();

// ----- recorder -----
const rec = new Recorder();
rec.loadSaved();
const home = captureScene(arm, physics); // the default scene, for "Reset scene"
const fmtMM = (m) => `${(m * 1000).toFixed(3)} mm`;

function syncAfterRestore() {
  input.gripOpen = arm.grip.t > ARM.fingerHalfTravel * 0.5;
  ui.setMode(arm.mode);
}

// ----- UI + input -----
const actions = {
  isLocked: () => rec.replaying,
  setMode(mode) { if (rec.replaying) return; arm.setMode(mode); ui.setMode(mode); },
  toggleMode() { actions.setMode(arm.mode === 'cartesian' ? 'joints' : 'cartesian'); },
  setGripper(half) { if (rec.replaying) return; arm.setGripperTarget(half); input.gripOpen = half > ARM.fingerHalfTravel * 0.5; },
  toggleClean() { clean = !clean; ui.setClean(clean); },
  toggleOrbit() { controls.autoRotate = !controls.autoRotate; ui.setOrbit(controls.autoRotate); },
  toggleHint() { hintOn = !hintOn; ui.setHint(hintOn); },
  toggleTrail() { trail.visible = !trail.visible; ui.setTrail(trail.visible); },
  setSpeed(v) { rec.speed = v; },

  // Reset the whole scene (arm and blocks) to the default start.
  reset() {
    if (rec.recording) { rec.discard(); ui.notify('Recording discarded by reset', 'warn'); }
    if (rec.replaying) rec.stopReplay();
    restoreScene(arm, physics, home);
    trailClear();
    syncAfterRestore();
    acc = 0;
  },

  record() {
    if (rec.replaying) return;
    if (rec.recording) { stopRecording(); return; }
    if (physics.held) { ui.notify('Release the block before recording', 'warn'); return; }
    // Rebuild the world from the snapshot so the live run starts exactly as a replay will.
    const snap = captureScene(arm, physics);
    restoreScene(arm, physics, snap);
    rec.startRecording(snap);
    acc = 0;
    ui.notify('Recording\u2026', '');
  },

  autopilot() {
    if (rec.recording) return;
    if (rec.replaying) { rec.paused = !rec.paused; return; }
    if (!rec.hasData) return;
    startReplay(false);
  },
  stopReplay() { rec.stopReplay(); syncAfterRestore(); },

  seek(step) {
    if (rec.recording || !rec.hasData) return;
    if (!rec.replaying) startReplay(true);
    rec.paused = true;
    rec.seekTarget = Math.max(0, Math.min(rec.totalSteps, step));
  },

  exportJSON() {
    if (!rec.hasData) return;
    const url = URL.createObjectURL(new Blob([rec.toJSON()], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url; a.download = 'robot-arm-recording.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
  importFile(file) {
    if (rec.recording || rec.replaying) { ui.notify('Stop first', 'warn'); return; }
    file.text().then((txt) => {
      const err = rec.importJSON(txt);
      ui.notify(err ? `Import failed: ${err}` : `Imported ${(rec.totalSteps / 120).toFixed(1)} s recording`, err ? 'err' : 'ok');
    }).catch(() => ui.notify('Import failed: could not read file', 'err'));
  },
  clearRecording() {
    if (rec.recording || rec.replaying) return;
    rec.clearSaved();
    trailClear();
    ui.notify('Recording cleared', '');
  },
};

function startReplay(paused) {
  restoreScene(arm, physics, rec.data.snapshot);
  rec.beginReplay(paused);
  trailClear();
  syncAfterRestore();
  acc = 0;
  ui.notify(paused ? '' : 'Replaying\u2026', '');
}

function stopRecording(reason) {
  const ok = rec.stopRecording(captureScene(arm, physics));
  if (!ok) { ui.notify('Nothing recorded', 'warn'); return; }
  const saved = rec.save();
  const len = `${(rec.totalSteps / 120).toFixed(1)} s`;
  if (reason === 'limit') ui.notify(`Reached the 5 minute limit \u00b7 ${len} saved`, 'warn');
  else ui.notify(saved.ok ? `Saved ${len} recording` : `Recorded ${len} \u00b7 not saved: ${saved.reason}`, saved.ok ? 'ok' : 'warn');
}

function finishReplay() {
  rec.endReplay(physics);
  syncAfterRestore();
  const r = rec.result;
  if (r) ui.notify(r.ok ? `Replay verified \u00b7 drift ${fmtMM(r.drift)}` : `Replay diverged by ${fmtMM(r.drift)}`, r.ok ? 'ok' : 'err');
}

let clean = false, hintOn = true;
const ui = new UI({ root: document.getElementById('ui'), arm, rec, actions });
ui.setTrail(true);
const input = new Input({ arm, camera, actions });
ui.setHint(true);
// No keyboard on touch devices: start with the slider panel driving the arm.
if (window.matchMedia('(pointer: coarse)').matches) actions.setMode('joints');

if (new URLSearchParams(location.search).has('debug')) window.__app = { arm, physics, input, camera, controls, scene, THREE, rec, actions, simStep: () => simStep(), restoreScene, captureScene, home };

// ----- loop -----
const clock = new THREE.Clock();
let acc = 0;

function syncVisuals() {
  for (const b of physics.blocks) {
    const p = b.body.position, q = b.body.quaternion;
    b.mesh.position.set(p.x, p.y, p.z);
    b.mesh.quaternion.set(q.x, q.y, q.z, q.w);
    const [w, h, d] = b.spec.size;
    const clearance = Math.max(0, p.y - h / 2);
    b.blob.position.x = p.x;
    b.blob.position.z = p.z;
    b.blob.rotation.z = -Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.x * q.x));
    b.blob.material.opacity = 0.42 * Math.exp(-clearance * 7);
  }
}

// One fixed simulation step. The order is the same for live play, recording and replay:
// commands -> arm -> physics.
function simStep() {
  if (rec.replaying) {
    rec.applyReplay(arm);
  } else {
    input.update(PHYS.step);
    if (rec.recording) rec.sample(arm);
  }
  arm.step(PHYS.step);
  physics.step(PHYS.step);

  if (rec.recording) {
    rec.step++;
    if (rec.step >= MAX_STEPS) stopRecording('limit');
  } else if (rec.replaying) {
    rec.step++;
    if (rec.step % 2 === 0) trailAdd(arm.tcpNode.getWorldPosition(_tip));
    if (rec.replayDone) finishReplay();
  }
}

// Scrubbing: rewind to the snapshot if needed, then fast-forward with the same steps.
function processSeek() {
  if (rec.seekTarget < rec.step) {
    restoreScene(arm, physics, rec.data.snapshot);
    rec.beginReplay(true);
    trailClear();
    syncAfterRestore();
  }
  const t0 = performance.now();
  while (rec.replaying && rec.step < rec.seekTarget && performance.now() - t0 < 10) simStep();
  if (rec.replaying && rec.step >= rec.seekTarget) rec.seekTarget = null;
}

function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  if (rec.replaying && rec.seekTarget !== null) {
    processSeek();
  } else if (!(rec.replaying && rec.paused)) {
    // Replay speed only changes how many identical fixed steps run per frame.
    const speed = rec.replaying ? rec.speed : 1;
    acc += dt * speed;
    const maxSteps = Math.ceil(PHYS.maxSteps * speed);
    let n = 0;
    while (acc >= PHYS.step && n < maxSteps) {
      const wasReplaying = rec.replaying;
      simStep();
      acc -= PHYS.step;
      n++;
      if (wasReplaying && !rec.replaying) { acc = 0; break; }
    }
    if (n === maxSteps) acc = 0;
  }

  syncVisuals();
  updateMarker();
  ui.update();
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
