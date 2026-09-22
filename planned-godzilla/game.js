(() => {
  'use strict';

  const DEBUG = /[?&]debug/.test(location.search);
  const INSPECT = DEBUG || /[?&]inspect/.test(location.search);

  // ---------- Canvas setup ----------
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  let W = 0, H = 0, DPR = Math.min(window.devicePixelRatio || 1, 2);
  let groundY = 0;

  function resize() {
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = W * DPR;
    canvas.height = H * DPR;
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    groundY = H * 0.78;
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
    place: () => beep({ freq: 260, dur: 0.08, type: 'square', gain: 0.07, slide: 120 }),
    missile: () => { beep({ freq: 500, dur: 0.12, type: 'sawtooth', gain: 0.07, slide: -250 }); },
    explosion: () => { noiseBurst({ dur: 0.3, gain: 0.2 }); beep({ freq: 100, dur: 0.25, type: 'sawtooth', gain: 0.14, slide: -70 }); },
    stomp: () => { noiseBurst({ dur: 0.35, gain: 0.24, filterFreq: 500 }); beep({ freq: 70, dur: 0.3, type: 'sine', gain: 0.2 }); },
    roar: () => { beep({ freq: 90, dur: 0.5, type: 'sawtooth', gain: 0.14, slide: 40 }); beep({ freq: 60, dur: 0.6, type: 'sawtooth', gain: 0.12, slide: -20, delay: 0.1 }); },
    saved: () => { beep({ freq: 500, dur: 0.1, type: 'triangle', gain: 0.1, slide: 200 }); beep({ freq: 700, dur: 0.15, type: 'triangle', gain: 0.1, slide: 260, delay: 0.1 }); },
    destroyed: () => { beep({ freq: 220, dur: 0.2, type: 'sawtooth', gain: 0.12, slide: -160 }); noiseBurst({ dur: 0.3, gain: 0.16 }); },
    click: () => beep({ freq: 700, dur: 0.04, type: 'square', gain: 0.04 }),
    deny: () => beep({ freq: 140, dur: 0.06, type: 'square', gain: 0.05 }),
    gameover: () => { beep({ freq: 300, dur: 0.4, type: 'sawtooth', gain: 0.12, slide: -250 }); beep({ freq: 200, dur: 0.5, type: 'sawtooth', gain: 0.12, slide: -150, delay: 0.15 }); },
    victory: () => { beep({ freq: 440, dur: 0.15, type: 'triangle', gain: 0.1 }); beep({ freq: 550, dur: 0.15, type: 'triangle', gain: 0.1, delay: 0.15 }); beep({ freq: 660, dur: 0.3, type: 'triangle', gain: 0.1, delay: 0.3 }); },
  };

  // ---------- Utility ----------
  const rand = (a, b) => a + Math.random() * (b - a);
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  // ---------- World ----------
  const WORLD = {
    width: 5000,
    towerX: 1000,
    tochoX: 2600,
    skytreeX: 4200,
    endX: 4900,
  };
  const BASE_SPEED = 45;
  const TOWER_DEADLINE = WORLD.towerX / BASE_SPEED + 5; // must arrive later than this to save it
  const TANK_COST = 120, TANK_CD = 1.0, TANK_DELAY = 3.0, TANK_TRIGGER_R = 44;
  const MISSILE_COST = 150, MISSILE_CD = 1.6, MISSILE_STAGGER = 2.5, MISSILE_CLIMB_DMG = 18;
  const REINFORCE_COST = 150, REINFORCE_CD = 0.5, STOMP_DAMAGE = 4;
  const TRUCK_COST = 130, TRUCK_CD = 0.4, MAX_TRUCKS = 5, TRUCK_DPS_REDUCTION = 2;
  const CLIMB_DURATION = 20;
  const FLAME_DURATION = 14, BASE_FIRE_DPS = 10, CITY_HEALTH = 100;
  const BUDGET_REGEN = 25;

  let camera = { x: 0 };

  // ---------- Background: skyline + stars ----------
  const skyline = [];
  for (let i = 0; i < 70; i++) {
    skyline.push({
      x: rand(0, WORLD.width),
      w: rand(30, 90),
      h: rand(40, 180),
      lit: Math.random() < 0.4,
    });
  }

  function drawBackground() {
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, '#2a0f0a');
    grad.addColorStop(0.55, '#4a1a10');
    grad.addColorStop(1, '#1a0806');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    // moon
    ctx.save();
    ctx.fillStyle = 'rgba(255, 230, 200, 0.85)';
    ctx.shadowColor = '#ffe6c8';
    ctx.shadowBlur = 30;
    ctx.beginPath();
    ctx.arc(W * 0.82, H * 0.18, 34, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // skyline (parallax factor 0.4)
    const parX = camera.x * 0.4;
    for (const b of skyline) {
      const sx = b.x - parX;
      if (sx < -100 || sx > W + 100) continue;
      ctx.fillStyle = 'rgba(20, 8, 8, 0.85)';
      ctx.fillRect(sx, groundY - b.h, b.w, b.h);
      if (b.lit) {
        ctx.fillStyle = 'rgba(255, 209, 102, 0.5)';
        for (let wy = groundY - b.h + 10; wy < groundY - 8; wy += 16) {
          ctx.fillRect(sx + b.w * 0.3, wy, 3, 5);
          ctx.fillRect(sx + b.w * 0.6, wy, 3, 5);
        }
      }
    }

    // ground band
    ctx.fillStyle = '#100503';
    ctx.fillRect(0, groundY, W, H - groundY);
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    ctx.fillRect(0, groundY, W, 2);
  }

  // ---------- Particles & floaters ----------
  let particles = [];
  function spawnParticles(x, y, color, count = 14, speed = 160, life = 0.6) {
    for (let i = 0; i < count; i++) {
      const a = rand(0, Math.PI * 2);
      const s = rand(speed * 0.3, speed);
      particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 40, life: rand(life * 0.5, life), maxLife: life, color, r: rand(2, 4.5), grav: 260 });
    }
  }
  function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.vy += p.grav * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.life -= dt;
      if (p.life <= 0) particles.splice(i, 1);
    }
  }
  function drawParticles() {
    for (const p of particles) {
      const sx = p.x - camera.x;
      if (sx < -20 || sx > W + 20) continue;
      ctx.save();
      ctx.globalAlpha = clamp(p.life / p.maxLife, 0, 1);
      ctx.fillStyle = p.color;
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.arc(sx, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  let floaters = [];
  function spawnFloater(worldX, y, text, color = '#ffd166') {
    floaters.push({ x: worldX, y, text, color, life: 1.3, maxLife: 1.3 });
  }
  function updateFloaters(dt) {
    for (let i = floaters.length - 1; i >= 0; i--) {
      const f = floaters[i];
      f.y -= 28 * dt;
      f.life -= dt;
      if (f.life <= 0) floaters.splice(i, 1);
    }
  }
  function drawFloaters() {
    ctx.save();
    ctx.font = 'bold 16px "Noto Sans JP", sans-serif';
    ctx.textAlign = 'center';
    for (const f of floaters) {
      const sx = f.x - camera.x;
      if (sx < -100 || sx > W + 100) continue;
      ctx.globalAlpha = clamp(f.life / f.maxLife, 0, 1);
      ctx.fillStyle = f.color;
      ctx.shadowColor = f.color;
      ctx.shadowBlur = 8;
      ctx.fillText(f.text, sx, f.y);
    }
    ctx.restore();
  }

  // ---------- Godzilla ----------
  const godzilla = {
    x: -150,
    walkPhase: 0,
    angry: 0,
    climbY: 0,
  };

  // ---------- Landmarks ----------
  const tower = { x: WORLD.towerX, saved: null, h: 220 };
  const tocho = { x: WORLD.tochoX, saved: null, h: 190, defense: 0 };
  const skytree = { x: WORLD.skytreeX, saved: null, h: Infinity };

  // ---------- Tanks / Missiles / Trucks ----------
  let tanks = [];
  let tankId = 0;
  let missiles = [];

  // ---------- Game state ----------
  let state = 'start'; // start | playing | ended
  let phase = 'toTower'; // toTower | toTocho | toSkytree | climbing | flaming | done
  let elapsed = 0;
  let budget = 300;
  let tankCooldown = 0, missileCooldown = 0, reinforceCooldown = 0, truckCooldown = 0;
  let staggerTimer = 0;
  let climbProgress = 0, climbTimeLeft = 0;
  let flameTimeLeft = 0, cityHealth = CITY_HEALTH, firetrucks = 0;
  let placingTank = false;
  let shakeTime = 0, shakeMag = 0;
  let lastTime = performance.now();

  function triggerShake(mag, time) {
    shakeMag = Math.max(shakeMag, mag);
    shakeTime = Math.max(shakeTime, time);
  }

  function resetGame() {
    godzilla.x = -150;
    godzilla.walkPhase = 0;
    godzilla.angry = 0;
    tower.saved = null;
    tocho.saved = null;
    tocho.defense = 0;
    skytree.saved = null;
    tanks = [];
    missiles = [];
    particles = [];
    floaters = [];
    phase = 'toTower';
    elapsed = 0;
    budget = 300;
    tankCooldown = 0; missileCooldown = 0; reinforceCooldown = 0; truckCooldown = 0;
    staggerTimer = 0;
    climbProgress = 0; climbTimeLeft = 0;
    flameTimeLeft = 0; cityHealth = CITY_HEALTH; firetrucks = 0;
    placingTank = false;
    document.querySelectorAll('.sched-row').forEach(el => {
      el.classList.remove('saved', 'failed');
      el.querySelector('.sched-icon').textContent = '⏳';
    });
    document.getElementById('phaseBar').classList.add('hidden');
  }

  function startGame() {
    resetGame();
    state = 'playing';
    document.getElementById('startScreen').classList.add('hidden');
    document.getElementById('gameOverScreen').classList.add('hidden');
  }

  function markSchedule(rowId, saved) {
    const row = document.getElementById(rowId);
    row.classList.add(saved ? 'saved' : 'failed');
    row.querySelector('.sched-icon').textContent = saved ? '✅' : '❌';
  }

  function endGame() {
    state = 'ended';
    const savedCount = [tower.saved, tocho.saved, skytree.saved].filter(Boolean).length;
    const title = document.getElementById('resultTitle');
    const body = document.getElementById('resultBody');
    if (savedCount === 3) {
      title.textContent = 'PLAN DISRUPTED';
      SFX.victory();
    } else if (savedCount === 0) {
      title.textContent = 'ALL ACCORDING TO PLAN';
      SFX.gameover();
    } else {
      title.textContent = 'PARTIAL DISRUPTION';
      SFX.gameover();
    }
    body.textContent =
      `東京タワー: ${tower.saved ? '死守' : '破壊された'} ／ ` +
      `都庁: ${tocho.saved ? '耐えた' : '踏み潰された'} ／ ` +
      `スカイツリー: ${skytree.saved ? '無事' : '炎上'}\n` +
      `阻止できた計画: ${savedCount} / 3　残り予算: ¥${Math.floor(budget)}`;
    document.getElementById('gameOverScreen').classList.remove('hidden');
  }

  // ---------- Actions ----------
  function placeTank(worldX) {
    if (state !== 'playing') return;
    if (phase === 'climbing' || phase === 'flaming') { SFX.deny(); return; }
    if (budget < TANK_COST || tankCooldown > 0) { SFX.deny(); return; }
    if (worldX <= godzilla.x + 30) { SFX.deny(); return; }
    budget -= TANK_COST;
    tankCooldown = TANK_CD;
    tanks.push({ id: tankId++, x: worldX, alive: true });
    SFX.place();
  }

  function fireMissile() {
    if (state !== 'playing') return;
    if (budget < MISSILE_COST || missileCooldown > 0) { SFX.deny(); return; }
    budget -= MISSILE_COST;
    missileCooldown = MISSILE_CD;
    missiles.push({ targetX: godzilla.x, targetY: phase === 'climbing' ? godzilla.climbY : groundY - 60, life: 0.35, maxLife: 0.35 });
    SFX.missile();
  }

  function reinforceTocho() {
    if (state !== 'playing') return;
    if (phase !== 'toTower' && phase !== 'toTocho') { SFX.deny(); return; }
    if (tocho.defense >= STOMP_DAMAGE) { SFX.deny(); return; }
    if (budget < REINFORCE_COST || reinforceCooldown > 0) { SFX.deny(); return; }
    budget -= REINFORCE_COST;
    reinforceCooldown = REINFORCE_CD;
    tocho.defense += 1;
    spawnFloater(tocho.x, groundY - tocho.h - 20, '補強 +1', '#7dffb0');
    SFX.click();
  }

  function deployTruck() {
    if (state !== 'playing') return;
    if (firetrucks >= MAX_TRUCKS) { SFX.deny(); return; }
    if (budget < TRUCK_COST || truckCooldown > 0) { SFX.deny(); return; }
    budget -= TRUCK_COST;
    truckCooldown = TRUCK_CD;
    firetrucks += 1;
    spawnFloater(skytree.x - 100 + firetrucks * 20, groundY - 20, '消防車出動', '#6be8ff');
    SFX.click();
  }

  // ---------- Phase resolution ----------
  function resolveTower() {
    tower.saved = elapsed > TOWER_DEADLINE;
    if (tower.saved) {
      spawnFloater(tower.x, groundY - tower.h - 10, '東京タワー 死守!', '#7dffb0');
      SFX.saved();
    } else {
      spawnFloater(tower.x, groundY - tower.h - 10, '東京タワー 崩壊…', '#ff5b5b');
      triggerShake(14, 0.5);
      SFX.destroyed();
    }
    markSchedule('sched-tower', tower.saved);
  }

  function resolveTocho() {
    SFX.stomp();
    triggerShake(18, 0.5);
    tocho.saved = tocho.defense >= STOMP_DAMAGE;
    if (tocho.saved) {
      spawnFloater(tocho.x, groundY - tocho.h - 10, '都庁 耐えた!', '#7dffb0');
      SFX.saved();
    } else {
      spawnFloater(tocho.x, groundY - tocho.h - 10, '都庁 倒壊…', '#ff5b5b');
      SFX.destroyed();
    }
    markSchedule('sched-tocho', tocho.saved);
  }

  function startClimb() {
    phase = 'climbing';
    climbProgress = 0;
    climbTimeLeft = CLIMB_DURATION;
    SFX.roar();
    document.getElementById('phaseBar').classList.remove('hidden');
    document.getElementById('phaseLabel').textContent = 'スカイツリー登頂阻止！';
  }

  function climbFailed() {
    skytree.saved = true;
    spawnFloater(skytree.x, groundY - 300, 'スカイツリー 登頂阻止!', '#7dffb0');
    SFX.saved();
    markSchedule('sched-skytree', true);
    phase = 'done';
    document.getElementById('phaseBar').classList.add('hidden');
    endGame();
  }

  function climbSucceeded() {
    phase = 'flaming';
    flameTimeLeft = FLAME_DURATION;
    cityHealth = CITY_HEALTH;
    spawnFloater(skytree.x, groundY - 320, '登頂された…放火開始!', '#ff5b5b');
    triggerShake(10, 0.4);
    document.getElementById('phaseLabel').textContent = '街への放火を消火せよ！';
  }

  function endFlame() {
    skytree.saved = cityHealth > 0;
    markSchedule('sched-skytree', skytree.saved);
    if (skytree.saved) {
      spawnFloater(skytree.x, groundY - 320, '街は守られた!', '#7dffb0');
      SFX.saved();
    } else {
      spawnFloater(skytree.x, groundY - 320, '街は灰に…', '#ff5b5b');
      SFX.destroyed();
    }
    phase = 'done';
    document.getElementById('phaseBar').classList.add('hidden');
    endGame();
  }

  // ---------- Update ----------
  function updateGodzilla(dt) {
    godzilla.walkPhase += dt * (staggerTimer > 0 ? 1.5 : 4);
    godzilla.angry = Math.max(0, godzilla.angry - dt);

    if (phase === 'climbing') {
      const rate = 100 / CLIMB_DURATION;
      climbProgress = clamp(climbProgress + rate * dt, 0, 100);
      climbTimeLeft -= dt;
      godzilla.climbY = groundY - (climbProgress / 100) * (H * 0.62);
      document.getElementById('phaseFill').style.width = climbProgress + '%';
      if (climbProgress >= 100) climbSucceeded();
      else if (climbTimeLeft <= 0) climbFailed();
      return;
    }

    if (phase === 'flaming') {
      const dps = Math.max(0, BASE_FIRE_DPS - firetrucks * TRUCK_DPS_REDUCTION);
      cityHealth -= dps * dt;
      flameTimeLeft -= dt;
      document.getElementById('phaseFill').style.width = clamp((cityHealth / CITY_HEALTH) * 100, 0, 100) + '%';
      if (cityHealth <= 0 || flameTimeLeft <= 0) { cityHealth = Math.max(0, cityHealth); endFlame(); }
      return;
    }

    if (phase === 'done') return;

    if (staggerTimer > 0) {
      staggerTimer -= dt;
      godzilla.angry = 0.3;
      return;
    }

    godzilla.x += BASE_SPEED * dt;

    for (const t of tanks) {
      if (!t.alive) continue;
      if (Math.abs(godzilla.x - t.x) < TANK_TRIGGER_R) {
        t.alive = false;
        staggerTimer = TANK_DELAY;
        spawnParticles(t.x, groundY - 14, '#ff8a5b', 20, 200, 0.6);
        spawnFloater(t.x, groundY - 60, '足止め成功!', '#ffd166');
        triggerShake(8, 0.25);
        SFX.explosion();
        break;
      }
    }

    if (phase === 'toTower' && godzilla.x >= tower.x) {
      resolveTower();
      phase = 'toTocho';
    } else if (phase === 'toTocho' && godzilla.x >= tocho.x) {
      resolveTocho();
      phase = 'toSkytree';
    } else if (phase === 'toSkytree' && godzilla.x >= skytree.x) {
      startClimb();
    }
  }

  function updateMissiles(dt) {
    for (let i = missiles.length - 1; i >= 0; i--) {
      const m = missiles[i];
      m.life -= dt;
      if (m.life <= 0) {
        if (phase === 'climbing') {
          climbProgress = clamp(climbProgress - MISSILE_CLIMB_DMG, 0, 100);
          spawnFloater(godzilla.x, m.targetY - 20, `climb -${MISSILE_CLIMB_DMG}`, '#ff8a5b');
        } else if (phase !== 'flaming' && phase !== 'done') {
          staggerTimer = Math.max(staggerTimer, MISSILE_STAGGER);
        }
        spawnParticles(m.targetX, m.targetY, '#ffd166', 22, 240, 0.5);
        triggerShake(6, 0.2);
        SFX.explosion();
        missiles.splice(i, 1);
      }
    }
  }

  function updateCooldowns(dt) {
    tankCooldown = Math.max(0, tankCooldown - dt);
    missileCooldown = Math.max(0, missileCooldown - dt);
    reinforceCooldown = Math.max(0, reinforceCooldown - dt);
    truckCooldown = Math.max(0, truckCooldown - dt);
  }

  function updateCamera() {
    const targetX = clamp(godzilla.x - W * 0.35, 0, Math.max(0, WORLD.width - W));
    camera.x += (targetX - camera.x) * 0.08;
  }

  // ---------- Drawing ----------
  function drawTower() {
    const sx = tower.x - camera.x;
    if (sx < -260 || sx > W + 260) return;
    const destroyed = tower.saved === false;
    ctx.save();
    ctx.translate(sx, groundY);
    ctx.globalAlpha = destroyed ? 0.35 : 1;
    ctx.strokeStyle = destroyed ? '#553' : '#ff5b5b';
    ctx.fillStyle = destroyed ? '#432' : 'rgba(255,91,91,0.12)';
    ctx.lineWidth = 3;
    const h = destroyed ? tower.h * 0.35 : tower.h;
    ctx.beginPath();
    ctx.moveTo(-40, 0); ctx.lineTo(-8, -h); ctx.lineTo(8, -h); ctx.lineTo(40, 0);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
    // cross braces
    for (let i = 1; i < 6; i++) {
      const yy = -h * (i / 6);
      const ww = 40 * (1 - i / 6.5);
      ctx.beginPath();
      ctx.moveTo(-ww, yy); ctx.lineTo(ww, yy);
      ctx.stroke();
    }
    if (!destroyed) {
      ctx.fillStyle = '#ff5b5b';
      ctx.beginPath(); ctx.arc(0, -h - 4, 4, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  function drawTocho() {
    const sx = tocho.x - camera.x;
    if (sx < -260 || sx > W + 260) return;
    const destroyed = tocho.saved === false;
    ctx.save();
    ctx.translate(sx, groundY);
    ctx.globalAlpha = destroyed ? 0.35 : 1;
    const h = destroyed ? tocho.h * 0.3 : tocho.h;
    ctx.fillStyle = destroyed ? '#334' : '#39445c';
    ctx.strokeStyle = '#6be8ff';
    ctx.lineWidth = 1.5;
    ctx.fillRect(-55, -h, 42, h);
    ctx.fillRect(5, -h, 42, h);
    ctx.strokeRect(-55, -h, 42, h);
    ctx.strokeRect(5, -h, 42, h);
    ctx.beginPath(); ctx.moveTo(-34, -h); ctx.lineTo(-34, -h - 16); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(26, -h); ctx.lineTo(26, -h - 16); ctx.stroke();

    if (!destroyed && tocho.defense > 0) {
      const pct = tocho.defense / STOMP_DAMAGE;
      ctx.strokeStyle = '#7dffb0';
      ctx.lineWidth = 3;
      ctx.strokeRect(-58, -h - 24, 106 * pct, 6);
      ctx.strokeStyle = 'rgba(255,255,255,0.3)';
      ctx.strokeRect(-58, -h - 24, 106, 6);
    }
    ctx.restore();
  }

  function drawSkytree() {
    const sx = skytree.x - camera.x;
    if (sx < -200 || sx > W + 200) return;
    const destroyed = skytree.saved === false;
    const h = H * 0.7;
    ctx.save();
    ctx.translate(sx, groundY);
    ctx.strokeStyle = destroyed ? '#664' : '#ffd166';
    ctx.fillStyle = destroyed ? 'rgba(120,80,40,0.25)' : 'rgba(255,209,102,0.08)';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(-26, 0); ctx.lineTo(-5, -h); ctx.lineTo(5, -h); ctx.lineTo(26, 0);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
    for (let i = 1; i < 10; i++) {
      const yy = -h * (i / 10);
      const ww = 26 * (1 - i / 11);
      ctx.beginPath(); ctx.moveTo(-ww, yy); ctx.lineTo(ww, yy); ctx.stroke();
    }
    ctx.restore();
  }

  function drawTanks() {
    for (const t of tanks) {
      if (!t.alive) continue;
      const sx = t.x - camera.x;
      if (sx < -40 || sx > W + 40) continue;
      ctx.save();
      ctx.translate(sx, groundY);
      ctx.fillStyle = '#3d5a3d';
      ctx.strokeStyle = '#7dffb0';
      ctx.lineWidth = 1.5;
      ctx.fillRect(-16, -14, 32, 14);
      ctx.strokeRect(-16, -14, 32, 14);
      ctx.beginPath();
      ctx.arc(0, -14, 7, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, -14); ctx.lineTo(18, -20);
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawMissiles() {
    for (const m of missiles) {
      const t = 1 - m.life / m.maxLife;
      const sx = m.targetX - camera.x;
      const sy = -H * 0.3 + t * (m.targetY + H * 0.3);
      ctx.save();
      ctx.strokeStyle = '#ffd166';
      ctx.shadowColor = '#ffd166';
      ctx.shadowBlur = 10;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(sx, sy - 26);
      ctx.lineTo(sx, sy);
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawGodzilla() {
    const sx = godzilla.x - camera.x;
    if (sx < -150 || sx > W + 150) return;
    const climbing = phase === 'climbing';
    const flaming = phase === 'flaming';
    const sy = climbing ? godzilla.climbY : groundY;
    const legOffset = Math.sin(godzilla.walkPhase) * (climbing ? 4 : 10);
    const bodyColor = godzilla.angry > 0 ? '#5a2a3a' : '#2a3a2a';

    ctx.save();
    ctx.translate(sx, sy);
    if (climbing) ctx.rotate(-0.12);

    // tail
    ctx.strokeStyle = bodyColor;
    ctx.lineWidth = 18;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-40, -30);
    ctx.quadraticCurveTo(-90, -20 + legOffset, -120, -50);
    ctx.stroke();

    // legs
    ctx.fillStyle = bodyColor;
    ctx.fillRect(-24, -20, 16, 20 + legOffset);
    ctx.fillRect(4, -20, 16, 20 - legOffset);

    // body
    ctx.fillStyle = bodyColor;
    ctx.strokeStyle = '#0e1a0e';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(-10, -55, 42, 34, 0, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();

    // spikes
    ctx.fillStyle = '#ffd166';
    for (let i = 0; i < 5; i++) {
      const px = -42 + i * 16;
      const py = -80 - Math.sin(i * 1.2) * 6;
      ctx.beginPath();
      ctx.moveTo(px, -55);
      ctx.lineTo(px + 6, py);
      ctx.lineTo(px + 12, -55);
      ctx.closePath();
      ctx.fill();
    }

    // head
    ctx.fillStyle = bodyColor;
    ctx.beginPath();
    ctx.ellipse(30, -68, 24, 18, -0.2, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();

    // eye
    ctx.fillStyle = godzilla.angry > 0 ? '#ff3030' : '#ff8a5b';
    ctx.shadowColor = ctx.fillStyle;
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.arc(40, -72, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    // flame breath
    if (flaming) {
      const flameLen = 220 + Math.sin(performance.now() / 60) * 30;
      const grad = ctx.createLinearGradient(50, -68, 50 + flameLen, -68);
      grad.addColorStop(0, 'rgba(255,209,102,0.9)');
      grad.addColorStop(0.5, 'rgba(255,138,91,0.6)');
      grad.addColorStop(1, 'rgba(255,91,91,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(50, -74);
      ctx.lineTo(50 + flameLen, -68 - 40);
      ctx.lineTo(50 + flameLen, -68 + 40);
      ctx.lineTo(50, -62);
      ctx.closePath();
      ctx.fill();
    }

    ctx.restore();
  }

  function drawTruckDock() {
    if (firetrucks <= 0) return;
    const baseX = skytree.x - camera.x - 120;
    for (let i = 0; i < firetrucks; i++) {
      const sx = baseX + i * 26;
      if (sx < -30 || sx > W + 30) continue;
      ctx.save();
      ctx.translate(sx, groundY);
      ctx.fillStyle = '#c23b3b';
      ctx.strokeStyle = '#ffd166';
      ctx.lineWidth = 1.2;
      ctx.fillRect(-12, -16, 24, 16);
      ctx.strokeRect(-12, -16, 24, 16);
      if (phase === 'flaming') {
        ctx.strokeStyle = 'rgba(107,232,255,0.7)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(10, -14);
        ctx.lineTo(40, -30 - Math.sin(performance.now() / 100 + i) * 6);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  // ---------- UI ----------
  function updateUI() {
    document.getElementById('budget').textContent = `¥${Math.floor(budget)}`;
    const mm = String(Math.floor(elapsed / 60)).padStart(2, '0');
    const ss = String(Math.floor(elapsed % 60)).padStart(2, '0');
    document.getElementById('clock').textContent = `${mm}:${ss}`;

    setToolState('btnTank', TANK_COST, tankCooldown, TANK_CD, phase === 'climbing' || phase === 'flaming');
    setToolState('btnMissile', MISSILE_COST, missileCooldown, MISSILE_CD, false);
    setToolState('btnReinforce', REINFORCE_COST, reinforceCooldown, REINFORCE_CD, (phase !== 'toTower' && phase !== 'toTocho') || tocho.defense >= STOMP_DAMAGE);
    setToolState('btnTruck', TRUCK_COST, truckCooldown, TRUCK_CD, firetrucks >= MAX_TRUCKS);
  }

  function setToolState(id, cost, cd, cdMax, forceDisabled) {
    const el = document.getElementById(id);
    const cdBar = el.querySelector('.tool-cd');
    const disabled = forceDisabled || budget < cost || cd > 0;
    el.classList.toggle('disabled', disabled);
    cdBar.style.width = cd > 0 ? `${(cd / cdMax) * 100}%` : '0%';
  }

  // ---------- Input ----------
  document.getElementById('btnTank').addEventListener('click', () => {
    placingTank = !placingTank;
    document.getElementById('btnTank').classList.toggle('active', placingTank);
  });
  document.getElementById('btnMissile').addEventListener('click', fireMissile);
  document.getElementById('btnReinforce').addEventListener('click', reinforceTocho);
  document.getElementById('btnTruck').addEventListener('click', deployTruck);

  canvas.addEventListener('click', (e) => {
    if (state !== 'playing' || !placingTank) return;
    const worldX = e.clientX + camera.x;
    placeTank(worldX);
  });

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

    if (state === 'playing') {
      elapsed += dt;
      budget += BUDGET_REGEN * dt;
      updateCooldowns(dt);
      updateGodzilla(dt);
      updateMissiles(dt);
      updateCamera();
      updateUI();
    }

    updateParticles(dt);
    updateFloaters(dt);

    ctx.save();
    ctx.translate(shakeX, shakeY);
    drawBackground();
    drawTower();
    drawTocho();
    drawSkytree();
    drawTruckDock();
    drawTanks();
    if (state === 'playing') drawGodzilla();
    drawMissiles();
    drawParticles();
    drawFloaters();
    ctx.restore();

    if (INSPECT) {
      window.__DEBUG_STATE__ = {
        state, phase, elapsed, budget, godzilla: { x: godzilla.x }, tower, tocho, skytree,
        tanks, missiles, staggerTimer, climbProgress, climbTimeLeft, cityHealth, flameTimeLeft, firetrucks,
      };
    }

    requestAnimationFrame(loop);
  }

  requestAnimationFrame(loop);
})();
