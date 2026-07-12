// Valence Garage. window.Advisor. Deterministic, rule based, offline advisor.
// Attaches exactly one global: window.Advisor. No em dashes anywhere. 2-space indent.
//
// ============================ DELTA TABLE (SPEC section 6) ============================
// Deltas are relative to the CURRENT config, then clamped to control ranges:
//   powerHp 300..1500 (step 10), weightKg 900..2200 (step 10),
//   wingLevel 0..4, tireIndex 0..3.
// Budget caps on power ADD: low +60, med +150, high +320.
//
// speed:
//   powerHp  += full budget cap (low +60, med +150, high +320)
//   wingLevel = at most 1 (shed drag, chase top speed)
//   drivetrain = AWD (all four contact patches at launch)
//   weightKg -= 0 (low), 40 (med), 80 (high)
//   tireIndex = at least Sport (1); Cup (2) if budget high
//
// track:
//   tireIndex = current + 1 step, with floor Cup (2) at med and Slick (3) at high
//   wingLevel = 3 (med) or 4 (high); low keeps current wing but nudges to >= 2
//   weightKg -= 60 (low), 90 (med), 130 (high)
//   powerHp  += at most HALF the budget cap (30 / 75 / 160)
//
// looks:
//   accent = '#C9A84C' if not already gold, else '#A02020'
//   wingLevel = 2 (stance)
//   weightKg -= 20 (forged wheels)
//   powerHp  no change
//
// balanced:
//   powerHp  moved TOWARD 800 by at most the budget cap
//   wingLevel = 2
//   tireIndex = at least Sport (1)
//   weightKg  moved TOWARD 1400 by at most 80
// =====================================================================================

(function () {
  'use strict';

  var bound = false;

  // Control ranges. Mirrors app.js so we clamp before we ever describe a delta.
  var RANGE = {
    powerHp: { min: 300, max: 1500, step: 10 },
    weightKg: { min: 900, max: 2200, step: 10 },
    wingLevel: { min: 0, max: 4 },
    tireIndex: { min: 0, max: 3 }
  };

  var BUDGET_CAP = { low: 60, med: 150, high: 320 };
  var TIRE_LABELS = ['Touring', 'Sport', 'Cup', 'Slick'];
  var WING_LABELS = ['None', 'Low', 'Mid', 'High', 'Max'];
  var WING_WORDS = ['no wing', 'wing level one', 'wing level two', 'wing level three', 'wing level four'];

  var GOLD = '#C9A84C';
  var CRIMSON = '#A02020';

  // Current chip selections. Defaults match the pre-marked shell (med, balanced).
  var state = { budget: 'med', focus: 'balanced' };

  var voiceOn = false;

  // Last full advisor reply text, so enabling voice can speak it on demand and
  // the AI path can speak the complete answer (not streamed chunks).
  var lastReplyText = '';

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

  function clampPower(n) {
    return clampStep(n, RANGE.powerHp.min, RANGE.powerHp.max, RANGE.powerHp.step);
  }

  function clampWeight(n) {
    return clampStep(n, RANGE.weightKg.min, RANGE.weightKg.max, RANGE.weightKg.step);
  }

  function clampWing(n) {
    return clampStep(n, RANGE.wingLevel.min, RANGE.wingLevel.max, 1);
  }

  function clampTire(n) {
    return clampStep(n, RANGE.tireIndex.min, RANGE.tireIndex.max, 1);
  }

  function fmtInt(n) {
    return String(Math.round(n));
  }

  function fmt1(n) {
    return (Math.round(n * 10) / 10).toFixed(1);
  }

  // Deterministic pick from a variation pool, keyed by budget + focus so the
  // same combination always yields the same phrasing. Deltas never depend on this.
  function pick(pool, key) {
    if (!pool || !pool.length) return '';
    var h = 0;
    for (var i = 0; i < key.length; i++) {
      h = (h * 31 + key.charCodeAt(i)) & 0x7fffffff;
    }
    return pool[h % pool.length];
  }

  // ---- deterministic delta engine -------------------------------------

  // Returns an object with only the fields that actually change versus cfg.
  // Never mutates cfg. Every proposed value is clamped to its control range.
  function computeDeltas(cfg, budget, focus) {
    var cap = BUDGET_CAP[budget] || BUDGET_CAP.med;
    var partial = {};

    function setIf(key, value, clampFn) {
      var v = clampFn(value);
      if (v !== cfg[key]) partial[key] = v;
    }

    if (focus === 'speed') {
      setIf('powerHp', cfg.powerHp + cap, clampPower);
      setIf('wingLevel', Math.min(cfg.wingLevel, 1), clampWing);
      if (cfg.drivetrain !== 'AWD') partial.drivetrain = 'AWD';
      var speedWeightCut = budget === 'high' ? 80 : (budget === 'med' ? 40 : 0);
      if (speedWeightCut) setIf('weightKg', cfg.weightKg - speedWeightCut, clampWeight);
      var speedTireFloor = budget === 'high' ? 2 : 1;
      setIf('tireIndex', Math.max(cfg.tireIndex, speedTireFloor), clampTire);

    } else if (focus === 'track') {
      var tireFloor = budget === 'high' ? 3 : (budget === 'med' ? 2 : 0);
      setIf('tireIndex', Math.max(cfg.tireIndex + 1, tireFloor), clampTire);
      var trackWing = budget === 'high' ? 4 : (budget === 'med' ? 3 : Math.max(cfg.wingLevel, 2));
      setIf('wingLevel', trackWing, clampWing);
      var trackWeightCut = budget === 'high' ? 130 : (budget === 'med' ? 90 : 60);
      setIf('weightKg', cfg.weightKg - trackWeightCut, clampWeight);
      setIf('powerHp', cfg.powerHp + Math.floor(cap / 2), clampPower);

    } else if (focus === 'looks') {
      var accent = cfg.accent === GOLD ? CRIMSON : GOLD;
      if (accent !== cfg.accent) partial.accent = accent;
      setIf('wingLevel', 2, clampWing);
      setIf('weightKg', cfg.weightKg - 20, clampWeight);
      // no power change

    } else {
      // balanced
      var powerTarget = moveToward(cfg.powerHp, 800, cap);
      setIf('powerHp', powerTarget, clampPower);
      setIf('wingLevel', 2, clampWing);
      setIf('tireIndex', Math.max(cfg.tireIndex, 1), clampTire);
      var weightTarget = moveToward(cfg.weightKg, 1400, 80);
      setIf('weightKg', weightTarget, clampWeight);
    }

    return partial;
  }

  // Move current toward target by at most maxStep, never overshooting.
  function moveToward(current, target, maxStep) {
    if (current === target) return current;
    if (current < target) return Math.min(current + maxStep, target);
    return Math.max(current - maxStep, target);
  }

  // ---- reply copy ------------------------------------------------------

  // Voice intro pools, varied across the 12 combinations. Deltas stay fixed.
  var INTROS = {
    speed: [
      'Speed it is. Straight lines are honest, so let us feed them.',
      'You want velocity. Fine. Here is where the numbers hide.',
      'Top end is a tax you pay in horsepower and pay back in drag. Let us pay it well.'
    ],
    track: [
      'Track focus. Good. Lap time forgives nothing and neither will I.',
      'You want to corner. Then we buy grip and downforce, in that order.',
      'The clock only cares about grip and mass. So that is what we address.'
    ],
    looks: [
      'Presence, then. The car should threaten before it moves.',
      'Stance and proportion. We will sharpen the silhouette and note the physics honestly.',
      'You want it to look fast. We can do that without lying to the stopwatch.'
    ],
    balanced: [
      'Balance. The hardest brief, because everything wants a little.',
      'A little of everything, none of it wasted. Let us split the difference well.',
      'Balanced means disciplined. We move toward the sweet spot, not past it.'
    ]
  };

  // Reasons keyed by which field changed, in the brand voice.
  function reasonFor(key, cfg, partial) {
    switch (key) {
      case 'powerHp': {
        var dp = partial.powerHp - cfg.powerHp;
        if (dp > 0) {
          return 'Power to ' + fmtInt(partial.powerHp) + ' hp, up ' + fmtInt(dp) +
            '. More at the wheels means more speed everywhere, until drag has an opinion.';
        }
        return 'Power to ' + fmtInt(partial.powerHp) + ' hp, down ' + fmtInt(-dp) +
          '. Less heat, less waste, a cleaner balance for the brief.';
      }
      case 'weightKg': {
        var dw = partial.weightKg - cfg.weightKg;
        return 'Weight to ' + fmtInt(partial.weightKg) + ' kg, minus ' + fmtInt(-dw) +
          '. Mass hurts every phase, launch, corner, and brake. Shedding it is free performance.';
      }
      case 'wingLevel': {
        var wl = partial.wingLevel;
        if (wl > cfg.wingLevel) {
          return 'Wing to ' + WING_WORDS[wl] + '. Downforce raises the traction limit in corners. It costs you top speed through drag, and it is worth it.';
        }
        return 'Wing to ' + WING_WORDS[wl] + '. Less drag, higher top speed. Downforce is a corner luxury you do not need here.';
      }
      case 'tireIndex': {
        return 'Tires to ' + TIRE_LABELS[partial.tireIndex] + '. A higher grip compound lifts the traction ceiling in every corner and under braking. Rubber is the cheapest lap time.';
      }
      case 'drivetrain': {
        return 'Drivetrain to ' + partial.drivetrain +
          '. AWD uses all four contact patches at launch, so the power actually reaches the road instead of the smoke.';
      }
      case 'accent': {
        var name = partial.accent === GOLD ? 'champagne gold' : 'oxblood crimson';
        return 'Accent to ' + name + '. Presence is a spec too. It changes nothing the clock measures, and everything the eye does.';
      }
      default:
        return '';
    }
  }

  // Order in which we present mods, most consequential first, for scannability.
  var MOD_ORDER = ['powerHp', 'drivetrain', 'wingLevel', 'tireIndex', 'weightKg', 'accent'];

  function orderedKeys(partial) {
    var keys = [];
    for (var i = 0; i < MOD_ORDER.length; i++) {
      if (Object.prototype.hasOwnProperty.call(partial, MOD_ORDER[i])) {
        keys.push(MOD_ORDER[i]);
      }
    }
    return keys;
  }

  function userLine(budget, focus) {
    var focusWord = {
      speed: 'outright speed',
      track: 'track pace',
      looks: 'looks and presence',
      balanced: 'a balanced build'
    }[focus] || 'a balanced build';
    var budgetWord = { low: 'a modest', med: 'a healthy', high: 'an open' }[budget] || 'a healthy';
    return 'I want ' + focusWord + ', on ' + budgetWord + ' budget.';
  }

  // ---- DOM: bubbles ----------------------------------------------------

  function thread() {
    return byId('advisor-thread');
  }

  function scrollThread() {
    var t = thread();
    if (t) t.scrollTop = t.scrollHeight;
  }

  function appendUser(text) {
    var t = thread();
    if (!t) return;
    var el = document.createElement('div');
    el.className = 'msg user';
    el.textContent = text;
    t.appendChild(el);
    scrollThread();
  }

  // Build an advisor bubble. lines is an array of strings (each its own row).
  // If deltas is a non empty object, append an Apply button wired to it.
  function appendAdvisor(intro, lines, deltas) {
    var t = thread();
    if (!t) return null;
    var el = document.createElement('div');
    el.className = 'msg advisor';

    if (intro) {
      var p = document.createElement('p');
      p.className = 'msg-intro';
      p.textContent = intro;
      el.appendChild(p);
    }

    if (lines && lines.length) {
      var ul = document.createElement('ul');
      ul.className = 'msg-mods';
      for (var i = 0; i < lines.length; i++) {
        var li = document.createElement('li');
        li.textContent = lines[i];
        ul.appendChild(li);
      }
      el.appendChild(ul);
    }

    if (deltas && hasKeys(deltas)) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn-apply-mods';
      btn.textContent = 'Apply these mods';
      btn.addEventListener('click', function () {
        onApply(btn, deltas);
      });
      el.appendChild(btn);
    }

    t.appendChild(el);
    scrollThread();
    return el;
  }

  function hasKeys(obj) {
    for (var k in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, k)) return true;
    }
    return false;
  }

  // ---- apply flow ------------------------------------------------------

  function onApply(btn, deltas) {
    if (!window.App || typeof window.App.applyMods !== 'function') return;
    var next;
    try {
      next = window.App.applyMods(deltas);
    } catch (e) {
      return;
    }
    btn.disabled = true;
    btn.textContent = 'Applied';
    btn.classList.add('applied');

    var confirm = confirmationLine(next, deltas);
    if (confirm) {
      appendAdvisor(null, [confirm], null);
      speak(confirm);
    }
  }

  // Quote one changed stat with a real recomputed number.
  function confirmationLine(cfg, deltas) {
    if (!cfg || !window.Physics || typeof window.Physics.compute !== 'function') {
      return 'Applied. The build just became more itself.';
    }
    var perf;
    try {
      perf = window.Physics.compute(cfg);
    } catch (e) {
      return 'Applied. The build just became more itself.';
    }

    if (Object.prototype.hasOwnProperty.call(deltas, 'wingLevel')) {
      return 'Wing at ' + WING_WORDS[cfg.wingLevel].replace('wing level ', 'level ') +
        '. Top speed reads ' + fmtInt(perf.topSpeedKmh) + ' km/h, your 0 to 60 says thank you at ' +
        fmt1(perf.zeroTo60) + ' s.';
    }
    if (Object.prototype.hasOwnProperty.call(deltas, 'tireIndex')) {
      return TIRE_LABELS[cfg.tireIndex] + ' tires now. Braking from 100 settles at ' +
        fmtInt(perf.braking100) + ' m, and the corners feel it first.';
    }
    if (Object.prototype.hasOwnProperty.call(deltas, 'powerHp')) {
      return fmtInt(cfg.powerHp) + ' hp on the crank. Zero to 60 lands at ' +
        fmt1(perf.zeroTo60) + ' s, top speed at ' + fmtInt(perf.topSpeedKmh) + ' km/h.';
    }
    if (Object.prototype.hasOwnProperty.call(deltas, 'weightKg')) {
      return fmtInt(cfg.weightKg) + ' kg now. Lighter everywhere. Zero to 60 reads ' +
        fmt1(perf.zeroTo60) + ' s and braking ' + fmtInt(perf.braking100) + ' m.';
    }
    if (Object.prototype.hasOwnProperty.call(deltas, 'drivetrain')) {
      return cfg.drivetrain + ' engaged. Launch cleans up, 0 to 60 at ' +
        fmt1(perf.zeroTo60) + ' s with the power finally landing.';
    }
    if (Object.prototype.hasOwnProperty.call(deltas, 'accent')) {
      return 'Repainted. The stopwatch still reads ' + fmt1(perf.zeroTo60) +
        ' s, but the car now looks like it means it.';
    }
    return 'Applied. Top speed now ' + fmtInt(perf.topSpeedKmh) + ' km/h.';
  }

  // ---- the consult handler --------------------------------------------

  function consult() {
    var budget = state.budget;
    var focus = state.focus;

    appendUser(userLine(budget, focus));

    window.setTimeout(function () {
      deterministicReply(budget, focus, null);
    }, 400);
  }

  // Run the deterministic engine for an explicit budget + focus and render it
  // as an advisor bubble. Shared by the chip consult flow and the typed
  // fallback path. prefix is an optional short lead line (guided advice note).
  function deterministicReply(budget, focus, prefix) {
    var cfg = (window.App && typeof window.App.getConfig === 'function')
      ? window.App.getConfig()
      : null;

    if (!cfg) {
      var noBuild = 'There is nothing in the garage yet. Start a build, pick a car, then come back and I will have opinions worth applying.';
      var noBuildFull = prefix ? prefix + ' ' + noBuild : noBuild;
      appendAdvisor(noBuildFull, null, null);
      lastReplyText = noBuildFull;
      speak(noBuild);
      return;
    }

    var deltas = computeDeltas(cfg, budget, focus);
    var keys = orderedKeys(deltas);
    var key = budget + ':' + focus;
    var intro = pick(INTROS[focus] || INTROS.balanced, key);
    if (prefix) intro = prefix + ' ' + intro;

    if (!keys.length) {
      var matched = 'This build already matches that philosophy. I could pretend otherwise, but I do not flatter. Change the brief, or drive it as it stands.';
      appendAdvisor(intro + ' ' + matched, null, null);
      lastReplyText = intro + ' ' + matched;
      speak(intro + ' ' + matched);
      return;
    }

    var lines = [];
    for (var i = 0; i < keys.length; i++) {
      lines.push(reasonFor(keys[i], cfg, deltas));
    }
    appendAdvisor(intro, lines, deltas);
    lastReplyText = intro + ' ' + lines.join(' ');
    speak(lastReplyText);
  }

  // ======================================================================
  // CONVERSATIONAL FALLBACK ENGINE. A small intent router over typed text, in
  // the advisor voice, always aware of the live build. Profile intents (speed,
  // track, looks) still route through the deterministic delta engine so the
  // Apply these mods button and confirmation flow are preserved. Non profile
  // intents (greeting, braking, top speed, compare, explain, thanks, unknown)
  // answer conversationally with real numbers and no Apply button.
  // ======================================================================

  // Grab the live config, or null if no build is active.
  function liveCfg() {
    return (window.App && typeof window.App.getConfig === 'function')
      ? window.App.getConfig()
      : null;
  }

  // Compute perf for a config, tolerant of a missing Physics module.
  function livePerf(cfg) {
    if (!cfg || !window.Physics || typeof window.Physics.compute !== 'function') return null;
    try { return window.Physics.compute(cfg); } catch (e) { return null; }
  }

  // Resolve the display name of the current car from CARS, falling back to the
  // build name the user gave it.
  function currentCarEntry(cfg) {
    if (!cfg || !window.CARS || !cfg.carId) return null;
    for (var i = 0; i < window.CARS.length; i++) {
      if (window.CARS[i].id === cfg.carId) return window.CARS[i];
    }
    return null;
  }

  function carLabel(cfg) {
    var entry = currentCarEntry(cfg);
    if (entry && entry.name) return entry.name;
    return (cfg && cfg.name) ? cfg.name : 'this build';
  }

  // Variation pools for the conversational intents, keyed the same way as the
  // profile intros so phrasing is stable per build but varied across builds.
  var CONVO = {
    greetingBack: [
      'Hello.', 'Well met.', 'You have my attention.', 'Here.'
    ],
    thanks: [
      'Any time. The garage is always open.',
      'Of course. Go make it loud.',
      'That is what I am here for. Drive it like you mean it.'
    ],
    bye: [
      'Go on then. The clock is waiting.',
      'Until next time. Keep it planted.',
      'Off you go. Try not to lift.'
    ],
    unknownLead: [
      'I did not quite catch the brief.',
      'That one slipped past me.',
      'I am not sure what you are after there.'
    ]
  };

  // No build active: one honest line, reused across intents.
  var NO_BUILD = 'There is nothing in the garage yet. Start a build, pick a car, then come back and I will have opinions worth applying.';

  function convoKey(text) {
    return String(text || '').slice(0, 24);
  }

  // Push a plain conversational advisor bubble (single paragraph, no Apply).
  function sayConvo(text) {
    appendAdvisor(text, null, null);
    lastReplyText = text;
    speak(text);
  }

  // ---- intent classification ------------------------------------------

  // Return one of: greeting, speed, track, looks, braking, topspeed, compare,
  // explain, thanks, bye, unknown. Order matters: specific before general.
  function classifyIntent(text) {
    var t = String(text || '').toLowerCase().trim();
    if (!t) return 'unknown';

    if (/^(hi|hey|hello|yo|sup|hiya|howdy|heya|hi there|hello there|good (morning|evening|afternoon))\b/.test(t) ||
        /^(hi|hey|hello|yo|sup)[!.\s]*$/.test(t)) {
      return 'greeting';
    }
    // Braking before greetings/signoffs and general track, since brake
    // questions are their own answer and words like "later" collide with bye.
    if (/\b(brake|braking|brakes|stopping distance|brake later|brake harder|braking distance)\b/.test(t) ||
        (/\bstop\b/.test(t) && !/\bstop it\b/.test(t))) {
      return 'braking';
    }
    if (/\b(thank|thanks|thx|cheers|appreciate)\b/.test(t)) return 'thanks';
    if (/\b(goodbye|see ya|see you later|catch you later|farewell|cya)\b/.test(t) ||
        /^(bye|later)[!.\s]*$/.test(t)) {
      return 'bye';
    }
    // Top speed / drag wall.
    if (/\b(top speed|top end|vmax|v max|drag wall|how fast|limited by|terminal|max speed)\b/.test(t)) {
      return 'topspeed';
    }
    // Compare / what car.
    if (/\b(what car|which car|what am i|what is this|compare|versus|vs\b|against|other cars|difference|different from)\b/.test(t)) {
      return 'compare';
    }
    // Explain / engineering.
    if (/\b(explain|why|how does|how come|what do the numbers|the numbers|engineering|break it down|whats going on|what is going on|understand)\b/.test(t)) {
      return 'explain';
    }
    // Straight line speed. Match fast and its superlatives (fast, faster,
    // fastest), plus power and acceleration language.
    if (/\bfast(er|est)?\b/.test(t) ||
        /\b(speed|straight|velocit|accelerat|quick(er|est)?|more power|horsepower|\bhp\b|launch)\b/.test(t)) {
      return 'speed';
    }
    // Track / corners / grip.
    if (/\b(track|corner|cornering|grip|handling|downforce|wing|aero|lap|grippier|turn in|rotate)\b/.test(t)) {
      return 'track';
    }
    // Looks / stance / colour.
    if (/\b(look|looks|stance|color|colour|accent|paint|presence|style|beautiful|pretty|mean(er)?|aggressive)\b/.test(t)) {
      return 'looks';
    }
    return 'unknown';
  }

  // ---- conversational intent handlers ---------------------------------

  function replyGreeting() {
    var cfg = liveCfg();
    var hello = pick(CONVO.greetingBack, 'greet');
    if (!cfg) {
      sayConvo(hello + ' ' + NO_BUILD);
      return;
    }
    var perf = livePerf(cfg);
    var name = carLabel(cfg);
    var line = hello + ' You are sitting in ' + name + ', ' + fmtInt(cfg.powerHp) + ' hp at ' +
      fmtInt(cfg.weightKg) + ' kg';
    if (perf) {
      line += ', ' + fmt1(perf.zeroTo60) + ' seconds to 60';
    }
    line += '. Ask me how to make it faster, or tell me what you want it to do.';
    sayConvo(line);
  }

  function replyBraking() {
    var cfg = liveCfg();
    if (!cfg) { sayConvo(NO_BUILD); return; }
    var perf = livePerf(cfg);
    if (!perf) { sayConvo('I cannot read the physics right now. Reopen the build and ask again.'); return; }
    var line = 'From 100 km/h you stop in ' + fmtInt(perf.braking100) + ' m on ' +
      (TIRE_LABELS[cfg.tireIndex] || 'the current') + ' tires, about ' +
      fmt1(perf.eng.brakeDecelG) + ' g of retardation. To brake later you raise the traction ceiling: a grippier compound is the cheapest metre, more wing plants the car under load, and every kilo you shed is a shorter stop. Want me to build that?';
    appendAdvisor(line, null, null);
    lastReplyText = line;
    speak(line);
  }

  function replyTopSpeed() {
    var cfg = liveCfg();
    if (!cfg) { sayConvo(NO_BUILD); return; }
    var perf = livePerf(cfg);
    if (!perf) { sayConvo('I cannot read the physics right now. Reopen the build and ask again.'); return; }
    var line = 'Top speed reads ' + fmtInt(perf.topSpeedKmh) + ' km/h, and it is a drag wall, not a power wall. At ' +
      WING_LABELS[cfg.wingLevel].toLowerCase() + ' wing your frontal drag area is ' + perf.eng.CdA.toFixed(2) +
      ' m squared, and it is eating ' + fmtInt(perf.eng.dragPowerAtTop / 745.7) + ' hp just to hold that speed. Drop the wing and the wall moves out, at the cost of corner grip. Want the low-drag build?';
    appendAdvisor(line, null, null);
    lastReplyText = line;
    speak(line);
  }

  function replyCompare() {
    var cfg = liveCfg();
    if (!cfg) { sayConvo(NO_BUILD); return; }
    var name = carLabel(cfg);
    var entry = currentCarEntry(cfg);
    var neighbor = pickNeighbor(entry);
    var perf = livePerf(cfg);
    var line = 'This is ' + name;
    if (entry && entry.sub) line += ', ' + entry.sub.toLowerCase();
    line += '. It carries ' + fmtInt(cfg.powerHp) + ' hp and ' + fmtInt(cfg.weightKg) + ' kg';
    if (perf) line += ' for ' + fmtInt(perf.ptw) + ' hp per tonne';
    line += '.';
    if (neighbor) {
      var dPow = cfg.powerHp - neighbor.powerHp;
      var dWt = cfg.weightKg - neighbor.weightKg;
      var powWord = dPow > 0 ? (fmtInt(dPow) + ' hp more power') : (dPow < 0 ? (fmtInt(-dPow) + ' hp less power') : 'the same power');
      var wtWord = dWt > 0 ? (fmtInt(dWt) + ' kg heavier') : (dWt < 0 ? (fmtInt(-dWt) + ' kg lighter') : 'the same mass');
      line += ' Against the ' + neighbor.name + ' it has ' + powWord + ' and is ' + wtWord + '.';
    }
    sayConvo(line);
  }

  // Pick a meaningful neighbor from CARS: the nearest by power that is not the
  // current car, so the contrast is legible.
  function pickNeighbor(entry) {
    if (!entry || !window.CARS) return null;
    var best = null, bestGap = Infinity;
    for (var i = 0; i < window.CARS.length; i++) {
      var c = window.CARS[i];
      if (c.id === entry.id) continue;
      var gap = Math.abs(c.powerHp - entry.powerHp);
      if (gap < bestGap) { bestGap = gap; best = c; }
    }
    return best;
  }

  function replyExplain() {
    var cfg = liveCfg();
    if (!cfg) { sayConvo(NO_BUILD); return; }
    var perf = livePerf(cfg);
    if (!perf) { sayConvo('I cannot read the physics right now. Reopen the build and ask again.'); return; }
    var line = 'Two sentences. You have ' + fmtInt(perf.ptw) + ' hp per tonne pushing against ' +
      perf.eng.CdA.toFixed(2) + ' m squared of drag, which is why it reaches 60 in ' + fmt1(perf.zeroTo60) +
      ' s and tops out at ' + fmtInt(perf.topSpeedKmh) + ' km/h. Grip from ' + (TIRE_LABELS[cfg.tireIndex] || 'the') +
      ' rubber and ' + WING_LABELS[cfg.wingLevel].toLowerCase() + ' wing gives you a ' + fmtInt(perf.braking100) +
      ' m stop from 100 and holds it through the corners. Ask me to tune any one of those.';
    sayConvo(line);
  }

  function replyThanks() {
    sayConvo(pick(CONVO.thanks, 'thx'));
  }

  function replyBye() {
    sayConvo(pick(CONVO.bye, 'bye'));
  }

  // Unknown: no lecture. One clarifying question offering three concrete things.
  function replyUnknown() {
    var lead = pick(CONVO.unknownLead, 'unk');
    var line = lead + ' Tell me what you want and I will build it: make it faster, corner harder, or explain the numbers. Which one?';
    sayConvo(line);
  }

  // Master router for fallback typed input. Returns nothing; renders a reply.
  function routeFallback(text) {
    var intent = classifyIntent(text);
    switch (intent) {
      case 'greeting': replyGreeting(); return;
      case 'thanks': replyThanks(); return;
      case 'bye': replyBye(); return;
      case 'braking': replyBraking(); return;
      case 'topspeed': replyTopSpeed(); return;
      case 'compare': replyCompare(); return;
      case 'explain': replyExplain(); return;
      case 'speed': deterministicReply(state.budget, 'speed', null); return;
      case 'track': deterministicReply(state.budget, 'track', null); return;
      case 'looks': deterministicReply(state.budget, 'looks', null); return;
      default: replyUnknown(); return;
    }
  }

  // ---- voice (optional, feature detected) ------------------------------

  function speak(text) {
    if (!voiceOn) return;
    if (typeof window.speechSynthesis === 'undefined') return;
    try {
      window.speechSynthesis.cancel();
      var u = new window.SpeechSynthesisUtterance(text);
      u.rate = 0.95;
      window.speechSynthesis.speak(u);
    } catch (e) {
      // never throw on speech
    }
  }

  function toggleVoice() {
    voiceOn = !voiceOn;
    var btn = byId('btn-voice');
    if (btn) btn.setAttribute('aria-pressed', voiceOn ? 'true' : 'false');
    if (voiceOn) {
      // Speak the most recent full reply so voice applies to AI answers too.
      if (lastReplyText) speak(lastReplyText);
    } else if (typeof window.speechSynthesis !== 'undefined') {
      try {
        window.speechSynthesis.cancel();
      } catch (e) {
        // ignore
      }
    }
  }

  // ======================================================================
  // AI CHAT (WebLLM). Lazy, capability gated, fallback safe.
  // mode: 'fallback' until an engine is ready, then 'ai'. During init the
  // engine is warming up but typed input still answers in fallback style.
  // ======================================================================

  var ai = {
    mode: 'fallback',   // 'fallback' | 'ai'
    engine: null,       // MLCEngine once ready
    started: false,     // init attempted (once only)
    warming: false,     // init in progress
    generating: false,  // a reply is currently being produced (queue guard)
    history: []         // rolling [{role, content}], user/assistant only
  };

  // Preference order. First available in prebuiltAppConfig.model_list wins.
  var MODEL_PREFERENCE = [
    'Llama-3.2-1B-Instruct-q4f16_1-MLC',
    'Qwen2.5-1.5B-Instruct-q4f16_1-MLC'
  ];

  var WEBLLM_CDN = 'https://esm.run/@mlc-ai/web-llm';

  var SYSTEM_PROMPT = [
    'You are the Valence Garage build advisor, an on-device assistant for a hypercar configurator.',
    'Your voice is precise, calm, and slightly sardonic, but never rude.',
    'When the user greets you, greet them back briefly in one line, then invite a question.',
    'Always answer the exact question the user asked before offering anything extra.',
    'Be concise and use plain language. No markdown, no tables, no bullet symbols, no headings.',
    'Keep every reply under 120 words. Advise on power in hp, weight in kg, drivetrain (RWD or AWD),',
    'wing level from 0 to 4, and tire compound (touring, sport, cup, slick).',
    'Be physics honest: more wing adds downforce and drag, which lowers top speed but helps cornering',
    'and braking. Less weight helps every phase. AWD launches cleaner than RWD.',
    'When you recommend concrete changes, state exact numbers so they can be applied.',
    'Do not use em dashes.'
  ].join(' ');

  // Warmup guardrails. Hard ceiling on total warmup, plus a stall watchdog that
  // fires if the init progress callback stops moving for STALL_MS.
  var WARMUP_HARD_MS = 45000;
  var WARMUP_STALL_MS = 20000;
  var warmupHardTimer = null;
  var warmupStallTimer = null;

  // The one calm line shown when warmup gives up. Shown briefly, then hidden.
  var FALLBACK_NOTICE = 'The on-device AI is unavailable here. You have my rules instead.';

  // ---- status line -----------------------------------------------------

  function statusEl() {
    return byId('advisor-status');
  }

  function showStatus(text) {
    var el = statusEl();
    if (!el) return;
    el.textContent = text;
    el.hidden = false;
  }

  function hideStatus() {
    var el = statusEl();
    if (el) el.hidden = true;
  }

  // ---- build context ---------------------------------------------------

  // Fresh one line context of the live build, or a note that none is active.
  function buildContext() {
    var cfg = (window.App && typeof window.App.getConfig === 'function')
      ? window.App.getConfig()
      : null;
    if (!cfg) {
      return 'No build is active. If the user asks for advice, suggest they start a build and pick a car first.';
    }
    var carName = cfg.name || 'Untitled build';
    var sub = '';
    if (window.CARS && cfg.carId) {
      for (var i = 0; i < window.CARS.length; i++) {
        if (window.CARS[i].id === cfg.carId) { sub = window.CARS[i].sub || ''; break; }
      }
    }
    var perf = null;
    if (window.Physics && typeof window.Physics.compute === 'function') {
      try { perf = window.Physics.compute(cfg); } catch (e) { perf = null; }
    }
    var parts = [
      'Current build: ' + carName + (sub ? ' (' + sub + ')' : '') + '.',
      'powerHp ' + fmtInt(cfg.powerHp) + ', weightKg ' + fmtInt(cfg.weightKg) +
        ', drivetrain ' + cfg.drivetrain + ', wingLevel ' + cfg.wingLevel +
        ', tireIndex ' + cfg.tireIndex + ' (' + (TIRE_LABELS[cfg.tireIndex] || '') + ').'
    ];
    if (perf) {
      parts.push('Computed: 0 to 60 ' + fmt1(perf.zeroTo60) + ' s, top speed ' +
        fmtInt(perf.topSpeedKmh) + ' km/h, braking from 100 ' + fmtInt(perf.braking100) + ' m.');
    }
    return parts.join(' ');
  }

  // Assemble the message array for a request: system + context + rolling history.
  function buildMessages() {
    var msgs = [{ role: 'system', content: SYSTEM_PROMPT + '\n\n' + buildContext() }];
    var hist = ai.history.slice(-12); // last 6 turns (user + assistant)
    for (var i = 0; i < hist.length; i++) msgs.push(hist[i]);
    return msgs;
  }

  // ---- lazy init -------------------------------------------------------

  function initAI() {
    if (ai.started) return;
    ai.started = true;

    // Capability gate: WebGPU must exist.
    if (typeof navigator === 'undefined' || !navigator.gpu) {
      quietFallback();
      return;
    }
    ai.warming = true;
    showStatus('Warming up the advisor');
    startWarmupTimers();
    runInit();
  }

  // Hard ceiling: if the engine is not ready within WARMUP_HARD_MS, give up and
  // fall back with the one calm line. The stall watchdog is (re)armed on every
  // progress callback; if it fires the same fallback path runs.
  function startWarmupTimers() {
    clearWarmupTimers();
    warmupHardTimer = window.setTimeout(function () {
      warmupTimedOut();
    }, WARMUP_HARD_MS);
    armStallTimer();
  }

  function armStallTimer() {
    if (warmupStallTimer) window.clearTimeout(warmupStallTimer);
    warmupStallTimer = window.setTimeout(function () {
      warmupTimedOut();
    }, WARMUP_STALL_MS);
  }

  function clearWarmupTimers() {
    if (warmupHardTimer) { window.clearTimeout(warmupHardTimer); warmupHardTimer = null; }
    if (warmupStallTimer) { window.clearTimeout(warmupStallTimer); warmupStallTimer = null; }
  }

  // Warmup ceiling or stall reached. Switch to fallback for the session and show
  // the one calm status line, then hide it. If the engine has already come
  // online (race), do nothing.
  function warmupTimedOut() {
    if (ai.mode === 'ai') return;
    clearWarmupTimers();
    ai.mode = 'fallback';
    ai.engine = null;
    ai.warming = false;
    showStatus(FALLBACK_NOTICE);
    window.setTimeout(hideStatus, 4200);
  }

  // All await wrapped. Any failure at any stage drops to fallback quietly.
  function runInit() {
    (function () {
      var enginePromise;
      try {
        enginePromise = createEngine();
      } catch (e) {
        quietFallback();
        return;
      }
      Promise.resolve(enginePromise).then(function (engine) {
        // If warmup already timed out into fallback, discard the late engine so
        // we do not flip modes underneath a conversation in progress.
        if (ai.mode !== 'fallback' && !engine) { quietFallback(); return; }
        if (ai.mode === 'fallback' && !ai.warming) return; // timed out already
        if (!engine) { quietFallback(); return; }
        clearWarmupTimers();
        ai.engine = engine;
        ai.mode = 'ai';
        ai.warming = false;
        showStatus('Advisor online');
        window.setTimeout(hideStatus, 1600);
      }).catch(function () {
        quietFallback();
      });
    })();
  }

  // Dynamic import + engine creation. Returns a Promise resolving to the engine
  // or null. Never throws (rejection handled by caller).
  function createEngine() {
    return import(/* webpackIgnore: true */ WEBLLM_CDN).then(function (webllm) {
      if (!webllm || typeof webllm.CreateMLCEngine !== 'function') return null;
      var model = selectModel(webllm);
      if (!model) return null;
      return webllm.CreateMLCEngine(model, { initProgressCallback: onInitProgress });
    });
  }

  // Pick the first preferred model actually present in the prebuilt list.
  function selectModel(webllm) {
    var list = [];
    try {
      var cfg = webllm.prebuiltAppConfig;
      if (cfg && cfg.model_list) {
        for (var i = 0; i < cfg.model_list.length; i++) {
          if (cfg.model_list[i] && cfg.model_list[i].model_id) list.push(cfg.model_list[i].model_id);
        }
      }
    } catch (e) {
      list = [];
    }
    for (var p = 0; p < MODEL_PREFERENCE.length; p++) {
      if (list.indexOf(MODEL_PREFERENCE[p]) >= 0) return MODEL_PREFERENCE[p];
    }
    // Preferred models missing from the runtime list: fall back to first pref
    // and let init succeed or fail (WebLLM will error, we drop to fallback).
    return list.length ? null : MODEL_PREFERENCE[0];
  }

  function onInitProgress(report) {
    if (ai.mode === 'ai') return; // already online
    if (!ai.warming) return;      // already timed out into fallback
    armStallTimer();              // progress moved: reset the stall watchdog
    var pct = null;
    if (report && typeof report.progress === 'number') {
      pct = Math.round(report.progress * 100);
    }
    if (pct !== null && !isNaN(pct)) {
      showStatus('Warming up the advisor, ' + pct + ' percent');
    } else if (report && report.text) {
      showStatus('Warming up the advisor');
    }
  }

  function quietFallback() {
    clearWarmupTimers();
    ai.mode = 'fallback';
    ai.engine = null;
    ai.warming = false;
    hideStatus();
  }

  // ---- streaming chat --------------------------------------------------

  // Append an empty advisor bubble we stream text into. Returns the text node
  // holder so chunks can grow it progressively.
  function appendStreamingBubble() {
    var t = thread();
    if (!t) return null;
    var el = document.createElement('div');
    el.className = 'msg advisor';
    var p = document.createElement('p');
    p.className = 'msg-intro';
    p.textContent = '';
    el.appendChild(p);
    t.appendChild(el);
    scrollThread();
    return { wrap: el, textNode: p };
  }

  // Send typed text through the AI engine, streaming the reply. Fully wrapped:
  // any failure renders a graceful fallback answer instead.
  function aiChat(text) {
    ai.history.push({ role: 'user', content: text });

    var holder = appendStreamingBubble();
    var acc = '';

    (function () {
      var streamPromise;
      try {
        streamPromise = ai.engine.chat.completions.create({
          stream: true,
          messages: buildMessages(),
          temperature: 0.7,
          max_tokens: 320
        });
      } catch (e) {
        finishWithFallback(holder, text);
        setGenerating(false);
        return;
      }

      Promise.resolve(streamPromise).then(function (stream) {
        return consumeStream(stream, holder, function (chunk) {
          acc += chunk;
        });
      }).then(function () {
        var full = acc.trim();
        if (!full) { finishWithFallback(holder, text); return; }
        ai.history.push({ role: 'assistant', content: full });
        trimHistory();
        if (holder && holder.textNode) holder.textNode.textContent = full;
        lastReplyText = full;
        speak(full);
        try { attachApplyIfParsed(holder.wrap, full); } catch (e) { /* parsing never breaks chat */ }
        scrollThread();
      }).catch(function () {
        finishWithFallback(holder, text);
      }).then(function () {
        // Always re-enable sending once the reply settles, success or failure.
        setGenerating(false);
      });
    })();
  }

  // Iterate an async-iterable stream (or a promise of one), pulling delta text
  // out of each chunk and calling onChunk. Progressive textContent updates.
  function consumeStream(stream, holder, onChunk) {
    if (!stream || typeof stream[Symbol.asyncIterator] !== 'function') {
      // Non streaming shape: a single completion object.
      var one = extractDelta(stream);
      if (one) {
        onChunk(one);
        if (holder && holder.textNode) holder.textNode.textContent += one;
        scrollThread();
      }
      return Promise.resolve();
    }
    var iterator = stream[Symbol.asyncIterator]();
    function step() {
      return iterator.next().then(function (res) {
        if (res.done) return;
        var piece = extractDelta(res.value);
        if (piece) {
          onChunk(piece);
          if (holder && holder.textNode) {
            holder.textNode.textContent += piece;
            scrollThread();
          }
        }
        return step();
      });
    }
    return step();
  }

  // Pull the incremental text from a WebLLM chunk (streaming delta) or a full
  // completion object. Tolerant of both shapes.
  function extractDelta(chunk) {
    if (!chunk) return '';
    try {
      var ch = chunk.choices && chunk.choices[0];
      if (!ch) return '';
      if (ch.delta && typeof ch.delta.content === 'string') return ch.delta.content;
      if (ch.message && typeof ch.message.content === 'string') return ch.message.content;
    } catch (e) {
      return '';
    }
    return '';
  }

  function trimHistory() {
    if (ai.history.length > 12) {
      ai.history = ai.history.slice(ai.history.length - 12);
    }
  }

  // If the AI call failed after we already committed the user turn, answer with
  // the deterministic engine so the thread is never left dangling.
  function finishWithFallback(holder, text) {
    if (holder && holder.wrap && holder.wrap.parentNode) {
      holder.wrap.parentNode.removeChild(holder.wrap);
    }
    // Drop the dangling user turn so history stays coherent.
    if (ai.history.length && ai.history[ai.history.length - 1].role === 'user') {
      ai.history.pop();
    }
    // Answer with the conversational router so greetings, questions, and
    // profile requests all get a real reply, never a canned lecture.
    routeFallback(text);
  }

  // ---- apply-mods parsing (tolerant, never throws) ---------------------

  var NUM_WORD = {
    zero: 0, one: 1, two: 2, three: 3, four: 4
  };

  // Parse an AI reply for concrete parameter suggestions. Returns a partial
  // config of only the fields that differ from the current build, or null.
  function parseMods(text) {
    var cfg = (window.App && typeof window.App.getConfig === 'function')
      ? window.App.getConfig()
      : null;
    if (!cfg) return null;

    var lower = String(text || '').toLowerCase();
    var partial = {};

    // Power: a number immediately followed by hp.
    var hpMatch = lower.match(/(\d{3,4})\s*hp\b/);
    if (hpMatch) {
      var hp = clampPower(parseInt(hpMatch[1], 10));
      if (hp !== cfg.powerHp) partial.powerHp = hp;
    }

    // Weight: a number followed by kg. Bare 900..2200 is an absolute target,
    // otherwise a delta if minus/reduce/drop/shed context is present.
    var kgMatch = lower.match(/(?:(minus|reduce|drop|shed|cut|lose|lighter\s+by|down)\s+)?(\d{2,4})\s*kg\b/);
    if (kgMatch) {
      var n = parseInt(kgMatch[2], 10);
      var ctx = kgMatch[1];
      var targetKg = null;
      if (n >= 900 && n <= 2200 && !ctx) {
        targetKg = n;
      } else if (ctx) {
        targetKg = cfg.weightKg - n;
      }
      if (targetKg !== null) {
        var w = clampWeight(targetKg);
        if (w !== cfg.weightKg) partial.weightKg = w;
      }
    }

    // Wing: "wing level N", "wing to N", "wing to level N", "wing N".
    // Filler words (to, level, of, at) may repeat, so consume any run of them.
    var wingMatch = lower.match(/wing(?:\s+(?:to|level|of|at))*\s+(zero|one|two|three|four|[0-4])\b/);
    if (wingMatch) {
      var wv = wingMatch[1];
      var wl = (wv in NUM_WORD) ? NUM_WORD[wv] : parseInt(wv, 10);
      wl = clampWing(wl);
      if (wl !== cfg.wingLevel) partial.wingLevel = wl;
    }

    // Tire compound by name.
    var tireIdx = -1;
    if (/\bslick/.test(lower)) tireIdx = 3;
    else if (/\bcup\b/.test(lower)) tireIdx = 2;
    else if (/\bsport\b/.test(lower)) tireIdx = 1;
    else if (/\btouring\b/.test(lower)) tireIdx = 0;
    if (tireIdx >= 0 && tireIdx !== cfg.tireIndex) partial.tireIndex = tireIdx;

    // Drivetrain words.
    if (/\bawd\b|all\s*wheel/.test(lower) && cfg.drivetrain !== 'AWD') partial.drivetrain = 'AWD';
    else if (/\brwd\b|rear\s*wheel/.test(lower) && cfg.drivetrain !== 'RWD') partial.drivetrain = 'RWD';

    return hasKeys(partial) ? partial : null;
  }

  // After an AI reply, attach the Apply button if we parsed usable mods.
  function attachApplyIfParsed(wrapEl, text) {
    if (!wrapEl) return;
    var deltas = null;
    try { deltas = parseMods(text); } catch (e) { deltas = null; }
    if (!deltas) return;
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn-apply-mods';
    btn.textContent = 'Apply these mods';
    btn.addEventListener('click', function () {
      onApply(btn, deltas);
    });
    wrapEl.appendChild(btn);
    scrollThread();
  }

  // ---- send handling (typed input) -------------------------------------

  function handleSend() {
    // Queue guard: while a reply is generating, ignore further sends so we never
    // stack requests or leave a dead state.
    if (ai.generating) return;

    var input = byId('advisor-input');
    if (!input) return;
    var text = String(input.value || '').trim();
    if (!text) return;
    input.value = '';

    appendUser(text);
    setChatState();

    // AI path: stream the reply. Send stays disabled until the stream settles,
    // re-enabled in aiChat's finally. Every send is answered (stream start or a
    // deterministic fallback inside aiChat on any failure).
    if (ai.mode === 'ai' && ai.engine) {
      setGenerating(true);
      aiChat(text);
      return;
    }

    // Fallback (or still warming): conversational intent router. Renders
    // synchronously, well within the 2 second guarantee. Guard the button
    // through the render so a rapid double press cannot double fire.
    setGenerating(true);
    try {
      routeFallback(text);
    } finally {
      setGenerating(false);
    }
  }

  // Toggle the generating state and reflect it on the send button so the user
  // sees why a second press does nothing.
  function setGenerating(on) {
    ai.generating = !!on;
    var send = byId('btn-send');
    if (send) {
      send.disabled = !!on;
      send.setAttribute('aria-disabled', on ? 'true' : 'false');
    }
  }

  // After the first user message, compact the advisor hero so the thread gets
  // the room. Guarded: if the shell has not restructured the hero yet, this is
  // a safe no-op.
  function compactHero() {
    var hero = byId('advisor-hero');
    if (hero && !hero.classList.contains('compact')) {
      hero.classList.add('compact');
    }
  }

  // ---- lazy-open detection ---------------------------------------------

  // Kick AI init the first time the Advisor screen becomes active, or on first
  // interaction inside it. Cheap: disconnects after firing once.
  function watchForOpen() {
    var screen = byId('screen-advisor');
    if (!screen) return;

    function fire() {
      initAI();
      if (observer) observer.disconnect();
    }

    if (screen.classList.contains('active')) {
      fire();
      return;
    }

    var observer = null;
    if (typeof MutationObserver !== 'undefined') {
      observer = new MutationObserver(function () {
        if (screen.classList.contains('active')) fire();
      });
      observer.observe(screen, { attributes: true, attributeFilter: ['class'] });
    }
    // Belt and suspenders: first interaction inside the screen also fires.
    screen.addEventListener('pointerdown', fire, { once: true });
  }

  // ======================================================================
  // SCREEN STATES + VOICE. The advisor screen has two states, toggled via
  // classes on #screen-advisor (Agent S styles them):
  //   .state-hero  initial: huge tappable orb, title, keyboard affordance;
  //                thread, chips and input row hidden.
  //   .state-chat  after the first message: orb compacts, thread + chips +
  //                input row visible.
  // Tapping #advisor-orb toggles speech recognition; interim text renders
  // live into #voice-live; the final transcript submits through the SAME
  // path as a typed message. #btn-keyboard reveals the input row without
  // leaving hero. All DOM lookups are guarded so nothing throws if Agent S's
  // elements are not present yet, and the wiring self-heals when they land.
  // ======================================================================

  var chatStarted = false;   // becomes true on the first submitted message
  var recognition = null;    // active SpeechRecognition instance while listening
  var recognizing = false;   // listening flag (guards double toggles)
  var voiceWired = false;     // orb/keyboard/input listeners attached once

  function advisorScreen() {
    return byId('screen-advisor');
  }

  // Orb state: exactly one of idle / listening / thinking, read each frame by
  // orb.js. Guarded so a missing orb is a safe no-op.
  function setOrbState(name) {
    var orb = byId('advisor-orb');
    if (!orb || !orb.classList) return;
    orb.classList.remove('idle', 'listening', 'thinking');
    if (name) orb.classList.add(name);
  }

  function orbIdle() { setOrbState('idle'); }
  function orbListening() { setOrbState('listening'); }
  function orbThinking() { setOrbState('thinking'); }

  // Enter the hero state (default). Idempotent.
  function setHeroState() {
    var s = advisorScreen();
    if (s && s.classList) {
      s.classList.add('state-hero');
      s.classList.remove('state-chat');
    }
    if (!chatStarted) orbIdle();
  }

  // Enter the chat state on the first submitted message. Idempotent.
  function setChatState() {
    chatStarted = true;
    var s = advisorScreen();
    if (s && s.classList) {
      s.classList.remove('state-hero');
      s.classList.add('state-chat');
    }
    // Legacy hero compaction stays for any shell that still uses it.
    compactHero();
  }

  // The live-transcript / notice line under the orb (Agent S's #voice-live).
  function voiceLiveEl() {
    return byId('voice-live');
  }

  function showVoiceLive(text) {
    var el = voiceLiveEl();
    if (!el) return;
    el.textContent = text || '';
    el.hidden = !text;
  }

  function clearVoiceLive() {
    var el = voiceLiveEl();
    if (!el) return;
    el.textContent = '';
    el.hidden = true;
  }

  // Reveal the typed input row and focus it. Used by #btn-keyboard, by the
  // dashboard quick-entry focus request, and by the unsupported-voice notice.
  // Does not leave hero state on its own (a message send does that).
  function revealInput(focusIt) {
    var row = byId('advisor-input-row');
    if (row) {
      row.hidden = false;
      row.classList.add('revealed');
    }
    var s = advisorScreen();
    if (s && s.classList) s.classList.add('input-open');
    if (focusIt) {
      var input = byId('advisor-input');
      if (input && typeof input.focus === 'function') {
        try { input.focus(); } catch (e) {}
      }
    }
  }

  // ---- speech recognition (feature detected) ---------------------------

  function SpeechRec() {
    return window.SpeechRecognition || window.webkitSpeechRecognition || null;
  }

  function voiceSupported() {
    return !!SpeechRec();
  }

  // The one calm line when speech recognition is missing or errors.
  var VOICE_UNAVAILABLE = 'Voice is not available here. Use the keyboard.';

  function voiceUnavailable() {
    recognizing = false;
    orbIdle();
    showVoiceLive(VOICE_UNAVAILABLE);
    revealInput(true);
  }

  // Tap handler on the orb: toggle listening on, or stop if already on.
  function toggleListen() {
    if (recognizing) { stopListen(); return; }
    startListen();
  }

  function startListen() {
    var Rec = SpeechRec();
    if (!Rec) { voiceUnavailable(); return; }
    var rec;
    try {
      rec = new Rec();
    } catch (e) {
      voiceUnavailable();
      return;
    }
    rec.continuous = false;
    rec.interimResults = true;
    rec.lang = (navigator && navigator.language) ? navigator.language : 'en-US';

    var finalText = '';

    rec.onstart = function () {
      recognizing = true;
      orbListening();
      showVoiceLive('');
    };

    rec.onresult = function (event) {
      var interim = '';
      finalText = '';
      try {
        for (var i = event.resultIndex; i < event.results.length; i++) {
          var res = event.results[i];
          var chunk = res[0] && res[0].transcript ? res[0].transcript : '';
          if (res.isFinal) finalText += chunk;
          else interim += chunk;
        }
      } catch (e) {
        interim = '';
      }
      var live = (finalText + ' ' + interim).trim();
      if (live) showVoiceLive(live);
    };

    rec.onerror = function () {
      // Any recognition error degrades to the calm keyboard notice.
      recognizing = false;
      recognition = null;
      if (!chatStarted) orbIdle();
      showVoiceLive(VOICE_UNAVAILABLE);
      revealInput(true);
    };

    rec.onend = function () {
      recognizing = false;
      recognition = null;
      if (!chatStarted) orbIdle();
      var text = String(finalText || '').trim();
      if (text) {
        clearVoiceLive();
        submitMessage(text);
      }
      // No final text (user tapped to cancel, or silence): leave any notice
      // as-is; if #voice-live only held interim text, clear it.
      else if (voiceLiveEl() && voiceLiveEl().textContent !== VOICE_UNAVAILABLE) {
        clearVoiceLive();
      }
    };

    recognition = rec;
    try {
      rec.start();
    } catch (e) {
      voiceUnavailable();
    }
  }

  function stopListen() {
    if (recognition) {
      try { recognition.stop(); } catch (e) {}
    }
    recognizing = false;
  }

  // ---- unified submit path (typed OR voice) ----------------------------

  // Single entry point for a user message from any source. Flips to chat
  // state, appends the user bubble, and routes to AI or fallback exactly as
  // the typed path did. Keeps the always-reply guarantee.
  function submitMessage(text) {
    var clean = String(text || '').trim();
    if (!clean) return;
    if (ai.generating) return;

    setChatState();
    appendUser(clean);

    if (ai.mode === 'ai' && ai.engine) {
      setGenerating(true);
      aiChat(clean);
      return;
    }

    setGenerating(true);
    try {
      routeFallback(clean);
    } finally {
      setGenerating(false);
    }
  }

  // Wire the orb tap, the keyboard affordance, and input-focus reveal. Called
  // from init and safe to call again (guards against double binding).
  function wireVoiceAndStates() {
    if (voiceWired) return;
    voiceWired = true;

    // Default to hero state on load.
    setHeroState();

    var orb = byId('advisor-orb');
    if (orb) {
      orb.addEventListener('click', function () { toggleListen(); });
      orb.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
          e.preventDefault();
          toggleListen();
        }
      });
    }

    var kbd = byId('btn-keyboard');
    if (kbd) {
      kbd.addEventListener('click', function () {
        // Reveal + focus the input row; stay in hero until a message is sent.
        revealInput(true);
      });
    }

    // A focus request on the input (dashboard quick-entry, or programmatic)
    // reveals the input row in whatever state we are in.
    var input = byId('advisor-input');
    if (input) {
      input.addEventListener('focus', function () { revealInput(false); });
    }
  }

  // ---- chip binding ----------------------------------------------------

  function bindChipGroup(attr, stateKey) {
    var btns = document.querySelectorAll('#advisor-chips [' + attr + ']');
    for (var i = 0; i < btns.length; i++) {
      (function (btn) {
        btn.addEventListener('click', function () {
          var val = btn.getAttribute(attr);
          state[stateKey] = val;
          // one active per group
          for (var j = 0; j < btns.length; j++) {
            if (btns[j] === btn) btns[j].classList.add('active');
            else btns[j].classList.remove('active');
          }
        });
      })(btns[i]);
    }
  }

  // Read pre-marked defaults from the shell so state matches the visible chips.
  function readDefaults() {
    var b = document.querySelector('#advisor-chips .chip.active[data-budget]');
    if (b) state.budget = b.getAttribute('data-budget');
    var f = document.querySelector('#advisor-chips .chip.active[data-focus]');
    if (f) state.focus = f.getAttribute('data-focus');
  }

  // ---- init ------------------------------------------------------------

  function init() {
    if (bound) return;
    bound = true;

    readDefaults();
    bindChipGroup('data-budget', 'budget');
    bindChipGroup('data-focus', 'focus');

    var advise = byId('btn-advise');
    if (advise) advise.addEventListener('click', consult);

    var voice = byId('btn-voice');
    if (voice) {
      voice.setAttribute('aria-pressed', 'false');
      voice.addEventListener('click', toggleVoice);
    }

    // Typed input: send button and Enter key.
    var send = byId('btn-send');
    if (send) send.addEventListener('click', handleSend);

    var input = byId('advisor-input');
    if (input) {
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          handleSend();
        }
      });
    }

    wireVoiceAndStates();

    // Lazy AI init the first time the Advisor screen opens.
    watchForOpen();
  }

  window.Advisor = {
    init: init,

    // v13 public surface for the Clinic and deep links.

    // True when the on-device WebLLM finished warming and is answering.
    aiOnline: function () {
      return ai.mode === 'ai' && !!ai.engine;
    },

    // One-shot generation with a custom prompt, OUTSIDE the chat thread.
    // Streams tokens to onToken, resolves the full text. Rejects if the
    // local engine is unavailable or errors; callers fall back.
    generate: function (prompt, onToken) {
      return new Promise(function (resolve, reject) {
        if (!(ai.mode === 'ai' && ai.engine)) {
          reject(new Error('local engine offline'));
          return;
        }
        var acc = '';
        var p;
        try {
          p = ai.engine.chat.completions.create({
            stream: true,
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.6,
            max_tokens: 380
          });
        } catch (e) { reject(e); return; }
        Promise.resolve(p).then(function (stream) {
          function step(iter) {
            return iter.next().then(function (r) {
              if (r.done) return;
              var delta = '';
              try {
                delta = (r.value.choices && r.value.choices[0] &&
                  r.value.choices[0].delta &&
                  r.value.choices[0].delta.content) || '';
              } catch (e) { }
              if (delta) { acc += delta; if (onToken) onToken(delta); }
              return step(iter);
            });
          }
          var iter = stream[Symbol.asyncIterator]
            ? stream[Symbol.asyncIterator]()
            : null;
          if (!iter) { reject(new Error('non-streaming engine')); return; }
          return step(iter).then(function () { resolve(acc); });
        }).catch(reject);
      });
    },

    // Programmatic question: used by "Ask the Advisor" deep links. Flips
    // to chat state and submits exactly as if the owner typed it.
    ask: function (text) {
      try {
        submitMessage(String(text || ''));
      } catch (e) { }
    }
  };
})();
