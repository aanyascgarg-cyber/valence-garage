/* ============================================================
   VALENCE ADVISOR ORB
   A dense SPHERICAL swirl of thin luminous ribbons, drawn on
   #orb-canvas inside #advisor-orb. Copies the green voice-orb
   ref in structure and motion, recoloured to gold and champagne,
   floating on pure black.

   Design language (per SPEC v7, matching the ref):
   - 8-12 thin ribbons, each a great-circle-like loop on an
     invisible sphere: generated as a 3D circle with its own
     random axis tilt, then projected to 2D. All loops share a
     similar radius (0.82-1.0 of the orb radius) so they HUG the
     surface of the sphere and overlap heavily.
   - Each ribbon precesses at its own slow rate; the whole knot
     also precesses, so ribbons cross and re-cross. Additive
     (lighter) compositing makes crossings naturally bloom bright.
   - Round-capped strokes with a bright head that fades to a faint
     trailing tail (light-painting quality).
   - The CENTER stays DARK: no solid core glow, only a faint wide
     champagne haze. A soft wide outer bloom halo rings the swirl.
   - Continuous rotation ALWAYS. Visibility pause allowed.
     prefers-reduced-motion draws one static frame.

   State (read from #advisor-orb classes each frame):
   - .idle       calm base motion
   - .listening  brighter, faster, slightly scaled up
   - .thinking   a gentle breathing pulse

   Contract:
   - owns only #orb-canvas; touches no other module or global
     (plus the read-only window.__orbProof hook).
   - its own rAF loop; pauses when document is hidden.
   - never throws (all work guarded).
   ============================================================ */
(function () {
  'use strict';

  var canvas = document.getElementById('orb-canvas');
  if (!canvas || !canvas.getContext) return;

  var ctx;
  try {
    ctx = canvas.getContext('2d');
  } catch (e) {
    return;
  }
  if (!ctx) return;

  var host = document.getElementById('advisor-orb');
  var reduceQuery = window.matchMedia
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : { matches: false };

  // Palette. Gold + champagne light with white-gold highlights on the
  // brightest crossings, echoing the ref's hottest crossings.
  var CHAMPAGNE = [244, 226, 168];
  var GOLD = [214, 173, 84];
  var DEEPGOLD = [176, 132, 48];
  var HIGHLIGHT = [255, 250, 236];

  var TWO_PI = Math.PI * 2;

  // Build a 3D orthonormal frame (u, v) spanning the plane of a great
  // circle whose normal is defined by two Euler-ish angles. The circle is
  // traced as center + cos(a)*u + sin(a)*v. Radii stay near 1 so every
  // loop hugs the sphere surface.
  function makeAxis(nTheta, nPhi) {
    // normal on the unit sphere
    var nx = Math.sin(nTheta) * Math.cos(nPhi);
    var ny = Math.sin(nTheta) * Math.sin(nPhi);
    var nz = Math.cos(nTheta);
    // pick a reference not parallel to n
    var rx = 0, ry = 0, rz = 1;
    if (Math.abs(nz) > 0.9) { rx = 1; rz = 0; }
    // u = normalize(n x ref)
    var ux = ny * rz - nz * ry;
    var uy = nz * rx - nx * rz;
    var uz = nx * ry - ny * rx;
    var ul = Math.sqrt(ux * ux + uy * uy + uz * uz) || 1;
    ux /= ul; uy /= ul; uz /= ul;
    // v = n x u  (already unit)
    var vx = ny * uz - nz * uy;
    var vy = nz * ux - nx * uz;
    var vz = nx * uy - ny * ux;
    return { ux: ux, uy: uy, uz: uz, vx: vx, vy: vy, vz: vz };
  }

  // The swirl. In the ref the ball is not a handful of distinct rings; it is
  // MANY thin luminous ribbons hugging the sphere at near-equal radius, packed
  // so densely they weave into a solid glowing ball with a hollow dark core.
  // We therefore generate a larger set of loops procedurally, clustered in a
  // tight radius band (0.9-1.0) with small tilt jitter so none reads as a flat
  // inner ellipse. Each ribbon is a great circle traced almost fully (long
  // sweep) with a bright head fading down a light-painting trail; its plane
  // precesses at its own slow rate so the weave shifts and re-crosses.
  //
  // Per ribbon:
  //   th, ph  - polar/azimuth of the circle's normal (its tilt)
  //   radius  - loop radius as a fraction of the sphere radius (tight band)
  //   spin    - trace rate: how fast the bright head runs around the loop
  //   prec    - individual plane precession rate (drifts the tilt over time)
  //   phase   - starting head angle / shimmer offset
  //   sweep   - trailing arc length in radians (near a full loop)
  //   w       - core line width
  //   col     - base colour
  //   glow    - bloom multiplier
  var RIBBONS = (function () {
    // Deterministic pseudo-random so the weave is stable frame to frame and
    // between reloads (no Math.random at module load surprises the proof).
    var seed = 0x9e3779b9;
    function rnd() {
      seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
      return ((seed >>> 0) / 4294967296);
    }
    var cols = [CHAMPAGNE, GOLD, CHAMPAGNE, GOLD, DEEPGOLD, CHAMPAGNE, GOLD, DEEPGOLD];
    var N = 26; // dense weave, still cheap at SEG below
    var out = [];
    for (var i = 0; i < N; i++) {
      // Spread normals roughly evenly over the sphere (tilt variety) but keep
      // the weave coherent: golden-angle azimuth + jittered polar.
      var th = 0.28 + rnd() * (Math.PI - 0.56);
      var ph = i * 2.399963 + rnd() * 0.7;
      var radius = 0.90 + rnd() * 0.10;          // tight band 0.90-1.00
      var dir = rnd() < 0.5 ? -1 : 1;
      var spin = dir * (0.34 + rnd() * 0.30);    // varied trace speeds
      var prec = (rnd() < 0.5 ? -1 : 1) * (0.05 + rnd() * 0.09);
      var phase = rnd() * TWO_PI;
      var sweep = 5.2 + rnd() * 1.0;             // near-full loops (dense overlap)
      var w = 1.5 + rnd() * 1.5;                 // 1.5-3.0
      var col = cols[i % cols.length];
      var glow = 0.86 + rnd() * 0.14;
      out.push({ th: th, ph: ph, radius: radius, spin: spin, prec: prec,
                 phase: phase, sweep: sweep, w: w, col: col, glow: glow });
    }
    return out;
  })();

  // Segment resolution of each ribbon trail. Higher = smoother, denser weave.
  // 26 ribbons * 64 segs = ~1.7k line points a frame: comfortably < 3ms.
  var SEG = 64;

  var dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 2));
  var cssSize = 0;
  var half = 0;
  var running = false;
  var rafId = 0;
  var t = 0;          // animation clock (seconds-ish)
  var last = 0;
  var precess = 0;    // whole-knot precession angle (yaw about view Y)
  var precessX = 0;   // whole-knot tumble about view X

  // Smoothed state drivers so transitions are graceful rather than snapping.
  var driveBright = 1.0;   // overall brightness multiplier
  var driveSpeed = 1.0;    // orbit + precession rate multiplier
  var driveScale = 1.0;    // knot scale multiplier
  var drivePulse = 0.0;    // 0..1 amount of thinking pulse

  // Scratch point buffer reused each ribbon (x, y, depth) to avoid GC churn.
  var PX = new Float32Array(SEG);
  var PY = new Float32Array(SEG);
  var PZ = new Float32Array(SEG);

  function measure() {
    if (!host) return;
    var rect = host.getBoundingClientRect();
    var size = Math.max(1, Math.round(rect.width || 220));
    if (size === cssSize) return;
    cssSize = size;
    half = size / 2;
    dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 2));
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    canvas.style.width = size + 'px';
    canvas.style.height = size + 'px';
  }

  function rgba(c, a) {
    return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')';
  }

  // Read state classes off the host each frame and ease the drivers toward
  // their targets. Never throws if host is missing.
  function readState(dt) {
    var bTarget = 1.0, sTarget = 1.0, scTarget = 1.0, pTarget = 0.0;
    if (host && host.classList) {
      if (host.classList.contains('listening')) {
        bTarget = 1.5; sTarget = 1.7; scTarget = 1.06;
      } else if (host.classList.contains('thinking')) {
        bTarget = 1.22; sTarget = 1.15; scTarget = 1.0; pTarget = 1.0;
      }
    }
    var k = Math.min(1, dt * 6);
    driveBright += (bTarget - driveBright) * k;
    driveSpeed += (sTarget - driveSpeed) * k;
    driveScale += (scTarget - driveScale) * k;
    drivePulse += (pTarget - drivePulse) * k;
  }

  // Build the projected point chain for a ribbon: a comet trail from the
  // bright head backwards along the great circle for `sweep` radians. Each
  // 3D point is rotated by the whole-knot precession (yaw + tumble), then
  // orthographically projected (drop z) to screen space. Depth (rotated z)
  // is kept so we can dim the far side, giving the sphere its solidity.
  function buildRibbon(rb, R, headAngle) {
    var ax = makeAxis(rb.th, rb.ph + rb.prec * t);
    var rad = rb.radius * R;
    var sweep = rb.sweep;

    var cy = Math.cos(precess), sy = Math.sin(precess);   // yaw about Y
    var cx = Math.cos(precessX), sx = Math.sin(precessX); // tumble about X

    for (var i = 0; i < SEG; i++) {
      var frac = i / (SEG - 1);
      var a = headAngle - frac * sweep;
      var ca = Math.cos(a) * rad;
      var sa = Math.sin(a) * rad;
      // point on the great circle in 3D
      var x = ca * ax.ux + sa * ax.vx;
      var y = ca * ax.uy + sa * ax.vy;
      var z = ca * ax.uz + sa * ax.vz;
      // yaw about Y
      var x1 = x * cy + z * sy;
      var z1 = -x * sy + z * cy;
      // tumble about X
      var y2 = y * cx - z1 * sx;
      var z2 = y * sx + z1 * cx;
      PX[i] = x1;
      PY[i] = y2;
      PZ[i] = z2;   // + = toward viewer (front of sphere)
    }
  }

  // One ribbon: a great circle traced almost fully, painted as a light-
  // painting trail whose brightness falls from a hot head to a faint tail.
  // Front-facing portions read brighter than the far side so the packed weave
  // still reads as a solid sphere. Kept cheap: NO per-ribbon shadowBlur at all
  // (that was the frame-cost killer). Bloom is built from wide low-alpha
  // underlay strokes plus additive overlap of many thin loops and the outer
  // halo gradient. With ~26 ribbons this stays well under the frame budget.
  function drawRibbon(rb, R, headAngle, bright) {
    buildRibbon(rb, R, headAngle);
    var n = SEG;

    // Depth at the head, used to gate the hot tip.
    var headDepth = PZ[0] / R;

    // 1) Wide soft glow underlay: one continuous WIDE low-alpha stroke over the
    //    whole trail. Additive width (not shadowBlur) gives a soft halo around
    //    each ribbon cheaply; the many overlapping underlays build the bloom.
    //    No per-ribbon shadowBlur here (keeps the frame well under budget).
    ctx.beginPath();
    ctx.moveTo(PX[0], PY[0]);
    for (var i = 1; i < n; i++) ctx.lineTo(PX[i], PY[i]);
    ctx.lineWidth = rb.w * 3.4 * driveScale;
    ctx.strokeStyle = rgba(rb.col, Math.min(1, 0.07 * bright * rb.glow));
    ctx.stroke();
    // a mid halo pass for a smoother falloff
    ctx.lineWidth = rb.w * 1.9 * driveScale;
    ctx.strokeStyle = rgba(rb.col, Math.min(1, 0.12 * bright * rb.glow));
    ctx.stroke();

    // 2) Crisp core, drawn as a few bands so alpha can ramp head->tail without
    //    a per-vertex gradient. No shadow here (the underlay carries the glow).
    var BANDS = 6;
    var per = (n - 1) / BANDS;
    for (var b = 0; b < BANDS; b++) {
      var from = Math.floor(b * per);
      var to = Math.min(n - 1, Math.ceil((b + 1) * per) + 1); // small overlap
      if (to - from < 1) continue;
      var midFrac = (b + 0.5) / BANDS;                 // 0 head .. 1 tail
      var fade = Math.pow(1 - midFrac, 1.25);          // trailing alpha fade
      var shimmer = 0.80 + 0.20 * Math.sin(t * 2.2 + rb.phase + midFrac * 5.0);

      var mid = Math.min(n - 1, Math.floor((from + to) * 0.5));
      var depth = PZ[mid] / R;                          // -1 back .. +1 front
      var depthDim = 0.45 + 0.55 * (depth * 0.5 + 0.5); // dim the far side

      var a = fade * shimmer * bright * depthDim;
      var w = rb.w * (0.55 + 0.45 * fade) * driveScale;

      ctx.beginPath();
      ctx.moveTo(PX[from], PY[from]);
      for (var j = from + 1; j <= to; j++) ctx.lineTo(PX[j], PY[j]);
      ctx.lineWidth = w;
      ctx.strokeStyle = rgba(rb.col, Math.min(1, a * 0.9));
      ctx.stroke();
    }

    // 3) Bright leading head: a short warm-gold overstroke so each ribbon's
    //    tip flares like the ref's hottest crossings, without going stark
    //    white. Front only. No shadowBlur (the underlay carries the glow).
    if (headDepth > -0.1) {
      var headTo = Math.min(n - 1, Math.floor(per * 0.9) + 1);
      var hA = Math.min(1, 0.7 * bright * (0.55 + 0.45 * (headDepth * 0.5 + 0.5)));
      // warm head: champagne core with a small white-gold tip, not pure white
      ctx.beginPath();
      ctx.moveTo(PX[0], PY[0]);
      for (var k = 1; k <= headTo; k++) ctx.lineTo(PX[k], PY[k]);
      ctx.lineWidth = rb.w * 1.0 * driveScale;
      ctx.strokeStyle = rgba(CHAMPAGNE, hA);
      ctx.stroke();
      // tiny hot tip
      var tipTo = Math.min(n - 1, Math.floor(per * 0.35) + 1);
      ctx.beginPath();
      ctx.moveTo(PX[0], PY[0]);
      for (var m = 1; m <= tipTo; m++) ctx.lineTo(PX[m], PY[m]);
      ctx.lineWidth = rb.w * 0.8 * driveScale;
      ctx.strokeStyle = rgba(HIGHLIGHT, Math.min(1, hA * 0.7));
      ctx.stroke();
    }
  }

  // Draw the full swirl once at the current clock. Shared by the live loop
  // and the static / proof paths.
  function renderKnot() {
    var W = canvas.width;
    var H = canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);

    // Device-pixel transform centred on the orb.
    ctx.setTransform(dpr, 0, 0, dpr, half * dpr, half * dpr);
    ctx.globalCompositeOperation = 'lighter';

    var bright = driveBright;
    // thinking pulse: a slow breathing on brightness.
    if (drivePulse > 0.01) {
      var pulse = 0.5 + 0.5 * Math.sin(t * 3.1);
      bright *= (1 + 0.20 * drivePulse * pulse);
    }

    // Sphere radius. Leaves margin for the outer bloom, grows slightly when
    // listening (driveScale).
    var R = half * 0.66 * driveScale;

    // Soft WIDE outer bloom halo: a broad, low-alpha ring of light around the
    // whole swirl. This is the ref's outer glow. The center is left DARK.
    var haloR = R * 2.05;
    var halo = ctx.createRadialGradient(0, 0, R * 0.5, 0, 0, haloR);
    halo.addColorStop(0, rgba(GOLD, 0));
    halo.addColorStop(0.30, rgba(DEEPGOLD, 0.06 * bright));
    halo.addColorStop(0.55, rgba(GOLD, 0.085 * bright));
    halo.addColorStop(0.78, rgba(CHAMPAGNE, 0.045 * bright));
    halo.addColorStop(1, rgba(GOLD, 0));
    ctx.shadowBlur = 0;
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(0, 0, haloR, 0, TWO_PI);
    ctx.fill();

    // Faint champagne haze ONLY: a very dim, small central wash so the middle
    // is not a black hole but stays clearly darker than the ribbons. Kept low
    // so the center reads as a hollow, per the ref.
    var hazeR = R * 0.85;
    var haze = ctx.createRadialGradient(0, 0, 0, 0, 0, hazeR);
    haze.addColorStop(0, rgba(CHAMPAGNE, 0.055 * bright));
    haze.addColorStop(0.5, rgba(GOLD, 0.03 * bright));
    haze.addColorStop(1, rgba(GOLD, 0));
    ctx.fillStyle = haze;
    ctx.beginPath();
    ctx.arc(0, 0, hazeR, 0, TWO_PI);
    ctx.fill();

    // Draw every ribbon. Additive overlap of many thin loops builds the dense
    // woven ball; round caps/joins keep each trail a smooth ribbon of light.
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (var i = 0; i < RIBBONS.length; i++) {
      var rb = RIBBONS[i];
      var head = rb.phase + t * rb.spin;
      drawRibbon(rb, R, head, bright);
    }

    ctx.shadowBlur = 0;
  }

  function frame() {
    measure();
    if (!cssSize) { schedule(); return; }
    renderKnot();
    schedule();
  }

  function tick(now) {
    if (!running) return;
    if (!last) last = now;
    var dt = (now - last) / 1000;
    last = now;
    if (dt > 0.05) dt = 0.05;   // clamp after a backgrounded tab
    readState(dt);
    var rate = driveSpeed;
    t += dt * rate;
    precess += dt * 0.16 * rate;    // slow continuous yaw, always
    precessX += dt * 0.055 * rate;  // gentle tumble, always
    frame();
  }

  function schedule() {
    if (!running) return;
    rafId = window.requestAnimationFrame(tick);
  }

  function start() {
    if (running) return;
    if (document.hidden) return;
    if (reduceQuery.matches) { staticFrame(); return; }
    running = true;
    last = 0;
    rafId = window.requestAnimationFrame(tick);
  }

  function stop() {
    running = false;
    if (rafId) window.cancelAnimationFrame(rafId);
    rafId = 0;
  }

  // A single static frame for reduced-motion.
  function staticFrame() {
    running = false;
    t = 2.4;
    precess = 0.5;
    precessX = 0.2;
    driveBright = 1.12;
    driveScale = 1.0;
    drivePulse = 0.0;
    try { frameOnce(); } catch (e) {}
  }

  function frameOnce() {
    measure();
    if (!cssSize) return;
    var saved = running;
    running = false;
    renderKnot();
    running = saved;
  }

  // --- lifecycle wiring ---
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      stop();
    } else if (!reduceQuery.matches) {
      start();
    }
  });

  if (reduceQuery.addEventListener) {
    reduceQuery.addEventListener('change', function () {
      if (reduceQuery.matches) { stop(); staticFrame(); }
      else { start(); }
    });
  }

  window.addEventListener('resize', function () {
    if (!running) { try { measure(); frameOnce(); } catch (e) {} }
  });

  // Self-contained proof hook: advances N frames of simulated time and
  // returns a PNG data URL. Pure read, safe to leave shipped. Optional
  // stateClass string temporarily forces a state for the proof render.
  window.__orbProof = function (frames, step, stateClass) {
    try {
      var f = frames || 60;
      var s = step || 0.033;
      var savedT = t, savedPre = precess, savedPreX = precessX, savedRun = running;
      var savedB = driveBright, savedS = driveSpeed, savedSc = driveScale, savedP = drivePulse;
      var addedClass = null;
      if (stateClass && host && host.classList && !host.classList.contains(stateClass)) {
        host.classList.add(stateClass);
        addedClass = stateClass;
      }
      running = false;
      t = 0; precess = 0; precessX = 0;
      driveBright = 1; driveSpeed = 1; driveScale = 1; drivePulse = 0;
      for (var i = 0; i < f; i++) {
        readState(s);
        t += s * driveSpeed;
        precess += s * 0.16 * driveSpeed;
        precessX += s * 0.055 * driveSpeed;
        frameOnce();
      }
      var url = canvas.toDataURL('image/png');
      if (addedClass) host.classList.remove(addedClass);
      t = savedT; precess = savedPre; precessX = savedPreX; running = savedRun;
      driveBright = savedB; driveSpeed = savedS; driveScale = savedSc; drivePulse = savedP;
      if (savedRun) { running = false; start(); }
      return url;
    } catch (e) { return null; }
  };

  function boot() {
    measure();
    if (reduceQuery.matches) { staticFrame(); }
    else { start(); }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
