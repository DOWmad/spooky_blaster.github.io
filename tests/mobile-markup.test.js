const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'style.css'), 'utf8');
const entities = fs.readFileSync(path.join(__dirname, '..', 'js', 'entities.js'), 'utf8');
const game = fs.readFileSync(path.join(__dirname, '..', 'js', 'game.js'), 'utf8');

test('mobile viewport and semantic actions are present', () => {
  assert.match(html, /viewport-fit=cover/);
  for (const action of [
    'Pause', 'Ultimate', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter',
  ]) {
    assert.match(html, new RegExp(`data-input-code="${action}"`));
  }
  assert.match(html, /aria-label="Pause game"/);
  assert.match(html, /aria-label="Use ultimate"/);
  assert.match(html, /data-input-code="TouchPrimary"/);
  assert.match(html, /aria-label="Start game"/);
});

test('the game surface blocks gestures and respects safe areas', () => {
  assert.match(css, /touch-action:\s*none/);
  assert.match(css, /env\(safe-area-inset-bottom\)/);
  assert.match(css, /min-width:\s*44px/);
  assert.match(css, /100dvh/);
});

test('gameplay consumes touch movement and named mobile actions', () => {
  assert.match(entities, /Input\.touchPosition\(\)/);
  assert.match(entities, /Input\.autoFireActive\(\)/);
  for (const action of ['TouchPrimary', 'Pause', 'Ultimate']) {
    assert.match(game, new RegExp(`Input\\.wasPressed\\([^\\n]*'${action}'`));
  }
  assert.match(game, /classList\.toggle\('touch-mode'/);
  assert.match(game, /dataset\.gameState = G\.state/);
});
