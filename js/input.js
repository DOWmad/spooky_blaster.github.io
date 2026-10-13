// Keyboard state: `down` = currently held, `pressed` = went down since last update step.
const Input = (() => {
  const down = new Set();
  const pressed = new Set();
  const BLOCK_DEFAULT = new Set([
    'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Backspace',
  ]);

  addEventListener('keydown', e => {
    if (BLOCK_DEFAULT.has(e.code)) e.preventDefault();
    if (!e.repeat) pressed.add(e.code);
    down.add(e.code);
    Sound.init();
  });
  addEventListener('keyup', e => down.delete(e.code));
  addEventListener('blur', () => down.clear());

  return {
    isDown: (...codes) => codes.some(c => down.has(c)),
    wasPressed: (...codes) => codes.some(c => pressed.has(c)),
    // Letters/digits pressed this step, for initials entry
    typedChars: () => [...pressed]
      .map(c => (c.startsWith('Key') ? c.slice(3) : c.startsWith('Digit') ? c.slice(5) : null))
      .filter(Boolean),
    endStep: () => pressed.clear(),
  };
})();
