const test = require('node:test');
const assert = require('node:assert/strict');
const { clientToCanvas, directionToTarget } = require('../js/input-math.js');

test('clientToCanvas maps CSS-scaled pointer coordinates into canvas space', () => {
  const canvas = {
    width: 480,
    height: 640,
    getBoundingClientRect: () => ({ left: 10, top: 20, width: 240, height: 320 }),
  };

  assert.deepEqual(clientToCanvas(canvas, 130, 180, 48), { x: 240, y: 272 });
});

test('directionToTarget returns a normalized direction outside its dead zone', () => {
  assert.deepEqual(directionToTarget(10, 20, { x: 13, y: 24 }), { dx: 0.6, dy: 0.8 });
});

test('directionToTarget stops inside its dead zone', () => {
  assert.deepEqual(directionToTarget(10, 20, { x: 11, y: 21 }, 2), { dx: 0, dy: 0 });
});
