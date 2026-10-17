// Pixel-art sprites defined as strings, pre-rendered once to offscreen canvases.
// Each sprite also gets white (hit flash) and gold (elite outline) silhouettes.
const Sprites = (() => {
  const COLORS = {
    W: '#ffffff', C: '#33ffff', R: '#ff3344', B: '#3366ff', O: '#ff9933',
    Y: '#ffee33', G: '#33ff66', P: '#cc44ff', M: '#99aabb', K: '#110022',
    // Halloween extras
    S: '#eee6cc', E: '#4a1a66', V: '#8833dd', L: '#99ff33', N: '#cc5500',
    Z: '#7aa65a', T: '#5f8a3a', D: '#992222', Q: '#ffcc00', A: '#666677', F: '#8a6a44', J: '#22222e',
  };

  // Build a symmetric sprite from its left half
  const mirror = halves => halves.map(h => h + [...h].reverse().join(''));
  const recolor = (rows, map) => rows.map(r => r.replace(/./g, ch => map[ch] || ch));
  const PUMPKIN = [
    '......G......',
    '.....GG......',
    '..OOOOOOOOO..',
    '.OOOOOOOOOOO.',
    'OOYYOOOOOYYOO',
    'OOYYOOOOOYYOO',
    'OOOOOOYOOOOOO',
    'OOYOYOYOYOYOO',
    '.OOYOYOYOYOO.',
    '..OOOOOOOOO..',
  ];

  const ART = {
    player: { scale: 3, rows: [
      '.....W.....',
      '....WCW....',
      '....WCW....',
      '...WWCWW...',
      '.R.WWWWW.R.',
      '.RWWBWBWWR.',
      'RWWWWWWWWWR',
      'WW.WWWWW.WW',
      'W...R.R...W',
    ] },
    grunt: { scale: 3, rows: [
      '..G.....G..',
      '...G...G...',
      '..GGGGGGG..',
      '.GG.GGG.GG.',
      'GGGGGGGGGGG',
      'G.GGGGGGG.G',
      'G.G.....G.G',
      '...GG.GG...',
    ] },
    grunt2: { scale: 3, rows: [
      '..G.....G..',
      'G..G...G..G',
      'G.GGGGGGG.G',
      'GGG.GGG.GGG',
      'GGGGGGGGGGG',
      '.GGGGGGGGG.',
      '..G.....G..',
      '.G.......G.',
    ] },
    swooper: { scale: 3, rows: [
      'P.........P',
      'PP...P...PP',
      '.PPPPPPPPP.',
      '..PPYPYPP..',
      '...PPPPP...',
      '....P.P....',
    ] },
    shooter: { scale: 3, rows: [
      '...OOOOO...',
      '.OOOOOOOOO.',
      'OO.OO.OO.OO',
      'OOOOOOOOOOO',
      '..O..O..O..',
      '.O.O...O.O.',
    ] },
    tank: { scale: 3, rows: [
      '..MMMMMMMMM..',
      '.MMMMMMMMMMM.',
      'MMWMMMMMMMWMM',
      'MMMMMRRRMMMMM',
      'MMMMMRRRMMMMM',
      '.MMMMMMMMMMM.',
      '..M.M...M.M..',
    ] },
    boss1: { scale: 5, rows: [
      '.......RRRRRR.......',
      '.....RRRRRRRRRR.....',
      '...RRRWWRRRRWWRRR...',
      '..RRRRWWRRRRWWRRRR..',
      '.RRRRRRRRRRRRRRRRRR.',
      'RRYYRRYYRRRRYYRRYYRR',
      'RRRRRRRRRRRRRRRRRRRR',
      '.RR..RR..RR..RR..RR.',
      'RR....RR....RR....RR',
    ] },
    boss2: { scale: 5, rows: [
      'GG................GG',
      'GGG..............GGG',
      '.GGG....GGGG....GGG.',
      '..GGGGGGGGGGGGGGGG..',
      '...GGGGWWGGWWGGGG...',
      '..GGGGGRRGGRRGGGGG..',
      '.GGGGGGGGGGGGGGGGGG.',
      'GG..GGGGGGGGGGGG..GG',
      'G...GG.GG..GG.GG...G',
      '....G..G....G..G....',
    ] },
    boss3: { scale: 5, rows: [
      '......PPPPPPPP......',
      '....PPPPPPPPPPPP....',
      '..PPPPWWWWWWWWPPPP..',
      '.PPPWWWWCCCCWWWWPPP.',
      'PPPWWWWCCKKCCWWWWPPP',
      'PPPWWWWCCKKCCWWWWPPP',
      '.PPPWWWWCCCCWWWWPPP.',
      '..PPPPWWWWWWWWPPPP..',
      '....PPPPPPPPPPPP....',
      '..P...P..PP..P...P..',
      '.P...P...PP...P...P.',
    ] },

    player_mk2: { scale: 3, rows: [
      '......W......',
      '.....WCW.....',
      '.....WCW.....',
      '....WWCWW....',
      '.R..WWWWW..R.',
      '.RBWWBWBWWBR.',
      'RWWWWWWWWWWWR',
      'WWW.WWWWW.WWW',
      'W.R..R.R..R.W',
    ] },
    player_mk3: { scale: 3, rows: [
      '.......W.......',
      '......WCW......',
      '......WCW......',
      '.....WWCWW.....',
      '..Y..WWWWW..Y..',
      '.YR.WWBWBWW.RY.',
      'YRBWWWWWWWWWBRY',
      'RWWWWWWWWWWWWWR',
      'WWWW.WWWWW.WWWW',
      'W..R..R.R..R..W',
    ] },

    diver: { scale: 3, rows: [
      'R.........R',
      'RR...Y...RR',
      '.RR..R..RR.',
      '..RRRRRRR..',
      '...RRWRR...',
      '....RRR....',
      '.....R.....',
    ] },
    splitter: { scale: 3, rows: [
      '...CCCCC...',
      '..CCCCCCC..',
      '.CCWCCCWCC.',
      'CCCCCCCCCCC',
      'CCCBCCCBCCC',
      'CCCCCCCCCCC',
      '.CCCCCCCCC.',
      '..C.CCC.C..',
      '.C...C...C.',
    ] },
    mini: { scale: 3, rows: [
      '.CCCCC.',
      'CWCCCWC',
      'CCCCCCC',
      '.C.C.C.',
      'C.....C',
    ] },
    minelayer: { scale: 3, rows: [
      '....MMMMMMM....',
      '..MMMMMMMMMMM..',
      'MMMYMMMYMMMYMMM',
      '.MMMMMMMMMMMMM.',
      '...MM.....MM...',
      '...R.......R...',
    ] },
    mine: { scale: 3, rows: [
      '...R...',
      '.R.R.R.',
      '..RRR..',
      'RRRYRRR',
      '..RRR..',
      '.R.R.R.',
      '...R...',
    ] },
    phantom: { scale: 3, rows: [
      '..PPPPPPP..',
      '.PPWPPPWPP.',
      'PPPPPPPPPPP',
      'PP.PPPPP.PP',
      'P..PCCCP..P',
      '...PPPPP...',
      '..P.P.P.P..',
    ] },
    necromancer: { scale: 3, rows: [  // classic: carrier that rebuilds wrecks
      '...MMMMMMMMM...',
      '.MMMMMMMMMMMMM.',
      'MMCMMMMMMMMMCMM',
      'MMMMMRRRRRMMMMM',
      'MMMMMR...RMMMMM',
      '.MMMMRRRRRMMMM.',
      '..M.M.....M.M..',
    ] },
    bonus: { scale: 3, rows: [
      '.....QQQQQ.....',
      '...QQWWWWWQQ...',
      '.QQQQQQQQQQQQQ.',
      'QQRQQRQQRQQRQQQ',
      '.QQQQQQQQQQQQQ.',
      '...Q..Q.Q..Q...',
    ] },
    boss_final: { scale: 5, rows: mirror([
      '..........RRRR',
      '.......RRRRRRR',
      '.....RRRMMMMMM',
      '...RRRMMMMMMMM',
      '..RRMMMMWWWMMM',
      '.RRMMMMWWYWWMM',
      'RRMMMMMWWWWWMM',
      'RMMMMMMMWWWMMM',
      'RMMMMMMMMMMMMR',
      'RRMMMMMMMMMMRR',
      '.RRMMMMYMYMYMY',
      '..RRMMMMMMMMMM',
      '...RRRMMMMMMMM',
      '.RR..RRRRRRRRR',
      'RR....RR....RR',
      'R.....R.....R.',
    ]) },

    // ---- Halloween set: same keys with an h_ prefix ----
    h_player: { scale: 3, rows: [
      '.....N.....',
      '....NLN....',
      '....NLN....',
      '...NNLNN...',
      '.V.OOOOO.V.',
      '.VOOKOKOOV.',
      'VOOOOOOOOOV',
      'OO.OOOOO.OO',
      'O...V.V...O',
    ] },
    h_grunt: { scale: 3, rows: [   // ghoul
      '...ZZZZZ...',
      '..ZZZZZZZ..',
      '..ZRZZZRZ..',
      '..ZZZZZZZ..',
      '..ZKWKWKZ..',
      '...ZZZZZ...',
      '.AAAAAAAAA.',
      'Z.AAAAAAA.Z',
      'Z..AA.AA..Z',
      '...A...A...',
    ] },
    h_grunt2: { scale: 3, rows: [
      '...ZZZZZ...',
      '..ZZZZZZZ..',
      '..ZRZZZRZ..',
      '..ZZZZZZZ..',
      '..ZKWKWKZ..',
      '...ZZZZZ...',
      'ZAAAAAAAAAZ',
      '..AAAAAAA..',
      '...AA.AA...',
      '..A.....A..',
    ] },
    h_swooper: { scale: 3, rows: [ // bat
      'V.........V',
      'VV..V.V..VV',
      'VVVVVVVVVVV',
      '.VVVRVRVVV.',
      '...VVVVV...',
      '....V.V....',
    ] },
    h_shooter: { scale: 3, rows: [ // warlock
      '.....V.....',
      '....VVV....',
      '...VVVVV...',
      '..VVKKKVV..',
      '..VKLKLKV..',
      '..VVKKKVV..',
      '.VVVVVVVVV.',
      'LVVVVVVVVVL',
      '.VVVVVVVVV.',
      '.VV.VVV.VV.',
    ] },
    h_tank: { scale: 3, rows: [    // troll
      '...TTTTTTT...',
      '..TTTTTTTTT..',
      '..TTRTTTRTT..',
      '..TTTTTTTTT..',
      '..TTWTTTWTT..',
      '.TTTTTTTTTTT.',
      'TTTAAAAAAATTT',
      'TT.AAAAAAA.TT',
      'T..TTT.TTT..T',
      '...TT...TT...',
    ] },
    h_diver: { scale: 3, rows: [   // vampire
      'V....K....V',
      'VV..KKK..VV',
      'VVV.SSS.VVV',
      'VVVVRSRVVVV',
      '.VVVSWSVVV.',
      '..VVDDDVV..',
      '...VVDVV...',
      '....VVV....',
      '.....V.....',
    ] },
    h_splitter: { scale: 3, rows: [ // spider
      'V.V.....V.V',
      '.V.V...V.V.',
      '..VVEEEVV..',
      'VVVEEEEEVVV',
      '...ERERE...',
      'VVVEEEEEVVV',
      '..VVEEEVV..',
      '.V.V...V.V.',
      'V.V.....V.V',
    ] },
    h_mini: { scale: 3, rows: [    // baby spider
      'V.V.V.V',
      '.VEEEV.',
      'VEREREV',
      '.VEEEV.',
      'V.V.V.V',
    ] },
    h_minelayer: { scale: 3, rows: [ // witch on a broom
      '......V........',
      '.....VVV.......',
      '...VVVVVVV.....',
      '......SS.......',
      '.....VVVV......',
      'NNNNNVVVVOOOYYY',
      '.....V..V......',
    ] },
    h_mine: { scale: 3, rows: [    // bubbling cauldron
      '.L.L.L.',
      '..LLL..',
      'AAAAAAA',
      '.AAAAA.',
      '.AAAAA.',
      '..AAA..',
      '.A...A.',
    ] },
    h_phantom: { scale: 3, rows: [ // ghost
      '...WWWWW...',
      '..WWWWWWW..',
      '.WWWWWWWWW.',
      '.WKKWWWKKW.',
      '.WKKWWWKKW.',
      '.WWWWWWWWW.',
      '.WWWWKWWWW.',
      '.WWWWWWWWW.',
      '.W.WW.WW.W.',
    ] },
    h_necromancer: { scale: 3, rows: [
      'L....EEE.....',
      'LL..EEEEE....',
      'L..EESSSEE...',
      'A..ESRSRSE...',
      'A..EESSSEE...',
      'A.VVVVVVVVV..',
      'AVVVVVVVVVVV.',
      'A.VVVVVVVVV..',
      'A.VVVVVVVVV..',
      'A..VVVVVVV...',
      'A..VV...VV...',
    ] },
    cat: { scale: 3, rows: [       // black cat, facing right
      'J..........',
      'J.......J.J',
      'J.......JJJ',
      '.J.....JYJY',
      '..JJJJJJJJJ',
      '..JJJJJJJJ.',
      '..J.J..J.J.',
    ] },
    cat2: { scale: 3, rows: [
      'J..........',
      'J.......J.J',
      'J.......JJJ',
      '.J.....JYJY',
      '..JJJJJJJJJ',
      '..JJJJJJJJ.',
      '...JJ...JJ.',
    ] },
    h_bonus: { scale: 3, rows: recolor(PUMPKIN, { O: 'Q', Y: 'W' }) }, // golden jack-o'-lantern
    h_boss_final: { scale: 5, rows: mirror([   // Dracula
      'VV..........KK',
      'VVV........KKK',
      'VVVV......KKKK',
      'VVVVV....KKKKK',
      'VVVVVV..KKKSSK',
      'VVVVVVV.KKSSSS',
      'VVVVVVVVKSSRRS',
      'VVVVVVVVKSSRRS',
      '.VVVVVVVKSSSSS',
      '..VVVVVVKSSSSS',
      '...VVVVVVSSKKK',
      '....VVVVVSSKWK',
      '.....VVVVVSSSS',
      '......VVVVVSSS',
      '.......RRRRRRR',
      '........RRRRRR',
    ]) },
    h_boss1: { scale: 5, rows: [   // Pumpkin King
      '.........GG.........',
      '........GG..........',
      '....OOOOOOOOOOOO....',
      '..OOOOOOOOOOOOOOOO..',
      '.OOOYYYOOOOOOYYYOOO.',
      'OOOOYYYYOOOOYYYYOOOO',
      'OOOOOOOOOYYOOOOOOOOO',
      'OOOOOOOOYYYYOOOOOOOO',
      'OOYOOYOOYOOYOOYOOYOO',
      'OOYYYYYYYYYYYYYYYYOO',
      '.OOYYOOYYOOYYOOYYOO.',
      '..OOOOOOOOOOOOOOOO..',
      '....OOOOOOOOOOOO....',
    ] },
    h_boss2: { scale: 5, rows: [   // Spider Queen
      'V..V............V..V',
      '.V..V..........V..V.',
      '..V..V..EEEE..V..V..',
      '...VV.EEEEEEEE.VV...',
      'VVV..EERREERREE..VVV',
      '...VVEEEEEEEEEEVV...',
      '..V..EEEELLEEEE..V..',
      '.V..V.EEEEEEEE.V..V.',
      'V..V...EEEEEE...V..V',
      '......E..EE..E......',
    ] },
    h_boss3: { scale: 5, rows: [   // The Reaper
      '.....EEEEEEEEEE.....',
      '...EEEEEEEEEEEEEE...',
      '..EEEESSSSSSSSEEEE..',
      '.EEESSSSSSSSSSSSEEE.',
      '.EESSSKKKSSKKKSSSEE.',
      'EEESSSKRKSSKRKSSSEEE',
      'EEESSSKKKSSKKKSSSEEE',
      'EEESSSSSSKKSSSSSSEEE',
      '.EEESSSSSSSSSSSSEEE.',
      '..EEESSKSKSKSKSSEEE.',
      '..EEEESSSSSSSSEEEE..',
      '.EEEEEEEEEEEEEEEEEE.',
      'E..E..E..EE..E..E..E',
    ] },
    h_boss4: { scale: 5, rows: mirror([   // Werewolf
      '.F........',
      '.FF.......',
      '.FFF......',
      '.FFFF.FFFF',
      '..FFFFFFFF',
      '..FFFFFFFF',
      '.FFFYYFFFF',
      'FFFFYKFFFF',
      'FFFFFFFFFF',
      '.FFFFFFAAA',
      '..FFFFAAKK',
      '..FFFAKWKW',
      '...FFAKKKK',
      '....FFAAAA',
      '.F...FFFFF',
      'FF....FFFF',
    ]) },
    h_boss5: { scale: 5, rows: mirror([   // Frankenstein's monster
      '...KKKKKKK',
      '..KKKKKKKK',
      '..KKKKKKKK',
      '..ZZZZZZZZ',
      '..ZZZZZKZZ',
      '..ZZZZKZKZ',
      'AAZZKKKZZZ',
      'AAZZWYZZZZ',
      '..ZZZZZZZZ',
      '..ZZZZZZZZ',
      '..ZZKKKKKK',
      '..ZZZZZZZZ',
      '...ZZZZZZZ',
      '.EEEEEEEEE',
      'EEEEEEEEEE',
      'EE.EEEEEEE',
    ]) },
  };

  // Classic versions of the newer bosses: an alpha prowler and a stone golem
  ART.boss4 = { scale: 5, rows: recolor(ART.h_boss4.rows, { F: 'P', A: 'M' }) };
  ART.boss5 = { scale: 5, rows: recolor(ART.h_boss5.rows, { Z: 'M', K: 'F', E: 'A', A: 'C' }) };

  // Halloween ship classes are recolors of the classic hulls
  const PUMPKIN_SHIP = { W: 'O', C: 'L', B: 'K', R: 'V', Y: 'N' };
  for (const key of ['player_mk2', 'player_mk3']) {
    ART['h_' + key] = { scale: 3, rows: recolor(ART[key].rows, PUMPKIN_SHIP) };
  }

  const cache = {};

  function make({ rows, scale }) {
    const h = rows.length;
    const w = Math.max(...rows.map(r => r.length));
    const img = document.createElement('canvas');
    const flash = document.createElement('canvas');
    const gold = document.createElement('canvas');
    const revive = document.createElement('canvas');
    const repair = document.createElement('canvas');
    img.width = flash.width = gold.width = revive.width = repair.width = w * scale;
    img.height = flash.height = gold.height = revive.height = repair.height = h * scale;
    const ic = img.getContext('2d');
    const fc = flash.getContext('2d');
    const gc = gold.getContext('2d');
    const rc = revive.getContext('2d');
    const pc = repair.getContext('2d');
    fc.fillStyle = '#ffffff';
    gc.fillStyle = '#ffcc00';
    rc.fillStyle = '#66ff66';
    pc.fillStyle = '#33ffff';
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < rows[y].length; x++) {
        const ch = rows[y][x];
        if (ch === '.') continue;
        ic.fillStyle = COLORS[ch] || '#ff00ff';
        ic.fillRect(x * scale, y * scale, scale, scale);
        fc.fillRect(x * scale, y * scale, scale, scale);
        gc.fillRect(x * scale, y * scale, scale, scale);
        rc.fillRect(x * scale, y * scale, scale, scale);
        pc.fillRect(x * scale, y * scale, scale, scale);
      }
    }
    return { img, flash, gold, revive, repair, w: img.width, h: img.height };
  }

  function init() {
    for (const key in ART) cache[key] = make(ART[key]);
  }

  // Themed lookup: prefer the current theme's variant, fall back to classic
  return { init, get: key => cache[Theme.prefix + key] || cache[key] };
})();
