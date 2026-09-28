// DIAMOND SPIRITS — game engine (rules, pitch/bat physics, fielding & baserunning).
// No DOM access: runs in the browser (window.BB) and in Node (module.exports) for headless sims.
(function (root) {
  'use strict';

  // ---------- utils ----------
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  let rng = Math.random;
  const rand = (a, b) => a + (b - a) * rng();
  const chance = (p) => rng() < p;
  function gauss() {
    let u = 0;
    while (u === 0) u = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
  }
  const dist2 = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);

  // ---------- field geometry (metres; x → 1B side, z → centre field, y up) ----------
  const BASE_L = 27.43;
  const S2 = Math.SQRT1_2;
  const BASES = [
    { x: 0, z: 0 },
    { x: BASE_L * S2, z: BASE_L * S2 },
    { x: 0, z: BASE_L * 2 * S2 },
    { x: -BASE_L * S2, z: BASE_L * S2 },
    { x: 0, z: 0 },
  ];
  const MOUND = { x: 0, z: 18.44 };
  const FENCE_H = 4.0;
  const DEG = Math.PI / 180;
  const FOUL_ANGLE = 45 * DEG;

  // Distance from home plate to the outfield wall / stands along angle theta (0 = dead centre).
  function fenceDist(theta) {
    const a = Math.abs(theta);
    if (a <= FOUL_ANGLE) return 100 + 22 * Math.cos(2 * theta);
    const t = clamp((a - FOUL_ANGLE) / (105 * DEG - FOUL_ANGLE), 0, 1);
    const s = Math.sin(t * Math.PI / 2);
    return lerp(100, 20, s);
  }

  // Strike zone at the front of the plate (x across, y height)
  const ZONE = { x0: -0.216, x1: 0.216, y0: 0.47, y1: 1.06 };
  const BALL_R = 0.037;
  function isStrike(x, y) {
    return Math.abs(x) <= ZONE.x1 + BALL_R && y >= ZONE.y0 - BALL_R && y <= ZONE.y1 + BALL_R;
  }

  // ---------- pitches ----------
  // carry: lift that fights gravity (fastball "伸び"), hx/vy: late break (glove side = +hx for a RHP)
  const PITCHES = {
    FB: { name: 'ストレート', spd: 1.0, carry: 0.45, hx: -0.07, vy: 0.0, color: '#ff6b6b' },
    CT: { name: 'カットボール', spd: 0.93, carry: 0.3, hx: 0.16, vy: -0.04, color: '#ffa94d' },
    SL: { name: 'スライダー', spd: 0.87, carry: 0.15, hx: 0.36, vy: -0.08, color: '#ffd43b' },
    CB: { name: 'カーブ', spd: 0.77, carry: 0.0, hx: 0.24, vy: -0.42, color: '#69db7c' },
    FK: { name: 'フォーク', spd: 0.87, carry: 0.15, hx: -0.02, vy: -0.44, color: '#4dabf7' },
    CH: { name: 'チェンジアップ', spd: 0.82, carry: 0.25, hx: -0.2, vy: -0.24, color: '#b197fc' },
    SH: { name: 'シュート', spd: 0.92, carry: 0.3, hx: -0.36, vy: -0.06, color: '#f783ac' },
    SK: { name: 'シンカー', spd: 0.86, carry: 0.15, hx: -0.3, vy: -0.32, color: '#63e6be' },
  };
  const RELEASE_Z = 17.6;

  function pitcherFatigue(p) {
    const f = p.stam / p.stamMax;
    return f < 0.3 ? clamp((0.3 - f) / 0.3, 0, 1) : 0;
  }

  function pitchLevel(pitcher, key) {
    const e = pitcher.pitches.find((q) => q[0] === key);
    return e ? e[1] : 3;
  }

  // Build a pitch. aim = {x,y} at the plate, quality 0..1 (release timing gauge).
  function makePitch(pitcher, key, aim, quality) {
    const P = PITCHES[key];
    const lv = pitchLevel(pitcher, key);
    const lvF = 0.55 + lv * 0.09;
    const hand = pitcher.hand === 'R' ? 1 : -1;
    const ff = pitcherFatigue(pitcher);
    const kmh = pitcher.kmh * P.spd * (0.972 + 0.028 * quality + rand(-0.006, 0.006)) * (1 - 0.045 * ff);
    const v = kmh / 3.6;
    const T = RELEASE_Z / (v * 0.94);
    const sig = (0.022 + (100 - pitcher.control) * 0.0011) * (1.45 - quality * 0.9) * (1 + 0.9 * ff);
    const target = { x: aim.x + gauss() * sig, y: aim.y + gauss() * sig * 0.9 };
    const carry = key === 'FB' ? P.carry * lvF : P.carry;
    const G = -0.5 * 9.8 * T * T + carry;
    const B = { x: P.hx * hand * lvF * 1.35, y: P.vy * lvF * 1.35 };
    const start = { x: -0.45 * hand, y: 1.78, z: RELEASE_Z };
    // how different it looks from this pitcher's fastball (used by CPU batters)
    const fbLv = pitchLevel(pitcher, 'FB');
    const relX = B.x - PITCHES.FB.hx * hand * (0.55 + fbLv * 0.09) * 1.35;
    const relY = B.y + (carry - PITCHES.FB.carry * (0.55 + fbLv * 0.09));
    return {
      key, name: P.name, color: P.color, kmh, T, start, target, G, B, hand,
      breakMag: Math.hypot(relX, relY),
      strike: isStrike(target.x, target.y),
    };
  }

  // Position of the pitch at progress u (0 = release, 1 = crossing the front of the plate)
  function pitchPos(p, u, out) {
    out = out || {};
    const s = p.start, t = p.target;
    if (u <= 1) {
      const c3 = u * u * u - u, c2 = u * u - u;
      out.x = s.x + (t.x - s.x) * u + p.B.x * c3;
      out.y = s.y + (t.y - s.y) * u + p.G * c2 + p.B.y * c3;
      out.z = s.z * (1 - u);
    } else {
      const k = u - 1;
      out.x = t.x + ((t.x - s.x) + 2 * p.B.x) * k;
      out.y = t.y + ((t.y - s.y) + p.G + 2 * p.B.y) * k;
      out.z = -s.z * k;
    }
    return out;
  }

  // ---------- batting ----------
  const SWING_DELAY = 0.14; // seconds from swing input to bat meeting the ball

  function cursorSize(batter, power, mods) {
    let cw = (0.085 + batter.meet * 0.00115) * (mods ? mods.cursor : 1);
    if (power) cw *= 0.7;
    return { w: cw, h: cw * 0.74 };
  }
  function timingWindow(batter, power, mods) {
    return (0.068 + batter.meet * 0.00042) * (mods ? mods.timing : 1) * (power ? 0.86 : 1);
  }

  // e > 0 : bat arrives early (pull side), e < 0 : late. cursor = bat sweet-spot position on plate plane.
  function resolveContact(batter, pitch, cursor, e, power, mods) {
    const cs = cursorSize(batter, power, mods);
    const W = timingWindow(batter, power, mods);
    const bp = pitch.target;
    const nx = (bp.x - cursor.x) / (cs.w + BALL_R);
    const ny = (bp.y - cursor.y) / (cs.h + BALL_R);
    const ne = e / W;
    const r2 = nx * nx + ny * ny;
    if (Math.abs(ne) > 1 || r2 > 1) {
      if (Math.abs(ne) < 1.35 && r2 < 1.7 && chance(0.55)) return { kind: 'foul', tip: true };
      return { kind: 'miss' };
    }
    const bh = batter.hand === 'R' ? 1 : -1;
    const q = clamp(1 - 0.5 * Math.pow(Math.abs(ny), 1.3) - 0.2 * Math.abs(nx) - 0.3 * Math.pow(Math.abs(ne), 1.6), 0.12, 1);
    let la = 11 + ny * 38 + gauss() * 5 + (power ? 4 : 0);
    const base = 26 + batter.power * 0.24;
    const pv = pitch.kmh / 3.6;
    let ev = base * (0.4 + 0.6 * q) * (power ? 1.12 : 1) + (pv - 38) * 0.12 + gauss() * 1.2;
    ev *= 1 - 0.3 * Math.max(0, Math.abs(ny) - 0.6);
    let spray = -bh * ne * 34 + bp.x * 30 + gauss() * 13 - (la < 12 ? bh * 7 : 0);
    if (q < 0.25 && chance(0.5)) return { kind: 'foul', tip: true };
    return { kind: 'hit', ev: Math.max(8, ev), la, spray, q, just: q > 0.9 };
  }

  // ---------- batted ball flight ----------
  const DRAG_K = 0.0038;
  function simBattedBall(start, ev, laDeg, sprayDeg) {
    const la = laDeg * DEG, sp = sprayDeg * DEG;
    let x = start.x, y = start.y, z = start.z;
    let vx = ev * Math.cos(la) * Math.sin(sp);
    let vy = ev * Math.sin(la);
    let vz = ev * Math.cos(la) * Math.cos(sp);
    const dt = 1 / 240;
    const samples = [];
    const info = { firstLandT: null, firstLand: null, hr: false, groundRule: false, maxH: y, dead: false };
    let t = 0, bounced = false, rolling = false, deadT = null, step = 0;
    samples.push({ t, x, y, z, bounced });
    while (t < 14) {
      if (!rolling) {
        const v = Math.hypot(vx, vy, vz);
        vx -= DRAG_K * v * vx * dt;
        vy -= (9.8 + DRAG_K * v * vy) * dt;
        vz -= DRAG_K * v * vz * dt;
      } else {
        const hv = Math.hypot(vx, vz);
        const nv = Math.max(0, hv - 7.5 * dt);
        if (hv > 0) { vx *= nv / hv; vz *= nv / hv; }
      }
      const px = x, pz = z;
      x += vx * dt; y += vy * dt; z += vz * dt;
      t += dt;
      if (y > info.maxH) info.maxH = y;
      // ground
      if (y <= 0 && !rolling) {
        y = 0;
        if (info.firstLandT === null) { info.firstLandT = t; info.firstLand = { x, z }; }
        bounced = true;
        if (vy < -1.6) { vy = -vy * 0.38; vx *= 0.62; vz *= 0.62; }
        else { vy = 0; rolling = true; }
      }
      // wall
      if (!info.hr && !info.groundRule && !info.dead) {
        const r = Math.hypot(x, z);
        const th = Math.atan2(x, z);
        const fd = fenceDist(th);
        if (r >= fd && Math.hypot(px, pz) < fd) {
          const fair = Math.abs(th) <= FOUL_ANGLE;
          const wallH = fair ? FENCE_H : 1.4;
          if (y > wallH) {
            if (fair) { if (bounced) info.groundRule = true; else info.hr = true; }
            else info.dead = true;
            deadT = t;
          } else {
            const nx = x / r, nz = z / r;
            const vr = vx * nx + vz * nz;
            vx -= 1.4 * vr * nx; vz -= 1.4 * vr * nz;
            x = nx * (fd - 0.05); z = nz * (fd - 0.05);
          }
        } else if (r > fd && Math.abs(th) <= FOUL_ANGLE) {
          x *= (fd - 0.05) / r; z *= (fd - 0.05) / r;
          const vr = (vx * x + vz * z) / Math.max(1e-6, Math.hypot(x, z));
          if (vr > 0) { vx -= 1.4 * vr * x / (fd - 0.05); vz -= 1.4 * vr * z / (fd - 0.05); }
        }
      }
      if (++step % 4 === 0) samples.push({ t, x, y, z, bounced });
      if (deadT !== null && t > deadT + 1.2) break;
      if (rolling && Math.hypot(vx, vz) < 0.05) { samples.push({ t, x, y, z, bounced }); break; }
    }
    info.samples = samples;
    info.endT = samples[samples.length - 1].t;
    // fair / foul
    let fair;
    if (info.hr || info.groundRule) fair = true;
    else if (info.dead) fair = false;
    else if (info.firstLand && Math.hypot(info.firstLand.x, info.firstLand.z) > BASE_L + 0.5) {
      fair = Math.abs(Math.atan2(info.firstLand.x, info.firstLand.z)) <= FOUL_ANGLE;
    } else {
      // infield: judged as it passes the bases, or where it stops
      let judged = null;
      for (const s of samples) {
        if (Math.hypot(s.x, s.z) > BASE_L + 0.5) { judged = s; break; }
      }
      if (!judged) judged = samples[samples.length - 1];
      fair = judged.z > 0 && Math.abs(Math.atan2(judged.x, judged.z)) <= FOUL_ANGLE;
    }
    info.fair = fair;
    info.dist = info.firstLand ? Math.hypot(info.firstLand.x, info.firstLand.z) : 0;
    info.ev = ev; info.la = laDeg; info.spray = sprayDeg;
    return info;
  }

  function samplePath(path, t, out) {
    out = out || {};
    const s = path.samples;
    if (t <= 0) { Object.assign(out, s[0]); return out; }
    if (t >= s[s.length - 1].t) { Object.assign(out, s[s.length - 1]); return out; }
    // samples are evenly spaced (1/60 s)
    const dt = s[1].t - s[0].t;
    let i = Math.min(s.length - 2, Math.floor(t / dt));
    while (i > 0 && s[i].t > t) i--;
    while (i < s.length - 2 && s[i + 1].t < t) i++;
    const a = s[i], b = s[i + 1];
    const k = clamp((t - a.t) / (b.t - a.t), 0, 1);
    out.x = lerp(a.x, b.x, k); out.y = lerp(a.y, b.y, k); out.z = lerp(a.z, b.z, k);
    out.bounced = b.bounced && k > 0.5 ? true : a.bounced;
    out.t = t;
    return out;
  }

  // ---------- fielding & baserunning ----------
  const FIELD_POS = [
    { pos: 'P', name: 'ピッチャー', x: 0, z: 18.0, spd: 6.0, react: 0.6, arm: 26, tr: 0.6 },
    { pos: 'C', name: 'キャッチャー', x: 0, z: -1.2, spd: 5.6, react: 0.35, arm: 28, tr: 0.55 },
    { pos: '1B', name: 'ファースト', x: 15.5, z: 26, spd: 6.1, react: 0.2, arm: 26, tr: 0.5 },
    { pos: '2B', name: 'セカンド', x: 8.8, z: 36, spd: 6.6, react: 0.2, arm: 27, tr: 0.5 },
    { pos: '3B', name: 'サード', x: -15.5, z: 26, spd: 6.2, react: 0.2, arm: 29, tr: 0.5 },
    { pos: 'SS', name: 'ショート', x: -8.8, z: 36, spd: 6.7, react: 0.2, arm: 29, tr: 0.5 },
    { pos: 'LF', name: 'レフト', x: -31, z: 85, spd: 8.0, react: 0.25, arm: 29, tr: 0.8 },
    { pos: 'CF', name: 'センター', x: 0, z: 97, spd: 8.3, react: 0.25, arm: 30, tr: 0.8 },
    { pos: 'RF', name: 'ライト', x: 31, z: 85, spd: 8.0, react: 0.25, arm: 31, tr: 0.8 },
  ];
  const FIELDER_ACC = 7.5;
  // time for a fielder to cover d metres from a standstill (accelerating to top speed)
  function runTime(f, d) {
    if (d <= 0) return 0;
    const tA = f.spd / FIELDER_ACC;
    const dA = 0.5 * FIELDER_ACC * tA * tA;
    return d <= dA ? Math.sqrt(2 * d / FIELDER_ACC) : tA + (d - dA) / f.spd;
  }
  const INFIELD = ['P', 'C', '1B', '2B', '3B', 'SS'];

  function runnerSpeed(p) { return 7.0 + p.speed * 0.025; }
  function basePos(s) {
    // s: distance travelled from home along the base paths
    const seg = clamp(Math.floor(s / BASE_L), 0, 3);
    const f = clamp((s - seg * BASE_L) / BASE_L, 0, 1);
    const a = BASES[seg], b = BASES[seg + 1];
    return { x: lerp(a.x, b.x, f), z: lerp(a.z, b.z, f) };
  }

  class Play {
    // bases: [_, runnerOn1, runnerOn2, runnerOn3] (player objects or null)
    constructor(path, batter, bases, outsBefore, contactT0) {
      this.path = path;
      this.t = 0;
      this.outsBefore = outsBefore;
      this.outs = 0;
      this.outList = [];
      this.scored = [];
      this.done = false;
      this.endAt = null;
      this.events = [];
      this.firstFielder = null;
      this.caughtAir = false;
      this.hr = path.hr;
      this.groundRule = path.groundRule;
      this.ball = { x: path.samples[0].x, y: path.samples[0].y, z: path.samples[0].z, mode: 'path', holder: null, thr: null };
      // outfielders play shallower against weak hitters and deeper against sluggers
      const depth = (batter.power - 65) * 0.18;
      this.fielders = FIELD_POS.map((f) => {
        const z = f.z + (f.pos.endsWith('F') ? depth : 0);
        return Object.assign({}, f, { z, hx: f.x, hz: z, tx: f.x, tz: z, v: 0, moving: 0, role: 'idle', decideAt: null, decided: false });
      });
      this.fp = {};
      for (const f of this.fielders) this.fp[f.pos] = f;
      // runners
      this.runners = [];
      const batterR = { player: batter, base: 0, s: 0, target: 1, state: 'run', speed: runnerSpeed(batter), startAt: 0.8, forceBase: 1, isBatter: true };
      this.batterRunner = batterR;
      const occ = [false, !!bases[1], !!bases[2], !!bases[3]];
      for (let b = 3; b >= 1; b--) {
        if (!bases[b]) continue;
        let forced = true;
        for (let k = 1; k < b; k++) if (!occ[k]) forced = false;
        this.runners.push({ player: bases[b], base: b, s: b * BASE_L, target: b, state: 'safe', speed: runnerSpeed(bases[b]), startAt: 0.1, forceBase: forced ? b + 1 : 0, isBatter: false });
      }
      this.runners.push(batterR);

      if (this.hr || this.groundRule) {
        const adv = this.hr ? 4 : 2;
        for (const r of this.runners) {
          r.target = Math.min(4, r.base + adv);
          r.state = 'run';
          r.speed = this.hr ? 6.0 : r.speed;
          r.startAt = r.isBatter ? 0.9 : 0.3;
        }
        this.icpt = null;
        return;
      }

      this.computeIntercept();
      const air = this.icpt && this.icpt.air;
      const firstLand = path.firstLandT === null ? 99 : path.firstLandT;
      this.holdRunners = outsBefore < 2 && !!air;
      for (const r of this.runners) {
        if (r.isBatter) continue;
        if (this.holdRunners) r.state = 'wait';
        else {
          this.decide(r, 0.45, true);
          if (r.state === 'run') r.s += 2.5; // secondary lead
        }
      }
      this.assignCoverage();
    }

    computeIntercept() {
      const s = this.path.samples;
      let best = null;
      for (const f of this.fielders) {
        for (let i = 1; i < s.length; i++) {
          const p = s[i];
          if (p.y > 2.6) continue;
          if (Math.hypot(p.x, p.z) > fenceDist(Math.atan2(p.x, p.z)) - 0.3) continue;
          const d = dist2(p.x, p.z, f.x, f.z);
          const air = !p.bounced && p.y > 0.05;
          const reach = f.pos === 'P' ? 0.6 : air ? 1.2 : 1.4;
          const need = f.react + runTime(f, d - reach);
          if (need <= p.t) {
            if (!best || p.t < best.t) best = { f, t: p.t, x: p.x, z: p.z, air };
            break;
          }
        }
      }
      if (!best) {
        // nobody can reach the path in time: the nearest fielder picks it up where it stops
        const last = s[s.length - 1];
        let f = null, dmin = 1e9;
        for (const q of this.fielders) { const d = dist2(last.x, last.z, q.x, q.z); if (d < dmin) { dmin = d; f = q; } }
        best = { f, t: Math.max(last.t, f.react + runTime(f, dmin)), x: last.x, z: last.z, air: false };
      }
      this.icpt = best;
      best.f.role = 'chase';
      best.f.tx = best.x; best.f.tz = best.z;
      this.firstFielder = best.f;
    }

    assignCoverage() {
      const taken = new Set([this.icpt.f.pos]);
      const want = [
        [1, ['1B', 'P', '2B']],
        [2, this.icpt.x < 0 ? ['2B', 'SS'] : ['SS', '2B']],
        [3, ['3B', 'SS', 'P']],
        [4, ['C', 'P']],
      ];
      this.cover = {};
      for (const [b, list] of want) {
        for (const pos of list) {
          if (taken.has(pos)) continue;
          const f = this.fp[pos];
          taken.add(pos);
          f.role = 'cover' + b;
          const bp = BASES[b];
          // stand just off the bag, on the side the throw comes from
          f.tx = bp.x + (b === 1 ? -0.4 : b === 3 ? 0.4 : 0);
          f.tz = bp.z + (b === 4 ? -0.6 : 0.2);
          this.cover[b] = f;
          break;
        }
      }
      // outfielders back the play up
      for (const pos of ['LF', 'CF', 'RF']) {
        const f = this.fp[pos];
        if (f.role !== 'idle') continue;
        f.role = 'backup';
        f.tx = lerp(f.x, this.icpt.x, 0.45);
        f.tz = lerp(f.z, this.icpt.z, 0.45);
      }
    }

    liveRunners() { return this.runners.filter((r) => r.state !== 'out' && r.state !== 'scored'); }

    runnerETA(r, b) { return (b * BASE_L - r.s) / r.speed + Math.max(0, r.startAt - this.t); }

    throwTime(f, fx, fz, b) {
      const bp = BASES[b];
      const d = dist2(fx, fz, bp.x, bp.z);
      if (d < 4) return d / 6.0;
      return d / f.arm + 0.08;
    }

    ballETA(b) {
      const ball = this.ball, t = this.t, bp = BASES[b];
      if (ball.mode === 'held') {
        const h = ball.holder;
        const wait = h.decideAt !== null && h.decideAt > t ? h.decideAt - t : 0;
        return wait + this.throwTime(h, h.x, h.z, b);
      }
      if (ball.mode === 'throw') {
        const th = ball.thr;
        const rem = Math.max(0, th.t1 - t);
        if (th.base === b) return rem;
        const from = BASES[th.base];
        return rem + 0.35 + dist2(from.x, from.z, bp.x, bp.z) / 30;
      }
      const ic = this.icpt;
      if (!ic) return 99;
      return Math.max(0, ic.t - t) + ic.f.tr + dist2(ic.x, ic.z, bp.x, bp.z) / ic.f.arm + 0.08;
    }

    // Runner standing on (or arriving at) a base decides whether to take the next one.
    decide(r, margin, atContact) {
      if (r.state === 'out' || r.state === 'scored' || r.state === 'run') return;
      const nb = r.base + 1;
      if (nb > 4) return;
      const forced = r.forceBase >= nb;
      // blocked by the runner in front?
      let ahead = null;
      for (const q of this.runners) {
        if (q === r || q.state === 'out' || q.state === 'scored') continue;
        if (q.s > r.s && (!ahead || q.s < ahead.s)) ahead = q;
      }
      if (ahead && !forced && ahead.target <= nb) { r.state = 'safe'; return; }
      if (!forced) {
        const tRun = (nb * BASE_L - r.s) / r.speed + 0.15;
        const tBall = this.ballETA(nb);
        const totalOuts = this.outsBefore + this.outs;
        const m = totalOuts === 2 ? margin * 0.4 : margin;
        if (!(tRun + m < tBall)) { r.state = 'safe'; return; }
      }
      r.target = nb;
      r.state = 'run';
      r.rounded = false;
      r.startAt = Math.max(r.startAt, atContact ? 0.1 : this.t + 0.12);
      this.wakeHolder();
    }

    wakeHolder() {
      const ball = this.ball;
      if (ball.mode === 'held' && ball.holder && ball.holder.decided && this.endAt === null) {
        ball.holder.decided = false;
        ball.holder.decideAt = Math.max(ball.holder.decideAt || 0, this.t + 0.15);
      }
    }

    // A running runner nearing his target base decides whether to round it and keep going.
    tryExtend(r) {
      const nb = r.target + 1;
      if (nb > 4) return;
      for (const q of this.runners) {
        if (q === r || q.state === 'out' || q.state === 'scored') continue;
        if (q.s > r.s && q.target <= nb) return;
      }
      const tRun = (nb * BASE_L - r.s) / r.speed + 0.1;
      const totalOuts = this.outsBefore + this.outs;
      const m = nb === 4 ? (totalOuts === 2 ? -0.25 : 0.0) : nb === 3 ? 0.7 : totalOuts === 2 ? 0.1 : 0.3;
      if (tRun + m < this.ballETA(nb)) {
        r.target = nb;
        r.rounded = false;
        this.wakeHolder();
      }
    }

    reconsiderAll(margin) {
      // lead runners first so that trailing runners see their decisions
      const rs = this.runners.slice().sort((a, b) => b.s - a.s);
      for (const r of rs) if (r.state === 'safe') this.decide(r, margin, false);
    }

    recordOut(r, how) {
      r.state = 'out';
      this.outs++;
      this.outList.push({ r, how, t: this.t, force: r.forceBase > 0 && r.target === r.forceBase });
      if (this.outsBefore + this.outs >= 3) {
        const last = this.outList[this.outList.length - 1];
        // third out on a force (or on the batter before reaching first): no runs count
        if (last.force || (last.r.isBatter && last.r.base === 0)) this.scored = [];
        this.finish(0.9);
      }
    }

    finish(delay) {
      if (this.endAt === null) this.endAt = this.t + delay;
    }

    onCaught() {
      // fly ball / line drive caught before touching the ground
      this.caughtAir = true;
      this.events.push('catch');
      const b = this.batterRunner;
      this.recordOut(b, 'fly');
      if (this.endAt !== null) return;
      for (const r of this.runners) r.forceBase = 0;
      for (const r of this.runners) {
        if (r.state === 'wait') { r.state = 'safe'; }
      }
      // tag up
      const rs = this.runners.slice().sort((a, b2) => b2.s - a.s);
      for (const r of rs) if (r.state === 'safe') this.decide(r, 0.35, false);
    }

    onLanded() {
      this.landed = true;
      const rs = this.runners.slice().sort((a, b) => b.s - a.s);
      for (const r of rs) {
        if (r.state === 'wait') {
          r.state = 'safe';
          this.decide(r, 0.45, false);
        }
      }
    }

    giveBall(f, transfer) {
      const ball = this.ball;
      ball.mode = 'held';
      ball.holder = f;
      ball.thr = null;
      f.decideAt = this.t + transfer;
      f.decided = false;
    }

    chooseThrow(f) {
      f.decided = true;
      const t = this.t;
      let best = null;
      let lead = null;
      for (const r of this.runners) {
        if (r.state !== 'run') continue;
        if (!lead || r.target > lead.target) lead = r;
        const tb = this.throwTime(f, f.x, f.z, r.target);
        const tr = this.runnerETA(r, r.target);
        const need = r.forceBase === r.target ? 0.08 : 0.3;
        if (tb + need < tr && (!best || r.target > best.target)) best = r;
      }
      if (best) return this.throwTo(f, best.target);
      // no out available: throw ahead of the lead runner who is not already scoring
      let hold = null;
      for (const r of this.runners) if (r.state === 'run' && r.target < 4 && (!hold || r.target > hold.target)) hold = r;
      if (hold && hold.target >= 2) {
        const bp = BASES[hold.target];
        if (dist2(f.x, f.z, bp.x, bp.z) > 6) return this.throwTo(f, hold.target);
        return;
      }
      if (lead && Math.hypot(f.x, f.z) < 40) return;
      // nobody running: return the ball to the infield
      if (Math.hypot(f.x, f.z) > 40) {
        const b = f.x < -8 ? 3 : 2;
        this.throwTo(f, b, true);
      }
    }

    throwTo(f, b, isReturn) {
      const bp = BASES[b];
      const d = dist2(f.x, f.z, bp.x, bp.z);
      const T = d < 4 ? d / 6.0 : d / f.arm + 0.08;
      const recv = this.cover[b] || f;
      this.ball.mode = 'throw';
      this.ball.holder = null;
      this.ball.thr = { base: b, x0: f.x, z0: f.z, t0: this.t, t1: this.t + T, recv, run: d < 4, from: f, isReturn: !!isReturn };
      if (d < 4) { f.tx = bp.x; f.tz = bp.z; f.role = 'run'; }
      this.events.push('throw' + b);
      // runners standing on bases may take off while the ball is in the air
      if (!isReturn) this.reconsiderAll(0.55);
    }

    onThrowArrive() {
      const th = this.ball.thr;
      const b = th.base;
      const recv = th.run ? th.from : th.recv;
      const bp = BASES[b];
      recv.x = lerp(recv.x, bp.x, 0.7); recv.z = lerp(recv.z, bp.z, 0.7);
      this.giveBall(recv, 0.45);
      // runner heading here and not yet arrived → out
      let victim = null;
      for (const r of this.runners) {
        if (r.state === 'run' && r.target === b && r.s < b * BASE_L - 0.01) {
          if (!victim || r.s > victim.s) victim = r;
        }
      }
      if (victim) {
        this.recordOut(victim, 'throw');
        this.events.push('out' + b);
      }
      if (th.isReturn) recv.decided = true;
    }

    update(dt) {
      if (this.done) return;
      this.t += dt;
      const t = this.t;
      if (this.endAt !== null && t >= this.endAt) { this.done = true; return; }

      // --- ball ---
      const ball = this.ball;
      if (ball.mode === 'path') {
        samplePath(this.path, t, ball);
        if (this.icpt && t >= this.icpt.t) {
          const f = this.icpt.f;
          f.x = this.icpt.x; f.z = this.icpt.z;
          ball.x = f.x; ball.z = f.z;
          if (this.icpt.air) this.onCaught();
          else if (!this.landed) this.onLanded();
          if (this.endAt === null) {
            this.giveBall(f, f.tr);
            this.reconsiderAll(0.45);
          } else {
            ball.mode = 'held'; ball.holder = f;
          }
        } else if (!this.landed && this.path.firstLandT !== null && t >= this.path.firstLandT && !this.hr) {
          this.onLanded();
        }
      } else if (ball.mode === 'held') {
        const h = ball.holder;
        ball.x = h.x; ball.z = h.z; ball.y = 1.2;
        if (!h.decided && h.decideAt !== null && t >= h.decideAt && this.endAt === null) this.chooseThrow(h);
      } else if (ball.mode === 'throw') {
        const th = ball.thr;
        const k = clamp((t - th.t0) / (th.t1 - th.t0), 0, 1);
        const bp = BASES[th.base];
        ball.x = lerp(th.x0, bp.x, k);
        ball.z = lerp(th.z0, bp.z, k);
        const d = dist2(th.x0, th.z0, bp.x, bp.z);
        ball.y = th.run ? 1.2 : 1.6 + Math.sin(k * Math.PI) * Math.min(6, d * 0.06);
        if (th.run) { th.from.x = ball.x; th.from.z = ball.z; }
        if (t >= th.t1) this.onThrowArrive();
      }

      // --- fielders ---
      for (const f of this.fielders) {
        if (ball.mode === 'held' && ball.holder === f) continue;
        if (ball.mode === 'throw' && ball.thr.run && ball.thr.from === f) continue;
        if (t < f.react) continue;
        const d = dist2(f.x, f.z, f.tx, f.tz);
        const sp = f.role === 'backup' ? f.spd * 0.7 : f.spd;
        if (d > 0.05) {
          f.v = Math.min(sp, f.v + FIELDER_ACC * dt);
          const m = Math.min(d, f.v * dt);
          f.x += ((f.tx - f.x) / d) * m;
          f.z += ((f.tz - f.z) / d) * m;
          f.moving = 1;
        } else { f.moving = 0; f.v = 0; }
      }
      // the chaser keeps closing in on a rolling ball it has not reached yet
      // (purely visual: the intercept time was already decided)

      // --- runners ---
      for (const r of this.runners) {
        if (r.state !== 'run' || t < r.startAt) continue;
        if (!r.rounded && !this.hr && !this.groundRule && this.endAt === null && r.target * BASE_L - r.s < 9) {
          r.rounded = true;
          this.tryExtend(r);
        }
        const goal = r.target * BASE_L;
        r.s = Math.min(goal, r.s + r.speed * dt);
        if (r.s >= goal - 1e-6) {
          r.base = r.target;
          if (r.forceBase && r.forceBase <= r.base) r.forceBase = 0;
          if (r.base >= 4) {
            r.state = 'scored';
            this.scored.push({ r, t });
          } else {
            r.state = 'safe';
            if (!this.hr && !this.groundRule && this.endAt === null) this.decide(r, 0.45, false);
          }
        }
      }

      // --- end of play ---
      if (this.endAt === null) {
        const moving = this.runners.some((r) => r.state === 'run' || r.state === 'wait');
        if (this.hr || this.groundRule) {
          if (!moving) this.finish(this.hr ? 0.6 : 0.8);
        } else if (!moving && ball.mode === 'held' && ball.holder.decided) {
          this.finish(0.7);
        } else if (!moving && ball.mode === 'held' && ball.holder.decideAt !== null && t > ball.holder.decideAt) {
          this.finish(0.7);
        }
        if (t > 30) this.finish(0);
      }
    }

    // --- outcome ---
    result() {
      const bases = [null, null, null, null];
      for (const r of this.runners) {
        if (r.state === 'safe' || r.state === 'run' || r.state === 'wait') {
          const b = r.state === 'run' ? r.base : r.base;
          if (b >= 1 && b <= 3) bases[b] = r.player;
        }
      }
      const b = this.batterRunner;
      const runs = this.scored.length;
      const f = this.firstFielder;
      const posName = f ? f.name : '';
      const area = hitArea(this.path);
      let text, kind, hitBases = 0;
      if (this.hr) {
        hitBases = 4;
        kind = 'HR';
        text = runs === 4 ? '満塁ホームラン！！' : runs === 3 ? 'スリーランホームラン！' : runs === 2 ? 'ツーランホームラン！' : 'ソロホームラン！';
      } else if (this.groundRule) {
        hitBases = 2; kind = 'H';
        text = 'エンタイトルツーベース！';
      } else if (b.state === 'out') {
        kind = 'OUT';
        const dp = this.outs >= 2;
        if (this.caughtAir) {
          const la = this.path.la;
          const inf = f && INFIELD.includes(f.pos);
          let t2 = la < 14 ? 'ライナー' : inf && la > 38 ? 'フライ' : 'フライ';
          if (inf && la > 45) t2 = 'ポップフライ';
          text = posName + t2;
          if (dp) text += ' ダブルプレー！';
          else if (runs > 0) text = '犠牲フライ！（' + posName + '）';
        } else {
          text = posName + 'ゴロ' + (dp ? ' ダブルプレー！' : '');
        }
      } else {
        const reached = b.state === 'scored' ? 4 : b.base;
        const otherOut = this.outList.some((o) => !o.r.isBatter);
        if (otherOut && reached <= 1) {
          kind = 'FC';
          text = posName + 'ゴロ（フィールダースチョイス）';
        } else {
          kind = 'H';
          hitBases = Math.min(3, reached);
          const inf = f && INFIELD.includes(f.pos);
          if (hitBases === 1) text = inf ? '内野安打！' : area.single + '前ヒット！';
          else if (hitBases === 2) text = area.xbh + 'へのツーベース！';
          else text = area.xbh + 'を破るスリーベース！';
          if (reached === 4) text = 'ランニングホームラン！！';
          if (runs > 0 && reached < 4) text = 'タイムリー' + text;
        }
      }
      return { bases, runs, outs: this.outs, kind, text, hitBases, rbi: this.outs >= 2 ? 0 : runs };
    }
  }

  function hitArea(path) {
    const s = path.samples[path.samples.length - 1];
    const p = path.firstLand && Math.hypot(path.firstLand.x, path.firstLand.z) > 35 ? path.firstLand : s;
    const a = Math.atan2(p.x, p.z) / DEG;
    let single = a < -15 ? 'レフト' : a > 15 ? 'ライト' : 'センター';
    let xbh;
    if (a < -36) xbh = 'レフト線';
    else if (a < -12) xbh = '左中間';
    else if (a < 12) xbh = 'センター';
    else if (a < 36) xbh = '右中間';
    else xbh = 'ライト線';
    return { single, xbh };
  }

  // ---------- teams ----------
  const TEAMS = [
    {
      id: 'ALB', name: '帝都アルバトロス', en: 'TEITO ALBATROSS',
      color: '#1d2f7a', color2: '#f2c14e', cap: '#131f52', pants: '#eef0f8',
      lineup: [
        ['早川 翔太', 'CF', 'L', 78, 45, 85, 70], ['中村 誠', '2B', 'R', 72, 40, 70, 75],
        ['高城 蓮', 'SS', 'R', 80, 68, 65, 72], ['岩鬼 大吾', '1B', 'R', 70, 92, 35, 60],
        ['鷹野 陽介', 'RF', 'L', 74, 78, 55, 65], ['桜井 剛', '3B', 'R', 66, 70, 45, 55],
        ['大島 健', 'DH', 'L', 62, 74, 40, 50], ['佐伯 拓海', 'LF', 'R', 64, 50, 72, 58],
        ['石原 悟', 'C', 'R', 55, 45, 30, 52],
      ],
      pitchers: [
        ['神崎 隼人', 'R', 153, 72, 88, [['FB', 6], ['SL', 5], ['FK', 6], ['CB', 3]], '先発'],
        ['水野 亮', 'L', 146, 66, 45, [['FB', 5], ['CB', 5], ['CH', 4]], '中継ぎ'],
        ['藤堂 剛志', 'R', 158, 62, 35, [['FB', 7], ['FK', 6], ['CT', 4]], '抑え'],
      ],
    },
    {
      id: 'LTN', name: '浪速ライトニング', en: 'NANIWA LIGHTNING',
      color: '#17171c', color2: '#ffd400', cap: '#0c0c10', pants: '#f4f1e6',
      lineup: [
        ['赤星 駿', 'SS', 'L', 75, 38, 92, 68], ['松井 一真', 'CF', 'R', 70, 50, 80, 70],
        ['金城 龍之介', '3B', 'R', 82, 75, 55, 74], ['番場 豪', 'LF', 'L', 68, 95, 40, 55],
        ['大河内 力', '1B', 'R', 72, 80, 30, 62], ['堀内 勇気', 'RF', 'R', 68, 62, 60, 60],
        ['秋山 蒼', 'DH', 'L', 70, 55, 50, 66], ['小西 光', '2B', 'R', 60, 35, 78, 56],
        ['西田 修', 'C', 'R', 52, 55, 30, 48],
      ],
      pitchers: [
        ['真田 瑛斗', 'L', 148, 80, 84, [['FB', 5], ['SL', 6], ['CH', 6], ['CB', 4]], '先発'],
        ['荒木 豪太', 'R', 150, 58, 42, [['FB', 6], ['SH', 5], ['SL', 4]], '中継ぎ'],
        ['氷室 聖', 'R', 155, 70, 32, [['FB', 6], ['FK', 7], ['SL', 5]], '抑え'],
      ],
    },
    {
      id: 'WLV', name: '北都スノーウルフ', en: 'HOKUTO SNOWWOLVES',
      color: '#f2f6ff', color2: '#2f6fd0', cap: '#1f4f9e', pants: '#f2f6ff',
      lineup: [
        ['雪村 楓', '2B', 'L', 76, 35, 88, 72], ['白石 亮平', 'SS', 'R', 74, 45, 76, 70],
        ['北条 隼', 'CF', 'L', 84, 70, 78, 78], ['熊谷 岳', '3B', 'R', 70, 90, 38, 64],
        ['氷川 雄大', 'DH', 'R', 66, 85, 35, 58], ['大雪 剛', '1B', 'L', 68, 72, 32, 60],
        ['津軽 海斗', 'RF', 'R', 65, 58, 64, 55], ['函館 迅', 'LF', 'R', 62, 48, 70, 54],
        ['根室 慎也', 'C', 'R', 54, 42, 34, 55],
      ],
      pitchers: [
        ['冬木 零', 'R', 150, 86, 90, [['FB', 5], ['CT', 6], ['CB', 6], ['CH', 5]], '先発'],
        ['霧島 陸', 'R', 147, 62, 45, [['FB', 5], ['SK', 6], ['SL', 4]], '中継ぎ'],
        ['流氷 大和', 'L', 152, 68, 32, [['FB', 6], ['SL', 6], ['FK', 5]], '抑え'],
      ],
    },
    {
      id: 'ORC', name: '博多オルカズ', en: 'HAKATA ORCAS',
      color: '#0d7f86', color2: '#ff7a2f', cap: '#0a5a60', pants: '#f3f7f7',
      lineup: [
        ['海野 快', 'LF', 'R', 74, 42, 90, 66], ['波多野 渚', 'SS', 'L', 72, 40, 74, 72],
        ['潮崎 豪', 'RF', 'L', 80, 82, 58, 70], ['鯨岡 巌', '1B', 'R', 66, 98, 25, 58],
        ['磯部 拓真', '3B', 'R', 74, 76, 48, 66], ['渡 瞬', 'CF', 'L', 70, 52, 84, 62],
        ['浜田 力也', 'DH', 'R', 60, 80, 35, 48], ['大漁 正樹', 'C', 'R', 56, 55, 30, 52],
        ['珊瑚 陽', '2B', 'R', 62, 30, 80, 58],
      ],
      pitchers: [
        ['荒波 剛', 'R', 156, 64, 84, [['FB', 7], ['FK', 5], ['SL', 5]], '先発'],
        ['汐見 薫', 'L', 144, 76, 48, [['FB', 4], ['CB', 6], ['CH', 6]], '中継ぎ'],
        ['渦潮 竜', 'R', 154, 66, 34, [['FB', 6], ['SH', 6], ['FK', 6]], '抑え'],
      ],
    },
  ];

  function buildTeam(def) {
    return {
      id: def.id, name: def.name, en: def.en, color: def.color, color2: def.color2, cap: def.cap, pants: def.pants,
      lineup: def.lineup.map((a, i) => ({
        name: a[0], pos: a[1], hand: a[2], meet: a[3], power: a[4], speed: a[5], eye: a[6], order: i + 1,
        st: { pa: 0, ab: 0, h: 0, hr: 0, rbi: 0, bb: 0, so: 0, log: [] },
      })),
      pitchers: def.pitchers.map((a) => ({
        name: a[0], hand: a[1], kmh: a[2], control: a[3], stamina: a[4], pitches: a[5], role: a[6],
        stamMax: a[4] * 1.25, stam: a[4] * 1.25, count: 0, used: false, runs: 0, so: 0,
      })),
      curP: 0,
    };
  }

  // ---------- game state ----------
  function newGame(opts) {
    const teams = [buildTeam(TEAMS[opts.away]), buildTeam(TEAMS[opts.home])];
    teams[0].pitchers[0].used = true;
    teams[1].pitchers[0].used = true;
    return {
      teams, innings: opts.innings, maxInnings: opts.innings + (opts.innings >= 9 ? 3 : 2),
      inning: 1, top: true, outs: 0, balls: 0, strikes: 0,
      bases: [null, null, null, null], score: [0, 0], hits: [0, 0],
      line: [[], []], bIdx: [0, 0], userSide: opts.userSide, over: false, halfEnded: false, winner: null,
    };
  }
  const batSide = (g) => (g.top ? 0 : 1);
  const fieldSide = (g) => (g.top ? 1 : 0);
  const curBatter = (g) => g.teams[batSide(g)].lineup[g.bIdx[batSide(g)] % 9];
  const curPitcher = (g) => { const t = g.teams[fieldSide(g)]; return t.pitchers[t.curP]; };

  function addRuns(g, n) {
    if (!n) return;
    const s = batSide(g);
    g.score[s] += n;
    const L = g.line[s];
    L[g.inning - 1] = (L[g.inning - 1] || 0) + n;
    curPitcher(g).runs += n;
  }

  function checkWalkOff(g) {
    if (!g.top && g.inning >= g.innings && g.score[1] > g.score[0]) {
      g.over = true; g.winner = 1; g.walkoff = true;
      return true;
    }
    return false;
  }

  function endHalf(g) {
    const s = batSide(g);
    if (g.line[s][g.inning - 1] === undefined) g.line[s][g.inning - 1] = 0;
    g.halfEnded = true;
    if (g.top) {
      if (g.inning >= g.innings && g.score[1] > g.score[0]) {
        g.over = true; g.winner = 1;
        g.line[1][g.inning - 1] = 'X';
        return;
      }
      g.top = false;
    } else {
      if (g.inning >= g.innings && g.score[0] !== g.score[1]) { g.over = true; g.winner = g.score[0] > g.score[1] ? 0 : 1; return; }
      if (g.inning >= g.maxInnings) { g.over = true; g.winner = -1; return; }
      g.top = true;
      g.inning++;
    }
    g.outs = 0; g.balls = 0; g.strikes = 0;
    g.bases = [null, null, null, null];
  }

  function endPA(g) {
    g.bIdx[batSide(g)]++;
    g.balls = 0; g.strikes = 0;
  }

  function addOut(g, n) {
    g.outs += n || 1;
    if (g.outs >= 3) endHalf(g);
  }

  function tirePitcher(g) {
    const p = curPitcher(g);
    p.count++;
    p.stam = Math.max(0, p.stam - 1 - (g.bases[2] || g.bases[3] ? 0.4 : 0));
  }

  // kind: 'ball' | 'strike' (looking) | 'swing' (miss) | 'foul'
  function applyPitch(g, kind) {
    tirePitcher(g);
    const b = curBatter(g);
    if (kind === 'ball') {
      g.balls++;
      if (g.balls >= 4) {
        // walk: force runners
        b.st.pa++; b.st.bb++; b.st.log.push('四球');
        let runs = 0;
        if (g.bases[1]) {
          if (g.bases[2]) {
            if (g.bases[3]) runs = 1;
            g.bases[3] = g.bases[2];
          }
          g.bases[2] = g.bases[1];
        }
        g.bases[1] = b;
        b.st.rbi += runs;
        addRuns(g, runs);
        endPA(g);
        checkWalkOff(g);
        return { event: 'walk', runs };
      }
      return { event: null };
    }
    if (kind === 'foul') {
      if (g.strikes < 2) g.strikes++;
      return { event: null };
    }
    g.strikes++;
    if (g.strikes >= 3) {
      b.st.pa++; b.st.ab++; b.st.so++; b.st.log.push('三振');
      curPitcher(g).so++;
      endPA(g);
      addOut(g, 1);
      return { event: 'strikeout', looking: kind === 'strike' };
    }
    return { event: null };
  }

  function applyPlay(g, play) {
    tirePitcher(g);
    const res = play.result();
    const b = curBatter(g);
    b.st.pa++;
    const sacFly = res.kind === 'OUT' && play.caughtAir && res.runs > 0 && res.outs === 1;
    if (!sacFly) b.st.ab++;
    if (res.kind === 'H' || res.kind === 'HR') {
      b.st.h++;
      g.hits[batSide(g)]++;
      if (res.kind === 'HR') b.st.hr++;
      b.st.log.push(['', '単打', '二塁打', '三塁打', '本塁打'][res.hitBases]);
    } else {
      b.st.log.push(res.kind === 'FC' ? '野選' : sacFly ? '犠飛' : play.caughtAir ? '飛' : 'ゴ');
    }
    b.st.rbi += res.rbi;
    const totalOuts = g.outs + res.outs;
    addRuns(g, res.runs);
    endPA(g);
    if (totalOuts >= 3) {
      g.outs = 3;
      if (checkWalkOff(g)) return res;
      endHalf(g);
    } else {
      g.outs = totalOuts;
      g.bases = res.bases;
      checkWalkOff(g);
    }
    return res;
  }

  // ---------- CPU AI ----------
  function cpuChoosePitch(g, pitcher) {
    const reps = pitcher.pitches;
    const { balls, strikes } = g;
    const weights = reps.map(([k, lv]) => {
      if (k === 'FB') return 1.1 * (balls >= 2 && balls > strikes ? 1.7 : 1);
      return (0.3 + lv * 0.07) * (strikes === 2 ? 1.5 : 1) * (balls === 3 ? 0.5 : 1);
    });
    let tot = weights.reduce((a, b) => a + b, 0), r = rng() * tot, key = reps[0][0];
    for (let i = 0; i < reps.length; i++) { r -= weights[i]; if (r <= 0) { key = reps[i][0]; break; } }
    let pZone = clamp(0.46 + balls * 0.12 - strikes * 0.12, 0.22, 0.88);
    const low = key === 'FK' || key === 'SK' || key === 'CH' || key === 'CB';
    let x, y;
    if (chance(pZone)) {
      const edge = () => Math.sign(rand(-1, 1)) * Math.pow(rng(), 0.6);
      x = edge() * 0.19;
      y = low ? rand(0.5, 0.78) : 0.76 + edge() * 0.26;
    } else {
      const side = rng();
      if (low && side < 0.55) { x = rand(-0.2, 0.2); y = rand(0.2, 0.42); }
      else if (side < 0.8) { x = (chance(0.5) ? 1 : -1) * rand(0.28, 0.42); y = rand(0.45, 1.0); }
      else { x = rand(-0.2, 0.2); y = rand(1.12, 1.3); }
    }
    return { key, aim: { x, y }, quality: clamp(0.35 + pitcher.control / 150 + rand(-0.2, 0.2), 0, 1) };
  }

  // CPU batter reaction to a pitch. Returns null (take) or {e, cursor, power}
  function cpuBatterSwing(g, batter, pitch, pitcher, skill) {
    const eye = batter.eye / 100;
    const plate = pitch.target;
    const perr = (0.05 + pitch.breakMag * 0.2) * (1.3 - eye * 0.6) / skill;
    const px = plate.x + gauss() * perr, py = plate.y + gauss() * perr;
    const looksStrike = isStrike(px, py);
    const { balls, strikes } = g;
    let p;
    if (looksStrike) p = strikes === 2 ? 0.9 : 0.7;
    else p = strikes === 2 ? 0.26 : 0.1;
    if (balls === 3 && strikes === 0) p *= 0.35;
    if (!chance(p)) return null;
    const power = (batter.power >= 75 && strikes < 2 && chance(0.5)) || (batter.power >= 88 && chance(0.25));
    const fbKmh = pitcher.kmh;
    const bias = (1 - pitch.kmh / fbKmh) * 0.2 * (1.15 - eye * 0.4);
    const sigT = (0.05 + pitch.breakMag * 0.05 + Math.max(0, pitch.kmh - 140) * 0.001) * (1.18 - batter.meet / 250) / skill;
    const e = bias + gauss() * sigT;
    const cerr = (0.078 + pitch.breakMag * 0.17) * (1.2 - batter.meet / 200) / skill;
    const cursor = { x: plate.x + gauss() * cerr, y: plate.y + gauss() * cerr * 0.9 };
    return { e, cursor, power };
  }

  // Swap in the next reliever when the CPU pitcher is tired or it is closing time.
  function cpuManage(g, side) {
    const t = g.teams[side];
    const p = t.pitchers[t.curP];
    const leading = g.score[side] > g.score[1 - side];
    const closer = t.pitchers.findIndex((q) => q.role === '抑え');
    if (closer >= 0 && !t.pitchers[closer].used && t.curP !== closer && leading && g.inning >= g.innings && g.score[side] - g.score[1 - side] <= 3) {
      return changePitcher(g, side, closer);
    }
    if (p.stam / p.stamMax < 0.12 || p.runs >= 6) {
      const next = t.pitchers.findIndex((q, i) => !q.used && i !== closer);
      const idx = next >= 0 ? next : !t.pitchers[closer].used ? closer : -1;
      if (idx >= 0) return changePitcher(g, side, idx);
    }
    return null;
  }

  function changePitcher(g, side, idx) {
    const t = g.teams[side];
    if (idx === undefined) {
      idx = t.pitchers.findIndex((q) => !q.used);
      if (idx < 0) return null;
    }
    t.curP = idx;
    t.pitchers[idx].used = true;
    return t.pitchers[idx];
  }

  function rank(v) {
    return v >= 90 ? 'S' : v >= 80 ? 'A' : v >= 70 ? 'B' : v >= 60 ? 'C' : v >= 50 ? 'D' : v >= 40 ? 'E' : v >= 20 ? 'F' : 'G';
  }

  const BB = {
    clamp, lerp, rand, chance, gauss, setRandom: (f) => { rng = f; },
    BASE_L, BASES, MOUND, FENCE_H, DEG, FOUL_ANGLE, fenceDist, ZONE, BALL_R, isStrike,
    PITCHES, RELEASE_Z, makePitch, pitchPos, pitcherFatigue,
    SWING_DELAY, cursorSize, timingWindow, resolveContact, simBattedBall, samplePath,
    FIELD_POS, INFIELD, Play, basePos, TEAMS,
    newGame, batSide, fieldSide, curBatter, curPitcher, applyPitch, applyPlay, addOut, endPA,
    cpuChoosePitch, cpuBatterSwing, cpuManage, changePitcher, rank,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = BB;
  else root.BB = BB;
})(typeof window !== 'undefined' ? window : this);
