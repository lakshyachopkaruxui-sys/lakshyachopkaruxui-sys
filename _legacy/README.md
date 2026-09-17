# Tear

*I am physically tearing open reality, and another world is leaking through.*

A browser-based WebXR experience built around one mechanic: you pinch a seam in
the world with both hands and physically pull it apart. The material resists,
strains, and tears like wet paper. Light and sound spill through. Let go, and
it slowly heals shut — reality only stays open while you're actively holding
it open.

Three nested worlds, each torn open from the last: a dim, quiet room → a
living forest → an impossible, gravity-defying void → and back, changed, to
where you started.

Built with [Three.js](https://threejs.org/) and the native
[WebXR Device API](https://www.w3.org/TR/webxr/) (hand tracking via the
[WebXR Hand Input module](https://www.w3.org/TR/webxr-hand-input-1/)).
No game engine, no external audio or 3D model files — every sound and every
material is generated procedurally at runtime.

---

## Quick start

```bash
npm install
npm run dev
```

This starts a Vite dev server at `https://localhost:5173` (self-signed
HTTPS — see [Headset testing](#headset-testing-on-a-quest) below for why).
Open it in any modern desktop browser to try the
[desktop fallback controls](#desktop-fallback-controls); open it on a Quest
headset for the real hand-tracking experience.

```bash
npm run build      # production build → dist/
npm run preview    # serve the production build locally
```

## Requirements

- **Node.js 20+** and npm (this project was built and verified against
  Node v24.19.0 / npm 11.17.0).
- A **Chromium-based browser** for real WebXR hand-tracking testing — see
  [Browser support](#browser-support).
- A **Meta Quest 3** (the target device this project was tuned for — see
  [Performance notes](#performance-notes)) or another WebXR headset with
  hand tracking, for the intended experience. Quest 2/Pro should also work
  but weren't specifically profiled.

---

## The interaction

**Both hands, always.** You find a seam — a faint crack in a wall — walk up
to it, pinch it between a thumb and index finger on *each* hand, and pull.
The distance between your two pinch points controls how far it opens; how
fast you pull controls how violent the tear looks and sounds. Let go of
either pinch, or step back, and it heals shut over a couple of seconds.

This is deliberately impossible to do with a mouse in a way that feels the
same. A single pointer can't represent "two independent points in 3D space
that must each be held closed by a precise pinch, while their *separation*
is the actual control input." The moment your own two hands are the input
device, the metaphor becomes literal instead of implied — you're not
clicking a button labeled "open," you're doing the thing the character in
the world is doing. That gap between "operating a control" and "performing
the action" is the whole reason this belongs in XR rather than on a webpage.

Two other things only work because it's XR, not a flat screen:

- **Spatial audio + head-lean.** Sound leaking through a tear is positioned
  exactly at the opening (`THREE.PositionalAudio`) with real distance
  falloff. Leaning your head toward it or stepping around it changes what
  you hear the way it would in physical space — not because of a hover
  event, because your head actually moved relative to a sound source that
  actually exists in 3D.
- **Real parallax through the hole.** What's visible through the tear is
  real geometry sitting behind it, not a flat image or a pre-rendered
  panorama. Moving your head changes the parallax correctly, for free,
  because it's an actual hole in an actual mesh — see
  [Portal rendering strategy](#portal-rendering-strategy) below.

## Desktop fallback controls

There is no headset in front of you when developing or reviewing on a
laptop, so a keyboard/mouse simulation of two hands exists — **purely as a
fallback for understanding the concept**, not a redesign of it. An
unobtrusive hint is shown on-screen for the first several seconds.

| Input | Effect |
|---|---|
| Mouse move | Right hand position |
| Mouse wheel | Right hand depth (push/pull) |
| Hold left mouse button | Right hand pinch |
| `W` `A` `S` `D` | Left hand position |
| `Q` / `E` | Left hand depth |
| `Space` (hold) | Left hand pinch |
| `←` `→` | Look (yaw only — no pitch, a deliberate simplification) |
| `↑` `↓` | Walk forward/back (so you can actually approach a seam — see note below) |

**Why walking exists only on desktop:** a real VR user reaches a seam by
physically walking a couple of steps in their room — no artificial
locomotion needed or wanted (the brief explicitly asks to avoid it, for
comfort). A desktop reviewer has no physical room to walk in, so arrow-key
walking stands in for that one real-world affordance. It is the *only*
locomotion in the entire project; XR mode never uses it.

---

## Headset testing (on a Quest)

WebXR requires a [secure context](https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts) —
`localhost` HTTP is fine on the same machine, but a headset connecting to
your PC over the network needs real HTTPS, even for local development.
`npm run dev` handles this automatically via
[`@vitejs/plugin-basic-ssl`](https://github.com/vitejs/vite-plugin-basic-ssl),
which generates a self-signed certificate.

1. `npm run dev`, note the printed **Network** URL
   (`https://<your-PC's-LAN-IP>:5173`).
2. Put the Quest on the **same Wi-Fi network** as your PC.
3. Open that URL in the Quest Browser (Meta's Chromium-based browser).
4. Accept the certificate warning (**Advanced → Proceed** or similar) — this
   is expected for a self-signed cert and only needs doing once per
   session/cert.
5. In the Quest's system settings, confirm **Settings → Device → Hands and
   Controllers → Auto Enable Hands or Controllers** is on, so the system
   switches to hand tracking when you put your controllers down.
6. Click **Enter VR**, then physically bring your hands up and pinch.

If you'd rather not deal with a self-signed cert warning, run
`npm run build && npm run preview -- --host` and deploy the `dist/` output
to any static HTTPS host (Vercel, Netlify, GitHub Pages, …) — the app
itself doesn't need a server, just static files over HTTPS.

## Browser support

WebXR **hand tracking** is, as of this writing, a Meta Quest Browser /
Chromium-on-Android feature — it is **not** broadly supported across
desktop browsers, and desktop Chrome/Edge/Firefox will not expose real hand
joints even if they expose `navigator.xr`. This project detects support at
runtime (`XRSessionManager.isImmersiveVRSupported`, and the official
`VRButton` addon's own "VR NOT SUPPORTED" fallback) and never assumes a
capability it hasn't checked for. On an unsupported browser/device, the
desktop fallback still runs the whole experience.

---

## Architecture

```
src/
  app/         App.js — renderer/scene/camera bootstrap, main tick loop
  xr/          XRSessionManager, FadeOverlay (transition fade), HapticsSystem
  interaction/ HandTrackingSystem, DesktopFallbackController, PinchDetector,
               TwoHandTearController (the core two-hand math)
  tear/        TearPhysics, TearGeometry, TearMaterial, TearEdgeGeometry/
               Material, TearVeil (composes them), SeamHint, organicBoundary
  lighting/    LightLeakSystem
  particles/   ParticleManager
  audio/       SpatialAudioManager, TearAudioVoice, AmbienceVoice
  worlds/      WorldManager, WorldOne/Two/Three, WorldOneEcho,
               CreatureReactionSystem, worldConstants
  state/       InteractionState (explicit state machine)
  debug/       DebugOverlay (F2)
  utils/       math, KeyState, proceduralTextures, audioSynthesis
  config/      config.js — every tunable value in the project, in one place
```

### Portal rendering strategy

The brief asks specifically to investigate a **stencil-buffer** portal
(mask geometry writes the stencil, portal content renders where it's equal
to a reference value) and explains why: it's the standard, well-documented
technique. I investigated it and chose a different one — a **literal
geometric hole** — and want to be explicit about the trade-off rather than
just picking silently:

- **Stencil approach**: keep the wall as simple static geometry, use a
  separate mask shape to punch a stencil hole, render "what's behind" as
  a second pass gated on that stencil. Well-trodden, but it needs careful
  manual depth-buffer bookkeeping (typically an explicit `clearDepth()`
  between passes so the portal content isn't occluded by the wall's own
  depth), and needs to be re-verified against WebXR's stereo rendering
  path, which I have no physical headset available to profile.
- **Geometric hole (chosen)**: `TearGeometry` builds the wall as a
  `THREE.Shape` with the irregular tear polygon subtracted as a literal
  `Shape.holes` cutout (`THREE.ShapeGeometry`, triangulated via `earcut`
  internally, [verified against the three.js source](https://github.com/mrdoob/three.js/blob/master/src/geometries/ShapeGeometry.js)).
  Whatever's positioned behind the hole in the same coordinate space is
  simply visible through it, with **correct depth-tested parallax for
  free** — no extra render pass, no stencil bookkeeping, and no
  stereo-rendering edge case to get wrong, because it's just normal scene
  geometry.

The reasoning that tipped it: the tear's boundary is already an irregular,
continuously-deforming polygon that `organicBoundary.js` has to compute
every frame *anyway*, for the visual edges/fibres. Reusing that exact same
polygon to cut the hole is not extra work — it's the same data driving
both, and it's the more robust choice given I could only verify it in a
desktop browser, not on real XR stereo rendering.

One consequence: worlds aren't scattered arbitrarily in the scene — each
world's content is built directly behind the wall that reveals it, along
one shared Z-axis (see `worlds/worldConstants.js`). "Traveling" between
worlds is a comfortable fade-to-black cut (`FadeOverlay` + `WorldManager`)
that repositions the player rig, not a walk through unbuilt space.

### Two-hand tear math (`TwoHandTearController`)

Each frame: both hand positions are projected into the tear wall's local
2D plane (`Object3D.worldToLocal`). If both are within ~0.5m of the plane,
within a capture radius of the current opening, **and** both pinching, the
tear is "engaged." While engaged, `openAmount` is a *ratchet* toward
`gapDistance / maxGap` — it only grows, never shrinks from moving hands
closer, because torn wet paper doesn't un-tear when you relax your grip.
The only way to close it is to genuinely stop holding it, which starts
`TearPhysics`'s healing curve (a short suspended pause, then an
accelerating close). Direction (which way the tear elongates) blends
toward the current hand-to-hand angle; "energy" comes from hand velocity
and drives particle density, audio violence, and the pull/hold state
distinction. All tunables for this live in `config/config.js`.

### Interaction states

An explicit state machine (`state/InteractionState.js`) — `idle` →
`one-hand-detected` → `both-hands-detected` → `pinching` → `pulling` /
`holding` → `healing` → `fully-open` → `transitioning` →
`world-discovered` — rather than scattered booleans, per the brief.
Every loaded world keeps its **own** `TwoHandTearController` ticking every
frame (so a tear you've walked away from keeps healing on its own, with no
special-casing needed), but only the world the player can currently reach
is allowed to write into the *shared* `InteractionState` — see the comment
in `WorldManager.js` for the bug this fixes (an idle, just-loaded world's
controller silently overwriting the real one's state).

### Audio (fully procedural, no files)

Every sound in the project — tear tension, world "leak" whoosh, healing/
release, breakthrough stinger, forest wind, otherworldly drone — is
synthesized live with the Web Audio API: filtered white noise
(`createNoiseBuffer` + `BiquadFilterNode`) and detuned oscillators, no
recorded audio anywhere. Positioning uses `THREE.PositionalAudio`
(verified against the [three.js `Audio` source](https://github.com/mrdoob/three.js/blob/master/src/audio/Audio.js)
for the `setNodeSource()` API used to feed a custom Web Audio graph in
instead of a static buffer).

### Haptics

`HapticsSystem` fires a short pulse on tear-begin, near-breakthrough, and
breakthrough — but **only when a physical XR controller is in use**. This
is a hard platform limit, not a missing feature: bare-hand WebXR tracking
has no vibration hardware at all (there's nothing to buzz). Haptics only
exist on `XRInputSource.gamepad.hapticActuators`, which only a tracked
controller provides. Since hand tracking is this project's primary and
intended input (controllers are explicitly a fallback per the brief), the
haptics system is a correct, honest no-op for the normal way this
experience is meant to be played.

---

## Asset strategy

**Nothing is loaded from a file.** All geometry is procedural (primitives,
`InstancedMesh` for repeated trees/debris, dynamically-triangulated
`ShapeGeometry` for the tear), all textures are generated at runtime onto
an offscreen `<canvas>` (paper grain, torn-fibre fringe, the pre-interaction
crack hint, soft particle dots), and all audio is synthesized (see above).
This was a deliberate choice up front — see the project's Q&A at the start
of this build — to keep zero licensing risk and zero blocked-on-asset-
availability risk. `public/` exists and is empty; it's there if real glTF/
GLB models or audio files are ever added later (the brief's preferred
formats), but nothing currently depends on it.

## Performance notes

- Renderer requests `stencil: true` (kept available even though the
  current portal technique doesn't use it — see above) and caps
  `devicePixelRatio` at `1.5` (`config.render.pixelRatioCap`).
- `TearGeometry`/`TearEdgeGeometry` rebuild a small (~90-vertex) mesh every
  frame the tear is open rather than mutating a persistent buffer in
  place — cheap on desktop, but **not verified on real Quest 3 hardware**
  (no headset was available during development to profile against). If
  on-device profiling shows GC/frame-time pressure from this, the
  documented fix is in `TearGeometry.js`'s header comment.
- Trees, debris, and other repeated geometry use `THREE.InstancedMesh`.
- Everything is genuinely tested and working in a **desktop Chromium
  browser only**. The full interaction loop, all three worlds, the
  transition/healing/audio/particle systems were verified end-to-end via
  scripted input in that environment (see the DebugOverlay for live
  numbers). **Real Quest 3 hand-tracking, comfort, and frame-rate have not
  been tested on physical hardware** — say so plainly rather than
  claiming otherwise. If you test on-device and something needs tuning,
  `config/config.js` is the place to start.

## Debug mode

Press **F2** to toggle a small on-screen HUD (FPS, current interaction
state, which world is active/loaded, live tear signal values). Off by
default (`config.debug.defaultEnabled`). It's a plain DOM overlay, so it
won't appear inside the XR headset view itself — it's a desktop
development aid.

## Known limitations / honest gaps

- No real headset testing was possible in this development environment —
  see [Performance notes](#performance-notes).
- World Three's "impossible geometry" and the final World-One-echo loop
  are implemented and verified functionally (see the scripted end-to-end
  test in development history) but are visually simpler than Worlds One
  and Two, in line with the brief's own priority order ("prioritize polish
  over quantity" / tear quality and portal depth first).
- The production bundle is ~625KB minified (~160KB gzipped), essentially
  all Three.js itself; no code-splitting was added since this is a single-
  scene experience with no route boundaries to split along.
- Only one `THREE.Fog` is shared across all three worlds (rather than a
  per-world fog swap) — a simplification, since all three palettes still
  read clearly against one dark fog color.

## Design rationale (short form)

- **Two hands, not one pointer** — the separation *is* the control input;
  no mouse gesture reproduces "two independently-held pinches whose
  distance apart matters."
- **Spatial audio + head-lean** — sound is positioned where the thing
  making it actually is; leaning in for detail is a real physical act,
  not a hover state.
- **Healing on release** — makes the opening a held effort rather than a
  toggle, so the world feels like it's actively resisting being kept open.
- **Nested worlds** — each tear is a bigger reward than the last (dim room
  → living forest → impossible void → home, changed), giving the piece a
  three-act shape instead of one static gimmick.
- **Real geometry behind every tear** — no portal is a flat image; the
  parallax is real because the content behind the hole is real, which is
  only meaningfully checkable by actually moving your head — i.e., only in
  XR.
