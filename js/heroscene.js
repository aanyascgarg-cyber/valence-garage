/* heroscene.js. Valence Garage v6 hero scene.
 * Paints the deep blue night arch-portal composition from the ref into a
 * container as a single canvas layer, with the user's car snapshot composited
 * in front. Self-contained classic script. Static (no animation loop), device
 * pixel ratio aware, re-renders on container resize. Never throws.
 *
 * window.HeroScene.render(containerEl, opts)
 *   opts = { carImgSrc: dataURL|null, carName: string }
 */
(function () {
  'use strict';

  // Palette. Deep blue night, cyan-blue portal rim.
  var SKY_TOP = '#0A1622';
  var SKY_MID = '#0D1E2E';
  var SKY_BOT = '#12283A';
  var RIM = 'rgba(150,224,240,';   // cyan-blue portal rim
  var RIM_DEEP = 'rgba(70,150,190,';
  var HAZE = 'rgba(120,190,220,';

  // Per-container bookkeeping so we can rebuild cleanly and observe resizes.
  var STORE = '__heroSceneState';

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  // Ensure a canvas exists inside the container, UNDER any car <img>. Returns
  // the canvas or null when the environment is unusable.
  function ensureCanvas(container) {
    if (!container) return null;
    var cv = container.querySelector('canvas.hero-scene-canvas');
    if (!cv) {
      try {
        cv = document.createElement('canvas');
      } catch (e) { return null; }
      cv.className = 'hero-scene-canvas';
      cv.setAttribute('aria-hidden', 'true');
      cv.style.position = 'absolute';
      cv.style.inset = '0';
      cv.style.width = '100%';
      cv.style.height = '100%';
      cv.style.display = 'block';
      cv.style.zIndex = '0';           // sit under the car image / meta
      cv.style.pointerEvents = 'none';
      // Make sure the container can position an absolute child.
      try {
        var pos = window.getComputedStyle(container).position;
        if (pos === 'static') container.style.position = 'relative';
      } catch (e2) {}
      // Insert as the first child so it is visually behind everything else.
      if (container.firstChild) container.insertBefore(cv, container.firstChild);
      else container.appendChild(cv);
    }
    return cv;
  }

  // Draw the full scene into ctx for a WxH logical (css-pixel) area.
  function paintScene(ctx, W, H, carImg, hasCar) {
    ctx.clearRect(0, 0, W, H);

    // ---- night sky gradient -------------------------------------------
    var sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, SKY_TOP);
    sky.addColorStop(0.55, SKY_MID);
    sky.addColorStop(1, SKY_BOT);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    // Scene geometry. The arch is a large portal centred a little above the
    // horizon; the horizon sits where the ground glow / car base lives.
    var cx = W * 0.5;
    // Arch radius scaled to fit the frame with margins. Allow it to grow with
    // height so tall/portrait containers still get a large portal instead of a
    // tiny arch stranded in a sea of sky.
    var archR = Math.min(W * 0.46, H * 0.44);
    // Horizon sits below the arch centre. Keep a foreground band (for ground
    // glow + car) proportional to archR, and centre the whole composition
    // vertically so extra height reads as balanced sky above and floor below.
    var foreground = archR * 0.42;   // space under the horizon for the car base
    var composH = archR + foreground; // arch top to floor
    var topPad = (H - composH) * 0.5;
    topPad = clamp(topPad, 0, H * 0.32); // cap sky so it never dominates
    var horizonY = topPad + archR;
    var archCy = horizonY;            // arch springs from the horizon line

    // ---- atmospheric interior haze behind the arch --------------------
    var haze = ctx.createRadialGradient(cx, archCy - archR * 0.35, archR * 0.05,
                                        cx, archCy - archR * 0.35, archR * 1.05);
    haze.addColorStop(0, HAZE + '0.30)');
    haze.addColorStop(0.45, HAZE + '0.12)');
    haze.addColorStop(1, HAZE + '0)');
    ctx.fillStyle = haze;
    ctx.fillRect(0, 0, W, H);

    // ---- vertical light columns at both edges (equalizer bars) --------
    paintColumns(ctx, W, H, horizonY, archR);

    // ---- the glowing arch ring ----------------------------------------
    // Clip mountains to the inside of the arch so they read as "inside" it.
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, archCy, archR, Math.PI, 0, false); // upper semicircle
    ctx.lineTo(cx + archR, horizonY);
    ctx.lineTo(cx - archR, horizonY);
    ctx.closePath();
    ctx.clip();

    // interior fill: slightly brighter than sky so the portal glows within.
    // Centred high and faded to zero before the horizon so the clip bottom
    // does not leave a visible brightness seam.
    var inner = ctx.createRadialGradient(cx, archCy - archR * 0.5, archR * 0.05,
                                         cx, archCy - archR * 0.5, archR * 1.15);
    inner.addColorStop(0, 'rgba(34,72,98,0.50)');
    inner.addColorStop(0.55, 'rgba(20,46,66,0.26)');
    inner.addColorStop(0.85, 'rgba(14,32,48,0.06)');
    inner.addColorStop(1, 'rgba(12,28,42,0.0)');
    ctx.fillStyle = inner;
    ctx.fillRect(0, 0, W, H);

    paintMountains(ctx, cx, horizonY, archR);
    ctx.restore();

    // Rim light of the arch. Drawn as several stacked strokes for bloom.
    paintArchRim(ctx, cx, archCy, archR);

    // ---- ground glow pool under the car spot --------------------------
    paintGround(ctx, W, H, cx, horizonY, archR, hasCar);

    // ---- the car snapshot in front ------------------------------------
    if (hasCar && carImg) paintCar(ctx, W, H, cx, horizonY, carImg);

    // ---- vignette -----------------------------------------------------
    paintVignette(ctx, W, H);
  }

  function paintColumns(ctx, W, H, horizonY, archR) {
    var count = 5;
    var maxA = 0.10;
    ctx.save();
    for (var side = 0; side < 2; side++) {
      var dir = side === 0 ? 1 : -1;
      var baseX = side === 0 ? W * 0.03 : W * 0.97;
      for (var i = 0; i < count; i++) {
        var x = baseX + dir * i * (W * 0.022);
        // Height tapers toward the centre so edges are tallest. Bounded to the
        // arch scale so tall containers do not get columns running off-frame.
        var h = archR * (1.55 - i * 0.18);
        var top = Math.max(horizonY - h, H * 0.02);
        var w = Math.max(2, W * 0.007);
        var g = ctx.createLinearGradient(0, top, 0, horizonY);
        var a = maxA * (1 - i * 0.14);
        g.addColorStop(0, HAZE + '0)');
        g.addColorStop(0.4, HAZE + (a * 0.6).toFixed(3) + ')');
        g.addColorStop(1, HAZE + a.toFixed(3) + ')');
        ctx.fillStyle = g;
        ctx.fillRect(x - w / 2, top, w, h);
      }
    }
    ctx.restore();
  }

  // Three receding mountain silhouette layers inside the arch.
  function paintMountains(ctx, cx, horizonY, archR) {
    var left = cx - archR;
    var right = cx + archR;
    var span = right - left;

    var layers = [
      { color: 'rgba(30,66,92,0.72)', base: horizonY + archR * 0.01, amp: archR * 0.52, seed: 3, peaks: 3 },
      { color: 'rgba(20,48,68,0.85)', base: horizonY + archR * 0.03, amp: archR * 0.40, seed: 7, peaks: 4 },
      { color: 'rgba(12,30,46,0.95)', base: horizonY + archR * 0.05, amp: archR * 0.26, seed: 11, peaks: 6 }
    ];

    var steps = 48;
    layers.forEach(function (L, li) {
      // Precompute the ridgeline so we can both fill and rim-light it.
      var pts = [];
      for (var i = 0; i <= steps; i++) {
        var t = i / steps;
        var x = left + t * span;
        // Deterministic ridge from summed sines. Peaks cluster toward centre.
        var centreBias = 1 - Math.abs(t - 0.5) * 1.2;
        centreBias = clamp(centreBias, 0, 1);
        var n = Math.sin(t * L.peaks * Math.PI + L.seed)
              + 0.5 * Math.sin(t * L.peaks * 2.3 * Math.PI + L.seed * 1.7)
              + 0.25 * Math.sin(t * L.peaks * 4.1 * Math.PI + L.seed * 0.5);
        n = n / 1.75; // normalize roughly to [-1,1]
        var y = L.base - (0.30 + 0.70 * centreBias) * L.amp * (0.5 + 0.5 * n);
        pts.push([x, y]);
      }
      // Fill the silhouette.
      ctx.beginPath();
      ctx.moveTo(left - 20, horizonY + 60);
      for (var j = 0; j < pts.length; j++) ctx.lineTo(pts[j][0], pts[j][1]);
      ctx.lineTo(right + 20, horizonY + 60);
      ctx.closePath();
      ctx.fillStyle = L.color;
      ctx.fill();
      // Faint atmospheric rim on the ridge crest (back layers brighter, as if
      // catching the portal glow). Skip on the frontmost, darkest layer.
      if (li < 2) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.beginPath();
        for (var k = 0; k < pts.length; k++) {
          if (k === 0) ctx.moveTo(pts[k][0], pts[k][1]);
          else ctx.lineTo(pts[k][0], pts[k][1]);
        }
        ctx.lineWidth = 1.4;
        ctx.strokeStyle = HAZE + (li === 0 ? '0.16)' : '0.10)');
        ctx.stroke();
        ctx.restore();
      }
    });
  }

  function paintArchRim(ctx, cx, cy, r) {
    ctx.save();
    // Outer soft halo.
    var halo = ctx.createRadialGradient(cx, cy, r * 0.88, cx, cy, r * 1.14);
    halo.addColorStop(0, RIM + '0)');
    halo.addColorStop(0.5, RIM + '0.16)');
    halo.addColorStop(1, RIM + '0)');
    ctx.beginPath();
    ctx.arc(cx, cy, r * 1.14, Math.PI, 0, false);
    ctx.lineTo(cx - r * 1.14, cy);
    ctx.fillStyle = halo;
    ctx.fill();

    ctx.globalCompositeOperation = 'lighter';
    // Stacked strokes: wide-dim to thin-bright core, with a gradient along the
    // arc so the crown is brightest and the feet fade into the ground.
    var passes = [
      { w: r * 0.10, a: 0.10, c: RIM_DEEP },
      { w: r * 0.055, a: 0.18, c: RIM_DEEP },
      { w: r * 0.028, a: 0.30, c: RIM },
      { w: r * 0.012, a: 0.55, c: RIM },
      { w: r * 0.005, a: 0.95, c: 'rgba(220,245,255,' }
    ];
    passes.forEach(function (p) {
      var grad = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy - r);
      grad.addColorStop(0, p.c + '0)');
      grad.addColorStop(0.18, p.c + (p.a * 0.75).toFixed(3) + ')');
      grad.addColorStop(0.5, p.c + p.a.toFixed(3) + ')');
      grad.addColorStop(0.82, p.c + (p.a * 0.75).toFixed(3) + ')');
      grad.addColorStop(1, p.c + '0)');
      ctx.beginPath();
      ctx.arc(cx, cy, r, Math.PI, 0, false);
      ctx.lineWidth = p.w;
      ctx.strokeStyle = grad;
      ctx.lineCap = 'round';
      ctx.stroke();
    });
    ctx.restore();
  }

  function paintGround(ctx, W, H, cx, horizonY, archR, hasCar) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    // Broad ground glow pool centred under the car spot.
    var poolW = archR * 1.5;
    var poolH = (H - horizonY) * 1.25;
    var g = ctx.createRadialGradient(cx, horizonY, 2, cx, horizonY, poolW);
    g.addColorStop(0, HAZE + '0.28)');
    g.addColorStop(0.35, HAZE + '0.12)');
    g.addColorStop(1, HAZE + '0)');
    ctx.save();
    ctx.translate(cx, horizonY);
    ctx.scale(1, clamp(poolH / poolW, 0.12, 1));
    ctx.beginPath();
    ctx.arc(0, 0, poolW, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.restore();
    ctx.restore();

    // Soft brightening where mountains meet ground, feathered vertically so
    // there is no hard horizon edge.
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    var band = ctx.createLinearGradient(0, horizonY - archR * 0.06, 0, horizonY + archR * 0.06);
    band.addColorStop(0, RIM + '0)');
    band.addColorStop(0.5, RIM + '0.10)');
    band.addColorStop(1, RIM + '0)');
    ctx.save();
    ctx.beginPath();
    ctx.rect(cx - archR, horizonY - archR * 0.06, archR * 2, archR * 0.12);
    ctx.clip();
    ctx.fillStyle = band;
    ctx.fillRect(cx - archR, horizonY - archR * 0.06, archR * 2, archR * 0.12);
    ctx.restore();
    ctx.restore();
  }

  // Snapshots carry generous transparent margins. Trim to the opaque bounds
  // once per image so every car composites at a consistent, dominant size and
  // its baked shadow actually touches the platform.
  function trimBounds(carImg, iw, ih) {
    if (carImg.__vgTrim) return carImg.__vgTrim;
    var t = { sx: 0, sy: 0, sw: iw, sh: ih };
    try {
      var tc = document.createElement('canvas');
      tc.width = iw; tc.height = ih;
      var tctx = tc.getContext('2d');
      tctx.drawImage(carImg, 0, 0);
      var data = tctx.getImageData(0, 0, iw, ih).data;
      var minX = iw, minY = ih, maxX = -1, maxY = -1;
      for (var yy = 0; yy < ih; yy++) {
        for (var xx = 0; xx < iw; xx++) {
          if (data[(yy * iw + xx) * 4 + 3] > 110) {
            if (xx < minX) minX = xx;
            if (xx > maxX) maxX = xx;
            if (yy < minY) minY = yy;
            if (yy > maxY) maxY = yy;
          }
        }
      }
      if (maxX > minX && maxY > minY) {
        t = { sx: minX, sy: minY, sw: maxX - minX + 1, sh: maxY - minY + 1 };
      }
    } catch (e) {
      // Tainted or unreadable image: fall back to the full frame.
    }
    carImg.__vgTrim = t;
    return t;
  }

  function paintCar(ctx, W, H, cx, horizonY, carImg) {
    var iw = carImg.naturalWidth || carImg.width;
    var ih = carImg.naturalHeight || carImg.height;
    if (!iw || !ih) return;
    var trim = trimBounds(carImg, iw, ih);
    // Normalize sizing units: derive the drawable CSS-space extent from the
    // canvas bitmap and the active transform so car sizing is correct no
    // matter which units the caller passed for W and H.
    var mt = ctx.getTransform ? ctx.getTransform() : null;
    if (mt && mt.a > 0 && mt.d > 0) {
      var cssH = ctx.canvas.height / mt.d;
      horizonY = horizonY * (cssH / H);
      W = ctx.canvas.width / mt.a;
      H = cssH;
      cx = W * 0.5;
    }

    // Fit the trimmed car to a dominant width, base resting on the platform.
    var targetW = W * 0.60;
    var scale = targetW / trim.sw;
    var drawW = trim.sw * scale;
    var drawH = trim.sh * scale;
    // Cap height so tall snapshots do not overflow the widget.
    var maxH = H * 0.50;
    if (drawH > maxH) {
      var s2 = maxH / drawH;
      drawW *= s2; drawH *= s2;
    }
    var baseY = horizonY + (H - horizonY) * 0.42; // base rests on the platform
    var x = cx - drawW / 2;
    var y = baseY - drawH;

    // Soft ground shadow ellipse under the car.
    ctx.save();
    ctx.translate(cx, baseY - drawH * 0.03);
    ctx.scale(1, 0.18);
    var sh = ctx.createRadialGradient(0, 0, 2, 0, 0, drawW * 0.5);
    sh.addColorStop(0, 'rgba(0,0,0,0.55)');
    sh.addColorStop(0.6, 'rgba(0,0,0,0.28)');
    sh.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.beginPath();
    ctx.arc(0, 0, drawW * 0.5, 0, Math.PI * 2);
    ctx.fillStyle = sh;
    ctx.fill();
    ctx.restore();

    // The car itself.
    try {
      ctx.drawImage(carImg, trim.sx, trim.sy, trim.sw, trim.sh, x, y, drawW, drawH);
    } catch (e) {}

    // A faint cyan front-lit pool right under the car, radial so there is no
    // rectangular edge.
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.translate(cx, baseY - drawH * 0.02);
    ctx.scale(1, 0.16);
    var rim = ctx.createRadialGradient(0, 0, 2, 0, 0, drawW * 0.42);
    rim.addColorStop(0, HAZE + '0.16)');
    rim.addColorStop(0.6, HAZE + '0.06)');
    rim.addColorStop(1, HAZE + '0)');
    ctx.beginPath();
    ctx.arc(0, 0, drawW * 0.42, 0, Math.PI * 2);
    ctx.fillStyle = rim;
    ctx.fill();
    ctx.restore();
  }

  function paintVignette(ctx, W, H) {
    var v = ctx.createRadialGradient(W / 2, H * 0.55, Math.min(W, H) * 0.25,
                                     W / 2, H * 0.55, Math.max(W, H) * 0.72);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(0.7, 'rgba(0,0,0,0.10)');
    v.addColorStop(1, 'rgba(5,10,16,0.55)');
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, W, H);
  }

  // Size the canvas backing store to the container at current DPR and paint.
  function draw(state) {
    var container = state.container;
    var cv = state.canvas;
    if (!container || !cv) return;
    var rect;
    try { rect = container.getBoundingClientRect(); } catch (e) { return; }
    var W = Math.max(1, Math.round(rect.width));
    var H = Math.max(1, Math.round(rect.height));
    if (W < 2 || H < 2) return; // not laid out yet
    var dpr = clamp(window.devicePixelRatio || 1, 1, 3);

    if (cv.width !== W * dpr || cv.height !== H * dpr) {
      cv.width = W * dpr;
      cv.height = H * dpr;
    }
    var ctx;
    try { ctx = cv.getContext('2d'); } catch (e) { return; }
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    var hasCar = !!(state.carImg && state.carImgReady);
    try {
      paintScene(ctx, W, H, state.carImg, hasCar);
    } catch (e) {
      // Never throw. Leave whatever was painted.
      if (window.console && console.warn) console.warn('HeroScene paint failed', e);
    }
  }

  function render(container, opts) {
    if (!container) return;
    opts = opts || {};
    var carImgSrc = opts.carImgSrc || null;

    var cv = ensureCanvas(container);
    if (!cv) return;

    var state = container[STORE];
    if (!state) {
      state = container[STORE] = { container: container, canvas: cv };
      // ResizeObserver keeps the scene crisp across widget/viewport changes.
      if (typeof ResizeObserver !== 'undefined') {
        try {
          state.ro = new ResizeObserver(function () { draw(state); });
          state.ro.observe(container);
        } catch (e) {}
      } else {
        state.onResize = function () { draw(state); };
        try { window.addEventListener('resize', state.onResize); } catch (e2) {}
      }
    }
    state.canvas = cv;

    // Load the car image if the source changed.
    if (carImgSrc !== state.carSrc) {
      state.carSrc = carImgSrc;
      state.carImg = null;
      state.carImgReady = false;
      if (carImgSrc) {
        var img = new Image();
        img.onload = function () {
          if (state.carSrc !== carImgSrc) return; // superseded
          state.carImg = img;
          state.carImgReady = true;
          draw(state);
        };
        img.onerror = function () {
          if (state.carSrc !== carImgSrc) return;
          state.carImg = null;
          state.carImgReady = false;
          draw(state);
        };
        try { img.src = carImgSrc; } catch (e) {}
      }
    }

    draw(state);
  }

  window.HeroScene = { render: render };
})();
