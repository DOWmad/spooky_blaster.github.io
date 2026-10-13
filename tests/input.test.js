const test = require('node:test');
const assert = require('node:assert/strict');
const { createInput } = require('../js/input.js');

class Target {
  constructor() { this.listeners = new Map(); }

  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(fn);
  }

  emit(type, event = {}) {
    for (const fn of this.listeners.get(type) || []) {
      fn({ preventDefault() {}, stopPropagation() {}, ...event });
    }
  }
}

function fixture(buttons = []) {
  const eventTarget = new Target();
  const documentTarget = new Target();
  documentTarget.hidden = false;
  documentTarget.querySelectorAll = () => buttons;
  const canvas = new Target();
  canvas.width = 480;
  canvas.height = 640;
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 240, height: 320 });
  canvas.setPointerCapture = () => {};
  let soundStarts = 0;
  const input = createInput({
    eventTarget,
    documentTarget,
    canvas,
    initSound: () => soundStarts++,
  });
  return { input, eventTarget, documentTarget, canvas, soundStarts: () => soundStarts };
}

test('touch activates touch mode and maps the pointer above the finger', () => {
  const f = fixture();
  f.canvas.emit('pointerdown', {
    pointerType: 'touch', pointerId: 7, clientX: 120, clientY: 200,
  });

  assert.equal(f.input.isTouchMode(), true);
  assert.deepEqual(f.input.touchPosition(), { x: 240, y: 352 });
  assert.equal(f.input.wasPressed('TouchPrimary'), true);
  assert.equal(f.soundStarts(), 1);
});

test('pointer cancellation clears the movement target', () => {
  const f = fixture();
  f.canvas.emit('pointerdown', {
    pointerType: 'touch', pointerId: 7, clientX: 120, clientY: 200,
  });
  f.canvas.emit('pointercancel', { pointerId: 7 });

  assert.equal(f.input.touchPosition(), null);
});

test('virtualPress has just-pressed semantics and endStep clears it', () => {
  const f = fixture();
  f.input.virtualPress('Ultimate');

  assert.equal(f.input.wasPressed('Ultimate'), true);
  f.input.endStep();
  assert.equal(f.input.wasPressed('Ultimate'), false);
});

test('blur and visibility loss clear held keyboard and touch state', () => {
  const f = fixture();
  f.eventTarget.emit('keydown', { code: 'Space', repeat: false });
  f.canvas.emit('pointerdown', {
    pointerType: 'touch', pointerId: 7, clientX: 120, clientY: 200,
  });
  f.documentTarget.hidden = true;
  f.documentTarget.emit('visibilitychange');

  assert.equal(f.input.isDown('Space'), false);
  assert.equal(f.input.touchPosition(), null);
});

test('semantic touch buttons emit and release virtual actions', () => {
  const button = new Target();
  button.dataset = { inputCode: 'Ultimate' };
  button.setPointerCapture = () => {};
  const f = fixture([button]);

  button.emit('pointerdown', { pointerType: 'touch', pointerId: 4 });
  assert.equal(f.input.wasPressed('Ultimate'), true);
  assert.equal(f.input.isDown('Ultimate'), true);
  button.emit('pointerup', { pointerId: 4 });
  assert.equal(f.input.isDown('Ultimate'), false);
});

test('semantic controls also respond to native click activation', () => {
  const button = new Target();
  button.dataset = { inputCode: 'Pause' };
  button.setPointerCapture = () => {};
  const f = fixture([button]);

  button.emit('click');

  assert.equal(f.input.wasPressed('Pause'), true);
  assert.equal(f.input.isDown('Pause'), false);
});

test('the click synthesized after a touch press does not trigger twice', () => {
  const button = new Target();
  button.dataset = { inputCode: 'Pause' };
  button.setPointerCapture = () => {};
  const f = fixture([button]);

  button.emit('pointerdown', { pointerType: 'touch', pointerId: 4 });
  button.emit('pointerup', { pointerId: 4 });
  f.input.endStep();
  button.emit('click');

  assert.equal(f.input.wasPressed('Pause'), false);
});

test('touch mode keeps automatic fire active after the movement pointer is released', () => {
  const f = fixture();
  f.canvas.emit('pointerdown', {
    pointerType: 'touch', pointerId: 7, clientX: 120, clientY: 200,
  });
  f.canvas.emit('pointerup', { pointerId: 7 });

  assert.equal(f.input.autoFireActive(), true);
  assert.equal(f.input.touchPosition(), null);
});
