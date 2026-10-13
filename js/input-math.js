// Pure input calculations shared by browser controls and Node tests.
const InputMath = (() => {
  function clientToCanvas(canvas, clientX, clientY, shipOffset = 0) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (clientX - rect.left) * canvas.width / rect.width,
      y: (clientY - rect.top) * canvas.height / rect.height - shipOffset,
    };
  }

  function directionToTarget(x, y, target, deadZone = 2) {
    const vx = target.x - x;
    const vy = target.y - y;
    const distance = Math.hypot(vx, vy);
    if (distance <= deadZone) return { dx: 0, dy: 0 };
    return { dx: vx / distance, dy: vy / distance };
  }

  return { clientToCanvas, directionToTarget };
})();

if (typeof module !== 'undefined') module.exports = InputMath;
