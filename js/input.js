// Keyboard state: `down` = currently held, `pressed` = went down since last update step.
// Touch: a finger dragging anywhere moves the ship by the finger's travel, and every
// touch-down is also reported as a tap (in game coordinates) for buttons and menus.
const Input = (() => {
  const down = new Set();
  const pressed = new Set();
  const BLOCK_DEFAULT = new Set([
    'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Backspace',
  ]);
  const canvas = document.getElementById('game');

  // Phones start in touch mode; hybrids switch on first touch and back on any key
  let touchMode = !!(window.matchMedia && matchMedia('(pointer: coarse)').matches);
  let taps = [];
  let dragId = null;
  let last = null;
  const drag = { x: 0, y: 0 };

  // Screen pixels -> game pixels (the canvas is CSS-scaled)
  function toGame(e) {
    const r = canvas.getBoundingClientRect();
    return { x: ((e.clientX - r.left) * canvas.width) / r.width, y: ((e.clientY - r.top) * canvas.height) / r.height };
  }

  addEventListener('keydown', e => {
    if (BLOCK_DEFAULT.has(e.code)) e.preventDefault();
    if (!e.repeat) pressed.add(e.code);
    down.add(e.code);
    touchMode = false;
    Sound.init();
  });
  addEventListener('keyup', e => down.delete(e.code));

  addEventListener('pointerdown', e => {
    if (e.pointerType !== 'touch') return;
    touchMode = true;
    Sound.init();
    const p = toGame(e);
    taps.push({ ...p, id: e.pointerId });
    if (dragId === null) { dragId = e.pointerId; last = p; }
  });
  addEventListener('pointermove', e => {
    if (e.pointerId !== dragId) return;
    const p = toGame(e);
    drag.x += p.x - last.x;
    drag.y += p.y - last.y;
    last = p;
  });
  const lift = e => { if (e.pointerId === dragId) dragId = null; };
  addEventListener('pointerup', lift);
  addEventListener('pointercancel', lift);

  // Losing focus must not leave keys held or a finger "stuck" dragging
  addEventListener('blur', () => { down.clear(); dragId = null; });

  return {
    isDown: (...codes) => codes.some(c => down.has(c)),
    wasPressed: (...codes) => codes.some(c => pressed.has(c)),
    // Letters/digits pressed this step, for initials entry
    typedChars: () => [...pressed]
      .map(c => (c.startsWith('Key') ? c.slice(3) : c.startsWith('Digit') ? c.slice(5) : null))
      .filter(Boolean),
    get touch() { return touchMode; },
    taps: () => taps,
    drag: () => drag,
    // A tap that hit a button shouldn't also steer the ship
    release: id => {
      if (id !== dragId) return;
      dragId = null;
      drag.x = drag.y = 0;
    },
    endStep: () => {
      pressed.clear();
      taps = [];
      drag.x = drag.y = 0; // unused travel (paused, dead) is dropped, not saved up
    },
  };
})();
