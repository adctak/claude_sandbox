(() => {
  'use strict';

  const INSPECT = /[?&](debug|inspect)/.test(location.search);

  // ---------- Canvas ----------
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  let W = 0, H = 0;
  const DPR = Math.min(window.devicePixelRatio || 1, 2);
  const COLW = 2; // screen pixels per ray column

  function resize() {
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = W * DPR;
    canvas.height = H * DPR;
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.imageSmoothingEnabled = false;
  }
  window.addEventListener('resize', resize);
  resize();

  // ---------- Audio ----------
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  const actx = new AudioCtx();
  let audioReady = false;
  function resumeAudio() {
    if (actx.state === 'suspended') actx.resume();
    audioReady = true;
  }
  function beep({ freq = 440, dur = 0.08, type = 'sine', gain = 0.08, slide = 0, delay = 0 }) {
    if (!audioReady) return;
    const t0 = actx.currentTime + delay;
    const osc = actx.createOscillator();
    const g = actx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t0 + dur);
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(actx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }
  function noiseBurst({ dur = 0.2, gain = 0.12, delay = 0, filterFreq = 1200 }) {
    if (!audioReady) return;
    const t0 = actx.currentTime + delay;
    const n = Math.floor(actx.sampleRate * dur);
    const buffer = actx.createBuffer(1, n, actx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < n; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = actx.createBufferSource();
    src.buffer = buffer;
    const filter = actx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(filterFreq, t0);
    filter.frequency.exponentialRampToValueAtTime(80, t0 + dur);
    const g = actx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filter).connect(g).connect(actx.destination);
    src.start(t0);
  }
  const SFX = {
    step: () => noiseBurst({ dur: 0.06, gain: 0.05, filterFreq: 500 }),
    pick: () => { beep({ freq: 1400, dur: 0.05, type: 'square', gain: 0.04, slide: -700 }); noiseBurst({ dur: 0.07, gain: 0.07, filterFreq: 2500 }); },
    breakRock: () => { noiseBurst({ dur: 0.35, gain: 0.18, filterFreq: 900 }); beep({ freq: 90, dur: 0.25, type: 'sawtooth', gain: 0.08, slide: -40 }); },
    ore: (tier) => {
      const base = 520 + tier * 90;
      beep({ freq: base, dur: 0.1, type: 'triangle', gain: 0.1 });
      beep({ freq: base * 1.26, dur: 0.1, type: 'triangle', gain: 0.1, delay: 0.08 });
      beep({ freq: base * 1.5, dur: 0.22, type: 'triangle', gain: 0.1, delay: 0.16 });
    },
    oil: () => { beep({ freq: 300, dur: 0.12, type: 'sine', gain: 0.1, slide: 300 }); beep({ freq: 500, dur: 0.14, type: 'sine', gain: 0.08, slide: 250, delay: 0.1 }); },
    descend: () => { noiseBurst({ dur: 1.0, gain: 0.2, filterFreq: 300 }); beep({ freq: 120, dur: 0.9, type: 'sine', gain: 0.12, slide: -70 }); },
    drip: () => beep({ freq: 1200 + Math.random() * 700, dur: 0.12, type: 'sine', gain: 0.025, slide: -700 }),
    craft: (isGood) => {
      beep({ freq: 880, dur: 0.05, type: 'square', gain: 0.05 });
      beep({ freq: 1100, dur: 0.05, type: 'square', gain: 0.05, delay: 0.07 });
      beep({ freq: isGood ? 1320 : 990, dur: 0.18, type: 'triangle', gain: 0.09, delay: 0.14 });
    },
    deny: () => beep({ freq: 150, dur: 0.08, type: 'square', gain: 0.05 }),
    heartbeat: () => { beep({ freq: 60, dur: 0.1, type: 'sine', gain: 0.18 }); beep({ freq: 55, dur: 0.1, type: 'sine', gain: 0.14, delay: 0.16 }); },
    gameover: () => { beep({ freq: 260, dur: 0.6, type: 'sawtooth', gain: 0.1, slide: -200 }); beep({ freq: 180, dur: 0.9, type: 'sawtooth', gain: 0.1, slide: -120, delay: 0.3 }); },
  };

  // ---------- Utility ----------
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  function mulberry32(seed) {
    return function () {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  // ---------- Ore catalogue ----------
  // cell codes: 0 floor, 1 rock, 2 bedrock, 10+ ore
  const FLOOR = 0, ROCK = 1, BEDROCK = 2, ORE_BASE = 10;
  const ORES = [
    { key: 'copper',  name: '銅',     color: [224, 128, 72],  value: 5,   hard: 0.9, glow: 0,    tier: 0 },
    { key: 'iron',    name: '鉄',     color: [196, 200, 214], value: 10,  hard: 1.1, glow: 0,    tier: 1 },
    { key: 'gold',    name: '金',     color: [255, 208, 64],  value: 25,  hard: 1.3, glow: 0.18, tier: 2 },
    { key: 'crystal', name: '水晶',   color: [120, 230, 255], value: 60,  hard: 1.6, glow: 0.55, tier: 3 },
    { key: 'ruby',    name: 'ルビー', color: [255, 60, 110],  value: 120, hard: 2.0, glow: 0.6,  tier: 4 },
  ];
  const ROCK_HARD = 1.2;

  function oreWeights(depth) {
    return [
      Math.max(0.5, 10 - depth * 1.5),
      Math.min(9, 5 + depth * 0.6),
      depth >= 2 ? 2 + depth * 0.8 : 0.4,
      depth >= 3 ? depth * 0.7 : 0,
      depth >= 5 ? (depth - 4) * 0.7 : 0,
    ];
  }
  function pickOre(depth) {
    const w = oreWeights(depth);
    let total = w.reduce((a, b) => a + b, 0);
    let r = Math.random() * total;
    for (let i = 0; i < w.length; i++) { r -= w[i]; if (r <= 0) return i; }
    return 0;
  }

  // ---------- Crafting recipes ----------
  // kind 'good': sellable item worth more than its ingredients (counts toward assets)
  // kind 'tool': permanent upgrade (ingredients are consumed, so assets drop in exchange for capability)
  // kind 'use':  consumed immediately for an effect
  const ORE_INDEX = Object.fromEntries(ORES.map((o, i) => [o.key, i]));
  const RECIPES = [
    { id: 'wire',        kind: 'good', name: '銅線',             icon: '〰', in: { copper: 3 },                        value: 22,  desc: '細く引き延ばした銅線' },
    { id: 'ingot',       kind: 'good', name: '鉄インゴット',     icon: '▬', in: { iron: 3 },                          value: 42,  desc: '精錬して不純物を除いた鉄塊' },
    { id: 'ring',        kind: 'good', name: '金の指輪',         icon: '◯', in: { gold: 2, copper: 1 },               value: 75,  desc: '銅を芯に金で仕上げた指輪' },
    { id: 'lens',        kind: 'good', name: '水晶レンズ',       icon: '◐', in: { crystal: 2 },                       value: 160, desc: '光学機器用に磨き上げたレンズ' },
    { id: 'necklace',    kind: 'good', name: 'ルビーの首飾り',   icon: '❦', in: { ruby: 1, gold: 2, crystal: 1 },     value: 340, desc: '金細工に宝石をあしらった逸品' },
    { id: 'crown',       kind: 'good', name: '宝冠',             icon: '♛', in: { gold: 4, ruby: 2, crystal: 2 },     value: 900, desc: '深層の宝をすべて注ぎ込んだ至宝' },
    { id: 'ironpick',    kind: 'tool', name: '鉄のツルハシ',     icon: '⛏', in: { iron: 3, copper: 2 },               effect: '採掘速度 ×1.6' },
    { id: 'crystalpick', kind: 'tool', name: '水晶のツルハシ',   icon: '⛏', in: { crystal: 2, iron: 3 },  requires: 'ironpick', effect: '採掘速度 ×2.4（鉄のツルハシが必要）' },
    { id: 'reflector',   kind: 'tool', name: '反射板付きランタン', icon: '☀', in: { copper: 2, crystal: 1 },           effect: '照らせる範囲 +30%' },
    { id: 'fuelcan',     kind: 'use',  name: '携帯燃料',         icon: '⛽', in: { copper: 2, iron: 1 },               effect: 'その場で燃料 +30' },
    { id: 'compass',     kind: 'use',  name: '探鉱コンパス',     icon: '✦', in: { gold: 1, iron: 2 },                 effect: 'この層の縦穴の位置を地図に表示' },
  ];
  function ingredientValue(r) {
    return Object.entries(r.in).reduce((s, [k, n]) => s + ORES[ORE_INDEX[k]].value * n, 0);
  }

  // ---------- Procedural textures ----------
  const TEX = 64;
  function valueNoise(rng, cells) {
    const lattice = [];
    for (let i = 0; i < (cells + 1) * (cells + 1); i++) lattice.push(rng());
    return (x, y) => {
      const fx = (x / TEX) * cells, fy = (y / TEX) * cells;
      const x0 = Math.floor(fx), y0 = Math.floor(fy);
      const tx = fx - x0, ty = fy - y0;
      const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
      const idx = (xx, yy) => lattice[(yy % (cells + 1)) * (cells + 1) + (xx % (cells + 1))];
      const a = idx(x0, y0), b = idx(x0 + 1, y0), c = idx(x0, y0 + 1), d = idx(x0 + 1, y0 + 1);
      return (a * (1 - sx) + b * sx) * (1 - sy) + (c * (1 - sx) + d * sx) * sy;
    };
  }
  function makeCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }
  function makeRockTexture(seed, base, contrast) {
    const rng = mulberry32(seed);
    const n1 = valueNoise(rng, 4), n2 = valueNoise(rng, 12);
    const c = makeCanvas(TEX, TEX);
    const g = c.getContext('2d');
    const img = g.createImageData(TEX, TEX);
    for (let y = 0; y < TEX; y++) {
      for (let x = 0; x < TEX; x++) {
        let v = n1(x, y) * 0.6 + n2(x, y) * 0.4;
        const crack = Math.abs(n2(x * 1.7 % TEX, y) - 0.5) < 0.025 ? 0.55 : 1;
        v = (0.55 + v * contrast) * crack * (0.92 + rng() * 0.16);
        const i = (y * TEX + x) * 4;
        img.data[i] = base[0] * v;
        img.data[i + 1] = base[1] * v;
        img.data[i + 2] = base[2] * v;
        img.data[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    return c;
  }
  function makeOreTextures(rockTex, ore, seed) {
    const rng = mulberry32(seed);
    const full = makeCanvas(TEX, TEX);
    const g = full.getContext('2d');
    g.drawImage(rockTex, 0, 0);
    const glow = makeCanvas(TEX, TEX);
    const gg = glow.getContext('2d');
    const [r, gr, b] = ore.color;
    const clusters = 7 + Math.floor(rng() * 4);
    for (let k = 0; k < clusters; k++) {
      const cx = 6 + rng() * (TEX - 12), cy = 6 + rng() * (TEX - 12);
      const blobs = 3 + Math.floor(rng() * 4);
      for (let j = 0; j < blobs; j++) {
        const bx = cx + (rng() - 0.5) * 8, by = cy + (rng() - 0.5) * 8;
        const rad = 1.5 + rng() * 2.5;
        for (const ctx2 of [g, gg]) {
          ctx2.fillStyle = `rgb(${r * 0.55},${gr * 0.55},${b * 0.55})`;
          ctx2.beginPath(); ctx2.arc(bx, by, rad + 0.8, 0, Math.PI * 2); ctx2.fill();
          ctx2.fillStyle = `rgb(${r},${gr},${b})`;
          ctx2.beginPath(); ctx2.arc(bx, by, rad, 0, Math.PI * 2); ctx2.fill();
          ctx2.fillStyle = 'rgba(255,255,255,0.85)';
          ctx2.fillRect(Math.round(bx - rad * 0.4), Math.round(by - rad * 0.4), 1, 1);
        }
      }
    }
    return { full, glow };
  }

  const rockTex = makeRockTexture(1234, [118, 96, 78], 0.75);
  const bedrockTex = makeRockTexture(987, [58, 54, 62], 0.4);
  const oreTex = ORES.map((o, i) => makeOreTextures(rockTex, o, 500 + i * 77));

  function makeOilSprite() {
    const c = makeCanvas(64, 64);
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(32, 40, 2, 32, 40, 30);
    grad.addColorStop(0, 'rgba(255,190,90,0.55)');
    grad.addColorStop(1, 'rgba(255,190,90,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    g.fillStyle = '#5a3a1a';
    g.fillRect(27, 18, 10, 7);
    g.fillStyle = '#c98a2e';
    g.beginPath();
    g.moveTo(24, 26); g.lineTo(40, 26); g.lineTo(46, 38); g.lineTo(46, 60); g.lineTo(18, 60); g.lineTo(18, 38);
    g.closePath(); g.fill();
    g.fillStyle = '#ffcf6a';
    g.fillRect(22, 44, 20, 13);
    g.fillStyle = 'rgba(255,255,255,0.5)';
    g.fillRect(21, 36, 3, 18);
    return c;
  }
  function makeShaftSprite() {
    const c = makeCanvas(64, 64);
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(32, 52, 2, 32, 52, 34);
    grad.addColorStop(0, 'rgba(140,210,255,0.75)');
    grad.addColorStop(0.5, 'rgba(90,160,255,0.25)');
    grad.addColorStop(1, 'rgba(90,160,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    g.fillStyle = '#000';
    g.beginPath(); g.ellipse(32, 56, 24, 7, 0, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#9fdcff';
    g.lineWidth = 2;
    g.beginPath(); g.ellipse(32, 56, 24, 7, 0, 0, Math.PI * 2); g.stroke();
    g.strokeStyle = '#8a6a3a';
    g.lineWidth = 3;
    g.beginPath(); g.moveTo(24, 20); g.lineTo(24, 56); g.moveTo(40, 20); g.lineTo(40, 56); g.stroke();
    g.lineWidth = 2;
    for (let y = 26; y < 56; y += 8) { g.beginPath(); g.moveTo(24, y); g.lineTo(40, y); g.stroke(); }
    return c;
  }
  const oilSprite = makeOilSprite();
  const shaftSprite = makeShaftSprite();

  // ---------- Level generation ----------
  const level = { w: 0, h: 0, grid: null, explored: null, oils: [], shaft: { x: 0, y: 0 }, start: { x: 0, y: 0 }, glowSeed: null };

  function idx(x, y) { return y * level.w + x; }
  function cellAt(x, y) {
    if (x < 0 || y < 0 || x >= level.w || y >= level.h) return BEDROCK;
    return level.grid[idx(x, y)];
  }

  function generateLevel(depth) {
    for (let attempt = 0; attempt < 30; attempt++) {
      const w = Math.min(64, 34 + depth * 4), h = w;
      let g = new Uint8Array(w * h);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const border = x === 0 || y === 0 || x === w - 1 || y === h - 1;
        g[y * w + x] = border ? BEDROCK : (Math.random() < 0.46 ? ROCK : FLOOR);
      }
      for (let it = 0; it < 5; it++) {
        const ng = new Uint8Array(g);
        for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
          let walls = 0;
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (g[(y + dy) * w + x + dx] !== FLOOR) walls++;
          ng[y * w + x] = walls >= 5 ? ROCK : FLOOR;
        }
        g = ng;
      }

      // keep only the largest connected open region
      const region = new Int32Array(w * h).fill(-1);
      let best = -1, bestSize = 0, rid = 0;
      for (let i = 0; i < w * h; i++) {
        if (g[i] !== FLOOR || region[i] !== -1) continue;
        let size = 0;
        const q = [i];
        region[i] = rid;
        while (q.length) {
          const c = q.pop(); size++;
          const cx = c % w, cy = (c / w) | 0;
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nx = cx + dx, ny = cy + dy, ni = ny * w + nx;
            if (g[ni] === FLOOR && region[ni] === -1) { region[ni] = rid; q.push(ni); }
          }
        }
        if (size > bestSize) { bestSize = size; best = rid; }
        rid++;
      }
      if (bestSize < w * h * 0.28) continue;
      for (let i = 0; i < w * h; i++) if (g[i] === FLOOR && region[i] !== best) g[i] = ROCK;

      const floorCells = [];
      for (let i = 0; i < w * h; i++) if (g[i] === FLOOR) floorCells.push(i);
      // prefer a start cell with open space around it
      let startI = floorCells[Math.floor(Math.random() * floorCells.length)];
      for (let tries = 0; tries < 60; tries++) {
        const c = floorCells[Math.floor(Math.random() * floorCells.length)];
        const cx = c % w, cy = (c / w) | 0;
        let open = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (g[(cy + dy) * w + cx + dx] === FLOOR) open++;
        if (open >= 8) { startI = c; break; }
      }

      // BFS distance from start → shaft at the farthest reachable point
      const dist = new Int32Array(w * h).fill(-1);
      dist[startI] = 0;
      const q = [startI];
      let head = 0, far = startI;
      while (head < q.length) {
        const c = q[head++];
        if (dist[c] > dist[far]) far = c;
        const cx = c % w, cy = (c / w) | 0;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const ni = (cy + dy) * w + cx + dx;
          if (g[ni] === FLOOR && dist[ni] === -1) { dist[ni] = dist[c] + 1; q.push(ni); }
        }
      }

      // ore veins: mostly in walls facing open space, a few hidden deeper inside rock
      const exposedChance = Math.min(0.13, 0.075 + depth * 0.005);
      for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        if (g[i] !== ROCK) continue;
        const exposed = g[i - 1] === FLOOR || g[i + 1] === FLOOR || g[i - w] === FLOOR || g[i + w] === FLOOR;
        if (Math.random() < (exposed ? exposedChance : 0.025)) g[i] = ORE_BASE + pickOre(depth);
      }

      const oils = [];
      const oilCount = 3 + Math.floor(Math.random() * 2) + (depth > 3 ? 1 : 0);
      const candidates = floorCells.filter(c => dist[c] >= 6 && c !== far);
      for (let k = 0; k < oilCount && candidates.length; k++) {
        for (let tries = 0; tries < 40; tries++) {
          const c = candidates[Math.floor(Math.random() * candidates.length)];
          const ox = c % w + 0.5, oy = ((c / w) | 0) + 0.5;
          if (oils.every(o => Math.hypot(o.x - ox, o.y - oy) > 6)) { oils.push({ x: ox, y: oy }); break; }
        }
      }

      level.w = w; level.h = h; level.grid = g;
      level.explored = new Uint8Array(w * h);
      level.oils = oils;
      level.shaft = { x: far % w + 0.5, y: ((far / w) | 0) + 0.5 };
      level.start = { x: startI % w + 0.5, y: ((startI / w) | 0) + 0.5 };
      level.shaftDist = dist[far];
      return;
    }
    throw new Error('cave generation failed');
  }

  // ---------- Player ----------
  const player = { x: 0, y: 0, a: 0, bob: 0, moving: false };
  const MOVE_SPEED = 2.6, TURN_SPEED = 2.4, RADIUS = 0.22, FOV_PLANE = 0.66;

  function isSolid(x, y) { return cellAt(Math.floor(x), Math.floor(y)) !== FLOOR; }

  function tryMove(dx, dy) {
    const nx = player.x + dx, ny = player.y + dy;
    const r = Math.sign(dx) * RADIUS;
    if (!isSolid(nx + r, player.y - RADIUS * 0.7) && !isSolid(nx + r, player.y + RADIUS * 0.7)) player.x = nx;
    const r2 = Math.sign(dy) * RADIUS;
    if (!isSolid(player.x - RADIUS * 0.7, ny + r2) && !isSolid(player.x + RADIUS * 0.7, ny + r2)) player.y = ny;
  }

  // ---------- Input ----------
  const keys = {};
  let mouseMining = false;
  let bigMap = false;
  window.addEventListener('keydown', e => {
    keys[e.code] = true;
    if (['Space', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Tab'].includes(e.code)) e.preventDefault();
    if (state !== 'playing') return;
    if (e.code === 'KeyC' || e.code === 'Tab') { paused ? closeCraft() : openCraft(); return; }
    if (e.code === 'Escape' && paused) { closeCraft(); return; }
    if (paused && /^Digit[1-9]$/.test(e.code)) {
      const r = RECIPES[Number(e.code.slice(5)) - 1];
      if (r) craft(r.id);
      return;
    }
    if (e.code === 'KeyM') bigMap = !bigMap;
  });
  window.addEventListener('keyup', e => { keys[e.code] = false; });
  canvas.addEventListener('mousedown', e => {
    if (state !== 'playing' || paused) return;
    if (e.button === 0) mouseMining = true;
    if (document.pointerLockElement !== canvas && canvas.requestPointerLock) {
      try { canvas.requestPointerLock(); } catch (_) { /* pointer lock unavailable — arrow keys still turn */ }
    }
  });
  window.addEventListener('mouseup', e => { if (e.button === 0) mouseMining = false; });
  window.addEventListener('mousemove', e => {
    if (state === 'playing' && document.pointerLockElement === canvas) player.a += e.movementX * 0.0026;
  });

  // ---------- Game state ----------
  let state = 'start';
  let depth = 1;
  let fuel = 100;
  let inventory = ORES.map(() => 0);
  let goods = {};   // crafted sellable items: id -> count
  let tools = {};   // permanent upgrades: id -> true
  let paused = false;
  let elapsed = 0;
  let mining = { cell: -1, progress: 0, tickT: 0 };
  let particles = [];
  let floaters = [];
  let stepT = 0, dripT = 3, beatT = 0;
  let fadeIn = 0;
  let deathT = -1;
  let lastTime = performance.now();
  const zbuf = new Float32Array(4096);
  let target = null; // { cell, x, y, dist }

  const FUEL_DRAIN = 1.1;

  function lightRadius() { return (2.3 + 7.7 * (fuel / 100)) * (tools.reflector ? 1.3 : 1); }
  function pickSpeed() { return tools.crystalpick ? 2.4 : tools.ironpick ? 1.6 : 1; }

  function assetValue() {
    let v = 0;
    ORES.forEach((o, i) => { v += inventory[i] * o.value; });
    for (const r of RECIPES) if (r.kind === 'good') v += (goods[r.id] || 0) * r.value;
    return v;
  }

  // ---------- Crafting ----------
  function craftBlockReason(r) {
    for (const [k, n] of Object.entries(r.in)) if (inventory[ORE_INDEX[k]] < n) return '素材不足';
    if (r.kind === 'tool' && tools[r.id]) return '所持済み';
    if (r.requires && !tools[r.requires]) return '前提の道具が必要';
    if (r.id === 'fuelcan' && fuel >= 90) return '燃料は十分';
    if (r.id === 'compass' && level.explored[idx(Math.floor(level.shaft.x), Math.floor(level.shaft.y))]) return '縦穴は発見済み';
    return null;
  }

  function craft(id) {
    const r = RECIPES.find(x => x.id === id);
    if (!r || craftBlockReason(r)) { SFX.deny(); return false; }
    for (const [k, n] of Object.entries(r.in)) inventory[ORE_INDEX[k]] -= n;
    if (r.kind === 'good') {
      goods[r.id] = (goods[r.id] || 0) + 1;
      SFX.craft(true);
      spawnFloater(`${r.name}を製作！ 付加価値 +¥${r.value - ingredientValue(r)}`, '#ffd166');
    } else if (r.kind === 'tool') {
      tools[r.id] = true;
      SFX.craft(false);
      spawnFloater(`${r.name}を製作 — ${r.effect}`, '#9fdcff');
    } else if (r.id === 'fuelcan') {
      fuel = Math.min(100, fuel + 30);
      SFX.oil();
      spawnFloater('携帯燃料を使った — 燃料 +30', '#ffc861');
    } else if (r.id === 'compass') {
      level.explored[idx(Math.floor(level.shaft.x), Math.floor(level.shaft.y))] = 1;
      SFX.craft(false);
      spawnFloater('探鉱コンパスが縦穴を指した — 地図を確認', '#9fdcff');
    }
    updateInventoryUI();
    renderCraftPanel();
    return true;
  }

  function oreChip(key, need) {
    const o = ORES[ORE_INDEX[key]];
    const have = inventory[ORE_INDEX[key]];
    const ok = have >= need;
    return `<span class="ing ${ok ? 'ok' : 'short'}"><span class="ore-dot" style="background:rgb(${o.color.join(',')})"></span>${o.name} ${have}/${need}</span>`;
  }

  function renderCraftPanel() {
    const list = document.getElementById('recipeList');
    if (!list) return;
    const sections = [
      ['good', '工芸品 — 加工して価値を高める'],
      ['tool', '道具 — 鉱石を消費して探索力を上げる'],
      ['use', '消耗品 — その場で使う'],
    ];
    let html = '';
    let n = 0;
    for (const [kind, title] of sections) {
      html += `<div class="recipe-section">${title}</div>`;
      for (const r of RECIPES.filter(x => x.kind === kind)) {
        n += 1;
        const reason = craftBlockReason(r);
        const ings = Object.entries(r.in).map(([k, c]) => oreChip(k, c)).join('');
        let out;
        if (kind === 'good') {
          const added = r.value - ingredientValue(r);
          out = `<span class="out-value">¥${r.value}</span><span class="out-added">付加価値 +¥${added}</span>${goods[r.id] ? `<span class="owned">所持 ${goods[r.id]}</span>` : ''}`;
        } else {
          out = `<span class="out-effect">${r.effect}</span><span class="out-cost">素材価値 −¥${ingredientValue(r)}</span>`;
        }
        html += `<div class="recipe ${reason ? 'blocked' : ''}">
          <div class="r-icon">${r.icon}</div>
          <div class="r-main">
            <div class="r-name"><span class="r-key">${n <= 9 ? n : ''}</span>${r.name}</div>
            <div class="r-ings">${ings}</div>
          </div>
          <div class="r-out">${out}</div>
          <button class="r-btn" data-id="${r.id}" ${reason ? 'disabled' : ''}>${reason || '作る'}</button>
        </div>`;
      }
    }
    list.innerHTML = html;
    document.getElementById('craftAsset').textContent = `現在の資産 ¥${assetValue()}`;
  }

  function openCraft() {
    if (state !== 'playing' || deathT >= 0) return;
    paused = true;
    mouseMining = false;
    if (document.pointerLockElement === canvas && document.exitPointerLock) document.exitPointerLock();
    renderCraftPanel();
    document.getElementById('craftPanel').classList.remove('hidden');
  }
  function closeCraft() {
    paused = false;
    document.getElementById('craftPanel').classList.add('hidden');
  }

  function spawnFloater(text, color) {
    floaters.push({ text, color, life: 1.8, maxLife: 1.8 });
  }

  function loadBest() {
    try { return JSON.parse(localStorage.getItem('deepdelve-best') || 'null'); } catch (_) { return null; }
  }
  function saveBest(rec) {
    try { localStorage.setItem('deepdelve-best', JSON.stringify(rec)); } catch (_) { /* storage blocked — record is just not kept */ }
  }
  function showBest() {
    const b = loadBest();
    document.getElementById('bestRecord').textContent = b ? `自己ベスト: 地下 ${b.depth} 層 ／ ¥${b.value}` : '';
  }

  function enterLevel() {
    generateLevel(depth);
    player.x = level.start.x; player.y = level.start.y;
    // face the most open direction
    let bestA = 0, bestRun = -1;
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      let run = 0;
      while (run < 12 && !isSolid(player.x + Math.cos(a) * run * 0.5, player.y + Math.sin(a) * run * 0.5)) run++;
      if (run > bestRun) { bestRun = run; bestA = a; }
    }
    player.a = bestA;
    mining = { cell: -1, progress: 0, tickT: 0 };
    fadeIn = 1;
    document.getElementById('depth').textContent = `地下 ${depth} 層`;
  }

  function startGame() {
    depth = 1; fuel = 100; elapsed = 0;
    inventory = ORES.map(() => 0);
    goods = {}; tools = {};
    particles = []; floaters = [];
    deathT = -1; bigMap = false;
    closeCraft();
    enterLevel();
    spawnFloater('地下 1 層 — 奥へ進め', '#9fdcff');
    state = 'playing';
    document.getElementById('startScreen').classList.add('hidden');
    document.getElementById('gameOverScreen').classList.add('hidden');
    updateInventoryUI();
  }

  function descend() {
    depth += 1;
    fuel = Math.min(100, fuel + 12);
    SFX.descend();
    enterLevel();
    spawnFloater(`地下 ${depth} 層へ（燃料 +12）`, '#9fdcff');
  }

  function endGame() {
    state = 'ended';
    if (document.pointerLockElement === canvas && document.exitPointerLock) document.exitPointerLock();
    SFX.gameover();
    const value = assetValue();
    const oreOnly = ORES.reduce((s, o, i) => s + inventory[i] * o.value, 0);
    const goodsValue = value - oreOnly;
    const best = loadBest();
    const isBest = !best || value > best.value || (value === best.value && depth > best.depth);
    if (isBest) saveBest({ depth, value });
    document.getElementById('resultBody').textContent =
      `ランタンの灯が消えた。\n到達: 地下 ${depth} 層　総資産: ¥${value}${isBest ? '　— 自己ベスト更新！' : ''}\n（鉱石 ¥${oreOnly} ＋ 工芸品 ¥${goodsValue}）`;
    const inv = document.getElementById('resultInv');
    inv.innerHTML = '';
    ORES.forEach((o, i) => {
      const chip = document.createElement('div');
      chip.className = 'ore-chip';
      chip.innerHTML = `<span class="ore-dot" style="background:rgb(${o.color.join(',')});box-shadow:0 0 6px rgb(${o.color.join(',')})"></span>${o.name} × ${inventory[i]}`;
      inv.appendChild(chip);
    });
    for (const r of RECIPES) {
      if (r.kind !== 'good' || !goods[r.id]) continue;
      const chip = document.createElement('div');
      chip.className = 'ore-chip good';
      chip.textContent = `${r.icon} ${r.name} × ${goods[r.id]}（¥${r.value * goods[r.id]}）`;
      inv.appendChild(chip);
    }
    document.getElementById('gameOverScreen').classList.remove('hidden');
    showBest();
  }

  function updateInventoryUI() {
    const el = document.getElementById('inventory');
    el.innerHTML = '';
    ORES.forEach((o, i) => {
      if (!inventory[i]) return;
      const chip = document.createElement('div');
      chip.className = 'ore-chip';
      chip.innerHTML = `<span class="ore-dot" style="background:rgb(${o.color.join(',')});box-shadow:0 0 6px rgb(${o.color.join(',')})"></span>${o.name} ${inventory[i]}`;
      el.appendChild(chip);
    });
    for (const r of RECIPES) {
      if (r.kind === 'good' && goods[r.id]) {
        const chip = document.createElement('div');
        chip.className = 'ore-chip good';
        chip.textContent = `${r.icon} ${r.name} ${goods[r.id]}`;
        el.appendChild(chip);
      }
      if (r.kind === 'tool' && tools[r.id]) {
        const chip = document.createElement('div');
        chip.className = 'ore-chip tool';
        chip.textContent = `${r.icon} ${r.name}`;
        el.appendChild(chip);
      }
    }
    document.getElementById('value').textContent = `資産 ¥${assetValue()}`;
  }

  // ---------- Update ----------
  function updatePlayer(dt) {
    if (keys.ArrowLeft) player.a -= TURN_SPEED * dt;
    if (keys.ArrowRight) player.a += TURN_SPEED * dt;
    const fx = Math.cos(player.a), fy = Math.sin(player.a);
    const rx = -fy, ry = fx;
    let mx = 0, my = 0;
    if (keys.KeyW || keys.ArrowUp) { mx += fx; my += fy; }
    if (keys.KeyS || keys.ArrowDown) { mx -= fx; my -= fy; }
    if (keys.KeyD) { mx += rx; my += ry; }
    if (keys.KeyA) { mx -= rx; my -= ry; }
    const len = Math.hypot(mx, my);
    player.moving = len > 0.01;
    if (player.moving) {
      tryMove((mx / len) * MOVE_SPEED * dt, (my / len) * MOVE_SPEED * dt);
      player.bob += dt * 9;
      stepT -= dt;
      if (stepT <= 0) { SFX.step(); stepT = 0.38; }
    }
  }

  function updateMining(dt) {
    const wantMine = keys.KeyE || keys.Space || mouseMining;
    if (!wantMine || !target || target.dist > 1.75 || target.cell === BEDROCK) {
      mining.progress = Math.max(0, mining.progress - dt * 2);
      if (!wantMine) mining.cell = -1;
      return;
    }
    const cellIndex = idx(target.x, target.y);
    if (mining.cell !== cellIndex) { mining.cell = cellIndex; mining.progress = 0; }
    const hard = target.cell >= ORE_BASE ? ORES[target.cell - ORE_BASE].hard : ROCK_HARD;
    mining.progress += dt * pickSpeed() / hard;
    mining.tickT -= dt;
    if (mining.tickT <= 0) { SFX.pick(); mining.tickT = 0.26; spawnDebris(4, [150, 120, 95]); }
    if (mining.progress >= 1) {
      const cell = target.cell;
      level.grid[cellIndex] = FLOOR;
      if (cell >= ORE_BASE) {
        const o = ORES[cell - ORE_BASE];
        inventory[cell - ORE_BASE] += 1;
        SFX.ore(o.tier);
        spawnDebris(22, o.color);
        spawnFloater(`${o.name}を採掘！ +¥${o.value}`, `rgb(${o.color.join(',')})`);
        updateInventoryUI();
      } else {
        SFX.breakRock();
        spawnDebris(14, [120, 100, 82]);
      }
      mining.cell = -1;
      mining.progress = 0;
    }
  }

  function spawnDebris(n, color) {
    for (let i = 0; i < n; i++) {
      particles.push({
        x: W / 2 + rand(-30, 30), y: H / 2 + rand(-20, 20),
        vx: rand(-220, 220), vy: rand(-260, 60),
        life: rand(0.4, 0.9), maxLife: 0.9, size: rand(2, 5), color,
      });
    }
  }

  function updatePickups() {
    for (let i = level.oils.length - 1; i >= 0; i--) {
      const o = level.oils[i];
      if (Math.hypot(o.x - player.x, o.y - player.y) < 0.6) {
        level.oils.splice(i, 1);
        fuel = Math.min(100, fuel + 35);
        SFX.oil();
        spawnFloater('油瓶を拾った — 燃料 +35', '#ffc861');
      }
    }
    if (Math.hypot(level.shaft.x - player.x, level.shaft.y - player.y) < 0.55) descend();
  }

  function markExploredAround() {
    const r = Math.max(1.5, lightRadius() * 0.7);
    const px = Math.floor(player.x), py = Math.floor(player.y);
    const ri = Math.ceil(r);
    for (let dy = -ri; dy <= ri; dy++) for (let dx = -ri; dx <= ri; dx++) {
      const x = px + dx, y = py + dy;
      if (x < 0 || y < 0 || x >= level.w || y >= level.h) continue;
      if (dx * dx + dy * dy <= r * r) level.explored[idx(x, y)] = 1;
    }
  }

  // ---------- Rendering ----------
  function renderWorld(t) {
    const lightR = lightRadius();
    const flicker = 1 + Math.sin(t * 13) * 0.025 + Math.sin(t * 29) * 0.02 + (fuel < 25 ? (Math.random() - 0.5) * 0.12 : 0);
    const bobY = player.moving ? Math.sin(player.bob) * 4 : 0;
    const horizon = H / 2 + bobY;

    // ceiling & floor: lantern-lit near the camera, fading to black at the horizon
    const warm = clamp(lightR / 8.3, 0, 1) * flicker;
    let grad = ctx.createLinearGradient(0, 0, 0, horizon);
    grad.addColorStop(0, `rgb(${46 * warm},${34 * warm},${26 * warm})`);
    grad.addColorStop(1, '#000');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, horizon);
    grad = ctx.createLinearGradient(0, horizon, 0, H);
    grad.addColorStop(0, '#000');
    grad.addColorStop(1, `rgb(${62 * warm},${48 * warm},${34 * warm})`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, horizon, W, H - horizon);

    const dirX = Math.cos(player.a), dirY = Math.sin(player.a);
    const planeX = -dirY * FOV_PLANE, planeY = dirX * FOV_PLANE;
    const cols = Math.ceil(W / COLW);
    target = null;

    for (let c = 0; c < cols; c++) {
      const camX = (2 * (c + 0.5)) / cols - 1;
      const rdx = dirX + planeX * camX, rdy = dirY + planeY * camX;
      let mapX = Math.floor(player.x), mapY = Math.floor(player.y);
      const ddx = rdx === 0 ? 1e30 : Math.abs(1 / rdx);
      const ddy = rdy === 0 ? 1e30 : Math.abs(1 / rdy);
      let stepX, stepY, sdx, sdy;
      if (rdx < 0) { stepX = -1; sdx = (player.x - mapX) * ddx; } else { stepX = 1; sdx = (mapX + 1 - player.x) * ddx; }
      if (rdy < 0) { stepY = -1; sdy = (player.y - mapY) * ddy; } else { stepY = 1; sdy = (mapY + 1 - player.y) * ddy; }
      let side = 0, cell = FLOOR, steps = 0;
      while (steps++ < 200) {
        if (sdx < sdy) { sdx += ddx; mapX += stepX; side = 0; } else { sdy += ddy; mapY += stepY; side = 1; }
        cell = cellAt(mapX, mapY);
        if (cell !== FLOOR) break;
      }
      const perp = Math.max(0.0001, side === 0 ? sdx - ddx : sdy - ddy);
      zbuf[c] = perp;

      let wallX = side === 0 ? player.y + perp * rdy : player.x + perp * rdx;
      wallX -= Math.floor(wallX);
      let texX = Math.floor(wallX * TEX);
      if ((side === 0 && rdx > 0) || (side === 1 && rdy < 0)) texX = TEX - texX - 1;

      const lineH = H / perp;
      const top = horizon - lineH / 2;
      const sx = c * COLW;

      let tex = rockTex;
      if (cell === BEDROCK) tex = bedrockTex;
      else if (cell >= ORE_BASE) tex = oreTex[cell - ORE_BASE].full;
      ctx.drawImage(tex, texX, 0, 1, TEX, sx, top, COLW, lineH);

      // faint ambient keeps nearby cave outlines readable just past the lantern's reach
      let bright = Math.max(Math.pow(clamp(1 - perp / lightR, 0, 1), 1.15) * flicker, 0.07 * clamp(1 - perp / (lightR * 2.2), 0, 1));
      if (side === 1) bright *= 0.78;
      const dark = clamp(1 - bright, 0, 1);
      if (dark > 0.004) {
        ctx.fillStyle = `rgba(0,0,0,${dark})`;
        ctx.fillRect(sx, top, COLW, lineH);
      }

      if (cell >= ORE_BASE) {
        const o = ORES[cell - ORE_BASE];
        if (o.glow > 0 && perp > 0.8) {
          const pulse = 0.75 + 0.25 * Math.sin(t * 2.2 + mapX * 1.7 + mapY * 2.3);
          const glowA = o.glow * pulse * clamp(dark, 0, 1) * clamp(1 - perp / 30, 0.25, 1);
          if (glowA > 0.02) {
            ctx.globalCompositeOperation = 'lighter';
            ctx.globalAlpha = glowA;
            ctx.drawImage(oreTex[cell - ORE_BASE].glow, texX, 0, 1, TEX, sx, top, COLW, lineH);
            ctx.globalAlpha = 1;
            ctx.globalCompositeOperation = 'source-over';
            if (perp < lightR + 6) level.explored[idx(mapX, mapY)] = 1;
          }
        }
      }

      if (perp < lightR + 0.5) level.explored[idx(mapX, mapY)] = 1;
      if (c === (cols >> 1)) target = { cell, x: mapX, y: mapY, dist: perp };
    }

    renderSprites(dirX, dirY, planeX, planeY, horizon, lightR, flicker, t);
  }

  function renderSprites(dirX, dirY, planeX, planeY, horizon, lightR, flicker, t) {
    const sprites = level.oils.map(o => ({ x: o.x, y: o.y, img: oilSprite, scale: 0.42, minB: 0.28, kind: 'oil' }));
    sprites.push({ x: level.shaft.x, y: level.shaft.y, img: shaftSprite, scale: 0.95, minB: 0.3 + 0.1 * Math.sin(t * 3), kind: 'shaft' });
    for (const s of sprites) s.d = (s.x - player.x) ** 2 + (s.y - player.y) ** 2;
    sprites.sort((a, b) => b.d - a.d);

    const invDet = 1 / (planeX * dirY - dirX * planeY);
    const cols = Math.ceil(W / COLW);
    for (const s of sprites) {
      const sx = s.x - player.x, sy = s.y - player.y;
      const tx = invDet * (dirY * sx - dirX * sy);
      const ty = invDet * (-planeY * sx + planeX * sy);
      if (ty <= 0.15) continue;
      const screenX = (W / 2) * (1 + tx / ty);
      const baseH = H / ty;
      const size = baseH * s.scale;
      const floorY = horizon + baseH / 2;
      const drawTop = floorY - size;
      const left = screenX - size / 2;
      const dist = Math.sqrt(s.d);
      const b = Math.max(s.minB, Math.pow(clamp(1 - dist / lightR, 0, 1), 1.25) * flicker);
      if (b < 0.02) continue;
      if (s.kind === 'shaft' && dist < lightR + 8) level.explored[idx(Math.floor(s.x), Math.floor(s.y))] = 1;
      if (s.kind === 'oil' && dist < lightR + 0.5) level.explored[idx(Math.floor(s.x), Math.floor(s.y))] = 1;
      ctx.globalAlpha = clamp(b, 0, 1);
      const c0 = Math.max(0, Math.floor(left / COLW)), c1 = Math.min(cols - 1, Math.floor((left + size) / COLW));
      for (let c = c0; c <= c1; c++) {
        if (ty >= zbuf[c]) continue;
        const u = ((c * COLW - left) / size) * s.img.width;
        if (u < 0 || u >= s.img.width) continue;
        ctx.drawImage(s.img, Math.floor(u), 0, 1, s.img.height, c * COLW, drawTop, COLW, size);
      }
      ctx.globalAlpha = 1;
    }
  }

  function renderOverlay(t, dt) {
    // lantern vignette
    const lightR = lightRadius();
    const vg = ctx.createRadialGradient(W / 2, H * 0.62, H * 0.15, W / 2, H * 0.55, H * (0.55 + lightR * 0.05));
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.72)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);

    // crosshair + mining ring
    const canMine = target && target.dist <= 1.75 && target.cell !== BEDROCK;
    ctx.strokeStyle = canMine ? 'rgba(255,220,160,0.9)' : 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(W / 2 - 7, H / 2); ctx.lineTo(W / 2 + 7, H / 2);
    ctx.moveTo(W / 2, H / 2 - 7); ctx.lineTo(W / 2, H / 2 + 7);
    ctx.stroke();
    if (canMine && target.cell >= ORE_BASE) {
      const o = ORES[target.cell - ORE_BASE];
      ctx.font = 'bold 13px "Noto Sans JP", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = `rgb(${o.color.join(',')})`;
      ctx.fillText(`${o.name}鉱脈 (¥${o.value})`, W / 2, H / 2 + 34);
    }
    if (mining.progress > 0.01) {
      ctx.strokeStyle = 'rgba(0,0,0,0.5)';
      ctx.lineWidth = 5;
      ctx.beginPath(); ctx.arc(W / 2, H / 2, 16, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = '#ffc861';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(W / 2, H / 2, 16, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * clamp(mining.progress, 0, 1)); ctx.stroke();
    }

    drawPickaxe(t);

    // debris
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.vy += 700 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt;
      if (p.life <= 0) { particles.splice(i, 1); continue; }
      ctx.globalAlpha = clamp(p.life / p.maxLife, 0, 1);
      ctx.fillStyle = `rgb(${p.color.join(',')})`;
      ctx.fillRect(p.x, p.y, p.size, p.size);
    }
    ctx.globalAlpha = 1;

    // floaters
    ctx.textAlign = 'center';
    ctx.font = 'bold 18px "Noto Sans JP", sans-serif';
    for (let i = floaters.length - 1; i >= 0; i--) {
      const f = floaters[i];
      f.life -= dt;
      if (f.life <= 0) { floaters.splice(i, 1); continue; }
      const k = floaters.length - 1 - i;
      ctx.globalAlpha = clamp(f.life / 0.5, 0, 1);
      ctx.fillStyle = f.color;
      ctx.shadowColor = f.color;
      ctx.shadowBlur = 10;
      ctx.fillText(f.text, W / 2, H * 0.3 - k * 28);
      ctx.shadowBlur = 0;
    }
    ctx.globalAlpha = 1;

    drawMinimap(t);

    if (fadeIn > 0) {
      ctx.fillStyle = `rgba(0,0,0,${fadeIn})`;
      ctx.fillRect(0, 0, W, H);
    }
    if (deathT >= 0) {
      ctx.fillStyle = `rgba(0,0,0,${clamp(deathT / 1.6, 0, 1)})`;
      ctx.fillRect(0, 0, W, H);
    }
  }

  function drawPickaxe(t) {
    const mineHeld = (keys.KeyE || keys.Space || mouseMining) && mining.progress > 0;
    const swing = mineHeld ? Math.sin(t * 24) * 0.55 : 0;
    const bob = player.moving ? Math.sin(player.bob) * 6 : 0;
    ctx.save();
    ctx.translate(W - 170, H - 40 + bob);
    ctx.rotate(-0.55 + swing);
    ctx.fillStyle = '#6b4a2a';
    ctx.fillRect(-8, -150, 16, 170);
    ctx.fillStyle = tools.crystalpick ? '#8fe6ff' : tools.ironpick ? '#c9ced9' : '#7a746b';
    if (tools.crystalpick) { ctx.shadowColor = '#8fe6ff'; ctx.shadowBlur = 14; }
    ctx.beginPath();
    ctx.moveTo(-70, -150); ctx.quadraticCurveTo(0, -185, 70, -150);
    ctx.lineTo(60, -138); ctx.quadraticCurveTo(0, -165, -60, -138);
    ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(-8, -150, 5, 170);
    ctx.restore();
  }

  function drawMinimap(t) {
    const cell = bigMap ? Math.floor(Math.min(W, H) * 0.8 / level.w) : 3;
    const mw = level.w * cell, mh = level.h * cell;
    const ox = bigMap ? (W - mw) / 2 : W - mw - 14;
    const oy = bigMap ? (H - mh) / 2 : 14;
    ctx.fillStyle = bigMap ? 'rgba(0,0,0,0.85)' : 'rgba(0,0,0,0.55)';
    ctx.fillRect(ox - 4, oy - 4, mw + 8, mh + 8);
    for (let y = 0; y < level.h; y++) for (let x = 0; x < level.w; x++) {
      const i = idx(x, y);
      if (!level.explored[i]) continue;
      const c = level.grid[i];
      if (c === FLOOR) ctx.fillStyle = '#4a3a2c';
      else if (c >= ORE_BASE) ctx.fillStyle = `rgb(${ORES[c - ORE_BASE].color.join(',')})`;
      else ctx.fillStyle = '#1c1612';
      ctx.fillRect(ox + x * cell, oy + y * cell, cell, cell);
    }
    for (const o of level.oils) {
      if (!level.explored[idx(Math.floor(o.x), Math.floor(o.y))]) continue;
      ctx.fillStyle = '#ffc861';
      ctx.fillRect(ox + o.x * cell - cell, oy + o.y * cell - cell, cell * 2, cell * 2);
    }
    if (level.explored[idx(Math.floor(level.shaft.x), Math.floor(level.shaft.y))]) {
      ctx.fillStyle = `rgba(140,210,255,${0.6 + 0.4 * Math.sin(t * 5)})`;
      ctx.beginPath();
      ctx.arc(ox + level.shaft.x * cell, oy + level.shaft.y * cell, Math.max(3, cell * 1.2), 0, Math.PI * 2);
      ctx.fill();
    }
    const px = ox + player.x * cell, py = oy + player.y * cell;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.moveTo(px + Math.cos(player.a) * cell * 2.2, py + Math.sin(player.a) * cell * 2.2);
    ctx.lineTo(px + Math.cos(player.a + 2.5) * cell * 1.4, py + Math.sin(player.a + 2.5) * cell * 1.4);
    ctx.lineTo(px + Math.cos(player.a - 2.5) * cell * 1.4, py + Math.sin(player.a - 2.5) * cell * 1.4);
    ctx.closePath();
    ctx.fill();
    if (bigMap) {
      ctx.fillStyle = '#d9c2a0';
      ctx.font = '13px "Noto Sans JP", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('M で閉じる — 青い円が次の層への縦穴、橙の点が油瓶', W / 2, oy + mh + 24);
    }
  }

  function updateHud() {
    const fill = document.getElementById('fuelFill');
    fill.style.width = `${clamp(fuel, 0, 100)}%`;
    fill.classList.toggle('low', fuel < 25);
  }

  // ---------- Main loop ----------
  function loop(now) {
    const dt = Math.min(0.05, (now - lastTime) / 1000);
    lastTime = now;
    const t = now / 1000;

    if (state === 'playing' && !paused) {
      elapsed += dt;
      if (deathT < 0) {
        updatePlayer(dt);
        updatePickups();
        fuel = Math.max(0, fuel - FUEL_DRAIN * dt);
        if (fuel <= 0) deathT = 0;
      } else {
        deathT += dt;
        if (deathT > 1.6) endGame();
      }
      markExploredAround();
      fadeIn = Math.max(0, fadeIn - dt * 1.5);

      dripT -= dt;
      if (dripT <= 0) { SFX.drip(); dripT = rand(2, 6); }
      if (fuel < 20 && deathT < 0) {
        beatT -= dt;
        if (beatT <= 0) { SFX.heartbeat(); beatT = 0.6 + fuel / 20 * 0.6; }
      }
    }

    if (level.grid) {
      renderWorld(t);
      if (state === 'playing' && deathT < 0 && !paused) updateMining(dt);
      renderOverlay(t, dt);
    } else {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, W, H);
    }
    if (state === 'playing') updateHud();

    if (INSPECT) {
      window.__DEBUG_STATE__ = {
        state, depth, fuel, inventory, goods, tools, paused, player, level, target, mining,
        value: assetValue(), pickSpeed: pickSpeed(), lightRadius: lightRadius(),
        setFuel: v => { fuel = v; },
        refreshUI: () => { updateInventoryUI(); renderCraftPanel(); },
      };
    }
    requestAnimationFrame(loop);
  }

  document.getElementById('recipeList').addEventListener('click', e => {
    const b = e.target.closest('.r-btn');
    if (b && !b.disabled) craft(b.dataset.id);
  });
  document.getElementById('craftClose').addEventListener('click', closeCraft);

  document.getElementById('startBtn').addEventListener('click', e => {
    e.currentTarget.blur();
    resumeAudio();
    startGame();
  });
  document.getElementById('restartBtn').addEventListener('click', e => {
    e.currentTarget.blur();
    resumeAudio();
    startGame();
  });

  showBest();
  generateLevel(1); // backdrop behind the title screen
  player.x = level.start.x; player.y = level.start.y;
  requestAnimationFrame(loop);
})();
