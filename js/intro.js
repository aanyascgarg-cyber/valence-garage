/* ============================================================
   VALENCE GARAGE. Cinematic entry sequence. js/intro.js
   Self-contained, zero deps. Creates its own fullscreen fixed
   overlay + canvas at document start, injects its own styles,
   and removes everything from the DOM when done.

   Sequence (~2.5s, 60fps target) on a void-black overlay:
   300 to 500 gold and champagne particles drift in from
   randomized positions with curl noise, converge to assemble a
   large serif italic V (target points sampled from an offscreen
   canvas), ease into place with per-particle spring timing, a
   hairline specular gleam sweeps across the assembled V, holds
   ~300ms, then particles release upward with fade while the
   overlay dissolves (opacity + subtle scale), revealing the app.

   Time-parametric: the whole simulation is a pure function of a
   millisecond clock, so window.__introProof(frameIndex) can
   deterministically render any frame and return toDataURL.

   Rules honored: plays once per session (sessionStorage
   valence-intro-v1); any tap or key skips instantly;
   prefers-reduced-motion skips entirely; hard 2.6s timeout removes
   the overlay no matter what; never throws (full try/catch shell);
   no console output; pointer-events only on the overlay while
   visible; app underneath fully functional the moment it lifts.
   ============================================================ */
(function () {
  'use strict';

  var SESSION_KEY = 'valence-intro-v1';
  var HARD_TIMEOUT_MS = 2600;   // absolute cap on the block

  // Palette (mirrors style.css :root): gold #C9A84C, champagne
  // #E8D5A0, porcelain #FAF4F0, deep gold for depth.
  var GOLD = [201, 168, 76];
  var CHAMPAGNE = [232, 213, 160];
  var PORCELAIN = [250, 244, 240];
  var DEEP_GOLD = [166, 132, 54];

  // ---- Timeline (ms). The sim is a pure function of t. ----
  var T_DRIFT = 0;        // particles drift in from edges
  var T_CONVERGE = 260;   // springs engage toward the V targets
  var T_ASSEMBLED = 1500; // V is fully formed
  var T_GLEAM_START = 1150; // specular sweep begins (overlaps settle)
  var T_GLEAM_END = 1750;
  var T_HOLD_END = 2050;  // ~300ms hold on the assembled + gleamed V
  var T_RELEASE = 2050;   // particles release upward, overlay dissolves
  var T_END = 2500;       // sequence complete
  var PROOF_FPS = 60;     // frame -> ms mapping for __introProof

  // ---- Module state ----
  var overlay = null, canvas = null, ctx = null, styleEl = null;
  var glowCanvas = null, glowCtx = null;
  var W = 0, H = 0, dpr = 1;
  var particles = [];
  var targets = [];
  var rafId = 0;
  var startTime = 0;
  var running = false;
  var finished = false;
  var hardTimer = 0;
  var vMetrics = null; // { cx, cy, size } of the sampled V, in CSS px

  // Deterministic PRNG so proof frames are reproducible and the
  // particle field is stable across the real run and the hook.
  function makeRng(seed) {
    var s = seed >>> 0;
    return function () {
      s = (s + 0x6D2B79F5) >>> 0;
      var t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function lerp(a, b, k) { return a + (b - a) * k; }

  // Smooth easings.
  function easeOutCubic(k) { k = clamp(k, 0, 1); var f = 1 - k; return 1 - f * f * f; }
  function easeInCubic(k) { k = clamp(k, 0, 1); return k * k * k; }
  function easeInOutSine(k) { k = clamp(k, 0, 1); return 0.5 - 0.5 * Math.cos(Math.PI * k); }

  // Cheap smooth curl-ish field for the drift phase.
  function curl(x, y, seed) {
    var a = Math.sin(x * 0.9 + seed) + Math.cos(y * 1.1 - seed * 1.3);
    var b = Math.cos(x * 1.2 - seed * 0.7) + Math.sin(y * 0.8 + seed);
    return { x: a, y: b };
  }

  // ---- Sample the V target points from an offscreen canvas ----
  // Draw a large serif italic V (Playfair Display if available, else
  // Georgia italic) and pick opaque pixels as convergence targets.
  function sampleV(rng) {
    var pts = [];
    var minDim = Math.min(W, H);
    // Generous glyph size, capped so it reads on phones and desktop.
    var size = clamp(minDim * 0.62, 200, 560);
    var cx = W * 0.5;
    var cy = H * 0.5;

    var pad = Math.ceil(size * 0.5);
    var sw = Math.ceil(size + pad * 2);
    var sh = Math.ceil(size * 1.25 + pad * 2);
    var off = document.createElement('canvas');
    off.width = sw;
    off.height = sh;
    var octx = off.getContext('2d');
    if (!octx) return { pts: pts, cx: cx, cy: cy, size: size };

    var hasPlayfair = false;
    try {
      if (document.fonts && document.fonts.check) {
        hasPlayfair = document.fonts.check('italic 700 ' + Math.round(size) + 'px "Playfair Display"');
      }
    } catch (e) { hasPlayfair = false; }
    var family = hasPlayfair ? '"Playfair Display", Georgia, serif' : 'Georgia, serif';

    octx.clearRect(0, 0, sw, sh);
    octx.fillStyle = '#fff';
    octx.textAlign = 'center';
    octx.textBaseline = 'middle';
    octx.font = 'italic 700 ' + Math.round(size) + 'px ' + family;
    octx.fillText('V', sw / 2, sh / 2);

    var data;
    try {
      data = octx.getImageData(0, 0, sw, sh).data;
    } catch (e) {
      return { pts: pts, cx: cx, cy: cy, size: size };
    }

    // Compute the glyph bounding box so we can center it precisely.
    var minX = sw, minY = sh, maxX = 0, maxY = 0;
    var step = 2; // scan stride; keeps sampling cheap
    for (var y = 0; y < sh; y += step) {
      for (var x = 0; x < sw; x += step) {
        var a = data[(y * sw + x) * 4 + 3];
        if (a > 90) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX <= minX || maxY <= minY) {
      return { pts: pts, cx: cx, cy: cy, size: size };
    }
    var gcx = (minX + maxX) / 2;
    var gcy = (minY + maxY) / 2;

    // Collect candidate opaque pixels, then thin to a target count.
    var candidates = [];
    var pick = 2; // sampling stride for candidate collection
    for (var yy = minY; yy <= maxY; yy += pick) {
      for (var xx = minX; xx <= maxX; xx += pick) {
        var aa = data[(yy * sw + xx) * 4 + 3];
        if (aa > 110) {
          candidates.push(xx - gcx, yy - gcy);
        }
      }
    }
    var count = candidates.length / 2;
    if (count === 0) return { pts: pts, cx: cx, cy: cy, size: size };

    // Thin to 300..500 targets via reservoir-style shuffle pick.
    var want = clamp(Math.round(count), 300, 500);
    want = Math.min(want, 500);
    if (want < 300) want = Math.min(300, count);

    // Fisher-Yates over indices for an even spatial spread.
    var idx = new Array(count);
    for (var i = 0; i < count; i++) idx[i] = i;
    for (var j = count - 1; j > 0; j--) {
      var r = Math.floor(rng() * (j + 1));
      var tmp = idx[j]; idx[j] = idx[r]; idx[r] = tmp;
    }
    var take = Math.min(want, count);
    for (var k = 0; k < take; k++) {
      var ci = idx[k] * 2;
      pts.push({ x: cx + candidates[ci], y: cy + candidates[ci + 1] });
    }
    return { pts: pts, cx: cx, cy: cy, size: (maxX - minX) };
  }

  // ---- Build the particle field bound to the V targets ----
  function buildParticles() {
    var rng = makeRng(0x5A1E4C);
    var sampled = sampleV(rng);
    targets = sampled.pts;
    vMetrics = { cx: sampled.cx, cy: sampled.cy, size: sampled.size };
    particles = [];

    var n = targets.length;
    if (n === 0) return;

    for (var i = 0; i < n; i++) {
      var tg = targets[i];
      // Spawn from a randomized position: mostly off the edges, drifting in.
      var edge = rng();
      var sx, sy;
      var margin = Math.max(W, H) * 0.35;
      if (edge < 0.25) { sx = -margin * rng(); sy = rng() * H; }
      else if (edge < 0.5) { sx = W + margin * rng(); sy = rng() * H; }
      else if (edge < 0.75) { sx = rng() * W; sy = -margin * rng(); }
      else { sx = rng() * W; sy = H + margin * rng(); }
      // Pull spawns partly toward center so drift reads as convergence.
      sx = lerp(sx, W * 0.5, 0.18 + rng() * 0.14);
      sy = lerp(sy, H * 0.5, 0.18 + rng() * 0.14);

      var hue = rng();
      var col;
      if (hue < 0.55) col = GOLD;
      else if (hue < 0.85) col = CHAMPAGNE;
      else if (hue < 0.95) col = DEEP_GOLD;
      else col = PORCELAIN;

      particles.push({
        // live state (reset each render for determinism)
        x: sx, y: sy, vx: 0, vy: 0,
        // spawn + target
        sx: sx, sy: sy, tx: tg.x, ty: tg.y,
        // per-particle timing / character
        delay: rng() * 0.22,             // stagger into the spring (0..0.22 of converge window)
        stiff: 0.10 + rng() * 0.09,      // spring stiffness
        damp: 0.72 + rng() * 0.10,       // damping
        size: 0.9 + rng() * 1.9,         // dot radius
        col: col,
        seed: rng() * 6.283,
        curlAmp: 18 + rng() * 30,        // drift wander amplitude
        rise: 40 + rng() * 120,          // release upward speed
        drift: (rng() - 0.5) * 60,       // release lateral drift
        twk: rng()                       // twinkle phase
      });
    }
  }

  // ---- Deterministic per-particle position at absolute time t (ms) ----
  // Integrates a fixed-step spring from spawn so the state at any t is
  // reproducible regardless of real frame cadence. Cheap: the converge
  // window is short and we only step within it.
  var FIXED_DT = 1000 / 60;

  function simParticle(p, t) {
    // Phase 1: drift (curl wander) from spawn toward a pre-target holding
    // zone until the spring engages. Phase 2: spring to target. Phase 3:
    // release upward + fade after T_RELEASE.
    var localDelay = p.delay * (T_CONVERGE - T_DRIFT);
    var springStart = T_CONVERGE + localDelay;

    if (t <= springStart) {
      // Drift phase: eased approach toward a point short of the target,
      // plus curl wander that fades as we near the spring.
      var dk = clamp((t - T_DRIFT) / Math.max(1, springStart - T_DRIFT), 0, 1);
      var e = easeInOutSine(dk);
      // Hold zone is 78% of the way to target so the spring still has travel.
      var hx = lerp(p.sx, lerp(p.sx, p.tx, 0.78), e);
      var hy = lerp(p.sy, lerp(p.sy, p.ty, 0.78), e);
      var c = curl((p.sx + p.tx) * 0.004 + p.seed, (p.sy + p.ty) * 0.004, t * 0.0012 + p.seed);
      var wander = (1 - e) * p.curlAmp;
      p.x = hx + c.x * wander;
      p.y = hy + c.y * wander;
      p.vx = 0; p.vy = 0;
      return;
    }

    // Spring phase: integrate from the drift handoff to target.
    // Reset to the handoff state, then step deterministically to t.
    var dk2 = 1;
    var hx0 = lerp(p.sx, p.tx, 0.78);
    var hy0 = lerp(p.sy, p.ty, 0.78);
    p.x = hx0; p.y = hy0; p.vx = 0; p.vy = 0;

    var tt = Math.min(t, T_END);
    var steps = Math.floor((tt - springStart) / FIXED_DT);
    steps = clamp(steps, 0, 240);
    for (var s = 0; s < steps; s++) {
      var ax = (p.tx - p.x) * p.stiff;
      var ay = (p.ty - p.y) * p.stiff;
      p.vx = (p.vx + ax) * p.damp;
      p.vy = (p.vy + ay) * p.damp;
      p.x += p.vx;
      p.y += p.vy;
    }

    // Release phase: after T_RELEASE, lift upward and drift, springs off.
    if (t > T_RELEASE) {
      var rk = clamp((t - T_RELEASE) / (T_END - T_RELEASE), 0, 1);
      var re = easeInCubic(rk);
      p.x += p.drift * re;
      p.y -= p.rise * re;
    }
  }

  // Global alpha of a particle at time t (fade for drift-in and release).
  function particleAlpha(p, t) {
    var a = 1;
    // Fade in during the first part of drift.
    var fadeIn = clamp((t - T_DRIFT) / 240, 0, 1);
    a *= fadeIn;
    // Fade out on release.
    if (t > T_RELEASE) {
      var rk = clamp((t - T_RELEASE) / (T_END - T_RELEASE), 0, 1);
      a *= (1 - easeInCubic(rk));
    }
    // Subtle twinkle once assembled.
    if (t > T_ASSEMBLED - 200 && t < T_RELEASE) {
      a *= 0.82 + 0.18 * Math.sin(t * 0.02 + p.twk * 6.283);
    }
    return clamp(a, 0, 1);
  }

  // ---- Render one deterministic frame at absolute time t (ms) ----
  function renderAt(t) {
    if (!ctx) return;

    // Trails: alpha-faded clear rather than a hard wipe, for luminous smear.
    // During release we clear faster so the void returns cleanly.
    var clearAlpha = t > T_RELEASE ? 0.30 : 0.22;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = 'rgba(3, 5, 7, ' + clearAlpha + ')';
    ctx.fillRect(0, 0, W, H);

    // Overlay dissolve: fade + subtle scale after release.
    var overlayAlpha = 1;
    var scale = 1;
    if (t > T_RELEASE) {
      var dk = clamp((t - T_RELEASE) / (T_END - T_RELEASE), 0, 1);
      overlayAlpha = 1 - easeInCubic(dk);
      scale = 1 + 0.06 * easeOutCubic(dk);
    }
    if (overlay) {
      overlay.style.opacity = overlayAlpha.toFixed(3);
      overlay.style.transform = 'scale(' + scale.toFixed(4) + ')';
    }

    // Additive glow pass: layered strokes under 'lighter'.
    ctx.globalCompositeOperation = 'lighter';

    var gleam = gleamAt(t);

    for (var i = 0; i < particles.length; i++) {
      var p = particles[i];
      simParticle(p, t);
      var a = particleAlpha(p, t);
      if (a <= 0.01) continue;

      var c = p.col;
      var r = p.size;

      // Gleam boost: particles near the sweep line flare brighter/whiter.
      var boost = 0;
      if (gleam.active) {
        var d = Math.abs((p.x - gleam.x) + (p.y - vMetrics.cy) * 0.35);
        boost = clamp(1 - d / gleam.width, 0, 1);
        boost = boost * boost * gleam.intensity;
      }

      // Soft outer halo.
      var halo = r * (3.2 + boost * 2.2);
      ctx.globalAlpha = a * (0.16 + boost * 0.22);
      ctx.beginPath();
      ctx.fillStyle = 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')';
      ctx.arc(p.x, p.y, halo, 0, 6.283);
      ctx.fill();

      // Mid glow.
      ctx.globalAlpha = a * (0.5 + boost * 0.3);
      ctx.beginPath();
      ctx.arc(p.x, p.y, r * 1.8, 0, 6.283);
      ctx.fill();

      // Hot core, whitened by the gleam.
      var cr = Math.round(lerp(c[0], 255, 0.35 + boost * 0.55));
      var cg = Math.round(lerp(c[1], 255, 0.30 + boost * 0.55));
      var cb = Math.round(lerp(c[2], 240, 0.25 + boost * 0.55));
      ctx.globalAlpha = a;
      ctx.beginPath();
      ctx.fillStyle = 'rgb(' + cr + ',' + cg + ',' + cb + ')';
      ctx.arc(p.x, p.y, r * 0.9, 0, 6.283);
      ctx.fill();
    }

    // The moving specular hairline itself: a thin bright vertical-ish
    // streak crossing the assembled V.
    if (gleam.active && gleam.intensity > 0.02) {
      ctx.globalCompositeOperation = 'lighter';
      var gx = gleam.x;
      var top = vMetrics.cy - vMetrics.size * 0.75;
      var bot = vMetrics.cy + vMetrics.size * 0.75;
      var grad = ctx.createLinearGradient(gx - gleam.width * 0.5, 0, gx + gleam.width * 0.5, 0);
      grad.addColorStop(0, 'rgba(250,244,240,0)');
      grad.addColorStop(0.5, 'rgba(255,250,240,' + (0.10 * gleam.intensity).toFixed(3) + ')');
      grad.addColorStop(1, 'rgba(250,244,240,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(gx - gleam.width * 0.5, top, gleam.width, bot - top);
    }

    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  // Specular gleam sweep state at time t.
  function gleamAt(t) {
    if (t < T_GLEAM_START || t > T_GLEAM_END || !vMetrics) {
      return { active: false, x: 0, width: 1, intensity: 0 };
    }
    var k = (t - T_GLEAM_START) / (T_GLEAM_END - T_GLEAM_START);
    var e = easeInOutSine(k);
    var left = vMetrics.cx - vMetrics.size * 0.8;
    var right = vMetrics.cx + vMetrics.size * 0.8;
    var x = lerp(left, right, e);
    // Intensity ramps in and out so the gleam blooms and fades, not blinks.
    var intensity = Math.sin(Math.PI * clamp(k, 0, 1));
    return { active: true, x: x, width: Math.max(40, vMetrics.size * 0.22), intensity: intensity };
  }

  // ---- Real-time loop ----
  function frame(now) {
    if (!running) return;
    var t = now - startTime;
    try {
      renderAt(t);
    } catch (e) {
      teardown();
      return;
    }
    if (t >= T_END) {
      teardown();
      return;
    }
    rafId = requestAnimationFrame(frame);
  }

  // ---- Setup ----
  function injectStyles() {
    styleEl = document.createElement('style');
    styleEl.setAttribute('data-valence-intro', '');
    styleEl.textContent =
      '#valence-intro-overlay{' +
      'position:fixed;inset:0;z-index:99999;' +
      'background:#030507;' +
      'pointer-events:auto;' +
      'will-change:opacity,transform;' +
      'transform-origin:50% 50%;' +
      'contain:strict;' +
      '}' +
      '#valence-intro-overlay canvas{display:block;width:100%;height:100%;}';
    (document.head || document.documentElement).appendChild(styleEl);
  }

  function buildDom() {
    overlay = document.createElement('div');
    overlay.id = 'valence-intro-overlay';
    overlay.setAttribute('aria-hidden', 'true');

    canvas = document.createElement('canvas');
    overlay.appendChild(canvas);
    (document.body || document.documentElement).appendChild(overlay);

    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth || document.documentElement.clientWidth || 360;
    H = window.innerHeight || document.documentElement.clientHeight || 640;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx = canvas.getContext('2d');
    if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Paint the void immediately so there is no flash before the first frame.
    if (ctx) {
      ctx.fillStyle = '#030507';
      ctx.fillRect(0, 0, W, H);
    }
  }

  var skipBound = null;
  function bindSkip() {
    skipBound = function () { teardown(); };
    overlay.addEventListener('pointerdown', skipBound, { passive: true });
    window.addEventListener('keydown', skipBound, { passive: true });
  }
  function unbindSkip() {
    if (!skipBound) return;
    try { overlay.removeEventListener('pointerdown', skipBound); } catch (e) {}
    try { window.removeEventListener('keydown', skipBound); } catch (e) {}
    skipBound = null;
  }

  // ---- Teardown: remove everything, restore the app instantly. ----
  function teardown() {
    if (finished) return;
    finished = true;
    running = false;
    if (rafId) { try { cancelAnimationFrame(rafId); } catch (e) {} rafId = 0; }
    if (hardTimer) { try { clearTimeout(hardTimer); } catch (e) {} hardTimer = 0; }
    unbindSkip();
    if (overlay && overlay.parentNode) {
      try { overlay.parentNode.removeChild(overlay); } catch (e) {}
    }
    if (styleEl && styleEl.parentNode) {
      try { styleEl.parentNode.removeChild(styleEl); } catch (e) {}
    }
    overlay = null; canvas = null; ctx = null; styleEl = null;
    particles = []; targets = [];
  }

  // ---- Proof hook: deterministically render frame N and return PNG. ----
  // Structured so the sim is a pure function of the clock: we build the
  // field once, render at t = frameIndex / fps, and read the canvas back.
  function installProof() {
    window.__introProof = function (frameIndex) {
      try {
        var teardownAfter = false;
        if (!canvas || !ctx) {
          // Build a throwaway overlay to rasterize into, then remove it.
          if (finished) finished = false;
          injectStyles();
          buildDom();
          buildParticles();
          teardownAfter = true;
        } else if (!particles.length) {
          buildParticles();
        }
        var t = (frameIndex / PROOF_FPS) * 1000;
        // Reset transforms already set in buildDom; render deterministically.
        renderAt(t);
        var url = canvas ? canvas.toDataURL('image/png') : '';
        if (teardownAfter) {
          // Keep it around only long enough to read; remove now.
          var o = overlay, s = styleEl;
          overlay = null; canvas = null; ctx = null; styleEl = null;
          particles = []; targets = [];
          if (o && o.parentNode) { try { o.parentNode.removeChild(o); } catch (e) {} }
          if (s && s.parentNode) { try { s.parentNode.removeChild(s); } catch (e) {} }
          finished = false;
        }
        return url;
      } catch (e) {
        return '';
      }
    };
  }

  // ---- Boot ----
  function start() {
    try {
      installProof();

      // Reduced motion: skip entirely, but flag the session so nothing
      // else expects a replay, and still expose the proof hook above.
      var reduce = false;
      try {
        reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      } catch (e) { reduce = false; }
      if (reduce) {
        try { sessionStorage.setItem(SESSION_KEY, '1'); } catch (e) {}
        return;
      }

      // Play once per session.
      var played = false;
      try { played = sessionStorage.getItem(SESSION_KEY) === '1'; } catch (e) { played = false; }
      if (played) return;
      try { sessionStorage.setItem(SESSION_KEY, '1'); } catch (e) {}

      injectStyles();
      buildDom();
      buildParticles();

      // If sampling produced nothing (font/canvas unavailable), do not
      // block: remove and reveal immediately.
      if (!particles.length) { teardown(); return; }

      bindSkip();

      // Hard timeout: overlay is gone by 2.6s no matter what.
      hardTimer = setTimeout(teardown, HARD_TIMEOUT_MS);

      running = true;
      startTime = (typeof performance !== 'undefined' && performance.now)
        ? performance.now() : Date.now();
      rafId = requestAnimationFrame(frame);
    } catch (e) {
      // Never throw: any failure removes the overlay and reveals the app.
      teardown();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
