// viewer.js. window.Viewer. Three.js 3D configurator stage for Valence Garage v3.
//
// This is a classic (non module) script. It attaches exactly one global,
// window.Viewer. The Three.js runtime (r128) lives locally under vendor/ as
// classic UMD builds (three.min.js plus the examples/js GLTFLoader.js and
// OrbitControls.js that attach to the THREE global). They are injected as
// classic <script> tags at first Viewer.mount, with src resolved relative to
// this script's own URL. Dynamically injected classic scripts work on file://
// as well as http(s), so the page needs no import map, no ES modules, and no
// build step. Everything runs offline from a static host or straight from disk.
//
// The 3D model is a fixed mesh. Wing and tire changes are reflected only in
// the physics readouts, not in the viewer. Only accent recolors the model.

(function () {
  'use strict';

  // Resolve vendor URLs relative to THIS script so it works no matter what
  // path the app is served from, and on file:// too. document.currentScript is
  // valid while this classic script runs; we capture it immediately.
  var scriptUrl = (document.currentScript && document.currentScript.src) || '';
  if (!scriptUrl) {
    // Defensive fallback: find our own tag by src suffix.
    var tags = document.getElementsByTagName('script');
    for (var t = 0; t < tags.length; t++) {
      if (tags[t].src && /viewer\.js(\?|#|$)/.test(tags[t].src)) {
        scriptUrl = tags[t].src;
        break;
      }
    }
  }
  var baseUrl = scriptUrl.replace(/[^/]*$/, ''); // strip filename, keep js/
  function vendor(name) {
    // js/ is a sibling of vendor/, so go up one level. Protocol agnostic:
    // the resulting URL keeps whatever scheme baseUrl has (file: or http:).
    return new URL('../vendor/' + name, baseUrl).href;
  }

  // Human readable, brand voice reasons. These exact strings drive the
  // placeholder line and the mount's data-reason attribute.
  var REASON = {
    WEBGL: 'WebGL is unavailable',
    RUNTIME: 'the 3D runtime failed to load',
    MODEL: 'this model failed to load',
    FILE: 'open via a local server or the deployed site for 3D'
  };

  var THREE = null;         // window.THREE once the runtime loads
  var libPromise = null;    // memoized runtime load

  // Inject one classic <script> tag and resolve when it loads. Works on
  // file:// because dynamically created script tags are fetched by the same
  // mechanism as static ones, which browsers permit for local files.
  function injectScript(src) {
    return new Promise(function (resolve, reject) {
      var el = document.createElement('script');
      el.src = src;
      el.async = false; // preserve execution order across chained injects
      el.onload = function () { resolve(); };
      el.onerror = function () {
        reject(new Error('script load failed: ' + src));
      };
      (document.head || document.documentElement).appendChild(el);
    });
  }

  // Load the r128 runtime once. three.min.js must run before the two
  // examples/js add ons, since they reference the THREE global. Returns a
  // Promise resolving to the THREE namespace, or rejecting if it cannot load.
  function loadLibs() {
    if (libPromise) return libPromise;
    libPromise = (function () {
      // If something already put THREE on the window, reuse it.
      if (window.THREE && window.THREE.GLTFLoader && window.THREE.OrbitControls) {
        THREE = window.THREE;
        return Promise.resolve(THREE);
      }
      return injectScript(vendor('three.min.js'))
        .then(function () {
          if (!window.THREE) throw new Error('THREE global missing after load');
          THREE = window.THREE;
          // The two add ons attach to THREE; load them in sequence.
          return injectScript(vendor('GLTFLoader.js'));
        })
        .then(function () { return injectScript(vendor('OrbitControls.js')); })
        .then(function () {
          if (!THREE.GLTFLoader || !THREE.OrbitControls) {
            throw new Error('three add ons missing after load');
          }
          return THREE;
        });
    })();
    return libPromise;
  }

  // Internal state, one renderer reused across all cars.
  var state = {
    mounted: false,
    container: null,
    renderer: null,
    scene: null,
    camera: null,
    controls: null,
    modelRoot: null,       // THREE.Group holding the current model
    placeholder: null,     // THREE.Group for the fallback wireframe
    contactShadow: null,
    rafId: 0,
    running: false,
    visible: true,
    docVisible: true,
    lastTime: 0,
    autoRotateSpeed: 0.25, // radians per second, slow
    cache: {},             // carId -> { scene: THREE.Group, order: n }
    cacheOrder: 0,
    currentCarId: null,
    currentCar: null,      // last carEntry passed to show, for Retry
    frameRadius: 1,
    frameCenter: null,
    io: null,
    lastReason: null,      // last diagnostic reason, for __debug
    captureRenderer: null, // dedicated offscreen renderer for snapshots
    captureCamera: null,   // dedicated camera for snapshots
    envTexture: null,      // PMREM environment map applied to scene.environment
    // Camera intro sweep, driven inside tick without extra rAF owners.
    sweep: null,           // { t, dur, fromPos, fromTarget, toPos, toTarget }
    // X-RAY signature toggle.
    xrayBtn: null,         // the circular badge button element
    xrayOn: false,         // current toggle state (resets per car)
    xrayGroup: null,       // the live clone group added to the scene when on
    xrayCache: {},         // carId -> { group: THREE.Group, order: n }
    // Parametric rear wing (v11): rebuilt per car and per level change.
    wingLevel: 0,          // desired aero wing level for the displayed car
    wingGroup: null,       // THREE.Group child of modelRoot when level > 0
    profileCache: {},      // carId|accent|wing -> { url, noseLeft }
    // Bespoke Blender showroom podium (v15).
    podium: null,          // loaded turntable GLB root
    podiumLoading: false
  };

  // Snapshot output dimensions per spec.
  var SNAP_W = 800;
  var SNAP_H = 450;

  var MAX_CACHE = 4; // dispose beyond this many cached models (viewer + duel pair)

  // ---- lifecycle ----------------------------------------------------------

  // Viewer.mount(containerEl): create renderer, scene, lights, controls once.
  // Returns a Promise so callers can await readiness. Fails gracefully: if
  // WebGL or the runtime is unavailable it leaves a diagnostic placeholder and
  // resolves false rather than throwing.
  function mount(containerEl) {
    if (state.mounted) return Promise.resolve(true);
    state.container = containerEl;

    // Fail fast and clearly if this browser has no WebGL at all.
    if (!hasWebGL()) {
      showDiagnostic(containerEl, REASON.WEBGL, function () {
        state.mounted = false;
        return mount(containerEl);
      });
      return Promise.resolve(false);
    }

    return loadLibs().then(function () {
      try {
        clearDiagnostic(containerEl);
        buildScene(containerEl);
        state.mounted = true;
        return true;
      } catch (err) {
        showDiagnostic(containerEl, REASON.WEBGL, function () {
          state.mounted = false;
          return mount(containerEl);
        });
        return false;
      }
    }).catch(function () {
      // The runtime scripts themselves failed to load.
      libPromise = null; // allow a Retry to try the injection again
      showDiagnostic(containerEl, REASON.RUNTIME, function () {
        state.mounted = false;
        return mount(containerEl);
      });
      return false;
    });
  }

  // Quick WebGL capability probe that never throws.
  function hasWebGL() {
    try {
      var c = document.createElement('canvas');
      return !!(window.WebGLRenderingContext &&
        (c.getContext('webgl') || c.getContext('experimental-webgl')));
    } catch (e) {
      return false;
    }
  }

  function buildScene(containerEl) {
    var renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance'
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(sizeOf(containerEl).w, sizeOf(containerEl).h, false);
    renderer.toneMapping = THREE.ACESFilmicToneMapping; // exists in r128
    renderer.toneMappingExposure = 1.15;
    // r128 uses outputEncoding + sRGBEncoding (not the r15x outputColorSpace).
    // GLTFLoader reads outputEncoding to decode base color textures to sRGB.
    if ('outputEncoding' in renderer && THREE.sRGBEncoding !== undefined) {
      renderer.outputEncoding = THREE.sRGBEncoding;
    }
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.style.display = 'block';
    containerEl.appendChild(renderer.domElement);
    state.renderer = renderer;

    var scene = new THREE.Scene();
    state.scene = scene;

    var camera = new THREE.PerspectiveCamera(
      35, aspectOf(containerEl), 0.1, 1000);
    camera.position.set(3.2, 1.4, 4.6);
    state.camera = camera;

    setupLights(scene);
    setupEnvironment(renderer, scene);
    setupGround(scene);

    var controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enablePan = false;          // pan disabled per spec
    controls.minDistance = 2.2;          // zoom clamped
    controls.maxDistance = 9;
    controls.minPolarAngle = 0.15;
    controls.maxPolarAngle = Math.PI * 0.52; // stay above the ground plane
    controls.autoRotate = false;         // driven manually for pause control
    state.controls = controls;

    // Pause auto rotate while the user is dragging, resume after.
    controls.addEventListener('start', function () {
      state.userInteracting = true;
    });
    controls.addEventListener('end', function () {
      state.userInteracting = false;
    });

    // Pause rendering when the tab is hidden.
    document.addEventListener('visibilitychange', function () {
      state.docVisible = !document.hidden;
      syncRunning();
    });

    // Pause rendering when the container scrolls out of view.
    if ('IntersectionObserver' in window) {
      state.io = new IntersectionObserver(function (entries) {
        for (var i = 0; i < entries.length; i++) {
          state.visible = entries[i].isIntersecting;
        }
        syncRunning();
      }, { threshold: 0.01 });
      state.io.observe(containerEl);
    }

    window.addEventListener('resize', onResize);

    syncRunning();
  }

  function setupLights(scene) {
    // Dark studio. Key light champagne, rim light gold, soft fill.
    var ambient = new THREE.AmbientLight(0x201418, 0.6);
    scene.add(ambient);

    var hemi = new THREE.HemisphereLight(0x2a1518, 0x050203, 0.5);
    scene.add(hemi);

    var key = new THREE.DirectionalLight(0xe8d5a0, 2.4); // champagne
    key.position.set(4, 6, 5);
    key.castShadow = true;
    key.shadow.mapSize.width = 1024;
    key.shadow.mapSize.height = 1024;
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 30;
    key.shadow.bias = -0.0004;
    scene.add(key);

    var rim = new THREE.DirectionalLight(0xc9a84c, 1.6); // gold rim
    rim.position.set(-5, 3, -4);
    scene.add(rim);

    var fill = new THREE.DirectionalLight(0xe8c8b4, 0.5); // cognac fill
    fill.position.set(-2, 2, 5);
    scene.add(fill);

    // A gentle point of light low and front to lift dark paint off the void.
    var glow = new THREE.PointLight(0xa02020, 0.5, 20);
    glow.position.set(0, 0.6, 3.5);
    scene.add(glow);
  }

  // Build a procedural studio environment and run it through PMREMGenerator so
  // car paint and glass gain real specular life. Everything is generated in a
  // 2D canvas as an equirectangular panorama: a soft vertical sky gradient
  // (cool top, warm horizon, deep floor), two or three bright softbox
  // rectangles overhead for crisp highlights, a warm key glow on one side and a
  // cool rim glow on the other. That canvas becomes an equirect texture which
  // PMREM prefilters into the roughness-aware environment map. If PMREM or any
  // step is unavailable on this device, we catch and simply skip it: the
  // existing directional-light studio remains as the fallback look.
  function setupEnvironment(renderer, scene) {
    try {
      if (typeof THREE.PMREMGenerator !== 'function') return;

      var w = 1024, h = 512;
      var canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      var ctx = canvas.getContext('2d');
      if (!ctx) return;

      // Base sky gradient: cool dusk at the zenith, warm champagne toward the
      // horizon, sinking to a near-black floor so the void stays cinematic.
      var sky = ctx.createLinearGradient(0, 0, 0, h);
      sky.addColorStop(0.0, '#2b2f3a');   // cool cathedral ceiling
      sky.addColorStop(0.42, '#3a3330');  // neutral upper wall
      sky.addColorStop(0.6, '#4a3a2c');   // warm horizon band
      sky.addColorStop(0.72, '#241a16');  // lower wall falling to dark
      sky.addColorStop(1.0, '#080606');   // deep floor
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, w, h);

      // Warm key glow on the left, cool rim glow on the right. Large soft
      // radial washes lifted above the horizon line.
      paintRadial(ctx, w * 0.24, h * 0.34, w * 0.42,
        'rgba(232, 200, 150, 0.55)');   // warm champagne key
      paintRadial(ctx, w * 0.82, h * 0.30, w * 0.36,
        'rgba(150, 180, 220, 0.40)');   // cool blue rim
      paintRadial(ctx, w * 0.5, h * 0.9, w * 0.5,
        'rgba(120, 60, 40, 0.22)');     // faint warm floor bounce

      // Bright softbox rectangles overhead. These are the hard highlight
      // sources that give paint its glint. Each is a soft-edged white panel.
      paintSoftbox(ctx, w * 0.30, h * 0.12, w * 0.20, h * 0.14, 1.0);
      paintSoftbox(ctx, w * 0.58, h * 0.09, w * 0.16, h * 0.12, 0.92);
      paintSoftbox(ctx, w * 0.10, h * 0.20, w * 0.10, h * 0.10, 0.7);

      var equirect = new THREE.CanvasTexture(canvas);
      equirect.mapping = THREE.EquirectangularReflectionMapping;
      if ('encoding' in equirect && THREE.sRGBEncoding !== undefined) {
        equirect.encoding = THREE.sRGBEncoding;
      }

      var pmrem = new THREE.PMREMGenerator(renderer);
      if (pmrem.compileEquirectangularShader) {
        pmrem.compileEquirectangularShader();
      }
      var envRT = pmrem.fromEquirectangular(equirect);
      scene.environment = envRT.texture;
      state.envTexture = envRT.texture;

      // The source canvas texture and generator are no longer needed once the
      // prefiltered map exists; keep only the render target texture.
      equirect.dispose();
      pmrem.dispose();

      // With real reflections doing more of the lighting work, nudge exposure
      // up a touch so dark paint reads without blowing the softbox highlights.
      renderer.toneMappingExposure = 1.28;
    } catch (e) {
      // No environment: the directional studio is a complete fallback.
      state.envTexture = null;
    }
  }

  // Soft radial color wash helper for the environment canvas.
  function paintRadial(ctx, cx, cy, r, color) {
    var g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, color);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  }

  // A soft-edged bright rectangle standing in for a studio softbox. Painted as
  // a bright core with a feathered radial falloff so reflections read as clean
  // highlights rather than hard rectangles.
  function paintSoftbox(ctx, x, y, sw, sh, intensity) {
    ctx.save();
    var cx = x + sw / 2;
    var cy = y + sh / 2;
    var g = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(sw, sh) * 0.75);
    var a = Math.max(0, Math.min(1, intensity));
    g.addColorStop(0, 'rgba(255, 250, 240, ' + a + ')');
    g.addColorStop(0.55, 'rgba(255, 246, 228, ' + (a * 0.55) + ')');
    g.addColorStop(1, 'rgba(255, 240, 210, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - sw * 0.5, y - sh * 0.5, sw * 2, sh * 2);
    ctx.restore();
  }

  function setupGround(scene) {
    // A soft blurred dark contact disc under the car. This is a radial
    // gradient texture painted on a plane, cheap and no rAF cost.
    var size = 256;
    var canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    var ctx = canvas.getContext('2d');
    var grad = ctx.createRadialGradient(
      size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grad.addColorStop(0, 'rgba(0,0,0,0.55)');
    grad.addColorStop(0.5, 'rgba(0,0,0,0.28)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);

    var tex = new THREE.CanvasTexture(canvas);
    // r128 uses texture.encoding, not texture.colorSpace.
    if ('encoding' in tex && THREE.sRGBEncoding !== undefined) {
      tex.encoding = THREE.sRGBEncoding;
    }
    var mat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      depthWrite: false
    });
    var plane = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), mat);
    plane.rotation.x = -Math.PI / 2;
    plane.position.y = 0;
    plane.renderOrder = -1;
    scene.add(plane);
    state.contactShadow = plane;
  }

  // ---- show / load --------------------------------------------------------

  // Viewer.show(carEntry): lazy load the glb (cached after first load),
  // auto frame, start slow auto rotate. Returns a Promise that always
  // resolves (graceful placeholder on failure).
  function show(carEntry) {
    if (!state.mounted) {
      return mount(state.container).then(function (ok) {
        if (!ok) return false;
        return show(carEntry);
      });
    }
    if (!carEntry || !carEntry.file) {
      swapModel(makePlaceholder());
      return Promise.resolve(false);
    }

    state.currentCarId = carEntry.id;
    state.currentCar = carEntry;
    clearDiagnostic(state.container);
    setLoading(true);

    // Serve from cache when available.
    var cached = state.cache[carEntry.id];
    if (cached) {
      cached.order = ++state.cacheOrder;
      swapModel(cloneNothing(cached.scene));
      frameAndStart();
      setLoading(false);
      return Promise.resolve(true);
    }

    return new Promise(function (resolve) {
      var loader = new THREE.GLTFLoader();
      var url = resolveModelUrl(carEntry.file);
      loader.load(url, function (gltf) {
        setLoadingProgress(null);
        try {
          var root = gltf.scene || (gltf.scenes && gltf.scenes[0]);
          if (!root) throw new Error('empty gltf');
          prepareModel(root);
          state.cache[carEntry.id] = { scene: root, order: ++state.cacheOrder };
          pruneCache();
          // Ignore a stale load if the user moved on to another car.
          if (state.currentCarId === carEntry.id) {
            swapModel(root);
            frameAndStart();
          }
          setLoading(false);
          resolve(true);
        } catch (err) {
          // Keep the failure diagnosable: __debug surfaces the last error.
          state.lastLoadError = String((err && err.stack) || err);
          onModelFailure(carEntry);
          resolve(false);
        }
      }, function (ev) {
        // Live download percentage; when the bytes finish, the label flips
        // to FORGING for the parse phase so the stage never looks dead.
        if (ev && ev.total > 0) {
          var pct = Math.min(100, Math.round(100 * ev.loaded / ev.total));
          setLoadingProgress(pct >= 100 ? 'FORGING' : ('ASSEMBLING · ' + pct + '%'));
        }
      }, function () {
        // Network or parse failure. On file:// this is the usual outcome
        // because Chrome blocks XHR/fetch of local files, so show the
        // one line local-server note instead of the generic model error.
        onModelFailure(carEntry);
        resolve(false);
      });
    });
  }

  // Update the assembling plate's text without rebuilding it.
  function setLoadingProgress(text) {
    if (!state.container) return;
    var lbl = state.container.querySelector('.stage-assembling .sa-text');
    if (lbl) lbl.textContent = text || 'ASSEMBLING';
  }

  // A model load failed. Show the in scene wireframe fallback, and set the
  // right diagnostic: on file:// it is almost always the local-file fetch
  // block, so we name that; over http it is a genuine per-model failure.
  function onModelFailure(carEntry) {
    swapModel(makePlaceholder());
    setLoading(false);
    // No X-ray of a placeholder: hide the badge until a real model lands.
    if (state.xrayBtn) state.xrayBtn.hidden = true;
    var isFile = (location.protocol === 'file:');
    var reason = isFile ? REASON.FILE : REASON.MODEL;
    showDiagnostic(state.container, reason, function () {
      return show(carEntry || state.currentCar);
    });
  }

  // Model URLs are relative to the app root (the page), not to this script,
  // because cars.js paths are like 'models/foo.glb'. Resolve against the
  // document base so it works from any served path.
  function resolveModelUrl(file) {
    return new URL(file, document.baseURI).href;
  }

  function prepareModel(root) {
    // Enable shadows and make sure materials survive tone mapping. Also tag
    // meshes with a surface area estimate for the setAccent heuristic.
    root.traverse(function (obj) {
      if (obj.isMesh) {
        obj.castShadow = true;
        obj.receiveShadow = false;
        if (obj.geometry && !obj.geometry.boundingBox) {
          obj.geometry.computeBoundingBox();
        }
      }
    });
  }

  // We do not deep clone cached scenes (that would duplicate GPU buffers).
  // Since only one car is shown at a time and accent edits are reversible,
  // reusing the same object graph is fine.
  function cloneNothing(scene) {
    return scene;
  }

  function swapModel(newRoot) {
    if (state.modelRoot && state.modelRoot !== newRoot) {
      state.scene.remove(state.modelRoot);
    }
    if (state.placeholder && state.placeholder !== newRoot) {
      state.scene.remove(state.placeholder);
      state.placeholder = null;
    }
    state.modelRoot = newRoot;
    if (newRoot && newRoot.parent !== state.scene) {
      state.scene.add(newRoot);
    }
  }

  // Center the model at the origin, scale it to a consistent size, and place
  // the camera and controls target to frame it nicely.
  function frameAndStart() {
    var root = state.modelRoot;
    if (!root) return;
    var box = new THREE.Box3().setFromObject(root);
    if (box.isEmpty()) return;

    var size = new THREE.Vector3();
    var center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);

    // Normalize to a target footprint so every car frames the same way.
    var maxDim = Math.max(size.x, size.y, size.z) || 1;
    var target = 2.6;
    var scale = target / maxDim;
    root.scale.setScalar(scale);

    // Recompute after scaling and drop the model onto the ground plane.
    box.setFromObject(root);
    box.getSize(size);
    // Self-correcting pass: animated or skinned hierarchies can report
    // different bounds before and after scaling (bind-pose outliers), which
    // left some machines microscopic in frame. Measure what the scale
    // actually produced and correct multiplicatively when it missed.
    var measured = Math.max(size.x, size.y, size.z);
    if (measured > 0.001 && Math.abs(measured - target) / target > 0.05) {
      root.scale.multiplyScalar(target / measured);
      box.setFromObject(root);
      box.getSize(size);
    }
    box.getCenter(center);
    root.position.x -= center.x;
    root.position.z -= center.z;
    root.position.y -= box.min.y; // sit on y = 0

    // Recompute the framed bounds for the camera.
    box.setFromObject(root);
    box.getSize(size);
    box.getCenter(center);
    state.frameCenter = center.clone();
    var radius = 0.5 * Math.sqrt(
      size.x * size.x + size.y * size.y + size.z * size.z);
    state.frameRadius = radius;

    var fov = state.camera.fov * Math.PI / 180;
    var dist = radius / Math.sin(fov / 2) * 1.05;
    state.controls.minDistance = Math.max(radius * 1.1, 1.5);
    state.controls.maxDistance = dist * 2.2;

    // The standard beauty pose: a gentle three-quarter from the front, lifted.
    // This is exactly where autorotate takes over, so the sweep must land here.
    var beautyDir = new THREE.Vector3(0.7, 0.35, 1).normalize();
    var beautyPos = center.clone().addScaledVector(beautyDir, dist);

    state.camera.near = Math.max(0.05, dist / 100);
    state.camera.far = dist * 20;
    state.camera.updateProjectionMatrix();

    // Reset X-RAY per car: the previous car's view must not carry over.
    ensureXrayButton();
    resetXray();

    // Bolt on the build's rear wing (v11): visible aero, not just numbers.
    rebuildWing();

    // The bespoke showroom podium (modeled in Blender, v15) loads once and
    // turns with whichever machine stands on it.
    ensurePodium();

    // Camera intro sweep. On every show, ease from a low front three-quarter
    // start into the beauty pose over ~1.2s, then hand off to autorotate with
    // no jump because the sweep ends precisely at the beauty pose. Skipped
    // under prefers-reduced-motion, and cancelled instantly on user drag.
    if (!prefersReducedMotion()) {
      // Low, close, more head-on start: swung slightly less around, dropped
      // toward the ground line, and pulled in a touch for a dramatic reveal.
      var startDir = new THREE.Vector3(0.28, 0.12, 1).normalize();
      var startPos = center.clone().addScaledVector(startDir, dist * 0.92);
      state.controls.target.copy(center);
      state.camera.position.copy(startPos);
      state.camera.updateProjectionMatrix();
      state.sweep = {
        t: 0,
        dur: 1.2,
        fromPos: startPos.clone(),
        fromTarget: center.clone(),
        toPos: beautyPos.clone(),
        toTarget: center.clone()
      };
      // Do not let damping fight the scripted interpolation during the sweep.
      state.controls.enableDamping = false;
    } else {
      state.sweep = null;
      state.controls.enableDamping = true;
      state.controls.target.copy(center);
      state.camera.position.copy(beautyPos);
    }
    state.controls.update();

    syncRunning();
  }

  // ---- X-RAY signature toggle ---------------------------------------------
  // Shader-light take on the engineering money shot: a champagne wireframe
  // over an additive teal ghost of the same geometry. Implemented safely as a
  // duplicate mesh set (shared geometry, zero-copy) whose world transforms are
  // frozen from the framed model; the toggle swaps visibility and NEVER
  // mutates the original materials.

  function ensureXrayButton() {
    if (state.xrayBtn || !state.container) return;
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'xray-btn';
    btn.setAttribute('aria-pressed', 'false');
    btn.setAttribute('aria-label', 'Toggle X-ray view');
    btn.textContent = 'X-RAY';
    btn.addEventListener('click', function () {
      setXray(!state.xrayOn);
    });
    state.container.appendChild(btn);
    state.xrayBtn = btn;
  }

  function buildXrayGroup(root, carId) {
    var cached = state.xrayCache[carId];
    if (cached) {
      cached.order = ++state.cacheOrder;
      return cached.group;
    }
    var group = new THREE.Group();
    // Additive at whisper opacity: on production-density meshes the triangle
    // density itself becomes the shading, which reads as a golden hologram
    // rather than a solid blob.
    var wireMat = new THREE.MeshBasicMaterial({
      color: 0xC9A84C, wireframe: true,
      transparent: true, opacity: 0.05,
      blending: THREE.AdditiveBlending, depthWrite: false
    });
    var ghostMat = new THREE.MeshBasicMaterial({
      color: 0x17545F, transparent: true, opacity: 0.05,
      blending: THREE.AdditiveBlending, depthWrite: false
    });
    root.updateMatrixWorld(true);
    root.traverse(function (obj) {
      if (obj.isMesh && obj.geometry) {
        var ghost = new THREE.Mesh(obj.geometry, ghostMat);
        ghost.matrixAutoUpdate = false;
        ghost.matrix.copy(obj.matrixWorld);
        group.add(ghost);
        var wire = new THREE.Mesh(obj.geometry, wireMat);
        wire.matrixAutoUpdate = false;
        wire.matrix.copy(obj.matrixWorld);
        group.add(wire);
      }
    });
    state.xrayCache[carId] = { group: group, order: state.cacheOrder };
    return group;
  }

  function setXray(on) {
    if (!state.modelRoot || !state.currentCarId) return;
    state.xrayOn = !!on;
    if (state.xrayBtn) {
      state.xrayBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
      state.xrayBtn.classList.toggle('on', !!on);
    }
    // Radiograph scan sweep across the stage on every toggle.
    if (state.container && !prefersReducedMotion()) {
      state.container.classList.remove('scanning');
      void state.container.offsetWidth;
      state.container.classList.add('scanning');
    }
    if (on) {
      var g = buildXrayGroup(state.modelRoot, state.currentCarId);
      state.xrayGroup = g;
      if (g.parent !== state.scene) state.scene.add(g);
      g.visible = true;
      state.modelRoot.visible = false;
    } else {
      if (state.xrayGroup && state.xrayGroup.parent) {
        state.scene.remove(state.xrayGroup);
      }
      state.xrayGroup = null;
      state.modelRoot.visible = true;
    }
  }

  // Per-car reset: the previous machine's X-ray must never carry over.
  function resetXray() {
    if (state.xrayGroup && state.xrayGroup.parent) {
      state.scene.remove(state.xrayGroup);
    }
    state.xrayGroup = null;
    state.xrayOn = false;
    if (state.modelRoot) state.modelRoot.visible = true;
    if (state.xrayBtn) {
      state.xrayBtn.setAttribute('aria-pressed', 'false');
      state.xrayBtn.classList.remove('on');
      state.xrayBtn.hidden = false;
    }
  }

  // ---- parametric rear wing (v11) -------------------------------------------
  // The aero slider is no longer numbers-only: levels 1 to 4 bolt a real
  // carbon wing onto the 3D machine, growing in span, chord, height and
  // attack angle. Level 3+ gains a second element; endplates carry a
  // champagne hairline. Built from the model's own bounding box so it fits
  // every car; a per-car `nose` hint in cars.js ('+x','-x','+z','-z')
  // overrides the default orientation guess when a model needs it.

  function removeWing() {
    if (state.wingGroup && state.wingGroup.parent) {
      state.wingGroup.parent.remove(state.wingGroup);
    }
    state.wingGroup = null;
  }

  function setWing(level) {
    state.wingLevel = Math.max(0, Math.min(4, level | 0));
    rebuildWing();
  }

  function rebuildWing() {
    removeWing();
    var root = state.modelRoot;
    if (!root || root === state.placeholder || !state.wingLevel) return;
    try {
      var g = buildWingGroup(root, state.wingLevel,
        (state.currentCar && state.currentCar.nose) || null);
      if (g) {
        root.add(g);
        state.wingGroup = g;
        // A live x-ray must reflect the new silhouette: rebuild it.
        if (state.xrayOn && state.currentCarId) {
          delete state.xrayCache[state.currentCarId];
          setXray(true);
        } else if (state.currentCarId) {
          delete state.xrayCache[state.currentCarId];
        }
      }
    } catch (e) { /* the wing is decoration; never break the stage */ }
  }

  function buildWingGroup(root, level, noseHint) {
    // Measure the car in an unrotated frame so axes are the car's own.
    var oldRotY = root.rotation.y;
    root.rotation.y = 0;
    root.updateMatrixWorld(true);
    var box = new THREE.Box3().setFromObject(root);
    var size = new THREE.Vector3();
    var center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);

    var alongX = size.x >= size.z;
    var len = alongX ? size.x : size.z;
    var wid = alongX ? size.z : size.x;
    var hint = noseHint || (alongX ? '+x' : '+z');
    var axis = hint.charAt(1);                    // 'x' or 'z'
    var noseSign = hint.charAt(0) === '-' ? -1 : 1;

    // Wing dimensions in world units, scaled by level.
    var k = (level - 1) / 3;                      // 0 at level 1, 1 at level 4
    var span = wid * (0.74 + 0.14 * k);
    var chord = len * (0.075 + 0.035 * k);
    var thick = Math.max(0.012, size.y * 0.016);

    // Deck height measured from TAIL-ZONE meshes only: a raised butterfly
    // door or antenna mid-car would otherwise float the wing into the sky.
    var lenMin = (axis === 'x' ? box.min.x : box.min.z);
    var tailLo = noseSign > 0 ? lenMin : lenMin + len * 0.65;
    var tailHi = noseSign > 0 ? lenMin + len * 0.35 : lenMin + len;
    var deckY = box.min.y + size.y * 0.45;        // fallback: mid body
    var mBox = new THREE.Box3();
    root.traverse(function (obj) {
      if (!obj.isMesh || !obj.geometry) return;
      mBox.setFromObject(obj);
      if (mBox.isEmpty()) return;
      var c = axis === 'x'
        ? (mBox.min.x + mBox.max.x) * 0.5
        : (mBox.min.z + mBox.max.z) * 0.5;
      if (c >= tailLo && c <= tailHi && mBox.max.y > deckY &&
          mBox.max.y < box.min.y + size.y * 0.72) {
        // The 0.72 ceiling keeps raised butterfly doors, fins, and roll
        // hoops from hoisting the wing into the air.
        deckY = mBox.max.y;
      }
    });

    var planeY = deckY + size.y * (0.05 + 0.06 * k);
    var tailCoord = (axis === 'x' ? center.x : center.z) -
      noseSign * (len * 0.5 - chord * 0.62);

    var dark = new THREE.MeshStandardMaterial({
      color: 0x08080A, metalness: 0.4, roughness: 0.5
    });
    var hairline = new THREE.MeshBasicMaterial({ color: 0xE8D5A0 });

    var g = new THREE.Group();

    function place(mesh, alongCar, across, y) {
      // alongCar = coordinate on the length axis, across = on the width axis.
      if (axis === 'x') mesh.position.set(alongCar, y, across);
      else mesh.position.set(across, y, alongCar);
      g.add(mesh);
    }

    // Main plane (angle of attack grows with level). Box, then pitch it.
    var plane = new THREE.Mesh(
      new THREE.BoxGeometry(
        axis === 'x' ? chord : span, thick,
        axis === 'x' ? span : chord),
      dark);
    var attack = (0.10 + 0.06 * k) * (axis === 'x' ? -noseSign : noseSign);
    plane.rotation[axis === 'x' ? 'z' : 'x'] = attack;
    place(plane, tailCoord, 0, planeY);

    // Champagne trailing-edge hairline.
    var edge = new THREE.Mesh(
      new THREE.BoxGeometry(
        axis === 'x' ? chord * 0.08 : span * 0.99, thick * 1.15,
        axis === 'x' ? span * 0.99 : chord * 0.08),
      hairline);
    var trail = tailCoord - noseSign * chord * 0.46;
    edge.rotation[axis === 'x' ? 'z' : 'x'] = attack;
    place(edge, trail, 0, planeY);

    // Endplates.
    var epH = chord * (0.55 + 0.3 * k);
    for (var s = -1; s <= 1; s += 2) {
      var ep = new THREE.Mesh(
        new THREE.BoxGeometry(
          axis === 'x' ? chord * 1.05 : thick * 1.6, epH,
          axis === 'x' ? thick * 1.6 : chord * 1.05),
        dark);
      place(ep, tailCoord, s * span * 0.5, planeY + epH * 0.12);
    }

    // Swan-neck pylons down to the deck.
    var pylonH = Math.max(0.04, planeY - deckY + size.y * 0.03);
    for (var p = -1; p <= 1; p += 2) {
      var py = new THREE.Mesh(
        new THREE.BoxGeometry(
          axis === 'x' ? chord * 0.3 : thick * 1.3, pylonH,
          axis === 'x' ? thick * 1.3 : chord * 0.3),
        dark);
      place(py, tailCoord + noseSign * chord * 0.2, p * span * 0.28,
        planeY - pylonH * 0.5);
    }

    // Second element for levels 3 and 4: a smaller blade above the main.
    if (level >= 3) {
      var b2 = new THREE.Mesh(
        new THREE.BoxGeometry(
          axis === 'x' ? chord * 0.6 : span * 0.9, thick * 0.8,
          axis === 'x' ? span * 0.9 : chord * 0.6),
        dark);
      b2.rotation[axis === 'x' ? 'z' : 'x'] = attack * 1.5;
      place(b2, tailCoord - noseSign * chord * 0.5, 0, planeY + epH * 0.5);
    }

    // Convert the group from this unrotated-world frame into root-local
    // coordinates: local = (world - rootPos) / rootScale (rotation is 0).
    var s0 = root.scale.x || 1;
    g.children.forEach(function (m) {
      m.position.sub(root.position).divideScalar(s0);
      m.scale.divideScalar(s0);
    });

    root.rotation.y = oldRotY;
    root.updateMatrixWorld(true);
    return g;
  }

  // ---- offline model cache + realistic side profiles (v11) --------------------
  // The Duel and the Lab draw REAL renders of the machines instead of
  // cartoons: the actual GLB, painted the build's color, wearing the
  // build's wing, shot from a long-lens side camera onto transparency.

  function carEntryById(carId) {
    var cars = window.CARS || [];
    for (var i = 0; i < cars.length; i++) {
      if (cars[i].id === carId) return cars[i];
    }
    return null;
  }

  // Load a car's GLB into the cache WITHOUT touching the displayed model.
  function ensureModelCached(carEntry) {
    var hit = state.cache[carEntry.id];
    if (hit) {
      hit.order = ++state.cacheOrder;
      return Promise.resolve(hit.scene);
    }
    return new Promise(function (resolve) {
      try {
        var loader = new THREE.GLTFLoader();
        loader.load(resolveModelUrl(carEntry.file), function (gltf) {
          try {
            var root = gltf.scene || (gltf.scenes && gltf.scenes[0]);
            if (!root) { resolve(null); return; }
            prepareModel(root);
            state.cache[carEntry.id] = { scene: root, order: ++state.cacheOrder };
            pruneCache();
            resolve(root);
          } catch (e) { resolve(null); }
        }, undefined, function () { resolve(null); });
      } catch (e) { resolve(null); }
    });
  }

  // Viewer.captureProfileFor(cfg) -> Promise<{ url, noseLeft } | null>.
  // Requires the viewer to be mounted once (renderer + scene exist).
  function captureProfileFor(cfg) {
    if (!state.mounted || !THREE || !state.scene || !cfg || !cfg.carId) {
      return Promise.resolve(null);
    }
    var key = [cfg.carId, cfg.accent, cfg.wingLevel].join('|');
    var cached = state.profileCache[key];
    if (cached) return Promise.resolve(cached);

    var entry = carEntryById(cfg.carId);
    if (!entry) return Promise.resolve(null);

    return ensureModelCached(entry).then(function (root) {
      if (!root) return null;
      try {
        var renderer = getCaptureRenderer();
        if (!renderer) return null;

        // Stage the root for a deterministic side shot, remembering how to
        // put everything back (it may be the live displayed model).
        var prevParent = root.parent;
        var prevRot = root.rotation.y;
        var prevScale = root.scale.x;
        var prevPos = root.position.clone();
        var displayedHidden = null;
        if (state.modelRoot && state.modelRoot !== root && state.modelRoot.visible) {
          displayedHidden = state.modelRoot;
          displayedHidden.visible = false;
        }
        // The live stage wing must not pollute the measurement or double up
        // with the wing this capture builds for cfg. Detach, restore later.
        var liveWing = null;
        if (state.wingGroup && state.wingGroup.parent === root) {
          liveWing = state.wingGroup;
          root.remove(liveWing);
        }
        // Side profiles show the machine alone, not its display base.
        var podiumWasVisible = state.podium && state.podium.visible;
        if (state.podium) state.podium.visible = false;
        if (prevParent !== state.scene) state.scene.add(root);
        root.rotation.y = 0;

        // Normalize footprint exactly like frameAndStart.
        var box = new THREE.Box3().setFromObject(root);
        var size = new THREE.Vector3();
        box.getSize(size);
        var maxDim = Math.max(size.x, size.y, size.z) || 1;
        root.scale.setScalar(root.scale.x * (2.6 / maxDim));
        box.setFromObject(root);
        box.getSize(size);
        var measured = Math.max(size.x, size.y, size.z);
        if (measured > 0.001 && Math.abs(measured - 2.6) / 2.6 > 0.05) {
          root.scale.multiplyScalar(2.6 / measured);
          box.setFromObject(root);
          box.getSize(size);
        }
        var center = new THREE.Vector3();
        box.getCenter(center);

        // Paint for THIS build. The parametric wing stays a live-stage
        // feature: most GLBs model their own factory wing, and doubling
        // it in a flat profile reads as a glitch, not a modification.
        // The Duel's spec sheet carries the wing difference instead.
        paintBodyOf(root, cfg.accent);
        var wing = null;
        box.setFromObject(root);
        box.getSize(size);
        box.getCenter(center);

        // Long-lens side camera, perpendicular to the nose axis.
        var hint = entry.nose || (size.x >= size.z ? '+x' : '+z');
        var axis = hint.charAt(1);
        var cam = getCaptureCamera();
        cam.fov = 20;
        cam.aspect = 1000 / 420;
        // Fit the LENGTH of the car; height only weakly (an open butterfly
        // door would otherwise zoom the whole frame out and shrink the car).
        var horiz = axis === 'x' ? size.x : size.z;
        var tanV = Math.tan(cam.fov * Math.PI / 360);
        var fitW = (horiz * 0.5) / (tanV * cam.aspect);
        var fitH = (size.y * 0.5) / tanV;
        var dist = Math.max(fitW, fitH * 0.6) * 1.1;
        cam.near = Math.max(0.05, dist / 50);
        cam.far = dist * 10;
        if (axis === 'x') cam.position.set(center.x, center.y, center.z + dist);
        else cam.position.set(center.x + dist, center.y, center.z);
        cam.lookAt(center);
        cam.updateProjectionMatrix();

        renderer.setSize(1000, 420, false);
        renderer.setClearColor(0x000000, 0);
        renderer.render(state.scene, cam);
        var url = renderer.domElement.toDataURL('image/png');

        // In-image nose direction. Camera on +z looking -z: screen right is
        // world +x, so a '+x' nose points RIGHT. Camera on +x looking -x:
        // screen right is world -z, so a '+z' nose points LEFT.
        var noseLeft = axis === 'x'
          ? (hint === '-x')
          : (hint === '+z');

        // Restore the world, including the shared capture rig defaults so
        // captureSnapshot keeps its 800x450 f35 contract.
        if (wing) root.remove(wing);
        root.rotation.y = prevRot;
        root.scale.setScalar(prevScale);
        root.position.copy(prevPos);
        if (prevParent !== state.scene) {
          state.scene.remove(root);
          if (prevParent) prevParent.add(root);
        }
        if (displayedHidden) displayedHidden.visible = true;
        if (liveWing) root.add(liveWing);
        if (state.podium && podiumWasVisible) state.podium.visible = true;
        cam.fov = 35;
        cam.aspect = SNAP_W / SNAP_H;
        cam.updateProjectionMatrix();
        renderer.setSize(SNAP_W, SNAP_H, false);

        var out = { url: url, noseLeft: noseLeft };
        state.profileCache[key] = out;
        return out;
      } catch (e) {
        return null;
      }
    });
  }

  // ---- showroom podium (v15, authored in Blender) ---------------------------

  function ensurePodium() {
    if (state.podium || state.podiumLoading || !THREE || !state.scene) return;
    state.podiumLoading = true;
    try {
      var loader = new THREE.GLTFLoader();
      loader.load(resolveModelUrl('models/podium.glb'), function (gltf) {
        try {
          var root = gltf.scene || (gltf.scenes && gltf.scenes[0]);
          if (!root) return;
          root.traverse(function (obj) {
            if (obj.isMesh) obj.receiveShadow = true;
          });
          state.podium = root;
          state.scene.add(root);
        } catch (e) { /* the stage works fine without its podium */ }
      }, undefined, function () { state.podiumLoading = false; });
    } catch (e) { state.podiumLoading = false; }
  }

  // prefers-reduced-motion probe that never throws.
  function prefersReducedMotion() {
    try {
      return !!(window.matchMedia &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    } catch (e) {
      return false;
    }
  }

  // Ease in-out cubic.
  function easeInOutCubic(t) {
    return t < 0.5
      ? 4 * t * t * t
      : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  // Advance the camera intro sweep by dt seconds. Returns nothing; sets the
  // camera position/target along the eased path and clears the sweep (restoring
  // damping) when complete. A user drag clears state.sweep elsewhere, which
  // makes this a no-op and hands control over instantly.
  function stepSweep(dt) {
    var s = state.sweep;
    if (!s) return;
    s.t += dt;
    var raw = s.dur > 0 ? Math.min(1, s.t / s.dur) : 1;
    var k = easeInOutCubic(raw);
    state.camera.position.lerpVectors(s.fromPos, s.toPos, k);
    state.controls.target.lerpVectors(s.fromTarget, s.toTarget, k);
    if (raw >= 1) {
      // Land exactly on the beauty pose, then restore damping for the handoff.
      state.camera.position.copy(s.toPos);
      state.controls.target.copy(s.toTarget);
      state.sweep = null;
      state.controls.enableDamping = true;
    }
  }

  // ---- accent recolor -----------------------------------------------------

  // Viewer.setAccent(hex): best effort body recolor AND always tint the stage.
  // The stage tint is done by setting --accent on the mount so the CSS glow
  // responds even when the model recolor is skipped or the stage is down.
  // Finds the largest painted non glass material by surface area and tints it.
  // If uncertain, does nothing to the model. Never breaks rendering.
  function setAccent(hex) {
    // Always expose the accent to CSS, unconditionally, first.
    try {
      if (state.container && state.container.style) {
        state.container.style.setProperty('--accent', hex);
      }
    } catch (e) { /* ignore */ }

    try {
      if (!state.modelRoot || !THREE) return;
      paintBodyOf(state.modelRoot, hex);
    } catch (err) {
      // Intentionally swallowed: accent is best effort only.
    }
  }

  // Recolor the visually dominant paintable material of any model root.
  // Shared by the live viewer (setAccent) and offline profile captures.
  function paintBodyOf(root, hex) {
    try {
      if (!root || !THREE) return;
      var color = new THREE.Color(hex);

      // Accumulate surface area per material to find the body.
      var areaByMat = new Map();
      root.traverse(function (obj) {
        if (!obj.isMesh || !obj.material) return;
        var mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        var area = estimateArea(obj);
        for (var i = 0; i < mats.length; i++) {
          var m = mats[i];
          if (!m || !isPaintableMaterial(m)) continue;
          areaByMat.set(m, (areaByMat.get(m) || 0) + area / mats.length);
        }
      });
      if (areaByMat.size === 0) return;

      // Pick the largest paintable material.
      var best = null;
      var bestArea = -1;
      areaByMat.forEach(function (a, m) {
        if (a > bestArea) { bestArea = a; best = m; }
      });
      if (!best) return;

      // Stash the original once so re-tints stay clean.
      if (best.userData.__origColor === undefined && best.color) {
        best.userData.__origColor = best.color.clone();
      }
      if (best.color) {
        best.color.copy(color);
        best.needsUpdate = true;
      }
    } catch (err) {
      // Intentionally swallowed: accent is best effort only.
    }
  }

  function isPaintableMaterial(m) {
    // Skip obvious glass, transmissive, or fully transparent materials.
    if (m.transparent && m.opacity < 0.6) return false;
    if (typeof m.transmission === 'number' && m.transmission > 0.1) return false;
    if (!('color' in m)) return false;
    return true;
  }

  function estimateArea(mesh) {
    // Cheap proxy: bounding box surface area in world space.
    try {
      var g = mesh.geometry;
      if (!g) return 0;
      if (!g.boundingBox) g.computeBoundingBox();
      var s = new THREE.Vector3();
      g.boundingBox.getSize(s);
      var sc = mesh.scale;
      var x = s.x * sc.x, y = s.y * sc.y, z = s.z * sc.z;
      return 2 * (x * y + y * z + z * x);
    } catch (e) {
      return 0;
    }
  }

  // ---- placeholder --------------------------------------------------------

  // A dim gold wireframe box as an in scene fallback when a model fails.
  function makePlaceholder() {
    var group = new THREE.Group();
    var geo = new THREE.BoxGeometry(2.4, 0.9, 1.2);
    var edges = new THREE.EdgesGeometry(geo);
    var mat = new THREE.LineBasicMaterial({ color: 0xc9a84c });
    mat.transparent = true;
    mat.opacity = 0.55;
    var box = new THREE.LineSegments(edges, mat);
    box.position.y = 0.45;
    group.add(box);
    state.placeholder = group;
    // Frame it too.
    state.modelRoot = null;
    return group;
  }

  // A DOM level diagnostic used when the stage cannot start or a model cannot
  // load. States the actual reason in calm brand voice, sets data-reason on
  // the mount, and offers a hairline Retry button that reruns the failed step.
  function showDiagnostic(containerEl, reason, onRetry) {
    if (!containerEl) return;
    state.lastReason = reason;
    containerEl.classList.remove('loading');
    containerEl.setAttribute('data-reason', reason);

    // Replace any existing note so we never stack duplicates.
    var existing = containerEl.querySelector('.viewer-placeholder');
    if (existing) existing.remove();

    var note = document.createElement('div');
    note.className = 'viewer-placeholder';
    note.style.cssText = [
      'position:absolute', 'inset:0', 'display:flex',
      'flex-direction:column', 'gap:14px',
      'align-items:center', 'justify-content:center', 'text-align:center',
      'padding:24px', 'color:#C9A84C',
      'font-family:"Cormorant Garamond",serif', 'font-style:italic',
      'font-size:18px', 'pointer-events:none'
    ].join(';');

    var line = document.createElement('div');
    line.className = 'viewer-placeholder-line';
    line.textContent = reason;
    line.style.opacity = '0.78';
    note.appendChild(line);

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'viewer-retry';
    btn.textContent = 'Retry';
    btn.style.cssText = [
      'pointer-events:auto', 'cursor:pointer',
      'font-family:"Montserrat",system-ui,sans-serif',
      'font-size:11px', 'letter-spacing:0.16em', 'text-transform:uppercase',
      'color:#E8D5A0', 'background:transparent',
      'border:1px solid rgba(201,168,76,0.55)', 'border-radius:999px',
      'padding:7px 18px'
    ].join(';');
    btn.addEventListener('click', function () {
      // Remove the note and rerun the failed step.
      note.remove();
      containerEl.removeAttribute('data-reason');
      state.lastReason = null;
      setLoading(true);
      try {
        var r = onRetry && onRetry();
        if (r && typeof r.then === 'function') { r.catch(function () {}); }
      } catch (e) { /* diagnostics will reappear on failure */ }
    });
    note.appendChild(btn);

    containerEl.appendChild(note);
  }

  function clearDiagnostic(containerEl) {
    if (!containerEl) return;
    var existing = containerEl.querySelector('.viewer-placeholder');
    if (existing) existing.remove();
    containerEl.removeAttribute('data-reason');
    state.lastReason = null;
  }

  // ---- render loop --------------------------------------------------------

  function syncRunning() {
    var should = state.mounted && state.visible && state.docVisible;
    if (should && !state.running) {
      state.running = true;
      state.lastTime = performance.now();
      state.rafId = requestAnimationFrame(tick);
    } else if (!should && state.running) {
      state.running = false;
      if (state.rafId) cancelAnimationFrame(state.rafId);
      state.rafId = 0;
    }
  }

  function tick(now) {
    if (!state.running) return;
    var dt = Math.min(0.05, (now - state.lastTime) / 1000);
    state.lastTime = now;

    // Camera intro sweep first: it owns the camera until it lands on the
    // beauty pose, at which point autorotate takes over with no jump.
    stepSweep(dt);

    // Slow auto rotate around the framed center, paused while dragging and
    // held during the sweep so the reveal stays composed.
    if (state.modelRoot && !state.userInteracting && !state.sweep) {
      state.modelRoot.rotation.y += state.autoRotateSpeed * dt;
    }
    // The turntable turns with its machine.
    if (state.podium && state.modelRoot) {
      state.podium.rotation.y = state.modelRoot.rotation.y;
    }
    if (state.controls) state.controls.update();
    if (state.renderer && state.scene && state.camera) {
      state.renderer.render(state.scene, state.camera);
    }
    state.rafId = requestAnimationFrame(tick);
  }

  // ---- helpers ------------------------------------------------------------

  function sizeOf(el) {
    var r = el.getBoundingClientRect();
    var w = Math.max(1, Math.round(r.width) || el.clientWidth || 1);
    var h = Math.max(1, Math.round(r.height) || el.clientHeight || 1);
    return { w: w, h: h };
  }

  function aspectOf(el) {
    var s = sizeOf(el);
    return s.w / s.h;
  }

  function onResize() {
    if (!state.mounted || !state.container) return;
    var s = sizeOf(state.container);
    state.camera.aspect = s.w / s.h;
    state.camera.updateProjectionMatrix();
    state.renderer.setSize(s.w, s.h, false);
    // Render one frame so a resize while paused still looks right.
    if (!state.running && state.scene) {
      state.renderer.render(state.scene, state.camera);
    }
  }

  function setLoading(on) {
    if (!state.container) return;
    if (on) state.container.classList.add('loading');
    else state.container.classList.remove('loading');
    // A parse of a 15 MB machine can take many seconds: say so, elegantly,
    // instead of presenting an empty stage. The label is pure DOM so it
    // shows even while the GLTF parse blocks the render loop.
    var lbl = state.container.querySelector('.stage-assembling');
    if (on) {
      if (!lbl) {
        lbl = document.createElement('div');
        lbl.className = 'stage-assembling';
        lbl.setAttribute('aria-hidden', 'true');
        // A spinning forged wheel (Blender EEVEE turntable, 32-frame sprite)
        // crowns the loader — a real machined part turning while the machine
        // assembles, above the ASSEMBLING rule.
        lbl.innerHTML = '<span class="sa-wheel" aria-hidden="true"></span>' +
          '<span class="sa-row"><span class="sa-line"></span>' +
          '<span class="sa-text">ASSEMBLING</span>' +
          '<span class="sa-line"></span></span>';
        state.container.appendChild(lbl);
      }
    } else if (lbl) {
      lbl.remove();
    }
  }

  // Dispose GPU resources of the least recently used cached models beyond the
  // cap so memory does not grow without bound.
  function pruneCache() {
    var ids = Object.keys(state.cache);
    if (ids.length <= MAX_CACHE) return;
    ids.sort(function (a, b) {
      return state.cache[a].order - state.cache[b].order;
    });
    while (ids.length > MAX_CACHE) {
      var id = ids.shift();
      if (id === state.currentCarId) continue; // never drop the live model
      var entry = state.cache[id];
      if (entry) {
        disposeScene(entry.scene);
        delete state.cache[id];
      }
    }
  }

  function disposeScene(root) {
    if (!root) return;
    root.traverse(function (obj) {
      if (obj.isMesh) {
        if (obj.geometry) obj.geometry.dispose();
        var mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (var i = 0; i < mats.length; i++) {
          var m = mats[i];
          if (!m) continue;
          for (var k in m) {
            var v = m[k];
            if (v && v.isTexture) v.dispose();
          }
          if (m.dispose) m.dispose();
        }
      }
    });
  }

  // ---- snapshot -----------------------------------------------------------

  // Viewer.captureSnapshot(): render ONE beauty frame of the currently loaded
  // model to a transparent 800x450 PNG and return it as a dataURL string.
  // Returns null on ANY failure and never throws. Uses a dedicated offscreen
  // renderer (alpha + preserveDrawingBuffer) created lazily and reused, so the
  // live renderer and its state are never touched. The same scene is rendered
  // with a cloned camera from a fixed three-quarter pose; the scene background
  // is temporarily nulled and restored, keeping the soft ground contact shadow
  // (which is a transparent radial gradient plane, so it reads fine against
  // alpha) and all studio lights.
  function captureSnapshot() {
    try {
      // Only valid when a real model is loaded and framed. The placeholder
      // wireframe is not a model, so refuse it.
      if (!state.mounted || !THREE || !state.scene) return null;
      if (!state.modelRoot || state.placeholder === state.modelRoot) return null;
      if (!state.frameCenter) return null;

      var renderer = getCaptureRenderer();
      if (!renderer) return null;

      var cam = getCaptureCamera();
      if (!cam) return null;

      // Fixed three-quarter beauty pose. Azimuth ~30deg from front, elevation
      // ~12deg, framed with the same fit logic plus a little extra margin.
      var center = state.frameCenter;
      var radius = state.frameRadius || 1;
      var fov = cam.fov * Math.PI / 180;
      var dist = radius / Math.sin(fov / 2) * 1.15; // slightly more margin

      var az = 30 * Math.PI / 180;   // from front (+z), swung toward +x
      var el = 12 * Math.PI / 180;   // above the horizon
      var dir = new THREE.Vector3(
        Math.sin(az) * Math.cos(el),
        Math.sin(el),
        Math.cos(az) * Math.cos(el)
      ).normalize();

      cam.aspect = SNAP_W / SNAP_H;
      cam.near = Math.max(0.05, dist / 100);
      cam.far = dist * 20;
      cam.position.copy(center).addScaledVector(dir, dist);
      cam.up.set(0, 1, 0);
      cam.lookAt(center);
      cam.updateProjectionMatrix();

      // Temporarily drop the scene background so the PNG is transparent.
      var prevBg = state.scene.background;
      state.scene.background = null;

      var dataUrl = null;
      try {
        renderer.setSize(SNAP_W, SNAP_H, false);
        renderer.render(state.scene, cam);
        dataUrl = renderer.domElement.toDataURL('image/png');
      } finally {
        // Always restore the live scene background no matter what happened.
        state.scene.background = prevBg;
      }

      // The offscreen render does not touch the live renderer, camera, or
      // controls, so nothing needs restoring there. Nudge one live frame so
      // the visible canvas is guaranteed current (harmless if already running).
      if (state.renderer && state.camera && !state.running) {
        try { state.renderer.render(state.scene, state.camera); } catch (e) {}
      }

      return (typeof dataUrl === 'string' && dataUrl.indexOf('data:image/png') === 0)
        ? dataUrl : null;
    } catch (err) {
      // Never throw: any failure yields null.
      return null;
    }
  }

  // Lazily create the single reusable capture renderer. It mirrors the live
  // renderer's colour and tone-mapping setup so snapshots match the stage.
  function getCaptureRenderer() {
    if (state.captureRenderer) return state.captureRenderer;
    try {
      var r = new THREE.WebGLRenderer({
        alpha: true,
        antialias: true,
        preserveDrawingBuffer: true,
        powerPreference: 'high-performance'
      });
      r.setPixelRatio(1); // fixed output size, no DPR scaling needed
      r.setSize(SNAP_W, SNAP_H, false);
      r.setClearColor(0x000000, 0); // fully transparent
      r.toneMapping = THREE.ACESFilmicToneMapping;
      // Match the live renderer's exposure so snapshots read the same as the
      // stage (raised to 1.28 when the PMREM environment is active).
      r.toneMappingExposure = state.envTexture ? 1.28 : 1.15;
      if ('outputEncoding' in r && THREE.sRGBEncoding !== undefined) {
        r.outputEncoding = THREE.sRGBEncoding;
      }
      r.shadowMap.enabled = true;
      r.shadowMap.type = THREE.PCFSoftShadowMap;
      state.captureRenderer = r;
      return r;
    } catch (e) {
      return null;
    }
  }

  function getCaptureCamera() {
    if (state.captureCamera) return state.captureCamera;
    try {
      state.captureCamera = new THREE.PerspectiveCamera(
        35, SNAP_W / SNAP_H, 0.1, 1000);
      return state.captureCamera;
    } catch (e) {
      return null;
    }
  }

  // ---- public API ---------------------------------------------------------

  window.Viewer = {
    mount: mount,
    show: show,
    setAccent: setAccent,
    setWing: setWing,
    captureProfileFor: captureProfileFor,
    captureSnapshot: captureSnapshot,
    // Small hook for the app or tests to nudge the run state after a tab
    // switch, without depending on IntersectionObserver timing.
    setActive: function (active) {
      state.visible = !!active;
      syncRunning();
    },
    // Exposed for the verification harness only. Not part of the app contract.
    // Advances the scene deterministically by dt seconds and renders one
    // frame, so hidden tabs (throttled rAF) can still be proven visually.
    __renderOnce: function (dt) {
      try {
        stepSweep(typeof dt === 'number' ? dt : 0.016);
        if (state.controls) state.controls.update();
        if (state.renderer && state.scene && state.camera) {
          state.renderer.render(state.scene, state.camera);
        }
        return true;
      } catch (e) {
        return String(e);
      }
    },
    __debug: function () {
      return {
        mounted: state.mounted,
        hasRenderer: !!state.renderer,
        sceneChildren: state.scene ? state.scene.children.length : 0,
        modelPresent: !!state.modelRoot,
        frameRadius: state.frameRadius,
        cacheIds: Object.keys(state.cache),
        running: state.running,
        reason: state.lastReason,
        lastLoadError: state.lastLoadError || null,
        renderedFrames: state.renderer && state.renderer.info
          ? state.renderer.info.render.frame : -1,
        drawCalls: state.renderer && state.renderer.info
          ? state.renderer.info.render.calls : -1,
        cameraPos: state.camera
          ? [state.camera.position.x, state.camera.position.y,
             state.camera.position.z].map(function (v) {
               return Math.round(v * 100) / 100;
             })
          : null,
        modelVisible: state.modelRoot ? state.modelRoot.visible : null,
        modelScale: state.modelRoot
          ? Math.round(state.modelRoot.scale.x * 10000) / 10000 : null,
        sweepActive: !!state.sweep,
        threeRevision: THREE ? THREE.REVISION : null
      };
    }
  };
})();
