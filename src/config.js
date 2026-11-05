// Shared dimensions, limits and palette. Units: metres, radians.

export const ARM = {
  baseHeight: 0.1,   // pedestal top
  shoulderY: 0.42,   // shoulder axis height above floor
  L1: 0.5,           // shoulder -> elbow
  L2: 0.46,          // elbow -> wrist pitch axis
  tcp: 0.245,        // wrist pitch axis -> tool centre point (between finger pads)
  fingerHalfTravel: 0.075, // max half gap between pads
  minTcpY: 0.04,     // keeps fingertips off the floor
};

// name, min, max (radians), start
export const JOINTS = [
  { key: 'yaw',      label: 'Base',     min: -2.97, max: 2.97, start: 0 },
  { key: 'shoulder', label: 'Shoulder', min: -1.5,  max: 1.75, start: 0.55 },
  { key: 'elbow',    label: 'Elbow',    min: 0.05,  max: 2.6,  start: 1.25 },
  { key: 'wrist',    label: 'Wrist',    min: -2.0,  max: 2.0,  start: 1.38 },
  { key: 'roll',     label: 'Roll',     min: -3.05, max: 3.05, start: 0 },
];

export const PALETTE = {
  white: 0xeceae6,
  graphite: 0x2b2d31,
  rubber: 0x18191b,
  accent: 0xff7a30,
  background: 0xcfd0d2,
  floor: 0xd2d3d5,
  blocks: [0x86a08b, 0x5f7f9c, 0xd9c3a0, 0xc58f93, 0x9a93b8, 0xb86f55],
};

export const PHYS = {
  step: 1 / 120,
  maxSteps: 6,
};
