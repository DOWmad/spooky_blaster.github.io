// Visual/audio theme: 'classic' space or 'halloween'. Defaults to Halloween in
// October; the player's choice (T on the title screen) is remembered.
const Theme = (() => {
  const KEY = 'starblaster.theme';
  const PALETTES = {
    classic: {
      label: '#ff3344', enemyBullet: '#ff44dd', ringBullet: '#33ffff',
      rockFill: '#3a2a20', rockStroke: '#cc9966',
    },
    halloween: {
      label: '#ff9933', enemyBullet: '#99ff33', ringBullet: '#ff9933',
      rockFill: '#2a2a38', rockStroke: '#8888aa',
    },
  };

  let halloween = new Date().getMonth() === 9;
  try {
    const saved = localStorage.getItem(KEY);
    if (saved) halloween = saved === 'halloween';
  } catch (e) {
    // Storage unavailable - keep the seasonal default
  }

  return {
    get halloween() { return halloween; },
    get c() { return halloween ? PALETTES.halloween : PALETTES.classic; },
    // Prefix for themed sprite and music keys
    get prefix() { return halloween ? 'h_' : ''; },
    toggle() {
      halloween = !halloween;
      try { localStorage.setItem(KEY, halloween ? 'halloween' : 'classic'); } catch (e) { /* session only */ }
    },
  };
})();
