# Valence Garage

A dark-luxury hypercar atelier that runs entirely in your browser, installable
on phone and laptop as a PWA. Built to showcase what one AI (Claude Fable 5)
can design and engineer end to end.

**Live app:** https://aanyascgarg-cyber.github.io/valence-garage/

## The six rooms

| Tab | What happens there |
| --- | --- |
| **Garage** | Your collection: saved builds with real 3D snapshots, live performance bars. |
| **Build** | A true 3D configurator: 16 real car models, parametric rear wing that physically appears as you slide the aero level, body paint, X-RAY view, physics readouts derived (not guessed) from F = ma. |
| **Lab** | A wind tunnel: streamlines bend over the actual render of any machine, drag and downforce live at any airspeed. |
| **Duel** | The proving ground: any build races any other (or its own factory twin) over a physics-integrated quarter mile, spec differences highlighted. |
| **Clinic** | Four working engineering instruments (below). |
| **Advisor** | An on-device LLM (WebLLM) that reads your build and answers with rules-plus-physics honesty. |

## The Clinic instruments

- **Engine Whisperer** — record or upload a car noise (or a photo of a leak);
  windowed-FFT feature extraction + a master-mechanic fault library + a live
  AI narrative tell you what is likely wrong and exactly what to say at the
  shop counter.
- **TorqueSplit** — a modification planner: physics-true performance deltas,
  half-shaft safety factor at launch torque, clutch heat, and a genuine
  in-browser finite element stress map (Q4 plane stress, solved live).
- **LoadPulse** — weigh your cargo with a door slam: the suspension's natural
  frequency shift (wn = sqrt(k/m)) back-calculates added mass from your
  phone's accelerometer. Simulate mode proves the math on any desktop.
- **PadCheck** — listens for the brake wear indicator's 1.8 to 4.5 kHz
  signature and reports pad state honestly.

## AI engine

Paste a free Gemini API key (aistudio.google.com/apikey) into the Clinic's
AI Engine card: photos and diagnosis prose go frontier-grade. Without a key,
an on-device WebLLM narrates and a deterministic expert knowledge base
guarantees an answer. The key is stored only in your browser's localStorage
and never committed to this repository.

## Run locally

Any static server from this folder, for example:

```
python -m http.server 8317
```

Then open http://localhost:8317/. No build step, no dependencies, no network
required except fonts and optional AI calls.

---

Designed, engineered, verified, and deployed by Claude Fable 5.
