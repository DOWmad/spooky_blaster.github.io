// Unified keyboard and touch state. `down` is held; `pressed` lasts one update step.
function createInput({ eventTarget, documentTarget, canvas, initSound }) {
  const math = typeof module !== 'undefined' && module.exports
    ? require('./input-math.js')
    : InputMath;
  const down = new Set();
  const pressed = new Set();
  const BLOCK_DEFAULT = new Set([
    'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Backspace',
  ]);
  let touchMode = false;
  let movePointer = null;
  let touchTarget = null;

  const clearHeld = () => {
    down.clear();
    pressed.clear();
    movePointer = null;
    touchTarget = null;
  };

  const press = code => {
    if (!down.has(code)) pressed.add(code);
    down.add(code);
  };

  const release = code => down.delete(code);

  eventTarget.addEventListener('keydown', event => {
    if (BLOCK_DEFAULT.has(event.code)) event.preventDefault();
    if (!event.repeat) pressed.add(event.code);
    down.add(event.code);
    initSound();
  });
  eventTarget.addEventListener('keyup', event => release(event.code));
  eventTarget.addEventListener('blur', clearHeld);
  documentTarget.addEventListener('visibilitychange', () => {
    if (documentTarget.hidden) clearHeld();
  });

  const updateTouch = event => {
    touchTarget = math.clientToCanvas(canvas, event.clientX, event.clientY, 48);
  };

  canvas.addEventListener('pointerdown', event => {
    if (event.pointerType !== 'touch' && event.pointerType !== 'pen') return;
    event.preventDefault();
    touchMode = true;
    initSound();
    if (movePointer === null) {
      movePointer = event.pointerId;
      canvas.setPointerCapture(event.pointerId);
      updateTouch(event);
      pressed.add('TouchPrimary');
    }
  });
  canvas.addEventListener('pointermove', event => {
    if (event.pointerId !== movePointer) return;
    event.preventDefault();
    updateTouch(event);
  });
  const endPointer = event => {
    if (event.pointerId === movePointer) {
      movePointer = null;
      touchTarget = null;
    }
  };
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);

  for (const button of documentTarget.querySelectorAll('[data-input-code]')) {
    const code = button.dataset.inputCode;
    let ignoreNextClick = false;
    button.addEventListener('pointerdown', event => {
      if (event.pointerType !== 'touch' && event.pointerType !== 'pen') return;
      event.preventDefault();
      event.stopPropagation();
      ignoreNextClick = true;
      touchMode = true;
      initSound();
      press(code);
      button.setPointerCapture(event.pointerId);
    });
    const releaseButton = event => {
      event.preventDefault();
      release(code);
    };
    button.addEventListener('pointerup', releaseButton);
    button.addEventListener('pointercancel', releaseButton);
    button.addEventListener('click', event => {
      event.preventDefault();
      if (ignoreNextClick) {
        ignoreNextClick = false;
        return;
      }
      initSound();
      pressed.add(code);
    });
  }

  return {
    isDown: (...codes) => codes.some(code => down.has(code)),
    wasPressed: (...codes) => codes.some(code => pressed.has(code)),
    // Letters/digits pressed this step, for initials entry.
    typedChars: () => [...pressed]
      .map(code => code.startsWith('Key')
        ? code.slice(3)
        : code.startsWith('Digit') ? code.slice(5) : null)
      .filter(Boolean),
    touchPosition: () => touchTarget,
    isTouchMode: () => touchMode,
    autoFireActive: () => touchMode,
    virtualPress: code => {
      initSound();
      press(code);
    },
    virtualRelease: release,
    endStep: () => pressed.clear(),
  };
}

const Input = typeof window === 'undefined' ? null : createInput({
  eventTarget: window,
  documentTarget: document,
  canvas: document.getElementById('game'),
  initSound: () => Sound.init(),
});

if (typeof module !== 'undefined') module.exports = { createInput };
