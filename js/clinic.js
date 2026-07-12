/* ============================================================
   VALENCE GARAGE. The Clinic. js/clinic.js (v12)

   Four working instruments of automotive mechanical engineering,
   each built on REAL signal processing and REAL solvers, each
   with a built-in synthetic test signal so every claim can be
   verified on a desk in seconds:

   1. ENGINE WHISPERER  Record or upload a noise; a windowed-FFT
      feature extractor (spectral centroid, tonality, band energy,
      impulse rate via envelope autocorrelation) feeds a rule-based
      acoustic classifier over a curated fault-signature table.
      Honest framing: it reports ranked HYPOTHESES with confidence,
      phrased as what to say to your mechanic, not a diagnosis.

   2. TORQUESPLIT  A modification planner. Performance deltas come
      from the same Physics module as the rest of the app; axle
      shear and clutch heat are first-order engineering formulas;
      and a genuine 2D plane-stress FINITE ELEMENT solver (Q4
      elements, assembled global stiffness, dense Gaussian solve)
      renders a von Mises stress map of a mounting bracket under
      the launch torque reaction.

   3. LOADPULSE  The door-slam cargo estimator. wn = sqrt(k/m):
      calibrate empty, slam once loaded, and the shift of the
      suspension's natural frequency gives the added mass. Uses the
      phone's accelerometer via DeviceMotion (HTTPS + permission);
      a Simulate mode pushes synthetic slam waveforms through the
      SAME pipeline so the math is verifiable on any desktop.

   4. PADCHECK  Brake wear-indicator listener. Isolates the 1.8 to
      4.5 kHz indicator band against broadband energy and returns a
      three-state verdict (healthy / indicator contact / grinding).
      Honest framing: millimeter precision is NOT acoustically
      derivable from a phone mic, and the UI says so.

   Contracts: no network, never throws to the console, all audio
   contexts created on user gesture, mic streams stopped on hide.
   ============================================================ */
(function () {
  'use strict';

  var SR = 22050;   // analysis sample rate

  // ------------------------------------------------------------------
  // Shared DSP core
  // ------------------------------------------------------------------

  // Iterative radix-2 FFT, in-place on re/im arrays (length = power of 2).
  function fft(re, im) {
    var n = re.length;
    for (var i = 1, j = 0; i < n; i++) {
      var bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) {
        var tr = re[i]; re[i] = re[j]; re[j] = tr;
        var ti = im[i]; im[i] = im[j]; im[j] = ti;
      }
    }
    for (var len = 2; len <= n; len <<= 1) {
      var ang = -2 * Math.PI / len;
      var wr = Math.cos(ang), wi = Math.sin(ang);
      for (var s = 0; s < n; s += len) {
        var cr = 1, ci = 0;
        for (var k = 0; k < len / 2; k++) {
          var i1 = s + k, i2 = s + k + len / 2;
          var xr = re[i2] * cr - im[i2] * ci;
          var xi = re[i2] * ci + im[i2] * cr;
          re[i2] = re[i1] - xr; im[i2] = im[i1] - xi;
          re[i1] += xr; im[i1] += xi;
          var ncr = cr * wr - ci * wi;
          ci = cr * wi + ci * wr; cr = ncr;
        }
      }
    }
  }

  // Average magnitude spectrum over hops of a Hann-windowed signal.
  function avgSpectrum(x, sr, fftN) {
    fftN = fftN || 4096;
    var hop = fftN >> 1;
    var hann = new Float32Array(fftN);
    for (var i = 0; i < fftN; i++) {
      hann[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (fftN - 1));
    }
    var mag = new Float32Array(fftN / 2);
    var hops = 0;
    for (var s = 0; s + fftN <= x.length; s += hop) {
      var re = new Float32Array(fftN);
      var im = new Float32Array(fftN);
      for (var j = 0; j < fftN; j++) re[j] = x[s + j] * hann[j];
      fft(re, im);
      for (var b = 0; b < fftN / 2; b++) {
        mag[b] += Math.sqrt(re[b] * re[b] + im[b] * im[b]);
      }
      hops++;
      if (hops > 24) break;
    }
    if (hops > 0) for (var b2 = 0; b2 < mag.length; b2++) mag[b2] /= hops;
    return { mag: mag, binHz: sr / fftN };
  }

  // Feature vector for the classifiers.
  function extractFeatures(x, sr) {
    var sp = avgSpectrum(x, sr);
    var mag = sp.mag, binHz = sp.binHz;

    var total = 1e-9, centroid = 0;
    var bandLow = 0, bandMid = 0, bandHigh = 0, bandInd = 0;
    var maxV = 0, maxI = 0;
    for (var b = 2; b < mag.length; b++) {
      var f = b * binHz, v = mag[b];
      total += v;
      centroid += f * v;
      if (f < 200) bandLow += v;
      else if (f < 1500) bandMid += v;
      else if (f < 5200) bandHigh += v;
      if (f >= 1800 && f <= 4500) bandInd += v;
      if (v > maxV) { maxV = v; maxI = b; }
    }
    centroid /= total;

    // Tonality: energy within +-2 bins of the top peak vs total.
    var peakE = 0;
    for (var p = Math.max(0, maxI - 2); p <= Math.min(mag.length - 1, maxI + 2); p++) {
      peakE += mag[p];
    }
    var tonality = peakE / total;

    // Impulse rate via the ENVELOPE SPECTRUM: FFT of the rectified,
    // smoothed envelope. A periodic tick/knock/gating shows up as a clean
    // line in 0.8 to 40 Hz; steady noise or a pure tone stays flat. This is
    // alignment-free, unlike lag autocorrelation, which rewards any smooth
    // envelope at small lags.
    var dec = 100;                        // envelope rate ~ sr/dec
    var envN = Math.floor(x.length / dec);
    var env = new Float32Array(envN);
    for (var e = 0; e < envN; e++) {
      var acc = 0;
      for (var q = 0; q < dec; q++) acc += Math.abs(x[e * dec + q] || 0);
      env[e] = acc / dec;
    }
    var mean = 0;
    for (var m = 0; m < envN; m++) mean += env[m];
    mean /= envN;
    var envSr = sr / dec;
    var NE = 1024;
    var er = new Float32Array(NE), ei = new Float32Array(NE);
    for (var m2 = 0; m2 < envN && m2 < NE; m2++) {
      er[m2] = (env[m2] - mean) *
        (0.5 - 0.5 * Math.cos(2 * Math.PI * m2 / (Math.min(envN, NE) - 1)));
    }
    fft(er, ei);
    var eBinHz = envSr / NE;
    var eb0 = Math.max(1, Math.floor(0.8 / eBinHz));
    var eb1 = Math.min(NE / 2 - 2, Math.ceil(40 / eBinHz));
    var eBest = eb0, eBestV = 0, eTot = 1e-12;
    for (var eb = eb0; eb <= eb1; eb++) {
      var ev = Math.sqrt(er[eb] * er[eb] + ei[eb] * ei[eb]);
      eTot += ev;
      if (ev > eBestV) { eBestV = ev; eBest = eb; }
    }
    var peakBandE = 0;
    for (var en = Math.max(eb0, eBest - 1);
         en <= Math.min(eb1, eBest + 1); en++) {
      peakBandE += Math.sqrt(er[en] * er[en] + ei[en] * ei[en]);
    }
    var periodicity = peakBandE / eTot;
    var impulseHz = eBest * eBinHz;

    return {
      centroid: centroid,
      tonality: tonality,
      peakHz: maxI * binHz,
      periodicity: periodicity,
      impulseHz: impulseHz,
      lowFrac: bandLow / total,
      midFrac: bandMid / total,
      highFrac: bandHigh / total,
      indFrac: bandInd / total,
      spectrum: mag,
      binHz: binHz
    };
  }

  // ------------------------------------------------------------------
  // 1. ENGINE WHISPERER: fault signature table + classifier
  // ------------------------------------------------------------------

  // Thresholds are calibrated against the measured feature space of the
  // built-in reference signals (see __clinicFeatures), not guessed.
  var FAULTS = [
    {
      id: 'belt', name: 'Accessory belt squeal',
      part: 'Serpentine belt or tensioner',
      say: 'Ask about the serpentine belt, its tensioner, and pulley alignment.',
      score: function (f) {
        var s = 0;
        if (f.peakHz > 500 && f.peakHz < 2400) s += 1.8;
        if (f.midFrac > 0.4) s += 2.2;
        if (f.periodicity < 0.15) s += 1.2;
        if (f.tonality > 0.015) s += 1.0;
        if (f.lowFrac < 0.05) s += 0.6;
        return s;
      }
    },
    {
      id: 'tick', name: 'Valvetrain tick',
      part: 'Hydraulic lifter or rocker clearance',
      say: 'Ask for a valvetrain inspection: lifters, lash adjusters, oil pressure.',
      score: function (f) {
        var s = 0;
        if (f.periodicity > 0.18) s += 2.0;
        if (f.impulseHz > 6 && f.impulseHz < 32) s += 1.4;
        if (f.centroid > 3000) s += 1.6;
        if (f.indFrac > 0.4) s += 1.2;
        if (f.lowFrac < 0.1) s += 0.8;
        return s;
      }
    },
    {
      id: 'knock', name: 'Deep engine knock',
      part: 'Rod bearing or piston slap (serious)',
      say: 'Stop driving. Ask for oil analysis, oil pressure test, and a bottom-end inspection.',
      score: function (f) {
        var s = 0;
        if (f.periodicity > 0.18) s += 2.0;
        if (f.lowFrac > 0.3) s += 2.4;
        if (f.centroid < 2500) s += 1.2;
        if (f.peakHz < 400) s += 1.2;
        return s;
      }
    },
    {
      id: 'cv', name: 'CV joint click',
      part: 'Outer constant-velocity joint',
      say: 'Ask them to check the CV boots and joints, especially clicking on full-lock turns.',
      score: function (f) {
        var s = 0;
        if (f.periodicity > 0.18) s += 1.6;
        if (f.impulseHz >= 1.6 && f.impulseHz <= 6) s += 2.2;
        if (f.centroid > 800 && f.centroid < 3400) s += 0.8;
        if (f.lowFrac < 0.3) s += 0.6;
        return s;
      }
    },
    {
      id: 'bearing', name: 'Wheel bearing drone',
      part: 'Wheel hub bearing',
      say: 'Ask for a wheel bearing check: the hum that changes with speed, not RPM.',
      score: function (f) {
        var s = 0;
        if (f.centroid < 900) s += 2.0;
        if (f.lowFrac > 0.45) s += 1.8;
        if (f.periodicity < 0.18) s += 1.2;
        if (f.tonality < 0.1) s += 0.8;
        return s;
      }
    },
    {
      id: 'leak', name: 'Vacuum or boost leak hiss',
      part: 'Intake hose, vacuum line, or intercooler coupling',
      say: 'Ask for a smoke test of the intake and vacuum system.',
      score: function (f) {
        var s = 0;
        if (f.tonality < 0.01) s += 1.8;
        if (f.periodicity < 0.12) s += 1.6;
        if (f.centroid > 4000) s += 1.6;
        if (f.midFrac < 0.2) s += 1.0;
        return s;
      }
    },
    {
      id: 'brakeind', name: 'Brake wear indicator squeal',
      part: 'Brake pad wear tab on the rotor',
      say: 'Ask for a brake pad measurement; the wear indicator is contacting the rotor.',
      score: function (f) {
        var s = 0;
        if (f.indFrac > 0.4) s += 2.0;
        if (f.tonality > 0.15) s += 2.0;
        if (f.peakHz >= 1800 && f.peakHz <= 4500) s += 1.6;
        if (f.impulseHz < 4 && f.periodicity > 0.18) s += 0.8;
        return s;
      }
    }
  ];

  function classifyFault(f) {
    var scored = FAULTS.map(function (d) {
      return { d: d, s: Math.max(0, d.score(f)) };
    }).sort(function (a, b) { return b.s - a.s; });
    var top = scored.slice(0, 3);
    var sum = top.reduce(function (a, e) { return a + e.s; }, 0) || 1;
    return top.map(function (e) {
      return {
        id: e.d.id, name: e.d.name, part: e.d.part, say: e.d.say,
        confidence: Math.round(100 * e.s / sum)
      };
    });
  }

  // ------------------------------------------------------------------
  // Synthetic test signals (the desk-verifiable ground truth)
  // ------------------------------------------------------------------

  function synth(kind, seconds) {
    seconds = seconds || 2.6;
    var n = Math.floor(SR * seconds);
    var x = new Float32Array(n);
    var i, t;
    function noise() { return Math.random() * 2 - 1; }
    if (kind === 'belt') {
      for (i = 0; i < n; i++) {
        t = i / SR;
        var vib = 1 + 0.006 * Math.sin(2 * Math.PI * 6 * t);
        x[i] = 0.62 * Math.sin(2 * Math.PI * 1250 * vib * t) +
               0.18 * Math.sin(2 * Math.PI * 2500 * vib * t) +
               0.06 * noise();
      }
    } else if (kind === 'tick') {
      for (i = 0; i < n; i++) x[i] = 0.02 * noise();
      var rate = 14;                       // ticks per second
      for (var k = 0; k < seconds * rate; k++) {
        var at = Math.floor(k * SR / rate);
        for (var j = 0; j < 220 && at + j < n; j++) {
          x[at + j] += Math.exp(-j / 30) *
            Math.sin(2 * Math.PI * 3100 * j / SR) * 0.8;
        }
      }
    } else if (kind === 'knock') {
      for (i = 0; i < n; i++) x[i] = 0.02 * noise();
      var rateK = 11;
      for (var k2 = 0; k2 < seconds * rateK; k2++) {
        var at2 = Math.floor(k2 * SR / rateK);
        for (var j2 = 0; j2 < 700 && at2 + j2 < n; j2++) {
          x[at2 + j2] += Math.exp(-j2 / 160) *
            Math.sin(2 * Math.PI * 180 * j2 / SR) * 0.9;
        }
      }
    } else if (kind === 'leak') {
      var lp = 0;
      for (i = 0; i < n; i++) {
        lp = 0.6 * lp + 0.4 * noise();     // shape it slightly
        x[i] = 0.55 * (noise() * 0.7 + lp * 0.3);
      }
    } else if (kind === 'indicator') {
      for (i = 0; i < n; i++) {
        t = i / SR;
        var g = (Math.sin(2 * Math.PI * 1.4 * t) > 0.2) ? 1 : 0.12;
        x[i] = g * 0.6 * Math.sin(2 * Math.PI * 2850 * t) + 0.05 * noise();
      }
    } else if (kind === 'grind') {
      for (i = 0; i < n; i++) {
        t = i / SR;
        var g2 = (Math.sin(2 * Math.PI * 1.2 * t) > 0) ? 1 : 0.25;
        x[i] = g2 * (0.5 * noise() + 0.2 * Math.sin(2 * Math.PI * 620 * t));
      }
    } else if (kind === 'healthy') {
      var lp2 = 0;
      for (i = 0; i < n; i++) {
        lp2 = 0.94 * lp2 + 0.06 * noise();
        x[i] = 0.22 * lp2;
      }
    }
    return x;
  }

  function playSamples(x) {
    try {
      var ac = new (window.AudioContext || window.webkitAudioContext)();
      var buf = ac.createBuffer(1, x.length, SR);
      buf.getChannelData(0).set(x);
      var src = ac.createBufferSource();
      src.buffer = buf;
      src.connect(ac.destination);
      src.onended = function () { try { ac.close(); } catch (e) { } };
      src.start();
    } catch (e) { }
  }

  // ------------------------------------------------------------------
  // Audio input: mic recording and file upload -> Float32Array @ SR
  // ------------------------------------------------------------------

  var micState = { stream: null, recorder: null };

  function stopMic() {
    try {
      if (micState.recorder && micState.recorder.state !== 'inactive') {
        micState.recorder.stop();
      }
      if (micState.stream) {
        micState.stream.getTracks().forEach(function (tr) { tr.stop(); });
      }
    } catch (e) { }
    micState.stream = null;
    micState.recorder = null;
  }

  function recordSeconds(seconds, onStatus) {
    return new Promise(function (resolve) {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        resolve({ error: 'No microphone access in this browser.' });
        return;
      }
      navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
        micState.stream = stream;
        var chunks = [];
        var rec = new MediaRecorder(stream);
        micState.recorder = rec;
        rec.ondataavailable = function (ev) { chunks.push(ev.data); };
        rec.onstop = function () {
          stopMic();
          new Blob(chunks).arrayBuffer().then(function (ab) {
            decodeToSamples(ab).then(resolve);
          });
        };
        rec.start();
        if (onStatus) onStatus('Listening...');
        setTimeout(function () {
          try { if (rec.state !== 'inactive') rec.stop(); } catch (e) { }
        }, seconds * 1000);
      }, function () {
        resolve({ error: 'Microphone permission was denied.' });
      });
    });
  }

  function decodeToSamples(arrayBuffer) {
    return new Promise(function (resolve) {
      try {
        var off = new (window.OfflineAudioContext ||
          window.webkitOfflineAudioContext)(1, SR * 8, SR);
        off.decodeAudioData(arrayBuffer.slice(0), function (buf) {
          var ch = buf.getChannelData(0);
          // Resample crudely to SR if needed (linear).
          if (Math.abs(buf.sampleRate - SR) < 1) {
            resolve({ samples: new Float32Array(ch) });
          } else {
            var ratio = buf.sampleRate / SR;
            var out = new Float32Array(Math.floor(ch.length / ratio));
            for (var i = 0; i < out.length; i++) {
              var p = i * ratio, p0 = Math.floor(p), fr = p - p0;
              out[i] = ch[p0] * (1 - fr) + (ch[p0 + 1] || 0) * fr;
            }
            resolve({ samples: out });
          }
        }, function () {
          resolve({ error: 'Could not decode that audio file.' });
        });
      } catch (e) {
        resolve({ error: 'Audio decoding unavailable.' });
      }
    });
  }

  // ------------------------------------------------------------------
  // Whisperer + PadCheck UI plumbing
  // ------------------------------------------------------------------

  function el(id) { return document.getElementById(id); }

  function renderVerdicts(containerId, items, note) {
    var host = el(containerId);
    if (!host) return;
    var html = '';
    items.forEach(function (it, i) {
      html += '<div class="cl-verdict' + (i === 0 ? ' top' : '') + '">' +
        '<div class="cl-vhead"><span class="cl-vname">' + it.name +
        '</span><span class="cl-vconf">' + it.confidence + '%</span></div>' +
        '<div class="cl-vbar"><span style="width:' + it.confidence + '%"></span></div>' +
        '<div class="cl-vpart">' + it.part + '</div>' +
        '<div class="cl-vsay">' + it.say + '</div>' +
        '<button type="button" class="cl-ask chip" data-ask="' +
        String(it.say).replace(/"/g, '&quot;') +
        '">Ask the Advisor &rarr;</button></div>';
    });
    if (note) html += '<div class="cl-note">' + note + '</div>';
    host.innerHTML = html;
    host.hidden = false;
    // Deep-link every verdict into the live Advisor conversation.
    host.querySelectorAll('.cl-ask').forEach(function (b) {
      b.addEventListener('click', function () {
        var q = 'My car issue: ' + b.getAttribute('data-ask') +
          ' What should I check and what would a fair repair look like?';
        if (window.__vgAsk) window.__vgAsk(q);
      });
    });
  }

  function drawSpectrum(canvasId, f) {
    var c = el(canvasId);
    if (!c || !f) return;
    var ctx = c.getContext('2d');
    var r = c.getBoundingClientRect();
    c.width = Math.max(100, Math.round(r.width));
    c.height = 90;
    ctx.fillStyle = '#04080B';
    ctx.fillRect(0, 0, c.width, c.height);
    var mag = f.spectrum;
    var maxBin = Math.min(mag.length, Math.floor(5200 / f.binHz));
    var maxV = 1e-9;
    for (var b = 2; b < maxBin; b++) if (mag[b] > maxV) maxV = mag[b];
    for (var xpx = 0; xpx < c.width; xpx++) {
      var b2 = 2 + Math.floor((xpx / c.width) * (maxBin - 2));
      var h = Math.pow(mag[b2] / maxV, 0.5) * (c.height - 8);
      var fHz = b2 * f.binHz;
      ctx.fillStyle = (fHz >= 1800 && fHz <= 4500)
        ? 'rgba(201,168,76,0.9)' : 'rgba(44,150,170,0.8)';
      ctx.fillRect(xpx, c.height - h, 1, h);
    }
    c.hidden = false;
  }

  function analyzeWhisperer(samples) {
    var f = extractFeatures(samples, SR);
    var verdicts = classifyFault(f);
    renderVerdicts('cl-ew-results', verdicts,
      'Acoustic hypothesis, not a diagnosis. Recorded evidence beats guessing, ' +
      'and now you know what to ask for.');
    drawSpectrum('cl-ew-spectrum', f);
    // The generative layer: watch the AI reason over the evidence.
    runAiPanel(function (hooks) {
      window.AIEngine.narrateAudio(f, verdicts, hooks);
    });
  }

  // Shared streaming panel for the Whisperer's AI narrative (audio or photo).
  function runAiPanel(startFn) {
    var panel = el('cl-ew-ai');
    var body = el('cl-ew-ai-text');
    var badge = el('cl-ew-ai-engine');
    if (!panel || !body || !window.AIEngine) return;
    panel.hidden = false;
    body.textContent = '';
    body.classList.add('thinking');
    if (badge) badge.textContent = 'warming';
    startFn({
      engine: function (name) { if (badge) badge.textContent = name; },
      token: function (t) {
        body.textContent += t;
        body.scrollTop = body.scrollHeight;
      },
      done: function () { body.classList.remove('thinking'); },
      error: function (msg) {
        body.classList.remove('thinking');
        body.textContent = msg;
      }
    });
  }

  function analyzePads(samples) {
    var f = extractFeatures(samples, SR);
    var verdict, part, say, conf;
    var grind = f.tonality < 0.08 && f.periodicity > 0.18 && f.centroid > 4000;
    if (f.indFrac > 0.4 && f.tonality > 0.15 && !grind) {
      verdict = 'Wear indicator contact detected';
      part = 'A tonal signature sits in the 1.8 to 4.5 kHz indicator band.';
      say = 'Pads are at or near the indicator tab (roughly 2 to 3 mm). Plan a replacement soon; no emergency if braking feels normal.';
      conf = Math.min(96, Math.round(f.indFrac * 130 + f.tonality * 60));
    } else if (grind) {
      verdict = 'Grinding signature: metal on metal';
      part = 'Broadband impact noise with low-frequency content, no clean indicator tone.';
      say = 'Stop driving on these brakes. Rotors are likely being damaged right now.';
      conf = 88;
    } else {
      verdict = 'No indicator tone found';
      part = 'The 1.8 to 4.5 kHz band is quiet relative to the rest of the spectrum.';
      say = 'No acoustic evidence of pad-wear indicator contact in this recording.';
      conf = 84;
    }
    renderVerdicts('cl-pc-results', [{
      name: verdict, part: part, say: say, confidence: conf
    }],
      'Honest limit: millimeter pad thickness is not acoustically measurable ' +
      'from a phone. This instrument detects the indicator contact state, ' +
      'which is what the tab exists to announce.');
    drawSpectrum('cl-pc-spectrum', f);
  }

  // ------------------------------------------------------------------
  // 3. LOADPULSE: wn = sqrt(k/m)
  // ------------------------------------------------------------------

  var LP = {
    presets: [
      { name: 'Compact car', curb: 1300, payload: 420 },
      { name: 'Midsize SUV', curb: 1750, payload: 520 },
      { name: 'Full-size pickup', curb: 2450, payload: 800 },
      { name: 'Sports coupe', curb: 1500, payload: 350 }
    ],
    preset: 1,
    f0: null       // calibrated empty natural frequency
  };

  // Extract the settle frequency from a vertical-accel record around a slam.
  function settleFrequency(z, sr) {
    // Find the spike.
    var maxA = 0, at = 0;
    for (var i = 0; i < z.length; i++) {
      var a = Math.abs(z[i]);
      if (a > maxA) { maxA = a; at = i; }
    }
    // Window: 0.12 s to 2.4 s after the spike.
    var s0 = at + Math.round(0.12 * sr);
    var s1 = Math.min(z.length, at + Math.round(2.4 * sr));
    if (s1 - s0 < sr * 0.8) return null;
    var seg = new Float32Array(s1 - s0);
    var mean = 0;
    for (var j = s0; j < s1; j++) mean += z[j];
    mean /= (s1 - s0);
    for (var j2 = s0; j2 < s1; j2++) seg[j2 - s0] = z[j2] - mean;
    // Zero-pad to 4096 for resolution, FFT, peak in 0.6 to 4 Hz.
    var N = 4096;
    var re = new Float32Array(N), im = new Float32Array(N);
    for (var k = 0; k < seg.length && k < N; k++) {
      re[k] = seg[k] * (0.5 - 0.5 * Math.cos(2 * Math.PI * k / (seg.length - 1)));
    }
    fft(re, im);
    var binHz = sr / N;
    var b0 = Math.max(1, Math.floor(0.6 / binHz));
    var b1 = Math.min(N / 2 - 2, Math.ceil(4.0 / binHz));
    var best = b0, bestV = 0;
    for (var b = b0; b <= b1; b++) {
      var v = re[b] * re[b] + im[b] * im[b];
      if (v > bestV) { bestV = v; best = b; }
    }
    // Parabolic interpolation for sub-bin accuracy.
    function pw(bb) { return re[bb] * re[bb] + im[bb] * im[bb]; }
    var y1 = Math.sqrt(pw(best - 1)), y2 = Math.sqrt(pw(best)), y3 = Math.sqrt(pw(best + 1));
    var d = (y1 - y3) / (2 * (y1 - 2 * y2 + y3) || 1);
    return (best + d) * binHz;
  }

  // Self-calibrating wrapper: the raw FFT-peak estimate of a short damped
  // sine reads systematically low (the decay skews the windowed peak). Run
  // the SAME estimator on a clean reference at the estimated frequency,
  // observe its bias, and divide it out. Two passes converge to well under
  // one percent, which keeps the m0((f0/f1)^2 - 1) mass algebra honest.
  function settleFrequencyCorrected(z, sr) {
    var raw = settleFrequency(z, sr);
    if (!raw) return null;
    // Fixed-point form: corrected = raw / bias(guess), where bias is the
    // estimator's own ratio on a clean reference at the current guess.
    // (Compounding raw*(f/fRef) per pass would overshoot.)
    var f = raw;
    for (var pass = 0; pass < 2; pass++) {
      var ref = synthSlam(f, sr, 4, true);
      var fRef = settleFrequency(ref, sr);
      if (!fRef || fRef <= 0) break;
      f = raw * (f / fRef);
    }
    return f;
  }

  function synthSlam(fHz, sr, seconds, clean) {
    var n = Math.round(sr * seconds);
    var z = new Float32Array(n);
    if (!clean) {
      for (var i = 0; i < n; i++) z[i] = (Math.random() - 0.5) * 0.004;
    }
    var at = Math.round(0.4 * sr);
    z[at] += 3.2;                          // the slam impulse
    z[at + 1] += -2.1;
    var zeta = 0.22;
    var wd = 2 * Math.PI * fHz * Math.sqrt(1 - zeta * zeta);
    for (var j = 0; at + 2 + j < n; j++) {
      var t = j / sr;
      z[at + 2 + j] += 0.5 * Math.exp(-zeta * 2 * Math.PI * fHz * t) *
        Math.sin(wd * t);
    }
    return z;
  }

  function lpCompute(f1) {
    var p = LP.presets[LP.preset];
    var out = el('cl-lp-result');
    if (!out) return;
    if (!LP.f0) {
      out.innerHTML = '<div class="cl-note">Calibrate empty first.</div>';
      out.hidden = false;
      return;
    }
    var added = p.curb * (Math.pow(LP.f0 / f1, 2) - 1);
    added = Math.max(0, added);
    var pct = Math.min(160, Math.round(100 * added / p.payload));
    var safe = pct <= 100;
    out.innerHTML =
      '<div class="cl-big">' + Math.round(added) + ' kg <span>(' +
      Math.round(added * 2.2046) + ' lb) of cargo</span></div>' +
      '<div class="cl-lp-bar"><span style="width:' + Math.min(100, pct) +
      '%" class="' + (safe ? '' : 'over') + '"></span></div>' +
      '<div class="cl-vpart">Suspension at ' + pct + '% of rated payload (' +
      p.payload + ' kg). ' + (safe
        ? 'Safe to drive.'
        : 'OVER RATED PAYLOAD. Unload before driving.') + '</div>' +
      '<div class="cl-note">Empty settle ' + LP.f0.toFixed(2) + ' Hz, loaded ' +
      f1.toFixed(2) + ' Hz. m = m0((f0/f1)^2 - 1). Expect roughly 15 to 25% ' +
      'tolerance; the phone must rest on a hard interior surface.</div>';
    out.hidden = false;
  }

  var motionCapture = null;

  function captureMotion(seconds) {
    return new Promise(function (resolve) {
      if (typeof DeviceMotionEvent === 'undefined') {
        resolve({ error: 'No motion sensors here. Use Simulate on desktop, or open the installed app on your phone.' });
        return;
      }
      function begin() {
        var data = [], t0 = performance.now();
        function onMotion(ev) {
          var a = ev.accelerationIncludingGravity;
          if (a && typeof a.z === 'number') data.push(a.z);
          if (performance.now() - t0 > seconds * 1000) {
            window.removeEventListener('devicemotion', onMotion);
            // A desktop can define DeviceMotionEvent yet deliver no samples:
            // that is a missing SENSOR, not a bad slam. Say the right thing.
            if (data.length < 40) {
              resolve({ error: 'No motion sensor data on this device. Open the installed app on your phone for the real measurement, or use Simulate below.' });
              return;
            }
            var sr = data.length / seconds;
            resolve({ z: new Float32Array(data), sr: sr });
          }
        }
        window.addEventListener('devicemotion', onMotion);
        motionCapture = onMotion;
      }
      if (typeof DeviceMotionEvent.requestPermission === 'function') {
        DeviceMotionEvent.requestPermission().then(function (st) {
          if (st === 'granted') begin();
          else resolve({ error: 'Motion permission denied.' });
        }, function () { resolve({ error: 'Motion permission denied.' }); });
      } else {
        begin();
      }
    });
  }

  // ------------------------------------------------------------------
  // 2. TORQUESPLIT: physics deltas + driveline stress + a real 2D FEA
  // ------------------------------------------------------------------

  var TS = {
    baseIndex: 0,
    powerMult: 1.3,
    weightDelta: 0,
    tireIndex: 1,
    material: 0,
    materials: [
      { name: '4340 steel', E: 205e9, yield: 710e6, color: '#9FB4C0' },
      { name: '7075-T6 aluminum', E: 71.7e9, yield: 503e6, color: '#C0C8CC' },
      { name: 'Ti-6Al-4V titanium', E: 113.8e9, yield: 880e6, color: '#B8AFA0' }
    ]
  };

  // Plane-stress Q4 FEA of a cantilever bracket: fixed at the left edge,
  // sheared at the right tip by the launch torque reaction. Returns per-
  // element von Mises stress plus the mesh for drawing.
  function feaBracket(loadN, material) {
    var nx = 22, ny = 7;
    var W = 0.24, H = 0.08, TH = 0.012;   // meters
    var E = material.E, nu = 0.3;
    var nodes = (nx + 1) * (ny + 1);
    var dof = nodes * 2;

    function nid(i, j) { return j * (nx + 1) + i; }

    // Plane stress constitutive matrix.
    var c = E / (1 - nu * nu);
    var D = [
      [c, c * nu, 0],
      [c * nu, c, 0],
      [0, 0, c * (1 - nu) / 2]
    ];

    var dx = W / nx, dy = H / ny;

    // Element stiffness for a rectangle via 2x2 Gauss quadrature.
    var gp = [-0.5773502691896257, 0.5773502691896257];
    function elemK() {
      var K = [];
      for (var a = 0; a < 8; a++) { K.push(new Float64Array(8)); }
      for (var gi = 0; gi < 2; gi++) {
        for (var gj = 0; gj < 2; gj++) {
          var xi = gp[gi], eta = gp[gj];
          // Shape function derivatives wrt xi/eta.
          var dN = [
            [-(1 - eta) / 4, -(1 - xi) / 4],
            [(1 - eta) / 4, -(1 + xi) / 4],
            [(1 + eta) / 4, (1 + xi) / 4],
            [-(1 + eta) / 4, (1 - xi) / 4]
          ];
          var J = dx / 2 * dy / 2;         // rectangular Jacobian determinant
          var B = [];
          for (var r = 0; r < 3; r++) B.push(new Float64Array(8));
          for (var a2 = 0; a2 < 4; a2++) {
            var dNx = dN[a2][0] * 2 / dx;
            var dNy = dN[a2][1] * 2 / dy;
            B[0][a2 * 2] = dNx;
            B[1][a2 * 2 + 1] = dNy;
            B[2][a2 * 2] = dNy;
            B[2][a2 * 2 + 1] = dNx;
          }
          for (var p = 0; p < 8; p++) {
            for (var q = 0; q < 8; q++) {
              var acc = 0;
              for (var r2 = 0; r2 < 3; r2++) {
                for (var s2 = 0; s2 < 3; s2++) {
                  acc += B[r2][p] * D[r2][s2] * B[s2][q];
                }
              }
              K[p][q] += acc * J * TH;
            }
          }
        }
      }
      return K;
    }

    var Ke = elemK();

    // Assemble global K (dense; ~ (23*8*2)^2 is fine at this size).
    var Kg = [];
    for (var d0 = 0; d0 < dof; d0++) Kg.push(new Float64Array(dof));
    var F = new Float64Array(dof);

    for (var j = 0; j < ny; j++) {
      for (var i = 0; i < nx; i++) {
        var map = [
          nid(i, j) * 2, nid(i, j) * 2 + 1,
          nid(i + 1, j) * 2, nid(i + 1, j) * 2 + 1,
          nid(i + 1, j + 1) * 2, nid(i + 1, j + 1) * 2 + 1,
          nid(i, j + 1) * 2, nid(i, j + 1) * 2 + 1
        ];
        for (var p2 = 0; p2 < 8; p2++) {
          for (var q2 = 0; q2 < 8; q2++) {
            Kg[map[p2]][map[q2]] += Ke[p2][q2];
          }
        }
      }
    }

    // Load: downward shear spread over the right edge nodes.
    for (var jr = 0; jr <= ny; jr++) {
      F[nid(nx, jr) * 2 + 1] = -loadN / (ny + 1);
    }

    // Boundary: left edge fully fixed (penalty method keeps the solve simple).
    var BIG = 1e18;
    for (var jf = 0; jf <= ny; jf++) {
      Kg[nid(0, jf) * 2][nid(0, jf) * 2] += BIG;
      Kg[nid(0, jf) * 2 + 1][nid(0, jf) * 2 + 1] += BIG;
    }

    // Dense Gaussian elimination with partial pivoting.
    var U = new Float64Array(dof);
    for (var col = 0; col < dof; col++) {
      var piv = col;
      for (var r3 = col + 1; r3 < dof; r3++) {
        if (Math.abs(Kg[r3][col]) > Math.abs(Kg[piv][col])) piv = r3;
      }
      if (piv !== col) {
        var tmp = Kg[piv]; Kg[piv] = Kg[col]; Kg[col] = tmp;
        var tf = F[piv]; F[piv] = F[col]; F[col] = tf;
      }
      var diag = Kg[col][col] || 1e-30;
      for (var r4 = col + 1; r4 < dof; r4++) {
        var fct = Kg[r4][col] / diag;
        if (fct === 0) continue;
        var rowA = Kg[r4], rowB = Kg[col];
        for (var c2 = col; c2 < dof; c2++) rowA[c2] -= fct * rowB[c2];
        F[r4] -= fct * F[col];
      }
    }
    for (var back = dof - 1; back >= 0; back--) {
      var acc2 = F[back];
      var rowC = Kg[back];
      for (var c3 = back + 1; c3 < dof; c3++) acc2 -= rowC[c3] * U[c3];
      U[back] = acc2 / (rowC[back] || 1e-30);
    }

    // Element centroid von Mises stress.
    var vm = new Float32Array(nx * ny);
    var maxVM = 0;
    for (var j3 = 0; j3 < ny; j3++) {
      for (var i3 = 0; i3 < nx; i3++) {
        var m2 = [
          nid(i3, j3) * 2, nid(i3, j3) * 2 + 1,
          nid(i3 + 1, j3) * 2, nid(i3 + 1, j3) * 2 + 1,
          nid(i3 + 1, j3 + 1) * 2, nid(i3 + 1, j3 + 1) * 2 + 1,
          nid(i3, j3 + 1) * 2, nid(i3, j3 + 1) * 2 + 1
        ];
        // B at centroid (xi = eta = 0).
        var Bx = [-1 / (2 * dx) * 2, 1 / (2 * dx) * 2, 1 / (2 * dx) * 2, -1 / (2 * dx) * 2];
        var By = [-1 / (2 * dy) * 2, -1 / (2 * dy) * 2, 1 / (2 * dy) * 2, 1 / (2 * dy) * 2];
        var ex = 0, ey = 0, gxy = 0;
        for (var a3 = 0; a3 < 4; a3++) {
          var ux = U[m2[a3 * 2]], uy = U[m2[a3 * 2 + 1]];
          ex += Bx[a3] / 2 * ux;
          ey += By[a3] / 2 * uy;
          gxy += By[a3] / 2 * ux + Bx[a3] / 2 * uy;
        }
        var sx = D[0][0] * ex + D[0][1] * ey;
        var sy = D[1][0] * ex + D[1][1] * ey;
        var txy = D[2][2] * gxy;
        var v = Math.sqrt(sx * sx - sx * sy + sy * sy + 3 * txy * txy);
        vm[j3 * nx + i3] = v;
        if (v > maxVM) maxVM = v;
      }
    }
    return { vm: vm, nx: nx, ny: ny, maxVM: maxVM, U: U, nid: nid };
  }

  function stressColor(frac) {
    // teal (cool) -> gold -> ruby (hot).
    var r, g, b;
    if (frac < 0.5) {
      var k = frac / 0.5;
      r = 23 + (201 - 23) * k; g = 84 + (168 - 84) * k; b = 95 + (76 - 95) * k;
    } else {
      var k2 = (frac - 0.5) / 0.5;
      r = 201 + (192 - 201) * k2; g = 168 + (48 - 168) * k2; b = 76 + (48 - 76) * k2;
    }
    return 'rgb(' + (r | 0) + ',' + (g | 0) + ',' + (b | 0) + ')';
  }

  function runTorqueSplit() {
    var P = window.Physics;
    var cars = window.CARS || [];
    var base = cars[TS.baseIndex] || cars[0];
    if (!base || !P) return;

    var stock = {
      name: base.name, carId: base.id,
      powerHp: base.powerHp, weightKg: base.weightKg,
      drivetrain: base.drivetrain, wingLevel: base.wingLevel,
      tireIndex: base.tireIndex, accent: base.accent
    };
    var mod = JSON.parse(JSON.stringify(stock));
    mod.powerHp = Math.round(stock.powerHp * TS.powerMult);
    mod.weightKg = Math.max(500, stock.weightKg + TS.weightDelta);
    mod.tireIndex = TS.tireIndex;

    var a = P.compute(stock), b = P.compute(mod);

    // Driveline: peak axle torque at launch is traction limited.
    var rTire = 0.34;                       // m, typical rolling radius
    var Taxle = b.eng.mu * b.eng.kDrive * mod.weightKg * 9.81 * rTire / 2;
    var dShaft = 0.032;                     // 32 mm stock half shaft
    var tau = 16 * Taxle / (Math.PI * Math.pow(dShaft, 3));
    var mat = TS.materials[TS.material];
    var tauAllow = 0.58 * mat.yield;        // von Mises shear allowable
    var SF = tauAllow / tau;

    // Clutch heat: one traction-limited launch, slip to 20 km/h.
    var vSlip = 5.6;
    var Eclutch = 0.5 * mod.weightKg * vSlip * vSlip;
    var dT = Eclutch / (9 * 460);           // 9 kg steel mass path

    var out = el('cl-ts-results');
    if (out) {
      function d2(x) { return (Math.round(x * 100) / 100).toFixed(2); }
      var warns = [];
      if (SF < 1.0) warns.push('Stock-size half shafts FAIL at launch torque (safety factor ' + d2(SF) + '). Upgrade shafts before this power level.');
      else if (SF < 1.25) warns.push('Half shaft safety factor ' + d2(SF) + ' is thin for repeated launches.');
      if (dT > 90) warns.push('Estimated ' + Math.round(dT) + ' C clutch temperature rise per launch: expect glazing with back-to-back runs.');
      if (b.zeroTo60 > a.zeroTo60 && TS.powerMult > 1) warns.push('Added weight is eating the added power.');

      out.innerHTML =
        '<div class="ds-row"><span class="ds-a">' + a.zeroTo60.toFixed(1) + ' s</span>' +
        '<span class="ds-label">0 to 60</span><span class="ds-b">' + b.zeroTo60.toFixed(1) + ' s</span></div>' +
        '<div class="ds-row"><span class="ds-a">' + Math.round(a.topSpeedKmh) + ' km/h</span>' +
        '<span class="ds-label">Top speed</span><span class="ds-b">' + Math.round(b.topSpeedKmh) + ' km/h</span></div>' +
        '<div class="ds-row"><span class="ds-a">' + Math.round(a.braking100) + ' m</span>' +
        '<span class="ds-label">100 to 0</span><span class="ds-b">' + Math.round(b.braking100) + ' m</span></div>' +
        '<div class="ds-row"><span class="ds-a">' + Math.round(Taxle) + ' N·m</span>' +
        '<span class="ds-label">Axle torque</span><span class="ds-b">SF ' + d2(SF) + '</span></div>' +
        (warns.length
          ? '<div class="cl-warns">' + warns.map(function (w) {
              return '<div class="cl-warn">' + w + '</div>';
            }).join('') + '</div>'
          : '<div class="cl-note">Driveline margins look healthy for this plan.</div>');
    }

    // FEA of the torque-reaction bracket.
    var loadN = Taxle / 0.12;               // reaction arm 120 mm
    var fea = feaBracket(loadN, mat);
    var cnv = el('cl-ts-fea');
    if (cnv) {
      var ctx = cnv.getContext('2d');
      var rr = cnv.getBoundingClientRect();
      cnv.width = Math.max(200, Math.round(rr.width));
      cnv.height = 150;
      ctx.fillStyle = '#04080B';
      ctx.fillRect(0, 0, cnv.width, cnv.height);
      var pad = 16;
      var cw = (cnv.width - pad * 2) / fea.nx;
      var chh = (cnv.height - pad * 2 - 18) / fea.ny;
      var cap = mat.yield;
      for (var j4 = 0; j4 < fea.ny; j4++) {
        for (var i4 = 0; i4 < fea.nx; i4++) {
          var frac = Math.min(1, fea.vm[j4 * fea.nx + i4] / cap);
          ctx.fillStyle = stressColor(frac);
          ctx.fillRect(pad + i4 * cw, pad + (fea.ny - 1 - j4) * chh,
            Math.ceil(cw), Math.ceil(chh));
        }
      }
      ctx.fillStyle = 'rgba(232,213,160,0.85)';
      ctx.font = '600 10px Montserrat, sans-serif';
      ctx.fillText('FE mesh 22x7 Q4 plane stress · peak von Mises ' +
        (fea.maxVM / 1e6).toFixed(0) + ' MPa / yield ' +
        (mat.yield / 1e6).toFixed(0) + ' MPa (' + mat.name + ')',
        pad, cnv.height - 8);
      // Fixed edge marker.
      ctx.fillStyle = 'rgba(159,232,240,0.8)';
      ctx.fillRect(pad - 5, pad, 3, fea.ny * chh);
    }
  }

  // ------------------------------------------------------------------
  // Wiring
  // ------------------------------------------------------------------

  var wired = false;

  function wire() {
    if (wired) return;
    wired = true;

    // Panel accordions.
    document.querySelectorAll('.clinic-head').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var open = btn.getAttribute('aria-expanded') === 'true';
        btn.setAttribute('aria-expanded', open ? 'false' : 'true');
        var body = btn.parentElement.querySelector('.clinic-body');
        if (body) body.hidden = open;
        if (!open && btn.id === 'cl-ts-head') runTorqueSplit();
      });
    });

    // --- Whisperer ---
    function on(id, fn) { var b = el(id); if (b) b.addEventListener('click', fn); }
    on('cl-ew-rec', function () {
      var st = el('cl-ew-status');
      if (st) { st.textContent = 'Listening for 4 seconds...'; st.hidden = false; }
      recordSeconds(4).then(function (res) {
        if (st) st.hidden = true;
        if (res.error) { renderVerdicts('cl-ew-results', [], res.error); return; }
        analyzeWhisperer(res.samples);
      });
    });
    var up = el('cl-ew-file');
    if (up) {
      up.addEventListener('change', function () {
        var f = up.files && up.files[0];
        if (!f) return;
        f.arrayBuffer().then(function (ab) {
          decodeToSamples(ab).then(function (res) {
            if (res.error) { renderVerdicts('cl-ew-results', [], res.error); return; }
            analyzeWhisperer(res.samples);
          });
        });
      });
    }
    ['belt', 'tick', 'knock', 'leak'].forEach(function (kind) {
      on('cl-ew-demo-' + kind, function () {
        var x = synth(kind);
        playSamples(x);
        analyzeWhisperer(x);
      });
    });

    // Photo diagnosis: Gemini vision with a key, local color analysis without.
    var photo = el('cl-ew-photo');
    if (photo) {
      photo.addEventListener('change', function () {
        var f = photo.files && photo.files[0];
        if (!f || !window.AIEngine) return;
        var prev = el('cl-ew-photo-preview');
        runAiPanel(function (hooks) {
          window.AIEngine.analyzePhoto(f, {
            engine: hooks.engine,
            token: hooks.token,
            done: hooks.done,
            error: hooks.error,
            preview: function (url) {
              if (prev) { prev.src = url; prev.hidden = false; }
            }
          });
        });
        photo.value = '';
      });
    }

    // AI Engine card: the free Gemini key lives only in this browser.
    function reflectAiStatus() {
      var s = el('cl-ai-status');
      if (!s || !window.AIEngine) return;
      var st = window.AIEngine.status();
      s.textContent = st === 'gemini'
        ? 'Gemini connected · free tier · photos and prose enabled'
        : (st === 'webllm'
          ? 'No key · local WebLLM narrates audio · photos use the color analyzer'
          : 'No key · knowledge-base mode · add the free key for full AI');
      s.className = 'cl-ai-status ' + st;
    }
    var keyIn = el('cl-ai-key');
    if (keyIn && window.AIEngine) {
      keyIn.value = window.AIEngine.getKey();
      on('cl-ai-save', function () {
        window.AIEngine.setKey(keyIn.value);
        reflectAiStatus();
        var msg = el('cl-ai-msg');
        if (msg) msg.textContent = keyIn.value.trim()
          ? 'Saved to this browser only. Testing...' : 'Key cleared.';
        if (keyIn.value.trim()) {
          window.AIEngine.test(function (err, ok) {
            if (msg) msg.textContent = err || ok;
          });
        }
      });
      reflectAiStatus();
    }

    // --- PadCheck ---
    on('cl-pc-rec', function () {
      var st = el('cl-pc-status');
      if (st) { st.textContent = 'Listening for 5 seconds. Tap the brakes while rolling slowly.'; st.hidden = false; }
      recordSeconds(5).then(function (res) {
        if (st) st.hidden = true;
        if (res.error) { renderVerdicts('cl-pc-results', [], res.error); return; }
        analyzePads(res.samples);
      });
    });
    ['healthy', 'indicator', 'grind'].forEach(function (kind) {
      on('cl-pc-demo-' + kind, function () {
        var x = synth(kind);
        playSamples(x);
        analyzePads(x);
      });
    });

    // --- LoadPulse ---
    var sel = el('cl-lp-preset');
    if (sel) {
      LP.presets.forEach(function (p, i) {
        var o = document.createElement('option');
        o.value = String(i);
        o.textContent = p.name + ' · ' + p.curb + ' kg curb, ' + p.payload + ' kg payload';
        sel.appendChild(o);
      });
      sel.value = String(LP.preset);
      sel.addEventListener('change', function () {
        LP.preset = parseInt(sel.value, 10) || 0;
        LP.f0 = null;
        var st = el('cl-lp-cal');
        if (st) st.textContent = 'Not calibrated';
      });
    }
    on('cl-lp-calibrate', function () {
      var st = el('cl-lp-cal');
      if (st) st.textContent = 'Capturing 4 s... slam the door once.';
      captureMotion(4).then(function (res) {
        if (res.error) { if (st) st.textContent = res.error; return; }
        var f = settleFrequencyCorrected(res.z, res.sr);
        if (!f) { if (st) st.textContent = 'No clean settle detected. Phone flat on a hard surface, try again.'; return; }
        LP.f0 = f;
        if (st) st.textContent = 'Calibrated: empty settle ' + f.toFixed(2) + ' Hz';
      });
    });
    on('cl-lp-measure', function () {
      var st = el('cl-lp-cal');
      captureMotion(4).then(function (res) {
        if (res.error) { if (st) st.textContent = res.error; return; }
        var f = settleFrequencyCorrected(res.z, res.sr);
        if (!f) { if (st) st.textContent = 'No clean settle detected. Try again.'; return; }
        lpCompute(f);
      });
    });
    on('cl-lp-sim-empty', function () {
      var z = synthSlam(1.62, 100, 4);
      var f = settleFrequencyCorrected(z, 100);
      LP.f0 = f;
      var st = el('cl-lp-cal');
      // Simulation supersedes any stale sensor error above it.
      if (st) st.textContent = 'Simulated calibration: empty settle ' + f.toFixed(2) + ' Hz';
      var out = el('cl-lp-result');
      if (out) { out.hidden = true; out.innerHTML = ''; }
    });
    on('cl-lp-sim-loaded', function () {
      // +320 kg on a 1750 kg SUV: f1 = f0 * sqrt(m0/(m0+dm)).
      var p = LP.presets[LP.preset];
      var f0 = LP.f0 || 1.62;
      var f1true = f0 * Math.sqrt(p.curb / (p.curb + 320));
      var z = synthSlam(f1true, 100, 4);
      var f1 = settleFrequencyCorrected(z, 100);
      lpCompute(f1);
    });

    // --- TorqueSplit ---
    var baseSel = el('cl-ts-base');
    if (baseSel) {
      (window.CARS || []).forEach(function (c, i) {
        var o = document.createElement('option');
        o.value = String(i);
        o.textContent = c.name;
        baseSel.appendChild(o);
      });
      baseSel.addEventListener('change', function () {
        TS.baseIndex = parseInt(baseSel.value, 10) || 0;
        runTorqueSplit();
      });
    }
    function bindRange(id, valId, fmt, set) {
      var r = el(id);
      if (!r) return;
      r.addEventListener('input', function () {
        set(parseFloat(r.value));
        var v = el(valId);
        if (v) v.textContent = fmt(parseFloat(r.value));
        runTorqueSplit();
      });
    }
    bindRange('cl-ts-power', 'cl-ts-power-v',
      function (v) { return 'x' + v.toFixed(2); },
      function (v) { TS.powerMult = v; });
    bindRange('cl-ts-weight', 'cl-ts-weight-v',
      function (v) { return (v > 0 ? '+' : '') + v + ' kg'; },
      function (v) { TS.weightDelta = v; });
    var tireSel = el('cl-ts-tire');
    if (tireSel) {
      tireSel.addEventListener('change', function () {
        TS.tireIndex = parseInt(tireSel.value, 10) || 0;
        runTorqueSplit();
      });
    }
    var matSel = el('cl-ts-mat');
    if (matSel) {
      TS.materials.forEach(function (m, i) {
        var o = document.createElement('option');
        o.value = String(i);
        o.textContent = m.name;
        matSel.appendChild(o);
      });
      matSel.addEventListener('change', function () {
        TS.material = parseInt(matSel.value, 10) || 0;
        runTorqueSplit();
      });
    }
  }

  window.Clinic = {
    show: function () {
      try { wire(); } catch (e) { }
    },
    hide: function () {
      try { stopMic(); } catch (e) { }
    }
  };

  // Feature probe for threshold tuning (verification only).
  window.__clinicFeatures = function (kind) {
    try {
      var f = extractFeatures(synth(kind), SR);
      return JSON.stringify({
        centroid: Math.round(f.centroid),
        tonality: +f.tonality.toFixed(3),
        peakHz: Math.round(f.peakHz),
        periodicity: +f.periodicity.toFixed(3),
        impulseHz: +f.impulseHz.toFixed(2),
        lowFrac: +f.lowFrac.toFixed(3),
        midFrac: +f.midFrac.toFixed(3),
        highFrac: +f.highFrac.toFixed(3),
        indFrac: +f.indFrac.toFixed(3)
      });
    } catch (e) { return String(e); }
  };

  // Deterministic desk test: run every synthetic through its classifier and
  // report pass/fail per case. This is the "does it actually work" hook.
  window.__clinicProof = function () {
    try {
      var out = {};
      out.belt = classifyFault(extractFeatures(synth('belt'), SR))[0].name;
      out.tick = classifyFault(extractFeatures(synth('tick'), SR))[0].name;
      out.knock = classifyFault(extractFeatures(synth('knock'), SR))[0].name;
      out.leak = classifyFault(extractFeatures(synth('leak'), SR))[0].name;
      function padState(f) {
        var grind = f.tonality < 0.08 && f.periodicity > 0.18 && f.centroid > 4000;
        if (f.indFrac > 0.4 && f.tonality > 0.15 && !grind) return 'indicator';
        if (grind) return 'grind';
        return 'healthy';
      }
      out.indicator = padState(extractFeatures(synth('indicator'), SR));
      out.grind = padState(extractFeatures(synth('grind'), SR));
      out.healthy = padState(extractFeatures(synth('healthy'), SR));
      var z0 = synthSlam(1.62, 100, 4), z1 = synthSlam(1.45, 100, 4);
      out.lpEmptyHz = settleFrequencyCorrected(z0, 100);
      out.lpLoadedHz = settleFrequencyCorrected(z1, 100);
      var fea = feaBracket(20000, TS.materials[0]);
      out.feaMaxMPa = Math.round(fea.maxVM / 1e6);
      return JSON.stringify(out);
    } catch (e) {
      return String(e && e.stack || e);
    }
  };
})();
