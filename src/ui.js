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
  constructor({ root, arm, rec, actions }) {
    this.root = root;
    this.rec = rec;
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
    this.btnHint.classList.add('keys');
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
        <div><kbd>X</kbd><span>Reset scene</span></div>
        <div><kbd>H</kbd><span>Clean mode</span></div>
      </div>
      <div class="hcol">
        <div><kbd>C</kbd><span>Record / stop</span></div>
        <div><kbd>P</kbd><span>Autopilot / pause</span></div>
        <div><kbd>1</kbd><kbd>2</kbd><kbd>3</kbd><kbd>4</kbd><span>Speed</span></div>
      </div>`;
    root.append(hint);
    this.hint = hint;

    this._buildRecorder(root, actions);
    this.setMode('cartesian');
  }

  _buildRecorder(root, actions) {
    const box = el('section', 'glass rec');
    const head = el('div', 'rec-head');
    this.stateEl = el('span', 'state idle', '<i></i><b>Idle</b>');
    this.timeEl = el('span', 'time', '0:00');
    head.append(this.stateEl, this.timeEl);

    const btns = el('div', 'rec-btns');
    const mk = (cls, html, fn) => {
      const b = el('button', cls, html);
      b.onclick = () => { fn(); b.blur(); };
      btns.append(b);
      return b;
    };
    this.btnRec = mk('rb rb-rec', '<i></i>Record <kbd>C</kbd>', actions.record);
    this.btnAuto = mk('rb', 'Autopilot <kbd>P</kbd>', () => (this.rec.replaying ? actions.stopReplay() : actions.autopilot()));
    this.btnReset = mk('rb', 'Reset scene <kbd>X</kbd>', actions.reset);

    const scrub = el('div', 'scrub');
    this.btnPause = el('button', 'pp', 'Pause');
    this.btnPause.onclick = () => { actions.autopilot(); this.btnPause.blur(); };
    this.scrub = el('input');
    this.scrub.type = 'range'; this.scrub.min = 0; this.scrub.max = 1; this.scrub.step = 1; this.scrub.value = 0;
    this.scrub.oninput = () => actions.seek(parseInt(this.scrub.value, 10));
    this.scrub.onpointerdown = () => { this.scrubbing = true; };
    const endScrub = () => { this.scrubbing = false; this.scrub.blur(); };
    this.scrub.onpointerup = endScrub;
    this.scrub.onpointercancel = endScrub;
    scrub.append(this.btnPause, this.scrub);

    const opts = el('div', 'rec-opts');
    this.speedSeg = el('div', 'seg speed');
    this.speedBtns = [0.5, 1, 2, 4].map((v) => {
      const b = el('button', '', `${v}\u00d7`);
      b.onclick = () => { actions.setSpeed(v); b.blur(); };
      this.speedSeg.append(b);
      return { v, b };
    });
    this.btnTrail = el('button', 'tool', 'Trail <kbd>T</kbd>');
    this.btnTrail.onclick = () => { actions.toggleTrail(); this.btnTrail.blur(); };
    opts.append(this.speedSeg, this.btnTrail);

    const io = el('div', 'rec-io');
    const small = (label, fn) => { const b = el('button', 'tool', label); b.onclick = () => { fn(); b.blur(); }; io.append(b); return b; };
    this.btnExport = small('Export', actions.exportJSON);
    const file = el('input');
    file.type = 'file'; file.accept = 'application/json,.json'; file.hidden = true;
    file.onchange = () => { if (file.files[0]) actions.importFile(file.files[0]); file.value = ''; };
    small('Import', () => file.click());
    this.btnClear = small('Clear', actions.clearRecording);
    this.note = el('div', 'note');

    box.append(head, btns, scrub, opts, io, this.note, file);
    root.append(box);
    this.recBox = box;
  }

  notify(text, kind = '') {
    this.note.textContent = text;
    this.note.className = 'note ' + kind;
  }

  _fmt(steps) {
    const t = steps / 120;
    return `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
  }

  _updateRecorder() {
    const r = this.rec;
    const rec = r.recording, rep = r.replaying;
    const label = rec ? 'Recording' : rep ? (r.paused ? 'Paused' : 'Replaying') : 'Idle';
    this.stateEl.className = 'state ' + (rec ? 'rec' : rep ? 'play' : 'idle');
    this.stateEl.lastChild.textContent = label;
    const total = rec ? r.step : r.totalSteps;
    this.timeEl.textContent = `${this._fmt(r.step)} / ${this._fmt(total)}`;

    this.btnRec.classList.toggle('on', rec);
    this.btnRec.firstChild.nextSibling.textContent = rec ? 'Stop ' : 'Record ';
    this.btnRec.disabled = rep;
    this.btnAuto.disabled = rec || !r.hasData;
    this.btnAuto.firstChild.textContent = rep ? 'Stop ' : 'Autopilot ';
    this.btnReset.disabled = false;

    this.btnPause.style.visibility = rep ? 'visible' : 'hidden';
    this.btnPause.textContent = r.paused ? 'Play' : 'Pause';

    this.scrub.disabled = rec || !r.hasData;
    this.scrub.max = Math.max(1, total);
    if (!this.scrubbing) this.scrub.value = r.step;
    this.scrub.style.setProperty('--p', `${(100 * r.step / Math.max(1, total)).toFixed(1)}%`);

    this.speedBtns.forEach(({ v, b }) => b.classList.toggle('on', v === r.speed));
    this.btnExport.disabled = !r.hasData;
    this.btnClear.disabled = !r.hasData || rec || rep;
    this.recBox.classList.toggle('locked-rep', rep);
    this.panel.classList.toggle('locked', rep);
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

  setTrail(on) { this.btnTrail.classList.toggle('active', on); }
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
    this._updateRecorder();
    const f = arm.forward();
    this.tcp.innerHTML =
      `<span>X <b>${(f.pos.x * 1000).toFixed(0)}</b></span>` +
      `<span>Y <b>${(f.pos.z * 1000).toFixed(0)}</b></span>` +
      `<span>Z <b>${(f.pos.y * 1000).toFixed(0)}</b></span><i>mm</i>`;
  }
}
