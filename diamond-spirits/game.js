(() => {
  'use strict';

  const BB = window.BB;
  const { clamp, lerp } = BB;
  const DEG = Math.PI / 180;

  // ---------- canvas ----------
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  let W = 0, H = 0, UI = 1;
  const DPR = Math.min(window.devicePixelRatio || 1, 2);
  function resize() {
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    UI = clamp(Math.min(W / 900, H / 620), 0.62, 1.25);
  }
  window.addEventListener('resize', resize);
  resize();

  // ---------- audio ----------
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  let actx = null;
  function audio() {
    if (!actx && AudioCtx) actx = new AudioCtx();
    if (actx && actx.state === 'suspended') actx.resume();
    return actx;
  }
  function tone({ freq = 440, dur = 0.1, type = 'sine', gain = 0.08, slide = 0, delay = 0 }) {
    const a = actx; if (!a) return;
    const t0 = a.currentTime + delay;
    const o = a.createOscillator(), g = a.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t0 + dur);
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(a.destination);
    o.start(t0); o.stop(t0 + dur + 0.02);
  }
  function noise({ dur = 0.2, gain = 0.1, type = 'lowpass', freq = 1200, q = 0.7, attack = 0, delay = 0 }) {
    const a = actx; if (!a) return;
    const t0 = a.currentTime + delay;
    const n = Math.floor(a.sampleRate * dur);
    const buf = a.createBuffer(1, n, a.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    const src = a.createBufferSource(); src.buffer = buf;
    const f = a.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = a.createGain();
    if (attack > 0) {
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(gain, t0 + attack);
    } else g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f).connect(g).connect(a.destination);
    src.start(t0);
  }
  const SFX = {
    crack(just) {
      noise({ dur: 0.09, gain: just ? 0.55 : 0.35, type: 'highpass', freq: 1800 });
      tone({ freq: just ? 900 : 700, dur: 0.07, type: 'triangle', gain: 0.18, slide: -300 });
      tone({ freq: 140, dur: 0.12, type: 'sine', gain: 0.25, slide: -60 });
    },
    tip() { noise({ dur: 0.05, gain: 0.25, type: 'highpass', freq: 2500 }); },
    mitt() {
      noise({ dur: 0.08, gain: 0.45, type: 'lowpass', freq: 900 });
      tone({ freq: 110, dur: 0.1, type: 'sine', gain: 0.3, slide: -40 });
    },
    whoosh() { noise({ dur: 0.22, gain: 0.12, type: 'bandpass', freq: 700, q: 1.2, attack: 0.08 }); },
    throwIn() { noise({ dur: 0.06, gain: 0.25, type: 'lowpass', freq: 700 }); },
    cheer(big) {
      noise({ dur: big ? 3.2 : 1.6, gain: big ? 0.22 : 0.1, type: 'bandpass', freq: 1100, q: 0.4, attack: 0.25 });
      if (big) noise({ dur: 2.6, gain: 0.12, type: 'lowpass', freq: 500, attack: 0.3 });
    },
    groan() { noise({ dur: 1.0, gain: 0.06, type: 'lowpass', freq: 400, attack: 0.2 }); },
    click() { tone({ freq: 880, dur: 0.05, type: 'square', gain: 0.04 }); },
    good() { tone({ freq: 1320, dur: 0.12, type: 'triangle', gain: 0.08 }); tone({ freq: 1760, dur: 0.14, type: 'triangle', gain: 0.07, delay: 0.06 }); },
    ump() { tone({ freq: 220, dur: 0.18, type: 'sawtooth', gain: 0.05, slide: 60 }); },
    organ() {
      [523, 659, 784, 1046].forEach((f, i) => tone({ freq: f, dur: 0.22, type: 'square', gain: 0.035, delay: i * 0.12 }));
    },
  };

  // ---------- 3D camera ----------
  const NEAR = 0.15;
  function makeCam() {
    return { px: 0, py: 0, pz: 0, tx: 0, ty: 0, tz: 1, fov: 40, rx: 1, ry: 0, rz: 0, ux: 0, uy: 1, uz: 0, fx: 0, fy: 0, fz: 1, focal: 1, cx: 0, cy: 0 };
  }
  function setCam(c, px, py, pz, tx, ty, tz, fov) {
    c.px = px; c.py = py; c.pz = pz; c.tx = tx; c.ty = ty; c.tz = tz; c.fov = fov;
    let fx = tx - px, fy = ty - py, fz = tz - pz;
    const fl = Math.hypot(fx, fy, fz) || 1;
    fx /= fl; fy /= fl; fz /= fl;
    let rx = fz, rz = -fx;
    const rl = Math.hypot(rx, rz) || 1;
    rx /= rl; rz /= rl;
    c.fx = fx; c.fy = fy; c.fz = fz;
    c.rx = rx; c.ry = 0; c.rz = rz;
    c.ux = fy * rz; c.uy = fz * rx - fx * rz; c.uz = -fy * rx;
    c.focal = (H / 2) / Math.tan((fov * DEG) / 2);
    c.cx = W / 2; c.cy = H / 2;
  }
  const P = { x: 0, y: 0, z: 0, sx: 0, sy: 0, k: 0 };
  const P2 = { x: 0, y: 0, z: 0, sx: 0, sy: 0, k: 0 };
  function proj(c, x, y, z, o) {
    const dx = x - c.px, dy = y - c.py, dz = z - c.pz;
    o.x = dx * c.rx + dy * c.ry + dz * c.rz;
    o.y = dx * c.ux + dy * c.uy + dz * c.uz;
    o.z = dx * c.fx + dy * c.fy + dz * c.fz;
    if (o.z < NEAR) return false;
    o.k = c.focal / o.z;
    o.sx = c.cx + o.x * o.k;
    o.sy = c.cy - o.y * o.k;
    return true;
  }
  // Build a clipped screen-space path for a world polygon (flat xyz array). Returns false if nothing visible.
  const _cp = [];
  function polyPath(c, pts) {
    const n = pts.length / 3;
    _cp.length = 0;
    for (let i = 0; i < n; i++) {
      const x = pts[i * 3] - c.px, y = pts[i * 3 + 1] - c.py, z = pts[i * 3 + 2] - c.pz;
      _cp.push(x * c.rx + y * c.ry + z * c.rz, x * c.ux + y * c.uy + z * c.uz, x * c.fx + y * c.fy + z * c.fz);
    }
    let started = false, count = 0;
    const f = c.focal, cx = c.cx, cy = c.cy;
    const emit = (x, y, z) => {
      const sx = cx + (x * f) / z, sy = cy - (y * f) / z;
      if (!started) { ctx.beginPath(); ctx.moveTo(sx, sy); started = true; } else ctx.lineTo(sx, sy);
      count++;
    };
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const ax = _cp[i * 3], ay = _cp[i * 3 + 1], az = _cp[i * 3 + 2];
      const bx = _cp[j * 3], by = _cp[j * 3 + 1], bz = _cp[j * 3 + 2];
      const ain = az >= NEAR, bin = bz >= NEAR;
      if (ain) emit(ax, ay, az);
      if (ain !== bin) {
        const t = (NEAR - az) / (bz - az);
        emit(ax + (bx - ax) * t, ay + (by - ay) * t, NEAR);
      }
    }
    if (count < 3) return false;
    ctx.closePath();
    return true;
  }
  function fillPoly(c, pts, color) {
    if (polyPath(c, pts)) { ctx.fillStyle = color; ctx.fill(); }
  }
  // screen → point on the plate plane (z = 0)
  function screenToPlate(c, sx, sy) {
    const a = (sx - c.cx) / c.focal, b = -(sy - c.cy) / c.focal;
    const dx = c.fx + c.rx * a + c.ux * b;
    const dy = c.fy + c.ry * a + c.uy * b;
    const dz = c.fz + c.rz * a + c.uz * b;
    if (Math.abs(dz) < 1e-6) return null;
    const t = -c.pz / dz;
    return { x: c.px + dx * t, y: c.py + dy * t };
  }

  // ---------- stadium geometry ----------
  const flatPts = (list, y = 0) => list.flatMap(([x, z]) => [x, y, z]);
  function circlePts(cx, cz, r, n = 28) {
    const out = [];
    for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; out.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]); }
    return out;
  }
  function clipHalf(poly, keep) {
    // Sutherland–Hodgman against a half-plane given by keep(p) -> signed distance (>= 0 inside)
    const out = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const da = keep(a), db = keep(b);
      if (da >= 0) out.push(a);
      if ((da >= 0) !== (db >= 0)) {
        const t = da / (da - db);
        out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      }
    }
    return out;
  }
  function quadLine(x1, z1, x2, z2, w) {
    const dx = x2 - x1, dz = z2 - z1, l = Math.hypot(dx, dz) || 1;
    const nx = (-dz / l) * w / 2, nz = (dx / l) * w / 2;
    return [[x1 + nx, z1 + nz], [x2 + nx, z2 + nz], [x2 - nx, z2 - nz], [x1 - nx, z1 - nz]];
  }

  const WORLD = (() => {
    const flat = [];
    const add = (list, color, y = 0) => flat.push({ pts: flatPts(list, y), color });
    const fd = BB.fenceDist;
    // whole ground
    add([[-600, -200], [600, -200], [600, 600], [-600, 600]], '#24562b');
    // inside the stands
    const inner = [];
    for (let a = -110; a <= 110; a += 2.5) { const t = a * DEG, d = fd(t); inner.push([Math.sin(t) * d, Math.cos(t) * d]); }
    inner.push([6, -19], [-6, -19]);
    add(inner, '#3b8a3c');
    // fair territory with mowing stripes
    const fan = [[0, 0]];
    for (let a = -45; a <= 45; a += 1.5) { const t = a * DEG, d = fd(t); fan.push([Math.sin(t) * d, Math.cos(t) * d]); }
    for (let z0 = 0, i = 0; z0 < 130; z0 += 6, i++) {
      let band = clipHalf(fan, (p) => p[1] - z0);
      band = clipHalf(band, (p) => z0 + 6 - p[1]);
      if (band.length >= 3) add(band, i % 2 ? '#48a043' : '#52ad4b');
    }
    // warning track
    const wt = [];
    for (let a = -45; a <= 45; a += 1.5) { const t = a * DEG, d = fd(t); wt.push([Math.sin(t) * d, Math.cos(t) * d]); }
    for (let a = 45; a >= -45; a -= 1.5) { const t = a * DEG, d = fd(t) - 4.5; wt.push([Math.sin(t) * d, Math.cos(t) * d]); }
    add(wt, '#b07d4f');
    // infield dirt (arc of 29 m around the mound, bounded by the foul lines)
    const dirt = [[0, -1]];
    const lim = 71.8;
    dirt.push([-27.5, 27.5]);
    for (let a = -lim; a <= lim; a += 3) dirt.push([Math.sin(a * DEG) * 29, 18.44 + Math.cos(a * DEG) * 29]);
    dirt.push([27.5, 27.5]);
    add(dirt, '#c08a58');
    // infield grass
    add([[0, 3.2], [17.1, 19.4], [0, 35.4], [-17.1, 19.4]], '#4ea648');
    // home plate circle, mound, base cut-outs
    add(circlePts(0, 0, 4.0, 32), '#c08a58');
    add(circlePts(0, 18.44, 2.75, 28), '#c9925e');
    for (const b of [1, 2, 3]) add(circlePts(BB.BASES[b].x, BB.BASES[b].z, 1.4, 16), '#c08a58');
    // lines
    const W2 = '#f4f1e6';
    const pole = fd(45 * DEG);
    add(quadLine(0, 0, -pole * Math.SQRT1_2, pole * Math.SQRT1_2, 0.1), W2);
    add(quadLine(0, 0, pole * Math.SQRT1_2, pole * Math.SQRT1_2, 0.1), W2);
    for (const sx of [-1, 1]) {
      const x0 = sx * 0.15, x1 = sx * 1.37, z0 = -0.9, z1 = 0.93;
      add(quadLine(x0, z0, x0, z1, 0.07), W2); add(quadLine(x1, z0, x1, z1, 0.07), W2);
      add(quadLine(x0, z0, x1, z0, 0.07), W2); add(quadLine(x0, z1, x1, z1, 0.07), W2);
    }
    // bases
    for (const b of [1, 2, 3]) {
      const { x, z } = BB.BASES[b], r = 0.28;
      add([[x, z - r], [x + r, z], [x, z + r], [x - r, z]], '#ffffff', 0.02);
    }
    add([[-0.216, 0], [0.216, 0], [0.216, -0.216], [0, -0.43], [-0.216, -0.216]], '#ffffff', 0.02);
    add([[-0.3, 18.3], [0.3, 18.3], [0.3, 18.46], [-0.3, 18.46]], '#ffffff', 0.25);

    // walls & stands (drawn back to front)
    const segs = [];
    const step = 3;
    for (let a = -108; a < 108; a += step) {
      const t1 = a * DEG, t2 = (a + step) * DEG, tm = (a + step / 2) * DEG;
      const fair = Math.abs(tm) <= 45 * DEG;
      const d1 = fd(t1), d2 = fd(t2);
      const h = fair ? BB.FENCE_H : 1.4;
      const P1 = [Math.sin(t1), Math.cos(t1)], P2 = [Math.sin(t2), Math.cos(t2)];
      const at = (p, d, y) => [p[0] * d, y, p[1] * d];
      const wall = [...at(P1, d1, 0), ...at(P2, d2, 0), ...at(P2, d2, h), ...at(P1, d1, h)];
      const rail = [...at(P1, d1, h - 0.28), ...at(P2, d2, h - 0.28), ...at(P2, d2, h), ...at(P1, d1, h)];
      const depth = fair ? 34 : 26, rise = fair ? 20 : 14;
      const stand = [...at(P1, d1 + 0.6, h + 0.4), ...at(P2, d2 + 0.6, h + 0.4), ...at(P2, d2 + depth, h + rise), ...at(P1, d1 + depth, h + rise)];
      const upper = [...at(P1, d1 + depth + 4, h + rise + 6), ...at(P2, d2 + depth + 4, h + rise + 6), ...at(P2, d2 + depth + 26, h + rise + 22), ...at(P1, d1 + depth + 26, h + rise + 22)];
      const facade = [...at(P1, d1 + depth, h + rise), ...at(P2, d2 + depth, h + rise), ...at(P2, d2 + depth + 4, h + rise + 6), ...at(P1, d1 + depth + 4, h + rise + 6)];
      const roof = [...at(P1, d1 + depth + 26, h + rise + 22), ...at(P2, d2 + depth + 26, h + rise + 22), ...at(P2, d2 + depth + 30, h + rise + 25), ...at(P1, d1 + depth + 30, h + rise + 25)];
      segs.push({ mx: Math.sin(tm) * (fd(tm) + 20), mz: Math.cos(tm) * (fd(tm) + 20), wall, rail, stand, upper, facade, roof, fair, a });
    }
    // light towers
    const towers = [];
    for (const a of [-72, -28, 28, 72]) {
      const t = a * DEG, d = fd(t) + 62;
      towers.push({ x: Math.sin(t) * d, z: Math.cos(t) * d, h: 58, a: t });
    }
    // foul poles
    const poles = [-1, 1].map((s) => ({ x: s * pole * Math.SQRT1_2, z: pole * Math.SQRT1_2 }));
    return { flat, segs, towers, poles };
  })();

  // crowd texture
  const crowdPat = (() => {
    const c = document.createElement('canvas');
    c.width = 64; c.height = 64;
    const g = c.getContext('2d');
    g.fillStyle = '#1c2033';
    g.fillRect(0, 0, 64, 64);
    const cols = ['#e9e2d4', '#c94a4a', '#2f56b8', '#f0c24a', '#ffffff', '#3f9b62', '#8a5cc7', '#d98a3a', '#e9e2d4'];
    for (let i = 0; i < 260; i++) {
      g.fillStyle = cols[(Math.random() * cols.length) | 0];
      g.globalAlpha = 0.45 + Math.random() * 0.45;
      g.fillRect((Math.random() * 64) | 0, (Math.random() * 64) | 0, 2, 3);
    }
    return ctx.createPattern(c, 'repeat');
  })();

  // ---------- difficulty ----------
  const DIFF = {
    easy: { label: 'かんたん', pitchTime: 1.5, cursor: 1.3, timing: 1.35, marker: true, cpuSkill: 0.78 },
    normal: { label: 'ふつう', pitchTime: 1.22, cursor: 1.12, timing: 1.15, marker: false, cpuSkill: 1.0 },
    pro: { label: 'プロ', pitchTime: 1.0, cursor: 1.0, timing: 1.0, marker: false, cpuSkill: 1.22 },
  };
  const WINDUP = 1.3;
  const SWING_DUR = 0.34;

  // ---------- state ----------
  const S = {
    phase: 'menu', pt: 0, clock: 0,
    game: null, opts: null, diff: DIFF.normal,
    cursor: { x: 0, y: 0.76 }, powerHold: false, powerToggle: false,
    aim: { x: 0, y: 0.76 }, selPitch: 0,
    pitch: null, release: 0, Tdisp: 0, arrival: 0, ball: { x: 0, y: 0, z: 0 }, trail: [],
    swing: null, gauge: null, cpuChoice: null,
    play: null, playSpeed: 1, evSeen: 0, hrAnnounced: false,
    foul: null, pendingEvent: null,
    msgs: [], commentary: '', lastPitch: null, lastCall: null,
    camBlend: 0, follow: { x: 0, z: 10 }, hitStop: 0, flash: 0, shake: 0,
  };
  const cam = makeCam();
  const game = () => S.game;
  const userBatting = () => S.game && BB.batSide(S.game) === S.game.userSide;
  const power = () => S.powerHold || S.powerToggle;

  function setPhase(p) { S.phase = p; S.pt = 0; updateControls(); }

  function msg(text, opt = {}) {
    S.msgs.push({ text, t: 0, dur: opt.dur || 1.3, color: opt.color || '#ffffff', size: opt.size || 1, sub: opt.sub || '' });
    if (S.msgs.length > 3) S.msgs.shift();
  }
  function say(text) { S.commentary = text; }

  // ---------- game flow ----------
  function startGame(opts) {
    S.opts = opts;
    S.diff = DIFF[opts.diff];
    S.game = BB.newGame(opts);
    S.cursor = { x: 0, y: 0.76 };
    S.aim = { x: 0, y: 0.76 };
    S.msgs = [];
    S.powerToggle = false;
    buildPitchPanel();
    document.getElementById('menu').classList.add('hidden');
    document.getElementById('result').classList.add('hidden');
    audio();
    SFX.organ();
    msg('PLAY BALL!', { size: 1.4, color: '#ffd166', dur: 1.8 });
    const t = S.game.teams;
    say(`${t[0].name} 対 ${t[1].name}、プレイボール！`);
    beginPA(true);
  }

  function beginPA(first) {
    const g = game();
    g.halfEnded = false;
    if (g.over) return gameOver();
    const fs = BB.fieldSide(g);
    if (fs !== g.userSide) {
      const np = BB.cpuManage(g, fs);
      if (np) { msg('ピッチャー交代', { color: '#9fd4ff', sub: np.name }); say(`${g.teams[fs].name}、ピッチャー交代。マウンドには ${np.name}。`); }
    }
    buildPitchPanel();
    S.swing = null; S.pitch = null; S.play = null; S.foul = null; S.trail.length = 0;
    const b = BB.curBatter(g);
    if (!first) say(`${b.order}番 ${posJP(b.pos)} ${b.name}`);
    setPhase('intro');
  }

  function nextPitch() {
    S.swing = null; S.pitch = null; S.foul = null; S.trail.length = 0;
    if (userBatting()) {
      S.cpuChoice = BB.cpuChoosePitch(game(), BB.curPitcher(game()));
      setPhase('ready');
    } else setPhase('aim');
  }

  function startWindup() {
    S.swing = null; S.pitch = null;
    S.gauge = userBatting() ? null : { clicked: false, q: 0.15, tClick: 0 };
    setPhase('windup');
  }

  function release() {
    const g = game();
    const pitcher = BB.curPitcher(g), batter = BB.curBatter(g);
    let key, aim, q;
    if (userBatting()) ({ key, aim, quality: q } = S.cpuChoice);
    else {
      key = pitcher.pitches[S.selPitch][0];
      aim = { x: S.aim.x, y: S.aim.y };
      q = S.gauge && S.gauge.clicked ? S.gauge.q : 0.12;
    }
    S.pitch = BB.makePitch(pitcher, key, aim, q);
    S.release = S.clock;
    S.Tdisp = S.pitch.T * (userBatting() ? S.diff.pitchTime : 1.15);
    S.arrival = S.release + S.Tdisp;
    S.mitt = false;
    if (!userBatting() && !S.swing) {
      const plan = BB.cpuBatterSwing(g, batter, S.pitch, pitcher, S.diff.cpuSkill);
      if (plan) {
        const scale = S.Tdisp / S.pitch.T;
        const t0 = S.arrival - BB.SWING_DELAY - plan.e * scale;
        const res = BB.resolveContact(batter, S.pitch, plan.cursor, plan.e, plan.power, null);
        S.swing = { t0, contactAt: t0 + BB.SWING_DELAY, res, cursor: plan.cursor, power: plan.power, done: false, cpu: true };
      }
    }
    setPhase('flight');
  }

  function userSwing() {
    if (!S.game || !userBatting() || S.swing) return;
    if (S.phase !== 'windup' && S.phase !== 'flight' && S.phase !== 'ready') return;
    const t0 = S.clock;
    if (S.pitch && t0 > S.arrival + 0.06) return;
    const pw = power();
    const cursor = { x: S.cursor.x, y: S.cursor.y };
    let res;
    if (!S.pitch) res = { kind: 'miss' };
    else {
      const e = S.arrival - (t0 + BB.SWING_DELAY);
      res = BB.resolveContact(BB.curBatter(game()), S.pitch, cursor, e, pw, S.diff);
    }
    S.swing = { t0, contactAt: t0 + BB.SWING_DELAY, res, cursor, power: pw, done: false };
    SFX.whoosh();
  }

  function updateFlight() {
    const u = (S.clock - S.release) / S.Tdisp;
    BB.pitchPos(S.pitch, Math.min(u, 1 + 0.85 / BB.RELEASE_Z), S.ball);
    S.trail.push({ x: S.ball.x, y: S.ball.y, z: S.ball.z });
    if (S.trail.length > 7) S.trail.shift();
    const sw = S.swing;
    if (sw && !sw.done && S.clock >= sw.contactAt) {
      sw.done = true;
      if (sw.res.kind === 'hit') return onContact();
      if (sw.res.kind === 'foul') return onFoul(null);
    }
    if (u >= 1.0 && !S.mitt) {
      S.mitt = true;
      SFX.mitt();
    }
    if (u >= 1.16) {
      const kind = sw ? 'swing' : S.pitch.strike ? 'strike' : 'ball';
      callPitch(kind);
    }
  }

  function pitchInfo() {
    const p = S.pitch;
    S.lastPitch = { kmh: Math.round(p.kmh), name: p.name, color: p.color, x: p.target.x, y: p.target.y, t: 0 };
  }

  function callPitch(kind) {
    const g = game();
    pitchInfo();
    const b = BB.curBatter(g);
    const res = BB.applyPitch(g, kind);
    S.pendingEvent = res.event;
    if (res.event === 'strikeout') {
      msg(res.looking ? '見逃し三振！' : '空振り三振！', { size: 1.25, color: '#ff6b6b' });
      say(`${b.name}、${res.looking ? '見逃し' : '空振り'}三振！`);
      if (!userBatting()) SFX.cheer(false); else SFX.groan();
    } else if (res.event === 'walk') {
      msg('フォアボール', { color: '#8ce99a' });
      say(`${b.name}、フォアボールを選びました。` + (res.runs ? ' 押し出しで1点！' : ''));
    } else {
      const text = kind === 'ball' ? 'ボール' : kind === 'strike' ? 'ストライク' : '空振り';
      msg(text, { color: kind === 'ball' ? '#8ce99a' : '#ffd43b', dur: 0.9, size: 0.85 });
      if (kind !== 'ball') SFX.ump();
    }
    setPhase('call');
  }

  function onFoul(path) {
    const g = game();
    pitchInfo();
    if (path) S.foul = { path, t0: S.clock };
    else { SFX.tip(); S.foul = { tip: true, t0: S.clock }; }
    BB.applyPitch(g, 'foul');
    S.pendingEvent = null;
    msg('ファウル', { color: '#ffd43b', dur: 1.0, size: 0.9 });
    setPhase('foul');
  }

  function onContact() {
    const g = game();
    const r = S.swing.res;
    const u = (S.swing.contactAt - S.release) / S.Tdisp;
    const cp = BB.pitchPos(S.pitch, clamp(u, 0.85, 1.12));
    const start = { x: cp.x, y: cp.y, z: clamp(cp.z, -0.3, 1.6) };
    const path = BB.simBattedBall(start, r.ev, r.la, r.spray);
    SFX.crack(r.just);
    S.hitStop = r.just ? 0.14 : 0.05;
    if (r.just) { S.flash = 1; msg('ジャストミート！', { color: '#ffd166', dur: 1.0, size: 0.9 }); }
    if (!path.fair) return onFoul(path);
    pitchInfo();
    S.play = new BB.Play(path, BB.curBatter(g), g.bases, g.outs);
    S.playSpeed = 1;
    S.evSeen = 0;
    S.hrAnnounced = false;
    S.follow = { x: start.x, z: 8 };
    if (path.hr || path.maxH > 25) SFX.cheer(path.hr);
    setPhase('play');
  }

  function updatePlay(dt) {
    const play = S.play;
    let rem = dt * S.playSpeed;
    while (rem > 0 && !play.done) {
      const h = Math.min(rem, 1 / 60);
      play.update(h);
      rem -= h;
    }
    // sounds for play events
    while (S.evSeen < play.events.length) {
      const e = play.events[S.evSeen++];
      if (e === 'catch') SFX.mitt();
      else if (e.startsWith('throw')) SFX.whoosh();
      else if (e.startsWith('out')) { SFX.throwIn(); msg('アウト！', { color: '#ff8787', dur: 0.8, size: 0.8 }); }
    }
    if (play.path.hr && !S.hrAnnounced) {
      const b = play.ball;
      if (Math.hypot(b.x, b.z) > BB.fenceDist(Math.atan2(b.x, b.z))) {
        S.hrAnnounced = true;
        msg('ホームラン！！', { size: 1.6, color: '#ffd166', dur: 2.2 });
        SFX.organ();
        S.shake = 0.4;
      }
    }
    if (play.done) {
      const g = game();
      const bat = BB.curBatter(g);
      const res = BB.applyPlay(g, play);
      S.lastRes = res;
      let big = res.kind === 'HR' ? 1.3 : res.kind === 'H' ? 1.1 : 1.0;
      const col = res.kind === 'HR' || res.kind === 'H' ? '#ffd166' : '#ff8787';
      if (res.kind !== 'HR') msg(res.text, { size: big, color: col, dur: 2.0, sub: res.runs ? `${res.runs}点！` : '' });
      else msg(res.text, { size: 1.1, color: col, dur: 2.0, sub: `${res.runs}点！` });
      say(`${bat.name}、${res.text}` + (res.runs && res.kind !== 'HR' ? ` ${res.runs}点が入りました。` : ''));
      if (res.runs > 0 && res.kind !== 'HR') SFX.cheer(false);
      if (g.over && g.walkoff) msg('サヨナラ！！', { size: 1.7, color: '#ff6b6b', dur: 2.6 });
      setPhase('playResult');
    }
  }

  function afterPitchPhase() {
    const g = game();
    if (g.over) return gameOver();
    if (g.halfEnded) return changeSides();
    if (S.pendingEvent) return beginPA();
    nextPitch();
  }

  function afterPlay() {
    const g = game();
    if (g.over) return gameOver();
    if (g.halfEnded) return changeSides();
    beginPA();
  }

  function changeSides() {
    const g = game();
    SFX.organ();
    msg('チェンジ', { size: 1.3, color: '#9fd4ff', dur: 2.0, sub: `${g.inning}回${g.top ? '表' : '裏'} ${g.teams[BB.batSide(g)].name}の攻撃` });
    say(`${g.inning}回${g.top ? '表' : '裏'}、${g.teams[BB.batSide(g)].name}の攻撃です。`);
    setPhase('change');
  }

  function gameOver() {
    const g = game();
    setPhase('over');
    const us = g.userSide;
    let title, sub;
    if (g.winner === -1) { title = 'DRAW'; sub = '引き分け'; }
    else if (g.winner === us) { title = 'VICTORY!'; sub = g.walkoff ? 'サヨナラ勝ち！' : '勝利！'; }
    else { title = 'GAME SET'; sub = g.walkoff ? 'サヨナラ負け…' : '敗戦…'; }
    try {
      const rec = JSON.parse(localStorage.getItem('ds-record') || '{"w":0,"l":0,"d":0}');
      if (g.winner === -1) rec.d++; else if (g.winner === us) rec.w++; else rec.l++;
      localStorage.setItem('ds-record', JSON.stringify(rec));
    } catch (e) { /* storage unavailable */ }
    if (g.winner === us) SFX.cheer(true); else SFX.groan();
    setTimeout(() => showResult(title, sub), 1600);
  }

  // ---------- update ----------
  function update(dt) {
    for (const m of S.msgs) m.t += dt;
    S.msgs = S.msgs.filter((m) => m.t < m.dur);
    if (S.lastPitch) S.lastPitch.t += dt;
    S.flash = Math.max(0, S.flash - dt * 3);
    S.shake = Math.max(0, S.shake - dt);
    if (S.hitStop > 0) { S.hitStop -= dt; return; }
    S.clock += dt;
    S.pt += dt;
    moveCursorByKeys(dt);
    switch (S.phase) {
      case 'intro': if (S.pt > 1.2) nextPitch(); break;
      case 'ready': if (S.pt > 0.55) startWindup(); break;
      case 'windup': if (S.pt >= WINDUP) release(); break;
      case 'flight': updateFlight(); break;
      case 'call': if (S.pt > (S.pendingEvent ? 1.5 : 0.75)) afterPitchPhase(); break;
      case 'foul': if (S.pt > (S.foul && S.foul.path ? 1.4 : 0.8)) afterPitchPhase(); break;
      case 'play': updatePlay(dt); break;
      case 'playResult': if (S.pt > 2.3) afterPlay(); break;
      case 'change': if (S.pt > 2.3) beginPA(); break;
    }
    updateCamera(dt);
  }

  // ---------- camera ----------
  function updateCamera(dt) {
    const fieldView = S.phase === 'play' || S.phase === 'playResult';
    const target = fieldView ? 1 : 0;
    const rate = fieldView ? 2.2 : 3.5;
    S.camBlend += clamp(target - S.camBlend, -rate * dt, rate * dt);
    if (S.play) {
      const b = S.play.ball;
      const k = 1 - Math.exp(-dt * 3.2);
      S.follow.x += (clamp(b.x, -90, 90) - S.follow.x) * k;
      S.follow.z += (clamp(b.z, 5, 135) - S.follow.z) * k;
    }
    applyCamera();
  }
  function applyCamera() {
    const e = S.camBlend * S.camBlend * (3 - 2 * S.camBlend);
    // batting / pitching view: behind the catcher
    const b = { px: 0, py: 2.5, pz: -8, tx: 0, ty: -1.2, tz: 16, fov: 27 };
    const F = S.follow;
    const d = Math.hypot(F.x, F.z);
    const f = { px: F.x * 0.55, py: 15 + d * 0.2, pz: F.z * 0.55 - 26, tx: F.x, ty: 0, tz: F.z + 2, fov: 50 };
    let sx = 0, sy = 0;
    if (S.shake > 0) { sx = (Math.random() - 0.5) * S.shake * 0.6; sy = (Math.random() - 0.5) * S.shake * 0.6; }
    setCam(cam, lerp(b.px, f.px, e) + sx, lerp(b.py, f.py, e) + sy, lerp(b.pz, f.pz, e), lerp(b.tx, f.tx, e), lerp(b.ty, f.ty, e), lerp(b.tz, f.tz, e), lerp(b.fov, f.fov, e));
  }

  // ---------- drawing: world ----------
  function drawSky() {
    const g = ctx.createLinearGradient(0, 0, 0, H * 0.75);
    g.addColorStop(0, '#040a1c');
    g.addColorStop(0.55, '#132a55');
    g.addColorStop(1, '#2d4f86');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  function drawWorld(c) {
    for (const p of WORLD.flat) fillPoly(c, p.pts, p.color);
    // scoreboard + back structures, sorted far → near
    const items = [];
    for (const s of WORLD.segs) items.push({ d: Math.hypot(s.mx - c.px, s.mz - c.pz), s });
    items.sort((a, b) => b.d - a.d);
    drawScoreboard(c);
    for (const t of WORLD.towers) drawTower(c, t);
    for (const it of items) {
      const s = it.s;
      fillPoly(c, s.roof, '#39415c');
      if (polyPath(c, s.upper)) { ctx.fillStyle = crowdPat; ctx.fill(); ctx.fillStyle = 'rgba(10,14,30,0.25)'; ctx.fill(); }
      fillPoly(c, s.facade, s.fair ? '#23427a' : '#2c3552');
      if (polyPath(c, s.stand)) { ctx.fillStyle = crowdPat; ctx.fill(); }
      fillPoly(c, s.wall, s.fair ? '#1d5a6e' : '#27406c');
      fillPoly(c, s.rail, '#f2c14e');
    }
    for (const p of WORLD.poles) {
      if (proj(c, p.x, 0, p.z, P) && proj(c, p.x, 22, p.z, P2)) {
        ctx.strokeStyle = '#ffd43b';
        ctx.lineWidth = Math.max(1, 0.25 * P.k);
        ctx.beginPath(); ctx.moveTo(P.sx, P.sy); ctx.lineTo(P2.sx, P2.sy); ctx.stroke();
      }
    }
  }

  function drawTower(c, t) {
    if (!proj(c, t.x, 0, t.z, P) || !proj(c, t.x, t.h, t.z, P2)) return;
    ctx.strokeStyle = '#2a3048';
    ctx.lineWidth = Math.max(1, 1.2 * P.k);
    ctx.beginPath(); ctx.moveTo(P.sx, P.sy); ctx.lineTo(P2.sx, P2.sy); ctx.stroke();
    const w = 14 * P2.k, h = 7 * P2.k;
    const glow = ctx.createRadialGradient(P2.sx, P2.sy, 0, P2.sx, P2.sy, w * 2.2);
    glow.addColorStop(0, 'rgba(255,250,225,0.55)');
    glow.addColorStop(1, 'rgba(255,250,225,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(P2.sx - w * 2.2, P2.sy - w * 2.2, w * 4.4, w * 4.4);
    ctx.fillStyle = '#fffbe8';
    ctx.fillRect(P2.sx - w / 2, P2.sy - h / 2, w, h);
    ctx.fillStyle = 'rgba(40,40,60,0.5)';
    for (let i = 1; i < 4; i++) ctx.fillRect(P2.sx - w / 2, P2.sy - h / 2 + (h * i) / 4, w, Math.max(0.5, h * 0.05));
  }

  function drawScoreboard(c) {
    const z = 176, x0 = -30, x1 = 30, y0 = 30, y1 = 54;
    const pts = [x0, y0, z, x1, y0, z, x1, y1, z, x0, y1, z];
    if (!polyPath(c, pts)) return;
    ctx.fillStyle = '#0b0f1c'; ctx.fill();
    ctx.strokeStyle = '#3c4a78'; ctx.lineWidth = 2; ctx.stroke();
    // legs
    fillPoly(c, [-20, 0, z + 1, -17, 0, z + 1, -17, y0, z + 1, -20, y0, z + 1], '#1a2036');
    fillPoly(c, [17, 0, z + 1, 20, 0, z + 1, 20, y0, z + 1, 17, y0, z + 1], '#1a2036');
    if (!proj(c, x0, y1, z, P) || !proj(c, x1, y0, z, P2)) return;
    const bw = P2.sx - P.sx, bh = P2.sy - P.sy;
    if (bw < 40 || !S.game) return;
    const g = S.game;
    ctx.save();
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffd166';
    ctx.font = `700 ${bh * 0.16}px Oswald, sans-serif`;
    ctx.fillText('DIAMOND SPIRITS', P.sx + bw / 2, P.sy + bh * 0.15);
    ctx.font = `700 ${bh * 0.22}px Oswald, sans-serif`;
    for (let i = 0; i < 2; i++) {
      const y = P.sy + bh * (0.45 + i * 0.3);
      ctx.fillStyle = '#e8edf9';
      ctx.textAlign = 'left';
      ctx.fillText(g.teams[i].id, P.sx + bw * 0.08, y);
      ctx.textAlign = 'right';
      ctx.fillStyle = '#ffec99';
      ctx.fillText(String(g.score[i]), P.sx + bw * 0.92, y);
    }
    ctx.restore();
  }

  // ---------- drawing: people ----------
  const SKIN = '#e2b48c';
  function limb(x1, y1, x2, y2) { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); }
  // Draw a ballplayer standing at world (x,z). pose: stand | ready | run | crouch | pitch | bat
  function drawPerson(c, x, z, o) {
    if (!proj(c, x, 0, z, P)) return;
    const fx = P.sx, fy = P.sy, k = P.k;
    if (!proj(c, x, 1.85, z, P2)) return;
    const m = (fy - P2.sy) / 1.85;
    if (m * 1.85 < 2) return;
    const X = (dx) => fx + dx * m, Y = (dy) => fy - dy * m;
    ctx.save();
    ctx.globalAlpha = o.alpha === undefined ? 1 : o.alpha;
    // shadow
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath();
    ctx.ellipse(fx, fy, 0.42 * k, Math.max(1, 0.42 * k * clamp(Math.abs(c.fy) * 1.6 + 0.12, 0.15, 0.9)), 0, 0, Math.PI * 2);
    ctx.fill();
    if (m * 1.85 < 7) {
      ctx.fillStyle = o.jersey;
      ctx.fillRect(fx - 0.25 * m, fy - 1.8 * m, 0.5 * m, 1.8 * m);
      ctx.restore();
      return;
    }
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const pose = o.pose || 'stand';
    const ph = o.phase || 0;
    const side = o.side || 1; // throwing arm side on screen
    let hipY = 0.95, shY = 1.48, lean = 0;
    let fL = [-0.14, 0], fR = [0.14, 0], kL = null, kR = null;
    let hL = [-0.28, 1.0], hR = [0.28, 1.0];
    if (pose === 'ready') { hipY = 0.8; shY = 1.32; fL = [-0.3, 0]; fR = [0.3, 0]; kL = [-0.26, 0.42]; kR = [0.26, 0.42]; hL = [-0.2, 0.78]; hR = [0.2, 0.78]; lean = 0.05; }
    else if (pose === 'crouch') { hipY = 0.55; shY = 1.08; fL = [-0.32, 0]; fR = [0.32, 0]; kL = [-0.42, 0.5]; kR = [0.42, 0.5]; hL = [-0.12, 0.85]; hR = [0.25, 0.75]; }
    else if (pose === 'run') {
      const a = Math.sin(ph) * 0.55;
      fL = [Math.sin(a) * 0.45, Math.max(0, -Math.sin(ph)) * 0.25];
      fR = [-Math.sin(a) * 0.45, Math.max(0, Math.sin(ph)) * 0.25];
      kL = [fL[0] * 0.5 + 0.05, 0.5]; kR = [fR[0] * 0.5 - 0.05, 0.5];
      hL = [-0.3 - Math.sin(a) * 0.2, 1.05 + Math.cos(ph) * 0.1]; hR = [0.3 + Math.sin(a) * 0.2, 1.05 - Math.cos(ph) * 0.1];
      lean = 0.08;
    } else if (pose === 'pitch') {
      // ph: seconds into the delivery (0..WINDUP+)
      const s = side;
      if (ph < 0.35) { hL = [-0.05, 1.22]; hR = [0.05, 1.22]; }
      else if (ph < 0.78) {
        const t = (ph - 0.35) / 0.43;
        const e = Math.sin(t * Math.PI / 2);
        fL = [-s * 0.14 * (1 - e), 0.62 * e]; kL = [-s * 0.3 * e, 0.4 + 0.55 * e];
        hL = [-0.03, 1.28]; hR = [0.03, 1.28];
      } else if (ph < WINDUP) {
        const t = (ph - 0.78) / (WINDUP - 0.78);
        fL = [-s * 0.45 * t, 0.62 * (1 - t)]; kL = [-s * 0.4, 0.5];
        hipY = 0.95 - 0.2 * t; shY = 1.48 - 0.12 * t;
        const ang = lerp(-0.4, 2.6, t);
        hR = [s * (0.1 + Math.cos(ang) * 0.55), 1.5 + Math.sin(ang) * 0.4];
        hL = [-s * 0.55, 1.2];
      } else {
        const t = Math.min(1, (ph - WINDUP) / 0.35);
        fL = [-s * 0.45, 0]; fR = [s * 0.25, 0.1 + 0.3 * t]; kR = [s * 0.2, 0.55];
        hipY = 0.75; shY = 1.25; lean = 0.15;
        hR = [-s * 0.35, 0.8 - 0.1 * t];
        hL = [-s * 0.3, 1.0];
      }
      // mirror for which leg is the glove-side one
      if (s < 0) { const tf = fL; fL = fR; fR = tf; const tk = kL; kL = kR; kR = tk; }
    } else if (pose === 'bat') {
      fL = [-0.32, 0]; fR = [0.32, 0]; kL = [-0.3, 0.48]; kR = [0.3, 0.48];
      hipY = 0.88; shY = 1.42;
      hL = hR = null;
    }
    const pants = o.pants || '#eeeeee';
    // legs
    ctx.strokeStyle = pants;
    ctx.lineWidth = 0.15 * m;
    const legs = [[fL, kL, -0.1], [fR, kR, 0.1]];
    for (const [f, kn, hx] of legs) {
      ctx.beginPath();
      ctx.moveTo(X(hx), Y(hipY));
      if (kn) ctx.lineTo(X(kn[0]), Y(kn[1]));
      ctx.lineTo(X(f[0]), Y(f[1] + 0.12));
      ctx.stroke();
      ctx.strokeStyle = o.sock || '#1b1b1b';
      ctx.lineWidth = 0.13 * m;
      limb(X(f[0]), Y(f[1] + 0.2), X(f[0]), Y(f[1] + 0.03));
      ctx.strokeStyle = pants;
      ctx.lineWidth = 0.15 * m;
    }
    // torso
    const lx = lean;
    ctx.fillStyle = o.jersey;
    ctx.beginPath();
    ctx.moveTo(X(-0.2), Y(hipY));
    ctx.lineTo(X(0.2), Y(hipY));
    ctx.lineTo(X(0.24 + lx), Y(shY));
    ctx.lineTo(X(-0.24 + lx), Y(shY));
    ctx.closePath();
    ctx.fill();
    // trim
    ctx.strokeStyle = o.trim || '#ffffff';
    ctx.lineWidth = Math.max(1, 0.035 * m);
    ctx.beginPath(); ctx.moveTo(X(lx), Y(shY)); ctx.lineTo(X(0), Y(hipY)); ctx.stroke();
    // belt
    ctx.fillStyle = o.cap;
    ctx.fillRect(X(-0.2), Y(hipY + 0.03), 0.4 * m, 0.06 * m);
    if (o.num !== undefined && m > 30) {
      ctx.fillStyle = o.trim || '#fff';
      ctx.font = `700 ${0.28 * m}px Oswald, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(o.num), X(lx * 0.5), Y((hipY + shY) / 2 + 0.05));
    }
    // arms
    if (hL && hR) {
      ctx.strokeStyle = o.jersey;
      ctx.lineWidth = 0.12 * m;
      limb(X(-0.22 + lx), Y(shY - 0.04), X(hL[0]), Y(hL[1]));
      limb(X(0.22 + lx), Y(shY - 0.04), X(hR[0]), Y(hR[1]));
      ctx.fillStyle = SKIN;
      ctx.beginPath(); ctx.arc(X(hR[0]), Y(hR[1]), 0.06 * m, 0, Math.PI * 2); ctx.fill();
      // glove
      ctx.fillStyle = '#6b3f1f';
      ctx.beginPath(); ctx.arc(X(hL[0]), Y(hL[1]), 0.1 * m, 0, Math.PI * 2); ctx.fill();
    }
    // head + cap
    const hx = X(lx * 1.3), hy = Y(shY + 0.17);
    ctx.fillStyle = SKIN;
    ctx.beginPath(); ctx.arc(hx, hy, 0.12 * m, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = o.cap;
    ctx.beginPath(); ctx.arc(hx, hy - 0.02 * m, 0.13 * m, Math.PI, 0); ctx.fill();
    if (o.helmet) { ctx.beginPath(); ctx.arc(hx, hy, 0.14 * m, Math.PI * 0.95, Math.PI * 2.05); ctx.fill(); }
    ctx.fillRect(hx - 0.02 * m, hy - 0.04 * m, 0.2 * m, 0.04 * m);
    ctx.restore();
  }

  function teamLook(t) {
    const light = t.id === 'WLV';
    return { jersey: t.color, cap: t.cap, pants: t.pants, trim: t.color2, sock: t.cap, light };
  }

  // Batter (seen from behind the catcher) + bat drawn in 3D
  function drawBatter(c, batter, look, swing, clock) {
    const bh = batter.hand === 'R' ? 1 : -1;
    const bx = -0.78 * bh, bz = 0.1;
    drawPerson(c, bx, bz, Object.assign({}, look, { pose: 'bat', helmet: true, num: batter.order * 3 + 1, alpha: 0.97 }));
    // bat
    let a, dy, hy;
    const sc = BB.SWING_DELAY / SWING_DUR;
    const cy = swing ? swing.cursor.y : 1.0;
    if (!swing) { a = -150; dy = 0.9; hy = 1.38; }
    else {
      const s = clamp((clock - swing.t0) / SWING_DUR, 0, 1);
      if (s < sc) {
        const e = s / sc;
        const ee = e * e;
        a = lerp(-150, 0, ee); dy = lerp(0.9, -0.08, e); hy = lerp(1.38, cy + 0.03, ee);
      } else {
        const e = (s - sc) / (1 - sc);
        a = lerp(0, 125, Math.sin(e * Math.PI / 2)); dy = lerp(-0.08, 0.45, e); hy = lerp(cy + 0.03, 1.4, e);
      }
    }
    const ar = a * DEG;
    let dx = Math.cos(ar) * bh, dz = Math.sin(ar);
    const l = Math.hypot(dx, dy, dz);
    const ux = dx / l, uy = dy / l, uz = dz / l;
    const hx = bx + bh * 0.32 + ux * 0.12, hz = bz - 0.05 + uz * 0.12;
    const tx = hx + ux * 0.86, ty = hy + uy * 0.86, tz = hz + uz * 0.86;
    if (proj(c, hx, hy, hz, P) && proj(c, tx, ty, tz, P2)) {
      ctx.save();
      ctx.lineCap = 'round';
      ctx.strokeStyle = '#3a2412';
      ctx.lineWidth = Math.max(2, 0.05 * P.k);
      ctx.beginPath(); ctx.moveTo(P.sx, P.sy); ctx.lineTo(lerp(P.sx, P2.sx, 0.35), lerp(P.sy, P2.sy, 0.35)); ctx.stroke();
      ctx.strokeStyle = '#c9a36a';
      ctx.lineWidth = Math.max(3, 0.068 * lerp(P.k, P2.k, 0.6));
      ctx.beginPath(); ctx.moveTo(lerp(P.sx, P2.sx, 0.3), lerp(P.sy, P2.sy, 0.3)); ctx.lineTo(P2.sx, P2.sy); ctx.stroke();
      // hands
      ctx.fillStyle = look.cap;
      ctx.beginPath(); ctx.arc(P.sx, P.sy, Math.max(3, 0.06 * P.k), 0, Math.PI * 2); ctx.fill();
      // arms to shoulders
      if (proj(c, bx + bh * 0.05, 1.42, bz, P2)) {
        ctx.strokeStyle = look.jersey;
        ctx.lineWidth = Math.max(2, 0.1 * P.k);
        ctx.beginPath(); ctx.moveTo(P2.sx - 0.18 * P2.k, P2.sy); ctx.lineTo(P.sx, P.sy); ctx.moveTo(P2.sx + 0.18 * P2.k, P2.sy); ctx.lineTo(P.sx, P.sy); ctx.stroke();
      }
      ctx.restore();
    }
  }

  function drawBall(c, x, y, z, glow) {
    if (proj(c, x, 0, z, P)) {
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      const r = Math.max(1.2, BB.BALL_R * 1.2 * P.k);
      ctx.beginPath(); ctx.ellipse(P.sx, P.sy, r, r * 0.4, 0, 0, Math.PI * 2); ctx.fill();
    }
    if (!proj(c, x, y, z, P)) return;
    const r = Math.max(2.2, BB.BALL_R * P.k);
    if (glow) {
      const g = ctx.createRadialGradient(P.sx, P.sy, 0, P.sx, P.sy, r * 3);
      g.addColorStop(0, 'rgba(255,255,255,0.5)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(P.sx, P.sy, r * 3, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = '#fbfbf6';
    ctx.beginPath(); ctx.arc(P.sx, P.sy, r, 0, Math.PI * 2); ctx.fill();
    if (r > 5) {
      ctx.strokeStyle = '#d9483b';
      ctx.lineWidth = Math.max(1, r * 0.12);
      ctx.beginPath(); ctx.arc(P.sx - r * 0.9, P.sy, r * 0.75, -0.9, 0.9); ctx.stroke();
      ctx.beginPath(); ctx.arc(P.sx + r * 0.9, P.sy, r * 0.75, Math.PI - 0.9, Math.PI + 0.9); ctx.stroke();
    }
  }

  function drawEntities(c) {
    const g = S.game;
    if (!g) return;
    const def = g.teams[BB.fieldSide(g)], off = g.teams[BB.batSide(g)];
    const dl = teamLook(def), ol = teamLook(off);
    const pitcher = BB.curPitcher(g);
    const pSide = pitcher.hand === 'R' ? -1 : 1;
    const list = [];
    const inPlay = S.play && (S.phase === 'play' || S.phase === 'playResult');
    if (inPlay) {
      for (const f of S.play.fielders) {
        const pose = f.moving ? 'run' : f.pos === 'C' ? 'crouch' : 'ready';
        list.push({ x: f.x, z: f.z, o: Object.assign({}, dl, { pose, phase: S.clock * 11 + f.x }) });
      }
      for (const r of S.play.runners) {
        if (r.state === 'scored') continue;
        const p = BB.basePos(r.s);
        const moving = r.state === 'run' && S.play.t >= r.startAt;
        list.push({ x: p.x + 0.6, z: p.z, o: Object.assign({}, ol, { pose: moving ? 'run' : 'stand', phase: S.clock * 13, helmet: true, alpha: r.state === 'out' ? 0.35 : 1 }) });
      }
    } else {
      for (const f of BB.FIELD_POS) {
        if (f.pos === 'C') continue;
        if (f.pos === 'P') {
          let ph = 0;
          if (S.phase === 'windup') ph = S.pt;
          else if (S.phase === 'flight' || S.phase === 'call' || S.phase === 'foul') ph = WINDUP + (S.clock - S.release);
          list.push({ x: 0, z: 18.3, o: Object.assign({}, dl, { pose: 'pitch', phase: ph, side: pSide }) });
          continue;
        }
        const ready = S.phase === 'windup' || S.phase === 'flight';
        list.push({ x: f.x, z: f.z, o: Object.assign({}, dl, { pose: ready ? 'ready' : 'stand' }) });
      }
      for (let b = 1; b <= 3; b++) {
        if (!g.bases[b]) continue;
        const lead = S.phase === 'windup' || S.phase === 'flight' ? 3.2 : 1.5;
        const p = BB.basePos(b * BB.BASE_L + lead);
        list.push({ x: p.x, z: p.z, o: Object.assign({}, ol, { pose: 'ready', helmet: true }) });
      }
    }
    // sort far → near
    for (const it of list) it.d = (it.x - c.px) * c.fx + (it.z - c.pz) * c.fz;
    list.sort((a, b) => b.d - a.d);
    for (const it of list) drawPerson(c, it.x, it.z, it.o);

    // ball
    if (inPlay) {
      const b = S.play.ball;
      drawBall(c, b.x, b.y, b.z, true);
    } else if (S.phase === 'foul' && S.foul && S.foul.path) {
      const p = BB.samplePath(S.foul.path, (S.clock - S.foul.t0) * 1.2);
      drawBall(c, p.x, p.y, p.z, false);
    }
  }

  function drawBatterLayer(c) {
    const g = S.game;
    if (!g || S.camBlend > 0.5) return;
    const off = g.teams[BB.batSide(g)];
    const batter = BB.curBatter(g);
    const inPlay = S.phase === 'play' || S.phase === 'playResult';
    if (inPlay) return;
    const clock = S.clock;
    // pitched ball (drawn before the batter only when it is behind him)
    const showBall = S.pitch && (S.phase === 'flight' || S.phase === 'call') && !(S.swing && S.swing.done && S.swing.res.kind === 'hit');
    if (showBall && S.phase === 'flight') {
      for (let i = 0; i < S.trail.length - 1; i++) {
        const t = S.trail[i];
        if (t.z > 2.5 && proj(c, t.x, t.y, t.z, P)) {
          ctx.fillStyle = `rgba(255,255,255,${0.06 + i * 0.03})`;
          ctx.beginPath(); ctx.arc(P.sx, P.sy, Math.max(1.5, BB.BALL_R * P.k * 0.9), 0, Math.PI * 2); ctx.fill();
        }
      }
    }
    drawZone(c);
    if (showBall && S.phase === 'flight' && (S.clock - S.release) / S.Tdisp < 1.04) drawBall(c, S.ball.x, S.ball.y, S.ball.z, false);
    drawBatter(c, batter, teamLook(off), S.swing, clock);
    drawCursors(c);
  }

  function drawZone(c) {
    const Z = BB.ZONE;
    const alpha = S.phase === 'flight' ? 0.28 : 0.45;
    ctx.save();
    ctx.strokeStyle = `rgba(255,255,255,${alpha})`;
    ctx.lineWidth = 1.5;
    const pt = (x, y) => { proj(c, x, y, 0, P); return [P.sx, P.sy]; };
    const [ax, ay] = pt(Z.x0, Z.y1), [bx, by] = pt(Z.x1, Z.y0);
    ctx.strokeRect(ax, ay, bx - ax, by - ay);
    ctx.strokeStyle = `rgba(255,255,255,${alpha * 0.45})`;
    ctx.lineWidth = 1;
    for (let i = 1; i < 3; i++) {
      const x = lerp(ax, bx, i / 3), y = lerp(ay, by, i / 3);
      ctx.beginPath(); ctx.moveTo(x, ay); ctx.lineTo(x, by); ctx.moveTo(ax, y); ctx.lineTo(bx, y); ctx.stroke();
    }
    // last pitch location marker
    if (S.lastPitch && (S.phase === 'call' || S.phase === 'foul' || S.phase === 'aim' || S.phase === 'ready' || S.phase === 'intro') && S.lastPitch.t < 4) {
      const [px, py] = pt(S.lastPitch.x, S.lastPitch.y);
      ctx.globalAlpha = clamp(1.4 - S.lastPitch.t / 3, 0, 1);
      ctx.fillStyle = S.lastPitch.color;
      ctx.beginPath(); ctx.arc(px, py, 5, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.restore();
  }

  function ellipseAt(c, x, y, w, h) {
    proj(c, x, y, 0, P);
    ctx.beginPath();
    ctx.ellipse(P.sx, P.sy, w * P.k, h * P.k, 0, 0, Math.PI * 2);
    return P;
  }

  function drawCursors(c) {
    const g = S.game;
    ctx.save();
    if (userBatting()) {
      if (S.phase === 'change' || S.phase === 'over') { ctx.restore(); return; }
      const batter = BB.curBatter(g);
      const pw = S.swing ? S.swing.power : power();
      const cs = BB.cursorSize(batter, pw, S.diff);
      const cur = S.swing ? S.swing.cursor : S.cursor;
      const col = pw ? '255,95,70' : '255,214,90';
      ellipseAt(c, cur.x, cur.y, cs.w, cs.h);
      ctx.fillStyle = `rgba(${col},0.16)`;
      ctx.fill();
      ctx.strokeStyle = `rgba(${col},0.95)`;
      ctx.lineWidth = 2.5;
      ctx.stroke();
      ellipseAt(c, cur.x, cur.y, cs.w * 0.32, cs.h * 0.32);
      ctx.strokeStyle = `rgba(${col},0.7)`;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      proj(c, cur.x, cur.y, 0, P);
      ctx.strokeStyle = `rgba(${col},0.8)`;
      ctx.beginPath();
      const r = cs.w * P.k;
      ctx.moveTo(P.sx - r - 8, P.sy); ctx.lineTo(P.sx - r + 6, P.sy);
      ctx.moveTo(P.sx + r - 6, P.sy); ctx.lineTo(P.sx + r + 8, P.sy);
      ctx.stroke();
      if (pw) {
        ctx.fillStyle = 'rgba(255,110,80,0.95)';
        ctx.font = `900 ${13 * UI}px 'Noto Sans JP', sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText('強振', P.sx, P.sy - cs.h * P.k - 8);
      }
      // easy-mode landing marker
      if (S.diff.marker && S.pitch && S.phase === 'flight') {
        const u = (S.clock - S.release) / S.Tdisp;
        if (u > 0.25 && u < 1) {
          const t = S.pitch.target;
          ellipseAt(c, t.x, t.y, 0.045, 0.045);
          ctx.strokeStyle = `rgba(120,220,255,${0.3 + u * 0.5})`;
          ctx.lineWidth = 2;
          ctx.stroke();
        }
      }
    } else if (S.phase === 'aim' || S.phase === 'windup' || S.phase === 'ready') {
      const pitcher = BB.curPitcher(g);
      const pk = pitcher.pitches[S.selPitch][0];
      const pc = BB.PITCHES[pk].color;
      ellipseAt(c, S.aim.x, S.aim.y, 0.06, 0.06);
      ctx.strokeStyle = pc;
      ctx.lineWidth = 2.5;
      ctx.stroke();
      proj(c, S.aim.x, S.aim.y, 0, P);
      const ax = P.sx, ay = P.sy, ak = P.k;
      ctx.beginPath();
      ctx.moveTo(ax - 14, ay); ctx.lineTo(ax + 14, ay); ctx.moveTo(ax, ay - 14); ctx.lineTo(ax, ay + 14);
      ctx.stroke();
      // break direction arrow
      const P0 = BB.PITCHES[pk];
      const hand = pitcher.hand === 'R' ? 1 : -1;
      const bxv = P0.hx * hand, byv = P0.vy + (pk === 'FB' ? 0.12 : 0);
      if (Math.hypot(bxv, byv) > 0.05) {
        const sx = ax - bxv * ak * 1.3, sy = ay + byv * ak * 1.3;
        ctx.strokeStyle = pc;
        ctx.globalAlpha = 0.6;
        ctx.setLineDash([4, 4]);
        ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ax, ay); ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
      }
      // release gauge
      if (S.phase === 'windup' && S.gauge) {
        const target = 0.06 * ak * 1.0 + 6;
        const t = S.pt;
        const r = gaugeRadius(t, target);
        if (r > 0) {
          ctx.lineWidth = 3;
          ctx.strokeStyle = S.gauge.clicked ? 'rgba(255,255,255,0.35)' : '#ffffff';
          ctx.beginPath(); ctx.arc(ax, ay, r, 0, Math.PI * 2); ctx.stroke();
        }
        ctx.lineWidth = 2;
        ctx.strokeStyle = 'rgba(255,214,90,0.8)';
        ctx.beginPath(); ctx.arc(ax, ay, target, 0, Math.PI * 2); ctx.stroke();
      }
    }
    ctx.restore();
  }

  // release gauge: shrinking ring that crosses the target ring at GAUGE_BEST
  const GAUGE_BEST = 0.95;
  function gaugeRadius(t, target) {
    const t0 = 0.15, t1 = 1.25;
    if (t < t0 || t > t1) return -1;
    const k = (t - t0) / (GAUGE_BEST - t0);
    return target * (4 - 3 * k);
  }

  // ---------- HUD ----------
  function rr(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function posJP(p) {
    return { P: '投', C: '捕', '1B': '一', '2B': '二', '3B': '三', SS: '遊', LF: '左', CF: '中', RF: '右', DH: 'DH' }[p] || p;
  }

  function drawHUD() {
    const g = S.game;
    if (!g) return;
    const s = UI;
    ctx.save();
    ctx.textBaseline = 'middle';
    // --- scoreboard (top-left) ---
    const x = 12, y = 12, w = 244 * s, rowH = 30 * s;
    rr(x, y, w, rowH * 2 + 8 * s, 8 * s);
    ctx.fillStyle = 'rgba(6,10,24,0.82)';
    ctx.fill();
    for (let i = 0; i < 2; i++) {
      const t = g.teams[i];
      const ry = y + 4 * s + i * rowH;
      ctx.fillStyle = t.color;
      ctx.fillRect(x + 6 * s, ry + 4 * s, 6 * s, rowH - 8 * s);
      ctx.fillStyle = t.color2;
      ctx.fillRect(x + 12 * s, ry + 4 * s, 3 * s, rowH - 8 * s);
      ctx.fillStyle = BB.batSide(g) === i ? '#ffffff' : '#9aa6c7';
      ctx.font = `700 ${16 * s}px Oswald, sans-serif`;
      ctx.textAlign = 'left';
      ctx.fillText(t.id + (i === g.userSide ? ' ★' : ''), x + 22 * s, ry + rowH / 2);
      ctx.textAlign = 'right';
      ctx.fillStyle = '#ffec99';
      ctx.font = `700 ${20 * s}px Oswald, sans-serif`;
      ctx.fillText(String(g.score[i]), x + 118 * s, ry + rowH / 2);
    }
    // inning
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffffff';
    ctx.font = `700 ${18 * s}px Oswald, sans-serif`;
    ctx.fillText(String(g.inning), x + 146 * s, y + rowH);
    ctx.fillStyle = '#ffd166';
    ctx.font = `${11 * s}px sans-serif`;
    ctx.fillText(g.top ? '▲' : '▼', x + 146 * s, y + rowH + (g.top ? -15 : 15) * s);
    // bases
    const bx = x + 196 * s, by = y + rowH + 2 * s, bs = 8 * s;
    const baseAt = [[bx + 12 * s, by], [bx, by - 12 * s], [bx - 12 * s, by]];
    for (let b = 1; b <= 3; b++) {
      const [cx, cy] = baseAt[b - 1];
      ctx.beginPath();
      ctx.moveTo(cx, cy - bs); ctx.lineTo(cx + bs, cy); ctx.lineTo(cx, cy + bs); ctx.lineTo(cx - bs, cy); ctx.closePath();
      ctx.fillStyle = g.bases[b] ? '#ffd166' : 'rgba(255,255,255,0.12)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.4)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    // BSO
    const oy = y + rowH * 2 + 14 * s;
    rr(x, oy, 150 * s, 62 * s, 8 * s);
    ctx.fillStyle = 'rgba(6,10,24,0.82)';
    ctx.fill();
    const rows = [['B', g.balls, 3, '#51cf66'], ['S', g.strikes, 2, '#fcc419'], ['O', Math.min(2, g.outs), 2, '#ff6b6b']];
    rows.forEach(([lab, n, max, col], i) => {
      const ry = oy + 11 * s + i * 20 * s;
      ctx.fillStyle = '#c3cbe3';
      ctx.font = `700 ${13 * s}px Oswald, sans-serif`;
      ctx.textAlign = 'left';
      ctx.fillText(lab, x + 10 * s, ry);
      for (let k = 0; k < max; k++) {
        ctx.beginPath();
        ctx.arc(x + (34 + k * 18) * s, ry, 6 * s, 0, Math.PI * 2);
        ctx.fillStyle = k < n ? col : 'rgba(255,255,255,0.1)';
        ctx.fill();
      }
    });

    // --- last pitch (top-right) ---
    if (S.lastPitch) {
      const lp = S.lastPitch;
      const a = clamp(3.5 - lp.t / 1.5, 0, 1);
      if (a > 0) {
        ctx.globalAlpha = a;
        const w2 = 190 * s, x2 = W - w2 - 12, y2 = 12;
        rr(x2, y2, w2, 48 * s, 8 * s);
        ctx.fillStyle = 'rgba(6,10,24,0.82)';
        ctx.fill();
        ctx.textAlign = 'right';
        ctx.fillStyle = '#ffffff';
        ctx.font = `700 ${26 * s}px Oswald, sans-serif`;
        ctx.fillText(String(lp.kmh), x2 + 104 * s, y2 + 24 * s);
        ctx.font = `${12 * s}px Oswald, sans-serif`;
        ctx.fillStyle = '#9aa6c7';
        ctx.textAlign = 'left';
        ctx.fillText('km/h', x2 + 108 * s, y2 + 28 * s);
        ctx.fillStyle = lp.color;
        ctx.font = `900 ${12 * s}px 'Noto Sans JP', sans-serif`;
        ctx.textAlign = 'left';
        ctx.fillText(lp.name, x2 + 10 * s, y2 + 38 * s);
        ctx.globalAlpha = 1;
      }
    }

    // --- batter & pitcher cards (bottom) ---
    const batter = BB.curBatter(g), pitcher = BB.curPitcher(g);
    const bt = g.teams[BB.batSide(g)], pt = g.teams[BB.fieldSide(g)];
    const cardW = 232 * s, cardH = 78 * s;
    const bottomPad = (!userBatting() && S.phase !== 'play' && S.phase !== 'playResult') ? 72 * s : 12;
    const cy = H - cardH - bottomPad;
    // batter
    drawCard(12, cy, cardW, cardH, bt, `${batter.order}番 ${posJP(batter.pos)}`, batter.name, `${batter.hand === 'R' ? '右打' : '左打'}`, [
      ['ミート', batter.meet], ['パワー', batter.power], ['走力', batter.speed],
    ], `${batter.st.ab}打数${batter.st.h}安打` + (batter.st.hr ? ` ${batter.st.hr}本` : '') + (batter.st.rbi ? ` ${batter.st.rbi}打点` : ''));
    // pitcher
    const stamina = pitcher.stam / pitcher.stamMax;
    drawCard(W - cardW - 12, cy, cardW, cardH, pt, `${pitcher.role}`, pitcher.name, `${pitcher.hand === 'R' ? '右投' : '左投'} ${pitcher.kmh}km`, [
      ['コン', pitcher.control], ['スタ', pitcher.stamina],
    ], `球数 ${pitcher.count}`, stamina);

    // --- commentary ---
    if (S.commentary && S.phase !== 'over') {
      ctx.font = `700 ${14 * s}px 'Noto Sans JP', sans-serif`;
      const tw = ctx.measureText(S.commentary).width + 28;
      const ty = 28 * s;
      const tx = W / 2;
      if (tw < W - 2 * 250 * s - 20) {
        rr(tx - tw / 2, ty - 14 * s, tw, 28 * s, 14 * s);
        ctx.fillStyle = 'rgba(6,10,24,0.72)';
        ctx.fill();
        ctx.fillStyle = '#e9eefb';
        ctx.textAlign = 'center';
        ctx.fillText(S.commentary, tx, ty);
      }
    }

    // --- help line ---
    if (S.phase === 'aim') hint('コースを決めてクリック / スペースで投球');
    else if (S.phase === 'windup' && S.gauge && !S.gauge.clicked) hint('円が重なった瞬間にもう一度！');
    else if (S.phase === 'play' && S.playSpeed === 1) hint('クリックで早送り');
    ctx.restore();
  }

  function hint(text) {
    const s = UI;
    ctx.font = `700 ${13 * s}px 'Noto Sans JP', sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.fillText(text, W / 2, 62 * s);
  }

  function drawCard(x, y, w, h, team, top, name, sub, stats, line, stamina) {
    const s = UI;
    rr(x, y, w, h, 8 * s);
    ctx.fillStyle = 'rgba(6,10,24,0.84)';
    ctx.fill();
    ctx.fillStyle = team.color;
    ctx.fillRect(x, y + 8 * s, 5 * s, h - 16 * s);
    ctx.fillStyle = team.color2;
    ctx.fillRect(x + 5 * s, y + 8 * s, 2 * s, h - 16 * s);
    ctx.textAlign = 'left';
    ctx.fillStyle = '#9aa6c7';
    ctx.font = `700 ${11 * s}px 'Noto Sans JP', sans-serif`;
    ctx.fillText(top + '  ' + sub, x + 14 * s, y + 13 * s);
    ctx.fillStyle = '#ffffff';
    ctx.font = `900 ${17 * s}px 'Noto Sans JP', sans-serif`;
    ctx.fillText(name, x + 14 * s, y + 32 * s);
    let sx = x + 14 * s;
    ctx.font = `700 ${11 * s}px 'Noto Sans JP', sans-serif`;
    for (const [lab, v] of stats) {
      ctx.fillStyle = '#9aa6c7';
      ctx.fillText(lab, sx, y + 52 * s);
      const lw = ctx.measureText(lab).width;
      const r = BB.rank(v);
      ctx.fillStyle = { S: '#ff6b9a', A: '#ff922b', B: '#ffd43b', C: '#a9e34b', D: '#69db7c', E: '#66d9e8', F: '#91a7ff', G: '#adb5bd' }[r];
      ctx.font = `700 ${14 * s}px Oswald, sans-serif`;
      ctx.fillText(r, sx + lw + 4 * s, y + 52 * s);
      ctx.font = `700 ${11 * s}px 'Noto Sans JP', sans-serif`;
      sx += lw + 24 * s;
    }
    ctx.fillStyle = '#c9d3ee';
    ctx.fillText(line, x + 14 * s, y + 68 * s);
    if (stamina !== undefined) {
      const bw = 70 * s, bx = x + w - bw - 10 * s, by = y + 64 * s;
      ctx.fillStyle = 'rgba(255,255,255,0.1)';
      ctx.fillRect(bx, by, bw, 7 * s);
      ctx.fillStyle = stamina > 0.5 ? '#51cf66' : stamina > 0.25 ? '#fcc419' : '#ff6b6b';
      ctx.fillRect(bx, by, bw * clamp(stamina, 0, 1), 7 * s);
      ctx.fillStyle = '#9aa6c7';
      ctx.font = `700 ${10 * s}px 'Noto Sans JP', sans-serif`;
      ctx.textAlign = 'right';
      ctx.fillText('スタミナ', bx - 4 * s, by + 4 * s);
    }
  }

  function drawMessages() {
    const s = UI;
    let yi = 0;
    for (const m of S.msgs) {
      const t = m.t;
      const pop = t < 0.15 ? 0.6 + (t / 0.15) * 0.4 : 1;
      const a = clamp((m.dur - t) / 0.3, 0, 1);
      const size = 46 * s * m.size * pop;
      ctx.save();
      ctx.globalAlpha = a;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `900 ${size}px 'Noto Sans JP', sans-serif`;
      const y = H * 0.36 + yi * 62 * s;
      ctx.lineWidth = Math.max(4, size * 0.14);
      ctx.strokeStyle = 'rgba(0,0,0,0.75)';
      ctx.strokeText(m.text, W / 2, y);
      ctx.fillStyle = m.color;
      ctx.fillText(m.text, W / 2, y);
      if (m.sub) {
        ctx.font = `700 ${18 * s}px 'Noto Sans JP', sans-serif`;
        ctx.lineWidth = 4;
        ctx.strokeText(m.sub, W / 2, y + size * 0.72);
        ctx.fillStyle = '#ffffff';
        ctx.fillText(m.sub, W / 2, y + size * 0.72);
      }
      ctx.restore();
      yi++;
    }
    if (S.phase === 'intro' && S.game) {
      const b = BB.curBatter(S.game);
      const t = S.game.teams[BB.batSide(S.game)];
      const a = clamp(Math.min(S.pt / 0.2, (1.2 - S.pt) / 0.25), 0, 1);
      ctx.save();
      ctx.globalAlpha = a;
      const w = 340 * s, h = 64 * s, x = W / 2 - w / 2, y = H * 0.6;
      const gr = ctx.createLinearGradient(x, 0, x + w, 0);
      gr.addColorStop(0, 'rgba(0,0,0,0)');
      gr.addColorStop(0.2, t.color);
      gr.addColorStop(0.8, t.color);
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = gr;
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = t.color2;
      ctx.fillRect(x + w * 0.15, y, w * 0.7, 3 * s);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = t.id === 'WLV' ? '#14264d' : '#ffffff';
      ctx.font = `700 ${13 * s}px 'Noto Sans JP', sans-serif`;
      ctx.fillText(`${b.order}番  ${posJP(b.pos)}  ${b.hand === 'R' ? '右打' : '左打'}`, W / 2, y + 18 * s);
      ctx.font = `900 ${24 * s}px 'Noto Sans JP', sans-serif`;
      ctx.fillText(b.name, W / 2, y + 43 * s);
      ctx.restore();
    }
    if (S.flash > 0) {
      ctx.fillStyle = `rgba(255,255,240,${S.flash * 0.35})`;
      ctx.fillRect(0, 0, W, H);
    }
  }

  function render() {
    drawSky();
    if (!S.game) {
      // attract mode: slow orbit over the field
      const t = performance.now() / 1000;
      setCam(cam, Math.sin(t * 0.08) * 60, 28, -40 + Math.cos(t * 0.08) * 10, 0, 0, 45, 55);
      drawWorld(cam);
      return;
    }
    drawWorld(cam);
    drawEntities(cam);
    drawBatterLayer(cam);
    drawHUD();
    drawMessages();
  }

  // ---------- input ----------
  const keys = {};
  function moveCursorByKeys(dt) {
    if (!S.game) return;
    let dx = 0, dy = 0;
    if (keys.ArrowLeft || keys.KeyA) dx -= 1;
    if (keys.ArrowRight || keys.KeyD) dx += 1;
    if (keys.ArrowUp || keys.KeyW) dy += 1;
    if (keys.ArrowDown || keys.KeyS) dy -= 1;
    if (!dx && !dy) return;
    const sp = 1.15 * dt;
    if (userBatting()) {
      if (S.swing) return;
      S.cursor.x = clamp(S.cursor.x + dx * sp, -0.62, 0.62);
      S.cursor.y = clamp(S.cursor.y + dy * sp, 0.2, 1.5);
    } else if (S.phase === 'aim' || S.phase === 'intro' || S.phase === 'call' || S.phase === 'foul') {
      S.aim.x = clamp(S.aim.x + dx * sp * 0.8, -0.6, 0.6);
      S.aim.y = clamp(S.aim.y + dy * sp * 0.8, 0.15, 1.5);
    }
  }

  function setFromPointer(sx, sy) {
    if (!S.game || S.camBlend > 0.3) return;
    const p = screenToPlate(cam, sx, sy);
    if (!p) return;
    if (userBatting()) {
      if (S.swing) return;
      S.cursor.x = clamp(p.x, -0.62, 0.62);
      S.cursor.y = clamp(p.y, 0.2, 1.5);
    } else if (S.phase !== 'windup' && S.phase !== 'flight') {
      S.aim.x = clamp(p.x, -0.6, 0.6);
      S.aim.y = clamp(p.y, 0.15, 1.5);
    }
  }

  function primaryAction() {
    if (!S.game) return;
    audio();
    if (S.phase === 'play') { S.playSpeed = 3.5; updateControls(); return; }
    if (S.phase === 'intro' && S.pt > 0.3) { nextPitch(); return; }
    if (S.phase === 'playResult' && S.pt > 0.5) { afterPlay(); return; }
    if (S.phase === 'change' && S.pt > 0.6) { beginPA(); return; }
    if (userBatting()) { userSwing(); return; }
    if (S.phase === 'aim') { startWindup(); SFX.click(); return; }
    if (S.phase === 'windup' && S.gauge && !S.gauge.clicked) {
      const t = S.pt;
      S.gauge.clicked = true;
      S.gauge.q = clamp(1 - Math.abs(t - GAUGE_BEST) / 0.22, 0, 1);
      if (S.gauge.q > 0.85) { msg('ベスト！', { color: '#ffd166', dur: 0.7, size: 0.7 }); SFX.good(); }
      else if (S.gauge.q > 0.45) msg('グッド', { color: '#a9e34b', dur: 0.6, size: 0.6 });
    }
  }

  function togglePower() {
    S.powerToggle = !S.powerToggle;
    updateControls();
  }

  let touchLast = null;
  canvas.addEventListener('pointerdown', (e) => {
    audio();
    if (e.pointerType === 'touch') {
      touchLast = { x: e.clientX, y: e.clientY };
      if (S.phase === 'play' || S.phase === 'playResult' || S.phase === 'change' || S.phase === 'intro') primaryAction();
      return;
    }
    if (e.button === 2) { if (userBatting()) togglePower(); return; }
    setFromPointer(e.clientX, e.clientY);
    primaryAction();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch') {
      if (!touchLast || !S.game) return;
      const dx = e.clientX - touchLast.x, dy = e.clientY - touchLast.y;
      touchLast = { x: e.clientX, y: e.clientY };
      proj(cam, 0, 0.8, 0, P);
      const k = P.k || 1;
      if (userBatting()) {
        if (S.swing) return;
        S.cursor.x = clamp(S.cursor.x + (dx / k) * 1.2, -0.62, 0.62);
        S.cursor.y = clamp(S.cursor.y - (dy / k) * 1.2, 0.2, 1.5);
      } else if (S.phase !== 'windup' && S.phase !== 'flight') {
        S.aim.x = clamp(S.aim.x + dx / k, -0.6, 0.6);
        S.aim.y = clamp(S.aim.y - dy / k, 0.15, 1.5);
      }
      return;
    }
    setFromPointer(e.clientX, e.clientY);
  });
  canvas.addEventListener('pointerup', () => { touchLast = null; });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  window.addEventListener('keydown', (e) => {
    if (e.repeat && (e.code === 'Space' || e.code === 'Enter' || e.code === 'KeyJ')) return;
    keys[e.code] = true;
    if (!S.game || S.phase === 'over') return;
    if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
    if (e.code === 'Space' || e.code === 'Enter' || e.code === 'KeyJ') primaryAction();
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight' || e.code === 'KeyK') { S.powerHold = true; }
    if (e.code === 'KeyE') togglePower();
    if (e.code === 'KeyP') relief();
    if (/^Digit[1-5]$/.test(e.code)) selectPitch(+e.code.slice(5) - 1);
  });
  window.addEventListener('keyup', (e) => {
    keys[e.code] = false;
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight' || e.code === 'KeyK') S.powerHold = false;
  });
  window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; S.powerHold = false; });

  // ---------- DOM controls ----------
  const $ = (id) => document.getElementById(id);
  const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;

  function selectPitch(i) {
    const p = S.game && BB.curPitcher(S.game);
    if (!p || userBatting() || i >= p.pitches.length) return;
    if (S.phase === 'windup' || S.phase === 'flight') return;
    S.selPitch = i;
    SFX.click();
    buildPitchPanel();
  }

  function relief() {
    const g = S.game;
    if (!g || userBatting() || S.phase !== 'aim') return;
    const side = g.userSide;
    const np = BB.changePitcher(g, side);
    if (!np) { msg('控え投手がいません', { dur: 1, size: 0.6, color: '#ff8787' }); return; }
    S.selPitch = 0;
    msg('ピッチャー交代', { color: '#9fd4ff', sub: np.name });
    say(`${g.teams[side].name}、ピッチャー交代。${np.name} がマウンドへ。`);
    buildPitchPanel();
  }

  function buildPitchPanel() {
    const g = S.game;
    if (!g) return;
    const p = g.teams[g.userSide].pitchers[g.teams[g.userSide].curP];
    if (S.selPitch >= p.pitches.length) S.selPitch = 0;
    const list = $('pitchList');
    list.innerHTML = '';
    p.pitches.forEach(([k, lv], i) => {
      const P0 = BB.PITCHES[k];
      const b = document.createElement('button');
      b.className = 'pbtn' + (i === S.selPitch ? ' on' : '');
      b.style.setProperty('--pc', P0.color);
      b.innerHTML = `<span class="k">${i + 1}</span><span class="n">${P0.name}</span><span class="lv">${'■'.repeat(lv)}${'□'.repeat(7 - lv)}</span>`;
      b.addEventListener('pointerdown', (e) => { e.stopPropagation(); selectPitch(i); });
      list.appendChild(b);
    });
    const left = g.teams[g.userSide].pitchers.some((q) => !q.used);
    $('btnRelief').disabled = !left;
    $('btnRelief').style.opacity = left ? 1 : 0.35;
  }

  function updateControls() {
    const g = S.game;
    const active = g && S.phase !== 'over' && S.phase !== 'menu';
    const ub = active && userBatting();
    const pitching = active && !ub && ['aim', 'intro', 'ready', 'windup', 'flight', 'call', 'foul'].includes(S.phase);
    $('pitchPanel').classList.toggle('hidden', !pitching);
    $('touchBat').classList.toggle('hidden', !(coarse && ub && S.phase !== 'play' && S.phase !== 'playResult'));
    $('touchPitch').classList.toggle('hidden', !(coarse && pitching));
    $('btnPower').classList.toggle('on', S.powerToggle);
    $('btnFast').classList.toggle('hidden', !(active && S.phase === 'play' && S.playSpeed === 1));
  }

  $('btnSwing').addEventListener('pointerdown', (e) => { e.preventDefault(); primaryAction(); });
  $('btnPower').addEventListener('pointerdown', (e) => { e.preventDefault(); togglePower(); });
  $('btnThrow').addEventListener('pointerdown', (e) => { e.preventDefault(); primaryAction(); });
  $('btnRelief').addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); relief(); });
  $('btnFast').addEventListener('click', () => { S.playSpeed = 3.5; updateControls(); });

  // ---------- menu ----------
  const sel = { my: 0, cpu: 1, side: 0, inn: 3, diff: 'normal' };
  function teamCard(i, which) {
    const t = BB.TEAMS[i];
    const b = document.createElement('button');
    b.className = 'teamCard' + (t.id === 'WLV' ? ' light' : '');
    b.style.setProperty('--c1', t.color);
    b.style.setProperty('--c2', t.color2);
    b.style.setProperty('--cap', t.cap);
    const avg = (k) => Math.round(t.lineup.reduce((a, p) => a + p[k], 0) / 9);
    b.innerHTML = `<div class="cap">${t.id}</div><div class="tn">${t.name}</div><div class="te">${t.en}</div>` +
      `<div class="ts">打 ${BB.rank(avg(3))} 長 ${BB.rank(avg(4))} 走 ${BB.rank(avg(5))} 投 ${BB.rank(t.pitchers[0][3])}</div>`;
    b.addEventListener('click', () => { sel[which] = i; SFX.click(); renderMenu(); });
    return b;
  }
  function renderMenu() {
    audio();
    const my = $('myTeams'), cp = $('cpuTeams');
    my.innerHTML = ''; cp.innerHTML = '';
    if (sel.my === sel.cpu) sel.cpu = (sel.my + 1) % BB.TEAMS.length;
    BB.TEAMS.forEach((t, i) => {
      const a = teamCard(i, 'my'); if (i === sel.my) a.classList.add('on'); my.appendChild(a);
      const b = teamCard(i, 'cpu'); if (i === sel.cpu) b.classList.add('on'); if (i === sel.my) b.classList.add('dis'); cp.appendChild(b);
    });
    try {
      const rec = JSON.parse(localStorage.getItem('ds-record') || 'null');
      if (rec) $('record').textContent = `通算成績 ${rec.w}勝 ${rec.l}敗 ${rec.d}分`;
    } catch (e) { /* storage unavailable */ }
  }
  function segment(id, key, parse) {
    const el = $(id);
    el.querySelectorAll('button').forEach((b) => {
      b.addEventListener('click', () => {
        el.querySelectorAll('button').forEach((x) => x.classList.remove('on'));
        b.classList.add('on');
        sel[key] = parse(b.dataset.v);
        SFX.click();
      });
    });
  }
  segment('optSide', 'side', Number);
  segment('optInn', 'inn', Number);
  segment('optDiff', 'diff', String);
  // first paint of the menu must not create an AudioContext before a gesture
  (function initMenu() {
    const my = $('myTeams'), cp = $('cpuTeams');
    BB.TEAMS.forEach((t, i) => {
      const a = teamCard(i, 'my'); if (i === sel.my) a.classList.add('on'); my.appendChild(a);
      const b = teamCard(i, 'cpu'); if (i === sel.cpu) b.classList.add('on'); if (i === sel.my) b.classList.add('dis'); cp.appendChild(b);
    });
    try {
      const rec = JSON.parse(localStorage.getItem('ds-record') || 'null');
      if (rec) $('record').textContent = `通算成績 ${rec.w}勝 ${rec.l}敗 ${rec.d}分`;
    } catch (e) { /* storage unavailable */ }
  })();

  function launch() {
    const opts = {
      away: sel.side === 0 ? sel.my : sel.cpu,
      home: sel.side === 0 ? sel.cpu : sel.my,
      userSide: sel.side,
      innings: sel.inn,
      diff: sel.diff,
    };
    startGame(opts);
  }
  $('startBtn').addEventListener('click', launch);
  $('againBtn').addEventListener('click', launch);
  $('menuBtn').addEventListener('click', () => {
    S.game = null;
    setPhase('menu');
    $('result').classList.add('hidden');
    $('menu').classList.remove('hidden');
    renderMenu();
  });

  function showResult(title, sub) {
    const g = S.game;
    $('resTitle').textContent = title;
    $('resSub').textContent = sub + `  ${g.teams[0].name} ${g.score[0]} - ${g.score[1]} ${g.teams[1].name}`;
    const n = Math.max(g.innings, g.line[0].length, g.line[1].length);
    let h = '<table class="ls"><tr><th></th>';
    for (let i = 1; i <= n; i++) h += `<th>${i}</th>`;
    h += '<th>R</th><th>H</th></tr>';
    for (let s = 0; s < 2; s++) {
      h += `<tr><td class="tm" style="border-left:4px solid ${g.teams[s].color2}">${g.teams[s].id}</td>`;
      for (let i = 0; i < n; i++) { const v = g.line[s][i]; h += `<td>${v === undefined ? '' : v}</td>`; }
      h += `<td class="r">${g.score[s]}</td><td>${g.hits[s]}</td></tr>`;
    }
    h += '</table>';
    $('resLine').innerHTML = h;
    const t = g.teams[g.userSide];
    let bx = `<table class="box"><tr><th>打順</th><th>守</th><th>選手</th><th>打数</th><th>安打</th><th>本</th><th>打点</th><th>結果</th></tr>`;
    for (const p of t.lineup) {
      const hl = p.st.h >= 2 || p.st.hr > 0 ? ' class="hl"' : '';
      bx += `<tr${hl}><td>${p.order}</td><td>${posJP(p.pos)}</td><td class="nm">${p.name}</td><td>${p.st.ab}</td><td>${p.st.h}</td><td>${p.st.hr}</td><td>${p.st.rbi}</td><td class="lg">${p.st.log.join(' ')}</td></tr>`;
    }
    bx += '</table>';
    $('resBox').innerHTML = bx;
    $('result').classList.remove('hidden');
    updateControls();
  }

  // ---------- main loop ----------
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (S.game && S.phase !== 'over') update(dt);
    else if (S.game) { for (const m of S.msgs) m.t += dt; S.msgs = S.msgs.filter((m) => m.t < m.dur); updateCamera(dt); }
    render();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // debug hook for automated checks
  window.__DS = { S, startGame, BB, update, primaryAction };
})();
