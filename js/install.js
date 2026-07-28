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

  function wire() {
    var btn = byId('btn-install');
    if (!btn || btn.dataset.wired) return;
    btn.dataset.wired = '1';

    btn.addEventListener('click', function () {
      // iOS: there is nothing to call, so show the actual steps.
      if (!deferred) {
        show('Tap the Share button in Safari, then choose "Add to Home Screen".',
          'Show me how');
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

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
