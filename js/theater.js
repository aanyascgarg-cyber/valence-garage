/* ============================================================
   VALENCE GARAGE. Engineering theater. js/theater.js

   A live force diagram inside the Engineering panel: the side
   profile of the current machine (reusing window.CarArt) with
   animated vector arrows for the three forces the panel's
   formulas describe, all evaluated at the panel's reference
   speed of 200 km/h:

     DRAG       rearward teal arrow, F = 0.5 rho CdA v^2
     DOWNFORCE  downward gold arrow, F = 0.5 rho ClA v^2
     GRIP       champagne contact-patch glow, scales with mu

   Arrows re-tween as the sliders move (critically damped lerp,
   one rAF owner, snaps under prefers-reduced-motion). Labels
   roll through window.VGMotion.setNum when available.

   API: window.Theater.update(physics, config). Called by app.js
   updateEngineering(). Creates its own DOM lazily inside
   #eng-body .eng-inner on first update. Never throws.
   ============================================================ */
(function () {
  'use strict';

  var SVGNS = 'http://www.w3.org/2000/svg';

  // Palette (mirrors style.css :root).
  var TEAL = '#2C96AA';
  var GOLD = '#C9A84C';
  var CHAMPAGNE = '#E8D5A0';

  // Reference speed for every vector: 200 km/h = 55.6 m/s (the same
  // convention the downforce formula line in the panel uses).
  var V_REF = 55.6;

  // Outer stage viewBox 0 0 400 200. CarArt draws in 400 x 170; nested
  // at x 50, y 48, scaled 0.75: outerX = 50 + 0.75x, outerY = 48 + 0.75y.
  var CAR_X = 50, CAR_Y = 48, CAR_S = 0.75;
  var GROUND_Y = CAR_Y + 150 * CAR_S;          // 160.5
  var REAR_WHEEL_X = CAR_X + 108 * CAR_S;      // 131
  var FRONT_WHEEL_X = CAR_X + 288 * CAR_S;     // 266
  var ROOF_Y = CAR_Y + 56 * CAR_S;             // ~90, arrow tip target
  var BODY_MID_Y = CAR_Y + 92 * CAR_S;         // ~117, drag arrow height
  var DRAG_X0 = CAR_X + 26 * CAR_S;            // just behind the tail (~69.5)

  // Force -> pixel normalization. Drag at 200 km/h spans ~1.3 to 2.5 kN
  // (CdA 0.70 to 1.30); downforce spans 0 to ~6.4 kN (ClA 0 to 3.4).
  var DRAG_PX_PER_N = 55 / 2500;    // ~29 to 55 px
  var DOWN_PX_PER_N = 58 / 6500;    // 0 to ~58 px
  var DRAG_MIN_PX = 16;             // an arrow is never a stub

  var built = false;
  var nodes = null;      // svg element references
  var lastCarKey = '';   // carId|accent|tire|wing, to re-render the glyph

  // Current and target animated values.
  var cur = { drag: 0, down: 0, trac: 0.2 };
  var goal = { drag: 0, down: 0, trac: 0.2 };
  var rafId = 0;
  var lastT = 0;

  function reduced() {
    try {
      return window.matchMedia &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch (e) { return false; }
  }

  function el(tag, attrs) {
    var n = document.createElementNS(SVGNS, tag);
    for (var k in attrs) n.setAttribute(k, attrs[k]);
    return n;
  }

  function setNum(target, text) {
    if (window.VGMotion) window.VGMotion.setNum(target, text);
    else target.textContent = text;
  }

  function fmtN(n) {
    n = Math.round(n);
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  // ---- DOM construction ---------------------------------------------------

  function build() {
    var inner = document.querySelector('#eng-body .eng-inner');
    if (!inner) return false;

    var wrap = document.createElement('div');
    wrap.className = 'eng-diagram';
    wrap.setAttribute('aria-hidden', 'true');

    var svg = el('svg', {
      viewBox: '0 0 400 200',
      preserveAspectRatio: 'xMidYMid meet'
    });

    // Nested svg that CarArt renders the current machine into.
    var carSvg = el('svg', {
      x: CAR_X, y: CAR_Y,
      width: 400 * CAR_S, height: 170 * CAR_S,
      viewBox: '0 0 400 170'
    });
    svg.appendChild(carSvg);

    // GRIP: contact patch glows under both wheels (under the arrows).
    var tracRear = el('ellipse', {
      cx: REAR_WHEEL_X, cy: GROUND_Y + 3, rx: 22, ry: 4.5,
      fill: CHAMPAGNE, opacity: 0.2
    });
    var tracFront = el('ellipse', {
      cx: FRONT_WHEEL_X, cy: GROUND_Y + 3, rx: 22, ry: 4.5,
      fill: CHAMPAGNE, opacity: 0.2
    });
    svg.appendChild(tracRear);
    svg.appendChild(tracFront);

    // DRAG: rearward arrow behind the tail.
    var dragLine = el('line', {
      x1: DRAG_X0, y1: BODY_MID_Y, x2: DRAG_X0 - 30, y2: BODY_MID_Y,
      stroke: TEAL, 'stroke-width': 2.4, 'stroke-linecap': 'round',
      opacity: 0.9
    });
    var dragHead = el('polygon', { fill: TEAL, opacity: 0.9, points: '' });
    svg.appendChild(dragLine);
    svg.appendChild(dragHead);

    // DOWNFORCE: arrow pressing down onto the roof, car-centered.
    var downLine = el('line', {
      x1: 200, y1: ROOF_Y - 40, x2: 200, y2: ROOF_Y - 7,
      stroke: GOLD, 'stroke-width': 2.4, 'stroke-linecap': 'round',
      opacity: 0.95
    });
    var downHead = el('polygon', { fill: GOLD, opacity: 0.95, points: '' });
    svg.appendChild(downLine);
    svg.appendChild(downHead);

    // Labels. Tiny engineering plate lettering, live values.
    function label(x, y, fill, anchor) {
      var t = el('text', {
        x: x, y: y, fill: fill, 'text-anchor': anchor || 'start',
        'font-family': "'Montserrat', system-ui, sans-serif",
        'font-size': '9.5', 'font-weight': '600', 'letter-spacing': '1.4'
      });
      return t;
    }
    var dragLabel = label(12, BODY_MID_Y - 14, TEAL);
    dragLabel.textContent = 'DRAG';
    var dragVal = label(12, BODY_MID_Y + 22, TEAL);
    var downLabel = label(200, 18, GOLD, 'middle');
    downLabel.textContent = 'DOWNFORCE';
    var downVal = label(200, 32, GOLD, 'middle');
    var tracVal = label(200, GROUND_Y + 22, CHAMPAGNE, 'middle');

    svg.appendChild(dragLabel);
    svg.appendChild(dragVal);
    svg.appendChild(downLabel);
    svg.appendChild(downVal);
    svg.appendChild(tracVal);

    // Reference-speed footnote, right-aligned on the ground line.
    var note = label(390, GROUND_Y + 22, 'rgba(232,200,180,0.5)', 'end');
    note.textContent = 'FORCES AT 200 KM/H';
    svg.appendChild(note);

    wrap.appendChild(svg);
    inner.insertBefore(wrap, inner.firstChild);

    nodes = {
      carSvg: carSvg,
      tracRear: tracRear, tracFront: tracFront,
      dragLine: dragLine, dragHead: dragHead,
      downLine: downLine, downHead: downHead,
      dragVal: dragVal, downVal: downVal, tracVal: tracVal
    };
    built = true;
    return true;
  }

  // ---- drawing --------------------------------------------------------------

  function draw() {
    var n = nodes;

    // Drag arrow: tip to the LEFT (rearward; the car noses right).
    var dLen = Math.max(DRAG_MIN_PX, cur.drag);
    var tipX = DRAG_X0 - dLen;
    n.dragLine.setAttribute('x2', (tipX + 6).toFixed(1));
    n.dragHead.setAttribute('points',
      tipX.toFixed(1) + ',' + BODY_MID_Y + ' ' +
      (tipX + 9).toFixed(1) + ',' + (BODY_MID_Y - 4.5) + ' ' +
      (tipX + 9).toFixed(1) + ',' + (BODY_MID_Y + 4.5));

    // Downforce arrow: tip at the roof, tail rises with force. Fades to a
    // whisper when there is no wing rather than vanishing (layout stays).
    var vLen = cur.down;
    var show = vLen > 2;
    var tailY = ROOF_Y - 7 - Math.max(vLen, 10);
    n.downLine.setAttribute('y1', tailY.toFixed(1));
    n.downLine.setAttribute('y2', (ROOF_Y - 8).toFixed(1));
    n.downHead.setAttribute('points',
      '200,' + (ROOF_Y - 1) + ' 195.5,' + (ROOF_Y - 10) + ' 204.5,' + (ROOF_Y - 10));
    var wingOp = show ? 0.95 : 0.22;
    n.downLine.setAttribute('opacity', wingOp);
    n.downHead.setAttribute('opacity', wingOp);

    // Grip glow.
    n.tracRear.setAttribute('opacity', cur.trac.toFixed(2));
    n.tracFront.setAttribute('opacity', cur.trac.toFixed(2));
  }

  function step(now) {
    var dt = Math.min(64, now - (lastT || now));
    lastT = now;
    // Critically damped approach: smooth under rapid slider input.
    var k = 1 - Math.exp(-dt / 90);
    var done = true;
    ['drag', 'down', 'trac'].forEach(function (key) {
      var d = goal[key] - cur[key];
      if (Math.abs(d) > 0.2) done = false;
      cur[key] += d * k;
    });
    if (done) {
      cur.drag = goal.drag; cur.down = goal.down; cur.trac = goal.trac;
      draw();
      rafId = 0;
      lastT = 0;
      return;
    }
    draw();
    rafId = window.requestAnimationFrame(step);
  }

  // ---- public API -------------------------------------------------------------

  function update(p, cfg) {
    if (!p || !p.eng || !cfg) return;
    if (!built && !build()) return;

    var e = p.eng;
    var rho = (window.Physics && window.Physics.RHO) || 1.225;
    var dragN = 0.5 * rho * e.CdA * V_REF * V_REF;
    var downN = e.downAt200 || (0.5 * rho * e.ClA * V_REF * V_REF);

    // Re-render the car glyph only when its look actually changes.
    var carKey = [cfg.carId, cfg.accent, cfg.tireIndex, cfg.wingLevel].join('|');
    if (carKey !== lastCarKey && window.CarArt) {
      lastCarKey = carKey;
      try { window.CarArt.render(nodes.carSvg, cfg); } catch (err) { }
    }

    goal.drag = dragN * DRAG_PX_PER_N;
    goal.down = downN * DOWN_PX_PER_N;
    goal.trac = 0.16 + ((e.mu - 0.85) / 0.4) * 0.5;

    setNum(nodes.dragVal, fmtN(dragN) + ' N');
    setNum(nodes.downVal, fmtN(downN) + ' N');
    setNum(nodes.tracVal, 'GRIP mu ' + e.mu.toFixed(2));

    if (reduced()) {
      cur.drag = goal.drag; cur.down = goal.down; cur.trac = goal.trac;
      draw();
      return;
    }
    if (!rafId) rafId = window.requestAnimationFrame(step);
  }

  window.Theater = {
    update: function (p, cfg) { try { update(p, cfg); } catch (e) { } }
  };
})();
