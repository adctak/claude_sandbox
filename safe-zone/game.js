(() => {
  'use strict';

  const INSPECT = /[?&](debug|inspect)/.test(location.search);

  // ---------- Canvas ----------
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  let W = 0, H = 0;
  const DPR = Math.min(window.devicePixelRatio || 1, 2);
  function resize() {
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = W * DPR;
    canvas.height = H * DPR;
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }
  window.addEventListener('resize', resize);
  resize();

  // ---------- Audio ----------
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  const actx = new AudioCtx();
  let audioReady = false;
  function resumeAudio() { if (actx.state === 'suspended') actx.resume(); audioReady = true; }
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
  function noiseBurst({ dur = 0.2, gain = 0.12, filterFreq = 1200 }) {
    if (!audioReady) return;
    const t0 = actx.currentTime;
    const n = Math.floor(actx.sampleRate * dur);
    const buf = actx.createBuffer(1, n, actx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = actx.createBufferSource();
    src.buffer = buf;
    const f = actx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(filterFreq, t0);
    const g = actx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f).connect(g).connect(actx.destination);
    src.start(t0);
  }
  const SFX = {
    count: (n) => beep({ freq: n === 0 ? 1320 : 660, dur: n === 0 ? 0.25 : 0.12, type: 'square', gain: 0.07 }),
    start: () => { noiseBurst({ dur: 0.5, gain: 0.18, filterFreq: 700 }); beep({ freq: 110, dur: 0.5, type: 'sawtooth', gain: 0.1, slide: -50 }); },
    shot: () => beep({ freq: 900 + Math.random() * 300, dur: 0.03, type: 'square', gain: 0.012 }),
    graze: () => beep({ freq: 2200, dur: 0.03, type: 'sine', gain: 0.03 }),
    hit: () => { noiseBurst({ dur: 0.4, gain: 0.25, filterFreq: 1500 }); beep({ freq: 200, dur: 0.4, type: 'sawtooth', gain: 0.12, slide: -150 }); },
    clear: () => { beep({ freq: 523, dur: 0.1, type: 'triangle', gain: 0.09 }); beep({ freq: 659, dur: 0.1, type: 'triangle', gain: 0.09, delay: 0.1 }); beep({ freq: 784, dur: 0.22, type: 'triangle', gain: 0.09, delay: 0.2 }); },
    move: () => beep({ freq: 400, dur: 0.3, type: 'sine', gain: 0.05, slide: 400 }),
    gameover: () => { beep({ freq: 300, dur: 0.6, type: 'sawtooth', gain: 0.1, slide: -220 }); beep({ freq: 200, dur: 0.8, type: 'sawtooth', gain: 0.1, slide: -140, delay: 0.3 }); },
    hide: () => beep({ freq: 1200, dur: 0.35, type: 'sine', gain: 0.05, slide: -1000 }),
    bossHit: () => beep({ freq: 160 + Math.random() * 60, dur: 0.03, type: 'square', gain: 0.018 }),
    roar: () => { noiseBurst({ dur: 1.1, gain: 0.25, filterFreq: 380 }); beep({ freq: 70, dur: 1.1, type: 'sawtooth', gain: 0.16, slide: -35 }); beep({ freq: 105, dur: 0.9, type: 'sawtooth', gain: 0.1, slide: -60, delay: 0.1 }); },
    boom: () => noiseBurst({ dur: 0.45, gain: 0.2, filterFreq: 700 }),
    victory: () => [523, 659, 784, 1047, 1319].forEach((f, i) => beep({ freq: f, dur: i === 4 ? 0.6 : 0.14, type: 'triangle', gain: 0.1, delay: i * 0.12 })),
  };

  // ---------- Utility ----------
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const TAU = Math.PI * 2;

  // ---------- Bullet sprites ----------
  const COLORS = ['#ff4d6d', '#ffd166', '#4ef2ff', '#b98cff', '#7dffb0', '#ff8a3c'];
  const SIZES = { s: 5, m: 8, l: 12 };
  const sprites = {};
  function makeSprite(color, r) {
    const size = Math.ceil(r * 3.2);
    const c = document.createElement('canvas');
    c.width = c.height = size * 2;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(size, size, 0, size, size, size);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(r * 0.55 / size, '#ffffff');
    grad.addColorStop(r / size, color);
    grad.addColorStop(Math.min(0.99, (r * 1.5) / size), color + '66');
    grad.addColorStop(1, color + '00');
    g.fillStyle = grad;
    g.beginPath();
    g.arc(size, size, size, 0, TAU);
    g.fill();
    return c;
  }
  for (const col of COLORS) for (const [k, r] of Object.entries(SIZES)) sprites[col + k] = makeSprite(col, r);

  // ---------- Player ----------
  const PLAYER_HIT = 3;
  const SPEED = 330, FOCUS_SPEED = 140;
  const player = { x: 0, y: 0, invuln: 0 };

  // ---------- Bullets ----------
  // Motion is analytic in time t since spawn, so the safety check at spawn time and the
  // actual in-game positions are computed by exactly the same function.
  //   kind 'line'  : straight line, speed = max(vmin, v0 + acc * t)
  //   kind 'curve' : constant speed, heading turning at w rad/s (circular arc)
  let bullets = [];
  const MAX_LIFE = 7;
  const OFF = 60;

  function bulletPos(b, t, out) {
    if (b.kind === 'curve') {
      const th = b.a + b.w * t;
      out.x = b.x0 + (b.v / b.w) * (Math.sin(th) - Math.sin(b.a));
      out.y = b.y0 - (b.v / b.w) * (Math.cos(th) - Math.cos(b.a));
    } else {
      let s;
      if (b.acc === 0) s = b.v * t;
      else {
        // speed ramps from v toward a floor/ceiling vcap, then holds
        const tCap = (b.vcap - b.v) / b.acc;
        if (tCap > 0 && t > tCap) s = b.v * tCap + 0.5 * b.acc * tCap * tCap + b.vcap * (t - tCap);
        else s = b.v * t + 0.5 * b.acc * t * t;
      }
      out.x = b.x0 + Math.cos(b.a) * s;
      out.y = b.y0 + Math.sin(b.a) * s;
    }
    return out;
  }
  function maxSpeed(b) { return b.kind === 'line' ? Math.max(b.v, b.acc ? b.vcap : b.v) : b.v; }

  const _p = { x: 0, y: 0 };
  const stats = { fired: 0, rejected: 0 };

  // Reject any bullet whose path would ever come within (zone radius + bullet radius + player hitbox)
  // of the safe zone centre. Sampling step is ≤ 3px of travel and a 3px margin covers the chord error.
  function pathClear(b) {
    const need = safe.r + b.r + PLAYER_HIT + 3;
    const need2 = need * need;
    const dtS = 3 / Math.max(20, maxSpeed(b));
    for (let t = 0; t <= MAX_LIFE; t += dtS) {
      bulletPos(b, t, _p);
      const dx = _p.x - safe.x, dy = _p.y - safe.y;
      if (dx * dx + dy * dy < need2) return false;
      if (_p.x < -OFF || _p.x > W + OFF || _p.y < -OFF || _p.y > H + OFF) return true;
    }
    return true;
  }

  function fire(x, y, a, v, size, color, opt = {}) {
    const b = {
      kind: opt.w ? 'curve' : 'line',
      x0: x, y0: y, a, v, w: opt.w || 0,
      acc: opt.acc || 0, vcap: opt.vcap != null ? opt.vcap : v,
      t: 0, x, y, r: SIZES[size], spr: sprites[color + size], grazed: false,
    };
    if (!pathClear(b)) { stats.rejected++; return false; }
    stats.fired++;
    bullets.push(b);
    return true;
  }

  // ---------- Safe zone & phases ----------
  const TELEGRAPH = 3.0, CLEAR_TIME = 1.1;
  // the zone is only shown for the first second of the telegraph: it vanishes 2s before the barrage
  // and stays hidden until the barrage is over, so the player must remember where it was
  const HIDE_AT = TELEGRAPH - 2.0, HIDE_FADE = 0.2;
  const safe = { x: 0, y: 0, r: 70, fromX: 0, fromY: 0, toX: 0, toY: 0 };
  let phase = 'telegraph'; // telegraph | barrage | clear
  let phaseT = 0;
  let round = 1;
  let barrageDur = 5;
  let lastCount = 4;
  let hideCued = false;

  function zoneRadius() { return Math.max(34, 74 - (round - 1) * 3.5); }

  function zoneAlpha() {
    if (state !== 'playing') return 0;
    if (phase === 'clear') return 1;
    if (phase === 'telegraph') return clamp((HIDE_AT - phaseT) / HIDE_FADE, 0, 1);
    return 0;
  }

  function pickSafeSpot() {
    const r = zoneRadius();
    const top = Math.max(r + 60, bossBottom() + r + 24);
    const bottom = Math.max(top + 1, H - r - 50);
    for (let i = 0; i < 60; i++) {
      const x = rand(r + 50, W - r - 50);
      const y = rand(top, bottom);
      const d = Math.hypot(x - safe.x, y - safe.y);
      if (d > 200 && d < SPEED * 2.6) return { x, y };
    }
    return { x: rand(r + 50, W - r - 50), y: rand(top, bottom) };
  }

  // ---------- Boss: 終焉機神 OMEGA ----------
  const BOSS_HP = 1600;
  const boss = { x: 0, y: 0, w: 0, h: 0, hp: BOSS_HP, maxHp: BOSS_HP, hpShown: BOSS_HP, phase: 1, hitT: 0, roar: 0, dying: -1, lookX: 0, lookY: 1 };
  let charge = [];

  function bossGeom() {
    boss.w = Math.min(W * 0.74, 700);
    boss.h = clamp(H * 0.25, 130, 230);
  }
  function bossBottom() { return boss.h * 0.62 + 6 + boss.h * 0.75; }
  function eyePos() { return { x: boss.x, y: boss.y + boss.h * 0.08 }; }
  function podCenter(s) { return { x: boss.x + s * boss.w * 0.42, y: boss.y + boss.h * 0.1 }; }
  function podMuzzle(s) { const c = podCenter(s); return { x: c.x, y: c.y + boss.h * 0.15 }; }
  function podsOnline() { return round >= 3 || boss.phase >= 2; }

  function updateBoss(t, dt) {
    bossGeom();
    boss.x = W / 2 + Math.sin(t * 0.35) * W * 0.07;
    boss.y = boss.h * 0.62 + Math.sin(t * 0.9) * 6;
    boss.hitT = Math.max(0, boss.hitT - dt * 6);
    boss.roar = Math.max(0, boss.roar - dt);
    boss.hpShown += (boss.hp - boss.hpShown) * Math.min(1, dt * 3);
    // the eye follows the player
    const e = eyePos();
    const a = Math.atan2(player.y - e.y, player.x - e.x);
    const k = Math.min(1, dt * 5);
    boss.lookX += (Math.cos(a) - boss.lookX) * k;
    boss.lookY += (Math.sin(a) - boss.lookY) * k;
    // energy gathering into the eye before each barrage
    if (state === 'playing' && phase === 'telegraph' && phaseT > 0.4) {
      for (let i = 0; i < 3; i++) {
        const ang = Math.random() * TAU, d = rand(boss.h * 0.9, boss.h * 1.6);
        charge.push({ x: e.x + Math.cos(ang) * d, y: e.y + Math.sin(ang) * d, v: rand(260, 420) });
      }
    }
    for (let i = charge.length - 1; i >= 0; i--) {
      const c = charge[i];
      const dx = e.x - c.x, dy = e.y - c.y, d = Math.hypot(dx, dy);
      const step = c.v * dt;
      if (d < step + 6 || phase !== 'telegraph') { charge.splice(i, 1); continue; }
      c.px = c.x; c.py = c.y;
      c.x += (dx / d) * step; c.y += (dy / d) * step;
    }
  }

  function bossHitTest(x, y) {
    const dx = (x - boss.x) / (boss.w * 0.34), dy = (y - (boss.y + boss.h * 0.12)) / (boss.h * 0.62);
    if (dx * dx + dy * dy < 1) return true;
    for (const s of [-1, 1]) {
      const p = podCenter(s);
      if (Math.hypot(x - p.x, y - p.y) < boss.h * 0.2) return true;
    }
    return false;
  }

  function damageBoss(n, x, y) {
    if (boss.dying >= 0 || state !== 'playing') return;
    boss.hp = Math.max(0, boss.hp - n);
    boss.hitT = 1;
    score += 10;
    if (Math.random() < 0.5) sparkles.push({ x, y, vx: rand(-90, 90), vy: rand(20, 120), life: 0.35, color: '#9ff6ff' });
    if (bossHitSoundT <= 0) { SFX.bossHit(); bossHitSoundT = 0.06; }
    const ph = boss.hp <= boss.maxHp / 3 ? 3 : boss.hp <= boss.maxHp * 2 / 3 ? 2 : 1;
    if (ph > boss.phase) {
      boss.phase = ph;
      boss.roar = 1.4;
      shake = 18;
      flash = 0.4;
      SFX.roar();
      spawnFloater(ph === 2 ? 'PHASE 2 — 砲台展開' : 'PHASE 3 — 暴走', '#ff5b6e', W / 2, bossBottom() + 70);
    }
    if (boss.hp <= 0) defeatBoss();
  }

  function defeatBoss() {
    boss.dying = 0;
    state = 'defeat';
    for (const b of bullets) sparkles.push({ x: b.x, y: b.y, vx: rand(-30, 30), vy: rand(-60, -10), life: 0.8, color: '#ffffff' });
    score += bullets.length * 2;
    bullets = [];
    const bonus = 30000 + lives * 10000;
    score += bonus;
    spawnFloater(`OMEGA DOWN  +${bonus}`, '#ffd166', W / 2, H * 0.55);
    shake = 20;
    flash = 0.6;
    SFX.roar();
    updateHud();
  }

  function updateDefeat(dt) {
    const before = boss.dying;
    boss.dying += dt;
    shake = Math.max(shake, 6 + boss.dying * 4);
    if (boss.dying < 3) {
      boomT -= dt;
      while (boomT <= 0) {
        boomT += 0.07;
        booms.push({ x: boss.x + rand(-0.45, 0.45) * boss.w, y: boss.y + rand(-0.4, 0.7) * boss.h, r: rand(30, 80), life: 0.5, max: 0.5 });
      }
      boomSoundT -= dt;
      if (boomSoundT <= 0) { SFX.boom(); boomSoundT = 0.22; }
    }
    if (before < 3 && boss.dying >= 3) {
      flash = 1;
      shake = 32;
      SFX.boom(); SFX.roar();
      booms.push({ x: boss.x, y: boss.y, r: Math.max(W, H) * 0.7, life: 1.2, max: 1.2 });
      for (let i = 0; i < 160; i++) {
        const a = Math.random() * TAU, v = rand(80, 520);
        sparkles.push({ x: boss.x, y: boss.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: rand(0.6, 1.6), color: ['#ffd166', '#ff5b6e', '#ffffff', '#b98cff'][i % 4] });
      }
    }
    if (boss.dying >= 4.4) endGame(true);
  }

  // ---------- Emitters & patterns ----------
  // every barrage comes out of the boss: its eye, and (once online) the two arm cannons
  const emitters = [];
  function updateEmitters() {
    emitters.length = 0;
    emitters.push(eyePos());
    if (podsOnline()) emitters.push(podMuzzle(-1), podMuzzle(1));
  }

  const PATTERNS = {
    ring(p, dt, k) {
      p.t -= dt;
      if (p.t > 0) return;
      p.t = 0.42 / k;
      p.off = (p.off || 0) + 0.17;
      const n = Math.round(26 + k * 8);
      for (const e of emitters) for (let i = 0; i < n; i++) fire(e.x, e.y, p.off + (i / n) * TAU, 170 * spd(), 'm', '#ff4d6d');
    },
    spiral(p, dt, k) {
      p.t -= dt;
      p.ang = (p.ang || 0) + dt * 2.7;
      while (p.t <= 0) {
        p.t += 0.028 / k;
        const e = emitters[0];
        for (let arm = 0; arm < 4; arm++) fire(e.x, e.y, p.ang + arm * TAU / 4, 210 * spd(), 's', '#b98cff');
      }
    },
    rain(p, dt, k) {
      p.t -= dt;
      while (p.t <= 0) {
        p.t += 0.012 / k;
        fire(rand(0, W), -20, Math.PI / 2 + rand(-0.28, 0.28), rand(170, 270) * spd(), 's', '#4ef2ff');
      }
    },
    flower(p, dt, k) {
      p.t -= dt;
      if (p.t > 0) return;
      p.t = 0.55 / k;
      p.flip = !p.flip;
      const n = Math.round(20 + k * 6);
      const e = emitters[Math.floor(Math.random() * emitters.length)];
      for (let i = 0; i < n; i++) fire(e.x, e.y, (i / n) * TAU, 170 * spd(), 'm', '#ffd166', { w: p.flip ? 0.85 : -0.85 });
    },
    cage(p, dt, k) {
      // streams aimed to skim just past the safe zone's edge: a swirling wall around the refuge
      p.t -= dt;
      while (p.t <= 0) {
        p.t += 0.035 / k;
        const side = Math.floor(Math.random() * 4);
        const sx = side === 0 ? rand(0, W) : side === 1 ? W + 10 : side === 2 ? rand(0, W) : -10;
        const sy = side === 0 ? -10 : side === 1 ? rand(0, H) : side === 2 ? H + 10 : rand(0, H);
        const d = Math.hypot(safe.x - sx, safe.y - sy);
        const clearance = safe.r + SIZES.s + PLAYER_HIT + rand(6, 40);
        if (d <= clearance) continue;
        const base = Math.atan2(safe.y - sy, safe.x - sx);
        const off = Math.asin(clamp(clearance / d, -1, 1)) * (Math.random() < 0.5 ? 1 : -1);
        fire(sx, sy, base + off, rand(240, 330) * spd(), 's', '#7dffb0');
      }
    },
    sweep(p, dt, k) {
      p.t -= dt;
      p.ph = (p.ph || 0) + dt;
      while (p.t <= 0) {
        // the arm cannons swing their muzzles back and forth like two fire hoses
        p.t += 0.03 / k;
        const L = podMuzzle(-1), R = podMuzzle(1);
        const aL = Math.PI / 2 - 0.25 + Math.sin(p.ph * 1.6) * 1.1;
        const aR = Math.PI / 2 + 0.25 - Math.sin(p.ph * 1.6 + 1) * 1.1;
        fire(L.x, L.y, aL, 300 * spd(), 'm', '#ff8a3c');
        fire(R.x, R.y, aR, 300 * spd(), 'm', '#ff8a3c');
      }
    },
    burst(p, dt, k) {
      // slow-then-accelerating shells lobbed out of the boss's body: they hang, then lunge outward
      p.t -= dt;
      if (p.t > 0) return;
      p.t = 0.7 / k;
      const n = Math.round(30 + k * 10);
      const e = { x: boss.x + rand(-0.45, 0.45) * boss.w, y: rand(boss.y, bossBottom() + 60) };
      const off = Math.random() * TAU;
      for (let i = 0; i < n; i++) fire(e.x, e.y, off + (i / n) * TAU, 30, 'l', '#ff4d6d', { acc: 260, vcap: 380 * spd() });
    },
  };
  const PATTERN_KEYS = Object.keys(PATTERNS);
  let activePatterns = [];
  function spd() { return 1 + Math.min(0.5, (round - 1) * 0.04); }
  function density() { return (1 + (round - 1) * 0.14) * (1 + (boss.phase - 1) * 0.12); }

  function choosePatterns() {
    const count = Math.min(5, 2 + Math.floor((round - 1) / 2) + (boss.phase >= 3 ? 1 : 0));
    const pool = [...PATTERN_KEYS];
    const chosen = [];
    // always include the edge-skimming cage so the safe zone is visibly carved out of the barrage
    chosen.push('cage');
    pool.splice(pool.indexOf('cage'), 1);
    while (chosen.length < count && pool.length) chosen.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
    activePatterns = chosen.map(name => ({ name, t: 0.2 }));
  }

  // ---------- Game state ----------
  let state = 'start';
  let lives = 3;
  let score = 0;
  let graze = 0;
  let hitThisRound = false;
  let flash = 0;
  let shake = 0;
  let shotSoundT = 0, grazeSoundT = 0, bossHitSoundT = 0, boomSoundT = 0, boomT = 0;
  let shots = [];
  let shotCd = 0;
  let booms = [];
  let sparkles = [];
  let floaters = [];
  let elapsed = 0;
  let minClearance = Infinity;
  let lastTime = performance.now();

  const keys = {};
  window.addEventListener('keydown', e => {
    keys[e.code] = true;
    if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
  });
  window.addEventListener('keyup', e => { keys[e.code] = false; });

  // touch: drag anywhere to move relatively
  let touchLast = null;
  canvas.addEventListener('touchstart', e => { const t = e.touches[0]; touchLast = { x: t.clientX, y: t.clientY }; }, { passive: true });
  canvas.addEventListener('touchmove', e => {
    const t = e.touches[0];
    if (touchLast && state === 'playing') {
      player.x = clamp(player.x + (t.clientX - touchLast.x) * 1.2, 6, W - 6);
      player.y = clamp(player.y + (t.clientY - touchLast.y) * 1.2, 6, H - 6);
    }
    touchLast = { x: t.clientX, y: t.clientY };
  }, { passive: true });

  function loadBest() { try { return JSON.parse(localStorage.getItem('safezone-best') || 'null'); } catch (_) { return null; } }
  function saveBest(v) { try { localStorage.setItem('safezone-best', JSON.stringify(v)); } catch (_) { /* storage blocked */ } }
  function showBest() {
    const b = loadBest();
    document.getElementById('bestRecord').textContent = b ? `自己ベスト: ${b.win ? 'OMEGA撃破 ／ ' : ''}ROUND ${b.round} ／ ${b.score} pts` : '';
  }

  function spawnFloater(text, color, x, y) {
    floaters.push({ text, color, x: x ?? W / 2, y: y ?? bossBottom() + 60, life: 1.6, maxLife: 1.6 });
  }

  function startGame() {
    lives = 3; score = 0; graze = 0; round = 1; elapsed = 0;
    bullets = []; sparkles = []; floaters = []; shots = []; booms = []; charge = [];
    boss.hp = boss.hpShown = BOSS_HP; boss.phase = 1; boss.dying = -1; boss.hitT = 0; boss.roar = 0;
    bossGeom();
    player.x = W / 2; player.y = H * 0.8; player.invuln = 0;
    safe.x = player.x; safe.y = player.y; // so the first zone is placed away from the start point
    const s = pickSafeSpot();
    safe.x = s.x; safe.y = s.y; safe.r = zoneRadius();
    enterTelegraph();
    state = 'playing';
    document.getElementById('startScreen').classList.add('hidden');
    document.getElementById('gameOverScreen').classList.add('hidden');
    updateHud();
  }

  function enterTelegraph() {
    phase = 'telegraph';
    phaseT = 0;
    lastCount = 4;
    hideCued = false;
    hitThisRound = false;
  }

  function enterBarrage() {
    phase = 'barrage';
    phaseT = 0;
    barrageDur = 5 + Math.min(3, (round - 1) * 0.35);
    minClearance = Infinity;
    choosePatterns();
    updateEmitters();
    flash = 0.35;
    shake = 8;
    boss.roar = Math.max(boss.roar, 0.5);
    SFX.start();
  }

  function enterClear() {
    phase = 'clear';
    phaseT = 0;
    // leftover bullets dissolve into score sparkles
    for (const b of bullets) sparkles.push({ x: b.x, y: b.y, vx: rand(-30, 30), vy: rand(-60, -10), life: 0.8, color: '#ffffff' });
    score += bullets.length * 2;
    bullets = [];
    const bonus = 1000 * round + (hitThisRound ? 0 : 500 * round);
    score += bonus;
    spawnFloater(`ROUND ${round} CLEAR  +${bonus}${hitThisRound ? '' : '  NO MISS!'}`, '#7dffb0');
    SFX.clear();
    round += 1;
    safe.fromX = safe.x; safe.fromY = safe.y;
    const s = pickSafeSpot();
    safe.toX = s.x; safe.toY = s.y;
    SFX.move();
  }

  function endGame(victory = false) {
    state = 'ended';
    if (victory) SFX.victory(); else SFX.gameover();
    const best = loadBest();
    const reached = round;
    const isBest = !best || score > best.score;
    if (isBest) saveBest({ score, round: reached, win: victory || !!(best && best.win) });
    else if (victory && !best.win) saveBest({ ...best, win: true });
    const title = document.getElementById('overTitle');
    title.textContent = victory ? 'VICTORY' : 'GAME OVER';
    title.className = 'title ' + (victory ? 'win' : 'over');
    const head = victory
      ? '終焉機神 OMEGA 撃破！'
      : `OMEGA 残りHP ${Math.ceil((boss.hp / boss.maxHp) * 100)}%`;
    document.getElementById('resultBody').textContent =
      `${head}\n到達 ROUND ${reached}　スコア ${score}　GRAZE ${graze}${isBest ? '\n自己ベスト更新！' : ''}`;
    document.getElementById('gameOverScreen').classList.remove('hidden');
    showBest();
  }

  function takeHit() {
    lives -= 1;
    hitThisRound = true;
    player.invuln = 2;
    flash = 0.6;
    shake = 14;
    SFX.hit();
    // mercy clear around the player
    bullets = bullets.filter(b => {
      const near = Math.hypot(b.x - player.x, b.y - player.y) < 150;
      if (near) sparkles.push({ x: b.x, y: b.y, vx: rand(-80, 80), vy: rand(-80, 80), life: 0.5, color: '#ff4d6d' });
      return !near;
    });
    updateHud();
    if (lives <= 0) endGame();
  }

  function updateHud() {
    document.getElementById('round').textContent = `ROUND ${round}`;
    document.getElementById('score').textContent = score.toLocaleString();
    document.getElementById('graze').textContent = `GRAZE ${graze}`;
    const el = document.getElementById('lives');
    el.innerHTML = '';
    for (let i = 0; i < 3; i++) {
      const d = document.createElement('div');
      d.className = 'life' + (i < lives ? '' : ' lost');
      el.appendChild(d);
    }
  }

  // ---------- Update ----------
  function updatePlayer(dt) {
    const focus = keys.ShiftLeft || keys.ShiftRight;
    const sp = focus ? FOCUS_SPEED : SPEED;
    let mx = 0, my = 0;
    if (keys.ArrowLeft || keys.KeyA) mx -= 1;
    if (keys.ArrowRight || keys.KeyD) mx += 1;
    if (keys.ArrowUp || keys.KeyW) my -= 1;
    if (keys.ArrowDown || keys.KeyS) my += 1;
    const len = Math.hypot(mx, my) || 1;
    player.x = clamp(player.x + (mx / len) * sp * dt, 6, W - 6);
    player.y = clamp(player.y + (my / len) * sp * dt, 6, H - 6);
    player.invuln = Math.max(0, player.invuln - dt);
  }

  function updatePhase(dt) {
    phaseT += dt;
    if (phase === 'telegraph') {
      safe.r = zoneRadius();
      const remaining = Math.ceil(TELEGRAPH - phaseT);
      if (remaining < lastCount && remaining >= 1) { SFX.count(remaining); lastCount = remaining; }
      if (!hideCued && phaseT >= HIDE_AT) {
        // the zone vanishes: a brief ring of motes marks the moment, then nothing
        hideCued = true;
        SFX.hide();
        for (let i = 0; i < 36; i++) {
          const a = (i / 36) * TAU;
          sparkles.push({ x: safe.x + Math.cos(a) * safe.r, y: safe.y + Math.sin(a) * safe.r, vx: Math.cos(a) * 40, vy: Math.sin(a) * 40, life: 0.5, color: '#ff5b6e' });
        }
      }
      if (phaseT >= TELEGRAPH) { SFX.count(0); enterBarrage(); }
    } else if (phase === 'barrage') {
      updateEmitters();
      if (phaseT < barrageDur) {
        const k = density();
        for (const p of activePatterns) PATTERNS[p.name](p, dt, k);
      } else if (bullets.length === 0 || phaseT > barrageDur + 2.5) {
        enterClear();
      }
    } else if (phase === 'clear') {
      const k = clamp(phaseT / CLEAR_TIME, 0, 1);
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      safe.x = safe.fromX + (safe.toX - safe.fromX) * e;
      safe.y = safe.fromY + (safe.toY - safe.fromY) * e;
      safe.r = zoneRadius();
      if (phaseT >= CLEAR_TIME) { safe.x = safe.toX; safe.y = safe.toY; enterTelegraph(); }
    }
  }

  function updateBullets(dt) {
    let shotsThisFrame = 0;
    const alive = [];
    for (const b of bullets) {
      if (b.t === 0) shotsThisFrame++;
      b.t += dt;
      bulletPos(b, b.t, b);
      if (b.t > MAX_LIFE || b.x < -OFF || b.x > W + OFF || b.y < -OFF || b.y > H + OFF) continue;
      alive.push(b);
      const dx = b.x - player.x, dy = b.y - player.y;
      const d2 = dx * dx + dy * dy;
      const hitR = b.r + PLAYER_HIT;
      if (d2 < hitR * hitR && player.invuln <= 0 && state === 'playing') {
        takeHit();
        if (state !== 'playing') return;
      } else if (!b.grazed && d2 < (hitR + 16) * (hitR + 16)) {
        b.grazed = true;
        graze += 1;
        score += 20;
        if (grazeSoundT <= 0) { SFX.graze(); grazeSoundT = 0.05; }
      }
      if (INSPECT && phase === 'barrage') {
        const c = Math.hypot(b.x - safe.x, b.y - safe.y) - b.r;
        if (c < minClearance) minClearance = c;
      }
    }
    bullets = alive;
    shotSoundT -= dt;
    grazeSoundT -= dt;
    if (shotsThisFrame > 0 && shotSoundT <= 0) { SFX.shot(); shotSoundT = 0.07; }
  }

  // the player's ship auto-fires twin lasers straight up into the boss
  function updateShots(dt, canFire) {
    bossHitSoundT -= dt;
    shotCd -= dt;
    if (canFire && shotCd <= 0) {
      shotCd = Math.max(0, shotCd + 1 / 12);
      shots.push({ x: player.x - 6, y: player.y - 10 }, { x: player.x + 6, y: player.y - 10 });
    }
    const alive = [];
    for (const s of shots) {
      s.y -= 1000 * dt;
      if (s.y < -30) continue;
      if (boss.dying < 0 && bossHitTest(s.x, s.y)) { damageBoss(1, s.x, s.y); continue; }
      alive.push(s);
    }
    shots = alive;
  }

  // ---------- Drawing ----------
  const stars = Array.from({ length: 140 }, () => ({ x: Math.random(), y: Math.random(), s: rand(0.3, 1.4), v: rand(8, 40) }));

  function drawBackground(t) {
    ctx.fillStyle = '#04030a';
    ctx.fillRect(0, 0, W, H);
    for (const s of stars) {
      const y = ((s.y * H + t * s.v) % H + H) % H;
      ctx.fillStyle = `rgba(190,180,255,${0.25 + s.s * 0.25})`;
      ctx.fillRect(s.x * W, y, s.s, s.s);
    }
    ctx.strokeStyle = 'rgba(120,90,200,0.06)';
    ctx.lineWidth = 1;
    for (let x = 0; x < W; x += 48) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
    for (let y = 0; y < H; y += 48) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
  }

  function drawSafeZone(t) {
    const alpha = zoneAlpha();
    if (alpha <= 0) return;
    const telegraph = phase === 'telegraph';
    const pulse = telegraph ? 0.5 + 0.5 * Math.sin(t * 10) : 0.5 + 0.5 * Math.sin(t * 3);
    const r = safe.r * (1 + (1 - alpha) * 0.25);
    ctx.save();
    ctx.globalAlpha = alpha;
    const fill = ctx.createRadialGradient(safe.x, safe.y, 0, safe.x, safe.y, r);
    fill.addColorStop(0, `rgba(255,40,70,${telegraph ? 0.1 + pulse * 0.12 : 0.1})`);
    fill.addColorStop(1, `rgba(255,40,70,${telegraph ? 0.22 + pulse * 0.15 : 0.2})`);
    ctx.fillStyle = fill;
    ctx.beginPath(); ctx.arc(safe.x, safe.y, r, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#ff3b55';
    ctx.shadowColor = '#ff3b55';
    ctx.shadowBlur = 16 + pulse * 12;
    ctx.lineWidth = telegraph ? 3 + pulse * 2 : 3;
    ctx.beginPath(); ctx.arc(safe.x, safe.y, r, 0, TAU); ctx.stroke();
    ctx.shadowBlur = 0;

    if (telegraph) {
      // arc shows how long the zone stays visible
      const left = clamp(1 - phaseT / HIDE_AT, 0, 1);
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(safe.x, safe.y, r + 10, -Math.PI / 2, -Math.PI / 2 + TAU * left);
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.font = `700 ${Math.round(clamp(safe.r * 0.32, 11, 16))}px "Noto Sans JP", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('ここを覚えろ', safe.x, safe.y);
      // guide line from player when outside the zone
      const d = Math.hypot(player.x - safe.x, player.y - safe.y);
      if (d > safe.r) {
        ctx.setLineDash([6, 8]);
        ctx.strokeStyle = 'rgba(255,90,110,0.45)';
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(player.x, player.y); ctx.lineTo(safe.x, safe.y); ctx.stroke();
        ctx.setLineDash([]);
      }
    }
    ctx.restore();
  }

  // ---------- Boss drawing ----------
  // hull outline in units of (boss.w, boss.h) around (boss.x, boss.y): a horned crown tapering to a keel
  const HULL = [[-0.36, -0.05], [-0.3, -0.42], [-0.21, -0.3], [-0.14, -0.8], [-0.06, -0.38], [0, -0.52], [0.06, -0.38], [0.14, -0.8],
    [0.21, -0.3], [0.3, -0.42], [0.36, -0.05], [0.3, 0.32], [0.16, 0.55], [0, 0.75], [-0.16, 0.55], [-0.3, 0.32]];
  const CRACKS = Array.from({ length: 7 }, () => {
    const pts = [[rand(-0.24, 0.24), rand(-0.25, 0.45)]];
    for (let i = 0; i < 4; i++) {
      const [px, py] = pts[pts.length - 1];
      pts.push([px + rand(-0.05, 0.05), py + rand(-0.13, 0.13)]);
    }
    return pts;
  });
  const TENTACLES = [-0.22, -0.13, -0.045, 0.045, 0.13, 0.22];

  function bossPalette() {
    if (boss.phase === 3) return { glow: '#ff2a4a', rgb: '255,42,74', plate: '#3c0a16', plate2: '#120308', iris: '#ffe066' };
    if (boss.phase === 2) return { glow: '#ff4dd2', rgb: '255,77,210', plate: '#300c3c', plate2: '#0e0414', iris: '#ffd166' };
    return { glow: '#9a6bff', rgb: '154,107,255', plate: '#221340', plate2: '#08040f', iris: '#ff5b6e' };
  }

  function hullPath(scale = 1) {
    ctx.beginPath();
    HULL.forEach(([px, py], i) => {
      const x = boss.x + px * boss.w * scale, y = boss.y + py * boss.h * scale;
      if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    });
    ctx.closePath();
  }

  function drawBoss(t) {
    if (boss.dying >= 3) return;
    const P = bossPalette();
    const { x, y, w, h } = boss;
    const rage = boss.phase === 3;
    ctx.save();
    if (boss.dying >= 0) ctx.translate(rand(-4, 4) * (1 + boss.dying * 2), rand(-3, 3) * (1 + boss.dying * 2));
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    // aura
    const auraA = 0.16 + boss.roar * 0.22 + (rage ? 0.08 * (0.5 + 0.5 * Math.sin(t * 9)) : 0);
    const aura = ctx.createRadialGradient(x, y, 0, x, y, w * 0.72);
    aura.addColorStop(0, `rgba(${P.rgb},${auraA})`);
    aura.addColorStop(1, `rgba(${P.rgb},0)`);
    ctx.fillStyle = aura;
    ctx.fillRect(x - w * 0.72, y - w * 0.72, w * 1.44, w * 1.44);

    // wings: five blades per side, slowly breathing
    for (const s of [-1, 1]) {
      for (let i = 0; i < 5; i++) {
        const ang = -0.62 + i * 0.3 + Math.sin(t * 1.4 + i * 0.6) * 0.06 + (boss.roar > 0 ? Math.sin(t * 40 + i) * 0.04 * boss.roar : 0);
        const len = w * (0.42 - Math.abs(i - 1.5) * 0.035);
        const rx = x + s * w * 0.24, ry = y - h * 0.12 + i * h * 0.05;
        const dx = s * Math.cos(ang), dy = Math.sin(ang);
        const nx = -dy * s, ny = dx * s;
        const tx = rx + dx * len, ty = ry + dy * len;
        const g = ctx.createLinearGradient(rx, ry, tx, ty);
        g.addColorStop(0, P.plate);
        g.addColorStop(1, P.plate2);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(rx, ry);
        ctx.lineTo(rx + dx * len * 0.45 + nx * h * 0.11, ry + dy * len * 0.45 + ny * h * 0.11);
        ctx.lineTo(tx, ty);
        ctx.lineTo(rx + dx * len * 0.6 - nx * h * 0.03, ry + dy * len * 0.6 - ny * h * 0.03);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = `rgba(${P.rgb},0.55)`;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        // energy vein down the blade
        ctx.strokeStyle = `rgba(${P.rgb},${0.35 + 0.3 * Math.sin(t * 3 - i)})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(rx + dx * len * 0.15, ry + dy * len * 0.15);
        ctx.lineTo(rx + dx * len * 0.85, ry + dy * len * 0.85);
        ctx.stroke();
      }
    }

    // tentacles hanging from the keel
    TENTACLES.forEach((f, idx) => {
      const x0 = x + f * w, y0 = y + h * (0.72 - Math.abs(f) * 1.6);
      const len = h * (0.55 + (0.22 - Math.abs(f)) * 1.3);
      const N = 12;
      let px = x0, py = y0;
      for (let k = 1; k <= N; k++) {
        const u = k / N;
        const nx = x0 + f * w * 0.6 * u + Math.sin(t * 2.2 + idx * 1.3 + u * 4) * 16 * u;
        const ny = y0 + len * u;
        ctx.strokeStyle = k > N - 3 ? P.glow : P.plate;
        ctx.lineWidth = 11 * (1 - u) + 1.5;
        ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(nx, ny); ctx.stroke();
        px = nx; py = ny;
      }
      ctx.fillStyle = P.glow;
      ctx.shadowColor = P.glow;
      ctx.shadowBlur = 10;
      ctx.beginPath(); ctx.arc(px, py, 2.5, 0, TAU); ctx.fill();
      ctx.shadowBlur = 0;
    });

    // arms + cannon pods
    const podR = h * 0.19;
    for (const s of [-1, 1]) {
      const c = podCenter(s);
      ctx.strokeStyle = P.plate;
      ctx.lineWidth = h * 0.09;
      ctx.beginPath(); ctx.moveTo(x + s * w * 0.28, y + h * 0.05); ctx.lineTo(c.x, c.y); ctx.stroke();
      ctx.strokeStyle = `rgba(${P.rgb},0.5)`;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      // rotating armour spikes
      ctx.fillStyle = P.plate;
      for (let i = 0; i < 6; i++) {
        const a = t * 0.8 * s + (i / 6) * TAU;
        ctx.beginPath();
        ctx.moveTo(c.x + Math.cos(a - 0.2) * podR * 0.9, c.y + Math.sin(a - 0.2) * podR * 0.9);
        ctx.lineTo(c.x + Math.cos(a) * podR * 1.45, c.y + Math.sin(a) * podR * 1.45);
        ctx.lineTo(c.x + Math.cos(a + 0.2) * podR * 0.9, c.y + Math.sin(a + 0.2) * podR * 0.9);
        ctx.fill();
      }
      const pg = ctx.createRadialGradient(c.x - podR * 0.3, c.y - podR * 0.3, 0, c.x, c.y, podR);
      pg.addColorStop(0, P.plate);
      pg.addColorStop(1, P.plate2);
      ctx.fillStyle = pg;
      ctx.beginPath(); ctx.arc(c.x, c.y, podR, 0, TAU); ctx.fill();
      ctx.strokeStyle = P.glow;
      ctx.shadowColor = P.glow;
      ctx.shadowBlur = 12;
      ctx.lineWidth = 2;
      ctx.stroke();
      // muzzle: sealed and dim until the cannons come online
      const m = podMuzzle(s);
      const on = podsOnline();
      const hot = on ? (phase === 'barrage' ? 0.8 + 0.2 * Math.sin(t * 20) : 0.5) : 0.12;
      ctx.fillStyle = `rgba(255,${on ? 220 : 120},${on ? 200 : 160},${hot})`;
      ctx.shadowBlur = on ? 22 : 0;
      ctx.beginPath(); ctx.arc(m.x, m.y, podR * 0.32, 0, TAU); ctx.fill();
      ctx.shadowBlur = 0;
    }

    // main hull
    const hg = ctx.createLinearGradient(x, y - h * 0.8, x, y + h * 0.75);
    hg.addColorStop(0, P.plate);
    hg.addColorStop(0.65, P.plate2);
    hg.addColorStop(1, '#000000');
    ctx.fillStyle = hg;
    hullPath();
    ctx.fill();
    const sheen = ctx.createLinearGradient(x - w * 0.36, y, x + w * 0.36, y);
    sheen.addColorStop(0, 'rgba(255,255,255,0)');
    sheen.addColorStop(0.5, 'rgba(255,255,255,0.07)');
    sheen.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = sheen;
    ctx.fill();
    ctx.strokeStyle = P.glow;
    ctx.shadowColor = P.glow;
    ctx.shadowBlur = 18;
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = `rgba(${P.rgb},0.28)`;
    ctx.lineWidth = 1.5;
    hullPath(0.72);
    ctx.stroke();
    hullPath(0.45);
    ctx.stroke();

    const E = eyePos();
    ctx.globalCompositeOperation = 'lighter';
    // veins from the eye out to the horns and keel
    [3, 7, 1, 9, 12, 14, 13].forEach((vi, i) => {
      const [px, py] = HULL[vi];
      ctx.strokeStyle = `rgba(${P.rgb},${0.22 + 0.22 * Math.sin(t * 3 + i * 1.7)})`;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(E.x, E.y);
      ctx.lineTo(x + px * w * 0.85, y + py * h * 0.85);
      ctx.stroke();
    });
    if (rage) {
      ctx.strokeStyle = `rgba(255,${120 + Math.floor(Math.random() * 100)},80,${0.5 + Math.random() * 0.5})`;
      ctx.lineWidth = 2;
      for (const c of CRACKS) {
        ctx.beginPath();
        c.forEach(([px, py], i) => { if (i) ctx.lineTo(x + px * w, y + py * h); else ctx.moveTo(x + px * w, y + py * h); });
        ctx.stroke();
      }
    }
    if (boss.hitT > 0) {
      ctx.fillStyle = `rgba(255,255,255,${0.16 * boss.hitT})`;
      hullPath();
      ctx.fill();
    }
    // energy gathering into the eye
    ctx.strokeStyle = `rgba(${P.rgb},0.9)`;
    ctx.lineWidth = 2;
    for (const c of charge) {
      if (c.px == null) continue;
      ctx.beginPath(); ctx.moveTo(c.px, c.py); ctx.lineTo(c.x, c.y); ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';

    // the eye
    const R = h * 0.21;
    const chargeK = state === 'playing' && phase === 'telegraph' ? phaseT / TELEGRAPH : phase === 'barrage' ? 0.7 : 0.25;
    ctx.fillStyle = '#050208';
    ctx.strokeStyle = P.glow;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(E.x, E.y, R * 1.35, R * 1.0, 0, 0, TAU); ctx.fill(); ctx.stroke();
    const sg = ctx.createRadialGradient(E.x, E.y, 0, E.x, E.y, R);
    sg.addColorStop(0, P.iris);
    sg.addColorStop(0.55, '#5a0012');
    sg.addColorStop(1, '#0a0005');
    ctx.fillStyle = sg;
    ctx.shadowColor = P.iris;
    ctx.shadowBlur = 20 + chargeK * 50;
    ctx.beginPath(); ctx.arc(E.x, E.y, R, 0, TAU); ctx.fill();
    ctx.shadowBlur = 0;
    const ix = E.x + boss.lookX * R * 0.35, iy = E.y + boss.lookY * R * 0.3;
    const ig = ctx.createRadialGradient(ix, iy, 0, ix, iy, R * 0.55);
    ig.addColorStop(0, '#ffffff');
    ig.addColorStop(0.3, P.iris);
    ig.addColorStop(1, 'rgba(255,60,40,0.1)');
    ctx.fillStyle = ig;
    ctx.beginPath(); ctx.arc(ix, iy, R * (0.5 + chargeK * 0.12), 0, TAU); ctx.fill();
    ctx.fillStyle = '#000000';
    ctx.beginPath(); ctx.ellipse(ix, iy, R * (rage ? 0.07 : 0.12), R * 0.46, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.beginPath(); ctx.arc(ix - R * 0.18, iy - R * 0.2, R * 0.07, 0, TAU); ctx.fill();

    // countdown to the barrage, burned into the eye
    if (state === 'playing' && phase === 'telegraph') {
      const n = Math.max(1, Math.ceil(TELEGRAPH - phaseT));
      ctx.fillStyle = '#ffffff';
      ctx.font = `900 ${Math.round(h * 0.34)}px Orbitron, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.shadowColor = '#ff3b55';
      ctx.shadowBlur = 24;
      ctx.fillText(String(n), E.x, E.y + 2);
      ctx.shadowBlur = 0;
    }
    ctx.restore();
  }

  function drawBossBar() {
    if (state === 'start') return;
    const bw = Math.min(W * 0.46, 520), bx = (W - bw) / 2, by = 36, bh = 8;
    const P = bossPalette();
    ctx.save();
    ctx.font = '700 11px Orbitron, "Noto Sans JP", sans-serif';
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#f0e6ff';
    ctx.fillText('終焉機神 OMEGA', bx, by - 6);
    ctx.textAlign = 'right';
    ctx.fillStyle = P.glow;
    ctx.fillText(boss.dying >= 0 ? 'DESTROYED' : `PHASE ${boss.phase}`, bx + bw, by - 6);
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(bx, by, bw, bh);
    const shown = clamp(boss.hpShown / boss.maxHp, 0, 1), real = clamp(boss.hp / boss.maxHp, 0, 1);
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fillRect(bx, by, bw * shown, bh);
    const g = ctx.createLinearGradient(bx, 0, bx + bw, 0);
    g.addColorStop(0, '#ff2a4a');
    g.addColorStop(1, P.glow);
    ctx.fillStyle = g;
    ctx.shadowColor = P.glow;
    ctx.shadowBlur = 10;
    ctx.fillRect(bx, by, bw * real, bh);
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(0,0,0,0.8)';
    ctx.fillRect(bx + bw / 3 - 1, by, 2, bh);
    ctx.fillRect(bx + bw * 2 / 3 - 1, by, 2, bh);
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1;
    ctx.strokeRect(bx - 0.5, by - 0.5, bw + 1, bh + 1);
    ctx.restore();
  }

  function drawShots() {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = 'rgba(120,240,255,0.9)';
    for (const s of shots) ctx.fillRect(s.x - 1.5, s.y - 12, 3, 18);
    ctx.restore();
  }

  function drawBooms(dt) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = booms.length - 1; i >= 0; i--) {
      const b = booms[i];
      b.life -= dt;
      if (b.life <= 0) { booms.splice(i, 1); continue; }
      const k = 1 - b.life / b.max;
      const r = b.r * (0.3 + k * 0.9);
      const g = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, r);
      g.addColorStop(0, `rgba(255,255,220,${0.9 * (1 - k)})`);
      g.addColorStop(0.4, `rgba(255,150,60,${0.6 * (1 - k)})`);
      g.addColorStop(1, 'rgba(255,40,70,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(b.x, b.y, r, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }

  function drawBullets() {
    for (const b of bullets) {
      const s = b.spr;
      ctx.drawImage(s, b.x - s.width / 2, b.y - s.height / 2);
    }
  }

  function drawPlayer(t) {
    if (player.invuln > 0 && Math.floor(t * 20) % 2 === 0) return;
    const focus = keys.ShiftLeft || keys.ShiftRight;
    ctx.save();
    ctx.translate(player.x, player.y);
    ctx.fillStyle = '#e8f6ff';
    ctx.shadowColor = '#4ef2ff';
    ctx.shadowBlur = 14;
    ctx.beginPath();
    ctx.moveTo(0, -14); ctx.lineTo(10, 10); ctx.lineTo(0, 5); ctx.lineTo(-10, 10);
    ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 0;
    if (focus) {
      ctx.strokeStyle = 'rgba(255,255,255,0.8)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(0, 0, 10, t * 3, t * 3 + TAU * 0.8); ctx.stroke();
    }
    ctx.fillStyle = '#ff3b55';
    ctx.beginPath(); ctx.arc(0, 0, PLAYER_HIT + (focus ? 1 : 0), 0, TAU); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(0, 0, 1.5, 0, TAU); ctx.fill();
    ctx.restore();
  }

  function drawEffects(dt) {
    for (let i = sparkles.length - 1; i >= 0; i--) {
      const s = sparkles[i];
      s.x += s.vx * dt; s.y += s.vy * dt; s.life -= dt;
      if (s.life <= 0) { sparkles.splice(i, 1); continue; }
      ctx.globalAlpha = clamp(s.life / 0.8, 0, 1);
      ctx.fillStyle = s.color;
      ctx.fillRect(s.x - 1.5, s.y - 1.5, 3, 3);
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    for (let i = floaters.length - 1; i >= 0; i--) {
      const f = floaters[i];
      f.life -= dt; f.y -= 20 * dt;
      if (f.life <= 0) { floaters.splice(i, 1); continue; }
      ctx.globalAlpha = clamp(f.life / 0.6, 0, 1);
      ctx.font = '700 22px Orbitron, "Noto Sans JP", sans-serif';
      ctx.fillStyle = f.color;
      ctx.shadowColor = f.color;
      ctx.shadowBlur = 12;
      ctx.fillText(f.text, f.x, f.y);
      ctx.shadowBlur = 0;
    }
    ctx.globalAlpha = 1;
    if (phase === 'telegraph' && state === 'playing' && phaseT < 1.2) {
      ctx.globalAlpha = clamp(1 - phaseT / 1.2, 0, 1);
      ctx.fillStyle = '#ff7a8a';
      ctx.font = '700 18px "Noto Sans JP", sans-serif';
      ctx.fillText(`ROUND ${round} — 赤い円の位置を覚えろ！`, W / 2, bossBottom() + 34);
      ctx.globalAlpha = 1;
    }
    if (flash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${flash * 0.5})`;
      ctx.fillRect(0, 0, W, H);
      flash = Math.max(0, flash - dt * 1.8);
    }
  }

  // ---------- Main loop ----------
  function loop(now) {
    const dt = Math.min(0.033, (now - lastTime) / 1000);
    lastTime = now;
    const t = now / 1000;

    updateBoss(t, dt);
    if (state === 'playing') {
      elapsed += dt;
      updatePlayer(dt);
      updatePhase(dt);
      updateBullets(dt);
      if (state === 'playing') updateShots(dt, true);
      updateHud();
    } else if (state === 'defeat') {
      updatePlayer(dt);
      updateShots(dt, false);
      updateDefeat(dt);
    }

    ctx.save();
    if (shake > 0) {
      ctx.translate(rand(-shake, shake), rand(-shake, shake));
      shake = Math.max(0, shake - dt * 40);
    }
    drawBackground(t);
    drawBoss(t);
    if (state !== 'start') {
      drawSafeZone(t);
      drawShots();
      drawBullets();
      if (state === 'playing' || state === 'defeat') drawPlayer(t);
    }
    drawBooms(dt);
    drawEffects(dt);
    ctx.restore();
    drawBossBar();

    if (INSPECT) {
      window.__DEBUG_STATE__ = {
        state, phase, phaseT, round, lives, score, graze, safe, player, stats, boss,
        bulletCount: bullets.length, shotCount: shots.length, zoneAlpha: zoneAlpha(), minClearance, PLAYER_HIT,
      };
      window.__DEBUG_HOOKS__ = { setBossHp(v) { boss.hp = v; } };
    }
    requestAnimationFrame(loop);
  }

  document.getElementById('startBtn').addEventListener('click', e => { e.currentTarget.blur(); resumeAudio(); startGame(); });
  document.getElementById('restartBtn').addEventListener('click', e => { e.currentTarget.blur(); resumeAudio(); startGame(); });
  showBest();
  requestAnimationFrame(loop);
})();
