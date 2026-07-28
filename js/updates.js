/* ============================================================
   VALENCE GARAGE. Update notifier. js/updates.js

   An installed web app is a shortcut onto the live site, so a new
   deploy reaches people automatically the next time they open it. The
   catch is HTTP caching: the browser can hold the old page for a while,
   and nothing tells the owner a newer build exists or offers a way to
   take it. They would have to think to pull-to-refresh.

   So: compare the version baked into this page against version.json,
   fetched with cache busting so the check itself is never stale. When
   they differ, show one quiet prompt with an Update button that reloads
   onto the new build.

   Checks on load, when the app is brought back to the foreground, and
   hourly. Silent on failure: offline must never produce a nag.
   ============================================================ */
(function () {
  'use strict';

  var CHECK_MS = 60 * 60 * 1000;   // hourly while open
  var MIN_GAP_MS = 60 * 1000;      // never hammer on rapid tab switching
  var lastCheck = 0;
  var shown = false;

  function currentVersion() {
    var m = document.querySelector('meta[name="app-version"]');
    return m ? String(m.getAttribute('content') || '').trim() : '';
  }

  function showPrompt() {
    if (shown) return;
    shown = true;

    var bar = document.createElement('div');
    bar.id = 'update-bar';
    bar.setAttribute('role', 'status');

    var text = document.createElement('span');
    text.className = 'update-text';
    text.textContent = 'A newer version of the garage is ready.';

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'update-btn';
    btn.textContent = 'Update';
    btn.addEventListener('click', function () {
      btn.disabled = true;
      btn.textContent = 'Updating';
      // A cache-busted URL guarantees the new page rather than whatever the
      // browser happens to be holding.
      try {
        var u = location.origin + location.pathname + '?u=' + Date.now();
        location.replace(u);
      } catch (e) {
        location.reload();
      }
    });

    var dismiss = document.createElement('button');
    dismiss.type = 'button';
    dismiss.className = 'update-dismiss';
    dismiss.setAttribute('aria-label', 'Dismiss');
    dismiss.textContent = 'Later';
    dismiss.addEventListener('click', function () {
      if (bar.parentNode) bar.parentNode.removeChild(bar);
    });

    bar.appendChild(text);
    bar.appendChild(btn);
    bar.appendChild(dismiss);
    document.body.appendChild(bar);
  }

  function check() {
    var now = Date.now();
    if (now - lastCheck < MIN_GAP_MS) return;
    lastCheck = now;

    var mine = currentVersion();
    if (!mine) return;

    try {
      fetch('version.json?t=' + now, { cache: 'no-store' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (j) {
          if (!j || !j.version) return;
          if (String(j.version).trim() !== mine) showPrompt();
        })
        .catch(function () { /* offline: stay quiet */ });
    } catch (e) { /* fetch unavailable: stay quiet */ }
  }

  // The service worker registration also reports a newer build; share one UI.
  window.addEventListener('valence-update-ready', function () { showPrompt(); });

  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) check();
  });

  window.setInterval(check, CHECK_MS);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', check, { once: true });
  } else {
    check();
  }
})();
