/* ============================================================
   VALENCE GARAGE. Living instruments. js/motion.js

   Micro-motion utilities that make the dashboard feel machined:
     - setNum(el, text): readout values roll to new numbers with a
       250ms rAF tween instead of snapping. Non-numeric text falls
       back to a plain set. One shared rAF loop owns every tween.
     - sheenOn(fill): a moving specular highlight sweeps a stat bar
       fill once, on change (class-driven CSS animation).
     - magnetize(): primary and secondary buttons translate subtly
       toward the pointer within a few px, hover-capable devices
       only, via pointerover delegation so dynamically created
       buttons participate.
     - enterScreen(el, selectors): staggered entrance choreography.
       First time a screen shows per page load, its widgets cascade
       in with a 40ms stagger (CSS animation, --si custom property).

   Contracts: never throws (defensive try/catch at the API edge),
   no console output, all motion honors prefers-reduced-motion at
   call time, zero dependencies, loads before app.js and exposes
   window.VGMotion. app.js degrades gracefully if absent.
   ============================================================ */
(function () {
  'use strict';

  function reduced() {
    try {
      return window.matchMedia &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch (e) { return false; }
  }

  function fine() {
    try {
      return window.matchMedia &&
        window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    } catch (e) { return false; }
  }

  // ---- number tickers ---------------------------------------------------
  // Formatted strings look like "1,234 hp", "2.8 s", "312 km/h", "Sport".
  // We tween the FIRST numeric token and keep prefix/suffix verbatim.
  var NUM_RE = /-?[\d,]+(?:\.\d+)?/;

  var tweens = [];      // active tweens: { el, from, to, dec, comma, pre, suf, t0, dur, target }
  var rafId = 0;

  function parseTarget(text) {
    var m = NUM_RE.exec(text);
    if (!m) return null;
    var raw = m[0];
    var val = parseFloat(raw.replace(/,/g, ''));
    if (!isFinite(val)) return null;
    var dot = raw.indexOf('.');
    return {
      val: val,
      dec: dot >= 0 ? (raw.length - dot - 1) : 0,
      comma: raw.indexOf(',') >= 0,
      pre: text.slice(0, m.index),
      suf: text.slice(m.index + raw.length)
    };
  }

  function fmt(val, dec, comma) {
    var s = val.toFixed(dec);
    if (comma) {
      var parts = s.split('.');
      parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
      s = parts.join('.');
    }
    return s;
  }

  function step(now) {
    var alive = false;
    for (var i = 0; i < tweens.length; i++) {
      var tw = tweens[i];
      if (!tw) continue;
      var k = (now - tw.t0) / tw.dur;
      if (k >= 1) {
        tw.el.textContent = tw.target;   // exact final text, always
        tw.el.__vgNum = tw.to;
        tweens[i] = null;
        continue;
      }
      alive = true;
      if (k < 0) k = 0;
      var e = 1 - Math.pow(1 - k, 3);    // easeOutCubic
      var v = tw.from + (tw.to - tw.from) * e;
      tw.el.textContent = tw.pre + fmt(v, tw.dec, tw.comma) + tw.suf;
    }
    if (alive) {
      rafId = window.requestAnimationFrame(step);
    } else {
      tweens.length = 0;
      rafId = 0;
    }
  }

  function setNum(el, text) {
    if (!el) return;
    text = String(text);
    if (el.textContent === text) return;
    if (reduced() || document.hidden) { el.textContent = text; el.__vgNum = null; return; }

    var t = parseTarget(text);
    if (!t) { el.textContent = text; el.__vgNum = null; return; }

    // Starting value: last tweened value if known, else parse what is shown.
    var from = (typeof el.__vgNum === 'number') ? el.__vgNum : null;
    if (from === null) {
      var cur = parseTarget(el.textContent || '');
      from = cur ? cur.val : 0;
    }
    if (from === t.val) { el.textContent = text; el.__vgNum = t.val; return; }

    // Replace any in-flight tween on this element.
    for (var i = 0; i < tweens.length; i++) {
      if (tweens[i] && tweens[i].el === el) tweens[i] = null;
    }
    tweens.push({
      el: el, from: from, to: t.val, dec: t.dec, comma: t.comma,
      pre: t.pre, suf: t.suf, t0: performance.now(), dur: 250, target: text
    });
    if (!rafId) rafId = window.requestAnimationFrame(step);
  }

  // ---- stat bar sheen -----------------------------------------------------
  function sheenOn(fill) {
    if (!fill || reduced()) return;
    fill.classList.remove('sheen');
    // Force a style flush so re-adding restarts the animation.
    void fill.offsetWidth;
    fill.classList.add('sheen');
    if (!fill.__vgSheenBound) {
      fill.__vgSheenBound = true;
      fill.addEventListener('animationend', function (ev) {
        if (ev.animationName === 'vg-sheen') fill.classList.remove('sheen');
      });
    }
  }

  // ---- magnetic buttons ---------------------------------------------------
  var MAG_SEL = '.btn-primary, .btn-secondary';
  var MAG_MAX = 4;   // px of pull, deliberately subtle

  function bindMagnet(btn) {
    if (btn.__vgMag) return;
    btn.__vgMag = true;
    btn.addEventListener('pointermove', function (ev) {
      if (reduced() || !fine()) return;
      var r = btn.getBoundingClientRect();
      var dx = (ev.clientX - (r.left + r.width / 2)) / (r.width / 2);
      var dy = (ev.clientY - (r.top + r.height / 2)) / (r.height / 2);
      dx = Math.max(-1, Math.min(1, dx)) * MAG_MAX;
      dy = Math.max(-1, Math.min(1, dy)) * MAG_MAX * 0.6;
      btn.style.transform = 'translate(' + dx.toFixed(1) + 'px,' + dy.toFixed(1) + 'px)';
    });
    btn.addEventListener('pointerleave', function () {
      btn.style.transform = '';
    });
    btn.addEventListener('pointerdown', function () {
      btn.style.transform = '';
    });
  }

  function magnetize() {
    if (!fine()) return;
    // Delegated lazy binding: any button we hover gets its handlers once,
    // so buttons created later (garage cards, CTAs) participate too.
    document.addEventListener('pointerover', function (ev) {
      var t = ev.target;
      if (!t || !t.closest) return;
      var btn = t.closest(MAG_SEL);
      if (btn) bindMagnet(btn);
    }, { passive: true });
  }

  // ---- staggered entrances -------------------------------------------------
  var entered = [];   // elements already choreographed this page load

  function enterScreen(root, selector) {
    try {
      if (!root || reduced()) return;
      if (entered.indexOf(root) >= 0) return;
      entered.push(root);
      var kids = root.querySelectorAll(selector);
      var n = Math.min(kids.length, 14);   // cap the cascade
      for (var i = 0; i < n; i++) {
        kids[i].style.setProperty('--si', String(i));
        kids[i].classList.add('vg-in');
      }
    } catch (e) { /* choreography must never break the app */ }
  }

  // ---- marquee ---------------------------------------------------------------
  // Split a wordmark into per-letter spans so CSS can stagger their rise.
  // Runs once; under reduced motion the letters still split (the gradient
  // styling lives on the spans) but CSS suppresses the animation.
  function marquee(el) {
    if (!el || el.__vgMarquee) return;
    el.__vgMarquee = true;
    var text = el.textContent;
    el.textContent = '';
    el.setAttribute('aria-label', text);
    for (var i = 0; i < text.length; i++) {
      var s = document.createElement('span');
      s.className = 'mq-letter';
      s.setAttribute('aria-hidden', 'true');
      s.style.setProperty('--li', String(i));
      s.textContent = text[i];
      el.appendChild(s);
    }
  }

  // ---- pointer parallax --------------------------------------------------------
  // The fixed background layers drift a few px against the pointer, which
  // reads as depth. Hover-capable fine pointers only; rAF-throttled writes.
  var plxPending = false;
  var plxX = 0, plxY = 0;

  function parallax() {
    if (!fine()) return;
    document.addEventListener('pointermove', function (ev) {
      if (reduced()) return;
      var nx = (ev.clientX / window.innerWidth - 0.5);
      var ny = (ev.clientY / window.innerHeight - 0.5);
      plxX = (-nx * 14).toFixed(1);
      plxY = (-ny * 10).toFixed(1);
      if (!plxPending) {
        plxPending = true;
        window.requestAnimationFrame(function () {
          plxPending = false;
          var root = document.documentElement;
          root.style.setProperty('--plx-x', plxX + 'px');
          root.style.setProperty('--plx-y', plxY + 'px');
        });
      }
    }, { passive: true });
  }

  // ---- public API -----------------------------------------------------------
  window.VGMotion = {
    setNum: function (el, text) { try { setNum(el, text); } catch (e) { if (el) el.textContent = text; } },
    sheenOn: function (fill) { try { sheenOn(fill); } catch (e) { } },
    magnetize: function () { try { magnetize(); } catch (e) { } },
    enterScreen: function (root, sel) { enterScreen(root, sel); },
    marquee: function (el) { try { marquee(el); } catch (e) { } },
    parallax: function () { try { parallax(); } catch (e) { } }
  };
})();
