(() => {
  'use strict';

  const DEBUG = /[?&]debug/.test(location.search);
  const INSPECT = DEBUG || /[?&]inspect/.test(location.search);

  // ---------- Canvas setup ----------
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  let W = 0, H = 0, DPR = Math.min(window.devicePixelRatio || 1, 2);

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

  function noiseBurst({ dur = 0.25, gain = 0.15, delay = 0, filterFreq = 1200, type = 'lowpass' }) {
    if (!audioReady) return;
    const t0 = actx.currentTime + delay;
    const bufferSize = actx.sampleRate * dur;
    const buffer = actx.createBuffer(1, bufferSize, actx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
    }
    const src = actx.createBufferSource();
    src.buffer = buffer;
    const filter = actx.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(filterFreq, t0);
    filter.frequency.exponentialRampToValueAtTime(type === 'lowpass' ? 80 : 4000, t0 + dur);
    const g = actx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filter).connect(g).connect(actx.destination);
    src.start(t0);
  }

  const SFX = {
    absorbSmall: () => { beep({ freq: 320, dur: 0.12, type: 'sine', gain: 0.1, slide: -180 }); },
    absorbMed: () => { beep({ freq: 220, dur: 0.18, type: 'sine', gain: 0.12, slide: -140 }); noiseBurst({ dur: 0.15, gain: 0.08 }); },
    absorbBig: () => { beep({ freq: 140, dur: 0.3, type: 'sine', gain: 0.16, slide: -100 }); noiseBurst({ dur: 0.3, gain: 0.14 }); },
    spit: () => beep({ freq: 300, dur: 0.12, type: 'triangle', gain: 0.09, slide: 260 }),
    paralyze: () => { beep({ freq: 900, dur: 0.1, type: 'square', gain: 0.08, slide: -400 }); noiseBurst({ dur: 0.12, gain: 0.1, type: 'highpass', filterFreq: 300 }); },
    empty: () => beep({ freq: 140, dur: 0.06, type: 'square', gain: 0.05 }),
    detect: () => beep({ freq: 500, dur: 0.04, type: 'sine', gain: 0.03, slide: 200 }),
    gameover: () => { beep({ freq: 300, dur: 0.4, type: 'sawtooth', gain: 0.12, slide: -250 }); beep({ freq: 200, dur: 0.5, type: 'sawtooth', gain: 0.12, slide: -150, delay: 0.15 }); },
  };

  // ---------- Utility ----------
  const rand = (a, b) => a + Math.random() * (b - a);
  const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function lerp(a, b, t) { return a + (b - a) * t; }

  // ---------- Input ----------
  const mouse = { x: 0, y: 0 };
  let spitRequested = false;
  window.addEventListener('mousemove', e => { mouse.x = e.clientX; mouse.y = e.clientY; });
  window.addEventListener('mousedown', () => { spitRequested = true; });
  window.addEventListener('keydown', e => {
    if (e.key === ' ') { e.preventDefault(); spitRequested = true; }
  });
  window.addEventListener('touchmove', e => {
    const t = e.touches[0];
    mouse.x = t.clientX; mouse.y = t.clientY;
  }, { passive: true });
  window.addEventListener('touchstart', e => {
    const t = e.touches[0];
    mouse.x = t.clientX; mouse.y = t.clientY;
    spitRequested = true;
  }, { passive: true });

  mouse.x = window.innerWidth / 2;
  mouse.y = window.innerHeight / 2;

  // ---------- Background: nebula starfield ----------
  const stars = [];
  for (let i = 0; i < 180; i++) {
    stars.push({ x: rand(0, 2400), y: rand(0, 2400), r: rand(0.4, 1.8), tw: rand(0, Math.PI * 2), hue: rand(0, 1) });
  }

  function drawBackground(dt) {
    ctx.fillStyle = '#030006';
    ctx.fillRect(0, 0, W, H);

    for (const s of stars) {
      s.tw += dt * 1.6;
      const alpha = 0.35 + Math.sin(s.tw) * 0.25;
      const color = s.hue < 0.5 ? `rgba(185,140,255,${clamp(alpha,0,1)})` : `rgba(107,232,255,${clamp(alpha,0,1)})`;
      ctx.fillStyle = color;
      const sx = (s.x % W + W) % W;
      const sy = (s.y % H + H) % H;
      ctx.beginPath();
      ctx.arc(sx, sy, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // ---------- Particles ----------
  let particles = [];
  function spawnParticles(x, y, color, count = 12, speed = 160, life = 0.6, inward = null) {
    for (let i = 0; i < count; i++) {
      const a = rand(0, Math.PI * 2);
      const s = rand(speed * 0.3, speed);
      particles.push({
        x, y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        life: rand(life * 0.5, life),
        maxLife: life,
        color,
        r: rand(1.5, 3.2),
        inward,
      });
    }
  }

  function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      if (p.inward) {
        const dx = p.inward.x - p.x, dy = p.inward.y - p.y;
        const d = Math.hypot(dx, dy) || 1;
        p.vx += (dx / d) * 400 * dt;
        p.vy += (dy / d) * 400 * dt;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.95;
      p.vy *= 0.95;
      p.life -= dt;
      if (p.life <= 0) particles.splice(i, 1);
    }
  }

  function drawParticles() {
    for (const p of particles) {
      const alpha = clamp(p.life / p.maxLife, 0, 1);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color;
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  // ---------- Floating text ----------
  let floaters = [];
  function spawnFloater(x, y, text, color = '#ffd166') {
    floaters.push({ x, y, text, color, life: 0.9, maxLife: 0.9 });
  }
  function updateFloaters(dt) {
    for (let i = floaters.length - 1; i >= 0; i--) {
      const f = floaters[i];
      f.y -= 36 * dt;
      f.life -= dt;
      if (f.life <= 0) floaters.splice(i, 1);
    }
  }
  function drawFloaters() {
    ctx.save();
    ctx.font = 'bold 15px Orbitron, sans-serif';
    ctx.textAlign = 'center';
    for (const f of floaters) {
      ctx.globalAlpha = clamp(f.life / f.maxLife, 0, 1);
      ctx.fillStyle = f.color;
      ctx.shadowColor = f.color;
      ctx.shadowBlur = 8;
      ctx.fillText(f.text, f.x, f.y);
    }
    ctx.restore();
  }

  // ---------- Player (black hole) ----------
  const player = {
    x: 0, y: 0,
    radius: 18,
    ammo: 0,
    maxAmmo: 6,
    spitCooldown: 0,
    diskAngle: 0,
  };

  function pullRadius() { return player.radius * 7; }
  function pullConst() { return player.radius * 60; }

  function resetPlayer() {
    player.x = W / 2;
    player.y = H / 2;
    player.radius = DEBUG ? 60 : 18;
    player.ammo = DEBUG ? 6 : 0;
    player.spitCooldown = 0;
  }

  function growPlayer(amount) {
    player.radius += amount / (1 + player.radius / 130);
  }

  // ---------- Critters ----------
  const TYPES = {
    small:  { r: 8,  fleeSpeed: 180, score: 10, color: '#6be8ff', paraColor: '#bff5ff' },
    medium: { r: 14, fleeSpeed: 145, score: 25, color: '#8cff9e', paraColor: '#d6ffdc' },
    large:  { r: 22, fleeSpeed: 100, score: 60, color: '#ff9d6b', paraColor: '#ffd9c2' },
  };

  let critters = [];
  let critterId = 0;

  function spawnCritter(forceType) {
    let type = forceType;
    if (!type) {
      const unlocked = ['small'];
      if (player.radius > 28) unlocked.push('medium', 'medium');
      if (player.radius > 55) unlocked.push('large');
      type = unlocked[Math.floor(rand(0, unlocked.length))];
    }
    const t = TYPES[type];
    let x, y, tries = 0;
    do {
      x = rand(t.r + 10, W - t.r - 10);
      y = rand(t.r + 10, H - t.r - 10);
      tries++;
    } while (dist(x, y, player.x, player.y) < pullRadius() * 0.9 && tries < 20);

    critters.push({
      id: critterId++,
      type, x, y,
      vx: rand(-30, 30), vy: rand(-30, 30),
      r: t.r,
      state: 'roam',
      wanderAngle: rand(0, Math.PI * 2),
      wanderTimer: rand(0.5, 1.5),
      paralyzeTimer: 0,
      blink: rand(0, Math.PI * 2),
    });
  }

  function maintainPopulation(dt) {
    const cap = DEBUG ? 14 : Math.min(18, 6 + Math.floor(elapsed / 8));
    spawnAccum -= dt;
    if (critters.length < cap && spawnAccum <= 0) {
      spawnCritter();
      spawnAccum = rand(0.4, 1.0);
    }
  }
  let spawnAccum = 0;

  // ---------- Projectiles ----------
  let projectiles = [];

  function trySpit() {
    if (player.spitCooldown > 0 || player.ammo <= 0) {
      if (player.ammo <= 0) SFX.empty();
      return;
    }
    player.ammo -= 1;
    player.spitCooldown = 0.35;
    const a = Math.atan2(mouse.y - player.y, mouse.x - player.x);
    projectiles.push({
      x: player.x + Math.cos(a) * (player.radius + 6),
      y: player.y + Math.sin(a) * (player.radius + 6),
      vx: Math.cos(a) * 640,
      vy: Math.sin(a) * 640,
      r: 6,
      life: 1.6,
    });
    SFX.spit();
  }

  // ---------- Game state ----------
  let state = 'start';
  let score = 0;
  let eaten = 0;
  let combo = 0;
  let comboTimer = 0;
  let timeLeft = 90;
  let elapsed = 0;
  let shakeTime = 0, shakeMag = 0;
  let lastTime = performance.now();

  function triggerShake(mag, time) {
    shakeMag = Math.max(shakeMag, mag);
    shakeTime = Math.max(shakeTime, time);
  }

  function startGame() {
    resetPlayer();
    critters = [];
    projectiles = [];
    particles = [];
    floaters = [];
    score = 0;
    eaten = 0;
    combo = 0;
    comboTimer = 0;
    timeLeft = 90;
    elapsed = 0;
    spawnAccum = 0;
    for (let i = 0; i < (DEBUG ? 10 : 5); i++) spawnCritter('small');
    state = 'playing';
    document.getElementById('startScreen').classList.add('hidden');
    document.getElementById('gameOverScreen').classList.add('hidden');
  }

  function endGame() {
    state = 'gameover';
    SFX.gameover();
    document.getElementById('finalScore').textContent =
      `SCORE ${score} ／ EATEN ${eaten} ／ MAX MASS ${Math.round(player.radius)}`;
    document.getElementById('gameOverScreen').classList.remove('hidden');
  }

  function addScore(base, x, y) {
    combo += 1;
    comboTimer = 2.0;
    const mult = 1 + Math.min(combo - 1, 8) * 0.15;
    const gained = Math.round(base * mult);
    score += gained;
    spawnFloater(x, y, `+${gained}${combo > 1 ? ` x${mult.toFixed(1)}` : ''}`, combo > 3 ? '#ff6bd6' : '#ffd166');
  }

  // ---------- Updates ----------
  function updatePlayer(dt) {
    const chase = 6.5;
    player.x = lerp(player.x, mouse.x, clamp(chase * dt, 0, 1));
    player.y = lerp(player.y, mouse.y, clamp(chase * dt, 0, 1));
    player.x = clamp(player.x, 0, W);
    player.y = clamp(player.y, 0, H);
    player.diskAngle += dt * 1.4;
    player.spitCooldown = Math.max(0, player.spitCooldown - dt);

    if (spitRequested) {
      trySpit();
    }
    spitRequested = false;
  }

  function updateCritters(dt) {
    const pr = pullRadius();
    const pc = pullConst();

    for (const c of critters) {
      c.blink += dt * 5;
      const d = dist(c.x, c.y, player.x, player.y);

      if (c.state === 'paralyzed') {
        c.paralyzeTimer -= dt;
        if (d < pr) {
          const pullMag = clamp(pc / Math.max(d, 22), 0, 300);
          const dx = (player.x - c.x) / (d || 1), dy = (player.y - c.y) / (d || 1);
          c.vx = dx * pullMag;
          c.vy = dy * pullMag;
        } else {
          c.vx *= 0.9; c.vy *= 0.9;
        }
        if (c.paralyzeTimer <= 0) {
          c.state = d < pr ? 'flee' : 'roam';
        }
      } else if (d < pr) {
        if (c.state !== 'flee') SFX.detect();
        c.state = 'flee';
        const fleeSpeed = TYPES[c.type].fleeSpeed;
        const fdx = (c.x - player.x) / (d || 1), fdy = (c.y - player.y) / (d || 1);
        const pullMag = clamp(pc / Math.max(d, 24), 0, 340);
        const pdx = -fdx, pdy = -fdy;
        c.vx = fdx * fleeSpeed + pdx * pullMag;
        c.vy = fdy * fleeSpeed + pdy * pullMag;
      } else {
        c.state = 'roam';
        c.wanderTimer -= dt;
        if (c.wanderTimer <= 0) {
          c.wanderAngle += rand(-1.2, 1.2);
          c.wanderTimer = rand(0.6, 1.6);
        }
        const wanderSpeed = 45;
        c.vx = lerp(c.vx, Math.cos(c.wanderAngle) * wanderSpeed, dt * 2);
        c.vy = lerp(c.vy, Math.sin(c.wanderAngle) * wanderSpeed, dt * 2);
      }

      c.x += c.vx * dt;
      c.y += c.vy * dt;

      if (c.x < c.r) { c.x = c.r; c.vx = Math.abs(c.vx); c.wanderAngle = 0; }
      if (c.x > W - c.r) { c.x = W - c.r; c.vx = -Math.abs(c.vx); c.wanderAngle = Math.PI; }
      if (c.y < c.r) { c.y = c.r; c.vy = Math.abs(c.vy); c.wanderAngle = Math.PI / 2; }
      if (c.y > H - c.r) { c.y = H - c.r; c.vy = -Math.abs(c.vy); c.wanderAngle = -Math.PI / 2; }
    }
  }

  function updateProjectiles(dt) {
    for (let i = projectiles.length - 1; i >= 0; i--) {
      const p = projectiles[i];
      p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt;
      if (p.life <= 0 || p.x < -20 || p.x > W + 20 || p.y < -20 || p.y > H + 20) {
        projectiles.splice(i, 1);
      }
    }
  }

  function handleCollisions() {
    // projectiles vs critters (paralyze)
    for (let i = projectiles.length - 1; i >= 0; i--) {
      const p = projectiles[i];
      for (const c of critters) {
        if (c.state === 'paralyzed' || c.state === 'consumed') continue;
        if (dist(p.x, p.y, c.x, c.y) < p.r + c.r) {
          c.state = 'paralyzed';
          c.paralyzeTimer = 3.2;
          c.vx = 0; c.vy = 0;
          spawnParticles(c.x, c.y, TYPES[c.type].paraColor, 10, 140, 0.4);
          SFX.paralyze();
          projectiles.splice(i, 1);
          break;
        }
      }
    }

    // critters vs player (consume)
    for (let i = critters.length - 1; i >= 0; i--) {
      const c = critters[i];
      const d = dist(c.x, c.y, player.x, player.y);
      if (d < player.radius * 0.92) {
        if (player.radius >= c.r * 1.05) {
          const t = TYPES[c.type];
          spawnParticles(c.x, c.y, t.color, 18, 220, 0.5, { x: player.x, y: player.y });
          if (t === TYPES.large) { SFX.absorbBig(); triggerShake(9, 0.2); }
          else if (t === TYPES.medium) { SFX.absorbMed(); triggerShake(4, 0.12); }
          else { SFX.absorbSmall(); }
          addScore(t.score, c.x, c.y);
          growPlayer(c.r * 0.55);
          player.ammo = Math.min(player.maxAmmo, player.ammo + 1);
          eaten += 1;
          critters.splice(i, 1);
        } else {
          // too big to eat: gently repel critter to the rim
          const dx = (c.x - player.x) / (d || 1), dy = (c.y - player.y) / (d || 1);
          c.x = player.x + dx * player.radius * 0.95;
          c.y = player.y + dy * player.radius * 0.95;
        }
      }
    }
  }

  function updateUI() {
    document.getElementById('score').textContent = `SCORE ${score}`;
    document.getElementById('timer').textContent = `TIME ${Math.max(0, Math.ceil(timeLeft))}`;
    document.getElementById('mass').textContent = `MASS ${Math.round(player.radius)}`;
    document.getElementById('eaten').textContent = `EATEN ${eaten}`;
    document.getElementById('combo').textContent = combo > 1 ? `COMBO x${combo}` : '';

    const row = document.getElementById('ammoRow');
    row.innerHTML = '';
    for (let i = 0; i < player.maxAmmo; i++) {
      const d = document.createElement('div');
      d.className = 'ammo' + (i < player.ammo ? '' : ' empty');
      row.appendChild(d);
    }
  }

  // ---------- Drawing ----------
  function drawPlayer() {
    ctx.save();
    ctx.translate(player.x, player.y);

    // accretion disk
    const diskR = player.radius * 2.4;
    for (let i = 0; i < 3; i++) {
      const a0 = player.diskAngle * (i % 2 === 0 ? 1 : -1) + i * 2.1;
      ctx.save();
      ctx.rotate(a0);
      const grad = ctx.createLinearGradient(-diskR, 0, diskR, 0);
      grad.addColorStop(0, 'rgba(185,140,255,0)');
      grad.addColorStop(0.5, `rgba(255,107,214,${0.35 - i * 0.08})`);
      grad.addColorStop(1, 'rgba(107,232,255,0)');
      ctx.strokeStyle = grad;
      ctx.lineWidth = 3 - i * 0.6;
      ctx.beginPath();
      ctx.ellipse(0, 0, diskR - i * 8, (diskR - i * 8) * 0.32, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // ammo orbs orbiting
    for (let i = 0; i < player.ammo; i++) {
      const a = player.diskAngle * 1.6 + (i / Math.max(1, player.ammo)) * Math.PI * 2;
      const orbR = player.radius + 16;
      const ox = Math.cos(a) * orbR, oy = Math.sin(a) * orbR * 0.5;
      ctx.save();
      ctx.shadowColor = '#b98cff';
      ctx.shadowBlur = 10;
      ctx.fillStyle = '#e8d9ff';
      ctx.beginPath();
      ctx.arc(ox, oy, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // event horizon glow rim
    const rim = ctx.createRadialGradient(0, 0, player.radius * 0.6, 0, 0, player.radius * 1.5);
    rim.addColorStop(0, 'rgba(185,140,255,0.55)');
    rim.addColorStop(0.6, 'rgba(255,107,214,0.25)');
    rim.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = rim;
    ctx.beginPath();
    ctx.arc(0, 0, player.radius * 1.5, 0, Math.PI * 2);
    ctx.fill();

    // black core
    ctx.fillStyle = '#050008';
    ctx.beginPath();
    ctx.arc(0, 0, player.radius, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  function drawCritter(c) {
    const t = TYPES[c.type];
    const color = c.state === 'paralyzed' ? t.paraColor : t.color;
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.shadowColor = color;
    ctx.shadowBlur = c.state === 'paralyzed' ? 18 : 10;
    ctx.fillStyle = color + (c.state === 'flee' ? 'cc' : '99');
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(0, 0, c.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // eyes
    const blinkOpen = Math.abs(Math.sin(c.blink * 0.3)) > 0.08;
    ctx.fillStyle = '#0a0010';
    const eyeOffset = c.r * 0.32;
    if (blinkOpen) {
      ctx.beginPath();
      ctx.arc(-eyeOffset, -c.r * 0.1, c.r * 0.14, 0, Math.PI * 2);
      ctx.arc(eyeOffset, -c.r * 0.1, c.r * 0.14, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    if (c.state === 'paralyzed') {
      const pct = clamp(c.paralyzeTimer / 3.2, 0, 1);
      ctx.save();
      ctx.translate(c.x, c.y - c.r - 10);
      ctx.strokeStyle = 'rgba(255,255,255,0.25)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, 6, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = '#ffd166';
      ctx.beginPath();
      ctx.arc(0, 0, 6, -Math.PI / 2, -Math.PI / 2 + pct * Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawProjectiles() {
    for (const p of projectiles) {
      ctx.save();
      ctx.shadowColor = '#e8d9ff';
      ctx.shadowBlur = 12;
      ctx.fillStyle = '#f5eeff';
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  function drawCursorReticle() {
    if (state !== 'playing') return;
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(mouse.x, mouse.y, 5, 0, Math.PI * 2);
    ctx.moveTo(mouse.x - 9, mouse.y);
    ctx.lineTo(mouse.x - 3, mouse.y);
    ctx.moveTo(mouse.x + 3, mouse.y);
    ctx.lineTo(mouse.x + 9, mouse.y);
    ctx.moveTo(mouse.x, mouse.y - 9);
    ctx.lineTo(mouse.x, mouse.y - 3);
    ctx.moveTo(mouse.x, mouse.y + 3);
    ctx.lineTo(mouse.x, mouse.y + 9);
    ctx.stroke();
    ctx.restore();
  }

  // ---------- Main loop ----------
  function loop(now) {
    const dt = Math.min(0.033, (now - lastTime) / 1000);
    lastTime = now;

    let shakeX = 0, shakeY = 0;
    if (shakeTime > 0) {
      shakeTime -= dt;
      shakeX = rand(-shakeMag, shakeMag);
      shakeY = rand(-shakeMag, shakeMag);
      shakeMag *= 0.9;
    } else {
      shakeMag = 0;
    }

    ctx.save();
    ctx.translate(shakeX, shakeY);
    drawBackground(dt);

    if (state === 'playing') {
      updatePlayer(dt);
      updateCritters(dt);
      updateProjectiles(dt);
      handleCollisions();
      maintainPopulation(dt);

      elapsed += dt;
      timeLeft -= dt;
      if (comboTimer > 0) {
        comboTimer -= dt;
        if (comboTimer <= 0) combo = 0;
      }
      if (timeLeft <= 0) {
        timeLeft = 0;
        endGame();
      }
      updateUI();
    }

    updateParticles(dt);
    updateFloaters(dt);

    if (state === 'playing' || state === 'gameover') {
      for (const c of critters) drawCritter(c);
      drawProjectiles();
      drawPlayer();
    }
    drawParticles();
    drawFloaters();
    drawCursorReticle();

    ctx.restore();

    if (INSPECT) {
      window.__DEBUG_STATE__ = { player, critters, projectiles, score, eaten, state, timeLeft };
    }

    requestAnimationFrame(loop);
  }

  // ---------- Boot ----------
  document.getElementById('startBtn').addEventListener('click', () => {
    resumeAudio();
    startGame();
  });
  document.getElementById('restartBtn').addEventListener('click', () => {
    resumeAudio();
    startGame();
  });

  player.x = W / 2;
  player.y = H / 2;
  requestAnimationFrame(loop);
})();
