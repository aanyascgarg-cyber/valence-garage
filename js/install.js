/* ============================================================
   VALENCE GARAGE. Install affordance. js/install.js

   Puts the install step inside the app instead of leaving people to
   discover a browser menu.

   Three cases, because the platforms genuinely differ:

     Chrome / Edge / Android
       fire beforeinstallprompt. Capture it, show the button, and call
       prompt() on the tap. This is a real one tap install.

     iOS Safari
       has no such event and never will. The only route is Share then
       Add to Home Screen, so the button turns into that instruction
       rather than pretending it can do it for you.

     Already installed
       display-mode: standalone. Say nothing at all.

   Never throws.
   ============================================================ */
(function () {
  'use strict';

  var deferred = null;

  function byId(id) { return document.getElementById(id); }

  function isStandalone() {
    try {
      if (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) return true;
      // iOS Safari reports it here instead.
      if (window.navigator && window.navigator.standalone) return true;
    } catch (e) { }
    return false;
  }

  function isIOS() {
    try {
      var ua = window.navigator.userAgent || '';
      var iDevice = /iPad|iPhone|iPod/.test(ua);
      // iPadOS 13+ reports as a Mac, so check for touch as well.
      var iPadDesktop = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
      return iDevice || iPadDesktop;
    } catch (e) { return false; }
  }

  function show(copy, label) {
    var card = byId('dash-install');
    var text = byId('install-copy');
    var btn = byId('btn-install');
    if (!card || !btn) return;
    if (copy && text) text.textContent = copy;
    if (label) btn.textContent = label;
    card.hidden = false;
  }

  function hide() {
    var card = byId('dash-install');
    if (card) card.hidden = true;
  }

  // Safari on iOS has no install API of any kind, so this is a guide, not a
  // trigger. It names the exact control and points at where it lives, and it
  // calls out the one thing people miss: Chrome and Firefox on iPhone cannot
  // install at all, only Safari can.
  function showIosGuide() {
    if (byId('ios-install')) return;
    var inSafari = /Safari/.test(navigator.userAgent) &&
      !/CriOS|FxiOS|EdgiOS|OPiOS/.test(navigator.userAgent);

    var wrap = document.createElement('div');
    wrap.id = 'ios-install';
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-label', 'How to install');

    var card = document.createElement('div');
    card.className = 'ios-card';

    var h = document.createElement('h3');
    h.textContent = inSafari ? 'Add Valence to your home screen' : 'Open this in Safari first';

    var steps = document.createElement('ol');
    steps.className = 'ios-steps';
    var items = inSafari
      ? ['Tap the Share button at the bottom of Safari.',
         'Scroll down and choose "Add to Home Screen".',
         'Tap Add. Valence appears with the rest of your apps.']
      : ['Chrome and Firefox on iPhone cannot install apps. Only Safari can.',
         'Copy this page’s link and open it in Safari.',
         'Then tap Share, and choose "Add to Home Screen".'];
    items.forEach(function (t) {
      var li = document.createElement('li');
      li.textContent = t;
      steps.appendChild(li);
    });

    var close = document.createElement('button');
    close.type = 'button';
    close.className = 'btn-secondary';
    close.textContent = 'Got it';
    close.addEventListener('click', function () {
      if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
    });

    card.appendChild(h);
    card.appendChild(steps);
    if (inSafari) {
      var arrow = document.createElement('div');
      arrow.className = 'ios-arrow';
      arrow.setAttribute('aria-hidden', 'true');
      arrow.textContent = '↓';
      card.appendChild(arrow);
    }
    card.appendChild(close);
    wrap.appendChild(card);
    wrap.addEventListener('click', function (e) {
      if (e.target === wrap && wrap.parentNode) wrap.parentNode.removeChild(wrap);
    });
    document.body.appendChild(wrap);
  }

  function wire() {
    var btn = byId('btn-install');
    if (!btn || btn.dataset.wired) return;
    btn.dataset.wired = '1';

    btn.addEventListener('click', function () {
      // iOS: there is genuinely nothing to call. Apple exposes no API for
      // this, so the honest move is to show exactly where to tap.
      if (!deferred) {
        showIosGuide();
        return;
      }
      btn.disabled = true;
      try {
        deferred.prompt();
        deferred.userChoice.then(function (choice) {
          if (choice && choice.outcome === 'accepted') {
            hide();
          } else {
            btn.disabled = false;
          }
          deferred = null;
        }, function () {
          btn.disabled = false;
        });
      } catch (e) {
        btn.disabled = false;
      }
    });
  }

  window.addEventListener('beforeinstallprompt', function (e) {
    // Suppress the browser's own bar so the app can offer this in context.
    try { e.preventDefault(); } catch (err) { }
    deferred = e;
    wire();
    show('Install Valence for a full-screen app on your home screen.', 'Install');
  });

  window.addEventListener('appinstalled', function () {
    deferred = null;
    hide();
  });

  function boot() {
    if (isStandalone()) { hide(); return; }
    wire();
    // iOS never fires the event, so offer the instructions up front.
    if (isIOS()) {
      show('Add Valence to your home screen for a full-screen app.', 'How to install');
    }
    // Everywhere else we wait for beforeinstallprompt, so the card stays
    // hidden rather than promising something the browser will not honour.
  }

  // ---- service worker ---------------------------------------------------
  // Registered here because installability on Chrome and Edge REQUIRES a
  // worker with a fetch handler, and because it is what lets the app open
  // offline. sw.js is network-first for navigations, so it can never pin
  // anyone to a stale build.
  function registerWorker() {
    if (!('serviceWorker' in navigator)) return;
    try {
      navigator.serviceWorker.register('sw.js').then(function (reg) {
        // A worker waiting to take over means a newer build is sitting there.
        if (reg.waiting) announceUpdate();
        reg.addEventListener('updatefound', function () {
          var sw = reg.installing;
          if (!sw) return;
          sw.addEventListener('statechange', function () {
            // 'installed' with an existing controller = an update, not a
            // first install.
            if (sw.state === 'installed' && navigator.serviceWorker.controller) {
              announceUpdate();
            }
          });
        });
      }).catch(function () { /* unsupported or blocked: the app still runs */ });
    } catch (e) { }
  }

  // js/updates.js owns the visible prompt; this just asks it to appear so the
  // two update paths (version.json poll and worker swap) share one UI.
  function announceUpdate() {
    try {
      window.dispatchEvent(new Event('valence-update-ready'));
    } catch (e) { }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { boot(); registerWorker(); }, { once: true });
  } else {
    boot();
    registerWorker();
  }
})();
