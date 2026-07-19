/* ============================================================
   VALENCE GARAGE. The Laboratory: wind tunnel. js/windlab.js

   A live 2D aerodynamics theater on #lab-canvas. Teal streamlines
   enter from the left, compress and bend over the silhouette of
   the CURRENT machine (drawn by window.CarArt, mirrored so the
   nose faces into the flow), shed gold-flecked turbulence behind
   the tail, and respond to a tunable airspeed. Drag, downforce,
   and drag power update live from window.Physics at that speed,
   using the actual CdA / ClA / mu of the user's build.

   Contracts: one rAF owner, runs ONLY while the Lab screen is
   active and the document is visible; reduced motion renders a
   single static frame; never throws; no console output.

   API (all guarded):
     WindLab.show(cfg)   activate with a build config (or null)
     WindLab.hide()      stop the loop
     WindLab.refresh(cfg) new config while visible
     window.__labProof(steps) deterministic frames + dataURL,
                         for verification on rAF-throttled tabs.
   ============================================================ */
(function () {
  'use strict';

  var RHO = 1.225;
  var TEAL = [44, 150, 170];      // #2C96AA
  var ICE = [159, 232, 240];      // #9FE8F0
  var GOLD = [201, 168, 76];      // #C9A84C
  var CHAMPAGNE = [232, 213, 160];

  var LANES = 26;                 // streamline count
  var TRAIL_ALPHA = 0.16;         // per-frame fade (lower = longer trails)

  var state = {
    canvas: null,
    ctx: null,
    w: 0, h: 0, dpr: 1,
    rafId: 0,
    running: false,
    lastT: 0,
    t: 0,                 // sim clock, seconds
    cfg: null,            // current build config or null
    eng: { CdA: 0.85, ClA: 0.85, mu: 0.95 },
    name: 'Reference Machine',
    speedKmh: 200,
    carImg: null,         // rasterized CarArt silhouette (fallback)
    real: null,           // realistic profile { img, noseLeft } from viewer.js
    carKey: '',
    particles: [],        // one per lane: { x, y, laneY }
    bound: false
  };

  function reduced() {
    try {
      return window.matchMedia &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch (e) { return false; }
  }

  function rgba(c, a) {
    return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')';
  }

  function lerp(a, b, k) { return a + (b - a) * k; }

  // ---- geometry -------------------------------------------------------------
  // The car occupies a centered box. CarArt's viewBox is 400x170 with the
  // ground at y=150 and the nose at the RIGHT; we mirror it so the nose
  // faces INTO the flow (air enters from the left).

  function carBox() {
    var cw = Math.min(state.w * 0.52, 560);
    var ch = cw * (170 / 400);
    var cx = state.w * 0.5 - cw * 0.5;
    var groundY = state.h * 0.72;
    var cy = groundY - ch * (150 / 170);
    return { x: cx, y: cy, w: cw, h: ch, groundY: groundY };
  }

  // Approximate UPPER profile of the mirrored silhouette as a fraction of
  // car height above the ground line, sampled by u in [0,1] nose->tail.
  // Tuned against CarArt's proportions: low nose, canopy crest just behind
  // the midpoint, falling rear deck. The wing (when fitted) raises the tail.
  function profileTop(u, wingLevel) {
    var body;
    if (u < 0.14)      body = lerp(0.18, 0.34, u / 0.14);          // nose rise
    else if (u < 0.42) body = lerp(0.34, 0.62, (u - 0.14) / 0.28); // to canopy
    else if (u < 0.58) body = 0.62;                                 // canopy
    else if (u < 0.86) body = lerp(0.62, 0.40, (u - 0.58) / 0.28); // rear deck
    else               body = lerp(0.40, 0.34, (u - 0.86) / 0.14); // tail
    if (wingLevel > 0 && u > 0.84) {
      var wing = 0.40 + wingLevel * 0.055;
      if (wing > body) body = wing;
    }
    return body;
  }

  // Height of the air ceiling over the car at canvas x, in canvas y.
  function ceilingAt(x, box, wingLevel) {
    if (x < box.x || x > box.x + box.w) return null;
    var u = (x - box.x) / box.w;
    var frac = profileTop(u, wingLevel);
    return box.groundY - frac * box.h * (170 / 150);
  }

  // ---- car raster -----------------------------------------------------------

  function ensureCarImage() {
    var key = state.cfg
      ? [state.cfg.carId, state.cfg.accent, state.cfg.tireIndex,
         state.cfg.wingLevel].join('|')
      : 'none';
    if (key === state.carKey && state.carImg) return;
    state.carKey = key;
    state.carImg = null;
    if (!window.CarArt || !state.cfg) return;
    try {
      var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      window.CarArt.render(svg, state.cfg);
      svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      svg.setAttribute('width', '400');
      svg.setAttribute('height', '170');
      var xml = new XMLSerializer().serializeToString(svg);
      var img = new Image();
      img.onload = function () { state.carImg = img; };
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml);
    } catch (e) { /* silhouette stays absent; flow still tells the story */ }
  }

  // ---- physics --------------------------------------------------------------

  function recomputeForces() {
    var v = state.speedKmh / 3.6;
    var drag = 0.5 * RHO * state.eng.CdA * v * v;
    var down = 0.5 * RHO * state.eng.ClA * v * v;
    var powerKw = drag * v / 1000;

    function put(id, text) {
      var el = document.getElementById(id);
      if (!el) return;
      if (window.VGMotion) window.VGMotion.setNum(el, text);
      else el.textContent = text;
    }
    put('lab-drag-v', String(Math.round(drag)).replace(/\B(?=(\d{3})+(?!\d))/g, ','));
    put('lab-down-v', String(Math.round(down)).replace(/\B(?=(\d{3})+(?!\d))/g, ','));
    put('lab-power-v', String(Math.round(powerKw)));
    var sv = document.getElementById('lab-speed-val');
    if (sv) sv.textContent = state.speedKmh + ' km/h';
  }

  // ---- simulation -----------------------------------------------------------

  function resetParticles() {
    state.particles = [];
    for (var i = 0; i < LANES; i++) {
      var laneY = state.h * (0.06 + 0.88 * (i / (LANES - 1)));
      state.particles.push({
        x: Math.random() * state.w,
        y: laneY,
        laneY: laneY,
        seed: Math.random() * Math.PI * 2
      });
    }
  }

  function stepAndDraw(dt) {
    var ctx = state.ctx;
    if (!ctx) return;
    state.t += dt;

    var box = carBox();
    var wing = state.cfg ? state.cfg.wingLevel : 1;
    var speedK = state.speedKmh / 200;             // 1.0 at reference speed
    var pxPerSec = state.w * (0.16 + 0.5 * speedK);

    // Fade previous frame toward TRANSPARENCY (destination-out), so the
    // Blender-rendered chamber behind the canvas stays visible and the
    // streamline trails float inside it.
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = 'rgba(0, 0, 0, ' + TRAIL_ALPHA + ')';
    ctx.fillRect(0, 0, state.w, state.h);
    ctx.globalCompositeOperation = 'source-over';

    // Ground line.
    ctx.strokeStyle = 'rgba(201, 168, 76, 0.25)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, box.groundY + 1);
    ctx.lineTo(state.w, box.groundY + 1);
    ctx.stroke();

    // The machine: the real render when developed, the sketch until then.
    // The nose must face INTO the flow (left).
    if (state.real && state.real.img) {
      var iw = box.w * 1.3;
      var ih = iw * (420 / 1000);
      var ix = box.x - box.w * 0.15;
      var iy = box.groundY - ih * 0.64;
      ctx.save();
      if (!state.real.noseLeft) {
        ctx.translate(ix + iw * 0.5, 0);
        ctx.scale(-1, 1);
        ctx.translate(-(ix + iw * 0.5), 0);
      }
      try { ctx.filter = 'brightness(1.35)'; } catch (e) { }
      ctx.drawImage(state.real.img, ix, iy, iw, ih);
      try { ctx.filter = 'none'; } catch (e) { }
      ctx.restore();
    } else {
      ensureCarImage();
      if (state.carImg) {
        ctx.save();
        ctx.translate(box.x + box.w, box.y);
        ctx.scale(-1, 1);                     // nose into the wind
        ctx.drawImage(state.carImg, 0, 0, box.w, box.h);
        ctx.restore();
      }
    }

    // Streamlines.
    for (var i = 0; i < state.particles.length; i++) {
      var p = state.particles[i];
      var px = p.x, py = p.y;

      p.x += pxPerSec * dt;

      // Target height: the lane, unless the car's ceiling forces the line up.
      var target = p.laneY;
      var ceil = ceilingAt(p.x, box, wing);
      var gap = 10 + 26 * (1 - Math.min(1, speedK)); // faster air hugs tighter
      if (ceil !== null && p.laneY > ceil - gap) {
        if (p.laneY > box.groundY - 4) {
          target = p.laneY;                    // under-floor lane, straight
        } else {
          target = ceil - gap;
        }
      }

      // Wake turbulence behind the tail: amplitude grows with wing and speed.
      var tailX = box.x + box.w;
      if (p.x > tailX && p.laneY < box.groundY && p.laneY > box.y - 30) {
        var into = Math.min(1, (p.x - tailX) / (state.w - tailX + 1));
        var amp = (2 + wing * 3.2) * speedK * (1 - into * 0.6);
        target += Math.sin(state.t * (3 + wing) + p.seed + p.x * 0.02) * amp;
      }

      // Critically damped approach to target height.
      p.y += (target - p.y) * Math.min(1, dt * 6);

      // Recycle off the right edge.
      if (p.x > state.w + 8) {
        p.x = -8;
        p.y = p.laneY;
        px = p.x; py = p.y;
      }

      // Color: teal body, warming to gold in the compressed and wake zones.
      var compressed = (ceil !== null && Math.abs(p.y - (ceil - gap)) < 14);
      var inWake = p.x > tailX && Math.abs(p.y - p.laneY) > 3;
      var c = compressed ? ICE : (inWake ? GOLD : TEAL);
      var a = compressed ? 0.85 : (inWake ? 0.7 : 0.5);

      ctx.strokeStyle = rgba(c, a);
      ctx.lineWidth = compressed ? 1.6 : 1.1;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
    }

    // Nameplate glow dot pulse (kept in canvas so the plate itself is DOM).
  }

  function tick(now) {
    if (!state.running) return;
    var dt = Math.min(0.05, (now - state.lastT) / 1000) || 0.016;
    state.lastT = now;
    stepAndDraw(dt);
    state.rafId = window.requestAnimationFrame(tick);
  }

  // ---- static frame for reduced motion --------------------------------------

  function drawStatic() {
    var ctx = state.ctx;
    if (!ctx) return;
    ctx.clearRect(0, 0, state.w, state.h);
    // Advance the sim deterministically so full streamline paths exist.
    for (var s = 0; s < 240; s++) stepAndDraw(1 / 60);
  }

  // ---- lifecycle -------------------------------------------------------------

  function size() {
    var c = state.canvas;
    if (!c) return;
    var r = c.getBoundingClientRect();
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    var w = Math.max(2, Math.round(r.width));
    var h = Math.max(2, Math.round(r.height));
    if (c.width !== w * dpr || c.height !== h * dpr) {
      c.width = w * dpr;
      c.height = h * dpr;
      state.ctx = c.getContext('2d');
      state.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    state.w = w;
    state.h = h;
    state.dpr = dpr;
  }

  // ---- machine picker (v11.1) -----------------------------------------------
  // The tunnel tests ANY machine: current build, saved builds, factory stock.

  function readSavedBuilds() {
    try {
      var raw = localStorage.getItem('valence-garage-builds-v1');
      var arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
  }

  function buildRoster(currentCfg) {
    var roster = [];
    if (currentCfg && currentCfg.carId) {
      roster.push({ label: (currentCfg.name || 'Current Build') + ' · yours', cfg: currentCfg });
    }
    readSavedBuilds().forEach(function (b) {
      if (currentCfg && b.id && currentCfg.id === b.id) return;
      roster.push({ label: (b.name || 'Saved Build') + ' · yours', cfg: b });
    });
    (window.CARS || []).forEach(function (c) {
      roster.push({
        label: c.name,
        cfg: {
          name: c.name, carId: c.id,
          powerHp: c.powerHp, weightKg: c.weightKg,
          drivetrain: c.drivetrain, wingLevel: c.wingLevel,
          tireIndex: c.tireIndex, accent: c.accent
        }
      });
    });
    return roster;
  }

  function buildPicker(roster, selIndex) {
    var wrap = document.getElementById('lab-picker-chips');
    if (!wrap) return;
    wrap.innerHTML = '';
    roster.forEach(function (entry, i) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip' + (i === selIndex ? ' active' : '');
      b.textContent = entry.label;
      b.addEventListener('click', function () {
        var kids = wrap.children;
        for (var k = 0; k < kids.length; k++) kids[k].classList.remove('active');
        b.classList.add('active');
        applyCfg(entry.cfg);
      });
      wrap.appendChild(b);
    });
  }

  function bindOnce() {
    if (state.bound) return;
    state.bound = true;
    var slider = document.getElementById('lab-speed');
    if (slider) {
      slider.addEventListener('input', function () {
        state.speedKmh = parseInt(slider.value, 10) || 200;
        recomputeForces();
      });
    }
    window.addEventListener('resize', function () {
      if (state.running) { size(); resetParticles(); }
    });
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) stop();
      else if (isLabActive()) start();
    });
  }

  function isLabActive() {
    var s = document.getElementById('screen-lab');
    return !!(s && s.classList.contains('active'));
  }

  function applyCfg(cfg) {
    state.cfg = cfg || null;
    if (cfg && window.Physics) {
      try {
        var p = window.Physics.compute(cfg);
        state.eng = { CdA: p.eng.CdA, ClA: p.eng.ClA, mu: p.eng.mu };
        state.name = cfg.name || 'The Machine';
      } catch (e) { /* keep reference values */ }
    } else {
      state.eng = { CdA: 0.85, ClA: 0.85, mu: 0.95 };
      state.name = 'Reference Machine';
    }
    var plate = document.getElementById('lab-plate');
    if (plate) plate.textContent = state.name;
    state.carKey = '';       // force re-raster
    // Ask the viewer for the real photograph of this build (async).
    state.real = null;
    if (cfg && window.Viewer && window.Viewer.captureProfileFor) {
      try {
        window.Viewer.captureProfileFor(cfg).then(function (p) {
          if (!p || !p.url) return;
          var img = new Image();
          img.onload = function () {
            state.real = { img: img, noseLeft: !!p.noseLeft };
          };
          img.src = p.url;
        }, function () { });
      } catch (e) { }
    }
    recomputeForces();
  }

  function start() {
    if (state.running) return;
    state.canvas = document.getElementById('lab-canvas');
    if (!state.canvas) return;
    bindOnce();
    size();
    if (!state.particles.length) resetParticles();
    if (reduced()) { drawStatic(); return; }
    state.running = true;
    state.lastT = performance.now();
    state.rafId = window.requestAnimationFrame(tick);
  }

  function stop() {
    state.running = false;
    if (state.rafId) window.cancelAnimationFrame(state.rafId);
    state.rafId = 0;
  }

  // ---- public API -------------------------------------------------------------

  window.WindLab = {
    show: function (cfg) {
      try {
        var roster = buildRoster(cfg);
        buildPicker(roster, 0);
        applyCfg(roster.length ? roster[0].cfg : cfg);
        start();
      } catch (e) { }
    },
    hide: function () {
      try { stop(); } catch (e) { }
    },
    refresh: function (cfg) {
      try { applyCfg(cfg); } catch (e) { }
    }
  };

  // Deterministic proof for rAF-throttled tabs: advance N steps, return png.
  window.__labProof = function (steps) {
    try {
      state.canvas = document.getElementById('lab-canvas');
      if (!state.canvas) return null;
      bindOnce();
      size();
      if (!state.particles.length) resetParticles();
      var n = Math.max(1, steps || 180);
      for (var i = 0; i < n; i++) stepAndDraw(1 / 60);
      return state.canvas.toDataURL('image/png');
    } catch (e) {
      return String(e);
    }
  };
})();
