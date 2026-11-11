import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { PALETTE } from './config.js';

const BASE_FOV = 36;

export function createScene(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const bg = new THREE.Color(PALETTE.background);
  scene.background = bg;
  scene.fog = new THREE.Fog(bg, 4.5, 15);

  // Procedural studio environment (no external HDR).
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.55;
  pmrem.dispose();

  // Key light with soft shadows.
  const key = new THREE.DirectionalLight(0xfff4e8, 2.6);
  key.position.set(2.2, 4.2, 1.6);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  const sc = key.shadow.camera;
  sc.left = -1.6; sc.right = 1.6; sc.top = 1.6; sc.bottom = -1.6; sc.near = 1; sc.far = 9;
  key.shadow.bias = -0.0003;
  key.shadow.normalBias = 0.015;
  key.shadow.radius = 4;
  key.target.position.set(0, 0, 0.35);
  scene.add(key, key.target);

  const fill = new THREE.DirectionalLight(0xdde6ff, 0.5);
  fill.position.set(-3, 2, -1.5);
  scene.add(fill);

  // Large matte floor that dissolves into the fog.
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(60, 64),
    new THREE.MeshStandardMaterial({ color: PALETTE.floor, roughness: 0.96, metalness: 0 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  // Soft radial contact-shadow decal texture (shared).
  const blobTex = makeBlobTexture();
  const baseShadow = makeBlob(blobTex, 0.62, 0.38);
  scene.add(baseShadow);

  const camera = new THREE.PerspectiveCamera(BASE_FOV, window.innerWidth / window.innerHeight, 0.05, 60);
  camera.position.set(2.1, 1.35, 1.75);

  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0, 0.28, 0.4);
  controls.enableDamping = true;
  controls.dampingFactor = 0.07;
  controls.enablePan = false;
  controls.minDistance = 1.1;
  controls.maxDistance = 4.2;
  controls.minPolarAngle = 0.05;
  controls.maxPolarAngle = Math.PI / 2 - 0.04;
  controls.autoRotateSpeed = 0.55;
  controls.update();

  function resize() {
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    // Keep the horizontal field of view from collapsing on portrait screens.
    const MIN_ASPECT = 1.3;
    const base = Math.tan(THREE.MathUtils.degToRad(BASE_FOV / 2));
    camera.fov = camera.aspect >= MIN_ASPECT
      ? BASE_FOV
      : Math.min(78, THREE.MathUtils.radToDeg(2 * Math.atan(base * MIN_ASPECT / camera.aspect)));
    applyViewBand();
  }
  // On portrait screens the UI covers the top and bottom: centre the picture in the free band.
  let band = null;
  function applyViewBand() {
    const w = window.innerWidth, h = window.innerHeight;
    if (camera.aspect < 1 && band) camera.setViewOffset(w, h, 0, h / 2 - (band.top + band.bottom) / 2, w, h);
    else camera.clearViewOffset();
    camera.updateProjectionMatrix();
  }
  function setViewBand(top, bottom) { band = top === null ? null : { top, bottom }; applyViewBand(); }
  window.addEventListener('resize', resize);
  resize();

  const rig = new CameraRig(camera, controls);
  return { renderer, scene, camera, controls, blobTex, rig, setViewBand };
}

function makeBlobTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(0,0,0,1)');
  grad.addColorStop(0.45, 'rgba(0,0,0,0.55)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function makeBlob(tex, size, opacity) {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(size, size),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity, depthWrite: false, fog: false })
  );
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.0015;
  m.renderOrder = 1;
  return m;
}

/* ---------- camera presets ---------- */

const PRESETS = {
  front: { pos: [0.0, 0.7, 2.55], target: [0.0, 0.3, 0.35] },
  top: { pos: [0.0, 3.3, 0.78], target: [0.0, 0.0, 0.45] },
  hero: { pos: [2.1, 1.35, 1.75], target: [0.0, 0.28, 0.4] },
};

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));

/** Smoothly moves the camera between presets (orbiting around, never cutting through the floor). */
class CameraRig {
  constructor(camera, controls) {
    this.camera = camera;
    this.controls = controls;
    this.active = 'hero';
    this.onChange = null;            // (name|null) => void
    this.tweening = false;
    this._t = 0;
    this._dur = 1;
    this._fromT = new THREE.Vector3();
    this._toT = new THREE.Vector3();
    this._fromS = new THREE.Spherical();
    this._toS = new THREE.Spherical();
    this._s = new THREE.Spherical();
    this._v = new THREE.Vector3();
    this._rotate = false;
    // any manual orbit/zoom cancels the preset
    controls.addEventListener('start', () => this._interrupt());
  }

  go(name, duration = 0.9) {
    const p = PRESETS[name];
    if (!p) return;
    const c = this.controls;
    if (!this.tweening) this._rotate = c.autoRotate;
    c.autoRotate = false;
    this._fromT.copy(c.target);
    this._fromS.setFromVector3(this._v.copy(this.camera.position).sub(c.target));
    // @ts-expect-error untyped JS (checkJs): array spread / ad-hoc property
    this._toT.set(...p.target);
    // @ts-expect-error untyped JS (checkJs): array spread / ad-hoc property
    this._toS.setFromVector3(this._v.set(...p.pos).sub(this._toT));
    this._t = 0;
    this._dur = duration;
    this.tweening = true;
    this._set(name);
  }

  update(dt) {
    if (!this.tweening) return;
    this._t = Math.min(1, this._t + dt / this._dur);
    const e = ease(this._t);
    const c = this.controls;
    c.target.lerpVectors(this._fromT, this._toT, e);
    const a = this._fromS, b = this._toS, s = this._s;
    s.radius = a.radius + (b.radius - a.radius) * e;
    s.phi = a.phi + (b.phi - a.phi) * e;
    s.theta = a.theta + wrapAngle(b.theta - a.theta) * e;
    this.camera.position.setFromSpherical(s).add(c.target);
    if (this._t >= 1) this._finish();
  }

  _finish() {
    this.tweening = false;
    this.controls.autoRotate = this._rotate;
  }

  _interrupt() {
    if (this.tweening) this._finish();
    this._set(null);
  }

  _set(name) {
    if (this.active === name) return;
    this.active = name;
    if (this.onChange) this.onChange(name);
  }
}
