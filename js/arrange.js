/* ============================================================
   VALENCE GARAGE. Dashboard arranging. js/arrange.js

   Lets the owner order the Garage panels however they like, and
   remembers it.

   Behind an explicit Arrange mode rather than always-on dragging. On a
   phone an always-draggable panel fights the scroll gesture, so nothing
   moves until you ask it to, and then a grip appears on each panel.

   Pointer events throughout, so one code path covers mouse, touch and
   pen. Reordering happens live in the DOM (the dashboard is a flex
   column, so DOM order is visual order), and the resulting id order is
   saved to localStorage.

   Never throws. If anything is missing the dashboard simply stays fixed.
   ============================================================ */
(function () {
  'use strict';

  var KEY = 'vg-dash-order-v1';
  var board = null;
  var active = false;      // arrange mode on or off
  var dragEl = null;       // panel being dragged
  var startY = 0;
  var startTop = 0;

  function byId(id) { return document.getElementById(id); }

  function panels() {
    if (!board) return [];
    return Array.prototype.filter.call(board.children, function (el) {
      return el.nodeType === 1 && el.id;
    });
  }

  // ---- persistence ------------------------------------------------------

  function saveOrder() {
    try {
      var ids = panels().map(function (el) { return el.id; });
      localStorage.setItem(KEY, JSON.stringify(ids));
    } catch (e) { }
  }

  function applySavedOrder() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return;
      var ids = JSON.parse(raw);
      if (Object.prototype.toString.call(ids) !== '[object Array]') return;
      ids.forEach(function (id) {
        var el = byId(id);
        // Appending in saved order rewrites the sequence. Anything not in the
        // saved list (a panel added in a later version) keeps its place at the
        // end rather than disappearing.
        if (el && el.parentNode === board) board.appendChild(el);
      });
    } catch (e) { }
  }

  // ---- drag -------------------------------------------------------------

  function onPointerDown(e) {
    if (!active) return;
    var handle = e.target.closest ? e.target.closest('.dash-grip') : null;
    if (!handle) return;
    var el = handle.parentNode;
    if (!el || el.parentNode !== board) return;

    e.preventDefault();
    dragEl = el;
    startY = e.clientY;
    startTop = el.getBoundingClientRect().top;
    el.classList.add('dragging');
    try { handle.setPointerCapture(e.pointerId); } catch (err) { }
  }

  function onPointerMove(e) {
    if (!dragEl) return;
    e.preventDefault();

    var dy = e.clientY - startY;
    dragEl.style.transform = 'translateY(' + dy + 'px)';

    // Compare the dragged panel's centre against its siblings' centres and
    // move it in the DOM as soon as it passes one.
    var rect = dragEl.getBoundingClientRect();
    var mid = rect.top + rect.height / 2;
    var sibs = panels().filter(function (p) { return p !== dragEl; });

    for (var i = 0; i < sibs.length; i++) {
      var s = sibs[i];
      var r = s.getBoundingClientRect();
      var sMid = r.top + r.height / 2;
      if (mid < sMid && dragEl.compareDocumentPosition(s) & Node.DOCUMENT_POSITION_FOLLOWING) {
        board.insertBefore(dragEl, s);
        rebase(e.clientY);
        return;
      }
      if (mid > sMid && dragEl.compareDocumentPosition(s) & Node.DOCUMENT_POSITION_PRECEDING) {
        board.insertBefore(dragEl, s.nextSibling);
        rebase(e.clientY);
        return;
      }
    }
  }

  // After a DOM move the element jumps, so re-anchor the drag maths to where
  // it now sits. Without this the panel slides away from the finger.
  function rebase(clientY) {
    if (!dragEl) return;
    dragEl.style.transform = '';
    startY = clientY;
    startTop = dragEl.getBoundingClientRect().top;
  }

  function onPointerUp() {
    if (!dragEl) return;
    dragEl.style.transform = '';
    dragEl.classList.remove('dragging');
    dragEl = null;
    saveOrder();
  }

  // ---- mode -------------------------------------------------------------

  function addGrips() {
    panels().forEach(function (el) {
      if (el.querySelector(':scope > .dash-grip')) return;
      var g = document.createElement('button');
      g.type = 'button';
      g.className = 'dash-grip';
      g.setAttribute('aria-label', 'Drag to reorder');
      g.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
        'stroke-width="1.8" aria-hidden="true"><path d="M8 7h8M8 12h8M8 17h8" ' +
        'stroke-linecap="round"/></svg>';
      el.appendChild(g);
    });
  }

  function removeGrips() {
    var gs = board.querySelectorAll('.dash-grip');
    for (var i = 0; i < gs.length; i++) {
      if (gs[i].parentNode) gs[i].parentNode.removeChild(gs[i]);
    }
  }

  function setMode(on) {
    active = !!on;
    if (!board) return;
    board.classList.toggle('arranging', active);
    if (active) addGrips(); else removeGrips();

    var btn = byId('btn-arrange');
    if (btn) {
      btn.textContent = active ? 'Done' : 'Arrange';
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    }
  }

  function boot() {
    board = byId('dashboard');
    if (!board) return;

    applySavedOrder();

    var btn = byId('btn-arrange');
    if (btn) {
      btn.addEventListener('click', function () { setMode(!active); });
    }

    board.addEventListener('pointerdown', onPointerDown);
    board.addEventListener('pointermove', onPointerMove);
    board.addEventListener('pointerup', onPointerUp);
    board.addEventListener('pointercancel', onPointerUp);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }

  window.DashArrange = {
    reset: function () {
      try { localStorage.removeItem(KEY); } catch (e) { }
    }
  };
})();
