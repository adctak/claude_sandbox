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
    FOCAL = H * 1.1;
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
    stomp: () => { noiseBurst({ dur: 0.4, gain: 0.26, filterFreq: 500 }); beep({ freq: 60, dur: 0.35, type: 'sine', gain: 0.22 }); },
    roar: () => { beep({ freq: 90, dur: 0.5, type: 'sawtooth', gain: 0.13, slide: 40 }); beep({ freq: 55, dur: 0.6, type: 'sawtooth', gain: 0.11, slide: -20, delay: 0.1 }); },
    whoosh: () => beep({ freq: 200, dur: 0.25, type: 'sawtooth', gain: 0.1, slide: 300 }),
    collapse: () => { noiseBurst({ dur: 0.5, gain: 0.2, filterFreq: 700 }); beep({ freq: 80, dur: 0.4, type: 'sawtooth', gain: 0.12, slide: -40 }); },
    step: () => beep({ freq: 180, dur: 0.04, type: 'square', gain: 0.02 }),
    gameover: () => { beep({ freq: 300, dur: 0.4, type: 'sawtooth', gain: 0.12, slide: -250 }); beep({ freq: 200, dur: 0.5, type: 'sawtooth', gain: 0.12, slide: -150, delay: 0.15 }); },
    victory: () => { beep({ freq: 440, dur: 0.15, type: 'triangle', gain: 0.1 }); beep({ freq: 550, dur: 0.15, type: 'triangle', gain: 0.1, delay: 0.15 }); beep({ freq: 660, dur: 0.3, type: 'triangle', gain: 0.1, delay: 0.3 }); },
  };

  // ---------- Utility ----------
  const rand = (a, b) => a + Math.random() * (b - a);
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function lerp(a, b, t) { return a + (b - a) * t; }

  // ---------- 3D projection ----------
  // World: X = lateral, Y = height (0 = ground), Z = forward distance from camera (>0 ahead).
  function project(x, y, z, cam) {
    const rx = x - cam.x;
    const ry = y - cam.y;
    const rz = z;
    if (rz < 0.3) return null;
    const scale = FOCAL / rz;
    return { sx: W / 2 + (rx - cam.shiftX) * scale, sy: H / 2 - ry * scale + cam.shiftY, scale, z: rz };
  }

  // ---------- World constants ----------
  const LANES = [-2.2, 0, 2.2];
  const ROAD_HALF = 3.6;
  const SPAWN_Z = 70;
  const DESPAWN_Z = -3;
  const EYE_HEIGHT = 1.65;
  const JUMP_V = 6.6, GRAVITY = 19;
  const GOAL_DISTANCE = 1300;

  // ---------- Input ----------
  const keys = {};
  window.addEventListener('keydown', e => {
    keys[e.key] = true;
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', ' '].includes(e.key)) e.preventDefault();
    if (state === 'playing') {
      if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') changeLane(-1);
      if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') changeLane(1);
      if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W' || e.key === ' ') doJump();
    }
  });
  window.addEventListener('keyup', e => { keys[e.key] = false; });

  let touchStartX = null;
  canvas.addEventListener('touchstart', e => {
    const t = e.touches[0];
    touchStartX = t.clientX;
    if (t.clientY < H * 0.5) doJump();
  }, { passive: true });
  canvas.addEventListener('touchend', e => {
    if (touchStartX === null) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - touchStartX;
    if (dx > 40) changeLane(1);
    else if (dx < -40) changeLane(-1);
    touchStartX = null;
  }, { passive: true });

  // ---------- Player ----------
  const player = {
    lane: 1, // index into LANES
    x: 0,
    y: 0,
    vy: 0,
    jumping: false,
    hp: 3,
    maxHp: 3,
    invuln: 0,
    stumble: 0,
    bob: 0,
  };

  function changeLane(dir) {
    if (state !== 'playing') return;
    player.lane = clamp(player.lane + dir, 0, LANES.length - 1);
  }
  function doJump() {
    if (state !== 'playing' || player.jumping) return;
    player.jumping = true;
    player.vy = JUMP_V;
    SFX.jump();
  }

  // ---------- Camera ----------
  const camera = { x: 0, y: EYE_HEIGHT, shiftX: 0, shiftY: 0 };

  // ---------- Buildings (scenery, recycled) ----------
  let buildings = [];
  function makeBuilding(z, side) {
    const w = rand(4, 7);
    const d = rand(4, 6);
    const h = rand(8, 34);
    const x = side * (ROAD_HALF + w / 2 + rand(0.5, 3));
    const tint = rand(-8, 10);
    return { x, z, w, d, h, side, lit: Math.random() < 0.45, damaged: false, fireT: 0, tint };
  }
  function initBuildings() {
    buildings = [];
    for (let z = 8; z < SPAWN_Z; z += rand(9, 15)) {
      buildings.push(makeBuilding(z, -1));
      buildings.push(makeBuilding(z + rand(-2, 2), 1));
    }
  }

  // ---------- Obstacles ----------
  const OBSTACLE_TYPES = {
    rubble: { color: '#8a7a68', h: 1.1, w: 1.6 },
    fire: { color: '#ff6b3d', h: 1.6, w: 1.7 },
    car: { color: '#5b6b7a', h: 1.4, w: 1.9 },
  };
  let obstacles = [];
  let obstacleId = 0;
  let obstacleSpawnZ = 40;

  function spawnObstacle() {
    const types = Object.keys(OBSTACLE_TYPES);
    const type = types[Math.floor(rand(0, types.length))];
    const lane = Math.floor(rand(0, LANES.length));
    obstacles.push({ id: obstacleId++, type, lane, z: obstacleSpawnZ, resolved: false, kind: 'ground' });
  }

  // ---------- Godzilla & set-piece hazards ----------
  const godzilla = {
    x: 5.5,
    z: 26,
    side: 1,
    walkPhase: 0,
    tailSwingT: -1,
    stompT: -1,
    stompLane: 0,
    roarT: 0,
  };

  let hazardTimer = 4;
  let nextHazardMin = 6, nextHazardMax = 10;

  function scheduleHazard() {
    const roll = Math.random();
    if (roll < 0.4) {
      godzilla.tailSwingT = 0;
      spawnFloaterScreen('尻尾が来る！ジャンプ！', '#ffd166');
      SFX.whoosh();
    } else if (roll < 0.8) {
      godzilla.stompT = 0;
      godzilla.stompLane = Math.floor(rand(0, LANES.length));
      spawnFloaterScreen('踏まれるぞ！レーン移動！', '#ff8a5b');
    } else {
      triggerBuildingCollapse();
    }
  }

  function triggerBuildingCollapse() {
    const candidates = buildings.filter(b => b.z > 15 && b.z < 45 && !b.damaged);
    if (candidates.length) {
      const b = candidates[Math.floor(rand(0, candidates.length))];
      b.damaged = true;
      b.fireT = 3;
      SFX.collapse();
      triggerShake(6, 0.3);
    }
  }

  // ---------- Particles & floaters (world-space) ----------
  let particles = [];
  function spawnParticles3D(x, y, z, color, count = 12, speed = 4, life = 0.7) {
    for (let i = 0; i < count; i++) {
      const a = rand(0, Math.PI * 2);
      const s = rand(speed * 0.3, speed);
      particles.push({
        x, y, z,
        vx: Math.cos(a) * s, vy: rand(1, 4), vz: Math.sin(a) * s * 0.4,
        life: rand(life * 0.5, life), maxLife: life, color, r: rand(2, 5),
      });
    }
  }
  function updateParticles(dt, worldSpeed) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.vy -= 9 * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      p.z -= worldSpeed * dt;
      p.life -= dt;
      if (p.life <= 0 || p.y < -1) particles.splice(i, 1);
    }
  }

  // screen-space floaters (fixed UI position, not world-projected) for readability of warnings
  let screenFloaters = [];
  function spawnFloaterScreen(text, color) {
    screenFloaters.push({ text, color, life: 1.4, maxLife: 1.4 });
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
    ctx.font = 'bold 26px "Noto Sans JP", sans-serif';
    screenFloaters.forEach((f, i) => {
      ctx.globalAlpha = clamp(f.life / f.maxLife, 0, 1);
      ctx.fillStyle = f.color;
      ctx.shadowColor = f.color;
      ctx.shadowBlur = 12;
      ctx.fillText(f.text, W / 2, H * 0.3 - i * 34);
    });
    ctx.restore();
  }

  // ---------- Game state ----------
  let state = 'start'; // start | playing | ended
  let distance = 0;
  let speed = 9;
  let elapsed = 0;
  let shakeTime = 0, shakeMag = 0;
  let flashAlpha = 0;
  let lastTime = performance.now();

  function triggerShake(mag, time) {
    shakeMag = Math.max(shakeMag, mag);
    shakeTime = Math.max(shakeTime, time);
  }

  function resetGame() {
    player.lane = 1; player.x = LANES[1]; player.y = 0; player.vy = 0;
    player.jumping = false; player.hp = player.maxHp; player.invuln = 1.0; player.stumble = 0;
    obstacles = []; particles = []; screenFloaters = [];
    obstacleSpawnZ = 40;
    godzilla.z = 26; godzilla.tailSwingT = -1; godzilla.stompT = -1; godzilla.roarT = 0;
    hazardTimer = 4;
    distance = 0; speed = 9; elapsed = 0;
    flashAlpha = 0;
    initBuildings();
    updateLivesUI();
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
    if (won) {
      title.textContent = 'ESCAPED';
      title.classList.add('over');
      SFX.victory();
      body.textContent = `怪獣の脅威圏を脱出した。走行距離: ${Math.floor(distance)}m`;
    } else {
      title.textContent = 'CAUGHT';
      title.classList.remove('over');
      SFX.gameover();
      body.textContent = `怪獣の跳梁を逃げ切れなかった。走行距離: ${Math.floor(distance)}m`;
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
    const targetX = LANES[player.lane];
    player.x = lerp(player.x, targetX, clamp(dt * 10, 0, 1));

    if (player.jumping) {
      player.y += player.vy * dt;
      player.vy -= GRAVITY * dt;
      if (player.y <= 0) { player.y = 0; player.vy = 0; player.jumping = false; }
    } else {
      player.bob += dt * (player.stumble > 0 ? 6 : 11);
    }

    player.invuln = Math.max(0, player.invuln - dt);
    player.stumble = Math.max(0, player.stumble - dt);
  }

  function updateWorldScroll(dt) {
    const effSpeed = speed * (player.stumble > 0 ? 0.35 : 1);
    distance += effSpeed * dt;
    speed = Math.min(20, 9 + distance * 0.01);

    for (const b of buildings) b.z -= effSpeed * dt;
    buildings = buildings.filter(b => b.z > DESPAWN_Z - 10);
    let maxFarZ = 0;
    for (const b of buildings) maxFarZ = Math.max(maxFarZ, b.z);
    while (maxFarZ < SPAWN_Z) {
      maxFarZ += rand(9, 15);
      buildings.push(makeBuilding(maxFarZ, -1));
      buildings.push(makeBuilding(maxFarZ + rand(-2, 2), 1));
    }
    for (const b of buildings) if (b.fireT > 0) b.fireT -= dt;

    for (const o of obstacles) o.z -= effSpeed * dt;
    obstacles = obstacles.filter(o => o.z > DESPAWN_Z);
    obstacleSpawnZ -= effSpeed * dt;
    if (obstacleSpawnZ < SPAWN_Z - rand(14, 22)) {
      obstacleSpawnZ = SPAWN_Z;
      if (Math.random() < 0.82) spawnObstacle();
    }

    godzilla.z = 24 + Math.sin(elapsed * 0.15) * 4;
    godzilla.walkPhase += dt * 3;

    hazardTimer -= dt;
    if (hazardTimer <= 0) {
      scheduleHazard();
      hazardTimer = rand(nextHazardMin, nextHazardMax);
      nextHazardMin = Math.max(3.5, nextHazardMin - 0.15);
      nextHazardMax = Math.max(5.5, nextHazardMax - 0.15);
    }

    if (godzilla.tailSwingT >= 0) {
      godzilla.tailSwingT += dt;
      if (godzilla.tailSwingT > 1.1) godzilla.tailSwingT = -1;
    }
    if (godzilla.stompT >= 0) {
      godzilla.stompT += dt;
      if (godzilla.stompT > 1.3) godzilla.stompT = -1;
    }
    if (godzilla.roarT > 0) godzilla.roarT -= dt;
  }

  function checkCollisions() {
    const airborne = player.y > 0.55;

    for (const o of obstacles) {
      if (o.resolved) continue;
      if (o.z < 0.6 && o.z > -0.6) {
        o.resolved = true;
        if (o.lane === player.lane && !airborne) {
          takeDamage();
          spawnParticles3D(LANES[o.lane], 0.5, 0, OBSTACLE_TYPES[o.type].color, 14, 3.5, 0.6);
        }
      }
    }

    // tail sweep: hits ALL lanes near the player unless airborne, active during a short window
    if (godzilla.tailSwingT >= 0.45 && godzilla.tailSwingT <= 0.65 && !godzilla._tailResolved) {
      godzilla._tailResolved = true;
      if (!airborne) takeDamage();
    }
    if (godzilla.tailSwingT < 0) godzilla._tailResolved = false;

    // foot stomp: hits one lane hard near the player; jumping does NOT help, only lane change does
    if (godzilla.stompT >= 0.55 && godzilla.stompT <= 0.75 && !godzilla._stompResolved) {
      godzilla._stompResolved = true;
      SFX.stomp();
      triggerShake(14, 0.4);
      if (player.lane === godzilla.stompLane) takeDamage();
    }
    if (godzilla.stompT < 0) { godzilla._stompResolved = false; godzilla._dustSpawned = false; }
  }

  function updateHud() {
    document.getElementById('distance').textContent = `${Math.floor(distance)} m`;
    document.getElementById('distFill').style.width = clamp((distance / GOAL_DISTANCE) * 100, 0, 100) + '%';
  }

  // ---------- Drawing ----------
  function computeCamera() {
    const bobY = player.jumping ? 0 : Math.sin(player.bob) * 0.05;
    camera.x = player.x;
    camera.y = EYE_HEIGHT + player.y * 0.9 + bobY;
    camera.shiftX = Math.sin(player.bob * 0.5) * 0.03;
    camera.shiftY = 0;
  }

  function drawSky() {
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, '#2a0f0a');
    grad.addColorStop(0.55, '#4a1a10');
    grad.addColorStop(1, '#1a0806');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
    ctx.save();
    ctx.fillStyle = 'rgba(255, 230, 200, 0.85)';
    ctx.shadowColor = '#ffe6c8';
    ctx.shadowBlur = 30;
    ctx.beginPath();
    ctx.arc(W * 0.8, H * 0.2, 28, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawRoad() {
    const near = project(-ROAD_HALF, 0, 0.5, camera);
    const nearR = project(ROAD_HALF, 0, 0.5, camera);
    const far = project(-ROAD_HALF, 0, SPAWN_Z, camera);
    const farR = project(ROAD_HALF, 0, SPAWN_Z, camera);
    if (!near || !nearR || !far || !farR) return;
    ctx.fillStyle = '#171012';
    ctx.beginPath();
    ctx.moveTo(near.sx, Math.min(H, near.sy));
    ctx.lineTo(nearR.sx, Math.min(H, nearR.sy));
    ctx.lineTo(farR.sx, farR.sy);
    ctx.lineTo(far.sx, far.sy);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = 'rgba(255, 209, 102, 0.25)';
    ctx.lineWidth = 2;
    const laneBounds = [-ROAD_HALF, -1.1, 1.1, ROAD_HALF];
    for (const lx of laneBounds) {
      const p0 = project(lx, 0, 0.5, camera);
      const p1 = project(lx, 0, SPAWN_Z, camera);
      if (!p0 || !p1) continue;
      ctx.beginPath();
      ctx.moveTo(p0.sx, Math.min(H, p0.sy));
      ctx.lineTo(p1.sx, p1.sy);
      ctx.stroke();
    }
  }

  function drawBuildingObj(b) {
    const faceZ = b.z - b.d / 2;
    if (faceZ < 0.3) return;
    const halfW = b.w / 2;
    const tl = project(b.x - halfW, b.h, faceZ, camera);
    const tr = project(b.x + halfW, b.h, faceZ, camera);
    const br = project(b.x + halfW, 0, faceZ, camera);
    const bl = project(b.x - halfW, 0, faceZ, camera);
    if (!tl || !tr || !br || !bl) return;
    const fog = clamp(1 - faceZ / SPAWN_Z, 0.15, 1);
    const t = b.tint || 0;
    const baseColor = b.damaged ? [40, 24, 20] : [26 + t, 16 + t * 0.6, 22 + t * 0.8];
    ctx.fillStyle = `rgba(${baseColor[0]},${baseColor[1]},${baseColor[2]},${fog})`;
    ctx.beginPath();
    ctx.moveTo(tl.sx, tl.sy); ctx.lineTo(tr.sx, tr.sy); ctx.lineTo(br.sx, br.sy); ctx.lineTo(bl.sx, bl.sy);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = `rgba(0,0,0,${0.5 * fog})`;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    if (b.lit && !b.damaged) {
      ctx.fillStyle = `rgba(255, 209, 102, ${0.35 * fog})`;
      const rows = 5, cols = 4;
      for (let r = 1; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if ((r + c) % 3 === 0) continue;
          const wx = lerp(tl.sx, tr.sx, (c + 0.5) / cols);
          const wyTop = lerp(tl.sy, bl.sy, r / rows);
          const wSize = Math.max(1, (tr.sx - tl.sx) / cols * 0.4);
          ctx.fillRect(wx - wSize / 2, wyTop, wSize, wSize);
        }
      }
    }

    if (b.damaged && b.fireT > 0) {
      ctx.save();
      ctx.globalAlpha = clamp(b.fireT / 3, 0, 1) * fog;
      ctx.fillStyle = '#ff6b3d';
      ctx.shadowColor = '#ff6b3d';
      ctx.shadowBlur = 20;
      const fx = (tl.sx + tr.sx) / 2, fy = (tl.sy + bl.sy) / 2;
      ctx.beginPath();
      ctx.arc(fx, fy, Math.max(4, (tr.sx - tl.sx) * 0.25), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  function drawObstacleObj(o) {
    const t = OBSTACLE_TYPES[o.type];
    const p = project(LANES[o.lane], t.h / 2, o.z, camera);
    if (!p) return;
    const sizeW = t.w * p.scale;
    const sizeH = t.h * p.scale;
    ctx.save();
    ctx.globalAlpha = clamp(1 - Math.max(0, -o.z) / 3, 0, 1);
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
      const p = project(pt.x, pt.y, pt.z, camera);
      if (!p) continue;
      ctx.save();
      ctx.globalAlpha = clamp(pt.life / pt.maxLife, 0, 1);
      ctx.fillStyle = pt.color;
      ctx.shadowColor = pt.color;
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.arc(p.sx, p.sy, pt.r * p.scale * 0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  function drawGodzillaSprite() {
    const gx = godzilla.side * (ROAD_HALF + 3.5);
    const p = project(gx, 0, godzilla.z, camera);
    if (!p) return;
    const sx = p.sx, sy = p.sy;
    const bodyColor = godzilla.roarT > 0 ? '#5a2a3a' : '#2a3a2a';

    ctx.save();
    ctx.translate(sx, sy);
    ctx.scale(-godzilla.side, 1);

    const s = p.scale * 0.072; // tuned so a 42-design-unit body radius reads as an imposing, not screen-filling, silhouette
    const legOffset = Math.sin(godzilla.walkPhase) * 6 * s;

    // tail (swings out toward the road during tail-sweep hazard)
    let tailSwing = 0;
    if (godzilla.tailSwingT >= 0) {
      const t = godzilla.tailSwingT;
      tailSwing = Math.sin(clamp(t / 1.1, 0, 1) * Math.PI) * 90 * s;
    }
    ctx.strokeStyle = bodyColor;
    ctx.lineWidth = 18 * s;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-40 * s, -30 * s);
    ctx.quadraticCurveTo(-90 * s, (-20 + legOffset) * s - tailSwing * 0.3, -130 * s - tailSwing, -40 * s + tailSwing * 0.5);
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

    // foot-stomp telegraph: a raised foot silhouette when about to slam
    if (godzilla.stompT >= 0 && godzilla.stompT < 0.55) {
      ctx.save();
      ctx.globalAlpha = 0.7;
      ctx.fillStyle = '#111';
      ctx.fillRect(20 * s, -140 * s, 30 * s, 60 * s);
      ctx.restore();
    }

    ctx.restore();
  }

  function drawStompShadow() {
    if (godzilla.stompT < 0 || godzilla.stompT > 0.75) return;
    const lane = godzilla.stompLane;
    const p = project(LANES[lane], 0.02, 1.2, camera);
    if (!p) return;
    const pulse = godzilla.stompT < 0.55 ? clamp(godzilla.stompT / 0.55, 0, 1) : 1;
    ctx.save();
    ctx.globalAlpha = 0.55 * pulse;
    ctx.fillStyle = godzilla.stompT >= 0.55 ? '#ff5b5b' : '#000';
    ctx.beginPath();
    ctx.ellipse(p.sx, p.sy, 60 * p.scale, 24 * p.scale, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // a huge foot descends from off-screen straight down onto the shadow
    if (godzilla.stompT < 0.55) {
      const t = godzilla.stompT / 0.55;
      const legW = 90 * p.scale;
      const legH = 260 * p.scale;
      const landingY = p.sy;
      const legY = lerp(-legH - 60, landingY - legH * 0.15, t * t);
      ctx.save();
      ctx.fillStyle = '#120a08';
      ctx.strokeStyle = '#3a2a20';
      ctx.lineWidth = 2;
      ctx.fillRect(p.sx - legW / 2, legY, legW, legH);
      ctx.strokeRect(p.sx - legW / 2, legY, legW, legH);
      ctx.restore();
    } else if (!godzilla._dustSpawned) {
      godzilla._dustSpawned = true;
      spawnParticles3D(LANES[lane], 0.1, 1.2, '#c9b8a0', 20, 5, 0.5);
    }
  }

  function drawTailSweepBar() {
    if (godzilla.tailSwingT < 0) return;
    const t = clamp(godzilla.tailSwingT / 1.1, 0, 1);
    // sweeps from one side of the screen to the other, crossing center during the hit window (~t=0.5)
    const startX = godzilla.side > 0 ? W + 200 : -200;
    const endX = godzilla.side > 0 ? -200 : W + 200;
    const barX = lerp(startX, endX, t);
    const barY = H * 0.72;
    const barH = 46;
    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = '#1a1210';
    ctx.strokeStyle = '#3a2a20';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(barX, barY, 180, barH, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
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
      updateWorldScroll(dt);
      checkCollisions();
      computeCamera();
      updateHud();
      if (distance >= GOAL_DISTANCE) endGame(true);
    }

    updateParticles(dt, state === 'playing' ? speed : 0);
    updateScreenFloaters(dt);

    ctx.save();
    ctx.translate(shakeX, shakeY);
    drawSky();
    drawRoad();

    const drawList = [];
    for (const b of buildings) drawList.push({ z: b.z, fn: () => drawBuildingObj(b) });
    for (const o of obstacles) drawList.push({ z: o.z, fn: () => drawObstacleObj(o) });
    drawList.push({ z: godzilla.z, fn: () => drawGodzillaSprite() });
    drawList.sort((a, b) => b.z - a.z);
    for (const item of drawList) if (item.fn) item.fn();
    drawParticlesObj();
    drawStompShadow();
    drawTailSweepBar();

    drawVignette();
    ctx.restore();

    if (state === 'playing') drawScreenFloaters();

    if (flashAlpha > 0) {
      document.getElementById('warnFlash').style.opacity = flashAlpha;
      flashAlpha = Math.max(0, flashAlpha - dt * 1.6);
    } else {
      document.getElementById('warnFlash').style.opacity = 0;
    }

    if (INSPECT) {
      window.__DEBUG_STATE__ = {
        state, distance, speed, player: { lane: player.lane, x: player.x, y: player.y, hp: player.hp, jumping: player.jumping, invuln: player.invuln },
        obstacles, godzilla: { z: godzilla.z, tailSwingT: godzilla.tailSwingT, stompT: godzilla.stompT, stompLane: godzilla.stompLane },
        buildingsCount: buildings.length,
      };
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
  requestAnimationFrame(loop);
})();
