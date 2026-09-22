(() => {
  'use strict';

  const DEBUG = /[?&]debug/.test(location.search);
  const INSPECT = DEBUG || /[?&]inspect/.test(location.search);

  // ---------- Canvas setup ----------
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  let W = 0, H = 0, DPR = Math.min(window.devicePixelRatio || 1, 2);
  let FOCAL = 500;

  function resize() {
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = W * DPR;
    canvas.height = H * DPR;
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    FOCAL = H * 1.05;
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
    jump: () => beep({ freq: 420, dur: 0.1, type: 'square', gain: 0.06, slide: 220 }),
    hit: () => { noiseBurst({ dur: 0.3, gain: 0.2 }); beep({ freq: 140, dur: 0.25, type: 'sawtooth', gain: 0.14, slide: -80 }); },
    impact: () => { noiseBurst({ dur: 0.4, gain: 0.26, filterFreq: 500 }); beep({ freq: 60, dur: 0.35, type: 'sine', gain: 0.22 }); },
    roar: () => { beep({ freq: 90, dur: 0.5, type: 'sawtooth', gain: 0.13, slide: 40 }); beep({ freq: 55, dur: 0.6, type: 'sawtooth', gain: 0.11, slide: -20, delay: 0.1 }); },
    warn: () => beep({ freq: 700, dur: 0.08, type: 'square', gain: 0.05, slide: -200 }),
    collapse: () => { noiseBurst({ dur: 0.5, gain: 0.2, filterFreq: 700 }); beep({ freq: 80, dur: 0.4, type: 'sawtooth', gain: 0.12, slide: -40 }); },
    punchHit: () => { noiseBurst({ dur: 0.12, gain: 0.16, filterFreq: 900 }); beep({ freq: 180, dur: 0.09, type: 'square', gain: 0.12, slide: -100 }); },
    punchWhiff: () => beep({ freq: 300, dur: 0.1, type: 'sine', gain: 0.04, slide: 120 }),
    gameover: () => { beep({ freq: 300, dur: 0.4, type: 'sawtooth', gain: 0.12, slide: -250 }); beep({ freq: 200, dur: 0.5, type: 'sawtooth', gain: 0.12, slide: -150, delay: 0.15 }); },
    victory: () => { beep({ freq: 440, dur: 0.15, type: 'triangle', gain: 0.1 }); beep({ freq: 550, dur: 0.15, type: 'triangle', gain: 0.1, delay: 0.15 }); beep({ freq: 660, dur: 0.3, type: 'triangle', gain: 0.1, delay: 0.3 }); },
  };

  // ---------- Utility ----------
  const rand = (a, b) => a + Math.random() * (b - a);
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function angDiff(a, b) {
    let d = a - b;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return d;
  }

  // ---------- World constants ----------
  const ARENA_HALF = 24;
  const ARENA_START_Z = 4;
  const GOAL_Z = 92;
  const GOAL_RADIUS = 5;
  const EYE_HEIGHT = 1.65;
  const MOVE_SPEED = 6.2, TURN_SPEED = 2.5;
  const JUMP_V = 6.6, GRAVITY = 19;

  // ---------- Player ----------
  const player = {
    px: 0, pz: ARENA_START_Z, yaw: 0,
    y: 0, vy: 0, jumping: false,
    hp: 3, maxHp: 3, invuln: 0, stumble: 0, bob: 0,
  };

  // ---------- Input ----------
  const keys = {};
  window.addEventListener('keydown', e => {
    keys[e.key] = true;
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' '].includes(e.key)) e.preventDefault();
    if (state === 'playing' && (e.key === 'ArrowUp' || e.key === ' ')) doJump();
    if (state === 'playing' && (e.key === 'f' || e.key === 'F')) doPunch();
  });
  window.addEventListener('keyup', e => { keys[e.key] = false; });
  canvas.addEventListener('mousedown', () => { if (state === 'playing') doPunch(); });

  function doJump() {
    if (player.jumping) return;
    player.jumping = true;
    player.vy = JUMP_V;
    SFX.jump();
  }

  // ---------- 3D projection (camera = player position + yaw) ----------
  function project(wx, wy, wz) {
    const dx = wx - player.px;
    const dz = wz - player.pz;
    const sy = Math.sin(player.yaw), cy = Math.cos(player.yaw);
    const forward = dx * sy + dz * cy;
    const right = dx * cy - dz * sy;
    if (forward < 0.25) return null;
    const scale = FOCAL / forward;
    const bobY = player.jumping ? 0 : Math.sin(player.bob) * 0.05;
    const eyeY = EYE_HEIGHT + player.y * 0.9 + bobY;
    return { sx: W / 2 + right * scale, sy: H / 2 - (wy - eyeY) * scale, scale, z: forward };
  }

  // relative bearing of a world point from the player's current facing: 'front'|'back'|'left'|'right'
  function bearingOf(wx, wz) {
    const dx = wx - player.px, dz = wz - player.pz;
    const ang = Math.atan2(dx, dz); // 0 = +Z, positive toward +X
    const rel = angDiff(ang, player.yaw);
    const deg = rel * 180 / Math.PI;
    if (deg > -45 && deg <= 45) return 'front';
    if (deg > 45 && deg <= 135) return 'right';
    if (deg > -135 && deg <= -45) return 'left';
    return 'back';
  }

  // ---------- Buildings (static scenery around the arena) ----------
  let buildings = [];
  function initBuildings() {
    buildings = [];
    for (let i = 0; i < 26; i++) {
      const z = rand(0, GOAL_Z + 15);
      const side = Math.random() < 0.5 ? -1 : 1;
      const w = rand(4, 7), h = rand(8, 32);
      const x = side * rand(ARENA_HALF + 3, ARENA_HALF + 16);
      buildings.push({ x, z, w, h, lit: Math.random() < 0.45, damaged: false, fireT: 0, tint: rand(-8, 10) });
    }
  }

  // ---------- Static ground obstacles ----------
  const OBSTACLE_TYPES = {
    rubble: { color: '#8a7a68', h: 1.1, w: 1.8, r: 1.1 },
    fire: { color: '#ff6b3d', h: 1.6, w: 1.9, r: 1.1 },
    car: { color: '#5b6b7a', h: 1.4, w: 2.1, r: 1.3 },
  };
  let obstacles = [];
  function initObstacles() {
    obstacles = [];
    const types = Object.keys(OBSTACLE_TYPES);
    for (let i = 0; i < 15; i++) {
      const type = types[Math.floor(rand(0, types.length))];
      const x = rand(-ARENA_HALF + 3, ARENA_HALF - 3);
      const z = rand(ARENA_START_Z + 10, GOAL_Z - 8);
      obstacles.push({ type, x, z });
    }
  }

  // ---------- Godzilla ----------
  const WANDER_SPEED = 3.2, ATTACK_SPEED = 15, ENGAGE_DIST = 10;
  const godzilla = {
    x: 14, z: 40, targetX: 14, targetZ: 40, roarT: 0, walkPhase: 0,
    mode: 'wander', // 'wander' | 'attacking'
  };
  function pickGodzillaTarget() {
    // wander somewhere in the player's general vicinity, not the far corners of the arena,
    // so he stays a visible, present threat rather than an occasional background prop
    const a = rand(0, Math.PI * 2);
    const d = rand(12, 26);
    godzilla.targetX = clamp(player.px + Math.sin(a) * d, -ARENA_HALF - 4, ARENA_HALF + 4);
    godzilla.targetZ = clamp(player.pz + Math.cos(a) * d, 6, GOAL_Z + 12);
  }
  function sendGodzillaToAttack(dx, dz, dist) {
    godzilla.mode = 'attacking';
    godzilla.targetX = clamp(player.px + dx * dist, -ARENA_HALF - 4, ARENA_HALF + 4);
    godzilla.targetZ = clamp(player.pz + dz * dist, 1, GOAL_Z + 12);
  }

  // ---------- Hazards (directional attacks anchored in world space) ----------
  // kind: 'front' | 'back' | 'left' | 'right' | 'aoe'
  let hazard = null; // { kind, cx, cz, radius, t, dur, resolved }
  let hazardTimer = 4;
  let hazardMin = 4.5, hazardMax = 7;

  const DIR_VEC = {
    front: () => [Math.sin(player.yaw), Math.cos(player.yaw)],
    back: () => [-Math.sin(player.yaw), -Math.cos(player.yaw)],
    left: () => [-Math.cos(player.yaw), Math.sin(player.yaw)],
    right: () => [Math.cos(player.yaw), -Math.sin(player.yaw)],
  };

  function scheduleHazard(forcedKind) {
    if (hazard) return;
    const roll = Math.random();
    let kind = forcedKind || null;
    if (!kind) {
      if (roll < 0.22) kind = 'front';
      else if (roll < 0.44) kind = 'back';
      else if (roll < 0.66) kind = 'left';
      else if (roll < 0.85) kind = 'right';
      else kind = 'aoe';
    }

    if (kind === 'aoe') {
      hazard = { kind, cx: player.px, cz: player.pz, radius: 5.5, t: 0, dur: 1.3, resolved: false };
      sendGodzillaToAttack(0, 0, 0);
      godzilla.roarT = 1.3;
      SFX.roar();
    } else {
      // The zone targets where the player IS RIGHT NOW (must move away to dodge); the small
      // offset in the telegraphed direction is only there so the ground marker reads clearly
      // as "coming from that side," not to make standing still safe.
      const [dx, dz] = DIR_VEC[kind]();
      const radius = kind === 'back' ? 3.4 : 3.0;
      hazard = { kind, cx: player.px + dx * (radius * 0.35), cz: player.pz + dz * (radius * 0.35), radius, t: 0, dur: 1.0, resolved: false };
      // Godzilla physically closes in from that same bearing — the attack IS him arriving there.
      sendGodzillaToAttack(dx, dz, ENGAGE_DIST);
      SFX.warn();
    }
  }

  function triggerBuildingCollapse() {
    const candidates = buildings.filter(b => !b.damaged && Math.abs(b.z - player.pz) < 30);
    if (candidates.length) {
      const b = candidates[Math.floor(rand(0, candidates.length))];
      b.damaged = true;
      b.fireT = 3;
      SFX.collapse();
      triggerShake(5, 0.25);
    }
  }

  // ---------- Particles ----------
  let particles = [];
  function spawnParticles3D(x, y, z, color, count = 12, speed = 4, life = 0.7) {
    for (let i = 0; i < count; i++) {
      const a = rand(0, Math.PI * 2);
      const s = rand(speed * 0.3, speed);
      particles.push({
        x, y, z,
        vx: Math.cos(a) * s, vy: rand(1, 4), vz: Math.sin(a) * s,
        life: rand(life * 0.5, life), maxLife: life, color, r: rand(2, 5),
      });
    }
  }
  function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.vy -= 9 * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      p.life -= dt;
      if (p.life <= 0 || p.y < -1) particles.splice(i, 1);
    }
  }

  // screen-space floaters (fixed UI position, not world-projected) for short callouts
  let screenFloaters = [];
  function spawnFloaterScreen(text, color) {
    screenFloaters.push({ text, color, life: 1.3, maxLife: 1.3 });
  }
  function updateScreenFloaters(dt) {
    for (let i = screenFloaters.length - 1; i >= 0; i--) {
      screenFloaters[i].life -= dt;
      if (screenFloaters[i].life <= 0) screenFloaters.splice(i, 1);
    }
  }
  function drawScreenFloaters() {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.font = 'bold 22px "Noto Sans JP", sans-serif';
    screenFloaters.forEach((f, i) => {
      ctx.globalAlpha = clamp(f.life / f.maxLife, 0, 1);
      ctx.fillStyle = f.color;
      ctx.shadowColor = f.color;
      ctx.shadowBlur = 10;
      ctx.fillText(f.text, W / 2, H * 0.26 - i * 30);
    });
    ctx.restore();
  }

  // ---------- Game state ----------
  let state = 'start'; // start | playing | ended
  let elapsed = 0;
  let shakeTime = 0, shakeMag = 0;
  let flashAlpha = 0;
  let lastTime = performance.now();
  let provokeCount = 0;
  let punchCooldown = 0;
  let punchAnim = 0;
  const PUNCH_RANGE = 13, PUNCH_CD = 0.6;

  function triggerShake(mag, time) {
    shakeMag = Math.max(shakeMag, mag);
    shakeTime = Math.max(shakeTime, time);
  }

  function doPunch() {
    if (punchCooldown > 0) return;
    punchCooldown = PUNCH_CD;
    punchAnim = 0.25;
    const d = Math.hypot(godzilla.x - player.px, godzilla.z - player.pz);
    const inFront = bearingOf(godzilla.x, godzilla.z) === 'front';
    if (d < PUNCH_RANGE && inFront) {
      provokeCount += 1;
      godzilla.roarT = 0.6;
      triggerShake(4, 0.15);
      spawnParticles3D(godzilla.x, 2, godzilla.z, '#ffd166', 10, 3, 0.4);
      spawnFloaterScreen('挑発成功！ゴジラが怒っている', '#ffd166');
      SFX.punchHit();
      // provoke him into an immediate frontal counter-attack
      if (!hazard) {
        hazardTimer = 0.5;
        pendingForcedKind = 'front';
      }
    } else {
      SFX.punchWhiff();
    }
  }

  let pendingForcedKind = null;

  function resetGame() {
    player.px = rand(-4, 4); player.pz = ARENA_START_Z; player.yaw = 0;
    player.y = 0; player.vy = 0; player.jumping = false;
    player.hp = player.maxHp; player.invuln = 1.0; player.stumble = 0; player.bob = 0;
    particles = [];
    screenFloaters = [];
    hazard = null; hazardTimer = 4; hazardMin = 4.5; hazardMax = 7;
    pendingForcedKind = null;
    provokeCount = 0; punchCooldown = 0; punchAnim = 0;
    godzilla.x = 14; godzilla.z = 44; godzilla.roarT = 0; godzilla.mode = 'wander';
    pickGodzillaTarget();
    elapsed = 0;
    flashAlpha = 0;
    initBuildings();
    initObstacles();
    updateLivesUI();
    hideAllDirWarn();
  }

  function startGame() {
    resetGame();
    state = 'playing';
    document.getElementById('startScreen').classList.add('hidden');
    document.getElementById('gameOverScreen').classList.add('hidden');
  }

  function updateLivesUI() {
    const el = document.getElementById('lives');
    el.innerHTML = '';
    for (let i = 0; i < player.maxHp; i++) {
      const h = document.createElement('div');
      h.className = 'heart' + (i < player.hp ? '' : ' lost');
      el.appendChild(h);
    }
  }

  function endGame(won) {
    state = 'ended';
    const title = document.getElementById('resultTitle');
    const body = document.getElementById('resultBody');
    hideAllDirWarn();
    if (won) {
      title.textContent = 'ESCAPED';
      title.classList.add('over');
      SFX.victory();
      body.textContent = `全方位からの猛攻を潜り抜け、ゲートに辿り着いた。生存時間: ${Math.floor(elapsed)}秒／挑発成功: ${provokeCount}回`;
    } else {
      title.textContent = 'CAUGHT';
      title.classList.remove('over');
      SFX.gameover();
      body.textContent = `怪獣の猛威に飲み込まれた。生存時間: ${Math.floor(elapsed)}秒／挑発成功: ${provokeCount}回`;
    }
    document.getElementById('gameOverScreen').classList.remove('hidden');
  }

  function takeDamage() {
    if (player.invuln > 0) return;
    player.hp -= 1;
    player.invuln = 1.4;
    player.stumble = 0.5;
    triggerShake(10, 0.3);
    flashAlpha = 0.5;
    SFX.hit();
    updateLivesUI();
    if (player.hp <= 0) endGame(false);
  }

  // ---------- Update ----------
  function updatePlayer(dt) {
    if (keys['ArrowLeft']) player.yaw -= TURN_SPEED * dt;
    if (keys['ArrowRight']) player.yaw += TURN_SPEED * dt;

    const moveMul = player.stumble > 0 ? 0.4 : 1;
    let mx = 0, mz = 0;
    const fx = Math.sin(player.yaw), fz = Math.cos(player.yaw);
    const rx = Math.cos(player.yaw), rz = -Math.sin(player.yaw);
    if (keys['w'] || keys['W']) { mx += fx; mz += fz; }
    if (keys['s'] || keys['S']) { mx -= fx; mz -= fz; }
    if (keys['d'] || keys['D']) { mx += rx; mz += rz; }
    if (keys['a'] || keys['A']) { mx -= rx; mz -= rz; }
    const mlen = Math.hypot(mx, mz);
    let moving = false;
    if (mlen > 0.01) {
      moving = true;
      player.px += (mx / mlen) * MOVE_SPEED * moveMul * dt;
      player.pz += (mz / mlen) * MOVE_SPEED * moveMul * dt;
    }
    player.px = clamp(player.px, -ARENA_HALF + 1, ARENA_HALF - 1);
    player.pz = clamp(player.pz, 0.5, GOAL_Z + 8);

    if (player.jumping) {
      player.y += player.vy * dt;
      player.vy -= GRAVITY * dt;
      if (player.y <= 0) { player.y = 0; player.vy = 0; player.jumping = false; }
    } else if (moving) {
      player.bob += dt * (player.stumble > 0 ? 6 : 11);
    }

    player.invuln = Math.max(0, player.invuln - dt);
    player.stumble = Math.max(0, player.stumble - dt);
  }

  function updateObstacleCollisions() {
    if (player.invuln > 0) return;
    for (const o of obstacles) {
      const t = OBSTACLE_TYPES[o.type];
      const d = Math.hypot(player.px - o.x, player.pz - o.z);
      if (d < t.r + 0.5 && player.y < 0.5) {
        takeDamage();
        spawnParticles3D(o.x, 0.5, o.z, t.color, 12, 3.2, 0.5);
        break;
      }
    }
  }

  function updateGodzilla(dt) {
    const speed = godzilla.mode === 'attacking' ? ATTACK_SPEED : WANDER_SPEED;
    godzilla.walkPhase += dt * (godzilla.mode === 'attacking' ? 5 : 2);
    const dx = godzilla.targetX - godzilla.x, dz = godzilla.targetZ - godzilla.z;
    const d = Math.hypot(dx, dz);
    if (d < 1.5) {
      if (godzilla.mode === 'wander') pickGodzillaTarget();
      // while attacking, once he arrives he just holds position until the hazard resolves
    } else {
      godzilla.x += (dx / d) * speed * dt;
      godzilla.z += (dz / d) * speed * dt;
    }
    if (godzilla.roarT > 0) godzilla.roarT -= dt;
  }

  function hideAllDirWarn() {
    ['dirWarnFront', 'dirWarnBack', 'dirWarnLeft', 'dirWarnRight', 'dirWarnAoe'].forEach(id =>
      document.getElementById(id).classList.remove('show'));
  }

  function updateHazard(dt) {
    hazardTimer -= dt;
    if (hazardTimer <= 0 && !hazard) {
      if (pendingForcedKind) {
        scheduleHazard(pendingForcedKind);
        pendingForcedKind = null;
      } else if (Math.random() < 0.12) {
        triggerBuildingCollapse();
      } else {
        scheduleHazard();
      }
      hazardTimer = rand(hazardMin, hazardMax);
      hazardMin = Math.max(3, hazardMin - 0.12);
      hazardMax = Math.max(4.2, hazardMax - 0.12);
    }

    hideAllDirWarn();
    if (!hazard) return;

    hazard.t += dt;
    const displayKind = hazard.kind === 'aoe' ? 'aoe' : bearingOf(hazard.cx, hazard.cz);
    const idMap = { front: 'dirWarnFront', back: 'dirWarnBack', left: 'dirWarnLeft', right: 'dirWarnRight', aoe: 'dirWarnAoe' };
    document.getElementById(idMap[displayKind]).classList.add('show');

    if (hazard.t >= hazard.dur) {
      const d = Math.hypot(player.px - hazard.cx, player.pz - hazard.cz);
      const jumpHelps = hazard.kind === 'back' || hazard.kind === 'aoe';
      const airborne = player.y > 0.5;
      const safe = d > hazard.radius || (jumpHelps && airborne);
      SFX.impact();
      triggerShake(hazard.kind === 'aoe' ? 14 : 9, 0.35);
      spawnParticles3D(hazard.cx, 0.3, hazard.cz, hazard.kind === 'aoe' ? '#ff8a5b' : '#ff5b5b', 20, 4.5, 0.6);
      if (!safe) takeDamage();
      hazard = null;
      godzilla.mode = 'wander';
      pickGodzillaTarget();
    }
  }

  function updateCompass() {
    const dx = 0 - player.px, dz = GOAL_Z - player.pz;
    const ang = Math.atan2(dx, dz);
    const rel = angDiff(ang, player.yaw);
    const arrow = document.getElementById('compassArrow');
    arrow.style.transform = `rotate(${rel}rad)`;
    const dist = Math.hypot(dx, dz);
    document.getElementById('compassLabel').textContent = `ゲートまで ${Math.max(0, Math.floor(dist))}m`;
  }

  // ---------- Drawing ----------
  function drawSky() {
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, '#2a0f0a');
    grad.addColorStop(0.55, '#4a1a10');
    grad.addColorStop(1, '#1a0806');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
  }

  function drawGround() {
    const horizon = H / 2;
    const grad = ctx.createLinearGradient(0, horizon, 0, H);
    grad.addColorStop(0, '#241210');
    grad.addColorStop(1, '#0c0504');
    ctx.fillStyle = grad;
    ctx.fillRect(0, horizon, W, H - horizon);
  }

  function drawGoalGate() {
    const halfW = 4.5, h = 7;
    const cx = 0, cz = GOAL_Z;
    const tl = project(cx - halfW, h, cz);
    const tr = project(cx + halfW, h, cz);
    const bl = project(cx - halfW, 0, cz);
    const br = project(cx + halfW, 0, cz);
    if (!tl || !tr || !bl || !br) return;
    const pulse = 0.5 + Math.sin(elapsed * 3) * 0.2;
    ctx.save();
    ctx.strokeStyle = `rgba(125,255,176,${pulse})`;
    ctx.shadowColor = '#7dffb0';
    ctx.shadowBlur = 20;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(bl.sx, bl.sy); ctx.lineTo(tl.sx, tl.sy); ctx.lineTo(tr.sx, tr.sy); ctx.lineTo(br.sx, br.sy);
    ctx.stroke();
    ctx.fillStyle = `rgba(125,255,176,${0.12 * pulse})`;
    ctx.beginPath();
    ctx.moveTo(tl.sx, tl.sy); ctx.lineTo(tr.sx, tr.sy); ctx.lineTo(br.sx, br.sy); ctx.lineTo(bl.sx, bl.sy);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function drawBuildingObj(b) {
    const p = project(b.x, b.h / 2, b.z);
    if (!p) return;
    const w = b.w * p.scale, h = b.h * p.scale;
    const fog = clamp(1 - p.z / 100, 0.15, 1);
    const t = b.tint;
    const baseColor = b.damaged ? [40, 24, 20] : [26 + t, 16 + t * 0.6, 22 + t * 0.8];
    ctx.save();
    ctx.globalAlpha = fog;
    ctx.fillStyle = `rgb(${baseColor[0]},${baseColor[1]},${baseColor[2]})`;
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 1.5;
    ctx.fillRect(p.sx - w / 2, p.sy - h / 2, w, h);
    ctx.strokeRect(p.sx - w / 2, p.sy - h / 2, w, h);
    if (b.lit && !b.damaged) {
      ctx.fillStyle = 'rgba(255,209,102,0.35)';
      for (let r = 0; r < 5; r++) {
        for (let c = 0; c < 4; c++) {
          if ((r + c) % 3 === 0) continue;
          const wx = p.sx - w / 2 + (c + 0.5) * (w / 4);
          const wy = p.sy - h / 2 + (r + 0.5) * (h / 5);
          ctx.fillRect(wx - w / 16, wy - h / 20, w / 8, h / 10);
        }
      }
    }
    if (b.damaged && b.fireT > 0) {
      ctx.globalAlpha = clamp(b.fireT / 3, 0, 1) * fog;
      ctx.fillStyle = '#ff6b3d';
      ctx.shadowColor = '#ff6b3d';
      ctx.shadowBlur = 20;
      ctx.beginPath();
      ctx.arc(p.sx, p.sy, Math.max(4, w * 0.25), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawObstacleObj(o) {
    const t = OBSTACLE_TYPES[o.type];
    const p = project(o.x, t.h / 2, o.z);
    if (!p) return;
    const sizeW = t.w * p.scale, sizeH = t.h * p.scale;
    ctx.save();
    ctx.fillStyle = t.color;
    ctx.shadowColor = t.color;
    ctx.shadowBlur = o.type === 'fire' ? 16 : 4;
    if (o.type === 'fire') {
      ctx.beginPath();
      ctx.ellipse(p.sx, p.sy, sizeW / 2, sizeH / 2, 0, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillRect(p.sx - sizeW / 2, p.sy - sizeH / 2, sizeW, sizeH);
      ctx.strokeStyle = 'rgba(0,0,0,0.4)';
      ctx.strokeRect(p.sx - sizeW / 2, p.sy - sizeH / 2, sizeW, sizeH);
    }
    ctx.restore();
  }

  function drawParticlesObj() {
    for (const pt of particles) {
      const p = project(pt.x, pt.y, pt.z);
      if (!p) continue;
      ctx.save();
      ctx.globalAlpha = clamp(pt.life / pt.maxLife, 0, 1);
      ctx.fillStyle = pt.color;
      ctx.shadowColor = pt.color;
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.arc(p.sx, p.sy, Math.max(1, pt.r * p.scale * 0.3), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  function drawGodzillaSprite() {
    const p = project(godzilla.x, 0, godzilla.z);
    if (!p) return;
    const facingAway = Math.sin(godzilla.walkPhase * 0.3) > 0 ? 1 : -1;
    const bodyColor = godzilla.roarT > 0 ? '#5a2a3a' : '#2a3a2a';
    const s = p.scale * 0.115;

    ctx.save();
    ctx.translate(p.sx, p.sy);
    ctx.scale(facingAway, 1);

    const legOffset = Math.sin(godzilla.walkPhase) * 6 * s;
    ctx.strokeStyle = bodyColor;
    ctx.lineWidth = 18 * s;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-40 * s, -30 * s);
    ctx.quadraticCurveTo(-90 * s, (-20 + legOffset) * s, -130 * s, -40 * s);
    ctx.stroke();

    ctx.fillStyle = bodyColor;
    ctx.fillRect(-24 * s, -20 * s, 16 * s, 20 * s + legOffset);
    ctx.fillRect(4 * s, -20 * s, 16 * s, 20 * s - legOffset);

    ctx.strokeStyle = '#0e1a0e';
    ctx.lineWidth = 2 * s;
    ctx.beginPath();
    ctx.ellipse(-10 * s, -55 * s, 42 * s, 34 * s, 0, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();

    ctx.fillStyle = '#ffd166';
    for (let i = 0; i < 5; i++) {
      const px = (-42 + i * 16) * s;
      const py = (-80 - Math.sin(i * 1.2) * 6) * s;
      ctx.beginPath();
      ctx.moveTo(px, -55 * s);
      ctx.lineTo(px + 6 * s, py);
      ctx.lineTo(px + 12 * s, -55 * s);
      ctx.closePath();
      ctx.fill();
    }

    ctx.fillStyle = bodyColor;
    ctx.beginPath();
    ctx.ellipse(30 * s, -68 * s, 24 * s, 18 * s, -0.2, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = godzilla.roarT > 0 ? '#ff3030' : '#ff8a5b';
    ctx.shadowColor = ctx.fillStyle;
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.arc(40 * s, -72 * s, 4 * s, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  function drawHazardMarker() {
    if (!hazard) return;
    const p = project(hazard.cx, 0.03, hazard.cz);
    const progress = clamp(hazard.t / hazard.dur, 0, 1);
    if (p) {
      const pulse = 0.4 + Math.sin(elapsed * 14) * 0.25;
      ctx.save();
      ctx.globalAlpha = 0.35 + progress * 0.5;
      ctx.strokeStyle = progress > 0.75 ? '#ff2020' : '#ffd166';
      ctx.shadowColor = ctx.strokeStyle;
      ctx.shadowBlur = 14;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.ellipse(p.sx, p.sy, hazard.radius * p.scale * (0.6 + pulse * 0.1), hazard.radius * p.scale * 0.35, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawPunchFist() {
    if (punchAnim <= 0) return;
    const t = 1 - punchAnim / 0.25;
    const reach = Math.sin(t * Math.PI); // out and back
    const fx = W / 2 + 60, fy = H - 90 - reach * 140;
    ctx.save();
    ctx.translate(fx, fy);
    ctx.fillStyle = '#e8b98c';
    ctx.strokeStyle = '#5a3a24';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, 34, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#c99a6e';
    for (let i = -1; i <= 1; i++) {
      ctx.beginPath();
      ctx.arc(i * 14, -22, 8, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawVignette() {
    const grad = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.75);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0,0,0,0.45)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
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

    if (state === 'playing') {
      elapsed += dt;
      updatePlayer(dt);
      updateObstacleCollisions();
      updateGodzilla(dt);
      updateHazard(dt);
      updateCompass();
      punchCooldown = Math.max(0, punchCooldown - dt);
      punchAnim = Math.max(0, punchAnim - dt);
      document.getElementById('distance').textContent = `${Math.floor(elapsed)} s`;
      if (player.pz >= GOAL_Z - GOAL_RADIUS && Math.abs(player.px) < GOAL_RADIUS + 2) endGame(true);
    }

    updateParticles(dt);
    updateScreenFloaters(dt);

    ctx.save();
    ctx.translate(shakeX, shakeY);
    drawSky();
    drawGround();
    drawGoalGate();

    const drawList = [];
    for (const b of buildings) drawList.push({ z: project(b.x, 0, b.z)?.z ?? -1, fn: () => drawBuildingObj(b) });
    for (const o of obstacles) drawList.push({ z: project(o.x, 0, o.z)?.z ?? -1, fn: () => drawObstacleObj(o) });
    const gp = project(godzilla.x, 0, godzilla.z);
    drawList.push({ z: gp ? gp.z : -1, fn: () => drawGodzillaSprite() });
    drawList.sort((a, b) => b.z - a.z);
    for (const item of drawList) if (item.z > 0) item.fn();

    drawParticlesObj();
    drawHazardMarker();
    drawVignette();
    if (state === 'playing') { drawScreenFloaters(); drawPunchFist(); }
    ctx.restore();

    if (flashAlpha > 0) {
      document.getElementById('warnFlash').style.opacity = flashAlpha;
      flashAlpha = Math.max(0, flashAlpha - dt * 1.6);
    } else {
      document.getElementById('warnFlash').style.opacity = 0;
    }

    if (INSPECT) {
      window.__DEBUG_STATE__ = { state, elapsed, player, hazard, godzilla, obstacles, provokeCount, punchCooldown };
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

  initBuildings();
  initObstacles();
  requestAnimationFrame(loop);
})();
