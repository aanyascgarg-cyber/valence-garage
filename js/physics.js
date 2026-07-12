// Valence Garage. Pure physics module. No DOM access.
// Attaches a single global: window.Physics.
(function () {
  'use strict';

  // Physical constants.
  var RHO = 1.225;        // air density kg/m3
  var HP_TO_W = 745.7;    // 1 hp in watts
  var G = 9.81;           // gravity m/s2
  var ETA = 0.85;         // drivetrain efficiency. Tuned from spec 0.88 to center both top speed anchors.
  var CRR = 0.013;        // rolling resistance coefficient

  var CDA_BASE = 0.70;
  var CDA_PER_WING = 0.15;  // CdA = 0.70 + 0.15 * wingLevel
  var CLA_PER_WING = 0.85;  // ClA = 0.85 * wingLevel

  var TIRES = [
    { name: 'Touring', mu: 0.85 },
    { name: 'Sport',   mu: 0.95 },
    { name: 'Cup',     mu: 1.10 },
    { name: 'Slick',   mu: 1.25 }
  ];

  var K_RWD = 0.70;       // rear wheel drive launch traction factor
  var K_AWD = 1.00;       // all wheel drive launch traction factor
  var T_LAUNCH = 0.10;    // launch overhead added to integrated 0 to 60

  var MPH_60 = 26.82;     // 60 mph in m/s
  var V_100KMH = 27.78;   // 100 km/h in m/s (braking start)
  var V_200KMH = 55.56;   // 200 km/h in m/s (downforce reference)

  function clamp(x, lo, hi) {
    if (x < lo) return lo;
    if (x > hi) return hi;
    return x;
  }

  function clampInt(x, lo, hi) {
    var v = Math.round(x);
    if (v < lo) return lo;
    if (v > hi) return hi;
    return v;
  }

  // Sanitize a config into safe numeric inputs. Never lets bad data through.
  function sanitize(config) {
    var c = config || {};
    var power = Number(c.powerHp);
    var weight = Number(c.weightKg);
    if (!isFinite(power)) power = 650;
    if (!isFinite(weight)) weight = 1500;
    var wing = Number(c.wingLevel);
    var tire = Number(c.tireIndex);
    if (!isFinite(wing)) wing = 0;
    if (!isFinite(tire)) tire = 0;
    return {
      powerHp: clamp(power, 300, 2000),
      weightKg: clamp(weight, 900, 2200),
      drivetrain: c.drivetrain === 'RWD' ? 'RWD' : (c.drivetrain === 'AWD' ? 'AWD' : 'AWD'),
      wingLevel: clampInt(wing, 0, 4),
      tireIndex: clampInt(tire, 0, 3)
    };
  }

  function computeInternal(cfg) {
    var m = cfg.weightKg;
    var CdA = CDA_BASE + CDA_PER_WING * cfg.wingLevel;
    var ClA = CLA_PER_WING * cfg.wingLevel;
    var mu = TIRES[cfg.tireIndex].mu;
    var kDrive = cfg.drivetrain === 'AWD' ? K_AWD : K_RWD;
    var Pw = ETA * cfg.powerHp * HP_TO_W;   // wheel power in watts
    var Frr = CRR * m * G;                  // rolling resistance force

    function Fdrag(v) { return 0.5 * RHO * CdA * v * v; }
    function Fdown(v) { return 0.5 * RHO * ClA * v * v; }

    // Top speed: drag limited. Solve Pw = v * (Fdrag(v) + Frr) by bisection.
    var lo = 0, hi = 200, i, v;
    for (i = 0; i < 200; i++) {
      v = 0.5 * (lo + hi);
      var need = v * (Fdrag(v) + Frr);
      if (need > Pw) hi = v; else lo = v;
    }
    var vTop = 0.5 * (lo + hi);
    var topSpeedKmh = vTop * 3.6;

    // 0 to 60 mph: integrate dt = 0.01 from 0.5 m/s to 26.82 m/s.
    // a = min(traction limit, power limit). Two regime launch.
    var dt = 0.01;
    var t = 0;
    var crossoverV = -1;   // speed where power limit first dips below traction limit
    v = 0.5;
    while (v < MPH_60 && t < 30) {
      var aTraction = mu * kDrive * (m * G + Fdown(v)) / m;
      var aPower = (Pw / Math.max(v, 3) - Fdrag(v) - Frr) / m;
      if (crossoverV < 0 && aPower < aTraction) crossoverV = v;
      var a = aTraction < aPower ? aTraction : aPower;
      if (a <= 0) break;
      v += a * dt;
      t += dt;
    }
    var zeroTo60 = t + T_LAUNCH;
    if (crossoverV < 0) crossoverV = v;

    // Launch acceleration in g at rest (traction limited off the line).
    var launchAccelG = (mu * kDrive * (m * G + Fdown(0)) / m) / G;
    var crossoverSpeedKmh = crossoverV * 3.6;

    // Braking from 100 km/h. Downforce aided. brakes use all four tires.
    var muBrake = mu * 1.05;
    var vb = V_100KMH;
    var dist = 0, tb = 0;
    while (vb > 0.1 && tb < 30) {
      var ab = muBrake * (m * G + Fdown(vb)) / m;
      dist += vb * dt;
      vb -= ab * dt;
      tb += dt;
    }
    var braking100 = dist;
    var brakeDecelG = tb > 0 ? (V_100KMH / tb) / G : 0;

    var dragAtTop = Fdrag(vTop);
    var dragPowerAtTop = (dragAtTop + Frr) * vTop;
    var downAt200 = Fdown(V_200KMH);
    var downAtTop = Fdown(vTop);

    var ptw = cfg.powerHp / (m / 1000);   // hp per tonne

    // Radar, each clamped 0 to 1.
    var radar = {
      power: clamp((cfg.powerHp - 300) / 1200, 0, 1),
      accel: clamp((5.5 - zeroTo60) / 3.5, 0, 1),
      top: clamp((topSpeedKmh - 250) / 200, 0, 1),
      corner: clamp((mu * (1 + ClA / 4) - 0.8) / 1.0, 0, 1),
      brake: clamp((36 - braking100) / 12, 0, 1)
    };

    return {
      ptw: ptw,
      zeroTo60: zeroTo60,
      topSpeedKmh: topSpeedKmh,
      braking100: braking100,
      radar: radar,
      eng: {
        CdA: CdA,
        ClA: ClA,
        mu: mu,
        kDrive: kDrive,
        vTop: vTop,
        dragAtTop: dragAtTop,
        dragPowerAtTop: dragPowerAtTop,
        downAt200: downAt200,
        downAtTop: downAtTop,
        launchAccelG: launchAccelG,
        crossoverSpeedKmh: crossoverSpeedKmh,
        brakeDecelG: brakeDecelG
      }
    };
  }

  function compute(config) {
    return computeInternal(sanitize(config));
  }

  var ARCHETYPES = {
    gt:      { name: 'Grand Tourer',   tagline: 'Continental pace, velvet thunder',
               powerHp: 650,  weightKg: 1750, drivetrain: 'AWD', wingLevel: 0,
               tireIndex: 1, accent: '#E8C8B4' },
    hypergt: { name: 'Hyper GT',       tagline: 'Everything, everywhere, instantly',
               powerHp: 1000, weightKg: 1450, drivetrain: 'AWD', wingLevel: 1,
               tireIndex: 1, accent: '#C9A84C' },
    track:   { name: 'Track Weapon',   tagline: 'Downforce is a religion',
               powerHp: 750,  weightKg: 1150, drivetrain: 'RWD', wingLevel: 3,
               tireIndex: 2, accent: '#A02020' },
    ev:      { name: 'Electric Hyper', tagline: 'Silent violence',
               powerHp: 1400, weightKg: 1950, drivetrain: 'AWD', wingLevel: 1,
               tireIndex: 1, accent: '#FAF4F0' }
  };

  function selfTest() {
    var results = [];
    var pass = true;

    function check(label, cond) {
      results.push((cond ? 'PASS ' : 'FAIL ') + label);
      if (!cond) pass = false;
    }

    // Anchor 1: 1000 hp, 1300 kg, AWD, Cup (2), wing 2.
    var a1 = compute({ powerHp: 1000, weightKg: 1300, drivetrain: 'AWD', wingLevel: 2, tireIndex: 2 });
    check('anchor1 0to60 near 2.6 (' + a1.zeroTo60.toFixed(2) + ')', Math.abs(a1.zeroTo60 - 2.6) <= 0.2);
    check('anchor1 top near 350 (' + a1.topSpeedKmh.toFixed(1) + ')', Math.abs(a1.topSpeedKmh - 350) <= 15);

    // Anchor 2: 500 hp, 1500 kg, RWD, Sport (1), wing 1.
    var a2 = compute({ powerHp: 500, weightKg: 1500, drivetrain: 'RWD', wingLevel: 1, tireIndex: 1 });
    check('anchor2 0to60 near 4.2 (' + a2.zeroTo60.toFixed(2) + ')', Math.abs(a2.zeroTo60 - 4.2) <= 0.3);
    check('anchor2 top near 290 (' + a2.topSpeedKmh.toFixed(1) + ')', Math.abs(a2.topSpeedKmh - 290) <= 15);

    // Direction assertions.
    var w0 = compute({ powerHp: 800, weightKg: 1400, drivetrain: 'AWD', wingLevel: 0, tireIndex: 1 });
    var w3 = compute({ powerHp: 800, weightKg: 1400, drivetrain: 'AWD', wingLevel: 3, tireIndex: 1 });
    check('more wing lowers top speed', w3.topSpeedKmh < w0.topSpeedKmh);
    check('more wing shortens or equals 0to60', w3.zeroTo60 <= w0.zeroTo60 + 1e-9);
    check('more wing shortens braking', w3.braking100 < w0.braking100);

    var pLo = compute({ powerHp: 500, weightKg: 1400, drivetrain: 'AWD', wingLevel: 2, tireIndex: 1 });
    var pHi = compute({ powerHp: 1200, weightKg: 1400, drivetrain: 'AWD', wingLevel: 2, tireIndex: 1 });
    check('more power raises top speed', pHi.topSpeedKmh > pLo.topSpeedKmh);
    check('more power shortens 0to60', pHi.zeroTo60 < pLo.zeroTo60);

    var rwd = compute({ powerHp: 800, weightKg: 1400, drivetrain: 'RWD', wingLevel: 2, tireIndex: 1 });
    var awd = compute({ powerHp: 800, weightKg: 1400, drivetrain: 'AWD', wingLevel: 2, tireIndex: 1 });
    check('AWD not slower than RWD', awd.zeroTo60 <= rwd.zeroTo60 + 1e-9);

    var lw = compute({ powerHp: 800, weightKg: 1200, drivetrain: 'AWD', wingLevel: 2, tireIndex: 1 });
    var hw = compute({ powerHp: 800, weightKg: 1800, drivetrain: 'AWD', wingLevel: 2, tireIndex: 1 });
    check('more weight not faster', hw.zeroTo60 >= lw.zeroTo60 - 1e-9);

    var t1 = compute({ powerHp: 800, weightKg: 1400, drivetrain: 'AWD', wingLevel: 2, tireIndex: 1 });
    var t3 = compute({ powerHp: 800, weightKg: 1400, drivetrain: 'AWD', wingLevel: 2, tireIndex: 3 });
    check('better tires not slower', t3.zeroTo60 <= t1.zeroTo60 + 1e-9);

    return { pass: pass, results: results };
  }

  window.Physics = {
    RHO: RHO,
    HP_TO_W: HP_TO_W,
    G: G,
    ETA: ETA,
    CRR: CRR,
    CDA_BASE: CDA_BASE,
    CDA_PER_WING: CDA_PER_WING,
    CLA_PER_WING: CLA_PER_WING,
    TIRES: TIRES,
    K_RWD: K_RWD,
    K_AWD: K_AWD,
    T_LAUNCH: T_LAUNCH,
    ARCHETYPES: ARCHETYPES,
    compute: compute,
    selfTest: selfTest
  };
})();
