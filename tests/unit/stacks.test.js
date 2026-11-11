import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeStacks } from '../../src/stacks.js';

// minimal block double: analyzeStacks only reads body.position, body.quaternion and half
const block = (x, y, z, h = 0.1, q = { x: 0, y: 0, z: 0, w: 1 }) => ({
  body: { position: { x, y, z }, quaternion: q },
  half: { x: 0.05, y: h / 2, z: 0.05 },
});

test('blocks lying alone on the floor are not a stack', () => {
  const r = analyzeStacks([block(0, 0.05, 0), block(0.5, 0.05, 0)], null);
  assert.equal(r.stacked, 0);
  assert.equal(r.height, 0);
});

test('a tower of three counts all three and reports its top', () => {
  const r = analyzeStacks([block(0, 0.05, 0), block(0, 0.15, 0), block(0, 0.25, 0)], null);
  assert.equal(r.stacked, 3);
  assert.ok(Math.abs(r.height - 0.3) < 1e-9);
});

test('a block offset too far sideways is not supported', () => {
  const r = analyzeStacks([block(0, 0.05, 0), block(0.1, 0.15, 0)], null);
  assert.equal(r.stacked, 0);
});

test('a held block does not count and does not support others', () => {
  const blocks = [block(0, 0.05, 0), block(0, 0.15, 0)];
  const r = analyzeStacks(blocks, { block: blocks[1] });
  assert.equal(r.stacked, 0);
});

test('a block tipped over is not counted as upright', () => {
  // 90 degrees about x: quaternion (sin45, 0, 0, cos45)
  const s = Math.SQRT1_2;
  const r = analyzeStacks([block(0, 0.05, 0), block(0, 0.15, 0, 0.1, { x: s, y: 0, z: 0, w: s })], null);
  assert.equal(r.stacked, 0);
});

test('a floor block touching a stack counts as part of it (pyramid base)', () => {
  const r = analyzeStacks([block(-0.055, 0.05, 0), block(0.055, 0.05, 0), block(0, 0.15, 0)], null);
  assert.equal(r.stacked, 3);
  assert.ok(Math.abs(r.height - 0.2) < 1e-9);
});
