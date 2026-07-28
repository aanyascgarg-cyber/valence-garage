/* ============================================================
   VALENCE GARAGE. Spec card export. js/speccard.js

   window.SpecCard.download(cfg, imgUrl)

   Draws a share-ready card onto a canvas and saves it as a PNG, so the
   owner gets a real file instead of being told to take a screenshot.

   Everything is painted by hand with the 2D context: no libraries, no
   network, no build step. That keeps it working offline and inside the
   app's self-contained constraint.

   1080 x 1350 (4:5) is the portrait ratio social platforms crop least.
   Never throws; a failure returns false so callers can stay quiet.
   ============================================================ */
(function () {
  'use strict';

  var W = 1080;
  var H = 1350;

  var GOLD = '#C9A84C';
  var CHAMPAGNE = '#E8D5A0';
  var PORCELAIN = '#FAF4F0';

  function rounded(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  // Small caps style label: letter-spaced uppercase, drawn manually because
  // canvas has no letter-spacing in older engines.
  function tracked(ctx, text, x, y, spacing, align) {
    var chars = String(text).split('');
    var total = 0;
    var i;
    for (i = 0; i < chars.length; i++) {
      total += ctx.measureText(chars[i]).width + spacing;
    }
    total -= spacing;
    var cx = align === 'center' ? x - total / 2 : x;
    for (i = 0; i < chars.length; i++) {
      ctx.fillText(chars[i], cx, y);
      cx += ctx.measureText(chars[i]).width + spacing;
    }
    return total;
  }

  function stat(ctx, x, y, w, value, label) {
    rounded(ctx, x, y, w, 150, 18);
    ctx.fillStyle = 'rgba(255,255,255,0.045)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(201,168,76,0.30)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.textAlign = 'center';
    ctx.fillStyle = PORCELAIN;
    ctx.font = '600 46px Montserrat, Segoe UI, sans-serif';
    ctx.fillText(value, x + w / 2, y + 78);

    ctx.fillStyle = 'rgba(232,213,160,0.75)';
    ctx.font = '600 18px Montserrat, Segoe UI, sans-serif';
    tracked(ctx, String(label).toUpperCase(), x + w / 2, y + 116, 2.4, 'center');
  }

  // The gold V monogram, drawn as two tapered blades meeting at a joint.
  function monogram(ctx, cx, cy, s) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.strokeStyle = GOLD;
    ctx.lineWidth = s * 0.17;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(-s * 0.52, -s * 0.46);
    ctx.lineTo(0, s * 0.52);
    ctx.lineTo(s * 0.52, -s * 0.46);
    ctx.stroke();
    ctx.restore();
  }

  function draw(ctx, cfg, perf, img) {
    // Background: near-black with a teal pool low and a gold bloom high.
    var bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#0A1014');
    bg.addColorStop(0.55, '#070C0F');
    bg.addColorStop(1, '#04080A');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    var teal = ctx.createRadialGradient(W * 0.5, H * 0.42, 40, W * 0.5, H * 0.42, W * 0.72);
    teal.addColorStop(0, 'rgba(44,150,170,0.20)');
    teal.addColorStop(0.55, 'rgba(23,84,95,0.09)');
    teal.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = teal;
    ctx.fillRect(0, 0, W, H);

    // Gold hairline frame.
    rounded(ctx, 34, 34, W - 68, H - 68, 26);
    ctx.strokeStyle = 'rgba(201,168,76,0.42)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Header.
    ctx.textAlign = 'center';
    ctx.fillStyle = GOLD;
    ctx.font = '600 20px Montserrat, Segoe UI, sans-serif';
    tracked(ctx, 'VALENCE GARAGE', W / 2, 116, 6, 'center');

    // Build name, wrapped to two lines if needed.
    ctx.fillStyle = PORCELAIN;
    ctx.font = 'italic 700 74px "Playfair Display", Georgia, serif';
    var name = String(cfg.name || 'Untitled build');
    if (ctx.measureText(name).width > W - 190) {
      ctx.font = 'italic 700 56px "Playfair Display", Georgia, serif';
    }
    ctx.fillText(name, W / 2, 210);

    // Machine underneath.
    ctx.fillStyle = 'rgba(232,213,160,0.82)';
    ctx.font = 'italic 30px "Cormorant Garamond", Georgia, serif';
    ctx.fillText(cfg.carLabel || '', W / 2, 258);

    // Car portrait, letterboxed into a fixed stage so every card lines up.
    var stageY = 300;
    var stageH = 330;
    if (img) {
      var scale = Math.min((W - 260) / img.width, stageH / img.height);
      var dw = img.width * scale;
      var dh = img.height * scale;
      try {
        ctx.drawImage(img, (W - dw) / 2, stageY + (stageH - dh) / 2, dw, dh);
      } catch (e) { /* a broken image must not kill the card */ }
    } else {
      monogram(ctx, W / 2, stageY + stageH / 2, 150);
    }

    // Setup line.
    ctx.fillStyle = 'rgba(250,244,240,0.72)';
    ctx.font = '500 24px Montserrat, Segoe UI, sans-serif';
    ctx.fillText(cfg.setupLine || '', W / 2, stageY + stageH + 58);

    // Stats: two rows of two.
    var pad = 84;
    var gap = 26;
    var colW = (W - pad * 2 - gap) / 2;
    var row1 = 748;
    var row2 = row1 + 150 + gap;

    stat(ctx, pad, row1, colW, String(perf.power), 'Power hp');
    stat(ctx, pad + colW + gap, row1, colW, perf.zeroTo60, '0 to 60 s');
    stat(ctx, pad, row2, colW, perf.topSpeed, perf.topLabel);
    stat(ctx, pad + colW + gap, row2, colW, perf.braking, perf.brakeLabel);

    // Footer: monogram, line, credit.
    monogram(ctx, W / 2, H - 196, 54);

    ctx.strokeStyle = 'rgba(201,168,76,0.32)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(W * 0.30, H - 140);
    ctx.lineTo(W * 0.70, H - 140);
    ctx.stroke();

    ctx.fillStyle = 'rgba(232,213,160,0.9)';
    ctx.font = 'italic 27px "Cormorant Garamond", Georgia, serif';
    ctx.fillText('Built in the Valence Garage', W / 2, H - 96);

    ctx.fillStyle = 'rgba(250,244,240,0.4)';
    ctx.font = '600 16px Montserrat, Segoe UI, sans-serif';
    tracked(ctx, 'WHERE PHYSICS MEETS DESIRE', W / 2, H - 62, 3.4, 'center');
  }

  function saveCanvas(canvas, filename) {
    try {
      canvas.toBlob(function (blob) {
        if (!blob) return;
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
      }, 'image/png');
      return true;
    } catch (e) {
      return false;
    }
  }

  function slug(s) {
    return String(s || 'valence-build')
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'valence-build';
  }

  // cfg carries { name, carLabel, setupLine } plus the raw build so Physics
  // can be re-run here; imgUrl is an optional car portrait (a cached snapshot).
  function download(cfg, imgUrl) {
    try {
      var canvas = document.createElement('canvas');
      canvas.width = W;
      canvas.height = H;
      var ctx = canvas.getContext('2d');
      if (!ctx) return false;

      var perf = cfg.perf;
      var finish = function (img) {
        draw(ctx, cfg, perf, img);
        saveCanvas(canvas, 'valence-' + slug(cfg.name) + '.png');
      };

      if (imgUrl) {
        var im = new Image();
        // Cached snapshots are data URLs, so this stays same-origin clean.
        im.onload = function () { finish(im); };
        im.onerror = function () { finish(null); };
        im.src = imgUrl;
      } else {
        finish(null);
      }
      return true;
    } catch (e) {
      return false;
    }
  }

  // Render only, handing back the finished canvas. Used by download() and by
  // the screenshot harness so the card can be inspected before shipping.
  function render(cfg, imgUrl, cb) {
    var canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    var ctx = canvas.getContext('2d');
    if (!ctx) { cb(null); return; }
    var finish = function (img) { draw(ctx, cfg, cfg.perf, img); cb(canvas); };
    if (imgUrl) {
      var im = new Image();
      im.onload = function () { finish(im); };
      im.onerror = function () { finish(null); };
      im.src = imgUrl;
    } else { finish(null); }
  }

  window.SpecCard = { download: download, render: render };
})();
