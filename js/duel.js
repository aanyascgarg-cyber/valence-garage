/* ============================================================
   VALENCE GARAGE. The base of the pizza. js/duel.js (v11)

   THE PROVING GROUND: pick ANY two machines and settle it over
   the quarter mile with the exact physics module that drives the
   configurator. Both corners are free choices: your current
   build, any saved build, or any factory-stock reference, so
   custom vs its own factory twin, custom vs custom, and stock vs
   stock are all one tap. A spec sheet under the strip shows both
   cars side by side and lights up exactly what differs (the wing
   you added, the weight you stripped). Runs can be aborted.

   The machines are REAL renders: viewer.js photographs each
   build's actual GLB (painted its color, wearing its wing) from
   a long-lens side camera; the stylized silhouette is only the
   placeholder while that photograph develops.

   Contracts: one rAF owner, active only while on stage, reduced
   motion computes instantly, never throws, no console noise.

   API: Duel.show(currentCfg), Duel.hide().
   Proof: window.__duelProof(simSeconds) -> dataURL.
   ============================================================ */
(function () {
  'use strict';

  var QUARTER_M = 402.34;
  var MPH_60 = 26.82;

  var GOLD = '#C9A84C';
  var CHAMPAGNE = '#E8D5A0';
  var TEAL = '#2C96AA';
  var ICE = '#9FE8F0';

  var TIRE_NAMES = ['Touring', 'Sport', 'Cup', 'Slick'];
  var WING_NAMES = ['None', 'Low', 'Mid', 'High', 'Max'];

  var state = {
    canvas: null, ctx: null, w: 0, h: 0,
    rafId: 0, running: false, lastT: 0,
    phase: 'idle',          // idle | armed | running | slowmo | done
    clock: 0,
    slowUntil: 0,
    timescale: 1,
    you: null, foe: null,
    roster: [],             // [{ label, cfg, kind }]
    youIndex: 0,
    foeIndex: 0,
    bound: false
  };

  function reduced() {
    try {
      return window.matchMedia &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch (e) { return false; }
  }

  // ---- roster -----------------------------------------------------------------

  function readSavedBuilds() {
    try {
      var raw = localStorage.getItem('valence-garage-builds-v1');
      var arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
  }

  function factoryCfg(c) {
    return {
      name: 'Factory ' + c.name, carId: c.id, factory: true,
      powerHp: c.powerHp, weightKg: c.weightKg,
      drivetrain: c.drivetrain, wingLevel: c.wingLevel,
      tireIndex: c.tireIndex, accent: c.accent
    };
  }

  function buildRoster(currentCfg) {
    var roster = [];
    if (currentCfg && currentCfg.carId) {
      roster.push({
        label: (currentCfg.name || 'Current Build') + ' · yours',
        cfg: currentCfg, kind: 'current'
      });
    }
    readSavedBuilds().forEach(function (b) {
      if (currentCfg && b.id && currentCfg.id === b.id) return;
      roster.push({ label: (b.name || 'Saved Build') + ' · yours', cfg: b, kind: 'saved' });
    });
    (window.CARS || []).forEach(function (c) {
      roster.push({ label: 'Factory ' + c.name, cfg: factoryCfg(c), kind: 'factory' });
    });
    return roster;
  }

  // Index of the factory twin (same carId) of a config, or -1.
  function factoryTwinIndex(cfg) {
    for (var i = 0; i < state.roster.length; i++) {
      var e = state.roster[i];
      if (e.kind === 'factory' && e.cfg.carId === cfg.carId) return i;
    }
    return -1;
  }

  // ---- racer ------------------------------------------------------------------

  function makeRacer(cfg, lane) {
    var P = window.Physics;
    var eng = { CdA: 0.85, ClA: 0.85, mu: 0.95, kDrive: 1 };
    try { eng = P.compute(cfg).eng; } catch (e) { }
    var r = {
      cfg: cfg,
      lane: lane,
      name: cfg.name || 'The Machine',
      m: cfg.weightKg,
      Pw: P.ETA * cfg.powerHp * P.HP_TO_W,
      Frr: P.CRR * cfg.weightKg * P.G,
      eng: eng,
      v: 0.5, x: 0, t: 0,
      t60: null, et: null, trap: null,
      finished: false,
      img: null,           // CarArt fallback raster
      real: null,          // realistic profile { img, noseLeft }
      imgKey: ''
    };
    requestRealProfile(r);
    return r;
  }

  function stepRacer(r, dt) {
    if (r.finished) { r.x += r.v * dt * 0.4; return; }
    var P = window.Physics;
    var Fdown = 0.5 * P.RHO * r.eng.ClA * r.v * r.v;
    var Fdrag = 0.5 * P.RHO * r.eng.CdA * r.v * r.v;
    var aTr = r.eng.mu * r.eng.kDrive * (r.m * P.G + Fdown) / r.m;
    var aPw = (r.Pw / Math.max(r.v, 3) - Fdrag - r.Frr) / r.m;
    var a = aTr < aPw ? aTr : aPw;
    if (a < 0) a = 0;
    r.v += a * dt;
    r.x += r.v * dt;
    r.t += dt;
    if (r.t60 === null && r.v >= MPH_60) r.t60 = r.t + P.T_LAUNCH;
    if (r.x >= QUARTER_M) {
      r.finished = true;
      r.et = r.t + P.T_LAUNCH;
      r.trap = r.v * 3.6;
    }
  }

  // ---- imagery ------------------------------------------------------------------

  var imgCache = {};       // CarArt fallback rasters, key -> Image
  var realCache = {};      // decoded real profiles, key -> { img, noseLeft }

  function profileKey(cfg) {
    return [cfg.carId, cfg.accent, cfg.wingLevel].join('|');
  }

  function requestRealProfile(r) {
    var key = profileKey(r.cfg);
    var hit = realCache[key];
    if (hit) { r.real = hit; return; }
    if (!window.Viewer || !window.Viewer.captureProfileFor) return;
    try {
      window.Viewer.captureProfileFor(r.cfg).then(function (p) {
        if (!p || !p.url) return;
        var img = new Image();
        img.onload = function () {
          var entry = { img: img, noseLeft: !!p.noseLeft };
          realCache[key] = entry;
          r.real = entry;
        };
        img.src = p.url;
      }, function () { });
    } catch (e) { }
  }

  function ensureRacerImage(r) {
    var key = [r.cfg.carId, r.cfg.accent, r.cfg.tireIndex, r.cfg.wingLevel].join('|');
    var hit = imgCache[key];
    if (hit && hit.complete) { r.img = hit; return; }
    if (hit) return;
    if (!window.CarArt) return;
    try {
      var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      window.CarArt.render(svg, r.cfg);
      svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      svg.setAttribute('width', '400');
      svg.setAttribute('height', '170');
      var xml = new XMLSerializer().serializeToString(svg);
      var img = new Image();
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml);
      imgCache[key] = img;
    } catch (e) { }
  }

  // Draw one machine, preferring the real render, nose pointing RIGHT.
  function drawMachine(ctx, r, noseX, groundY, carW) {
    if (r.real && r.real.img) {
      var iw = carW * 1.4;
      var ih = iw * (420 / 1000);
      var x = noseX - iw + carW * 0.1;
      var y = groundY - ih * 0.64;
      // Stage glow so dark paint reads against the night strip.
      var g = ctx.createRadialGradient(
        x + iw * 0.5, groundY, 4, x + iw * 0.5, groundY, iw * 0.55);
      g.addColorStop(0, 'rgba(44,150,170,0.16)');
      g.addColorStop(1, 'rgba(44,150,170,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - iw * 0.2, groundY - ih, iw * 1.4, ih * 1.1);
      ctx.save();
      if (r.real.noseLeft) {
        ctx.translate(x + iw * 0.5, 0);
        ctx.scale(-1, 1);
        ctx.translate(-(x + iw * 0.5), 0);
      }
      try { ctx.filter = 'brightness(1.4) contrast(1.04)'; } catch (e) { }
      ctx.drawImage(r.real.img, x, y, iw, ih);
      try { ctx.filter = 'none'; } catch (e) { }
      ctx.restore();
      return;
    }
    ensureRacerImage(r);
    var carH = carW * (170 / 400);
    if (r.img) {
      ctx.drawImage(r.img, noseX - carW, groundY - carH * (150 / 170), carW, carH);
    } else {
      ctx.fillStyle = 'rgba(201,168,76,0.5)';
      ctx.fillRect(noseX - carW, groundY - 12, carW, 10);
    }
  }

  // ---- drawing -------------------------------------------------------------------

  function laneGroundY(lane) {
    return state.h * (lane === 0 ? 0.44 : 0.86);
  }

  function draw() {
    var ctx = state.ctx;
    if (!ctx) return;
    var w = state.w, h = state.h;

    ctx.fillStyle = '#04080B';
    ctx.fillRect(0, 0, w, h);

    var lead = Math.max(state.you.x, state.foe.x);
    var pxPerM = w / 74;
    var camX = Math.max(-8, lead - (w * 0.58) / pxPerM);
    function sx(worldX) { return (worldX - camX) * pxPerM; }

    var carW = 4.55 * pxPerM * 1.9;
    var carH = carW * (170 / 400);

    for (var lane = 0; lane < 2; lane++) {
      var r = lane === 0 ? state.you : state.foe;
      var gy = laneGroundY(lane);

      ctx.strokeStyle = 'rgba(201,168,76,0.3)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, gy);
      ctx.lineTo(w, gy);
      ctx.stroke();

      ctx.fillStyle = 'rgba(159,232,240,0.35)';
      ctx.font = '9px Montserrat, sans-serif';
      ctx.textAlign = 'center';
      for (var m25 = 0; m25 <= 425; m25 += 25) {
        var tx = sx(m25);
        if (tx < -20 || tx > w + 20) continue;
        ctx.fillRect(tx, gy - (m25 % 100 === 0 ? 7 : 4), 1, m25 % 100 === 0 ? 7 : 4);
        if (m25 % 100 === 0 && lane === 1) {
          ctx.fillText(String(m25), tx, gy + 14);
        }
      }

      var fx = sx(QUARTER_M);
      if (fx > -30 && fx < w + 30) {
        ctx.fillStyle = 'rgba(232,213,160,0.9)';
        ctx.fillRect(fx, gy - carH * 1.5, 2, carH * 1.5);
        ctx.font = '10px Montserrat, sans-serif';
        ctx.fillStyle = CHAMPAGNE;
        ctx.fillText('1/4', fx, gy - carH * 1.5 - 6);
      }

      if (r.v > 40) {
        var n = Math.min(10, Math.floor(r.v / 14));
        ctx.strokeStyle = 'rgba(44,150,170,0.32)';
        ctx.lineWidth = 1;
        for (var s = 0; s < n; s++) {
          var ly = gy - carH * (0.15 + 0.7 * ((s * 37 % 100) / 100));
          var lx = sx(r.x) - carW - ((s * 53 + state.clock * 900) % (w * 0.5));
          ctx.beginPath();
          ctx.moveTo(lx, ly);
          ctx.lineTo(lx - 26 - r.v * 0.2, ly);
          ctx.stroke();
        }
      }

      drawMachine(ctx, r, sx(r.x), gy, carW);

      ctx.textAlign = 'left';
      ctx.font = '600 10px Montserrat, sans-serif';
      ctx.fillStyle = 'rgba(232,213,160,0.85)';
      ctx.fillText(r.name.toUpperCase(), 14, lane === 0 ? 20 : h * 0.54);
      ctx.font = '700 20px Montserrat, sans-serif';
      ctx.fillStyle = r.finished ? GOLD : ICE;
      ctx.fillText(Math.round(r.v * 3.6) + ' km/h',
        14, (lane === 0 ? 20 : h * 0.54) + 24);
      ctx.font = '10px Montserrat, sans-serif';
      ctx.fillStyle = 'rgba(159,232,240,0.6)';
      ctx.fillText(Math.min(QUARTER_M, r.x).toFixed(0) + ' m',
        14, (lane === 0 ? 20 : h * 0.54) + 40);
    }

    if (state.phase === 'armed') {
      var cx = w * 0.5;
      var lights = 3 + Math.floor(state.clock / 0.5);
      for (var Li = 0; Li < 3; Li++) {
        ctx.beginPath();
        ctx.arc(cx + (Li - 1) * 34, h * 0.12, 9, 0, Math.PI * 2);
        ctx.fillStyle = Li < lights
          ? 'rgba(201,168,76,0.95)' : 'rgba(201,168,76,0.15)';
        ctx.fill();
      }
      ctx.textAlign = 'center';
      ctx.font = '600 10px Montserrat, sans-serif';
      ctx.fillStyle = 'rgba(232,213,160,0.7)';
      ctx.fillText('STAGED', cx, h * 0.12 + 32);
    }
    if (state.phase === 'running' && state.clock < 0.9) {
      ctx.beginPath();
      ctx.arc(w * 0.5, h * 0.12, 11, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(120,220,140,0.95)';
      ctx.fill();
    }

    if (state.phase === 'slowmo') {
      ctx.fillStyle = 'rgba(0,0,0,0.75)';
      ctx.fillRect(0, 0, w, h * 0.07);
      ctx.fillRect(0, h * 0.93, w, h * 0.07);
      ctx.textAlign = 'center';
      ctx.font = '600 10px Montserrat, sans-serif';
      ctx.fillStyle = CHAMPAGNE;
      ctx.fillText('THE MOMENT', w * 0.5, h * 0.05 + 4);
    }
  }

  // ---- race control ------------------------------------------------------------------

  function reflectRunButton() {
    var btn = document.getElementById('btn-duel');
    if (!btn) return;
    var live = state.phase === 'armed' || state.phase === 'running' ||
      state.phase === 'slowmo';
    btn.textContent = live ? 'Abort Run' : 'Run the Quarter Mile';
    btn.classList.toggle('abort', live);
  }

  function resetRace() {
    var youE = state.roster[state.youIndex];
    var foeE = state.roster[state.foeIndex];
    if (!youE || !foeE) return;
    state.you = makeRacer(youE.cfg, 0);
    state.foe = makeRacer(foeE.cfg, 1);
    state.phase = 'idle';
    state.clock = 0;
    state.timescale = 1;
    hideResults();
    reflectRunButton();
    renderSpecs();
    draw();
  }

  function arm() {
    if (state.phase === 'armed' || state.phase === 'running' ||
        state.phase === 'slowmo') {
      // Second press = abort.
      resetRace();
      return;
    }
    resetRace();
    state.phase = 'armed';
    state.clock = -1.5;
    reflectRunButton();
    if (reduced()) {
      var guard = 0;
      while ((!state.you.finished || !state.foe.finished) && guard++ < 60000) {
        stepRacer(state.you, 1 / 120);
        stepRacer(state.foe, 1 / 120);
      }
      state.phase = 'done';
      reflectRunButton();
      draw();
      showResults();
    }
  }

  function advance(dt) {
    state.clock += dt;

    if (state.phase === 'armed') {
      if (state.clock >= 0) { state.phase = 'running'; reflectRunButton(); }
      return;
    }
    if (state.phase !== 'running' && state.phase !== 'slowmo') return;

    var sim = dt * state.timescale;
    stepRacer(state.you, sim);
    stepRacer(state.foe, sim);

    var oneDone = state.you.finished || state.foe.finished;
    var bothDone = state.you.finished && state.foe.finished;

    if (state.phase === 'running' && oneDone) {
      state.phase = 'slowmo';
      state.timescale = 0.22;
      state.slowUntil = state.clock + 1.4;
    }
    if (state.phase === 'slowmo' && (bothDone || state.clock >= state.slowUntil)) {
      var guard = 0;
      while ((!state.you.finished || !state.foe.finished) && guard++ < 60000) {
        stepRacer(state.you, 1 / 120);
        stepRacer(state.foe, 1 / 120);
      }
      state.phase = 'done';
      state.timescale = 1;
      reflectRunButton();
      showResults();
    }
  }

  function tick(now) {
    if (!state.running) return;
    var dt = Math.min(0.05, (now - state.lastT) / 1000) || 0.016;
    state.lastT = now;
    advance(dt);
    draw();
    state.rafId = window.requestAnimationFrame(tick);
  }

  // ---- results -----------------------------------------------------------------------

  function fmt(n, d) {
    return (Math.round(n * Math.pow(10, d)) / Math.pow(10, d)).toFixed(d);
  }

  function showResults() {
    var el = document.getElementById('duel-results');
    if (!el) return;
    var you = state.you, foe = state.foe;
    var youWon = you.et <= foe.et;
    var winner = youWon ? you : foe;
    var loser = youWon ? foe : you;
    var gapT = Math.abs(you.et - foe.et);
    var gapM = loser.v * gapT;

    function row(r, won) {
      return '<div class="dr-row' + (won ? ' won' : '') + '">' +
        '<div class="dr-name">' + r.name + '</div>' +
        '<div class="dr-cells">' +
        '<span><b>' + fmt(r.et, 2) + '</b> s ET</span>' +
        '<span><b>' + Math.round(r.trap) + '</b> km/h trap</span>' +
        '<span><b>' + (r.t60 ? fmt(r.t60, 1) : '--') + '</b> s 0-60</span>' +
        '</div></div>';
    }

    el.innerHTML =
      '<div class="trophy-cine" aria-hidden="true">' +
        '<div class="trophy-rays"></div>' +
        '<div class="trophy-sprite"></div>' +
      '</div>' +
      '<div class="dr-verdict">' + winner.name + ' takes it</div>' +
      '<div class="dr-gap">by ' + fmt(gapT, 2) + ' s &middot; ' +
        fmt(gapM, 0) + ' m of daylight</div>' +
      row(you, youWon) + row(foe, !youWon) +
      '<button id="btn-duel-again" class="btn-secondary" type="button">Run It Back</button>';
    el.hidden = false;

    var again = document.getElementById('btn-duel-again');
    if (again) again.addEventListener('click', function () { arm(); });
  }

  function hideResults() {
    var el = document.getElementById('duel-results');
    if (el) { el.hidden = true; el.innerHTML = ''; }
  }

  // ---- spec sheet ----------------------------------------------------------------------
  // Side-by-side specification of both corners; anything that differs
  // glows gold, so "what did I actually change?" is answered at a glance.

  function renderSpecs() {
    var el = document.getElementById('duel-specs');
    if (!el || !state.you || !state.foe) return;
    var a = state.you.cfg, b = state.foe.cfg;

    function wingName(v) { return WING_NAMES[v] || String(v); }
    function tireName(v) { return TIRE_NAMES[v] || String(v); }

    var rows = [
      ['Power', a.powerHp + ' hp', b.powerHp + ' hp', a.powerHp !== b.powerHp],
      ['Weight', a.weightKg + ' kg', b.weightKg + ' kg', a.weightKg !== b.weightKg],
      ['Drivetrain', a.drivetrain, b.drivetrain, a.drivetrain !== b.drivetrain],
      ['Aero wing', wingName(a.wingLevel), wingName(b.wingLevel), a.wingLevel !== b.wingLevel],
      ['Tires', tireName(a.tireIndex), tireName(b.tireIndex), a.tireIndex !== b.tireIndex]
    ];

    var same = a.carId === b.carId;
    var html = '<div class="ds-head">' +
      '<span>' + (state.you.name) + '</span>' +
      '<span class="ds-vs">' + (same ? 'same chassis' : 'spec sheet') + '</span>' +
      '<span>' + (state.foe.name) + '</span></div>';

    rows.forEach(function (r) {
      html += '<div class="ds-row' + (r[3] ? ' diff' : '') + '">' +
        '<span class="ds-a">' + r[1] + '</span>' +
        '<span class="ds-label">' + r[0] + (r[3] ? ' ✦' : '') + '</span>' +
        '<span class="ds-b">' + r[2] + '</span></div>';
    });

    var diffs = rows.filter(function (r) { return r[3]; }).length;
    html += '<div class="ds-foot">' + (diffs === 0
      ? 'Identical specification. This one is all physics.'
      : diffs + ' difference' + (diffs > 1 ? 's' : '') +
        ' between these machines, marked ✦') + '</div>';

    el.innerHTML = html;
  }

  // ---- pickers -------------------------------------------------------------------------

  function buildPicker(containerId, selIndex, onPick) {
    var wrap = document.getElementById(containerId);
    if (!wrap) return;
    wrap.innerHTML = '';
    state.roster.forEach(function (entry, i) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip' + (i === selIndex ? ' active' : '');
      b.textContent = entry.label;
      b.addEventListener('click', function () {
        onPick(i);
        var kids = wrap.children;
        for (var k = 0; k < kids.length; k++) kids[k].classList.remove('active');
        b.classList.add('active');
        resetRace();
      });
      wrap.appendChild(b);
    });
  }

  function buildPickers() {
    buildPicker('duel-you-chips', state.youIndex, function (i) {
      state.youIndex = i;
      // Convenience: retarget the challenger to the new pick's factory twin
      // when the current challenger IS the same machine (mirror match).
      if (state.foeIndex === i) {
        var twin = factoryTwinIndex(state.roster[i].cfg);
        if (twin >= 0 && twin !== i) {
          state.foeIndex = twin;
          buildPicker('duel-foe-chips', state.foeIndex, function (j) {
            state.foeIndex = j;
          });
        }
      }
    });
    buildPicker('duel-foe-chips', state.foeIndex, function (i) {
      state.foeIndex = i;
    });
  }

  // ---- lifecycle -----------------------------------------------------------------------

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
    state.w = w; state.h = h;
  }

  function bindOnce() {
    if (state.bound) return;
    state.bound = true;
    var btn = document.getElementById('btn-duel');
    if (btn) btn.addEventListener('click', function () { arm(); });
    window.addEventListener('resize', function () {
      if (state.running) { size(); draw(); }
    });
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) stop();
      else if (isActive()) start();
    });
  }

  function isActive() {
    var s = document.getElementById('screen-duel');
    return !!(s && s.classList.contains('active'));
  }

  function start() {
    if (state.running) return;
    state.canvas = document.getElementById('duel-canvas');
    if (!state.canvas) return;
    bindOnce();
    size();
    if (!reduced()) {
      state.running = true;
      state.lastT = performance.now();
      state.rafId = window.requestAnimationFrame(tick);
    } else {
      draw();
    }
  }

  function stop() {
    state.running = false;
    if (state.rafId) window.cancelAnimationFrame(state.rafId);
    state.rafId = 0;
  }

  // ---- public API --------------------------------------------------------------------------

  window.Duel = {
    show: function (currentCfg) {
      try {
        state.roster = buildRoster(currentCfg);
        if (!state.roster.length) return;
        state.youIndex = Math.min(state.youIndex, state.roster.length - 1);
        // Default matchup: your machine vs its own factory twin.
        var twin = factoryTwinIndex(state.roster[state.youIndex].cfg);
        if (state.foeIndex >= state.roster.length ||
            state.foeIndex === state.youIndex) {
          state.foeIndex = twin >= 0 && twin !== state.youIndex
            ? twin
            : (state.youIndex === 0 && state.roster.length > 1 ? 1 : 0);
        }
        buildPickers();
        start();
        resetRace();
      } catch (e) { }
    },
    hide: function () { try { stop(); } catch (e) { } }
  };

  window.__duelProof = function (seconds) {
    try {
      state.canvas = document.getElementById('duel-canvas');
      if (!state.canvas) return null;
      bindOnce();
      size();
      if (!state.you) window.Duel.show(null);
      // Only arm from rest; arming mid-run is the ABORT gesture in the
      // real UI and would cancel the race this proof is trying to finish.
      if (state.phase === 'idle' || state.phase === 'done') arm();
      var steps = Math.round((seconds || 4) * 60);
      for (var i = 0; i < steps; i++) advance(1 / 60);
      draw();
      return state.canvas.toDataURL('image/png');
    } catch (e) {
      return String(e);
    }
  };
})();
