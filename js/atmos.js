/* ============================================================
   VALENCE GARAGE. Dimensional atmosphere. js/atmos.js (v14)

   One fixed full-viewport canvas gives every tab true DEPTH: a
   hand-rolled 3D perspective projection (no runtime, no three.js
   on non-Build tabs) drives a per-tab particle universe that
   sways with the pointer and crossfades on tab changes.

     garage   constellation dust drifting toward the viewer,
              rare gold shooting streaks
     build    gold embers rising through the atelier air
     lab      teal slipstream rushing laterally in perspective
     duel     center-warp velocity streaks
     clinic   slow instrument motes + expanding pulse rings
     advisor  OFF (the void stays pure black by design)

   Contracts: one rAF owner; pauses when the document hides;
   reduced motion renders a single static frame; DPR capped at
   1.5; particle counts scale with viewport; never throws.
   API: Atmos.set(tabName). Proof: __atmosProof(tab, steps).
   ============================================================ */
(function () {
  'use strict';

  var Z_NEAR = 0.12, Z_FAR = 2.2;

  // fade = base alpha multiplier; deliberately generous so the depth field
  // actually reads on a dark screen. Glow is layered on near particles.
  var CFG = {
    garage: {
      n: 150, spawn: 'volume', vz: -0.05, vx: 0, vy: 0,
      color: [201, 168, 76], alt: [159, 232, 240], altEvery: 4,
      size: 2.2, streaks: true, rings: false, fade: 0.5, glow: true
    },
    build: {
      n: 110, spawn: 'floor', vz: -0.012, vx: 0.004, vy: -0.06,
      color: [232, 213, 160], alt: [201, 168, 76], altEvery: 3,
      size: 2.0, streaks: false, rings: false, fade: 0.45, glow: true
    },
    lab: {
      n: 120, spawn: 'volume', vz: 0, vx: 0.55, vy: 0,
      color: [44, 150, 170], alt: [159, 232, 240], altEvery: 3,
      size: 1.8, streaks: false, rings: false, fade: 0.6, tail: 0.06
    },
    duel: {
      n: 100, spawn: 'volume', vz: -0.5, vx: 0, vy: 0,
      color: [159, 232, 240], alt: [201, 168, 76], altEvery: 5,
      size: 1.6, streaks: false, rings: false, fade: 0.6, tail: 0.14
    },
    clinic: {
      n: 85, spawn: 'volume', vz: -0.015, vx: 0.008, vy: 0.01,
      color: [44, 150, 170], alt: [232, 213, 160], altEvery: 3,
      size: 2.0, streaks: false, rings: true, fade: 0.42, glow: true
    },
    advisor: null
  };

  var state = {
    canvas: null, ctx: null, w: 0, h: 0,
    tab: 'garage', cfg: CFG.garage,
    parts: [], rings: [], streak: null,
    alpha: 0,                 // scene opacity, eases on tab change
    targetAlpha: 1,
    rafId: 0, running: false, lastT: 0, t: 0,
    px: 0, py: 0              // pointer sway
  };

  function reduced() {
    try {
      return window.matchMedia &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch (e) { return false; }
  }

  function rand(a, b) { return a + Math.random() * (b - a); }

  function makePart(cfg, anywhere) {
    var p = {
      x: rand(-1.1, 1.1),
      y: cfg.spawn === 'floor' ? rand(0.5, 1.1) : rand(-1.1, 1.1),
      z: anywhere ? rand(Z_NEAR, Z_FAR) : Z_FAR * rand(0.85, 1),
      seed: Math.random() * Math.PI * 2
    };
    return p;
  }

  function resetParts() {
    state.parts = [];
    state.rings = [];
    state.streak = null;
    if (!state.cfg) return;
    var scale = Math.min(1, state.w / 900);
    var n = Math.round(state.cfg.n * (0.55 + 0.45 * scale));
    for (var i = 0; i < n; i++) state.parts.push(makePart(state.cfg, true));
  }

  function size() {
    var c = state.canvas;
    if (!c) return;
    var dpr = Math.min(1.5, window.devicePixelRatio || 1);
    var w = window.innerWidth, h = window.innerHeight;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
      state.ctx = c.getContext('2d');
      state.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    state.w = w; state.h = h;
  }

  // Perspective projection with gentle pointer sway as camera offset.
  function project(p) {
    var f = state.h * 0.9;
    var camX = state.px * 0.08, camY = state.py * 0.06;
    var sx = state.w * 0.5 + ((p.x - camX) / p.z) * f * 0.5;
    var sy = state.h * 0.5 + ((p.y - camY) / p.z) * f * 0.5;
    return { x: sx, y: sy };
  }

  function step(dt) {
    var ctx = state.ctx, cfg = state.cfg;
    if (!ctx) return;
    state.t += dt;

    // Scene opacity easing (tab crossfade).
    state.alpha += (state.targetAlpha - state.alpha) * Math.min(1, dt * 3);

    ctx.clearRect(0, 0, state.w, state.h);
    if (!cfg || state.alpha < 0.01) return;

    for (var i = 0; i < state.parts.length; i++) {
      var p = state.parts[i];
      var prev = project(p);

      p.z += (cfg.vz || 0) * dt;
      p.x += (cfg.vx || 0) * dt * (0.6 + 0.4 * Math.sin(p.seed));
      p.y += (cfg.vy || 0) * dt +
        Math.sin(state.t * 0.7 + p.seed) * 0.012 * dt;

      // Recycle out-of-range particles.
      if (p.z < Z_NEAR || p.z > Z_FAR ||
          p.x < -1.3 || p.x > 1.3 || p.y < -1.3 || p.y > 1.3) {
        state.parts[i] = makePart(cfg, false);
        // Lateral scenes respawn at the left edge instead of far depth.
        if (cfg.vx > 0.1) {
          state.parts[i].x = -1.25;
          state.parts[i].z = rand(Z_NEAR * 2, Z_FAR);
        }
        if (cfg.vy < -0.02) {           // rising embers respawn low
          state.parts[i].y = 1.15;
          state.parts[i].z = rand(Z_NEAR * 2, Z_FAR);
        }
        continue;
      }

      var q = project(p);
      var depth = 1 - (p.z - Z_NEAR) / (Z_FAR - Z_NEAR);   // 1 near, 0 far
      var col = (i % cfg.altEvery === 0) ? cfg.alt : cfg.color;
      var a = state.alpha * cfg.fade * (0.25 + 0.75 * depth) *
        (0.75 + 0.25 * Math.sin(state.t * 1.3 + p.seed));

      if (cfg.tail) {
        ctx.strokeStyle = 'rgba(' + col[0] + ',' + col[1] + ',' + col[2] +
          ',' + a.toFixed(3) + ')';
        ctx.lineWidth = cfg.size * (0.4 + depth);
        ctx.beginPath();
        ctx.moveTo(prev.x, prev.y);
        var tx = q.x + (q.x - prev.x) * (cfg.tail * 60);
        var ty = q.y + (q.y - prev.y) * (cfg.tail * 60);
        ctx.lineTo(tx, ty);
        ctx.stroke();
      } else {
        var r = cfg.size * (0.4 + 1.3 * depth);
        // Near particles bloom: a soft radial halo sells the depth and
        // makes the field luminous instead of a scatter of flat dots.
        if (cfg.glow && depth > 0.55) {
          var gr = r * 4.5;
          var grad = ctx.createRadialGradient(q.x, q.y, 0, q.x, q.y, gr);
          grad.addColorStop(0, 'rgba(' + col[0] + ',' + col[1] + ',' +
            col[2] + ',' + (a * 0.6).toFixed(3) + ')');
          grad.addColorStop(1, 'rgba(' + col[0] + ',' + col[1] + ',' +
            col[2] + ',0)');
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(q.x, q.y, gr, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = 'rgba(' + col[0] + ',' + col[1] + ',' + col[2] +
          ',' + Math.min(1, a * 1.6).toFixed(3) + ')';
        ctx.beginPath();
        ctx.arc(q.x, q.y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Rare gold shooting streak (garage).
    if (cfg.streaks) {
      if (!state.streak && Math.random() < dt * 0.12) {
        state.streak = {
          x: rand(0.1, 0.9) * state.w, y: rand(0.05, 0.4) * state.h,
          dx: rand(-380, -220), dy: rand(90, 150), life: 1
        };
      }
      var s = state.streak;
      if (s) {
        s.life -= dt * 1.4;
        if (s.life <= 0) state.streak = null;
        else {
          s.x += s.dx * dt; s.y += s.dy * dt;
          var g = ctx.createLinearGradient(s.x, s.y,
            s.x - s.dx * 0.22, s.y - s.dy * 0.22);
          g.addColorStop(0, 'rgba(232,213,160,' + (0.7 * s.life * state.alpha).toFixed(3) + ')');
          g.addColorStop(1, 'rgba(232,213,160,0)');
          ctx.strokeStyle = g;
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.moveTo(s.x, s.y);
          ctx.lineTo(s.x - s.dx * 0.22, s.y - s.dy * 0.22);
          ctx.stroke();
        }
      }
    }

    // Expanding measurement rings (clinic).
    if (cfg.rings) {
      if (Math.random() < dt * 0.25 && state.rings.length < 3) {
        state.rings.push({ x: rand(0.2, 0.8), y: rand(0.2, 0.7), r: 0, life: 1 });
      }
      for (var k = state.rings.length - 1; k >= 0; k--) {
        var ring = state.rings[k];
        ring.r += dt * 90;
        ring.life -= dt * 0.5;
        if (ring.life <= 0) { state.rings.splice(k, 1); continue; }
        ctx.strokeStyle = 'rgba(44,150,170,' +
          (0.22 * ring.life * state.alpha).toFixed(3) + ')';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(ring.x * state.w, ring.y * state.h, ring.r, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }

  function tick(now) {
    if (!state.running) return;
    var dt = Math.min(0.05, (now - state.lastT) / 1000) || 0.016;
    state.lastT = now;
    step(dt);
    state.rafId = window.requestAnimationFrame(tick);
  }

  function start() {
    if (state.running || !state.cfg) return;
    size();
    if (!state.parts.length) resetParts();
    if (reduced()) {
      // One composed static frame: run the sim briefly, draw once.
      for (var i = 0; i < 40; i++) step(1 / 30);
      return;
    }
    state.running = true;
    state.lastT = performance.now();
    state.rafId = window.requestAnimationFrame(tick);
  }

  function stop() {
    state.running = false;
    if (state.rafId) window.cancelAnimationFrame(state.rafId);
    state.rafId = 0;
  }

  function mountOnce() {
    if (state.canvas) return;
    var c = document.createElement('canvas');
    c.id = 'atmos-canvas';
    c.setAttribute('aria-hidden', 'true');
    document.body.appendChild(c);
    state.canvas = c;
    size();
    window.addEventListener('resize', function () { size(); resetParts(); });
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) stop();
      else if (state.cfg) start();
    });
    document.addEventListener('pointermove', function (ev) {
      state.px = ev.clientX / window.innerWidth - 0.5;
      state.py = ev.clientY / window.innerHeight - 0.5;
    }, { passive: true });
  }

  window.Atmos = {
    set: function (tab) {
      try {
        mountOnce();
        state.tab = tab;
        var next = CFG.hasOwnProperty(tab) ? CFG[tab] : null;
        if (next === state.cfg) return;
        state.cfg = next;
        state.targetAlpha = next ? 1 : 0;
        state.alpha = 0;                 // re-bloom into the new universe
        resetParts();
        if (next) start();
        else if (state.ctx) {
          // Advisor: clear and idle.
          stop();
          state.ctx.clearRect(0, 0, state.w, state.h);
        }
      } catch (e) { }
    }
  };

  // Deterministic proof for rAF-throttled tabs.
  window.__atmosProof = function (tab, steps) {
    try {
      mountOnce();
      window.Atmos.set(tab);
      stop();
      state.alpha = 1; state.targetAlpha = 1;
      for (var i = 0; i < (steps || 90); i++) step(1 / 60);
      return state.canvas.toDataURL('image/png');
    } catch (e) {
      return String(e);
    }
  };
})();
