import { ARM, JOINTS } from './config.js';

const DEG = 180 / Math.PI;
const GRIP_MAX_MM = ARM.fingerHalfTravel * 2000;

const el = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
};

export class UI {
  constructor({ root, arm, actions }) {
    this.root = root;
    this.arm = arm;
    this.actions = actions;
    this.rows = [];
    this.dragging = -1;

    // ----- main panel -----
    const panel = el('section', 'glass panel');
    this.seg = el('div', 'seg');
    this.btnCart = el('button', 'on', 'Cartesian');
    this.btnJoint = el('button', '', 'Joints');
    this.btnCart.onclick = () => actions.setMode('cartesian');
    this.btnJoint.onclick = () => actions.setMode('joints');
    this.seg.append(this.btnCart, this.btnJoint);
    panel.append(this.seg);

    this.sliders = el('div', 'sliders');
    JOINTS.forEach((j, i) => this._addRow(j.label, j.min * DEG, j.max * DEG, 0.1, (v) => arm.setJointTarget(i, v / DEG), i));
    this._addRow('Gripper', 0, GRIP_MAX_MM, 0.5, (v) => { actions.setGripper(v / 2000); }, JOINTS.length, true);
    panel.append(this.sliders);

    this.tcp = el('div', 'tcp');
    panel.append(this.tcp);
    root.append(panel);
    this.panel = panel;

    // ----- toolbar -----
    const bar = el('div', 'glass bar');
    this.btnOrbit = this._tool(bar, 'Orbit', 'O', actions.toggleOrbit);
    this._tool(bar, 'Reset', 'X', actions.reset);
    this.btnHint = this._tool(bar, 'Keys', '/', actions.toggleHint);
    this._tool(bar, 'Clean', 'H', actions.toggleClean);
    root.append(bar);
    this.bar = bar;

    // ----- hint -----
    const hint = el('aside', 'glass hint');
    hint.innerHTML = `
      <div class="hcol" data-mode="cartesian">
        <div><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd><span>Move on table</span></div>
        <div><kbd>R</kbd><kbd>F</kbd><span>Raise / lower</span></div>
        <div><kbd>Q</kbd><kbd>E</kbd><span>Rotate wrist</span></div>
      </div>
      <div class="hcol">
        <div><kbd>Space</kbd><span>Open / close gripper</span></div>
        <div><kbd>Shift</kbd><span>Fine motion</span></div>
        <div><kbd>M</kbd><span>Cartesian / Joints</span></div>
      </div>
      <div class="hcol">
        <div><kbd>O</kbd><span>Auto-orbit</span></div>
        <div><kbd>X</kbd><span>Reset blocks</span></div>
        <div><kbd>H</kbd><span>Clean mode</span></div>
      </div>`;
    root.append(hint);
    this.hint = hint;

    this.setMode('cartesian');
  }

  _tool(parent, label, key, fn) {
    const b = el('button', 'tool', `${label}<kbd>${key}</kbd>`);
    b.onclick = () => { fn(); b.blur(); };
    parent.append(b);
    return b;
  }

  _addRow(label, min, max, step, onInput, i, isGrip = false) {
    const row = el('div', 'row');
    const name = el('span', 'name', label);
    const val = el('span', 'val', '0');
    const input = el('input');
    input.type = 'range';
    input.min = min; input.max = max; input.step = step;
    input.oninput = () => onInput(parseFloat(input.value));
    input.onpointerdown = () => { this.dragging = i; };
    const end = () => { this.dragging = -1; input.blur(); };
    input.onpointerup = end;
    input.onpointercancel = end;
    row.append(name, val, input);
    this.sliders.append(row);
    this.rows.push({ input, val, isGrip, min, max });
  }

  setMode(mode) {
    const joints = mode === 'joints';
    this.btnCart.classList.toggle('on', !joints);
    this.btnJoint.classList.toggle('on', joints);
    this.panel.classList.toggle('live', joints);
    this.hint.classList.toggle('joints', joints);
  }

  setOrbit(on) { this.btnOrbit.classList.toggle('active', on); }
  setHint(visible) { this.hint.classList.toggle('hidden', !visible); this.btnHint.classList.toggle('active', visible); }
  setClean(clean) { this.root.classList.toggle('clean', clean); }

  update() {
    const arm = this.arm;
    const joints = arm.mode === 'joints';
    this.rows.forEach((r, i) => {
      const isGrip = r.isGrip;
      const cur = isGrip ? arm.grip.v * 2000 : arm.q[i].v * DEG;
      const tgt = isGrip ? arm.grip.t * 2000 : arm.q[i].t * DEG;
      r.val.textContent = isGrip ? `${cur.toFixed(0)} mm` : `${cur.toFixed(1)}°`;
      if (this.dragging !== i) r.input.value = joints ? tgt : cur;
      const p = (parseFloat(r.input.value) - r.min) / (r.max - r.min);
      r.input.style.setProperty('--p', `${(p * 100).toFixed(1)}%`);
    });
    const f = arm.forward();
    this.tcp.innerHTML =
      `<span>X <b>${(f.pos.x * 1000).toFixed(0)}</b></span>` +
      `<span>Y <b>${(f.pos.z * 1000).toFixed(0)}</b></span>` +
      `<span>Z <b>${(f.pos.y * 1000).toFixed(0)}</b></span><i>mm</i>`;
  }
}
