import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { createScene, makeBlob } from './scene.js';
import { Arm } from './arm.js';
import { Physics, makeBlockSpecs } from './physics.js';
import { Input } from './input.js';
import { UI } from './ui.js';
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

// ----- UI + input -----
const actions = {
  setMode(mode) { arm.setMode(mode); ui.setMode(mode); },
  toggleMode() { actions.setMode(arm.mode === 'cartesian' ? 'joints' : 'cartesian'); },
  setGripper(half) { arm.setGripperTarget(half); input.gripOpen = half > ARM.fingerHalfTravel * 0.5; },
  toggleClean() { clean = !clean; ui.setClean(clean); },
  toggleOrbit() { controls.autoRotate = !controls.autoRotate; ui.setOrbit(controls.autoRotate); },
  toggleHint() { hintOn = !hintOn; ui.setHint(hintOn); },
  reset() { physics.reset(); },
};
let clean = false, hintOn = true;
const ui = new UI({ root: document.getElementById('ui'), arm, actions });
const input = new Input({ arm, camera, actions });
ui.setHint(true);
// No keyboard on touch devices: start with the slider panel driving the arm.
if (window.matchMedia('(pointer: coarse)').matches) actions.setMode('joints');

if (new URLSearchParams(location.search).has('debug')) window.__app = { arm, physics, input, camera, controls, scene, THREE };

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

function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  acc += dt;
  let n = 0;
  while (acc >= PHYS.step && n < PHYS.maxSteps) {
    input.update(PHYS.step);
    arm.step(PHYS.step);
    physics.step(PHYS.step);
    acc -= PHYS.step;
    n++;
  }
  if (n === PHYS.maxSteps) acc = 0;

  syncVisuals();
  updateMarker();
  ui.update();
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
