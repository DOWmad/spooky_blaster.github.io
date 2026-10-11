// Chiptune-style sound effects synthesized with the Web Audio API.
// The AudioContext is created lazily on first key press (browsers block autoplay).
const Sound = (() => {
  let ctx = null;
  let master = null;
  let noiseBuf = null;
  let musicGain = null;
  let muted = false;

  function init() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return;
    }
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain();
      master.gain.value = 0.25;
      master.connect(ctx.destination);
      musicGain = ctx.createGain();
      musicGain.gain.value = 0.5;
      musicGain.connect(master);
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const data = noiseBuf.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    } catch (e) {
      ctx = null;
    }
  }

  function tone(freq, dur, type = 'square', vol = 0.3, slideTo = null, delay = 0, out = master) {
    if (!ctx || muted) return;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(gain);
    gain.connect(out);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  function noise(dur, vol = 0.5, cutoff = 1000, delay = 0, out = master) {
    if (!ctx || muted) return;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();
    src.buffer = noiseBuf;
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(cutoff, t);
    filter.frequency.exponentialRampToValueAtTime(60, t + dur);
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filter);
    filter.connect(gain);
    gain.connect(out);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  function arpeggio(notes, step, type = 'square', vol = 0.25) {
    notes.forEach((f, i) => tone(f, step * 1.5, type, vol, null, i * step));
  }

  const sfx = {
    shoot: () => tone(1200, 0.06, 'square', 0.06, 500),
    enemyShoot: () => tone(400, 0.08, 'triangle', 0.08, 200),
    hit: () => tone(220, 0.04, 'square', 0.1, 120),
    explode: () => noise(0.3, 0.5, 1500),
    bigExplode: () => { noise(1.2, 0.9, 900); tone(120, 0.8, 'sawtooth', 0.3, 30); },
    playerDie: () => { noise(1, 0.8, 2000); tone(600, 1, 'square', 0.25, 40); },
    powerup: () => arpeggio([523, 659, 784, 1047], 0.06),
    extraLife: () => arpeggio([784, 988, 1175, 1568, 1175, 1568], 0.08),
    shieldHit: () => tone(900, 0.25, 'triangle', 0.3, 200),
    warning: () => { for (let i = 0; i < 3; i++) { tone(440, 0.4, 'square', 0.2, null, i * 0.9); tone(330, 0.4, 'square', 0.2, null, i * 0.9 + 0.4); } },
    laser: () => tone(150, 1.1, 'sawtooth', 0.2, 80),
    ultimate: () => {
      tone(80, 4, 'sawtooth', 0.3, 40);
      tone(160, 4, 'square', 0.12, 120);
      noise(1.5, 0.6, 3000);
      arpeggio([523, 784, 1047, 1568], 0.05, 'square', 0.2);
    },
    levelClear: () => arpeggio([392, 523, 659, 784, 659, 784, 1047], 0.12, 'square', 0.2),
    gameOver: () => arpeggio([523, 440, 349, 262, 196], 0.25, 'triangle', 0.35),
    select: () => tone(660, 0.08, 'square', 0.15),
    dive: () => tone(900, 0.35, 'square', 0.12, 200),
    spell: () => arpeggio([880, 660, 990, 740], 0.04, 'triangle', 0.18),
    curse: () => { tone(400, 0.6, 'sawtooth', 0.15, 90); tone(600, 0.6, 'square', 0.08, 120); },
    meow: () => { tone(620, 0.12, 'square', 0.12, 880); tone(880, 0.35, 'triangle', 0.15, 480, 0.1); },
    hiss: () => noise(0.3, 0.3, 7000),
    raise: () => { tone(110, 0.8, 'sawtooth', 0.15, 220); noise(0.6, 0.2, 600); },
    howl: () => { tone(300, 0.5, 'triangle', 0.2, 620); tone(620, 0.7, 'triangle', 0.2, 280, 0.5); },
    bonus: () => arpeggio([1047, 1319, 1568, 2093, 1568, 2093], 0.05, 'triangle', 0.25),
    confirm: () => arpeggio([660, 990], 0.07),
  };

  // ---------- music sequencer ----------
  // Tracks are 16th-note steps. `lead` is MIDI note numbers ('.' = rest), one bar per line.
  // `bass` is a one-bar pattern of semitone offsets from each bar's root in `roots`.
  // `drums`: K = kick, S = snare, h = hi-hat.
  const parse = str => str.trim().split(/\s+/).map(t => (t === '.' ? 0 : Number(t)));
  const TRACKS = {
    stage: {
      bpm: 132,
      roots: [40, 36, 38, 35],
      bass: [0, null, 12, null, 0, null, 12, null, 0, null, 12, null, 0, null, 7, null],
      drums: 'K.h.S.h.K.hKS.h.',
      lead: parse(`
        64 . 67 . 71 . 67 . 69 . 71 . 74 . 71 .
        72 . 71 . 67 . 64 . 67 . . . 64 . . .
        66 . 69 . 74 . 69 . 71 . 74 . 78 . 76 .
        75 . . . 71 . 75 . 78 . . . 76 . 75 .
      `),
    },
    boss: {
      bpm: 168,
      roots: [45, 41, 43, 40],
      bass: [0, 0, 12, 0, 0, 12, 0, 0, 12, 0, 0, 12, 0, 12, 7, 12],
      drums: 'KhhhShhKKhhhShSS',
      lead: parse(`
        76 . 76 74 . 72 . 74 . 76 . 81 . 79 76 .
        77 . 77 76 . 74 . 72 . 74 . 77 . 76 74 .
        79 . 79 77 . 76 . 74 . 76 . 79 . 83 81 .
        80 . 76 . 80 . 83 . 81 80 76 . 71 . 68 .
      `),
    },
  };
  // Halloween variants
  TRACKS.h_stage = {
    bpm: 116,
    roots: [38, 34, 36, 33],
    bass: [0, null, 7, null, 12, null, 7, null, 0, null, 7, null, 12, null, 6, null],
    drums: 'K.h.S...K.h.S.h.',
    lead: parse(`
      62 . 65 . 69 . 68 . 69 . 65 . 62 . . .
      58 . 62 . 65 . 64 . 65 . 62 . 58 . . .
      60 . 64 . 67 . 66 . 67 . 64 . 60 . 61 .
      69 . 68 . 67 . 66 . 65 . 64 . 63 . 61 .
    `),
  };
  // Opening of Bach's Toccata and Fugue in D minor (public domain)
  TRACKS.h_boss = {
    bpm: 150,
    wave: 'sawtooth',
    roots: [38, 38, 33, 38],
    bass: [0, 0, 12, 0, 0, 12, 0, 0, 12, 0, 0, 12, 0, 12, 7, 12],
    drums: 'KhhhShhKKhhhShSS',
    lead: parse(`
      81 79 81 . . . . . 79 77 76 74 73 . 74 .
      69 67 69 . . . . . 64 65 61 . 62 . . .
      57 55 57 . . . . . 52 53 49 . 50 . . .
      50 . 53 . 57 . 61 . 62 . 65 . 69 . 74 .
    `),
  };
  // ---------- per-level stage themes ----------
  // Level 1 uses the hand-written tunes above; levels 2-6 are composed from a fixed
  // seed so each always sounds the same: chord tones on the beat, scale steps in
  // between, and two alternating motifs (A B A B') resolving home at the end.
  function seeded(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const SCALES = {
    minor: [0, 2, 3, 5, 7, 8, 10], dorian: [0, 2, 3, 5, 7, 9, 10], major: [0, 2, 4, 5, 7, 9, 11],
    harmonic: [0, 2, 3, 5, 7, 8, 11], phrygian: [0, 1, 4, 5, 7, 8, 10],
  };
  const RHYTHMS = ['x.x.xx.xx.x.x.x.', 'x..x..x.x.xx.x..', 'xxx.x.x.xxx.x...', 'x.xxx.x.x.xxx.x.', 'x...x.xxx...x.xx'];
  const BASSES = [
    [0, null, 12, null, 0, null, 12, null, 0, null, 12, null, 0, null, 7, null],
    [0, 0, null, 0, 12, null, 0, null, 0, 0, null, 0, 7, null, 12, null],
    [0, null, null, 0, null, null, 7, null, 0, null, null, 0, 12, null, 7, null],
  ];
  const DRUM_KITS = ['K.h.S.h.K.h.S.h.', 'K.hKS.h.K.hKS.hh', 'K..hS..hK.K.S..h', 'KhhhShhhKhKhShhS'];

  function compose(seed, { bpm, scale, tonic, prog, wave }) {
    const rnd = seeded(seed);
    const pick = arr => arr[Math.floor(rnd() * arr.length)];
    const sc = SCALES[scale];
    const note = deg => tonic + sc[((deg % 7) + 7) % 7] + 12 * Math.floor(deg / 7);
    const motif = () => {
      const m = [];
      let d = 0;
      for (let i = 0; i < 16; i++) {
        d = i % 4 === 0 ? pick([0, 2, 4, 7]) : Math.max(-3, Math.min(9, d + pick([-2, -1, 1, 1, 2])));
        m.push(d);
      }
      return m;
    };
    const motifs = [motif(), motif()];
    const rhythms = [pick(RHYTHMS), pick(RHYTHMS)];
    const lead = [];
    prog.forEach((chord, bar) => {
      const last = bar === prog.length - 1;
      for (let i = 0; i < 16; i++) {
        if (last && i >= 12) lead.push(i === 12 ? note(7) : 0); // resolve to the tonic
        else lead.push(rhythms[bar % 2][i] === 'x' ? note(chord + motifs[bar % 2][i] + 7) : 0);
      }
    });
    return { bpm, wave, lead, roots: prog.map(c => note(c) - 12), bass: pick(BASSES), drums: pick(DRUM_KITS) };
  }

  TRACKS.stage1 = TRACKS.stage;
  TRACKS.stage2 = compose(11, { bpm: 140, scale: 'dorian', tonic: 50, prog: [0, 3, 4, 0] });
  TRACKS.stage3 = compose(23, { bpm: 126, scale: 'major', tonic: 48, prog: [0, 4, 5, 3] });
  TRACKS.stage4 = compose(37, { bpm: 150, scale: 'minor', tonic: 45, prog: [0, 5, 6, 4], wave: 'sawtooth' });
  TRACKS.stage5 = compose(41, { bpm: 118, scale: 'harmonic', tonic: 52, prog: [0, 3, 4, 0], wave: 'triangle' });
  TRACKS.stage6 = compose(59, { bpm: 158, scale: 'phrygian', tonic: 47, prog: [0, 1, 0, 6], wave: 'sawtooth' });
  TRACKS.h_stage1 = TRACKS.h_stage;
  TRACKS.h_stage2 = compose(101, { bpm: 112, scale: 'harmonic', tonic: 50, prog: [0, 5, 3, 4] });
  TRACKS.h_stage3 = compose(113, { bpm: 100, scale: 'phrygian', tonic: 45, prog: [0, 1, 0, 4], wave: 'triangle' });
  TRACKS.h_stage4 = compose(127, { bpm: 132, scale: 'minor', tonic: 48, prog: [0, 5, 6, 4], wave: 'sawtooth' });
  TRACKS.h_stage5 = compose(139, { bpm: 120, scale: 'harmonic', tonic: 52, prog: [0, 3, 0, 4] });
  TRACKS.h_stage6 = compose(151, { bpm: 144, scale: 'phrygian', tonic: 50, prog: [0, 1, 6, 4], wave: 'sawtooth' });

  // Final boss: same themes, faster and more urgent
  TRACKS.final = { ...TRACKS.boss, bpm: 188 };
  TRACKS.h_final = { ...TRACKS.h_boss, bpm: 172 };
  const midi = n => 440 * Math.pow(2, (n - 69) / 12);
  let track = null;
  let trackName = null;
  let step = 0;
  let nextTime = 0;
  let musicOn = true;

  function music(name) {
    if (!musicOn) name = null;
    if (name === trackName) return;
    trackName = name;
    track = name ? TRACKS[name] : null;
    step = 0;
    nextTime = 0; // tick() re-syncs to the audio clock
  }

  function playStep(tr, i, delay, dur) {
    const lead = tr.lead[i];
    const leadVol = { sawtooth: 0.08, triangle: 0.2 }[tr.wave] ?? 0.12;
    if (lead) tone(midi(lead), dur * 1.8, tr.wave || 'square', leadVol, null, delay, musicGain);
    const s = i % 16;
    const root = tr.roots[Math.floor(i / 16) % tr.roots.length];
    if (tr.bass[s] !== null) tone(midi(root + tr.bass[s]), dur * 0.9, 'triangle', 0.4, null, delay, musicGain);
    const d = tr.drums[s];
    if (d === 'K') tone(150, 0.15, 'sine', 0.6, 40, delay, musicGain);
    else if (d === 'S') noise(0.12, 0.35, 5000, delay, musicGain);
    else if (d === 'h') noise(0.03, 0.12, 9000, delay, musicGain);
  }

  // Lookahead scheduler: book notes slightly ahead at exact audio-clock times
  function tick() {
    if (!ctx || !track) return;
    const stepDur = 60 / track.bpm / 4;
    if (nextTime < ctx.currentTime) nextTime = ctx.currentTime + 0.05; // new track or tab woke up
    while (nextTime < ctx.currentTime + 0.12) {
      playStep(track, step, nextTime - ctx.currentTime, stepDur);
      step = (step + 1) % track.lead.length;
      nextTime += stepDur;
    }
  }
  setInterval(tick, 25);

  return {
    init,
    sfx,
    music,
    toggleMusic: () => { musicOn = !musicOn; if (!musicOn) music(null); return musicOn; },
    isMusicOn: () => musicOn,
    toggleMute: () => { muted = !muted; return muted; },
    isMuted: () => muted,
  };
})();
