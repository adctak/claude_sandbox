(() => {
  'use strict';

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

  // ---------- Audio (procedural, no assets) ----------
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  const actx = new AudioCtx();
  let audioReady = false;
  function resumeAudio() {
    if (actx.state === 'suspended') actx.resume();
    audioReady = true;
  }

  function beep({ freq = 440, dur = 0.08, type = 'square', gain = 0.08, slide = 0, delay = 0 }) {
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

  function noiseBurst({ dur = 0.25, gain = 0.15, delay = 0, filterFreq = 1200 }) {
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
    shoot: () => beep({ freq: 900, dur: 0.05, type: 'square', gain: 0.05, slide: -300 }),
    hit: () => beep({ freq: 180, dur: 0.12, type: 'sawtooth', gain: 0.12, slide: -100 }),
    explosion: () => { noiseBurst({ dur: 0.3, gain: 0.18 }); beep({ freq: 120, dur: 0.2, type: 'sawtooth', gain: 0.1, slide: -80 }); },
    playerHit: () => { noiseBurst({ dur: 0.35, gain: 0.22, filterFreq: 600 }); beep({ freq: 90, dur: 0.3, type: 'sawtooth', gain: 0.15 }); },
    dash: () => beep({ freq: 500, dur: 0.15, type: 'sine', gain: 0.08, slide: 500 }),
    powerup: () => { beep({ freq: 500, dur: 0.09, type: 'triangle', gain: 0.1, slide: 300 }); beep({ freq: 700, dur: 0.12, type: 'triangle', gain: 0.1, slide: 400, delay: 0.08 }); },
    wave: () => { beep({ freq: 200, dur: 0.15, type: 'triangle', gain: 0.1 }); beep({ freq: 300, dur: 0.2, type: 'triangle', gain: 0.1, delay: 0.12 }); beep({ freq: 400, dur: 0.3, type: 'triangle', gain: 0.1, delay: 0.24 }); },
    gameover: () => { beep({ freq: 300, dur: 0.4, type: 'sawtooth', gain: 0.12, slide: -250 }); beep({ freq: 200, dur: 0.5, type: 'sawtooth', gain: 0.12, slide: -150, delay: 0.15 }); },
  };

  // ---------- Utility ----------
  const rand = (a, b) => a + Math.random() * (b - a);
  const dist2 = (ax, ay, bx, by) => (ax - bx) ** 2 + (ay - by) ** 2;
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  // ---------- Input ----------
  const keys = {};
  const mouse = { x: 0, y: 0, down: false };
  window.addEventListener('keydown', e => {
    keys[e.key.toLowerCase()] = true;
    if (e.key === ' ') e.preventDefault();
  });
  window.addEventListener('keyup', e => { keys[e.key.toLowerCase()] = false; });
  canvas.addEventListener('mousemove', e => { mouse.x = e.clientX; mouse.y = e.clientY; });
  canvas.addEventListener('mousedown', e => {
    if (e.button === 0) mouse.down = true;
    if (e.button === 2) dashRequested = true;
  });
  canvas.addEventListener('mouseup', e => { if (e.button === 0) mouse.down = false; });
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  canvas.addEventListener('touchstart', e => {
    const t = e.touches[0];
    mouse.x = t.clientX; mouse.y = t.clientY; mouse.down = true;
  }, { passive: true });
  canvas.addEventListener('touchmove', e => {
    const t = e.touches[0];
    mouse.x = t.clientX; mouse.y = t.clientY;
  }, { passive: true });
  canvas.addEventListener('touchend', () => { mouse.down = false; }, { passive: true });

  let dashRequested = false;

  // ---------- Background: starfield + synthwave grid + sun ----------
  const stars = [];
  for (let i = 0; i < 140; i++) {
    stars.push({ x: rand(0, 2000), y: rand(0, 2000), r: rand(0.4, 1.8), tw: rand(0, Math.PI * 2) });
  }

  let gridOffset = 0;

  function drawBackground(dt, shakeX, shakeY) {
    ctx.save();
    ctx.fillStyle = '#05010f';
    ctx.fillRect(0, 0, W, H);

    // stars
    for (const s of stars) {
      s.tw += dt * 2;
      const alpha = 0.4 + Math.sin(s.tw) * 0.3;
      ctx.fillStyle = `rgba(180, 220, 255, ${clamp(alpha, 0, 1)})`;
      const sx = (s.x % W + W) % W;
      const sy = (s.y % H + H) % H;
      ctx.beginPath();
      ctx.arc(sx, sy, s.r, 0, Math.PI * 2);
      ctx.fill();
    }

    // retro sun
    const sunX = W / 2, sunY = H * 0.28, sunR = Math.min(W, H) * 0.22;
    const grad = ctx.createLinearGradient(sunX, sunY - sunR, sunX, sunY + sunR);
    grad.addColorStop(0, '#ffe14e');
    grad.addColorStop(0.5, '#ff5ef0');
    grad.addColorStop(1, '#4ef2ff');
    ctx.save();
    ctx.beginPath();
    ctx.arc(sunX, sunY, sunR, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = grad;
    ctx.fillRect(sunX - sunR, sunY - sunR, sunR * 2, sunR * 2);
    ctx.fillStyle = '#05010f';
    for (let i = 0; i < 6; i++) {
      const yy = sunY + sunR * 0.15 + i * sunR * 0.13;
      ctx.fillRect(sunX - sunR, yy, sunR * 2, sunR * 0.05);
    }
    ctx.restore();
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = '#ff5ef0';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(sunX, sunY, sunR, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;

    // horizon grid (synthwave floor)
    gridOffset += dt * 90;
    const horizonY = H * 0.62;
    ctx.strokeStyle = 'rgba(78, 242, 255, 0.35)';
    ctx.lineWidth = 1;

    // vertical lines converging to vanishing point
    const vpX = W / 2;
    const numLines = 16;
    for (let i = -numLines; i <= numLines; i++) {
      const spread = i / numLines;
      const bottomX = vpX + spread * W * 1.3;
      ctx.beginPath();
      ctx.moveTo(vpX, horizonY);
      ctx.lineTo(bottomX, H);
      ctx.stroke();
    }
    // horizontal lines with perspective spacing
    const numH = 10;
    for (let i = 0; i < numH; i++) {
      const p = ((i + (gridOffset % 40) / 40) / numH);
      const y = horizonY + Math.pow(p, 2.2) * (H - horizonY);
      const alpha = 0.5 * (1 - p * 0.6);
      ctx.strokeStyle = `rgba(255, 94, 240, ${clamp(alpha, 0, 0.6)})`;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    }

    ctx.restore();
  }

  // ---------- Particles ----------
  let particles = [];
  function spawnParticles(x, y, color, count = 14, speed = 220, life = 0.6) {
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
        r: rand(1.5, 3.5),
      });
    }
  }

  function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.94;
      p.vy *= 0.94;
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
      ctx.shadowBlur = 12;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  // ---------- Floating text (score popups) ----------
  let floaters = [];
  function spawnFloater(x, y, text, color = '#ffe14e') {
    floaters.push({ x, y, text, color, life: 0.8, maxLife: 0.8 });
  }
  function updateFloaters(dt) {
    for (let i = floaters.length - 1; i >= 0; i--) {
      const f = floaters[i];
      f.y -= 40 * dt;
      f.life -= dt;
      if (f.life <= 0) floaters.splice(i, 1);
    }
  }
  function drawFloaters() {
    ctx.save();
    ctx.font = 'bold 16px Orbitron, sans-serif';
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

  // ---------- Player ----------
  const player = {
    x: 0, y: 0,
    vx: 0, vy: 0,
    r: 14,
    speed: 320,
    angle: 0,
    hp: 3,
    maxHp: 3,
    fireCooldown: 0,
    fireRate: 0.14,
    rapidUntil: 0,
    invuln: 0,
    dashCooldown: 0,
    dashDuration: 0,
    dashMax: 1.4,
    trail: [],
  };

  function resetPlayer() {
    player.x = W / 2;
    player.y = H * 0.7;
    player.vx = 0; player.vy = 0;
    player.hp = player.maxHp;
    player.fireCooldown = 0;
    player.rapidUntil = 0;
    player.invuln = 1.2;
    player.dashCooldown = 0;
    player.dashDuration = 0;
    player.trail = [];
  }

  // ---------- Bullets ----------
  let playerBullets = [];
  let enemyBullets = [];

  function shootPlayerBullet() {
    const rapid = performance.now() / 1000 < player.rapidUntil;
    const spreadCount = rapid ? 3 : 1;
    const baseAngle = player.angle;
    const spreadStep = 0.18;
    for (let i = 0; i < spreadCount; i++) {
      const off = (i - (spreadCount - 1) / 2) * spreadStep;
      const a = baseAngle + off;
      playerBullets.push({
        x: player.x + Math.cos(a) * player.r,
        y: player.y + Math.sin(a) * player.r,
        vx: Math.cos(a) * 620,
        vy: Math.sin(a) * 620,
        r: 3.5,
        life: 1.2,
      });
    }
    SFX.shoot();
  }

  // ---------- Enemies ----------
  let enemies = [];
  let enemyId = 0;

  function spawnEnemy(type) {
    const edge = Math.floor(rand(0, 4));
    let x, y;
    if (edge === 0) { x = rand(0, W); y = -30; }
    else if (edge === 1) { x = W + 30; y = rand(0, H); }
    else if (edge === 2) { x = rand(0, W); y = H + 30; }
    else { x = -30; y = rand(0, H); }

    const base = {
      id: enemyId++,
      x, y,
      vx: 0, vy: 0,
      angle: 0,
      hitFlash: 0,
      shootCd: rand(0.5, 1.5),
      wobble: rand(0, Math.PI * 2),
    };

    if (type === 'chaser') {
      Object.assign(base, { type, r: 15, hp: 2, maxHp: 2, speed: rand(90, 130), color: '#ff5ef0', score: 100 });
    } else if (type === 'shooter') {
      Object.assign(base, { type, r: 17, hp: 3, maxHp: 3, speed: 60, color: '#4ef2ff', score: 180, preferDist: 260 });
    } else if (type === 'zigzag') {
      Object.assign(base, { type, r: 13, hp: 4, maxHp: 4, speed: 150, color: '#ffe14e', score: 250 });
    } else if (type === 'tank') {
      Object.assign(base, { type, r: 24, hp: 9, maxHp: 9, speed: 55, color: '#ff2e6d', score: 400 });
    }
    enemies.push(base);
  }

  // ---------- Power-ups ----------
  let powerups = [];
  function maybeDropPowerup(x, y) {
    if (Math.random() < 0.12) {
      const kind = Math.random() < 0.5 ? 'heart' : 'rapid';
      powerups.push({ x, y, kind, life: 8, r: 10, bob: rand(0, Math.PI * 2) });
    }
  }

  // ---------- Game state ----------
  let state = 'start'; // start | playing | gameover
  let score = 0;
  let wave = 1;
  let waveTimer = 0;
  let waveEnemiesToSpawn = 0;
  let waveSpawnTimer = 0;
  let combo = 0;
  let comboTimer = 0;
  let shakeTime = 0, shakeMag = 0;
  let lastTime = performance.now();

  function triggerShake(mag, time) {
    shakeMag = Math.max(shakeMag, mag);
    shakeTime = Math.max(shakeTime, time);
  }

  function startWave() {
    SFX.wave();
    const count = 4 + wave * 2;
    waveEnemiesToSpawn = count;
    waveSpawnTimer = 0;
    document.getElementById('wave').textContent = `WAVE ${wave}`;
  }

  function startGame() {
    resetPlayer();
    playerBullets = [];
    enemyBullets = [];
    enemies = [];
    particles = [];
    floaters = [];
    powerups = [];
    score = 0;
    wave = 1;
    combo = 0;
    comboTimer = 0;
    state = 'playing';
    document.getElementById('startScreen').classList.add('hidden');
    document.getElementById('gameOverScreen').classList.add('hidden');
    startWave();
  }

  function endGame() {
    state = 'gameover';
    SFX.gameover();
    document.getElementById('finalScore').textContent = `SCORE: ${score}`;
    document.getElementById('gameOverScreen').classList.remove('hidden');
  }

  function addScore(base, x, y) {
    combo += 1;
    comboTimer = 2.2;
    const mult = 1 + Math.min(combo - 1, 9) * 0.15;
    const gained = Math.round(base * mult);
    score += gained;
    spawnFloater(x, y, `+${gained}${combo > 1 ? ` x${mult.toFixed(1)}` : ''}`, combo > 3 ? '#ff5ef0' : '#ffe14e');
  }

  // ---------- Update ----------
  function updatePlayer(dt) {
    let dx = 0, dy = 0;
    if (keys['w'] || keys['arrowup']) dy -= 1;
    if (keys['s'] || keys['arrowdown']) dy += 1;
    if (keys['a'] || keys['arrowleft']) dx -= 1;
    if (keys['d'] || keys['arrowright']) dx += 1;
    const len = Math.hypot(dx, dy) || 1;
    dx /= len; dy /= len;

    if (keys['shift']) dashRequested = true;

    player.dashCooldown = Math.max(0, player.dashCooldown - dt);
    if (player.dashDuration > 0) {
      player.dashDuration -= dt;
      player.invuln = Math.max(player.invuln, 0.05);
    } else if (dashRequested && player.dashCooldown <= 0) {
      player.dashDuration = 0.18;
      player.dashCooldown = player.dashMax;
      player.invuln = Math.max(player.invuln, 0.3);
      SFX.dash();
      triggerShake(4, 0.15);
    }
    dashRequested = false;

    const dashing = player.dashDuration > 0;
    const speed = dashing ? player.speed * 3.2 : player.speed;

    player.vx = dx * speed;
    player.vy = dy * speed;
    player.x += player.vx * dt;
    player.y += player.vy * dt;
    player.x = clamp(player.x, player.r, W - player.r);
    player.y = clamp(player.y, player.r, H - player.r);

    player.angle = Math.atan2(mouse.y - player.y, mouse.x - player.x);

    if (dashing) {
      player.trail.push({ x: player.x, y: player.y, life: 0.25 });
    }
    for (let i = player.trail.length - 1; i >= 0; i--) {
      player.trail[i].life -= dt;
      if (player.trail[i].life <= 0) player.trail.splice(i, 1);
    }

    player.fireCooldown -= dt;
    const rapid = performance.now() / 1000 < player.rapidUntil;
    const rate = rapid ? player.fireRate * 0.5 : player.fireRate;
    if (mouse.down && player.fireCooldown <= 0) {
      shootPlayerBullet();
      player.fireCooldown = rate;
    }

    player.invuln = Math.max(0, player.invuln - dt);
  }

  function updateBullets(dt) {
    for (let i = playerBullets.length - 1; i >= 0; i--) {
      const b = playerBullets[i];
      b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt;
      if (b.life <= 0 || b.x < -20 || b.x > W + 20 || b.y < -20 || b.y > H + 20) {
        playerBullets.splice(i, 1);
      }
    }
    for (let i = enemyBullets.length - 1; i >= 0; i--) {
      const b = enemyBullets[i];
      b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt;
      if (b.life <= 0 || b.x < -20 || b.x > W + 20 || b.y < -20 || b.y > H + 20) {
        enemyBullets.splice(i, 1);
      }
    }
  }

  function updateEnemies(dt) {
    for (const e of enemies) {
      e.hitFlash = Math.max(0, e.hitFlash - dt * 6);
      e.wobble += dt * 3;
      const ang = Math.atan2(player.y - e.y, player.x - e.x);

      if (e.type === 'chaser' || e.type === 'tank') {
        e.vx = Math.cos(ang) * e.speed;
        e.vy = Math.sin(ang) * e.speed;
      } else if (e.type === 'shooter') {
        const d = Math.hypot(player.x - e.x, player.y - e.y);
        const dirMult = d < e.preferDist ? -1 : 1;
        e.vx = Math.cos(ang) * e.speed * dirMult;
        e.vy = Math.sin(ang) * e.speed * dirMult;
        e.shootCd -= dt;
        if (e.shootCd <= 0 && d < 600) {
          e.shootCd = rand(1.2, 2.0);
          enemyBullets.push({
            x: e.x, y: e.y,
            vx: Math.cos(ang) * 260, vy: Math.sin(ang) * 260,
            r: 4, life: 3,
          });
        }
      } else if (e.type === 'zigzag') {
        const perp = ang + Math.PI / 2;
        const wob = Math.sin(e.wobble) * 1.4;
        e.vx = Math.cos(ang) * e.speed + Math.cos(perp) * wob * 60;
        e.vy = Math.sin(ang) * e.speed + Math.sin(perp) * wob * 60;
      }

      e.x += e.vx * dt;
      e.y += e.vy * dt;
      e.angle = Math.atan2(e.vy, e.vx);
    }
  }

  function updatePowerups(dt) {
    for (let i = powerups.length - 1; i >= 0; i--) {
      const p = powerups[i];
      p.life -= dt;
      p.bob += dt * 4;
      if (p.life <= 0) powerups.splice(i, 1);
    }
  }

  function circleHit(ax, ay, ar, bx, by, br) {
    return dist2(ax, ay, bx, by) < (ar + br) * (ar + br);
  }

  function handleCollisions() {
    // player bullets vs enemies
    for (let i = enemies.length - 1; i >= 0; i--) {
      const e = enemies[i];
      for (let j = playerBullets.length - 1; j >= 0; j--) {
        const b = playerBullets[j];
        if (circleHit(e.x, e.y, e.r, b.x, b.y, b.r)) {
          playerBullets.splice(j, 1);
          e.hp -= 1;
          e.hitFlash = 1;
          spawnParticles(b.x, b.y, e.color, 5, 120, 0.3);
          if (e.hp <= 0) {
            spawnParticles(e.x, e.y, e.color, 26, 260, 0.7);
            triggerShake(e.type === 'tank' ? 10 : 5, 0.2);
            SFX.explosion();
            addScore(e.score, e.x, e.y);
            maybeDropPowerup(e.x, e.y);
            enemies.splice(i, 1);
          }
          break;
        }
      }
    }

    // enemies / enemy bullets vs player
    if (player.invuln <= 0) {
      for (let i = enemies.length - 1; i >= 0; i--) {
        const e = enemies[i];
        if (circleHit(e.x, e.y, e.r, player.x, player.y, player.r)) {
          spawnParticles(e.x, e.y, e.color, 20, 220, 0.6);
          enemies.splice(i, 1);
          damagePlayer();
          break;
        }
      }
    }
    if (player.invuln <= 0) {
      for (let i = enemyBullets.length - 1; i >= 0; i--) {
        const b = enemyBullets[i];
        if (circleHit(b.x, b.y, b.r, player.x, player.y, player.r)) {
          enemyBullets.splice(i, 1);
          damagePlayer();
          break;
        }
      }
    }

    // powerups vs player
    for (let i = powerups.length - 1; i >= 0; i--) {
      const p = powerups[i];
      if (circleHit(p.x, p.y, p.r, player.x, player.y, player.r)) {
        SFX.powerup();
        if (p.kind === 'heart') {
          player.hp = Math.min(player.maxHp, player.hp + 1);
          spawnFloater(p.x, p.y, '+1 LIFE', '#ff2e6d');
        } else {
          player.rapidUntil = performance.now() / 1000 + 6;
          spawnFloater(p.x, p.y, 'RAPID FIRE', '#4ef2ff');
        }
        powerups.splice(i, 1);
      }
    }
  }

  function damagePlayer() {
    player.hp -= 1;
    player.invuln = 1.4;
    combo = 0;
    SFX.playerHit();
    triggerShake(12, 0.3);
    spawnParticles(player.x, player.y, '#ff2e6d', 18, 200, 0.5);
    if (player.hp <= 0) {
      endGame();
    }
  }

  function updateWaveLogic(dt) {
    if (waveEnemiesToSpawn > 0) {
      waveSpawnTimer -= dt;
      if (waveSpawnTimer <= 0) {
        waveSpawnTimer = rand(0.4, 0.9);
        const types = wave < 2 ? ['chaser'] :
          wave < 4 ? ['chaser', 'shooter'] :
          wave < 6 ? ['chaser', 'shooter', 'zigzag'] :
          ['chaser', 'shooter', 'zigzag', 'tank'];
        const type = types[Math.floor(rand(0, types.length))];
        spawnEnemy(type);
        waveEnemiesToSpawn--;
      }
    } else if (enemies.length === 0) {
      wave += 1;
      startWave();
    }
  }

  function updateUI() {
    document.getElementById('score').textContent = `SCORE ${score}`;
    if (combo > 1) {
      document.getElementById('combo').textContent = `COMBO x${combo}`;
    } else {
      document.getElementById('combo').textContent = '';
    }
    const livesEl = document.getElementById('lives');
    livesEl.innerHTML = '';
    for (let i = 0; i < player.hp; i++) {
      const h = document.createElement('div');
      h.className = 'heart';
      livesEl.appendChild(h);
    }
    const dashPct = clamp(1 - player.dashCooldown / player.dashMax, 0, 1) * 100;
    document.getElementById('dashFill').style.width = dashPct + '%';
  }

  // ---------- Drawing ----------
  function drawGlowShape(draw, color, blur = 16) {
    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur = blur;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    draw();
    ctx.restore();
  }

  function drawPlayer() {
    if (player.invuln > 0 && Math.floor(player.invuln * 20) % 2 === 0) return;

    for (const t of player.trail) {
      ctx.save();
      ctx.globalAlpha = clamp(t.life / 0.25, 0, 1) * 0.4;
      ctx.fillStyle = '#4ef2ff';
      ctx.shadowColor = '#4ef2ff';
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.arc(t.x, t.y, player.r * 0.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    ctx.save();
    ctx.translate(player.x, player.y);
    ctx.rotate(player.angle);
    ctx.shadowColor = '#4ef2ff';
    ctx.shadowBlur = 18;
    ctx.strokeStyle = '#4ef2ff';
    ctx.fillStyle = 'rgba(78, 242, 255, 0.15)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(player.r * 1.4, 0);
    ctx.lineTo(-player.r, player.r * 0.9);
    ctx.lineTo(-player.r * 0.5, 0);
    ctx.lineTo(-player.r, -player.r * 0.9);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // engine flame
    const flameLen = 8 + Math.random() * 8 + (player.dashDuration > 0 ? 20 : 0);
    ctx.strokeStyle = '#ffe14e';
    ctx.shadowColor = '#ffe14e';
    ctx.beginPath();
    ctx.moveTo(-player.r * 0.5, 0);
    ctx.lineTo(-player.r * 0.5 - flameLen, 0);
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.restore();
  }

  function drawEnemy(e) {
    const color = e.hitFlash > 0.1 ? '#ffffff' : e.color;
    ctx.save();
    ctx.translate(e.x, e.y);
    ctx.rotate(e.angle || 0);
    ctx.shadowColor = color;
    ctx.shadowBlur = 14;
    ctx.strokeStyle = color;
    ctx.fillStyle = color + '22';
    ctx.lineWidth = 2;
    ctx.beginPath();

    if (e.type === 'chaser') {
      ctx.moveTo(e.r, 0);
      ctx.lineTo(-e.r * 0.7, e.r * 0.8);
      ctx.lineTo(-e.r * 0.7, -e.r * 0.8);
      ctx.closePath();
    } else if (e.type === 'shooter') {
      ctx.rect(-e.r, -e.r, e.r * 2, e.r * 2);
    } else if (e.type === 'zigzag') {
      const sides = 6;
      for (let i = 0; i < sides; i++) {
        const a = (i / sides) * Math.PI * 2;
        const px = Math.cos(a) * e.r, py = Math.sin(a) * e.r;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath();
    } else if (e.type === 'tank') {
      const sides = 8;
      for (let i = 0; i < sides; i++) {
        const a = (i / sides) * Math.PI * 2;
        const px = Math.cos(a) * e.r, py = Math.sin(a) * e.r;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath();
    }
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    // hp bar for tougher enemies
    if (e.maxHp > 2) {
      const w = e.r * 2;
      const pct = clamp(e.hp / e.maxHp, 0, 1);
      ctx.save();
      ctx.translate(e.x - w / 2, e.y - e.r - 10);
      ctx.fillStyle = 'rgba(255,255,255,0.15)';
      ctx.fillRect(0, 0, w, 3);
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, w * pct, 3);
      ctx.restore();
    }
  }

  function drawBullets() {
    for (const b of playerBullets) {
      ctx.save();
      ctx.shadowColor = '#4ef2ff';
      ctx.shadowBlur = 10;
      ctx.fillStyle = '#eafcff';
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    for (const b of enemyBullets) {
      ctx.save();
      ctx.shadowColor = '#ff2e6d';
      ctx.shadowBlur = 10;
      ctx.fillStyle = '#ff2e6d';
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  function drawPowerups() {
    for (const p of powerups) {
      const y = p.y + Math.sin(p.bob) * 4;
      const color = p.kind === 'heart' ? '#ff2e6d' : '#4ef2ff';
      ctx.save();
      ctx.translate(p.x, y);
      ctx.shadowColor = color;
      ctx.shadowBlur = 16;
      ctx.strokeStyle = color;
      ctx.fillStyle = color + '33';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, p.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.font = 'bold 12px Orbitron, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(p.kind === 'heart' ? '+' : 'R', 0, 1);
      ctx.restore();
    }
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
    drawBackground(dt, shakeX, shakeY);

    if (state === 'playing') {
      updatePlayer(dt);
      updateBullets(dt);
      updateEnemies(dt);
      updatePowerups(dt);
      handleCollisions();
      updateWaveLogic(dt);

      if (comboTimer > 0) {
        comboTimer -= dt;
        if (comboTimer <= 0) combo = 0;
      }

      updateUI();
    }

    updateParticles(dt);
    updateFloaters(dt);

    if (state === 'playing' || state === 'gameover') {
      drawPowerups();
      for (const e of enemies) drawEnemy(e);
      drawBullets();
      drawPlayer();
    }
    drawParticles();
    drawFloaters();

    ctx.restore();

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
  player.y = H * 0.7;
  requestAnimationFrame(loop);
})();
