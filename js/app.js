// Valence Garage. window.App. Boot, state, wiring, garage, spec card, tabs, units.
// Attaches exactly one global: window.App. No em dashes anywhere. 2-space indent.
(function () {
  'use strict';

  var LS_BUILDS = 'valence-garage-builds-v2';
  var LS_CURRENT = 'valence-garage-current-v2';
  var LS_THUMBS = 'vg-thumbs-v1';

  var ACCENTS = ['#C9A84C', '#E8D5A0', '#A02020', '#E8C8B4', '#FAF4F0', '#6E1616'];
  var WING_LABELS = ['None', 'Low', 'Mid', 'High', 'Max'];
  var TIRE_LABELS = ['Touring', 'Sport', 'Cup', 'Slick'];

  var RANGE = {
    powerHp: { min: 300, max: 2000, step: 10 },
    weightKg: { min: 900, max: 2200, step: 10 },
    wingLevel: { min: 0, max: 4 },
    tireIndex: { min: 0, max: 3 }
  };

  // Live in-progress build. May be null before a car is chosen.
  var current = null;
  // Current unit system: 'metric' or 'imperial'.
  var units = 'metric';
  // Whether the 3D viewer has been mounted yet (lazy, once).
  var viewerMounted = false;

  // ---- small utilities -------------------------------------------------

  function byId(id) {
    return document.getElementById(id);
  }

  function clamp(n, lo, hi) {
    if (n < lo) return lo;
    if (n > hi) return hi;
    return n;
  }

  function clampStep(n, lo, hi, step) {
    var v = clamp(n, lo, hi);
    if (step) {
      v = Math.round((v - lo) / step) * step + lo;
      v = clamp(v, lo, hi);
    }
    return v;
  }

  function fmtInt(n) {
    return String(Math.round(n));
  }

  function fmtThousands(n) {
    // Thousands separators, no decimals. For newtons in engineering strings.
    var r = Math.round(n);
    return r.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function fmt1(n) {
    return (Math.round(n * 10) / 10).toFixed(1);
  }

  function newId() {
    return 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  // ---- car catalog lookups (window.CARS) ------------------------------

  function carList() {
    return (window.CARS && Array.isArray(window.CARS)) ? window.CARS : [];
  }

  function carById(id) {
    var list = carList();
    for (var i = 0; i < list.length; i++) {
      if (list[i] && list[i].id === id) return list[i];
    }
    return null;
  }

  function carName(id) {
    var c = carById(id);
    return c ? c.name : 'Build';
  }

  // ---- localStorage (robust) ------------------------------------------

  function readBuilds() {
    try {
      var raw = window.localStorage.getItem(LS_BUILDS);
      if (!raw) return [];
      var arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return [];
      return arr.filter(isValidConfig);
    } catch (e) {
      return [];
    }
  }

  function writeBuilds(arr) {
    try {
      window.localStorage.setItem(LS_BUILDS, JSON.stringify(arr));
    } catch (e) {
      // storage full or unavailable. Fail silently, no console output.
    }
  }

  function readCurrent() {
    try {
      var raw = window.localStorage.getItem(LS_CURRENT);
      if (!raw) return null;
      var cfg = JSON.parse(raw);
      if (!isValidConfig(cfg)) return null;
      return normalizeConfig(cfg);
    } catch (e) {
      return null;
    }
  }

  function writeCurrent() {
    if (!current) return;
    try {
      window.localStorage.setItem(LS_CURRENT, JSON.stringify(current));
    } catch (e) {
      // fail silently
    }
  }

  function isValidConfig(cfg) {
    if (!cfg || typeof cfg !== 'object') return false;
    if (typeof cfg.carId !== 'string' || !carById(cfg.carId)) return false;
    if (typeof cfg.powerHp !== 'number' || typeof cfg.weightKg !== 'number') {
      return false;
    }
    if (cfg.drivetrain !== 'RWD' && cfg.drivetrain !== 'AWD') return false;
    if (typeof cfg.wingLevel !== 'number' || typeof cfg.tireIndex !== 'number') {
      return false;
    }
    if (typeof cfg.accent !== 'string') return false;
    return true;
  }

  // Coerce a loaded config into valid ranges so downstream code is safe.
  function normalizeConfig(cfg) {
    var out = {
      id: typeof cfg.id === 'string' ? cfg.id : newId(),
      name: typeof cfg.name === 'string' ? cfg.name : carName(cfg.carId),
      carId: cfg.carId,
      powerHp: clampStep(cfg.powerHp, RANGE.powerHp.min, RANGE.powerHp.max, RANGE.powerHp.step),
      weightKg: clampStep(cfg.weightKg, RANGE.weightKg.min, RANGE.weightKg.max, RANGE.weightKg.step),
      drivetrain: cfg.drivetrain === 'AWD' ? 'AWD' : 'RWD',
      wingLevel: clampStep(cfg.wingLevel, RANGE.wingLevel.min, RANGE.wingLevel.max, 1),
      tireIndex: clampStep(cfg.tireIndex, RANGE.tireIndex.min, RANGE.tireIndex.max, 1),
      accent: ACCENTS.indexOf(cfg.accent) >= 0 ? cfg.accent : ACCENTS[0],
      savedAt: typeof cfg.savedAt === 'number' ? cfg.savedAt : 0
    };
    return out;
  }

  function copyConfig(cfg) {
    return {
      id: cfg.id,
      name: cfg.name,
      carId: cfg.carId,
      powerHp: cfg.powerHp,
      weightKg: cfg.weightKg,
      drivetrain: cfg.drivetrain,
      wingLevel: cfg.wingLevel,
      tireIndex: cfg.tireIndex,
      accent: cfg.accent,
      savedAt: cfg.savedAt
    };
  }

  function configFromCar(entry) {
    return {
      id: newId(),
      name: entry.name,
      carId: entry.id,
      powerHp: entry.powerHp,
      weightKg: entry.weightKg,
      drivetrain: entry.drivetrain,
      wingLevel: entry.wingLevel,
      tireIndex: entry.tireIndex,
      accent: entry.accent,
      savedAt: 0
    };
  }

  // ---- thumbnail cache (vg-thumbs-v1) ---------------------------------

  // In-memory mirror of the localStorage thumb store. carId -> PNG dataURL.
  var thumbs = null;

  function readThumbs() {
    if (thumbs) return thumbs;
    try {
      var raw = window.localStorage.getItem(LS_THUMBS);
      var obj = raw ? JSON.parse(raw) : null;
      thumbs = (obj && typeof obj === 'object') ? obj : {};
    } catch (e) {
      thumbs = {};
    }
    return thumbs;
  }

  // Persist the thumb store. On quota errors evict the entire store and
  // skip silently so a full disk never breaks the app.
  function writeThumbs() {
    if (!thumbs) return;
    try {
      window.localStorage.setItem(LS_THUMBS, JSON.stringify(thumbs));
    } catch (e) {
      thumbs = {};
      try {
        window.localStorage.removeItem(LS_THUMBS);
      } catch (e2) {
        // storage unavailable. Ignore.
      }
    }
  }

  // Return the cached PNG dataURL for a car, or null when none exists.
  function carImage(carId) {
    if (typeof carId !== 'string') return null;
    var store = readThumbs();
    var v = store[carId];
    return (typeof v === 'string' && v) ? v : null;
  }

  // After a successful Viewer.show, capture and cache a snapshot for the
  // shown car if we do not have one yet. Waits one frame so the model has
  // painted, then captures. Fully guarded: never throws, silent on failure.
  function cacheThumbFor(carId) {
    if (typeof carId !== 'string' || !carId) return;
    if (carImage(carId)) return;
    if (!window.Viewer || typeof window.Viewer.captureSnapshot !== 'function') return;

    var doCapture = function () {
      try {
        var url = window.Viewer.captureSnapshot();
        if (typeof url === 'string' && url.indexOf('data:image') === 0) {
          var store = readThumbs();
          store[carId] = url;
          writeThumbs();
          // Refresh any views that show car imagery for this car.
          refreshThumbViews(carId);
        }
      } catch (e) {
        // capture failed. Skip silently.
      }
    };

    try {
      if (typeof window.requestAnimationFrame === 'function') {
        window.requestAnimationFrame(function () {
          window.requestAnimationFrame(doCapture);
        });
      } else {
        window.setTimeout(doCapture, 50);
      }
    } catch (e) {
      window.setTimeout(doCapture, 50);
    }
  }

  // A thumb just landed for carId. Update live surfaces so the silhouette
  // heals to the real render without a reload. Guarded against absent DOM.
  function refreshThumbViews(carId) {
    try {
      // Dashboard hero, if it is showing this car.
      if (current && current.carId === carId) renderHero();
      // Garage gallery cards.
      renderGarageGallery();
    } catch (e) {
      // ignore
    }
  }

  // ---- tabs ------------------------------------------------------------

  function showTab(tab) {
    var screens = {
      garage: byId('screen-garage'),
      build: byId('screen-build'),
      lab: byId('screen-lab'),
      duel: byId('screen-duel'),
      clinic: byId('screen-clinic'),
      advisor: byId('screen-advisor')
    };

    // v9 seam wipe: a gold hairline sweeps the viewport on every tab
    // change. Restart the animation by re-adding the class after a reflow.
    var seam = byId('seam-wipe');
    if (seam && !prefersReducedMotionApp()) {
      seam.classList.remove('run');
      void seam.offsetWidth;
      seam.classList.add('run');
    }
    Object.keys(screens).forEach(function (k) {
      var s = screens[k];
      if (!s) return;
      if (k === tab) s.classList.add('active');
      else s.classList.remove('active');
    });
    var tabs = document.querySelectorAll('#tabbar .tab');
    for (var i = 0; i < tabs.length; i++) {
      var t = tabs[i];
      var on = t.getAttribute('data-tab') === tab;
      if (on) t.classList.add('active');
      else t.classList.remove('active');
      t.setAttribute('aria-selected', on ? 'true' : 'false');
    }
    if (tab === 'garage') renderGarage();
    if (tab === 'build' && current) {
      renderStatBars();
      showViewerForCurrent();
    }

    // Dimensional atmosphere: each tab gets its own depth universe.
    if (window.Atmos) window.Atmos.set(tab);

    // The wind tunnel and the proving ground run only while on stage.
    if (window.WindLab) {
      if (tab === 'lab') window.WindLab.show(current);
      else window.WindLab.hide();
    }
    if (window.Duel) {
      if (tab === 'duel') window.Duel.show(current);
      else window.Duel.hide();
    }
    if (window.Clinic) {
      if (tab === 'clinic') window.Clinic.show();
      else window.Clinic.hide();
    }

    // Entrance choreography: first show of each screen per page load
    // cascades its widgets in (reduced-motion aware, no-op afterwards).
    if (window.VGMotion) {
      var active = screens[tab];
      if (tab === 'garage') {
        window.VGMotion.enterScreen(active, '#dashboard > section');
      } else if (tab === 'build') {
        window.VGMotion.enterScreen(active,
          '.car-card, #config-left > *, #config-right > *');
      } else if (tab === 'lab') {
        window.VGMotion.enterScreen(active,
          '#lab-stage, #lab-readouts .ro, #lab-controls');
      } else if (tab === 'duel') {
        window.VGMotion.enterScreen(active,
          '#duel-stage, #duel-picker, #btn-duel');
      } else if (tab === 'clinic') {
        window.VGMotion.enterScreen(active, '.clinic-panel');
      }
    }
  }

  // App-side reduced-motion probe (viewer.js keeps its own).
  function prefersReducedMotionApp() {
    try {
      return !!(window.matchMedia &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch (e) {
      return false;
    }
  }

  function bindTabs() {
    var tabs = document.querySelectorAll('#tabbar .tab');
    for (var i = 0; i < tabs.length; i++) {
      (function (t) {
        t.addEventListener('click', function () {
          showTab(t.getAttribute('data-tab'));
        });
      })(tabs[i]);
    }
  }

  // ---- build step switching -------------------------------------------

  function showBuildStep(step) {
    var s1 = byId('build-step-picker');
    var s2 = byId('build-step-config');
    if (step === 1) {
      if (s1) s1.hidden = false;
      if (s2) s2.hidden = true;
    } else {
      if (s1) s1.hidden = true;
      if (s2) s2.hidden = false;
    }
  }

  // ---- 3D viewer wiring (window.Viewer, optional) ---------------------

  // Mount the viewer once (lazily), then show the current car. The 3D model
  // reacts to car identity, accent, and (v11) aero wing: the wing slider
  // bolts a real parametric wing onto the model. Tire changes remain
  // readout-only. Fully guarded so the app works without a viewer.
  function showViewerForCurrent() {
    if (!current) return;
    if (!window.Viewer) return;
    var mount = byId('viewer-mount');
    if (!mount) return;
    try {
      if (!viewerMounted) {
        window.Viewer.mount(mount);
        viewerMounted = true;
      }
      if (window.Viewer.setWing) window.Viewer.setWing(current.wingLevel);
      var entry = carById(current.carId);
      if (entry) {
        var carId = entry.id;
        var p = window.Viewer.show(entry);
        if (p && typeof p.then === 'function') {
          p.then(function (ok) {
            if (ok) cacheThumbFor(carId);
          }, function () {
            // show rejected. No snapshot to cache.
          });
        }
      }
    } catch (e) {
      // viewer failed. App continues without it.
    }
  }

  // Propagate the current accent to CSS as var(--accent) so accent-reactive
  // styles respond even when the 3D viewer skips recolor. Guarded.
  function applyAccentVar(accent) {
    try {
      var hex = typeof accent === 'string' ? accent : (current && current.accent);
      if (hex && document.documentElement && document.documentElement.style) {
        document.documentElement.style.setProperty('--accent', hex);
      }
    } catch (e) {
      // setting the CSS variable failed. Ignore.
    }
  }

  // ---- garage ----------------------------------------------------------

  function makeMiniSvg() {
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 400 170');
    svg.setAttribute('class', 'garage-car');
    return svg;
  }

  // Dashboard render. Keeps the name renderGarage so tab switches and saves
  // stay wired. Orchestrates the four widgets: hero, stats, builds, advisor.
  // Every widget is absence-guarded so it no-ops cleanly if Agent S's DOM
  // has not landed for a given section.
  function renderGarage() {
    renderHero();
    renderDashStats();
    renderGarageGallery();
    renderDashAdvisor();
  }

  // ---- hero widget -----------------------------------------------------

  function renderHero() {
    var heroSection = byId('dash-hero');
    if (!heroSection) return; // dashboard DOM not landed. Nothing to fill.

    // Layered night-arch scene. Render into #hero-stage when Agent S has
    // landed it, else fall back to #dash-hero so integration self-heals.
    var stage = byId('hero-stage') || heroSection;

    var nameEl = byId('hero-name');
    var subEl = byId('hero-sub');
    var chipsEl = byId('hero-chips');
    var img = byId('hero-car-img');
    var fallback = byId('hero-fallback');
    var cta = byId('btn-hero-cta');

    if (current) {
      var entry = carById(current.carId);
      if (nameEl) nameEl.textContent = current.name || carName(current.carId);
      if (subEl) subEl.textContent = entry ? (entry.sub || '') : '';

      // Three glass chips: hp, 0 to 60, top speed (unit-aware).
      if (chipsEl) {
        var p = safeCompute(current);
        var topDisp = units === 'imperial'
          ? fmtInt(p.topSpeedKmh * 0.621371) + ' mph'
          : fmtInt(p.topSpeedKmh) + ' km/h';
        renderChips(chipsEl, [
          fmtInt(current.powerHp) + ' hp',
          fmt1(p.zeroTo60) + ' s 0-60',
          topDisp
        ]);
        chipsEl.hidden = false;
      }

      // Imagery: real snapshot if cached, else silhouette in the fallback.
      var url = carImage(current.carId);
      if (url) {
        if (img) {
          img.src = url;
          img.hidden = false;
        }
        if (fallback) {
          fallback.hidden = true;
          clearEl(fallback);
        }
      } else {
        if (img) {
          img.hidden = true;
          img.removeAttribute('src');
        }
        if (fallback) {
          fallback.hidden = false;
          renderSilhouetteInto(fallback, current);
        }
      }

      if (cta) {
        cta.textContent = 'Continue Build';
        cta.onclick = function () {
          showTab('build');
          showBuildStep(2);
        };
      }

      // Paint the night-arch hero scene with the user's car snapshot.
      if (window.HeroScene && HeroScene.render) {
        try {
          HeroScene.render(stage, {
            carImgSrc: url || null,
            carName: (current.name || carName(current.carId))
          });
        } catch (e) {}
      }
    } else {
      if (nameEl) nameEl.textContent = 'Start your first build';
      if (subEl) subEl.textContent = 'Pick a hypercar and tune it to your limit.';
      if (chipsEl) {
        clearEl(chipsEl);
        chipsEl.hidden = true;
      }
      if (img) {
        img.hidden = true;
        img.removeAttribute('src');
      }
      if (fallback) {
        fallback.hidden = true;
        clearEl(fallback);
      }
      if (cta) {
        cta.textContent = 'Start a Build';
        cta.onclick = function () {
          showTab('build');
          showBuildStep(1);
        };
      }

      // Paint the night-arch hero scene with no car (empty state).
      if (window.HeroScene && HeroScene.render) {
        try {
          HeroScene.render(stage, { carImgSrc: null, carName: '' });
        } catch (e) {}
      }
    }
  }

  function renderChips(container, labels) {
    clearEl(container);
    labels.forEach(function (text) {
      var chip = document.createElement('span');
      chip.className = 'hero-chip';
      chip.textContent = text;
      container.appendChild(chip);
    });
  }

  // Render a CarArt silhouette svg into a container (used by #hero-fallback).
  function renderSilhouetteInto(container, cfg) {
    clearEl(container);
    var svg = makeMiniSvg();
    container.appendChild(svg);
    window.setTimeout(function () {
      try {
        window.CarArt.render(svg, cfg);
      } catch (e) {
        // renderer missing or failed. Leave placeholder svg.
      }
    }, 0);
  }

  function clearEl(el) {
    if (!el) return;
    while (el.firstChild) el.removeChild(el.firstChild);
  }

  // ---- dashboard stats -------------------------------------------------

  function renderDashStats() {
    var section = byId('dash-stats');
    var bars = byId('dash-bars');
    if (section) section.hidden = !current;
    if (bars && current) renderStatBars(bars);
  }

  // ---- dashboard advisor widget ---------------------------------------

  function renderDashAdvisor() {
    var btn = byId('btn-dash-advisor');
    if (!btn) return;
    btn.onclick = function () {
      showTab('advisor');
      var input = byId('advisor-input');
      if (input && typeof input.focus === 'function') {
        try {
          input.focus();
        } catch (e) {
          // focus failed. Ignore.
        }
      }
    };
  }

  // ---- builds gallery --------------------------------------------------

  function renderGarageGallery() {
    var list = byId('garage-list');
    var empty = byId('garage-empty');
    var newBtn = byId('btn-new-build');
    var builds = readBuilds();

    if (empty) empty.hidden = builds.length > 0;
    if (newBtn) newBtn.hidden = builds.length === 0;

    if (!list) return;
    while (list.firstChild) list.removeChild(list.firstChild);

    builds.forEach(function (cfg) {
      list.appendChild(makeGarageCard(normalizeConfig(cfg)));
    });
  }

  function makeGarageCard(cfg) {
    var card = document.createElement('div');
    card.className = 'garage-card';

    var art = document.createElement('div');
    art.className = 'garage-card-art';
    // Real snapshot thumbnail if cached, else the drawn silhouette fallback.
    var svg = null;
    var url = carImage(cfg.carId);
    if (url) {
      var thumb = document.createElement('img');
      thumb.className = 'garage-card-img';
      thumb.src = url;
      thumb.alt = '';
      art.appendChild(thumb);
    } else {
      svg = makeMiniSvg();
      art.appendChild(svg);
    }
    card.appendChild(art);

    var body = document.createElement('div');
    body.className = 'garage-card-body';

    var name = document.createElement('div');
    name.className = 'garage-card-name';
    name.textContent = cfg.name;
    body.appendChild(name);

    var arch = document.createElement('div');
    arch.className = 'garage-card-arch';
    arch.textContent = carName(cfg.carId);
    body.appendChild(arch);

    var perf = safeCompute(cfg);
    var stats = document.createElement('div');
    stats.className = 'garage-card-stats';
    var topDisp = units === 'imperial'
      ? fmtInt(perf.topSpeedKmh * 0.621371) + ' mph'
      : fmtInt(perf.topSpeedKmh) + ' km/h';
    stats.textContent = fmtInt(cfg.powerHp) + ' hp  .  ' +
      fmt1(perf.zeroTo60) + ' s  .  ' + topDisp;
    body.appendChild(stats);

    card.appendChild(body);

    // remove button with two-tap arming
    var rm = document.createElement('button');
    rm.className = 'garage-card-remove';
    rm.type = 'button';
    rm.textContent = 'Remove';
    var armed = false;
    var armTimer = null;
    rm.addEventListener('click', function (ev) {
      ev.stopPropagation();
      if (!armed) {
        armed = true;
        rm.classList.add('armed');
        rm.textContent = 'Sure?';
        armTimer = window.setTimeout(function () {
          armed = false;
          rm.classList.remove('armed');
          rm.textContent = 'Remove';
        }, 2500);
        return;
      }
      if (armTimer) window.clearTimeout(armTimer);
      deleteBuild(cfg.id);
    });
    card.appendChild(rm);

    // tap card body loads a copy into the configurator
    body.addEventListener('click', function () {
      loadCopy(cfg);
    });
    art.addEventListener('click', function () {
      loadCopy(cfg);
    });

    // render the silhouette after insertion so CSS size applies (only when
    // there is no cached thumbnail image standing in for it)
    if (svg) {
      window.setTimeout(function () {
        try {
          window.CarArt.render(svg, cfg);
        } catch (e) {
          // renderer missing or failed. Leave placeholder svg.
        }
      }, 0);
    }

    return card;
  }

  function deleteBuild(id) {
    var builds = readBuilds().filter(function (b) {
      return b.id !== id;
    });
    writeBuilds(builds);
    renderGarage();
  }

  function loadCopy(cfg) {
    current = copyConfig(normalizeConfig(cfg));
    current.id = newId();
    current.savedAt = 0;
    writeCurrent();
    applyAccentVar(current.accent);
    showTab('build');
    showBuildStep(2);
    reflectControls();
    renderAll();
    showViewerForCurrent();
  }

  // ---- car picker step -------------------------------------------------

  // Render one button.car-card per window.CARS entry into #car-grid.
  function renderCarGrid() {
    var grid = byId('car-grid');
    if (!grid) return;
    while (grid.firstChild) grid.removeChild(grid.firstChild);

    var list = carList();
    list.forEach(function (entry) {
      if (!entry || typeof entry.id !== 'string') return;
      grid.appendChild(makeCarCard(entry));
    });
  }

  function makeCarCard(entry) {
    var card = document.createElement('button');
    card.type = 'button';
    card.className = 'car-card';
    card.setAttribute('data-car', entry.id);

    var name = document.createElement('div');
    name.className = 'car-name';
    name.textContent = entry.name;
    card.appendChild(name);

    var sub = document.createElement('div');
    sub.className = 'car-sub';
    sub.textContent = entry.sub || '';
    card.appendChild(sub);

    var stats = document.createElement('div');
    stats.className = 'car-stats';
    var perf = safeCompute(entry);
    var topDisp = units === 'imperial'
      ? fmtInt(perf.topSpeedKmh * 0.621371) + ' mph'
      : fmtInt(perf.topSpeedKmh) + ' km/h';
    stats.textContent = fmtInt(entry.powerHp) + ' hp  .  ' +
      fmt1(perf.zeroTo60) + ' s  .  ' + topDisp;
    card.appendChild(stats);

    card.addEventListener('click', function () {
      current = configFromCar(entry);
      writeCurrent();
      applyAccentVar(current.accent);
      showBuildStep(2);
      reflectControls();
      renderAll();
      showViewerForCurrent();
    });

    return card;
  }

  function bindPicker() {
    var back = byId('btn-back-arch');
    if (back) {
      back.addEventListener('click', function () {
        showBuildStep(1);
      });
    }
  }

  // ---- controls binding ------------------------------------------------

  function bindControls() {
    var power = byId('ctl-power');
    if (power) {
      power.addEventListener('input', function () {
        if (!current) return;
        current.powerHp = clampStep(parseFloat(power.value), RANGE.powerHp.min, RANGE.powerHp.max, RANGE.powerHp.step);
        updatePowerBubble();
        onChange();
      });
    }
    var weight = byId('ctl-weight');
    if (weight) {
      weight.addEventListener('input', function () {
        if (!current) return;
        current.weightKg = clampStep(parseFloat(weight.value), RANGE.weightKg.min, RANGE.weightKg.max, RANGE.weightKg.step);
        updateWeightBubble();
        onChange();
      });
    }

    bindSegment('ctl-drivetrain', 'data-dt', function (val) {
      if (!current) return;
      current.drivetrain = val === 'AWD' ? 'AWD' : 'RWD';
      onChange();
    });
    bindSegment('ctl-wing', 'data-wing', function (val) {
      if (!current) return;
      current.wingLevel = clampStep(parseInt(val, 10), RANGE.wingLevel.min, RANGE.wingLevel.max, 1);
      onChange();
      // v11: the wing is real now. Rebuild it on the 3D machine live.
      if (window.Viewer && window.Viewer.setWing) {
        try { window.Viewer.setWing(current.wingLevel); } catch (e) { }
      }
    });
    bindSegment('ctl-tire', 'data-tire', function (val) {
      if (!current) return;
      current.tireIndex = clampStep(parseInt(val, 10), RANGE.tireIndex.min, RANGE.tireIndex.max, 1);
      onChange();
    });
    bindSegment('ctl-accent', 'data-accent', function (val) {
      if (!current) return;
      current.accent = ACCENTS.indexOf(val) >= 0 ? val : current.accent;
      onChange();
      applyAccentVar(current.accent);
      // Best-effort recolor the 3D body to match the accent. Fully guarded.
      if (window.Viewer) {
        try {
          window.Viewer.setAccent(current.accent);
        } catch (e) {
          // viewer recolor failed. Ignore.
        }
      }
    });

    var name = byId('build-name');
    if (name) {
      name.addEventListener('input', function () {
        if (!current) return;
        current.name = name.value;
        writeCurrent();
      });
    }

    bindUnitToggle();
    bindEngToggle();

    var save = byId('btn-save');
    if (save) save.addEventListener('click', saveBuild);

    var share = byId('btn-share');
    if (share) share.addEventListener('click', openSpecCard);
    var closeSpec = byId('btn-close-spec');
    if (closeSpec) closeSpec.addEventListener('click', closeSpecCard);
    var overlay = byId('speccard-overlay');
    if (overlay) {
      overlay.addEventListener('click', function (ev) {
        if (ev.target === overlay) closeSpecCard();
      });
    }

    var startBtn = byId('btn-start-build');
    if (startBtn) {
      startBtn.addEventListener('click', function () {
        showTab('build');
        showBuildStep(1);
      });
    }
    var newBtn = byId('btn-new-build');
    if (newBtn) {
      newBtn.addEventListener('click', function () {
        showTab('build');
        showBuildStep(1);
      });
    }
  }

  function bindSegment(containerId, attr, cb) {
    var container = byId(containerId);
    if (!container) return;
    var btns = container.querySelectorAll('[' + attr + ']');
    for (var i = 0; i < btns.length; i++) {
      (function (btn) {
        btn.addEventListener('click', function () {
          cb(btn.getAttribute(attr));
          reflectControls();
        });
      })(btns[i]);
    }
  }

  function bindUnitToggle() {
    var toggle = byId('unit-toggle');
    if (!toggle) return;
    var btns = toggle.querySelectorAll('[data-unit]');
    for (var i = 0; i < btns.length; i++) {
      (function (btn) {
        btn.addEventListener('click', function () {
          units = btn.getAttribute('data-unit') === 'imperial' ? 'imperial' : 'metric';
          reflectUnitToggle();
          if (current) {
            updateReadouts();
            // Stat bar value strings (top speed, braking) respect the unit
            // toggle, so refresh the bars when units change.
            renderStatBars();
            // Dashboard mirrors: bars and hero chips are unit-aware too.
            var db = byId('dash-bars');
            if (db) renderStatBars(db);
            renderHero();
          }
        });
      })(btns[i]);
    }
  }

  function reflectUnitToggle() {
    var toggle = byId('unit-toggle');
    if (!toggle) return;
    var btns = toggle.querySelectorAll('[data-unit]');
    for (var i = 0; i < btns.length; i++) {
      var on = btns[i].getAttribute('data-unit') === units;
      if (on) btns[i].classList.add('active');
      else btns[i].classList.remove('active');
    }
  }

  function bindEngToggle() {
    var toggle = byId('eng-toggle');
    var bodyEl = byId('eng-body');
    if (!toggle) return;
    toggle.setAttribute('aria-expanded', 'false');
    toggle.addEventListener('click', function () {
      var open = toggle.getAttribute('aria-expanded') === 'true';
      toggle.setAttribute('aria-expanded', open ? 'false' : 'true');
      if (bodyEl) {
        if (open) bodyEl.classList.remove('open');
        else bodyEl.classList.add('open');
      }
    });
  }

  // Reflect current state into all controls (sliders, segments, swatches, name).
  function reflectControls() {
    if (!current) return;

    var power = byId('ctl-power');
    if (power) power.value = String(current.powerHp);
    updatePowerBubble();

    var weight = byId('ctl-weight');
    if (weight) weight.value = String(current.weightKg);
    updateWeightBubble();

    setActive('ctl-drivetrain', 'data-dt', current.drivetrain);
    setActive('ctl-wing', 'data-wing', String(current.wingLevel));
    setActive('ctl-tire', 'data-tire', String(current.tireIndex));
    setActive('ctl-accent', 'data-accent', current.accent);

    var name = byId('build-name');
    if (name) name.value = current.name;

    var archLabel = byId('build-arch-label');
    if (archLabel) archLabel.textContent = carName(current.carId);

    reflectUnitToggle();
  }

  function setActive(containerId, attr, value) {
    var container = byId(containerId);
    if (!container) return;
    var btns = container.querySelectorAll('[' + attr + ']');
    for (var i = 0; i < btns.length; i++) {
      var on = btns[i].getAttribute(attr) === value;
      if (on) btns[i].classList.add('active');
      else btns[i].classList.remove('active');
    }
  }

  function updatePowerBubble() {
    var b = byId('val-power');
    if (b && current) b.textContent = fmtInt(current.powerHp) + ' hp';
  }

  function updateWeightBubble() {
    var b = byId('val-weight');
    if (b && current) b.textContent = fmtInt(current.weightKg) + ' kg';
  }

  // ---- change pipeline -------------------------------------------------

  function onChange() {
    writeCurrent();
    renderAll();
  }

  function safeCompute(cfg) {
    try {
      return window.Physics.compute(cfg);
    } catch (e) {
      // Defensive fallback so nothing throws if physics is unavailable.
      return {
        ptw: 0, zeroTo60: 0, topSpeedKmh: 0, braking100: 0,
        radar: { power: 0, accel: 0, top: 0, corner: 0, brake: 0 },
        eng: {
          CdA: 0, ClA: 0, mu: 0, kDrive: 0, vTop: 0, dragAtTop: 0,
          dragPowerAtTop: 0, downAt200: 0, downAtTop: 0, launchAccelG: 0,
          crossoverSpeedKmh: 0, brakeDecelG: 0
        }
      };
    }
  }

  function renderAll() {
    if (!current) return;
    // The main configurator stage is now the 3D viewer (see showViewerForCurrent).
    // Garage cards and the spec card keep their own CarArt.render silhouettes.
    updateReadouts();
    renderStatBars();
    updateEngineering();
  }

  // ---- readouts --------------------------------------------------------

  // Route numeric readout updates through the ticker so values roll to
  // their new number instead of snapping. Falls back to a plain set.
  function setNumText(el, text) {
    if (!el) return;
    if (window.VGMotion) window.VGMotion.setNum(el, text);
    else el.textContent = text;
  }

  function updateReadouts() {
    if (!current) return;
    var p = safeCompute(current);

    var ptw = byId('ro-ptw-v');
    if (ptw) setNumText(ptw, fmtInt(p.ptw));

    var z = byId('ro-060-v');
    if (z) {
      setNumText(z, fmt1(p.zeroTo60));
      // ruby cue at the limit
      if (p.zeroTo60 < 2.8) z.classList.add('at-limit');
      else z.classList.remove('at-limit');
    }

    var top = byId('ro-top-v');
    var topL = byId('ro-top-l');
    if (top) {
      if (units === 'imperial') {
        setNumText(top, fmtInt(p.topSpeedKmh * 0.621371));
        if (topL) topL.textContent = 'TOP SPEED MPH';
      } else {
        setNumText(top, fmtInt(p.topSpeedKmh));
        if (topL) topL.textContent = 'TOP SPEED KM/H';
      }
      if (p.topSpeedKmh > 380) top.classList.add('at-limit');
      else top.classList.remove('at-limit');
    }

    var brake = byId('ro-brake-v');
    var brakeL = byId('ro-brake-l');
    if (brake) {
      if (units === 'imperial') {
        setNumText(brake, fmtInt(p.braking100 * 3.28084));
        if (brakeL) brakeL.textContent = 'BRAKING 62-0 FT';
      } else {
        setNumText(brake, fmtInt(p.braking100));
        if (brakeL) brakeL.textContent = 'BRAKING 100-0 M';
      }
    }
  }

  // ---- stat bars -------------------------------------------------------

  // Five horizontal stat bars replacing the disliked radar chart. Rows are
  // created once inside #stat-bars, then only fill widths and value texts are
  // updated on subsequent calls so the CSS width transition animates changes.
  var STAT_LABELS = ['POWER', '0 TO 60', 'TOP SPEED', 'GRIP', 'BRAKING'];
  // Radar keys in row order, matched to the label order above.
  var STAT_KEYS = ['power', 'accel', 'top', 'corner', 'brake'];
  // Per-container cache of each row's fill and value nodes, in row order.
  // Keyed via a lazily-assigned symbol-like property on the container.
  var statNodesById = {};
  var statNodesSeq = 0;

  function statNodesFor(container) {
    if (!container.__vgStatKey) {
      container.__vgStatKey = 'sn' + (++statNodesSeq);
    }
    return statNodesById[container.__vgStatKey] || null;
  }

  function buildStatBars(container) {
    while (container.firstChild) container.removeChild(container.firstChild);
    var statNodes = [];
    for (var i = 0; i < STAT_LABELS.length; i++) {
      var row = document.createElement('div');
      row.className = 'stat-row';

      var label = document.createElement('span');
      label.className = 'stat-label';
      label.textContent = STAT_LABELS[i];
      row.appendChild(label);

      var track = document.createElement('div');
      track.className = 'stat-track';
      var fill = document.createElement('div');
      fill.className = 'stat-fill';
      fill.style.width = '0%';
      track.appendChild(fill);
      row.appendChild(track);

      var value = document.createElement('span');
      value.className = 'stat-value';
      row.appendChild(value);

      container.appendChild(row);
      statNodes.push({ fill: fill, value: value });
    }
    if (!container.__vgStatKey) {
      container.__vgStatKey = 'sn' + (++statNodesSeq);
    }
    statNodesById[container.__vgStatKey] = statNodes;
  }

  // Render the five stat bars into a container. Defaults to the configurator
  // #stat-bars so existing call sites keep working; the dashboard passes
  // #dash-bars. Same machinery, per-container node caches.
  function renderStatBars(container) {
    if (!container) container = byId('stat-bars');
    if (!container || !current) return;
    var statNodes = statNodesFor(container);
    // Build rows once. Rebuild only if missing, wrong count, or detached.
    if (!statNodes || statNodes.length !== STAT_LABELS.length ||
        (statNodes[0] && !container.contains(statNodes[0].fill))) {
      buildStatBars(container);
      statNodes = statNodesFor(container);
    }
    if (!statNodes) return;

    var p = safeCompute(current);

    // Value strings, unit aware and live.
    var topStr = units === 'imperial'
      ? fmtInt(p.topSpeedKmh * 0.621371) + ' mph'
      : fmtInt(p.topSpeedKmh) + ' km/h';
    var brakeStr = units === 'imperial'
      ? fmtInt(p.braking100 * 3.28084) + ' ft'
      : fmtInt(p.braking100) + ' m';
    var tireName = (TIRE_LABELS[current.tireIndex] || TIRE_LABELS[0]);
    var valueStrs = [
      fmtInt(current.powerHp) + ' hp',
      fmt1(p.zeroTo60) + ' s',
      topStr,
      tireName,
      brakeStr
    ];

    // Fill widths from the existing radar normalization (0 to 1), clamped to
    // 5 to 100 percent so a bar is never invisible.
    var widths = [];
    for (var k = 0; k < STAT_KEYS.length; k++) {
      var norm = clamp(p.radar[STAT_KEYS[k]], 0, 1);
      widths.push(clamp(norm * 100, 5, 100));
    }

    for (var j = 0; j < statNodes.length; j++) {
      var node = statNodes[j];
      var w = widths[j] + '%';
      if (node.fill.style.width !== w) {
        node.fill.style.width = w;
        // Specular sweep across the fill on every real change.
        if (window.VGMotion) window.VGMotion.sheenOn(node.fill);
      }
      setNumText(node.value, valueStrs[j]);
    }

    // Cheap debug surface for verification. Guarded, shippable.
    window.__barsDebug = {
      labels: STAT_LABELS.slice(),
      values: valueStrs.slice(),
      widths: widths.slice(),
      units: units
    };
  }

  // ---- engineering panel ----------------------------------------------

  function updateEngineering() {
    if (!current) return;
    var p = safeCompute(current);
    var e = p.eng;

    // Live force diagram (js/theater.js): arrows re-tween with the sliders.
    if (window.Theater) window.Theater.update(p, current);

    // DRAG: 0.5 x rho x CdA x (vTop)^2 = N at top speed
    var rho = (window.Physics && window.Physics.RHO) || 1.225;
    var drag = byId('eng-drag-sub');
    if (drag) {
      drag.textContent = '0.5 x ' + rho.toFixed(3) + ' x ' + e.CdA.toFixed(2) +
        ' x (' + fmt1(e.vTop) + ' m/s)^2 = ' + fmtThousands(e.dragAtTop) +
        ' N at top speed';
    }

    // DOWNFORCE at 200 km/h. 200 km/h = 55.6 m/s
    var down = byId('eng-down-sub');
    if (down) {
      down.textContent = '0.5 x ' + rho.toFixed(3) + ' x ' + e.ClA.toFixed(2) +
        ' x (55.6 m/s)^2 = ' + fmtThousands(e.downAt200) + ' N at 200 km/h';
    }

    // TRACTION LIMIT
    var trac = byId('eng-trac-sub');
    if (trac) {
      trac.textContent = e.mu.toFixed(2) + ' x (' + fmtInt(current.weightKg) +
        ' x 9.81 + F_down) / ' + fmtInt(current.weightKg) + ' = ' +
        fmt1(e.launchAccelG) + ' g launch, traction limited to ' +
        fmtInt(e.crossoverSpeedKmh) + ' km/h';
      // tint champagne when launch is traction limited at current grip
      var tractionLimited = e.launchAccelG <= e.mu * e.kDrive * 1.02;
      if (tractionLimited) trac.classList.add('traction-limited');
      else trac.classList.remove('traction-limited');
    }

    // THE TRADEOFF: diff current wing versus wing 0
    var trade = byId('eng-trade-sub');
    if (trade) {
      if (current.wingLevel === 0) {
        trade.textContent = 'wing level 0 adds no downforce and no drag. Add wing for corner grip at a top speed cost.';
      } else {
        var zeroWing = copyConfig(current);
        zeroWing.wingLevel = 0;
        var pz = safeCompute(zeroWing);
        var cdaDelta = e.CdA - pz.eng.CdA;
        var topCost = pz.topSpeedKmh - p.topSpeedKmh;
        var accelBuy = pz.zeroTo60 - p.zeroTo60;
        var brakeBuy = pz.braking100 - p.braking100;
        trade.textContent = 'wing level ' + current.wingLevel + ' adds ' +
          cdaDelta.toFixed(2) + ' m^2 CdA, costs ' + fmtInt(topCost) +
          ' km/h top speed, buys ' + fmt1(accelBuy) + ' s to 60 and ' +
          fmt1(brakeBuy) + ' m braking';
      }
    }
  }

  // ---- save ------------------------------------------------------------

  function saveBuild() {
    if (!current) return;
    current.savedAt = Date.now();
    writeCurrent();
    var builds = readBuilds();
    var found = false;
    for (var i = 0; i < builds.length; i++) {
      if (builds[i].id === current.id) {
        builds[i] = copyConfig(current);
        found = true;
        break;
      }
    }
    if (!found) builds.push(copyConfig(current));
    writeBuilds(builds);

    // Refresh the dashboard so the gallery reflects the new/updated build.
    renderGarage();

    var btn = byId('btn-save');
    if (btn) {
      var prev = btn.getAttribute('data-label') || btn.textContent;
      btn.setAttribute('data-label', prev);
      btn.textContent = 'Saved';
      btn.classList.add('saved-flash');
      window.setTimeout(function () {
        btn.textContent = prev;
        btn.classList.remove('saved-flash');
      }, 1400);
    }
  }

  // ---- spec card -------------------------------------------------------

  function openSpecCard() {
    if (!current) return;
    var p = safeCompute(current);

    setText('sc-name', current.name);
    var entry = carById(current.carId);
    setText('sc-arch', entry ? entry.sub : '');

    // Imagery: real 3D snapshot if cached, else the drawn silhouette exactly
    // as before. Agent S provides both img#sc-car-img and svg#sc-car.
    var scImg = byId('sc-car-img');
    var scSvg = byId('sc-car');
    var scUrl = carImage(current.carId);
    if (scUrl && scImg) {
      scImg.src = scUrl;
      scImg.hidden = false;
      // SVG has no reflected `hidden` IDL property, so assigning .hidden
      // only creates a JS expando and the element keeps its layout box.
      // The attribute is the only form CSS and the UA can see.
      if (scSvg) scSvg.setAttribute('hidden', '');
    } else {
      if (scImg) {
        scImg.hidden = true;
        scImg.removeAttribute('src');
      }
      if (scSvg) scSvg.removeAttribute('hidden');
      try {
        window.CarArt.render(scSvg, current);
      } catch (e) {
        // renderer unavailable
      }
    }

    var topDisp = units === 'imperial'
      ? fmtInt(p.topSpeedKmh * 0.621371) + ' mph'
      : fmtInt(p.topSpeedKmh) + ' km/h';
    var brakeDisp = units === 'imperial'
      ? fmtInt(p.braking100 * 3.28084) + ' ft'
      : fmtInt(p.braking100) + ' m';

    setMedallion('sc-power', fmtInt(current.powerHp), 'POWER HP');
    setMedallion('sc-ptw', fmtInt(p.ptw), 'HP / TONNE');
    setMedallion('sc-060', fmt1(p.zeroTo60), '0-60 MPH S');
    setMedallion('sc-top', topDisp, 'TOP SPEED');
    setMedallion('sc-brake', brakeDisp, 'BRAKING');
    setMedallion('sc-weight', fmtInt(current.weightKg), 'WEIGHT KG');

    setText('sc-setup', current.drivetrain + '  .  ' +
      TIRE_LABELS[current.tireIndex] + ' tires  .  ' +
      WING_LABELS[current.wingLevel] + ' wing');

    var overlay = byId('speccard-overlay');
    if (overlay) overlay.hidden = false;

    // Living gold loop behind the card head. Muted, decorative, and absent
    // under reduced motion (the CSS key-art layer stands in for it).
    var scVid = byId('sc-video');
    if (scVid) {
      var noMotion = false;
      try {
        noMotion = window.matchMedia &&
          window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      } catch (e) { }
      if (!noMotion) {
        try {
          scVid.currentTime = 0;
          var pp = scVid.play();
          if (pp && pp.catch) pp.catch(function () { });
        } catch (e) { }
      }
    }
  }

  function closeSpecCard() {
    var overlay = byId('speccard-overlay');
    if (overlay) overlay.hidden = true;
    var scVid = byId('sc-video');
    if (scVid) { try { scVid.pause(); } catch (e) { } }
  }

  function setText(id, text) {
    var el = byId(id);
    if (el) el.textContent = text;
  }

  function setMedallion(id, value, label) {
    var el = byId(id);
    if (!el) return;
    var v = el.querySelector('.sc-v');
    var l = el.querySelector('.sc-l');
    if (v) v.textContent = value;
    if (l) l.textContent = label;
  }

  // ---- public API ------------------------------------------------------

  function getConfig() {
    return current ? copyConfig(current) : null;
  }

  function applyMods(partial) {
    if (!current || !partial || typeof partial !== 'object') return getConfig();

    if (typeof partial.name === 'string') current.name = partial.name;
    if (typeof partial.accent === 'string' && ACCENTS.indexOf(partial.accent) >= 0) {
      current.accent = partial.accent;
    }
    if (partial.drivetrain === 'RWD' || partial.drivetrain === 'AWD') {
      current.drivetrain = partial.drivetrain;
    }
    if (typeof partial.powerHp === 'number') {
      current.powerHp = clampStep(partial.powerHp, RANGE.powerHp.min, RANGE.powerHp.max, RANGE.powerHp.step);
    }
    if (typeof partial.weightKg === 'number') {
      current.weightKg = clampStep(partial.weightKg, RANGE.weightKg.min, RANGE.weightKg.max, RANGE.weightKg.step);
    }
    if (typeof partial.wingLevel === 'number') {
      current.wingLevel = clampStep(partial.wingLevel, RANGE.wingLevel.min, RANGE.wingLevel.max, 1);
    }
    if (typeof partial.tireIndex === 'number') {
      current.tireIndex = clampStep(partial.tireIndex, RANGE.tireIndex.min, RANGE.tireIndex.max, 1);
    }

    writeCurrent();
    applyAccentVar(current.accent);
    showTab('build');
    showBuildStep(2);
    reflectControls();
    renderAll();
    showViewerForCurrent();
    return getConfig();
  }

  window.App = {
    getConfig: getConfig,
    applyMods: applyMods
  };

  // ---- boot ------------------------------------------------------------

  function boot() {
    renderCarGrid();
    bindTabs();
    bindPicker();
    bindControls();

    reflectUnitToggle();

    var restored = readCurrent();
    if (restored) {
      current = restored;
      applyAccentVar(current.accent);
      reflectControls();
      renderAll();
      // keep the configurator ready but open on Garage per spec
      showBuildStep(2);
    } else {
      showBuildStep(1);
    }

    renderGarage();
    showTab('garage');

    if (window.VGMotion) {
      window.VGMotion.magnetize();
      window.VGMotion.marquee(byId('marquee'));
      window.VGMotion.parallax();
    }

    // v13 deep link: any instrument can hand a question to the Advisor.
    // Switches tabs and submits it as if typed, so the owner watches the
    // answer arrive in the real conversation thread.
    window.__vgAsk = function (question) {
      try {
        showTab('advisor');
        if (window.Advisor && typeof window.Advisor.ask === 'function') {
          window.setTimeout(function () {
            window.Advisor.ask(question);
          }, 250);
        }
      } catch (e) { }
    };

    try {
      if (window.Advisor && typeof window.Advisor.init === 'function') {
        window.Advisor.init();
      }
    } catch (e) {
      // advisor init failed. App still functions.
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
