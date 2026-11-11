import test from 'node:test';
import assert from 'node:assert/strict';

// recorder.js persists to localStorage; give it an in-memory one
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)); },
  removeItem: (k) => { store.delete(k); },
};

const { Recorder, MAX_STEPS } = await import('../../src/recorder.js');
const { PHYS } = await import('../../src/config.js');

const blocks = () => Array.from({ length: 6 }, () => ({ p: [0, 0.05, 0], q: [0, 0, 0, 1], v: [0, 0, 0], w: [0, 0, 0], s: 0 }));
const arm = () => ({
  q: Array.from({ length: 5 }, () => [0, 0, 0]), grip: [0, 0, 0, 0], breath: [0, 0, 0], target: [0, 0, 0, 0],
  lastValid: [0, 0, 0], tilt: 0, mode: 'cartesian', fine: false, precise: false,
});
const valid = () => ({
  v: 1, sim: 3, dt: PHYS.step, steps: 10,
  snapshot: { arm: arm(), blocks: blocks() },
  final: blocks(),
  events: [[0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0]],
});
const imp = (d) => new Recorder().importJSON(typeof d === 'string' ? d : JSON.stringify(d));

test('a well-formed recording imports', () => {
  assert.equal(imp(valid()), null);
});

test('imports are saved so they survive a reload', () => {
  const r = new Recorder();
  assert.equal(r.importJSON(JSON.stringify(valid())), null);
  const again = new Recorder();
  again.loadSaved();
  assert.equal(again.totalSteps, 10);
});

test('rejects things that are not recordings', () => {
  assert.equal(imp('not json'), 'not valid JSON');
  assert.equal(imp('null'), 'not a recording');
  assert.equal(imp('[]'), 'unsupported recording version');
});

test('rejects other versions and physics rates', () => {
  assert.equal(imp({ ...valid(), v: 2 }), 'unsupported recording version');
  assert.equal(imp({ ...valid(), sim: 1 }), 'recorded with a different simulator version');
  assert.equal(imp({ ...valid(), dt: 1 / 60 }), 'recorded at a different physics rate');
});

test('rejects bad lengths', () => {
  assert.equal(imp({ ...valid(), steps: 0 }), 'invalid length');
  assert.equal(imp({ ...valid(), steps: MAX_STEPS + 1 }), 'invalid length');
  assert.equal(imp({ ...valid(), steps: 1.5 }), 'invalid length');
});

test('rejects malformed block and arm snapshots', () => {
  const d = valid();
  d.snapshot.blocks.pop();
  assert.equal(imp(d), 'invalid block snapshot');
  const e = valid();
  e.snapshot.arm.mode = 'teleport';
  assert.equal(imp(e), 'invalid arm snapshot');
  const f = valid();
  f.snapshot.blocks[0].p[1] = 'x';
  assert.equal(imp(f), 'invalid block snapshot');
});

test('rejects malformed events', () => {
  const d = valid();
  d.events = [];
  assert.equal(imp(d), 'invalid events');
  const e = valid();
  e.events[0][0] = 3;                    // must start at step 0
  assert.equal(imp(e), 'invalid events');
  const f = valid();
  f.events.push([0, ...f.events[0].slice(1)]);   // steps must increase
  assert.equal(imp(f), 'invalid events');
  const g = valid();
  g.events[0][7] = 2;                    // flag must be 0 or 1
  assert.equal(imp(g), 'invalid events');
});
