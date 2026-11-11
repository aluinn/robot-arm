import test from 'node:test';
import assert from 'node:assert/strict';
import { STRUCTURES, SITE } from '../../src/structures.js';

const EPS = 1e-9;

test('every structure uses at most the six available blocks (four 100 mm, two 140 mm)', () => {
  for (const [key, s] of Object.entries(STRUCTURES)) {
    const small = s.slots.filter((p) => Math.abs(p.h - 0.1) < EPS).length;
    const tall = s.slots.filter((p) => Math.abs(p.h - 0.14) < EPS).length;
    assert.equal(small + tall, s.slots.length, `${key}: unknown block height`);
    assert.ok(small <= 4 && tall <= 2, `${key}: needs ${small} small and ${tall} tall blocks`);
  }
});

test('slots are listed bottom layer first and every slot is supported', () => {
  for (const [key, s] of Object.entries(STRUCTURES)) {
    let prevBottom = -Infinity;
    s.slots.forEach((p, i) => {
      const bottom = p.y - p.h / 2;
      assert.ok(bottom >= prevBottom - EPS, `${key}[${i}] is listed before a lower slot`);
      prevBottom = Math.max(prevBottom, bottom);
      if (bottom < EPS) return;                           // on the floor
      const supported = s.slots.slice(0, i).some((q) =>
        Math.abs(q.y + q.h / 2 - bottom) < EPS && Math.abs(q.x - p.x) < 0.1);
      assert.ok(supported, `${key}[${i}] floats at y=${bottom}`);
    });
  }
});

test('slots in one structure do not overlap', () => {
  for (const [key, s] of Object.entries(STRUCTURES)) {
    for (let i = 0; i < s.slots.length; i++) {
      for (let j = i + 1; j < s.slots.length; j++) {
        const a = s.slots[i], b = s.slots[j];
        const overlapX = Math.abs(a.x - b.x) < 0.1 - 1e-6;
        const overlapY = Math.abs(a.y - b.y) < (a.h + b.h) / 2 - 1e-6;
        assert.ok(!(overlapX && overlapY), `${key}: slots ${i} and ${j} overlap`);
      }
    }
  }
});

test('the build site is on the table in front of the arm', () => {
  assert.ok(SITE.x > 0 && SITE.z > 0);
});
