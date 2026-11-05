// Target structures for Auto-Build. Slots are listed bottom layer first, so building in order always
// has support underneath. x/z are relative to SITE, y is the block centre height, h the block height.
// Every structure uses all six blocks (four 100 mm cubes and two 140 mm bricks).

export const SITE = { x: 0.42, z: 0.3 };

export const STRUCTURES = {
  tower: {
    label: 'Tower (all 6)',
    slots: [
      { x: 0, y: 0.07, h: 0.14 }, { x: 0, y: 0.21, h: 0.14 },
      { x: 0, y: 0.33, h: 0.1 }, { x: 0, y: 0.43, h: 0.1 }, { x: 0, y: 0.53, h: 0.1 }, { x: 0, y: 0.63, h: 0.1 },
    ],
  },
  pyramid: {
    label: 'Pyramid (3-2-1)',
    slots: [
      { x: -0.11, y: 0.05, h: 0.1 }, { x: 0, y: 0.05, h: 0.1 }, { x: 0.11, y: 0.05, h: 0.1 },
      { x: -0.055, y: 0.17, h: 0.14 }, { x: 0.055, y: 0.17, h: 0.14 },
      { x: 0, y: 0.29, h: 0.1 },
    ],
  },
  wall: {
    label: 'Wall (3 × 2)',
    slots: [
      { x: -0.11, y: 0.05, h: 0.1 }, { x: 0, y: 0.05, h: 0.1 }, { x: 0.11, y: 0.05, h: 0.1 },
      { x: -0.11, y: 0.15, h: 0.1 }, { x: 0, y: 0.17, h: 0.14 }, { x: 0.11, y: 0.17, h: 0.14 },
    ],
  },
  stairs: {
    label: 'Staircase (1-2-3)',
    slots: [
      { x: -0.11, y: 0.05, h: 0.1 }, { x: 0, y: 0.05, h: 0.1 }, { x: 0.11, y: 0.07, h: 0.14 },
      { x: 0, y: 0.15, h: 0.1 }, { x: 0.11, y: 0.21, h: 0.14 },
      { x: 0.11, y: 0.33, h: 0.1 },
    ],
  },
};
