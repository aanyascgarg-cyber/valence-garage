/* ============================================================
   VALENCE GARAGE. The knowledge export. js/knowledge.js (v13)

   This file IS the "upload of the author's expertise": automotive
   diagnostic playbooks, fault trees, acoustic signature tables,
   fluid-color charts, wear-pattern guides and follow-up-question
   logic, written as structured data plus prompt builders. The
   language models (local WebLLM or Gemini) supply reasoning and
   prose; THIS supplies the domain expertise they reason with.

   Attaches one global: window.VGKnowledge.
   No DOM access, no network, pure data + pure functions.
   ============================================================ */
(function () {
  'use strict';

  // ------------------------------------------------------------------
  // Acoustic fault library. Each entry carries the full playbook:
  // what it sounds like (in feature terms AND human terms), what
  // causes it, how urgent, what a fair shop visit looks like, the
  // DIY checks that cost nothing, and the follow-up questions whose
  // answers separate it from its acoustic neighbors.
  // ------------------------------------------------------------------

  var FAULT_LIBRARY = [
    {
      id: 'belt',
      name: 'Accessory belt squeal',
      system: 'Engine accessories',
      sound: 'Sustained tonal squeal, 500 to 2400 Hz, often worst on cold start or when steering is turned hard.',
      causes: ['Glazed or stretched serpentine belt', 'Weak automatic tensioner', 'Misaligned or seized idler pulley', 'Coolant or oil contamination on the belt'],
      urgency: 'Low to medium. Annoying before it is dangerous, but a snapped belt kills the alternator, water pump, and power steering at once.',
      fairShop: 'Belt replacement is a 20 to 60 minute job on most cars. A tensioner adds modest parts cost. Be suspicious of a quote that bundles unrelated pulleys without showing you play in each one.',
      diy: ['Spray a little water on the belt while idling: if the squeal stops for a second, the belt itself is the culprit.', 'With the engine OFF, check belt tension and look for glazing (shiny ribs) or cracks.'],
      followUps: ['Does it squeal loudest at cold start and fade as the engine warms?', 'Does turning the steering wheel to full lock change it?', 'Does the pitch rise exactly with engine RPM?']
    },
    {
      id: 'tick',
      name: 'Valvetrain tick',
      system: 'Engine top end',
      sound: 'Rapid metallic ticking, 6 to 32 ticks per second, scaling with engine RPM; bright, above 3 kHz.',
      causes: ['Low oil level or pressure', 'Collapsed hydraulic lifter', 'Excess valve lash', 'Exhaust manifold leak ticking in sync with firing order'],
      urgency: 'Medium. A tick that appears suddenly and stays deserves an oil level check TODAY, then a shop visit within the week.',
      fairShop: 'First diagnosis should be cheap: oil level and pressure check, mechanic stethoscope on the valve cover versus the manifold. Do not accept an engine teardown quote before those.',
      diy: ['Check the oil level cold on flat ground first: five quarts of prevention.', 'Note whether tick rate doubles when RPM doubles (valvetrain) or stays constant (accessory).'],
      followUps: ['Did it start suddenly or grow over weeks?', 'Is it louder when cold?', 'Does the tick rate track RPM exactly?']
    },
    {
      id: 'knock',
      name: 'Deep engine knock',
      system: 'Engine bottom end',
      sound: 'Dull, heavy periodic knock below 400 Hz, loads up under acceleration, roughly half crankshaft speed if a rod bearing.',
      causes: ['Worn rod bearing', 'Worn main bearing', 'Piston slap (less serious, fades when warm)', 'Failing flexplate or torque converter bolts imitating a knock'],
      urgency: 'HIGH. A true rod knock is days from a thrown rod. Stop driving and diagnose.',
      fairShop: 'Insist on an oil pressure test and an oil analysis or filter inspection for metal BEFORE agreeing to engine-out work. Piston slap that fades when warm is livable; bearing knock is not.',
      diy: ['Do not rev it to "check". If knock deepens with throttle load, park it.', 'Pull the dipstick and rub the oil between fingers: glitter is verdict.'],
      followUps: ['Does it get louder under load or uphill?', 'Does it fade as the engine warms (points at piston slap)?', 'Any oil pressure warning light flicker at idle?']
    },
    {
      id: 'cv',
      name: 'CV joint click',
      system: 'Driveline',
      sound: 'Rhythmic click or pop, 1.5 to 9 clicks per second, tied to WHEEL speed not engine speed, loudest turning under power.',
      causes: ['Worn outer CV joint (clicks on full-lock turns)', 'Worn inner joint (clunk on acceleration)', 'Torn boot that let grease out and grit in'],
      urgency: 'Medium. Weeks of margin usually, but a joint that lets go leaves you stationary.',
      fairShop: 'A torn boot caught early is a cheap reboot-and-grease. A clicking joint means an axle shaft, still a bolt-on job. The tell of an honest shop: they check the boots first.',
      diy: ['Full-lock circles in an empty lot, both directions: clicking on right turns usually means the left outer joint, and vice versa.', 'Look behind each front wheel for grease flung on the suspension: torn boot signature.'],
      followUps: ['Is it only when turning under power?', 'Does the rate follow road speed rather than engine RPM?', 'Any grease visible inside the front wheels?']
    },
    {
      id: 'bearing',
      name: 'Wheel bearing drone',
      system: 'Chassis',
      sound: 'Low drone or growl under 900 Hz that rises with ROAD speed and stays through clutch-in coasting; often changes when swerving gently.',
      causes: ['Worn wheel hub bearing', 'Chopped or cupped tire wear imitating a bearing', 'Dragging brake creating a hum'],
      urgency: 'Medium-high. A collapsing bearing eventually loosens the wheel itself.',
      fairShop: 'Ask them to spin each wheel on the lift and feel for roughness, and to check tire wear pattern first: a fair shop rules out the cheap cause before the hub.',
      diy: ['On a safe empty road, sway gently side to side: drone that quiets when you load one side points at the opposite bearing.', 'Coast in neutral: if the drone is unchanged, it is not the engine.'],
      followUps: ['Does the noise change when you swerve gently left and right?', 'Does it persist with the clutch in or in neutral?', 'How do the tire treads look and feel: any scalloped chop?']
    },
    {
      id: 'leak',
      name: 'Vacuum or boost leak hiss',
      system: 'Intake',
      sound: 'Steady broadband hiss, no tone and no rhythm, often with high idle, rough idle, or a lean code.',
      causes: ['Cracked vacuum line', 'Loose intercooler coupling', 'Split intake boot', 'Failed brake booster diaphragm (hiss changes with brake pedal)'],
      urgency: 'Low to medium, but it quietly costs fuel and can lean out a turbo engine under load.',
      fairShop: 'A smoke test is the honest diagnostic and takes 20 minutes. It shows the leak; you should be offered a look.',
      diy: ['With the engine idling, press the brake pedal: hiss that changes points at the booster.', 'Listen along the intake tract with a paper towel tube as a stethoscope, engine idling, hands clear of moving parts.'],
      followUps: ['Is the idle higher or rougher than usual?', 'Any check-engine light with lean codes?', 'Does the hiss change when you press the brake pedal?']
    },
    {
      id: 'brakeind',
      name: 'Brake wear indicator squeal',
      system: 'Brakes',
      sound: 'Thin tonal squeal between 1.8 and 4.5 kHz while rolling, often disappearing WHEN you brake (indicator lifts off), returning after.',
      causes: ['Pad wear indicator tab touching the rotor: the pads are at their designed replacement point', 'Glazed pads squealing in the same band (usually only WHILE braking)'],
      urgency: 'Plan a replacement within a few hundred miles. Not an emergency while braking feels normal.',
      fairShop: 'Pads and possibly rotors, a routine job. You do NOT owe anyone calipers unless one is seized, which they should demonstrate by showing uneven pad wear side to side.',
      diy: ['Look through the wheel spokes: many pads show their thickness directly. Less than about 3 mm of friction material confirms the indicator.', 'Note whether the squeal happens while rolling free or only while braking: free-rolling squeal is the indicator tab.'],
      followUps: ['Does the squeal stop when you press the brakes?', 'One wheel or all?', 'How many miles on the current pads, roughly?']
    },
    {
      id: 'grind',
      name: 'Brake grinding, metal on metal',
      system: 'Brakes',
      sound: 'Harsh broadband grinding while braking, felt in the pedal, no clean tone left.',
      causes: ['Friction material fully consumed: backing plate against rotor', 'A stone caught between rotor and shield (grinds also while rolling free, comes and goes)'],
      urgency: 'MAXIMUM if it grinds while braking. Every stop is eating the rotors and lengthening your stopping distance.',
      fairShop: 'Pads plus rotors at this point; the rotors are the penalty for waiting. A stone, by contrast, costs nothing to flick out: a fair shop checks that first when grinding is intermittent.',
      diy: ['Distinguish: grinding only while braking = worn out pads. Intermittent scrape while rolling that vanishes randomly = likely a stone.', 'Stop driving on braking-grind. Rotors are being machined away by the backing plate.'],
      followUps: ['Only while braking, or also rolling free?', 'Did a squeal phase precede it for weeks?', 'Does the pedal feel gritty?']
    },
    {
      id: 'altwhine',
      name: 'Alternator or pulley whine',
      system: 'Charging system',
      sound: 'Rising whine that tracks engine RPM exactly, often audible through the stereo as a pitch that climbs with revs.',
      causes: ['Failing alternator bearing or diode pack', 'Worn idler or tensioner pulley bearing', 'Power steering pump moan (changes with steering input)'],
      urgency: 'Medium. Bearings announce weeks ahead; a diode whine can precede a charging failure.',
      fairShop: 'A shop with a stethoscope isolates which unit whines in minutes. A voltage check at idle (about 13.8 to 14.6 V) is free and rules the alternator in or out.',
      diy: ['Whine in the speakers that rises with RPM points at the alternator diodes.', 'Turn the steering at idle: a moan that follows your hands is the PS pump instead.'],
      followUps: ['Do you hear it through the stereo speakers too?', 'Does turning the steering wheel change it?', 'Any battery or charging light flicker?']
    },
    {
      id: 'exhaustleak',
      name: 'Exhaust leak chuff',
      system: 'Exhaust',
      sound: 'Rhythmic puffing or chuffing in time with the firing order, deeper than a valvetrain tick, often loudest cold and from under the car.',
      causes: ['Cracked exhaust manifold or flange gasket', 'Rusted-through pipe or muffler seam', 'Broken exhaust stud'],
      urgency: 'Medium: fumes and noise now, failed inspection later. Manifold leaks near the firewall deserve urgency (cabin fumes).',
      fairShop: 'Leaks are found by feel and smoke with the engine cold-started. Welded repairs are legitimate for pipes; manifold cracks usually mean the part.',
      diy: ['Cold engine, brief start: hold a hand NEAR (not on) manifold joints and feel for pulsing air.', 'Any exhaust smell in the cabin is your stop-driving line.'],
      followUps: ['Is it loudest during the first cold minute?', 'Any exhaust smell inside the car?', 'Does it puff in rhythm with the engine?']
    }
  ];

  // ------------------------------------------------------------------
  // Fluid color chart: what that puddle or drip actually is.
  // Hue ranges are in degrees (HSV), matched by localPhotoAnalysis.
  // ------------------------------------------------------------------

  var FLUID_CHART = [
    { id: 'atf', name: 'Transmission or power steering fluid', color: 'red to pink', hue: [340, 15], satMin: 0.35,
      note: 'Fresh ATF is cherry red; old ATF goes brown-red. Check level promptly; low ATF kills transmissions quietly.' },
    { id: 'coolant', name: 'Coolant', color: 'orange, green, pink, or blue and watery', hue: [70, 190], satMin: 0.3,
      note: 'Sweet smell, watery feel. Never open a hot radiator. A small external leak still deserves a pressure test.' },
    { id: 'oil', name: 'Engine oil', color: 'amber when fresh, dark brown to black when used', hue: [20, 50], satMin: 0.15, darkOk: true,
      note: 'Slick and staining. Location matters: front of engine (timing cover), rear (rear main seal), center (drain plug or filter).' },
    { id: 'brake', name: 'Brake or clutch fluid', color: 'clear to light amber, slippery, paint-stripping', hue: [30, 60], satMin: 0.05,
      note: 'Near a wheel or the firewall it deserves IMMEDIATE attention: brake fluid loss is a stopping problem.' },
    { id: 'washer', name: 'Washer fluid', color: 'bright blue, sometimes pink', hue: [190, 250], satMin: 0.4,
      note: 'Harmless. Reservoirs and lines crack in freezes.' },
    { id: 'water', name: 'Water (AC condensate)', color: 'clear, evaporates clean', hue: [0, 360], satMin: 0,
      note: 'Clear water under the passenger footwell area after AC use is normal condensate, not a leak.' }
  ];

  // ------------------------------------------------------------------
  // Visible wear patterns (photo playbook).
  // ------------------------------------------------------------------

  var WEAR_PATTERNS = [
    { id: 'tire-inner', what: 'Tire worn on inner edge only', means: 'Toe-out or camber misalignment; worn tie rod ends let it drift.', action: 'Alignment check; have them show you the before numbers.' },
    { id: 'tire-center', what: 'Tire worn in the center band', means: 'Chronic overinflation.', action: 'Set pressures to the door-jamb sticker, not the tire sidewall max.' },
    { id: 'tire-cupping', what: 'Scalloped, cupped tire wear', means: 'Weak dampers letting the wheel hop, or a failing bearing.', action: 'Bounce test each corner; one extra bounce means the damper.' },
    { id: 'rotor-scoring', what: 'Deep circular grooves on the brake rotor', means: 'Pads ran to the backing plate or trapped debris.', action: 'Rotor replacement or machining with the pads; measure thickness against the minimum stamped on the hat.' },
    { id: 'belt-cracks', what: 'Small cracks across belt ribs', means: 'Age-hardened belt near the end of its life.', action: 'Replace soon; cheap insurance for everything the belt drives.' },
    { id: 'rust-surface', what: 'Orange surface rust on suspension or subframe', means: 'Cosmetic if the metal is solid; structural if flaking in layers.', action: 'Probe with a screwdriver handle: solid ring is fine, soft crunch deserves inspection.' }
  ];

  // ------------------------------------------------------------------
  // Prompt builders: where the knowledge meets the model.
  // ------------------------------------------------------------------

  var VOICE = 'You are the Valence Garage advisor: a veteran master mechanic ' +
    'who explains clearly, never invents certainty, and protects the owner ' +
    'from being overcharged. Answer in under 180 words. Structure: (1) the ' +
    'likeliest diagnosis and why the evidence points there, (2) what else it ' +
    'could be, (3) exactly what to say at the shop counter, (4) one or two ' +
    'follow-up questions whose answers would confirm it. No markdown ' +
    'headings, plain flowing text with short paragraphs.';

  function describeFeatures(f) {
    return 'Measured acoustic evidence: dominant frequency ' +
      Math.round(f.peakHz) + ' Hz; spectral centroid ' + Math.round(f.centroid) +
      ' Hz; tonality ' + f.tonality.toFixed(2) +
      ' (0 noisy to 1 pure tone); rhythmic impulse rate ' +
      f.impulseHz.toFixed(1) + ' per second with periodicity strength ' +
      f.periodicity.toFixed(2) + '; energy split low/mid/high = ' +
      Math.round(f.lowFrac * 100) + '/' + Math.round(f.midFrac * 100) + '/' +
      Math.round(f.highFrac * 100) + ' percent; energy in the 1.8 to 4.5 kHz ' +
      'brake-indicator band ' + Math.round(f.indFrac * 100) + ' percent.';
  }

  function playbookFor(ids) {
    var lines = [];
    FAULT_LIBRARY.forEach(function (d) {
      if (ids.indexOf(d.id) < 0) return;
      lines.push(d.name.toUpperCase() + ' (' + d.system + '): sounds like: ' +
        d.sound + ' Causes: ' + d.causes.join('; ') + '. Urgency: ' +
        d.urgency + ' Fair shop practice: ' + d.fairShop +
        ' Free checks: ' + d.diy.join(' ') +
        ' Distinguishing questions: ' + d.followUps.join(' '));
    });
    return lines.join('\n');
  }

  function buildAudioPrompt(f, ranked) {
    var ids = ranked.map(function (r) { return r.id; });
    return VOICE + '\n\n' + describeFeatures(f) +
      '\n\nThe signature classifier ranked these candidates: ' +
      ranked.map(function (r) { return r.name + ' (' + r.confidence + '%)'; }).join(', ') +
      '.\n\nRelevant playbook entries:\n' + playbookFor(ids) +
      '\n\nWrite the diagnosis for the owner now.';
  }

  function buildPhotoPrompt(localFindings) {
    return VOICE + '\n\nThe owner has photographed something on or under ' +
      'their car. Identify what the photo shows and diagnose. Reference ' +
      'knowledge:\nFLUID COLOR CHART: ' +
      FLUID_CHART.map(function (c) {
        return c.name + ' = ' + c.color + ' (' + c.note + ')';
      }).join(' | ') +
      '\nWEAR PATTERNS: ' +
      WEAR_PATTERNS.map(function (w) {
        return w.what + ' -> ' + w.means + ' -> ' + w.action;
      }).join(' | ') +
      (localFindings && localFindings.length
        ? '\nA local color analyzer suggests: ' + localFindings.join('; ') + '.'
        : '') +
      '\nIf the photo does not show a car problem, say so plainly.';
  }

  // ------------------------------------------------------------------
  // Local photo analysis: fluid-color detection without any model.
  // Takes ImageData, returns human-readable findings.
  // ------------------------------------------------------------------

  function rgbToHsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b);
    var d = max - min, h = 0;
    if (d > 0) {
      if (max === r) h = 60 * (((g - b) / d) % 6);
      else if (max === g) h = 60 * ((b - r) / d + 2);
      else h = 60 * ((r - g) / d + 4);
    }
    if (h < 0) h += 360;
    return { h: h, s: max === 0 ? 0 : d / max, v: max };
  }

  function inHue(h, range) {
    var lo = range[0], hi = range[1];
    if (lo <= hi) return h >= lo && h <= hi;
    return h >= lo || h <= hi;      // wrap-around (reds)
  }

  function localPhotoAnalysis(imageData) {
    var d = imageData.data;
    var counts = {};
    var darkOily = 0, rusty = 0, total = 0;
    for (var i = 0; i < d.length; i += 16) {  // sample every 4th pixel
      var r = d[i], g = d[i + 1], b = d[i + 2];
      var hsv = rgbToHsv(r, g, b);
      total++;
      // Dark glossy pool: very low value, low saturation.
      if (hsv.v < 0.18 && hsv.s < 0.5) darkOily++;
      // Rust: orange-brown, saturated, mid-dark.
      if (hsv.h >= 15 && hsv.h <= 40 && hsv.s > 0.45 &&
          hsv.v > 0.2 && hsv.v < 0.75) rusty++;
      if (hsv.s < 0.25 || hsv.v < 0.15) continue;
      FLUID_CHART.forEach(function (c) {
        if (c.satMin <= hsv.s && inHue(hsv.h, c.hue)) {
          counts[c.id] = (counts[c.id] || 0) + 1;
        }
      });
    }
    var findings = [];
    var best = null, bestN = 0;
    Object.keys(counts).forEach(function (k) {
      if (counts[k] > bestN) { bestN = counts[k]; best = k; }
    });
    if (best && bestN / total > 0.04) {
      var chart = FLUID_CHART.filter(function (c) { return c.id === best; })[0];
      findings.push('a significant area matches ' + chart.name.toLowerCase() +
        ' coloring (' + chart.color + '): ' + chart.note);
    }
    if (darkOily / total > 0.25) {
      findings.push('a large dark glossy region consistent with an engine oil ' +
        'film or pooled used oil');
    }
    if (rusty / total > 0.06) {
      findings.push('orange-brown patches consistent with surface rust; ' +
        'solid metal is cosmetic, layered flaking is structural');
    }
    return findings;
  }

  window.VGKnowledge = {
    FAULT_LIBRARY: FAULT_LIBRARY,
    FLUID_CHART: FLUID_CHART,
    WEAR_PATTERNS: WEAR_PATTERNS,
    buildAudioPrompt: buildAudioPrompt,
    buildPhotoPrompt: buildPhotoPrompt,
    describeFeatures: describeFeatures,
    localPhotoAnalysis: localPhotoAnalysis
  };
})();
