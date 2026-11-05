import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { createScene, makeBlob } from './scene.js';
import { Arm } from './arm.js';
import { Physics, makeBlockSpecs } from './physics.js';
import { Input } from './input.js';
import { UI } from './ui.js';
import { Sound } from './audio.js';
import { analyzeStacks } from './stacks.js';
import { Challenge } from './challenge.js';
import { AutoBuild } from './autobuild.js';
import { Ghost } from './ghost.js';
import { STRUCTURES, SITE } from './structures.js';
import { Recorder, captureScene, restoreScene, MAX_STEPS } from './recorder.js';
import { PHYS, PALETTE, ARM, REPLAY_SPEEDS } from './config.js';

const canvas = document.getElementById('view');
const { renderer, scene, camera, controls, blobTex, rig, setViewBand } = createScene(canvas);

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
  mesh.material.emissive.setHex(PALETTE.accent);
  mesh.material.emissiveIntensity = 0;
  // thin outline: a slightly larger back-face shell, only visible while highlighted
  const outline = new THREE.Mesh(
    new RoundedBoxGeometry(w + 0.009, h + 0.009, d + 0.009, 3, 0.012),
    new THREE.MeshBasicMaterial({ color: PALETTE.accent, side: THREE.BackSide, transparent: true, opacity: 0, depthWrite: false })
  );
  outline.visible = false;
  mesh.add(outline);
  scene.add(mesh);
  b.mesh = mesh;
  b.outline = outline;
  b.hl = 0;       // eased highlight amount
  b.flash = 0;    // brief extra pulse when gripped
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
ringM.position.y = ticks.position.y = 0.002;
marker.add(ringM, diamond, stem, ticks);
scene.add(marker);

function updateMarker() {
  const p = arm.target.pos;
  marker.visible = arm.mode === 'cartesian';
  marker.position.set(p.x, 0, p.z);
  ticks.rotation.y = arm.target.yaw;
  diamond.position.y = p.y;
  diamond.rotation.y += 0.02;
  stem.scale.y = Math.max(0.001, p.y);
  stem.position.y = p.y / 2;
}

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

// ----- sound, challenge -----
const sound = new Sound();
const challenge = new Challenge(scene);
const build = new AutoBuild(arm, physics);
const buildGhost = new Ghost(scene);
let buildKey = null;
let muted = false;   // true while scrubbing, so fast-forwarded events stay silent
physics.onGrasp = (b) => { b.flash = 1; if (!muted) sound.grip(); };
physics.onRelease = () => { if (!muted) sound.place(); };
rig.onChange = (name) => ui.setPreset(name);

// ----- UI + input -----
const actions = {
  isLocked: () => rec.replaying || build.running,
  setMode(mode) { if (actions.isLocked()) return; arm.setMode(mode); ui.setMode(mode); },
  toggleMode() { actions.setMode(arm.mode === 'cartesian' ? 'joints' : 'cartesian'); },
  setGripper(half) { if (actions.isLocked()) return; arm.setGripperTarget(half); input.gripOpen = half > ARM.fingerHalfTravel * 0.5; },
  toggleClean() { clean = !clean; ui.setClean(clean); },
  toggleOrbit() { controls.autoRotate = !controls.autoRotate; ui.setOrbit(controls.autoRotate); },
  toggleHint() { hintOn = !hintOn; ui.setHint(hintOn); },
  toggleTrail() { trail.visible = !trail.visible; ui.setTrail(trail.visible); },
  setSpeed(v) { rec.speed = v; },
  cycleSpeed(dir) {
    const i = REPLAY_SPEEDS.indexOf(rec.speed);
    rec.speed = REPLAY_SPEEDS[Math.max(0, Math.min(REPLAY_SPEEDS.length - 1, i + dir))];
  },
  toggleSound() { sound.setEnabled(!sound.enabled); ui.setSound(sound.enabled); },
  setPreset(name) { rig.go(name); },

  startChallenge(key) {
    if (rec.recording || rec.replaying) { ui.chalMsg('Stop recording / replay first'); return; }
    if (build.running) { ui.chalMsg('Cancel Auto-Build first (Esc)'); return; }
    actions.clearBuild();
    ui.setShape(key);
    actions.reset();                // fresh blocks, then the clock starts
    challenge.start(key);
    ui.hideSuccess();
    ui.chalMsg('');
    ui.chalCard.set(true);
  },
  cancelChallenge() { challenge.cancel(); ui.hideSuccess(); ui.chalMsg('Build the ghost shape with the blocks.'); },

  // Reset the whole scene (arm and blocks) to the default start.
  reset() {
    build.cancel('Auto-Build stopped by reset');
    if (rec.recording) { rec.discard(); ui.notify('Recording discarded by reset', 'warn'); }
    if (rec.replaying) rec.stopReplay();
    restoreScene(arm, physics, home);
    trailClear();
    syncAfterRestore();
    acc = 0;
    if (challenge.active) { challenge.restart(); ui.hideSuccess(); }   // reset = retry
  },

  record() {
    if (rec.replaying) return;
    if (build.running) { ui.notify('Cancel Auto-Build first (Esc)', 'warn'); return; }
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
    if (build.running) { ui.notify('Cancel Auto-Build first (Esc)', 'warn'); return; }
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

  /* ---- Auto-Build ---- */
  selectStructure(key) {
    if (build.running) return;
    if (!STRUCTURES[key]) { buildKey = null; buildGhost.hide(); return; }
    if (challenge.active) actions.cancelChallenge();
    buildKey = key;
    build.state = 'idle'; build.message = '';
    buildGhost.show(STRUCTURES[key].slots, SITE);       // show the target first
    ui.setBuildKey(key);
  },
  startBuild() {
    if (!buildKey || build.running) return;
    if (rec.replaying) { ui.buildMsg('Stop the replay first'); return; }
    if (challenge.active) actions.cancelChallenge();
    if (!buildGhost.visible) buildGhost.show(STRUCTURES[buildKey].slots, SITE);
    for (let i = 0; i < buildGhost.slots.length; i++) buildGhost.setMatched(i, false);
    const err = build.start(buildKey);
    if (err) { ui.buildMsg(err); return; }
    ui.buildMsg('');
    ui.buildCard.set(true);
  },
  cancelBuild() { if (build.running) build.cancel(); },
  clearBuild() { if (build.running) return; buildGhost.hide(); buildKey = null; build.state = 'idle'; build.message = ''; ui.setBuildKey(''); },

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
  build.cancel();
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
ui.setPreset('hero');
ui.chalMsg('Build the ghost shape with the blocks.');
const input = new Input({ arm, camera, actions });
ui.setHint(true);
// No keyboard on touch devices: start with the slider panel driving the arm.
if (window.matchMedia('(pointer: coarse)').matches) actions.setMode('joints');

if (new URLSearchParams(location.search).has('debug')) window.__app = { structures: STRUCTURES, site: SITE, build, buildGhost, renderer, arm, physics, input, camera, controls, scene, THREE, rec, actions, challenge, sound, rig, analyzeStacks, simStep: () => simStep(), restoreScene, captureScene, home };

// Keep the arm centred in the free area between the panels (matters on portrait screens).
function layoutView() {
  const top = ui.panel.getBoundingClientRect().bottom;
  const bottom = ui.col.getBoundingClientRect().top;
  setViewBand(top, bottom > top ? bottom : window.innerHeight);
}
ui.onLayout = layoutView;
window.addEventListener('resize', layoutView);
layoutView();

// ----- loop -----
const clock = new THREE.Clock();
let acc = 0;

// Ghost of the Auto-Build target: slots turn green as the structure fills in.
function updateBuildGhost() {
  if (!buildGhost.visible) return;
  if (build.state !== 'idle' && build.filled.length === buildGhost.slots.length) {
    build.filled.forEach((f, i) => buildGhost.setMatched(i, f));
  }
  buildGhost.animate(clock.elapsedTime, build.state === 'done');
}

// Highlight what a grab would pick up: soft outline when near, strong when inside the grasp zone,
// a brief bright pulse at the moment of grip.
function updateHighlights(dt) {
  const cand = physics.candidate();
  const held = physics.held ? physics.held.block : null;
  const k = 1 - Math.exp(-dt / 0.08);
  for (const b of physics.blocks) {
    const target = b === held ? 0.5 : cand && cand.block === b ? (cand.ready ? 0.95 : 0.3) : 0;
    b.hl += (target - b.hl) * k;
    b.flash = Math.max(0, b.flash - dt / 0.55);
    const op = Math.min(1, b.hl + b.flash);
    const on = op > 0.01;
    if (b.outline.visible !== on) b.outline.visible = on;
    if (on) {
      b.outline.material.opacity = op;
      b.outline.material.color.setHex(PALETTE.accent).lerp(WHITE, Math.min(1, b.flash));
    }
    b.mesh.material.emissiveIntensity = 0.22 * op;
  }
}
const WHITE = new THREE.Color(1, 1, 1);

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
    build.update();
    if (rec.recording) rec.sample(arm);
    challenge.tick(PHYS.step);
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
    muted = true;
    processSeek();
    muted = false;
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

  rig.update(dt);
  if (challenge.active && !rec.replaying && challenge.evaluate(physics.blocks, physics.held, dt)) {
    ui.showSuccess({ label: challenge.label, time: challenge.time, best: challenge.bestTime, newBest: challenge.newBest });
    sound.success();
  }
  challenge.animate(clock.elapsedTime);
  updateBuildGhost();

  syncVisuals();
  updateHighlights(dt);
  updateMarker();
  ui.update(analyzeStacks(physics.blocks, physics.held), challenge, build);
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
