import { ARM, JOINTS, REPLAY_SPEEDS as SPEEDS } from './config.js';
import { SHAPES } from './challenge.js';
import { STRUCTURES } from './structures.js';

const DEG = 180 / Math.PI;
const GRIP_MAX_MM = ARM.fingerHalfTravel * 2000;
const MAX_TOWER = 0.68;          // metres: all six blocks stacked, for the meter scale

const el = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
};
// Only touch the DOM when a value actually changed (this runs every frame).
const setText = (e, t) => { if (e._t !== t) { e._t = t; e.textContent = t; } };
const setClass = (e, c, on) => { if (e._c !== undefined && e._c[c] === on) return; (e._c || (e._c = {}))[c] = on; e.classList.toggle(c, on); };
const fmtClock = (steps) => {
  const t = steps / 120;
  return `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
};
const fmtTime = (s) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;

export class UI {
  constructor({ root, arm, rec, actions }) {
    this.root = root;
    this.arm = arm;
    this.rec = rec;
    this.actions = actions;
    this.rows = [];
    this.dragging = -1;
    this.shape = 'tower';
    this.cards = [];

    this._buildPanel();
    const col = el('div', 'col');
    root.append(col);
    this.col = col;
    this._buildToolbar(col);
    this._buildCameraSeg(col);
    this._buildRecorder(col);
    this._buildChallenge(col);
    this._buildAutoBuild(col);
    this._buildHint();
    this._buildSuccess();

    // Start with the cards that fit: everything folded on phones, the challenge folded on short screens.
    const phone = window.matchMedia('(max-width: 760px)').matches;
    const tall = window.innerHeight >= 900;
    this.recCard.set(!phone && window.innerHeight >= 520);
    this.chalCard.set(!phone && tall);
    this.buildCard.set(!phone && tall);
    this.setMode('cartesian');
  }

  /* ---------- main panel ---------- */

  _buildPanel() {
    const { actions, arm } = this;
    const panel = el('section', 'glass panel');
    const seg = el('div', 'seg');
    this.btnCart = el('button', 'on', 'Cartesian');
    this.btnJoint = el('button', '', 'Joints');
    this.btnCart.onclick = () => actions.setMode('cartesian');
    this.btnJoint.onclick = () => actions.setMode('joints');
    seg.append(this.btnCart, this.btnJoint);
    panel.append(seg);

    this.sliders = el('div', 'sliders');
    JOINTS.forEach((j, i) => this._addRow(j.label, j.min * DEG, j.max * DEG, 0.1, (v) => arm.setJointTarget(i, v / DEG), i));
    this._addRow('Gripper', 0, GRIP_MAX_MM, 0.5, (v) => actions.setGripper(v / 2000), JOINTS.length, true);
    panel.append(this.sliders);

    this.tcp = el('div', 'tcp', '<span>X <b></b></span><span>Y <b></b></span><span>Z <b></b></span><i>mm</i>');
    this.tcpVals = [...this.tcp.querySelectorAll('b')];
    panel.append(this.tcp);

    // tower height meter + stacked counter
    this.stats = el('div', 'stats', `
      <div class="stat"><span>Tower</span><b class="th">0 mm</b></div>
      <div class="stat"><span>Blocks stacked</span><b class="sk">0</b></div>
      <div class="meter"><i></i></div>`);
    this.thEl = this.stats.querySelector('.th');
    this.skEl = this.stats.querySelector('.sk');
    this.meterEl = this.stats.querySelector('.meter i');
    panel.append(this.stats);

    this.root.append(panel);
    this.panel = panel;
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

  /* ---------- right column ---------- */

  _tool(parent, label, key, fn, cls = '') {
    const b = el('button', 'tool ' + cls, `${label}<kbd>${key}</kbd>`);
    b.onclick = () => { fn(); b.blur(); };
    parent.append(b);
    return b;
  }

  _buildToolbar(col) {
    const { actions } = this;
    const bar = el('div', 'glass bar');
    this.btnOrbit = this._tool(bar, 'Orbit', 'O', actions.toggleOrbit);
    this._tool(bar, 'Reset', 'X', actions.reset);
    this.btnSound = this._tool(bar, 'Sound', 'K', actions.toggleSound);
    this._tool(bar, 'Keys', '/', actions.toggleHint, 'keys');
    this._tool(bar, 'Clean', 'H', actions.toggleClean);
    col.append(bar);
    this.btnHint = bar.querySelector('.keys');
  }

  _buildCameraSeg(col) {
    const seg = el('div', 'glass seg cams');
    this.presetBtns = [['front', 'Front', 1], ['top', 'Top', 2], ['hero', 'Hero', 3]].map(([name, label, k]) => {
      const b = el('button', '', `${label}<kbd>${k}</kbd>`);
      b.onclick = () => { this.actions.setPreset(name); b.blur(); };
      seg.append(b);
      return { name, b };
    });
    col.append(seg);
  }

  /** Collapsible card. On phones only one card stays open so they never stack up. */
  _card(cls, title) {
    const root = el('section', 'glass card ' + cls);
    const head = el('button', 'card-head', '<span class="ct"></span><span class="cs"></span><i class="chev"></i>');
    head.querySelector('.ct').textContent = title;
    const body = el('div', 'card-body');
    root.append(head, body);
    const card = {
      root, body, summary: head.querySelector('.cs'),
      set: (open) => { root.classList.toggle('collapsed', !open); card.open = open; this._syncCardsOpen(); },
      open: true,
    };
    head.onclick = () => {
      const open = !card.open;
      if (open && window.matchMedia('(max-width: 760px)').matches) this.cards.forEach((c) => c !== card && c.set(false));
      card.set(open);
      head.blur();
    };
    this.cards.push(card);
    return card;
  }

  _syncCardsOpen() {
    this.root.classList.toggle('card-open', this.cards.some((c) => c.open));
    // @ts-expect-error untyped JS (checkJs): array spread / ad-hoc property
    if (this.onLayout) this.onLayout();
  }

  _buildRecorder(col) {
    const { actions } = this;
    const card = this.recCard = this._card('rec', 'Recorder');
    const body = card.body;

    this.stateEl = el('div', 'state idle', '<i></i><b>Idle</b><span class="time">0:00 / 0:00</span>');
    this.stateLbl = this.stateEl.querySelector('b');
    this.timeEl = this.stateEl.querySelector('.time');

    const btns = el('div', 'rec-btns');
    const mk = (cls, label, key, fn) => {
      const b = el('button', cls, `<i></i><span class="lbl">${label}</span><kbd>${key}</kbd>`);
      b.onclick = () => { fn(); b.blur(); };
      btns.append(b);
      return b;
    };
    this.btnRec = mk('rb rb-rec', 'Record', 'C', actions.record);
    this.btnAuto = mk('rb', 'Autopilot', 'P', () => (this.rec.replaying ? actions.stopReplay() : actions.autopilot()));
    this.btnReset = mk('rb', 'Reset scene', 'X', actions.reset);
    this.lblRec = this.btnRec.querySelector('.lbl');
    this.lblAuto = this.btnAuto.querySelector('.lbl');

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
    const speed = el('div', 'seg speed');
    this.speedBtns = SPEEDS.map((v) => {
      const b = el('button', '', `${v}×`);
      b.onclick = () => { actions.setSpeed(v); b.blur(); };
      speed.append(b);
      return { v, b };
    });
    this.btnTrail = this._tool(opts, 'Trail', 'T', actions.toggleTrail);
    opts.prepend(speed);

    const io = el('div', 'rec-io');
    const small = (label, fn) => { const b = el('button', 'tool', label); b.onclick = () => { fn(); b.blur(); }; io.append(b); return b; };
    this.btnExport = small('Export', actions.exportJSON);
    const file = el('input');
    file.type = 'file'; file.accept = 'application/json,.json'; file.hidden = true;
    file.onchange = () => { if (file.files[0]) actions.importFile(file.files[0]); file.value = ''; };
    small('Import', () => file.click());
    this.btnClear = small('Clear', actions.clearRecording);
    this.note = el('div', 'note');

    body.append(this.stateEl, btns, scrub, opts, io, this.note, file);
    col.append(card.root);
  }

  _buildChallenge(col) {
    const { actions } = this;
    const card = this.chalCard = this._card('chal', 'Challenge');
    const body = card.body;

    const pick = el('div', 'seg shapes');
    this.shapeBtns = Object.entries(SHAPES).map(([key, s]) => {
      const b = el('button', key === this.shape ? 'on' : '', s.label);
      b.onclick = () => { this.shape = key; this.shapeBtns.forEach((x) => x.b.classList.toggle('on', x.key === key)); b.blur(); };
      pick.append(b);
      return { key, b };
    });

    const btns = el('div', 'chal-btns');
    this.btnStart = el('button', 'rb', 'Start');
    this.btnStart.onclick = () => { actions.startChallenge(this.shape); this.btnStart.blur(); };
    this.btnStop = el('button', 'rb', 'Cancel');
    this.btnStop.onclick = () => { actions.cancelChallenge(); this.btnStop.blur(); };
    btns.append(this.btnStart, this.btnStop);

    this.chalStats = el('div', 'chal-stats', `
      <div><span>Time</span><b class="ct1">0:00.0</b></div>
      <div><span>Matched</span><b class="cm">–</b></div>
      <div><span>Best</span><b class="cb">–</b></div>`);
    this.ctEl = this.chalStats.querySelector('.ct1');
    this.cmEl = this.chalStats.querySelector('.cm');
    this.cbEl = this.chalStats.querySelector('.cb');
    this.chalNote = el('div', 'note', 'Build the ghost shape with the blocks.');

    body.append(pick, btns, this.chalStats, this.chalNote);
    col.append(card.root);
  }

  _buildAutoBuild(col) {
    const { actions } = this;
    const card = this.buildCard = this._card('build', 'Auto-Build');
    const body = card.body;

    this.buildSel = el('select', 'sel');
    this.buildSel.innerHTML = '<option value="">Choose a structure\u2026</option>' +
      Object.entries(STRUCTURES).map(([k, s]) => `<option value="${k}">${s.label}</option>`).join('');
    this.buildSel.onchange = () => { actions.selectStructure(this.buildSel.value); this.buildSel.blur(); };

    const btns = el('div', 'chal-btns');
    this.btnBuild = el('button', 'rb rb-go', 'Auto-Build');
    this.btnBuild.onclick = () => { actions.startBuild(); this.btnBuild.blur(); };
    this.btnBuildStop = el('button', 'rb', 'Cancel <kbd class="esc">Esc</kbd>');
    this.btnBuildStop.onclick = () => { actions.cancelBuild(); this.btnBuildStop.blur(); };
    btns.append(this.btnBuild, this.btnBuildStop);

    this.buildProg = el('div', 'bprog', '<i></i>');
    this.buildBar = this.buildProg.firstChild;
    this.buildLine = el('div', 'bline', '<b></b><span></span>');
    this.buildTitle = this.buildLine.querySelector('b');
    this.buildPhase = this.buildLine.querySelector('span');
    this.buildNote = el('div', 'note');

    body.append(this.buildSel, btns, this.buildProg, this.buildLine, this.buildNote);
    col.append(card.root);
  }

  _buildHint() {
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
        <div><kbd>1</kbd><kbd>2</kbd><kbd>3</kbd><span>Camera presets</span></div>
        <div><kbd>O</kbd><span>Auto-orbit</span></div>
        <div><kbd>K</kbd><span>Sound</span></div>
      </div>
      <div class="hcol">
        <div><kbd>C</kbd><span>Record / stop</span></div>
        <div><kbd>P</kbd><span>Autopilot / pause</span></div>
        <div><kbd>[</kbd><kbd>]</kbd><span>Replay speed</span></div>
      </div>
      <div class="hcol">
        <div><kbd>X</kbd><span>Reset scene</span></div>
        <div><kbd>T</kbd><span>Replay trail</span></div>
        <div><kbd>H</kbd><span>Clean mode</span></div>
        <div><kbd>Esc</kbd><span>Cancel Auto-Build</span></div>
      </div>`;
    this.root.append(hint);
    this.hint = hint;
  }

  _buildSuccess() {
    const box = el('div', 'success hidden');
    box.innerHTML = `
      <div class="glass sc">
        <div class="check"><svg viewBox="0 0 24 24" width="26" height="26"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
        <h2>Challenge complete</h2>
        <div class="stime"></div>
        <div class="ssub"></div>
        <div class="sbtns"><button class="rb again">Again</button><button class="rb close">Done</button></div>
      </div>`;
    box.querySelector('.again').onclick = () => this.actions.startChallenge(this.shape);
    box.querySelector('.close').onclick = () => this.actions.cancelChallenge();
    this.root.append(box);
    this.success = box;
  }

  /* ---------- state setters ---------- */

  setMode(mode) {
    const joints = mode === 'joints';
    this.btnCart.classList.toggle('on', !joints);
    this.btnJoint.classList.toggle('on', joints);
    this.panel.classList.toggle('live', joints);
    this.hint.classList.toggle('joints', joints);
  }

  setOrbit(on) { this.btnOrbit.classList.toggle('active', on); }
  setTrail(on) { this.btnTrail.classList.toggle('active', on); }
  setSound(on) { this.btnSound.classList.toggle('active', on); }
  setHint(visible) { this.hint.classList.toggle('hidden', !visible); this.btnHint.classList.toggle('active', visible); }
  setClean(clean) { this.root.classList.toggle('clean', clean); }
  setPreset(name) { this.presetBtns.forEach(({ name: n, b }) => b.classList.toggle('on', n === name)); }

  notify(text, kind = '') {
    this.note.textContent = text;
    this.note.className = 'note ' + kind;
  }

  setShape(key) { this.shape = key; this.shapeBtns.forEach((x) => x.b.classList.toggle('on', x.key === key)); }

  setBuildKey(key) { this.buildSel.value = key || ''; }
  buildMsg(text) { this.buildNote.textContent = text; this.buildNote.className = 'note warn'; }

  chalMsg(text) { this.chalNote.textContent = text; }

  showSuccess({ label, time, best, newBest }) {
    const s = this.success;
    s.querySelector('.stime').textContent = fmtTime(time);
    s.querySelector('.ssub').textContent = newBest ? `${label} · new best` : `${label} · best ${fmtTime(best)}`;
    s.classList.remove('hidden');
  }
  hideSuccess() { this.success.classList.add('hidden'); }

  /* ---------- per frame ---------- */

  update(stack, chal, build) {
    const arm = this.arm, joints = arm.mode === 'joints';

    this.rows.forEach((r, i) => {
      const cur = r.isGrip ? arm.grip.v * 2000 : arm.q[i].v * DEG;
      const tgt = r.isGrip ? arm.grip.t * 2000 : arm.q[i].t * DEG;
      setText(r.val, r.isGrip ? `${cur.toFixed(0)} mm` : `${cur.toFixed(1)}°`);
      if (this.dragging !== i) {
        const v = joints ? tgt : cur;
        if (r.last !== v) { r.last = v; r.input.value = v; r.input.style.setProperty('--p', `${(100 * (v - r.min) / (r.max - r.min)).toFixed(1)}%`); }
      }
    });

    const f = arm.forward();
    setText(this.tcpVals[0], (f.pos.x * 1000).toFixed(0));
    setText(this.tcpVals[1], (f.pos.z * 1000).toFixed(0));
    setText(this.tcpVals[2], (f.pos.y * 1000).toFixed(0));

    setText(this.thEl, `${(stack.height * 1000).toFixed(0)} mm`);
    setText(this.skEl, String(stack.stacked));
    const w = `${Math.min(100, 100 * stack.height / MAX_TOWER).toFixed(0)}%`;
    if (this.meterEl._w !== w) { this.meterEl._w = w; this.meterEl.style.width = w; }

    this._updateRecorder();
    this._updateChallenge(chal);
    this._updateBuild(build);
  }

  _updateRecorder() {
    const r = this.rec;
    const rec = r.recording, rep = r.replaying;
    const label = rec ? 'Recording' : rep ? (r.paused ? 'Paused' : 'Replaying') : 'Idle';
    const kind = rec ? 'rec' : rep ? 'play' : 'idle';
    if (this.stateEl._k !== kind) { this.stateEl._k = kind; this.stateEl.className = 'state ' + kind; }
    setText(this.stateLbl, label);
    const total = rec ? r.step : r.totalSteps;
    const clock = `${fmtClock(r.step)} / ${fmtClock(total)}`;
    setText(this.timeEl, clock);
    setText(this.recCard.summary, rec || rep ? `${label} ${fmtClock(r.step)}` : r.hasData ? fmtClock(total) : '');

    setClass(this.btnRec, 'on', rec);
    setText(this.lblRec, rec ? 'Stop' : 'Record');
    this.btnRec.disabled = rep;
    this.btnAuto.disabled = rec || !r.hasData;
    setText(this.lblAuto, rep ? 'Stop' : 'Autopilot');

    this.btnPause.style.visibility = rep ? 'visible' : 'hidden';
    setText(this.btnPause, r.paused ? 'Play' : 'Pause');

    this.scrub.disabled = rec || !r.hasData;
    const max = Math.max(1, total);
    if (this.scrub._max !== max) { this.scrub._max = max; this.scrub.max = max; }
    if (!this.scrubbing && this.scrub._v !== r.step) { this.scrub._v = r.step; this.scrub.value = r.step; }
    const p = `${(100 * r.step / max).toFixed(1)}%`;
    if (this.scrub._p !== p) { this.scrub._p = p; this.scrub.style.setProperty('--p', p); }

    this.speedBtns.forEach(({ v, b }) => setClass(b, 'on', v === r.speed));
    this.btnExport.disabled = !r.hasData;
    this.btnClear.disabled = !r.hasData || rec || rep;
  }

  _updateBuild(a) {
    const running = a.running, rep = this.rec.replaying, has = !!this.buildSel.value;
    this.btnBuild.disabled = running || !has || rep;
    this.btnBuildStop.disabled = !running;
    this.buildSel.disabled = running;
    const n = a.total, k = a.index;
    let title = '', phase = '', frac = 0, summary = '';
    if (running) {
      title = `Block ${Math.min(n, k + 1)} of ${n}`; phase = a.phase;
      frac = a.filled.filter(Boolean).length / Math.max(1, n);
      summary = `${Math.min(n, k + 1)}/${n}`;
    } else if (a.state === 'done') {
      title = 'Complete'; phase = `built in ${fmtTime(a.time)}`; frac = 1; summary = 'Done';
    } else if (a.state === 'failed' || a.state === 'cancelled') {
      title = a.state === 'failed' ? 'Stopped' : 'Cancelled'; phase = a.message;
      frac = a.filled.filter(Boolean).length / Math.max(1, n); summary = a.state === 'failed' ? 'Stopped' : '';
    }
    setText(this.buildTitle, title);
    setText(this.buildPhase, phase);
    setText(this.buildCard.summary, summary);
    const w = `${(frac * 100).toFixed(0)}%`;
    if (this.buildBar._w !== w) { this.buildBar._w = w; this.buildBar.style.width = w; }
    setClass(this.buildCard.root, 'running', running);
    setClass(this.buildCard.root, 'complete', a.state === 'done');
    setClass(this.buildNote, 'err', a.state === 'failed');
    if (a.state === 'failed') setText(this.buildNote, a.message);
    this.panel.classList.toggle('locked', rep || running);
  }

  _updateChallenge(c) {
    const active = c.active;
    this.btnStop.disabled = !active;
    setText(this.btnStart, active ? 'Restart' : 'Start');
    setText(this.ctEl, fmtTime(c.time));
    setText(this.cmEl, active ? `${c.matched}/${c.total}` : '–');
    const best = c.bestTime;
    setText(this.cbEl, best === undefined ? '–' : fmtTime(best));
    setText(this.chalCard.summary, active ? `${fmtTime(c.time)} · ${c.matched}/${c.total}` : '');
    setClass(this.chalCard.root, 'running', active && !c.done);
    setClass(this.chalCard.root, 'complete', c.done);
  }
}
