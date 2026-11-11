import test from 'node:test';
import assert from 'node:assert/strict';
import { ARM, JOINTS, PHYS, REPLAY_SPEEDS } from '../../src/config.js';

test('joint limits are ordered and the start pose is inside them', () => {
  for (const j of JOINTS) {
    assert.ok(j.min < j.max, `${j.key}: min >= max`);
    assert.ok(j.start >= j.min && j.start <= j.max, `${j.key}: start outside limits`);
  }
});

test('the arm has five joints plus a separate gripper', () => {
  assert.deepEqual(JOINTS.map((j) => j.key), ['yaw', 'shoulder', 'elbow', 'wrist', 'roll']);
  assert.ok(ARM.fingerHalfTravel > 0);
});

test('physics runs at a fixed 120 Hz step', () => {
  assert.equal(PHYS.step, 1 / 120);
});

test('replay speeds are ascending and include 1x', () => {
  assert.ok(REPLAY_SPEEDS.includes(1));
  assert.deepEqual([...REPLAY_SPEEDS].sort((a, b) => a - b), REPLAY_SPEEDS);
});
