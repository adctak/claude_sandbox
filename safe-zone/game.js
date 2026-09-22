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
  const safe = { x: 0, y: 0, r: 70, fromX: 0, fromY: 0, toX: 0, toY: 0 };
  let phase = 'telegraph'; // telegraph | barrage | clear
  let phaseT = 0;
  let round = 1;
  let barrageDur = 5;
  let lastCount = 4;

  function zoneRadius() { return Math.max(34, 74 - (round - 1) * 3.5); }

  function pickSafeSpot() {
    const r = zoneRadius();
    for (let i = 0; i < 60; i++) {
      const x = rand(r + 50, W - r - 50);
      const y = rand(Math.max(r + 60, 200), H - r - 50);
      const d = Math.hypot(x - safe.x, y - safe.y);
      if (d > 200 && d < SPEED * 2.6) return { x, y };
    }
    return { x: rand(r + 50, W - r - 50), y: rand(Math.max(r + 60, 200), H - r - 50) };
  }

  // ---------- Emitters & patterns ----------
  const emitters = [];
  function updateEmitters(t) {
    emitters.length = 0;
    emitters.push({ x: W / 2 + Math.sin(t * 0.7) * W * 0.32, y: 90 + Math.sin(t * 1.3) * 30 });
    if (round >= 3) emitters.push({ x: W * 0.12, y: H * 0.3 + Math.sin(t * 0.9) * H * 0.2 });
    if (round >= 3) emitters.push({ x: W * 0.88, y: H * 0.3 + Math.cos(t * 0.9) * H * 0.2 });
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
        p.t += 0.03 / k;
        const aL = Math.sin(p.ph * 1.6) * 0.9;
        const aR = Math.PI - Math.sin(p.ph * 1.6 + 1) * 0.9;
        const y = H * 0.18 + Math.sin(p.ph * 0.9) * H * 0.1;
        fire(-10, y, aL, 300 * spd(), 'm', '#ff8a3c');
        fire(W + 10, y, aR, 300 * spd(), 'm', '#ff8a3c');
      }
    },
    burst(p, dt, k) {
      // slow-then-accelerating shells: they hang in the air before lunging outward
      p.t -= dt;
      if (p.t > 0) return;
      p.t = 0.7 / k;
      const n = Math.round(30 + k * 10);
      const e = { x: rand(W * 0.2, W * 0.8), y: rand(60, H * 0.35) };
      const off = Math.random() * TAU;
      for (let i = 0; i < n; i++) fire(e.x, e.y, off + (i / n) * TAU, 30, 'l', '#ff4d6d', { acc: 260, vcap: 380 * spd() });
    },
  };
  const PATTERN_KEYS = Object.keys(PATTERNS);
  let activePatterns = [];
  function spd() { return 1 + Math.min(0.5, (round - 1) * 0.04); }
  function density() { return 1 + (round - 1) * 0.14; }

  function choosePatterns() {
    const count = Math.min(4, 2 + Math.floor((round - 1) / 2));
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
  let shotSoundT = 0, grazeSoundT = 0;
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
    document.getElementById('bestRecord').textContent = b ? `自己ベスト: ROUND ${b.round} ／ ${b.score} pts` : '';
  }

  function spawnFloater(text, color, x, y) {
    floaters.push({ text, color, x: x ?? W / 2, y: y ?? H * 0.28, life: 1.6, maxLife: 1.6 });
  }

  function startGame() {
    lives = 3; score = 0; graze = 0; round = 1; elapsed = 0;
    bullets = []; sparkles = []; floaters = [];
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
    hitThisRound = false;
  }

  function enterBarrage() {
    phase = 'barrage';
    phaseT = 0;
    barrageDur = 5 + Math.min(3, (round - 1) * 0.35);
    minClearance = Infinity;
    choosePatterns();
    flash = 0.35;
    shake = 8;
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

  function endGame() {
    state = 'ended';
    SFX.gameover();
    const best = loadBest();
    const reached = round;
    const isBest = !best || score > best.score;
    if (isBest) saveBest({ score, round: reached });
    document.getElementById('resultBody').textContent =
      `到達 ROUND ${reached}　スコア ${score}　GRAZE ${graze}${isBest ? '\n自己ベスト更新！' : ''}`;
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
      if (phaseT >= TELEGRAPH) { SFX.count(0); enterBarrage(); }
    } else if (phase === 'barrage') {
      updateEmitters(elapsed);
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
    const telegraph = phase === 'telegraph';
    const pulse = telegraph ? 0.5 + 0.5 * Math.sin(t * 10) : 0.5 + 0.5 * Math.sin(t * 3);
    ctx.save();
    const fill = ctx.createRadialGradient(safe.x, safe.y, 0, safe.x, safe.y, safe.r);
    fill.addColorStop(0, `rgba(255,40,70,${telegraph ? 0.1 + pulse * 0.12 : 0.1})`);
    fill.addColorStop(1, `rgba(255,40,70,${telegraph ? 0.22 + pulse * 0.15 : 0.2})`);
    ctx.fillStyle = fill;
    ctx.beginPath(); ctx.arc(safe.x, safe.y, safe.r, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#ff3b55';
    ctx.shadowColor = '#ff3b55';
    ctx.shadowBlur = 16 + pulse * 12;
    ctx.lineWidth = telegraph ? 3 + pulse * 2 : 3;
    ctx.beginPath(); ctx.arc(safe.x, safe.y, safe.r, 0, TAU); ctx.stroke();
    ctx.shadowBlur = 0;

    if (telegraph) {
      // shrinking countdown arc + big number
      const left = clamp(1 - phaseT / TELEGRAPH, 0, 1);
      ctx.strokeStyle = 'rgba(255,255,255,0.85)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(safe.x, safe.y, safe.r + 10, -Math.PI / 2, -Math.PI / 2 + TAU * left);
      ctx.stroke();
      const n = Math.max(1, Math.ceil(TELEGRAPH - phaseT));
      ctx.fillStyle = '#ffffff';
      ctx.font = `900 ${Math.round(safe.r * 0.9)}px Orbitron, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.shadowColor = '#ff3b55';
      ctx.shadowBlur = 20;
      ctx.fillText(String(n), safe.x, safe.y + 2);
      ctx.shadowBlur = 0;
      // guide line from player when outside the zone
      const d = Math.hypot(player.x - safe.x, player.y - safe.y);
      if (d > safe.r) {
        ctx.setLineDash([6, 8]);
        ctx.strokeStyle = 'rgba(255,90,110,0.45)';
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(player.x, player.y); ctx.lineTo(safe.x, safe.y); ctx.stroke();
        ctx.setLineDash([]);
      }
    } else if (phase === 'barrage') {
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.font = '700 11px Orbitron, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('SAFE', safe.x, safe.y - safe.r - 12);
    }
    ctx.restore();
  }

  function drawEmitters(t) {
    if (phase !== 'barrage') return;
    for (const e of emitters) {
      const g = ctx.createRadialGradient(e.x, e.y, 0, e.x, e.y, 34);
      g.addColorStop(0, 'rgba(255,255,255,0.95)');
      g.addColorStop(0.3, 'rgba(255,80,120,0.8)');
      g.addColorStop(1, 'rgba(255,80,120,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(e.x, e.y, 34 + Math.sin(t * 12) * 3, 0, TAU); ctx.fill();
    }
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
      ctx.fillText(`ROUND ${round} — 赤い円の中へ！`, W / 2, H * 0.2);
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

    if (state === 'playing') {
      elapsed += dt;
      updatePlayer(dt);
      updatePhase(dt);
      updateBullets(dt);
      updateHud();
    }

    ctx.save();
    if (shake > 0) {
      ctx.translate(rand(-shake, shake), rand(-shake, shake));
      shake = Math.max(0, shake - dt * 40);
    }
    drawBackground(t);
    if (state !== 'start') {
      drawSafeZone(t);
      drawEmitters(t);
      drawBullets();
      if (state === 'playing') drawPlayer(t);
    }
    drawEffects(dt);
    ctx.restore();

    if (INSPECT) {
      window.__DEBUG_STATE__ = {
        state, phase, phaseT, round, lives, score, graze, safe, player, stats,
        bulletCount: bullets.length, minClearance, PLAYER_HIT,
      };
    }
    requestAnimationFrame(loop);
  }

  document.getElementById('startBtn').addEventListener('click', e => { e.currentTarget.blur(); resumeAudio(); startGame(); });
  document.getElementById('restartBtn').addEventListener('click', e => { e.currentTarget.blur(); resumeAudio(); startGame(); });
  showBest();
  requestAnimationFrame(loop);
})();
