/* ============================================================
   VALENCE GARAGE. AI engine router. js/aiengine.js (v13)

   One small brain-router for the Clinic:

     narrateAudio(features, ranked, hooks)   audio diagnosis prose
     analyzePhoto(file, hooks)               photo diagnosis
     setKey / getKey / clearKey / status     Gemini key management
     test(cb)                                one-shot key sanity check

   Engine order:
     1. Gemini (free-tier key pasted by the owner, stored ONLY in
        this browser's localStorage) with token streaming, so the
        user watches the model think.
     2. The Advisor's local WebLLM (window.Advisor.generate), also
        streamed, fully offline.
     3. The knowledge base itself composes a deterministic writeup
        (never a dead end, still expert, just not generative).

   Photos: Gemini has eyes; without a key the local color/pattern
   analyzer (VGKnowledge.localPhotoAnalysis) reads the image and
   the text engines write around its findings.

   Never throws; every path ends in hooks.done or hooks.error.
   ============================================================ */
(function () {
  'use strict';

  var KEY_STORE = 'vg-gemini-key';
  // 'gemini-flash-latest' tracks Google's current free-tier flash model.
  // Pinned model names (2.0-flash, 2.5-flash) are closed to new keys.
  var MODEL = 'gemini-flash-latest';
  var BASE = 'https://generativelanguage.googleapis.com/v1beta/models/';

  function getKey() {
    try { return localStorage.getItem(KEY_STORE) || ''; } catch (e) { return ''; }
  }
  function setKey(k) {
    try {
      if (k) localStorage.setItem(KEY_STORE, k.trim());
      else localStorage.removeItem(KEY_STORE);
    } catch (e) { }
  }

  function status() {
    if (getKey()) return 'gemini';
    if (window.Advisor && typeof window.Advisor.generate === 'function' &&
        window.Advisor.aiOnline && window.Advisor.aiOnline()) {
      return 'webllm';
    }
    return 'local';
  }

  // ---- Gemini streaming ------------------------------------------------------

  function geminiStream(parts, onToken) {
    var key = getKey();
    return fetch(BASE + MODEL + ':streamGenerateContent?alt=sse&key=' +
      encodeURIComponent(key), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: parts }],
        // Flash-latest is a thinking model: zero the thinking budget so
        // tokens go to the answer, and give the answer real room.
        generationConfig: {
          temperature: 0.6,
          maxOutputTokens: 900,
          thinkingConfig: { thinkingBudget: 0 }
        }
      })
    }).then(function (res) {
      if (!res.ok) {
        return res.text().then(function (t) {
          throw new Error('Gemini ' + res.status + ': ' + t.slice(0, 140));
        });
      }
      var reader = res.body.getReader();
      var dec = new TextDecoder();
      var buf = '';
      var full = '';
      function pump() {
        return reader.read().then(function (step) {
          if (step.done) return full;
          buf += dec.decode(step.value, { stream: true });
          var lines = buf.split('\n');
          buf = lines.pop();
          lines.forEach(function (line) {
            line = line.trim();
            if (line.indexOf('data:') !== 0) return;
            var payload = line.slice(5).trim();
            if (!payload || payload === '[DONE]') return;
            try {
              var j = JSON.parse(payload);
              var txt = j.candidates && j.candidates[0] &&
                j.candidates[0].content && j.candidates[0].content.parts &&
                j.candidates[0].content.parts[0] &&
                j.candidates[0].content.parts[0].text;
              if (txt) { full += txt; if (onToken) onToken(txt); }
            } catch (e) { /* partial frame, ignore */ }
          });
          return pump();
        });
      }
      return pump();
    });
  }

  // ---- deterministic knowledge writeup (the never-fails floor) ---------------

  function composeLocalAudio(f, ranked) {
    var K = window.VGKnowledge;
    var top = ranked[0];
    var lib = (K.FAULT_LIBRARY || []).filter(function (d) {
      return d.id === top.id;
    })[0];
    var out = 'Likeliest match: ' + top.name + ' (' + top.confidence +
      '% of classifier weight). ' + (lib ? lib.sound : '') + '\n\n';
    if (lib) {
      out += 'Typical causes: ' + lib.causes.join('; ') + '.\n\n' +
        'Urgency: ' + lib.urgency + '\n\n' +
        'At the counter: ' + lib.fairShop + '\n\n' +
        'Costs nothing to check first: ' + lib.diy.join(' ') + '\n\n' +
        'To be sure, answer these: ' + lib.followUps.join(' ');
    }
    if (ranked.length > 1) {
      out += '\n\nAlso plausible: ' + ranked.slice(1).map(function (r) {
        return r.name + ' (' + r.confidence + '%)';
      }).join(', ') + '.';
    }
    return out;
  }

  function composeLocalPhoto(findings) {
    if (!findings || !findings.length) {
      return 'The local analyzer found no strong fluid-color or wear ' +
        'signature in this photo. For a real read of arbitrary photos, add ' +
        'a free Gemini key in the AI Engine card above; the local analyzer ' +
        'only recognizes fluid colors, oil films, and rust tones.';
    }
    var out = 'Local analysis (no cloud, no key): the photo shows ' +
      findings.join('; also, ') + '.';
    out += '\n\nFor a full visual diagnosis in plain language, add the free ' +
      'Gemini key; this fallback reads colors and patterns, not context.';
    return out;
  }

  // ---- public: audio narration -------------------------------------------------

  function narrateAudio(f, ranked, hooks) {
    hooks = hooks || {};
    var prompt = window.VGKnowledge.buildAudioPrompt(f, ranked);

    if (getKey()) {
      if (hooks.engine) hooks.engine('Gemini · free tier');
      geminiStream([{ text: prompt }], hooks.token).then(function (full) {
        if (hooks.done) hooks.done(full, 'gemini');
      }, function (err) {
        // Key present but call failed: drop to local chain, tell the user.
        if (hooks.engine) hooks.engine('Gemini failed (' + err.message +
          '), using local engine');
        narrateLocal(f, ranked, hooks);
      });
      return;
    }
    narrateLocal(f, ranked, hooks);
  }

  function narrateLocal(f, ranked, hooks) {
    var prompt = window.VGKnowledge.buildAudioPrompt(f, ranked);
    var adv = window.Advisor;
    var settled = false;   // once deterministic fires, late LLM tokens drop

    function deterministic() {
      if (settled) return;
      settled = true;
      if (hooks.engine) hooks.engine('Knowledge base · deterministic');
      var text = composeLocalAudio(f, ranked);
      if (hooks.token) hooks.token(text);
      if (hooks.done) hooks.done(text, 'knowledge');
    }

    if (adv && typeof adv.generate === 'function' &&
        adv.aiOnline && adv.aiOnline()) {
      if (hooks.engine) hooks.engine('Local WebLLM · on-device');
      // The local engine serializes requests: if the Advisor is mid-answer
      // (or a hidden tab throttles the GPU), first token may never come.
      // Twelve quiet seconds means fall to the deterministic writeup.
      var gotToken = false;
      var watchdog = setTimeout(function () {
        if (!gotToken) deterministic();
      }, 12000);
      adv.generate(prompt, function (t) {
        gotToken = true;
        if (!settled && hooks.token) hooks.token(t);
      }).then(function (full) {
        clearTimeout(watchdog);
        if (settled) return;
        if (full && full.trim()) {
          settled = true;
          if (hooks.done) hooks.done(full, 'webllm');
        } else {
          deterministic();
        }
      }, function () {
        clearTimeout(watchdog);
        deterministic();
      });
      return;
    }
    deterministic();
  }

  // ---- public: photo analysis ----------------------------------------------------

  function fileToJpegBase64(file, maxSide) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () {
        try {
          var scale = Math.min(1, (maxSide || 1024) / Math.max(img.width, img.height));
          var c = document.createElement('canvas');
          c.width = Math.round(img.width * scale);
          c.height = Math.round(img.height * scale);
          var ctx = c.getContext('2d');
          ctx.drawImage(img, 0, 0, c.width, c.height);
          var dataUrl = c.toDataURL('image/jpeg', 0.85);
          URL.revokeObjectURL(url);
          resolve({
            b64: dataUrl.split(',')[1],
            imageData: ctx.getImageData(0, 0, c.width, c.height),
            previewUrl: dataUrl
          });
        } catch (e) { reject(e); }
      };
      img.onerror = function () { reject(new Error('unreadable image')); };
      img.src = url;
    });
  }

  function analyzePhoto(file, hooks) {
    hooks = hooks || {};
    fileToJpegBase64(file, 1024).then(function (pack) {
      if (hooks.preview) hooks.preview(pack.previewUrl);
      var findings = [];
      try {
        findings = window.VGKnowledge.localPhotoAnalysis(pack.imageData);
      } catch (e) { }

      if (getKey()) {
        if (hooks.engine) hooks.engine('Gemini vision · free tier');
        var prompt = window.VGKnowledge.buildPhotoPrompt(findings);
        geminiStream([
          { text: prompt },
          { inline_data: { mime_type: 'image/jpeg', data: pack.b64 } }
        ], hooks.token).then(function (full) {
          if (hooks.done) hooks.done(full, 'gemini');
        }, function (err) {
          if (hooks.engine) hooks.engine('Gemini failed (' + err.message +
            '), local analyzer only');
          localOut(findings);
        });
        return;
      }
      localOut(findings);

      function localOut(fnd) {
        if (hooks.engine) hooks.engine('Local color analyzer · no key');
        var text = composeLocalPhoto(fnd);
        if (hooks.token) hooks.token(text);
        if (hooks.done) hooks.done(text, 'local');
      }
    }, function (err) {
      if (hooks.error) hooks.error('Could not read that image: ' + err.message);
    });
  }

  // ---- key sanity test --------------------------------------------------------------

  function test(cb) {
    if (!getKey()) { cb('No key saved.'); return; }
    fetch(BASE + MODEL + ':generateContent?key=' + encodeURIComponent(getKey()), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: 'Reply with exactly: VALENCE OK' }] }],
        generationConfig: {
          maxOutputTokens: 30,
          thinkingConfig: { thinkingBudget: 0 }
        }
      })
    }).then(function (r) {
      if (r.ok) cb(null, 'Key verified: Gemini responding.');
      else if (r.status === 400 || r.status === 403) cb('Key rejected (' + r.status + '). Re-copy it from aistudio.google.com/apikey.');
      else cb('Gemini returned ' + r.status + '. Try again shortly.');
    }, function () {
      cb('Network error reaching Gemini.');
    });
  }

  window.AIEngine = {
    getKey: getKey,
    setKey: setKey,
    status: status,
    narrateAudio: function (f, r, h) { try { narrateAudio(f, r, h); } catch (e) { if (h && h.error) h.error(String(e)); } },
    analyzePhoto: function (file, h) { try { analyzePhoto(file, h); } catch (e) { if (h && h.error) h.error(String(e)); } },
    test: function (cb) { try { test(cb); } catch (e) { cb(String(e)); } }
  };
})();
