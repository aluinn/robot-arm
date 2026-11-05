// Figures out which blocks are stacked (for the tower meter and the stacked counter).
// A block is "supported" if it is upright and either on the floor or resting on a supported block.

const out = { height: 0, stacked: 0 };
const sup = [], below = [], above = [], floor = [], counted = [], touching = [];

export function analyzeStacks(blocks, held) {
  const n = blocks.length;
  const heldBlock = held ? held.block : null;
  for (let i = 0; i < n; i++) {
    const b = blocks[i], p = b.body.position, q = b.body.quaternion;
    const upright = 1 - 2 * (q.x * q.x + q.z * q.z) > 0.95 && b !== heldBlock;
    b._top = p.y + b.half.y;
    b._bot = p.y - b.half.y;
    floor[i] = upright && b._bot < 0.012;
    sup[i] = floor[i];
    below[i] = -1;
    above[i] = false;
    b._ok = upright;
  }
  // settle support chains (at most n levels)
  for (let pass = 0; pass < n; pass++) {
    let changed = false;
    for (let i = 0; i < n; i++) {
      if (sup[i] || !blocks[i]._ok) continue;
      const pi = blocks[i].body.position;
      for (let j = 0; j < n; j++) {
        if (j === i || !sup[j]) continue;
        const pj = blocks[j].body.position;
        if (pi.y > pj.y && Math.abs(pi.x - pj.x) < 0.085 && Math.abs(pi.z - pj.z) < 0.085 &&
            Math.abs(blocks[i]._bot - blocks[j]._top) < 0.015) {
          sup[i] = true; below[i] = j; changed = true;
          break;
        }
      }
    }
    if (!changed) break;
  }
  for (let i = 0; i < n; i++) if (below[i] >= 0) above[below[i]] = true;

  // in a stack: resting on a block, or carrying one
  for (let i = 0; i < n; i++) counted[i] = sup[i] && (below[i] >= 0 || above[i]);
  // a floor block that touches a counted one is part of the same structure (e.g. a pyramid base)
  for (let i = 0; i < n; i++) {
    if (counted[i] || !floor[i]) continue;
    for (let j = 0; j < n; j++) {
      if (!counted[j] || !floor[j]) continue;
      const a = blocks[i].body.position, c = blocks[j].body.position;
      if (Math.hypot(a.x - c.x, a.z - c.z) < 0.125) { touching[i] = true; break; }
    }
  }
  let stacked = 0, height = 0;
  for (let i = 0; i < n; i++) {
    if (counted[i] || touching[i]) {
      stacked++;
      if (blocks[i]._top > height) height = blocks[i]._top;
    }
    touching[i] = false;
  }
  out.height = height;
  out.stacked = stacked;
  return out;
}
