/* Valence Garage. window.CarArt
   A single stylized side-profile hypercar drawn into an svg element.
   Editorial luxury silhouette, viewBox 0 0 400 170. No text, no external refs.
   Attaches exactly one global: window.CarArt with method render(svgEl, config). */
(function () {
  'use strict';

  var SVGNS = 'http://www.w3.org/2000/svg';
  var uidCounter = 0;

  // Design tokens used by the drawing.
  var GOLD = '#C9A84C';
  var CHAMPAGNE = '#E8D5A0';
  var RUBY = '#C03030';
  var NEARBLACK = '#0A0303';

  // --- small color helpers -------------------------------------------------

  // Parse a #rgb or #rrggbb hex string to [r, g, b].
  function hexToRgb(hex) {
    var h = String(hex || '').replace('#', '');
    if (h.length === 3) {
      h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    }
    if (h.length !== 6) {
      h = 'C9A84C';
    }
    return [
      parseInt(h.slice(0, 2), 16),
      parseInt(h.slice(2, 4), 16),
      parseInt(h.slice(4, 6), 16)
    ];
  }

  function clamp255(n) {
    return n < 0 ? 0 : n > 255 ? 255 : Math.round(n);
  }

  function rgbToHex(r, g, b) {
    var s = clamp255(r).toString(16);
    var t = clamp255(g).toString(16);
    var u = clamp255(b).toString(16);
    return '#' +
      (s.length < 2 ? '0' + s : s) +
      (t.length < 2 ? '0' + t : t) +
      (u.length < 2 ? '0' + u : u);
  }

  // Lighten a hex color toward white by amount 0..1.
  function lighten(hex, amount) {
    var c = hexToRgb(hex);
    return rgbToHex(
      c[0] + (255 - c[0]) * amount,
      c[1] + (255 - c[1]) * amount,
      c[2] + (255 - c[2]) * amount
    );
  }

  // Mix two hex colors, t is the weight toward b (0..1).
  function mix(hexA, hexB, t) {
    var a = hexToRgb(hexA);
    var b = hexToRgb(hexB);
    return rgbToHex(
      a[0] + (b[0] - a[0]) * t,
      a[1] + (b[1] - a[1]) * t,
      a[2] + (b[2] - a[2]) * t
    );
  }

  // --- svg node helpers ----------------------------------------------------

  function el(name, attrs) {
    var node = document.createElementNS(SVGNS, name);
    if (attrs) {
      for (var k in attrs) {
        if (Object.prototype.hasOwnProperty.call(attrs, k)) {
          node.setAttribute(k, attrs[k]);
        }
      }
    }
    return node;
  }

  // --- gradient defs -------------------------------------------------------

  function buildDefs(accent, suffix) {
    var defs = el('defs');

    var top = lighten(accent, 0.18);
    var mid = accent;
    var bot = mix(accent, NEARBLACK, 0.82);

    var bodyGrad = el('linearGradient', {
      id: 'vg-body-' + suffix,
      x1: '0', y1: '0', x2: '0', y2: '1'
    });
    bodyGrad.appendChild(el('stop', { offset: '0', 'stop-color': top }));
    bodyGrad.appendChild(el('stop', { offset: '0.42', 'stop-color': mid }));
    bodyGrad.appendChild(el('stop', { offset: '1', 'stop-color': bot }));
    defs.appendChild(bodyGrad);

    // Glass canopy gradient, dark smoke into a faint champagne sheen.
    var glassGrad = el('linearGradient', {
      id: 'vg-glass-' + suffix,
      x1: '0', y1: '0', x2: '0', y2: '1'
    });
    glassGrad.appendChild(el('stop', {
      offset: '0', 'stop-color': mix(CHAMPAGNE, '#101014', 0.35)
    }));
    glassGrad.appendChild(el('stop', {
      offset: '1', 'stop-color': '#0B0A0C'
    }));
    defs.appendChild(glassGrad);

    // Tire radial, near black with a slightly lighter crown.
    var tireGrad = el('radialGradient', {
      id: 'vg-tire-' + suffix,
      cx: '0.5', cy: '0.42', r: '0.62'
    });
    tireGrad.appendChild(el('stop', { offset: '0', 'stop-color': '#1B1618' }));
    tireGrad.appendChild(el('stop', { offset: '0.7', 'stop-color': '#0C0A0B' }));
    tireGrad.appendChild(el('stop', { offset: '1', 'stop-color': '#050405' }));
    defs.appendChild(tireGrad);

    return defs;
  }

  // --- wheel construction --------------------------------------------------

  // Build a rim group at origin, then translate into place by caller.
  function buildWheel(cx, cy, tireIndex, suffix) {
    var g = el('g', { transform: 'translate(' + cx + ',' + cy + ')' });

    // Radius of the whole wheel is fixed low, sidewall grows with tireIndex so
    // the rim (bright metal face) shrinks a touch as the tire gets fatter. A
    // smaller wheel keeps the car low and wide rather than a tall 4x4.
    var outerR = 28;
    var sidewall = 3.4 + tireIndex * 1.4;
    var rimR = outerR - sidewall;

    // Tire body.
    g.appendChild(el('circle', {
      cx: 0, cy: 0, r: outerR,
      fill: 'url(#vg-tire-' + suffix + ')'
    }));
    // Subtle top highlight arc on the tire crown.
    g.appendChild(el('path', {
      d: 'M ' + (-outerR + 3) + ' -6 A ' + (outerR - 2) + ' ' + (outerR - 2) +
         ' 0 0 1 ' + (outerR - 3) + ' -6',
      fill: 'none',
      stroke: 'rgba(232,213,160,0.16)',
      'stroke-width': 1.4,
      'stroke-linecap': 'round'
    }));

    // Rim well (dark dish behind the spokes).
    g.appendChild(el('circle', {
      cx: 0, cy: 0, r: rimR,
      fill: '#141013',
      stroke: 'rgba(201,168,76,0.30)',
      'stroke-width': 1
    }));

    // Rim face detail switches by tireIndex.
    if (tireIndex === 0) {
      // 0 Touring: thin elegant multi spoke.
      var spokes = 12;
      for (var i = 0; i < spokes; i++) {
        var a = (Math.PI * 2 / spokes) * i;
        g.appendChild(el('line', {
          x1: Math.cos(a) * 5, y1: Math.sin(a) * 5,
          x2: Math.cos(a) * (rimR - 1.5), y2: Math.sin(a) * (rimR - 1.5),
          stroke: 'rgba(201,168,76,0.55)',
          'stroke-width': 1.1,
          'stroke-linecap': 'round'
        }));
      }
      g.appendChild(el('circle', {
        cx: 0, cy: 0, r: rimR - 1.5,
        fill: 'none',
        stroke: 'rgba(201,168,76,0.22)',
        'stroke-width': 0.9
      }));
    } else if (tireIndex === 1) {
      // 1 Sport: five twin spokes.
      var pairs = 5;
      for (var j = 0; j < pairs; j++) {
        var base = (Math.PI * 2 / pairs) * j;
        var spread = 0.16;
        [base - spread, base + spread].forEach(function (ang) {
          g.appendChild(el('line', {
            x1: Math.cos(ang) * 5, y1: Math.sin(ang) * 5,
            x2: Math.cos(ang) * (rimR - 1.5), y2: Math.sin(ang) * (rimR - 1.5),
            stroke: 'rgba(201,168,76,0.62)',
            'stroke-width': 1.8,
            'stroke-linecap': 'round'
          }));
        });
      }
    } else if (tireIndex === 2) {
      // 2 Cup: motorsport mesh with a lug hint.
      var mesh = 6;
      for (var k = 0; k < mesh; k++) {
        var m = (Math.PI * 2 / mesh) * k;
        g.appendChild(el('line', {
          x1: Math.cos(m) * 4, y1: Math.sin(m) * 4,
          x2: Math.cos(m) * (rimR - 1.5), y2: Math.sin(m) * (rimR - 1.5),
          stroke: 'rgba(201,168,76,0.5)',
          'stroke-width': 1.5,
          'stroke-linecap': 'round'
        }));
        var m2 = m + (Math.PI * 2 / mesh) / 2;
        g.appendChild(el('line', {
          x1: Math.cos(m) * (rimR * 0.55), y1: Math.sin(m) * (rimR * 0.55),
          x2: Math.cos(m2) * (rimR * 0.55), y2: Math.sin(m2) * (rimR * 0.55),
          stroke: 'rgba(201,168,76,0.32)',
          'stroke-width': 1.1,
          'stroke-linecap': 'round'
        }));
      }
      // Lug hint ring.
      g.appendChild(el('circle', {
        cx: 0, cy: 0, r: rimR * 0.55,
        fill: 'none',
        stroke: 'rgba(201,168,76,0.28)',
        'stroke-width': 0.9
      }));
    } else {
      // 3 Slick: near solid aero disc with a single gold slot.
      g.appendChild(el('circle', {
        cx: 0, cy: 0, r: rimR - 1,
        fill: '#1A1416',
        stroke: 'rgba(201,168,76,0.30)',
        'stroke-width': 1
      }));
      // Faint concentric turning ring for depth.
      g.appendChild(el('circle', {
        cx: 0, cy: 0, r: rimR * 0.6,
        fill: 'none',
        stroke: 'rgba(201,168,76,0.14)',
        'stroke-width': 0.9
      }));
      // Single gold slot, an arc slit.
      g.appendChild(el('path', {
        d: 'M ' + (rimR * 0.32) + ' ' + (-rimR * 0.62) +
           ' A ' + (rimR * 0.7) + ' ' + (rimR * 0.7) + ' 0 0 1 ' +
           (rimR * 0.7) + ' ' + (-rimR * 0.12),
        fill: 'none',
        stroke: GOLD,
        'stroke-width': 2.4,
        'stroke-linecap': 'round'
      }));
    }

    // Gold center cap, always.
    g.appendChild(el('circle', {
      cx: 0, cy: 0, r: 4.2,
      fill: GOLD
    }));
    g.appendChild(el('circle', {
      cx: 0, cy: 0, r: 4.2,
      fill: 'none',
      stroke: 'rgba(10,3,3,0.55)',
      'stroke-width': 0.8
    }));

    return g;
  }

  // --- wing construction ---------------------------------------------------

  // Returns a group for the rear wing or null at level 0. Drawn behind body.
  // Orientation: tail is at the LEFT, so the wing lives over the left deck.
  // The rear deck sits near y 82 between x 26 and x 90.
  function buildWing(level, suffix) {
    if (!level || level < 1) {
      return null;
    }
    var g = el('g');

    if (level === 1) {
      // Subtle lip spoiler flicked up off the rear deck edge.
      g.appendChild(el('path', {
        d: 'M 30 82 Q 44 78 60 79 L 60 82 Q 46 82 33 85 Z',
        fill: mix(NEARBLACK, '#000000', 0.2),
        stroke: 'rgba(201,168,76,0.5)',
        'stroke-width': 1,
        'stroke-linejoin': 'round'
      }));
      // Gold top-edge hairline.
      g.appendChild(el('path', {
        d: 'M 31 82 Q 45 78 60 79',
        fill: 'none',
        stroke: GOLD,
        'stroke-width': 1.1,
        'stroke-linecap': 'round'
      }));
      return g;
    }

    // For levels 2..4 the wing sits on uprights above the deck. Higher levels
    // are taller, wider chord and more thickness. The left (rear) edge is the
    // trailing edge, angled higher for attack. chordL is the far left tip.
    var planeY, chordL, chordR, thickness, uprightBase, endplate;
    if (level === 2) {
      planeY = 66; chordL = 24; chordR = 74; thickness = 4;
      uprightBase = 84; endplate = false;
    } else if (level === 3) {
      planeY = 54; chordL = 22; chordR = 80; thickness = 5;
      uprightBase = 85; endplate = true;
    } else {
      planeY = 42; chordL = 20; chordR = 88; thickness = 7;
      uprightBase = 86; endplate = true;
    }

    // Uprights. Level 3 and 4 read as swan-neck (curved top mounts) that hang
    // the wing from above. Level 2 is short straight stalks.
    var upStroke = level === 4 ? 3.4 : 2.6;
    function upright(x) {
      if (level >= 3) {
        // Swan neck: rise from deck, arc back and over to the wing underside.
        var d = 'M ' + x + ' ' + uprightBase +
          ' C ' + x + ' ' + (planeY + 12) + ', ' +
          (x - 6) + ' ' + (planeY + thickness + 2) + ', ' +
          (x - 9) + ' ' + (planeY + thickness);
        g.appendChild(el('path', {
          d: d,
          fill: 'none',
          stroke: '#14100F',
          'stroke-width': upStroke + 1.4,
          'stroke-linecap': 'round'
        }));
        g.appendChild(el('path', {
          d: d,
          fill: 'none',
          stroke: 'rgba(201,168,76,0.35)',
          'stroke-width': 1
        }));
      } else {
        g.appendChild(el('line', {
          x1: x, y1: uprightBase, x2: x - 2, y2: planeY + thickness,
          stroke: '#14100F',
          'stroke-width': upStroke + 1,
          'stroke-linecap': 'round'
        }));
      }
    }
    upright(chordR - 10);
    upright(chordL + 18);

    // Wing plane, a flat angled aerofoil. Rear (left) edge higher for attack.
    var rearY = planeY - 2;
    var frontY = planeY + 3;
    g.appendChild(el('path', {
      d: 'M ' + chordL + ' ' + rearY +
         ' L ' + chordR + ' ' + frontY +
         ' L ' + chordR + ' ' + (frontY + thickness) +
         ' L ' + chordL + ' ' + (rearY + thickness) + ' Z',
      fill: mix(NEARBLACK, '#000000', 0.25),
      stroke: 'rgba(201,168,76,0.4)',
      'stroke-width': 1,
      'stroke-linejoin': 'round'
    }));
    // Gold top-edge hairline on the plane.
    g.appendChild(el('line', {
      x1: chordL, y1: rearY, x2: chordR, y2: frontY,
      stroke: GOLD,
      'stroke-width': 1.3,
      'stroke-linecap': 'round'
    }));

    // Endplate at the rear tip (left) for levels 3 and 4.
    if (endplate) {
      var epH = level === 4 ? 7 : 5;
      g.appendChild(el('path', {
        d: 'M ' + chordL + ' ' + (rearY - epH) +
           ' L ' + (chordL - 3) + ' ' + (rearY - epH) +
           ' L ' + (chordL - 3) + ' ' + (rearY + thickness + epH) +
           ' L ' + chordL + ' ' + (rearY + thickness + epH) + ' Z',
        fill: '#17110F',
        stroke: 'rgba(201,168,76,0.45)',
        'stroke-width': 1,
        'stroke-linejoin': 'round'
      }));
    }

    return g;
  }

  // --- main render ---------------------------------------------------------

  function render(svgEl, config) {
    if (!svgEl) {
      return;
    }
    config = config || {};
    var accent = config.accent || GOLD;
    var wingLevel = Math.max(0, Math.min(4, config.wingLevel | 0));
    var tireIndex = Math.max(0, Math.min(3, config.tireIndex | 0));

    var suffix = 'i' + (uidCounter++).toString(36) +
      Math.random().toString(36).slice(2, 6);

    svgEl.setAttribute('viewBox', '0 0 400 170');
    if (!svgEl.getAttribute('preserveAspectRatio')) {
      svgEl.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    }
    svgEl.innerHTML = '';

    var frag = document.createDocumentFragment();
    frag.appendChild(buildDefs(accent, suffix));

    var groundY = 150;

    // Wheel geometry. Small radius keeps the car low. Centers are lifted off
    // the ground line by the radius so the tires just touch it. Nose is right,
    // tail is left, so the front wheel is at the right.
    var wheelR = 26;
    var wheelCY = groundY - wheelR + 1;
    var frontX = 288;
    var rearX = 108;

    // 1. Soft elliptical ground shadow.
    frag.appendChild(el('ellipse', {
      cx: 200, cy: groundY + 5, rx: 172, ry: 11,
      fill: 'rgba(0,0,0,0.55)'
    }));

    // 2. Gold hairline ground line.
    frag.appendChild(el('line', {
      x1: 24, y1: groundY, x2: 376, y2: groundY,
      stroke: 'rgba(201,168,76,0.4)',
      'stroke-width': 1
    }));

    // 3. Rear wing behind body, at the LEFT tail.
    var wing = buildWing(wingLevel, suffix);
    if (wing) {
      frag.appendChild(wing);
    }

    // 4. Body. One confident closed bezier. A mid-engine hypercar stance:
    //    cabin pulled rearward toward the LEFT (over the rear wheel), a very
    //    long low hood sweeping right to a blunt low nose, a short taut
    //    fastback and a kicked ducktail at the left tail. The sill drops below
    //    the wheel tops so the wheels tuck into arches. Drawn clockwise from
    //    the nose tip.
    var bodyPath =
      'M 352 112' +                                // blunt low nose tip, right
      ' C 344 105, 334 101, 322 99' +              // nose ramps up to fender
      ' C 312 94, 300 90, 288 90' +                // front fender crown, raised
      ' C 276 90, 266 93, 258 97' +                // dip behind front fender
      ' C 246 99, 230 99, 216 97' +                // hood toward cowl
      ' C 205 95, 194 92, 185 86' +                // cowl rise to windscreen
      ' C 179 74, 168 61, 153 56' +                // windscreen rakes up, right
      ' C 140 52, 124 51, 110 54' +                // roof peak, cab rearward
      ' C 96 58, 82 68, 70 78' +                   // long fastback over rear wheel
      ' C 58 85, 46 90, 36 92' +                   // rear deck shoulder
      ' C 31 93, 27 93, 24 92' +                   // ducktail kicks up at tail
      ' C 21 96, 21 107, 23 116' +                 // tail face to sill
      ' C 24 124, 27 130, 33 134' +                // tail lower corner
      ' C 47 137, 71 138, 97 138' +                // sill under rear wheel
      ' C 141 138, 191 137, 241 136' +             // long flat sill midspan
      ' C 285 135, 322 133, 342 129' +             // sill under front wheel
      ' C 349 127, 352 121, 352 112' +             // blunt nose face closes
      ' Z';
    frag.appendChild(el('path', {
      d: bodyPath,
      fill: 'url(#vg-body-' + suffix + ')',
      stroke: 'rgba(10,3,3,0.5)',
      'stroke-width': 1,
      'stroke-linejoin': 'round'
    }));

    // 5. Sill shadow, a darker band along the lower body.
    frag.appendChild(el('path', {
      d: 'M 30 124 C 60 120, 150 118, 240 119 C 300 120, 344 122, 360 124' +
         ' L 360 130 C 344 133, 300 135, 240 135 C 150 136, 60 135, 32 132 Z',
      fill: 'rgba(10,3,3,0.5)'
    }));

    // 6. Glass canopy, a low cab-rearward glasshouse. The windscreen faces
    //    forward (right) and rakes up to the roof peak, sitting over the rear
    //    wheel. Its mass is well left of the car midpoint (x 200).
    var glassPath =
      'M 180 85' +
      ' C 176 74, 169 64, 157 59' +                // windscreen rake, right
      ' C 145 55, 132 54, 121 56' +                // roof peak leading edge
      ' C 112 57, 104 61, 98 67' +                 // top of glass, cab side
      ' C 110 73, 130 79, 150 82' +                // backlight down to deck
      ' C 162 84, 172 85, 180 85' +
      ' Z';
    frag.appendChild(el('path', {
      d: glassPath,
      fill: 'url(#vg-glass-' + suffix + ')',
      stroke: 'rgba(201,168,76,0.25)',
      'stroke-width': 0.9,
      'stroke-linejoin': 'round'
    }));
    // Champagne highlight sweep across the glass.
    frag.appendChild(el('path', {
      d: 'M 112 62 C 128 58, 148 61, 166 67',
      fill: 'none',
      stroke: 'rgba(232,213,160,0.5)',
      'stroke-width': 1.4,
      'stroke-linecap': 'round'
    }));

    // 7. Shoulder accent hairline in gold, the character line along the flank.
    frag.appendChild(el('path', {
      d: 'M 34 102 C 70 99, 120 98, 180 100 C 250 102, 310 104, 360 108',
      fill: 'none',
      stroke: 'rgba(201,168,76,0.6)',
      'stroke-width': 1.1,
      'stroke-linecap': 'round'
    }));

    // 8. Subtle side intake line behind the front wheel.
    frag.appendChild(el('path', {
      d: 'M 236 112 C 246 108, 258 108, 268 112',
      fill: 'none',
      stroke: 'rgba(201,168,76,0.3)',
      'stroke-width': 1,
      'stroke-linecap': 'round'
    }));

    // 9. Wheel arch cutouts, near-black shapes slightly larger than the tires.
    //    Drawn over the body base so the wheels sit inside them.
    var archR = wheelR + 4;
    [frontX, rearX].forEach(function (wx) {
      frag.appendChild(el('path', {
        d: 'M ' + (wx - archR) + ' ' + groundY +
           ' A ' + archR + ' ' + archR + ' 0 0 1 ' +
           (wx + archR) + ' ' + groundY + ' Z',
        fill: '#0B0607'
      }));
    });

    // 10. Headlight sliver near the right nose tip in champagne.
    frag.appendChild(el('path', {
      d: 'M 340 108 C 348 107, 354 109, 356 112 C 353 114, 347 113, 340 112 Z',
      fill: 'rgba(232,213,160,0.85)'
    }));

    // 11. Thin taillight blade in ruby at the far left tail edge.
    frag.appendChild(el('line', {
      x1: 27, y1: 100, x2: 27, y2: 114,
      stroke: RUBY,
      'stroke-width': 2.4,
      'stroke-linecap': 'round'
    }));

    // 12. Two wheels, tucked into the arches, touching the ground line.
    frag.appendChild(buildWheel(frontX, wheelCY, tireIndex, suffix));
    frag.appendChild(buildWheel(rearX, wheelCY, tireIndex, suffix));

    svgEl.appendChild(frag);
  }

  window.CarArt = { render: render };
})();
