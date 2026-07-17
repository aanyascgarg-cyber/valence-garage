/* ============================================================
   VALENCE GARAGE. Realistic volumetric fog. js/fog.js
   Self-contained, no deps. Draws layered value-noise fractal fog
   (5 octaves) tinted from the teal tokens into a fullscreen fixed
   canvas (#fog-canvas) behind #app. Target look: the BMW "Discover
   Your Perfect Car" atmosphere: cold, cinematic, volumetric, a
   dominant luminous mass upper-left, a soft pocket lower-right,
   dense low fog fading upward, and a baked corner vignette.

   Motion: slow time-evolved redraw capped at ~12 fps with a
   visibility pause. prefers-reduced-motion renders one static frame.
   Never rAF-heavy. Exposes window.__fogProof() -> canvas.toDataURL.
   ============================================================ */
(function () {
  'use strict';

  // ---- Teal palette (mirrors the style.css :root fog tokens) ----
  // void   #04090B  abyss #07161B  teal-fog #17545F
  // teal-glow #2C96AA  ice #9FE8F0
  var COL = {
    voidR: 4,   voidG: 9,   voidB: 11,
    abyssR: 7,  abyssG: 22, abyssB: 27,
    fogR: 23,   fogG: 84,   fogB: 95,
    glowR: 44,  glowG: 150, glowB: 170,
    iceR: 159,  iceG: 232,  iceB: 240
  };

  // Render the noise field at a low internal resolution and let the
  // canvas scale it up. Fog has no high-frequency detail, so this reads
  // as soft volumetric haze and stays cheap. ~200px longest edge.
  var NW = 0, NH = 0;          // noise buffer dimensions
  var BASE = 300;             // target longest edge of the noise buffer
  var noiseCanvas = null;     // offscreen buffer we draw noise into
  var noiseCtx = null;
  var img = null;             // ImageData for the noise buffer

  var canvas = null;          // the on-screen fog canvas
  var ctx = null;
  var dpr = 1;

  var perm = new Uint8Array(512);   // value-noise permutation
  var grad = new Float32Array(256); // per-cell random value for value noise

  var t = 0;                  // slow evolving time
  var running = false;
  var lastDraw = 0;
  var reduceMotion = false;
  var rafId = 0;

  // ---------- value noise ----------
  function seedNoise(seed) {
    // deterministic LCG so the field is stable across reloads
    var s = seed >>> 0;
    function rnd() {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    }
    var i, p = new Uint8Array(256);
    for (i = 0; i < 256; i++) { p[i] = i; grad[i] = rnd(); }
    for (i = 255; i > 0; i--) {
      var j = (rnd() * (i + 1)) | 0;
      var tmp = p[i]; p[i] = p[j]; p[j] = tmp;
    }
    for (i = 0; i < 512; i++) perm[i] = p[i & 255];
  }

  function fade(x) { return x * x * x * (x * (x * 6 - 15) + 10); }
  function lerp(a, b, x) { return a + (b - a) * x; }

  // 2D value noise in [0,1]
  function vnoise(x, y) {
    var xi = Math.floor(x) & 255;
    var yi = Math.floor(y) & 255;
    var xf = x - Math.floor(x);
    var yf = y - Math.floor(y);
    var u = fade(xf), v = fade(yf);
    var aa = grad[perm[perm[xi] + yi] & 255];
    var ba = grad[perm[perm[xi + 1] + yi] & 255];
    var ab = grad[perm[perm[xi] + yi + 1] & 255];
    var bb = grad[perm[perm[xi + 1] + yi + 1] & 255];
    var x1 = lerp(aa, ba, u);
    var x2 = lerp(ab, bb, u);
    return lerp(x1, x2, v);
  }

  // fractal brownian motion, 5 octaves
  function fbm(x, y) {
    var value = 0, amp = 0.5, freq = 1, norm = 0;
    for (var o = 0; o < 5; o++) {
      value += amp * vnoise(x * freq, y * freq);
      norm += amp;
      freq *= 2.02;
      amp *= 0.52;
    }
    return value / norm; // ~[0,1]
  }

  function smoothstep(e0, e1, x) {
    var tt = (x - e0) / (e1 - e0);
    if (tt < 0) tt = 0; else if (tt > 1) tt = 1;
    return tt * tt * (3 - 2 * tt);
  }

  // ---------- build one noise frame into the offscreen buffer ----------
  function renderNoise(time) {
    if (!img) return;
    var data = img.data;
    var w = NW, h = NH;
    // Two decorrelated fbm samples cross-drift to give the fog "billows"
    // that evolve without obvious repetition. Scale chosen so ~2.5
    // billows span the width.
    var scale = 3.0;
    var dxA = time * 0.06, dyA = time * 0.018;
    var dxB = -time * 0.035, dyB = time * 0.05;

    // Warm luminous mass centre (upper-left) and cool pocket (lower-right)
    // expressed in normalised [0,1] canvas space.
    var massX = 0.30, massY = 0.24;   // dominant upper-left bloom
    var pocketX = 0.82, pocketY = 0.86;

    var i = 0;
    for (var y = 0; y < h; y++) {
      var ny = y / h;
      for (var x = 0; x < w; x++) {
        var nx = x / w;

        // fractal fog density, domain-warped by a second fbm for curl
        var wx = fbm(nx * scale + dxA, ny * scale + dyA);
        var wy = fbm(nx * scale + 5.2 - dxB, ny * scale + 1.7 - dyB);
        var d = fbm(nx * scale + wx * 0.9 + dxB,
                    ny * scale + wy * 0.9 + dyB);

        // Vertical density profile: dense low, thinning upward, but keep
        // a soft ceiling of haze so the top is never empty black.
        var vert = 0.28 + 0.72 * smoothstep(0.0, 1.0, ny);
        d = d * (0.35 + 0.9 * vert);

        // Dominant luminous mass upper-left: a broad soft radial that
        // both brightens and thickens the fog there.
        var mdx = (nx - massX), mdy = (ny - massY);
        var mDist = Math.sqrt(mdx * mdx * 1.15 + mdy * mdy * 1.9);
        var mass = smoothstep(0.85, 0.0, mDist); // 1 at centre -> 0 far

        // Soft secondary pocket lower-right (dimmer, cooler).
        var pdx = (nx - pocketX), pdy = (ny - pocketY);
        var pDist = Math.sqrt(pdx * pdx * 1.2 + pdy * pdy * 1.4);
        var pocket = smoothstep(0.7, 0.0, pDist);

        // Composite luminance driver: base fog + mass bloom.
        var lum = d * 0.55 + mass * 0.6 + pocket * 0.16;
        if (lum > 1) lum = 1;

        // Density (alpha) so fog thickens in the mass and near the floor.
        var alpha = d * (0.5 + 0.5 * vert) + mass * 0.45 + pocket * 0.14;
        alpha = smoothstep(0.04, 0.95, alpha);

        // ---- tint: interpolate abyss -> teal-fog -> teal-glow -> ice ----
        // low luminance = deep abyss teal, mid = teal fog, highs near the
        // mass push toward luminous glow and a whisper of ice.
        var r, g, b;
        if (lum < 0.45) {
          var k = lum / 0.45;
          r = lerp(COL.abyssR, COL.fogR, k);
          g = lerp(COL.abyssG, COL.fogG, k);
          b = lerp(COL.abyssB, COL.fogB, k);
        } else if (lum < 0.8) {
          var k2 = (lum - 0.45) / 0.35;
          r = lerp(COL.fogR, COL.glowR, k2);
          g = lerp(COL.fogG, COL.glowG, k2);
          b = lerp(COL.fogB, COL.glowB, k2);
        } else {
          var k3 = (lum - 0.8) / 0.2;
          r = lerp(COL.glowR, COL.iceR, k3 * 0.6);
          g = lerp(COL.glowG, COL.iceG, k3 * 0.6);
          b = lerp(COL.glowB, COL.iceB, k3 * 0.6);
        }

        data[i]     = r | 0;
        data[i + 1] = g | 0;
        data[i + 2] = b | 0;
        data[i + 3] = (alpha * 255) | 0;
        i += 4;
      }
    }
    noiseCtx.putImageData(img, 0, 0);
  }

  // ---------- composite noise + baked gradients + vignette on screen ----
  function composite() {
    var w = canvas.width, h = canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);

    // 1. deep base fill (void -> abyss vertical) so nothing is pure black
    var base = ctx.createLinearGradient(0, 0, 0, h);
    base.addColorStop(0, 'rgb(6,14,18)');
    base.addColorStop(0.55, 'rgb(5,11,14)');
    base.addColorStop(1, 'rgb(3,7,9)');
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);

    // 2. the upscaled noise fog buffer (smoothed by the browser)
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.92;
    ctx.drawImage(noiseCanvas, 0, 0, NW, NH, 0, 0, w, h);
    ctx.globalAlpha = 1;

    // 3. dominant luminous mass bloom, upper-left, additive teal glow
    ctx.globalCompositeOperation = 'lighter';
    var mx = w * 0.30, my = h * 0.24;
    var mr = Math.max(w, h) * 0.72;
    var mass = ctx.createRadialGradient(mx, my, mr * 0.02, mx, my, mr);
    mass.addColorStop(0, 'rgba(64,168,188,0.34)');
    mass.addColorStop(0.28, 'rgba(44,150,170,0.20)');
    mass.addColorStop(0.6, 'rgba(23,84,95,0.07)');
    mass.addColorStop(1, 'rgba(23,84,95,0)');
    ctx.fillStyle = mass;
    ctx.fillRect(0, 0, w, h);

    // 4. soft cool pocket, lower-right, dimmer but present
    var px = w * 0.83, py = h * 0.82;
    var pr = Math.max(w, h) * 0.46;
    var pocket = ctx.createRadialGradient(px, py, pr * 0.02, px, py, pr);
    pocket.addColorStop(0, 'rgba(38,132,150,0.22)');
    pocket.addColorStop(0.45, 'rgba(24,86,98,0.09)');
    pocket.addColorStop(1, 'rgba(20,70,80,0)');
    ctx.fillStyle = pocket;
    ctx.fillRect(0, 0, w, h);

    // 5. dense floor haze: a rising bank at the bottom for depth
    ctx.globalCompositeOperation = 'source-over';
    var floor = ctx.createLinearGradient(0, h, 0, h * 0.45);
    floor.addColorStop(0, 'rgba(20,74,84,0.30)');
    floor.addColorStop(0.5, 'rgba(14,50,58,0.12)');
    floor.addColorStop(1, 'rgba(14,50,58,0)');
    ctx.fillStyle = floor;
    ctx.fillRect(0, 0, w, h);

    // 6. baked corner vignette (heavy edge falloff, frames the content).
    // Scaled radial so it darkens the left/right edges as hard as the
    // corners regardless of aspect ratio (matches the ref framing).
    var cx = w * 0.5, cy = h * 0.5;
    var maxR = Math.max(w, h) * 0.72;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(w >= h ? w / h : 1, h > w ? h / w : 1);
    var vig = ctx.createRadialGradient(0, 0, maxR * 0.28, 0, 0, maxR);
    vig.addColorStop(0, 'rgba(2,5,7,0)');
    vig.addColorStop(0.5, 'rgba(2,5,7,0.14)');
    vig.addColorStop(0.78, 'rgba(2,4,6,0.52)');
    vig.addColorStop(1, 'rgba(1,3,4,0.92)');
    ctx.fillStyle = vig;
    ctx.fillRect(-w, -h, w * 2, h * 2);
    ctx.restore();

    ctx.globalCompositeOperation = 'source-over';
  }

  function drawFrame(time) {
    renderNoise(time);
    composite();
  }

  // ---------- sizing ----------
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    // A hidden or pre-layout tab can report a 0x0 viewport; 0/0 aspect is
    // NaN and NaN slips through Math.max into createImageData. Clamp.
    var w = Math.max(1, window.innerWidth);
    var h = Math.max(1, window.innerHeight);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';

    // noise buffer sized to the aspect, longest edge ~BASE
    var aspect = w / h;
    if (aspect >= 1) { NW = BASE; NH = Math.max(1, Math.round(BASE / aspect)); }
    else { NH = BASE; NW = Math.max(1, Math.round(BASE * aspect)); }
    noiseCanvas.width = NW;
    noiseCanvas.height = NH;
    img = noiseCtx.createImageData(NW, NH);

    drawFrame(t); // repaint immediately at the new size
  }

  // ---------- animation loop (throttled ~12fps) ----------
  var FRAME_MS = 1000 / 12;
  function loop(now) {
    if (!running) return;
    rafId = requestAnimationFrame(loop);
    if (now - lastDraw < FRAME_MS) return;
    lastDraw = now;
    t += 0.02; // slow evolution
    drawFrame(t);
  }

  function start() {
    if (running || reduceMotion) return;
    running = true;
    lastDraw = 0;
    rafId = requestAnimationFrame(loop);
  }

  function stop() {
    running = false;
    if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
  }

  function onVisibility() {
    if (document.hidden) stop();
    else if (!reduceMotion) start();
  }

  function init() {
    canvas = document.getElementById('fog-canvas');
    if (!canvas) return;
    ctx = canvas.getContext('2d');
    noiseCanvas = document.createElement('canvas');
    noiseCtx = noiseCanvas.getContext('2d', { willReadFrequently: true });

    var mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    reduceMotion = mq.matches;

    seedNoise(1337);
    resize();

    window.addEventListener('resize', resize, { passive: true });
    document.addEventListener('visibilitychange', onVisibility);
    if (mq.addEventListener) {
      mq.addEventListener('change', function (e) {
        reduceMotion = e.matches;
        if (reduceMotion) { stop(); drawFrame(t); }
        else start();
      });
    }

    if (!reduceMotion) start();
  }

  // QA hook: returns the current fog canvas as a PNG dataURL.
  window.__fogProof = function () {
    if (!canvas) return null;
    // ensure at least one frame exists
    if (canvas.width === 0) return null;
    return canvas.toDataURL('image/png');
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
