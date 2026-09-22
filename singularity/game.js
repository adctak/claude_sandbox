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
    hole.x = W / 2;
    hole.y = H / 2;
  }

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
    fire: () => beep({ freq: 620, dur: 0.045, type: 'square', gain: 0.04, slide: -260 }),
    killEnemy: () => { beep({ freq: 260, dur: 0.14, type: 'sawtooth', gain: 0.11, slide: -140 }); noiseBurst({ dur: 0.14, gain: 0.08 }); },
    absorbEnemy: () => beep({ freq: 340, dur: 0.16, type: 'sine', gain: 0.09, slide: -160 }),
    defuse: () => { beep({ freq: 700, dur: 0.1, type: 'triangle', gain: 0.09, slide: 300 }); noiseBurst({ dur: 0.1, gain: 0.08, type: 'highpass', filterFreq: 500 }); },
    bombDrop: () => beep({ freq: 200, dur: 0.08, type: 'square', gain: 0.05, slide: -60 }),
    boom: () => { beep({ freq: 90, dur: 0.4, type: 'sawtooth', gain: 0.2, slide: -60 }); noiseBurst({ dur: 0.45, gain: 0.28, filterFreq: 900 }); },
    hurt: () => beep({ freq: 140, dur: 0.25, type: 'sawtooth', gain: 0.12, slide: -80 }),
    gameover: () => { beep({ freq: 300, dur: 0.4, type: 'sawtooth', gain: 0.12, slide: -250 }); beep({ freq: 200, dur: 0.5, type: 'sawtooth', gain: 0.12, slide: -150, delay: 0.15 }); },
  };

  // ---------- Utility ----------
  const rand = (a, b) => a + Math.random() * (b - a);
  const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  // ---------- Input ----------
  const mouse = { x: 0, y: 0 };
  let firing = false;
  let polarityTarget = 1; // ArrowDown -> +1 (引力/attract), ArrowUp -> -1 (斥力/repel); persists until changed
  window.addEventListener('mousemove', e => { mouse.x = e.clientX; mouse.y = e.clientY; });
  window.addEventListener('mousedown', () => { firing = true; });
  window.addEventListener('mouseup', () => { firing = false; });
  window.addEventListener('keydown', e => {
    if (e.key === ' ') { e.preventDefault(); firing = true; }
    if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') { e.preventDefault(); polarityTarget = 1; }
    if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') { e.preventDefault(); polarityTarget = -1; }
  });
  window.addEventListener('keyup', e => {
    if (e.key === ' ') firing = false;
  });
  window.addEventListener('touchmove', e => {
    const t = e.touches[0];
    mouse.x = t.clientX; mouse.y = t.clientY;
  }, { passive: true });
  window.addEventListener('touchstart', e => {
    const t = e.touches[0];
    mouse.x = t.clientX; mouse.y = t.clientY;
    firing = true;
  }, { passive: true });
  window.addEventListener('touchend', () => { firing = false; }, { passive: true });

  mouse.x = window.innerWidth / 2;
  mouse.y = window.innerHeight / 2 - 100;

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
      const color = s.hue < 0.5 ? `rgba(185,140,255,${clamp(alpha, 0, 1)})` : `rgba(107,232,255,${clamp(alpha, 0, 1)})`;
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

  // ---------- The black hole (fixed at center) ----------
  const hole = {
    x: 0, y: 0,
    radius: 32,
    maxRadius: 66,
    diskAngle: 0,
    fireCooldown: 0,
  };

  resize();
  window.addEventListener('resize', resize);

  // ---------- Enemies ----------
  const ENEMY_TYPES = {
    drifter: {
      r: 10, hits: 1, radialSpeed: 52, tangentSpeed: 80,
      dropMin: 2.2, dropMax: 3.6, scoreKill: 35, scoreAbsorb: 15,
      color: '#8cff9e',
    },
    brute: {
      r: 17, hits: 2, radialSpeed: 34, tangentSpeed: 54,
      dropMin: 1.5, dropMax: 2.5, scoreKill: 75, scoreAbsorb: 30,
      color: '#ff9d6b',
    },
  };

  let enemies = [];
  let enemyId = 0;

  function spawnEnemy() {
    const useBrute = elapsed > 28 && Math.random() < clamp(0.15 + elapsed / 300, 0.15, 0.4);
    const type = useBrute ? 'brute' : 'drifter';
    const t = ENEMY_TYPES[type];
    const edge = Math.floor(rand(0, 4));
    let x, y;
    if (edge === 0) { x = rand(0, W); y = -t.r - 10; }
    else if (edge === 1) { x = W + t.r + 10; y = rand(0, H); }
    else if (edge === 2) { x = rand(0, W); y = H + t.r + 10; }
    else { x = -t.r - 10; y = rand(0, H); }

    enemies.push({
      id: enemyId++,
      type, x, y,
      r: t.r,
      hp: t.hits,
      spiralDir: Math.random() < 0.5 ? 1 : -1,
      dropTimer: rand(t.dropMin, t.dropMax),
      dodgeX: 0, dodgeY: 0,
      blink: rand(0, Math.PI * 2),
    });
  }

  let spawnAccum = 0;
  function maintainSpawns(dt) {
    const interval = clamp(2.2 - elapsed * 0.02, 0.6, 2.2);
    const cap = Math.min(14, 3 + Math.floor(elapsed / 10));
    spawnAccum -= dt;
    if (enemies.length < cap && spawnAccum <= 0) {
      spawnEnemy();
      spawnAccum = interval * rand(0.7, 1.3);
    }
  }

  // ---------- Bombs ----------
  let bombs = [];
  let bombId = 0;

  function dropBomb(x, y, sourceEnemyId) {
    bombs.push({ id: bombId++, x, y, age: 0, r: 7, sourceEnemyId });
    SFX.bombDrop();
    spawnParticles(x, y, '#ffd166', 6, 60, 0.3);
  }

  // ---------- Orbs (player projectiles) ----------
  let orbs = [];

  function fireOrb() {
    if (hole.fireCooldown > 0) return;
    hole.fireCooldown = 0.12;
    const a = Math.atan2(mouse.y - hole.y, mouse.x - hole.x);
    orbs.push({
      x: hole.x + Math.cos(a) * (hole.radius + 6),
      y: hole.y + Math.sin(a) * (hole.radius + 6),
      vx: Math.cos(a) * 760,
      vy: Math.sin(a) * 760,
      r: 5,
      life: 1.4,
    });
    SFX.fire();
  }

  // ---------- Game state ----------
  let state = 'start';
  let score = 0;
  let killed = 0;
  let defused = 0;
  let hp = 5;
  const maxHp = 5;
  let combo = 0;
  let comboTimer = 0;
  let elapsed = 0;
  let shakeTime = 0, shakeMag = 0;
  let flashAlpha = 0;
  let lastTime = performance.now();
  let polarity = 1; // +1 = full attraction (引力), -1 = full repulsion (斥力)
  const POLARITY_RATE = 3.5;

  function triggerShake(mag, time) {
    shakeMag = Math.max(shakeMag, mag);
    shakeTime = Math.max(shakeTime, time);
  }

  function startGame() {
    hole.radius = 32;
    hole.fireCooldown = 0;
    enemies = [];
    bombs = [];
    orbs = [];
    particles = [];
    floaters = [];
    score = 0;
    killed = 0;
    defused = 0;
    hp = maxHp;
    combo = 0;
    comboTimer = 0;
    elapsed = 0;
    spawnAccum = 0;
    flashAlpha = 0;
    polarity = 1;
    polarityTarget = 1;
    for (let i = 0; i < 2; i++) spawnEnemy();
    state = 'playing';
    document.getElementById('startScreen').classList.add('hidden');
    document.getElementById('gameOverScreen').classList.add('hidden');
  }

  function endGame() {
    state = 'gameover';
    SFX.gameover();
    document.getElementById('finalScore').textContent =
      `SCORE ${score} ／ 撃破 ${killed} ／ 解体 ${defused} ／ 生存 ${Math.floor(elapsed)}秒`;
    document.getElementById('gameOverScreen').classList.remove('hidden');
  }

  function addScore(base, x, y, color) {
    combo += 1;
    comboTimer = 2.0;
    const mult = 1 + Math.min(combo - 1, 8) * 0.12;
    const gained = Math.round(base * mult);
    score += gained;
    spawnFloater(x, y, `+${gained}${combo > 1 ? ` x${mult.toFixed(1)}` : ''}`, color || '#ffd166');
  }

  function loseHp(amount) {
    hp = Math.max(0, hp - amount);
    combo = 0;
    triggerShake(14, 0.35);
    flashAlpha = 0.55;
    SFX.hurt();
    if (hp <= 0) endGame();
  }

  // ---------- Updates ----------
  function updateHole(dt) {
    hole.diskAngle += dt * 1.4;
    hole.fireCooldown = Math.max(0, hole.fireCooldown - dt);
    if (firing) fireOrb();

    const dir = Math.sign(polarityTarget - polarity);
    if (dir !== 0) {
      polarity = clamp(polarity + dir * POLARITY_RATE * dt, -1, 1);
      if (Math.abs(polarity - polarityTarget) < 0.02) polarity = polarityTarget;
    }
    if (INSPECT && typeof window.__FORCE_POLARITY__ === 'number') polarity = window.__FORCE_POLARITY__;
  }

  function updateEnemies(dt) {
    for (let i = enemies.length - 1; i >= 0; i--) {
      const e = enemies[i];
      e.blink += dt * 5;
      const dx = hole.x - e.x, dy = hole.y - e.y;
      const d = Math.hypot(dx, dy) || 1;

      if (d < hole.radius * 0.85) {
        const t = ENEMY_TYPES[e.type];
        if (polarity >= 0) {
          // attraction: enemies are harmless food — they feed and slightly grow the hole
          spawnParticles(e.x, e.y, t.color, 14, 200, 0.5, { x: hole.x, y: hole.y });
          addScore(t.scoreAbsorb, e.x, e.y, '#8cff9e');
          SFX.absorbEnemy();
          hole.radius = Math.min(hole.maxRadius, hole.radius + 0.35);
        } else {
          // repulsion: contact now counts as a hit — enemies are destroyed on touch
          spawnParticles(e.x, e.y, t.color, 16, 260, 0.4);
          addScore(t.scoreKill, e.x, e.y, '#6be8ff');
          SFX.killEnemy();
          killed += 1;
        }
        enemies.splice(i, 1);
        continue;
      }

      const t = ENEMY_TYPES[e.type];
      const rx = dx / d, ry = dy / d;
      const tx = -ry * e.spiralDir, ty = rx * e.spiralDir;
      const tangentFactor = clamp(d / 260, 0.25, 1);

      // reactive dodge: steer away from any orb heading roughly towards this enemy
      let dodgeX = 0, dodgeY = 0;
      for (const o of orbs) {
        const odx = e.x - o.x, ody = e.y - o.y;
        const od = Math.hypot(odx, ody);
        if (od < 160) {
          const orbDir = Math.atan2(o.vy, o.vx);
          const toEnemy = Math.atan2(ody, odx);
          let diff = Math.atan2(Math.sin(orbDir - toEnemy), Math.cos(orbDir - toEnemy));
          if (Math.abs(diff) < 0.5) {
            const perp = { x: -Math.sin(orbDir), y: Math.cos(orbDir) };
            const side = (odx * perp.x + ody * perp.y) >= 0 ? 1 : -1;
            const strength = (1 - od / 160) * 260;
            dodgeX += perp.x * side * strength;
            dodgeY += perp.y * side * strength;
          }
        }
      }
      e.dodgeX += (dodgeX - e.dodgeX) * clamp(dt * 8, 0, 1);
      e.dodgeY += (dodgeY - e.dodgeY) * clamp(dt * 8, 0, 1);

      const speedScale = 1 + Math.min(elapsed / 90, 0.6);
      const vx = (rx * t.radialSpeed * speedScale + tx * t.tangentSpeed * tangentFactor) * polarity + e.dodgeX;
      const vy = (ry * t.radialSpeed * speedScale + ty * t.tangentSpeed * tangentFactor) * polarity + e.dodgeY;
      e.x += vx * dt;
      e.y += vy * dt;

      e.dropTimer -= dt;
      if (e.dropTimer <= 0 && d > hole.radius * 2.6) {
        dropBomb(e.x, e.y, e.id);
        e.dropTimer = rand(t.dropMin, t.dropMax);
      }
    }
  }

  function updateBombs(dt) {
    for (let i = bombs.length - 1; i >= 0; i--) {
      const b = bombs[i];
      b.age += dt;
      const dx = hole.x - b.x, dy = hole.y - b.y;
      const d = Math.hypot(dx, dy) || 1;

      if (d < hole.radius * 0.85) {
        if (polarity >= 0) {
          // attraction: the bomb gets sucked in and detonates on the core
          spawnParticles(b.x, b.y, '#ff5b5b', 26, 280, 0.6);
          triggerShake(16, 0.4);
          SFX.boom();
          loseHp(1);
        } else {
          // repulsion: it's still touching the core right as polarity flips — fizzles harmlessly
          spawnParticles(b.x, b.y, '#ffd166', 10, 140, 0.35);
        }
        bombs.splice(i, 1);
        continue;
      }

      // repulsion turns a live bomb into a weapon: it explodes on the first enemy it hits
      // (armed after a brief fuse so it doesn't instantly detonate on the enemy that just dropped it)
      if (polarity < 0 && b.age > 0.35) {
        let exploded = false;
        for (let j = enemies.length - 1; j >= 0; j--) {
          const e = enemies[j];
          if (e.id === b.sourceEnemyId) continue;
          if (dist(b.x, b.y, e.x, e.y) < b.r + e.r) {
            const t = ENEMY_TYPES[e.type];
            spawnParticles(e.x, e.y, '#ff9d6b', 22, 260, 0.5);
            triggerShake(6, 0.15);
            SFX.boom();
            addScore(t.scoreKill, e.x, e.y, '#ff9d6b');
            killed += 1;
            enemies.splice(j, 1);
            exploded = true;
            break;
          }
        }
        if (exploded) {
          bombs.splice(i, 1);
          continue;
        }
      }

      const speed = clamp(b.age * 16, 0, 230) * polarity;
      b.x += (dx / d) * speed * dt;
      b.y += (dy / d) * speed * dt;
    }
  }

  function updateOrbs(dt) {
    for (let i = orbs.length - 1; i >= 0; i--) {
      const o = orbs[i];
      o.x += o.vx * dt; o.y += o.vy * dt; o.life -= dt;
      if (o.life <= 0 || o.x < -20 || o.x > W + 20 || o.y < -20 || o.y > H + 20) {
        orbs.splice(i, 1);
      }
    }
  }

  function handleCollisions() {
    for (let i = orbs.length - 1; i >= 0; i--) {
      const o = orbs[i];
      let hitSomething = false;

      for (let j = bombs.length - 1; j >= 0; j--) {
        const b = bombs[j];
        if (dist(o.x, o.y, b.x, b.y) < o.r + b.r) {
          spawnParticles(b.x, b.y, '#ffd166', 16, 200, 0.45);
          addScore(40, b.x, b.y, '#ffd166');
          SFX.defuse();
          defused += 1;
          bombs.splice(j, 1);
          hitSomething = true;
          break;
        }
      }

      if (!hitSomething) {
        for (let j = enemies.length - 1; j >= 0; j--) {
          const e = enemies[j];
          if (dist(o.x, o.y, e.x, e.y) < o.r + e.r) {
            e.hp -= 1;
            spawnParticles(e.x, e.y, ENEMY_TYPES[e.type].color, 8, 140, 0.3);
            if (e.hp <= 0) {
              const t = ENEMY_TYPES[e.type];
              addScore(t.scoreKill, e.x, e.y, '#ff6bd6');
              SFX.killEnemy();
              killed += 1;
              enemies.splice(j, 1);
            }
            hitSomething = true;
            break;
          }
        }
      }

      if (hitSomething) orbs.splice(i, 1);
    }
  }

  function updateUI() {
    document.getElementById('score').textContent = `SCORE ${score}`;
    document.getElementById('timer').textContent = `TIME ${Math.floor(elapsed)}`;
    document.getElementById('mass').textContent = `撃破 ${killed}`;
    document.getElementById('eaten').textContent = `解体 ${defused}`;
    document.getElementById('combo').textContent = combo > 1 ? `COMBO x${combo}` : '';

    const row = document.getElementById('ammoRow');
    row.innerHTML = '';
    for (let i = 0; i < maxHp; i++) {
      const d = document.createElement('div');
      d.className = 'ammo' + (i < hp ? '' : ' empty');
      row.appendChild(d);
    }

    const pct = ((polarity + 1) / 2) * 100;
    document.getElementById('polarityFill').style.left = pct + '%';
    document.getElementById('polarityLabel').textContent = polarity >= 0 ? '引力 ATTRACT' : '斥力 REPEL';
    document.getElementById('polarityLabel').style.color = polarity >= 0 ? '#ff9dd6' : '#6be8ff';
  }

  // ---------- Drawing ----------
  function lerpRgb(t, a, b) {
    return `${Math.round(a[0] + (b[0] - a[0]) * t)},${Math.round(a[1] + (b[1] - a[1]) * t)},${Math.round(a[2] + (b[2] - a[2]) * t)}`;
  }

  function drawHole() {
    // t=0 full repulsion (cyan/blue) → t=1 full attraction (purple/pink)
    const t = (polarity + 1) / 2;
    const cA = lerpRgb(t, [107, 232, 255], [185, 140, 255]);
    const cB = lerpRgb(t, [80, 160, 255], [255, 107, 214]);

    ctx.save();
    ctx.translate(hole.x, hole.y);

    const diskR = hole.radius * 2.4;
    for (let i = 0; i < 3; i++) {
      const a0 = hole.diskAngle * (i % 2 === 0 ? 1 : -1) + i * 2.1;
      ctx.save();
      ctx.rotate(a0);
      const grad = ctx.createLinearGradient(-diskR, 0, diskR, 0);
      grad.addColorStop(0, `rgba(${cA},0)`);
      grad.addColorStop(0.5, `rgba(${cB},${0.35 - i * 0.08})`);
      grad.addColorStop(1, `rgba(${cA},0)`);
      ctx.strokeStyle = grad;
      ctx.lineWidth = 3 - i * 0.6;
      ctx.beginPath();
      ctx.ellipse(0, 0, diskR - i * 8, (diskR - i * 8) * 0.32, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    const rim = ctx.createRadialGradient(0, 0, hole.radius * 0.6, 0, 0, hole.radius * 1.5);
    rim.addColorStop(0, `rgba(${cA},0.55)`);
    rim.addColorStop(0.6, `rgba(${cB},0.25)`);
    rim.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = rim;
    ctx.beginPath();
    ctx.arc(0, 0, hole.radius * 1.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#050008';
    ctx.beginPath();
    ctx.arc(0, 0, hole.radius, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  function drawEnemy(e) {
    const t = ENEMY_TYPES[e.type];
    ctx.save();
    ctx.translate(e.x, e.y);
    ctx.shadowColor = t.color;
    ctx.shadowBlur = 10;
    ctx.fillStyle = t.color + 'aa';
    ctx.strokeStyle = t.color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(0, 0, e.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    const blinkOpen = Math.abs(Math.sin(e.blink * 0.3)) > 0.08;
    ctx.fillStyle = '#0a0010';
    const eyeOffset = e.r * 0.32;
    if (blinkOpen) {
      ctx.beginPath();
      ctx.arc(-eyeOffset, -e.r * 0.1, e.r * 0.14, 0, Math.PI * 2);
      ctx.arc(eyeOffset, -e.r * 0.1, e.r * 0.14, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    if (t.hits > 1) {
      const w = e.r * 2;
      const pct = clamp(e.hp / t.hits, 0, 1);
      ctx.save();
      ctx.translate(e.x - w / 2, e.y - e.r - 9);
      ctx.fillStyle = 'rgba(255,255,255,0.15)';
      ctx.fillRect(0, 0, w, 3);
      ctx.fillStyle = t.color;
      ctx.fillRect(0, 0, w * pct, 3);
      ctx.restore();
    }
  }

  function drawBomb(b) {
    const urgency = clamp(b.age / 3.5, 0, 1);
    const pulse = 1 + Math.sin(b.age * (10 + urgency * 14)) * 0.15;
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.shadowColor = '#ff5b5b';
    ctx.shadowBlur = 10 + urgency * 10;
    ctx.fillStyle = `rgba(255,${Math.round(90 - urgency * 40)},${Math.round(90 - urgency * 60)},0.9)`;
    ctx.beginPath();
    ctx.arc(0, 0, b.r * pulse, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#ffe0d0';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
  }

  function drawOrbs() {
    for (const o of orbs) {
      ctx.save();
      ctx.shadowColor = '#e8d9ff';
      ctx.shadowBlur = 12;
      ctx.fillStyle = '#f5eeff';
      ctx.beginPath();
      ctx.arc(o.x, o.y, o.r, 0, Math.PI * 2);
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
    ctx.moveTo(mouse.x - 9, mouse.y); ctx.lineTo(mouse.x - 3, mouse.y);
    ctx.moveTo(mouse.x + 3, mouse.y); ctx.lineTo(mouse.x + 9, mouse.y);
    ctx.moveTo(mouse.x, mouse.y - 9); ctx.lineTo(mouse.x, mouse.y - 3);
    ctx.moveTo(mouse.x, mouse.y + 3); ctx.lineTo(mouse.x, mouse.y + 9);
    ctx.stroke();

    // aim line from hole to cursor
    ctx.strokeStyle = 'rgba(185,140,255,0.18)';
    ctx.setLineDash([4, 6]);
    ctx.beginPath();
    ctx.moveTo(hole.x, hole.y);
    ctx.lineTo(mouse.x, mouse.y);
    ctx.stroke();
    ctx.setLineDash([]);
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
      updateHole(dt);
      updateEnemies(dt);
      updateBombs(dt);
      updateOrbs(dt);
      handleCollisions();
      maintainSpawns(dt);

      elapsed += dt;
      if (comboTimer > 0) {
        comboTimer -= dt;
        if (comboTimer <= 0) combo = 0;
      }
      updateUI();
    }

    updateParticles(dt);
    updateFloaters(dt);

    if (state === 'playing' || state === 'gameover') {
      for (const b of bombs) drawBomb(b);
      for (const e of enemies) drawEnemy(e);
      drawOrbs();
      drawHole();
    }
    drawParticles();
    drawFloaters();
    drawCursorReticle();

    ctx.restore();

    if (flashAlpha > 0) {
      ctx.save();
      ctx.fillStyle = `rgba(255,40,40,${flashAlpha})`;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
      flashAlpha = Math.max(0, flashAlpha - dt * 1.8);
    }

    if (INSPECT) {
      window.__DEBUG_STATE__ = { hole, enemies, bombs, orbs, score, killed, defused, hp, state, elapsed, polarity, polarityTarget };
    }

    requestAnimationFrame(loop);
  }

  // ---------- Boot ----------
  document.getElementById('startBtn').addEventListener('click', (e) => {
    e.currentTarget.blur();
    resumeAudio();
    startGame();
  });
  document.getElementById('restartBtn').addEventListener('click', (e) => {
    e.currentTarget.blur();
    resumeAudio();
    startGame();
  });

  requestAnimationFrame(loop);
})();
