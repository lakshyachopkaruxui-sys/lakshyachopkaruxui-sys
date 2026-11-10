# Tear

Latest forest revision, 17 October: [Movement performance follow-up](docs/FOREST_MOVEMENT_PERFORMANCE.md) preserves all 128,761 permanent grass plants and their photographic textures. Cached accent patches eliminate repeated movement uploads, precomputed wind preserves the original waves, distant cards change shape continuously, and grass draws before hidden soil shading. The [earlier optimization](docs/FOREST_PERFORMANCE.md) and [brighter daylight revision](docs/FOREST_DAYLIGHT_NATURAL_GRASS.md) remain documented. The former path stays planted and the arrow remains removed. Actual browser/headset frame rates remain unverified; the Quest Browser URL must be checked against the updated build. The [continuous-cover correction](docs/FOREST_WORLD_ROLLOUT.md), [approved sample](docs/FOREST_GROUND_SAMPLE.md), preceding [ground and tree alignment](docs/FOREST_REFERENCE_INTEGRATION.md) and [earlier research](docs/FOREST_QUALITY_REVIEW.md) remain recorded; existing ZIP releases predate these revisions.

For this complete package, start with [START_HERE.md](START_HERE.md), [deployment instructions](DEPLOYMENT.md) and the [complete project handoff](docs/TEAR_COMPLETE_HANDOFF.md).

An immersive journey for **Meta Quest 3S** and desktop. Pinch a seam in the air,
pull it open, and cross **room → ocean → shadow → forest → room**.

This revised prototype includes five-part natural male narration with a quiet room reflection, visible fingertip help controls,
environment responses, and strengthened XR startup/return rendering. The
research and current validation are recorded in [the handoff](docs/IMPLEMENTATION_HANDOFF.md).
The current [environment, movement and voice rebuild](docs/REALISM_REBUILD.md) uses photographed conifers, a textured moving deer herd, animated horror characters, obstacle collisions and natural-pitch narration.
The [exact Unity forest and lake](docs/UNITY_TERRAIN_IMPORT.md) remain pending package acquisition; the current browser forest is a separate scene.
It is not a Behance case-study layout.

## Two ways to enter

- **Enter headset:** open the site in Quest Browser on the Quest 3S. The first
  environment is the actual room or classroom around the wearer, shown through
  live passthrough. The seam, instruction cues and tracked hand visuals are
  digital. After crossing, the ocean, shadow and forest worlds completely cover the
  real surroundings. The app never silently substitutes a virtual room for this
  headset opening.
- **Desktop preview:** begin in a furnished, walkable virtual room, then cross
  the same tear into the same ocean, shadow and forest worlds. No webcam permission is
  needed.

Touch-only phones can open the entry and headset help, but do not have playable
touch controls. Desktop preview requires a mouse and keyboard.

These two choices share one opening page. On a laptop without supported
passthrough, Enter headset explains how to open the site in Quest Browser and
cast to the laptop. It cannot remotely start a standalone headset session.

## The four worlds

| World | Description |
|---|---|
| The World of Stillness | The quiet room where reality first begins to crack. |
| The World of Drowned Dreams | An underwater world where marine animals move through a beautiful, silent mystery. |
| The World of the Watching Shadow | A dark and unsettling world where something is always observing you. |
| The World of Golden Growth | A glowing forest filled with life, warmth, and discovery. |
| Back to Stillness | Return through the forest's tear to the same room. |

The ocean comes first, the shadow follows, and the forest provides the final
contrast before returning to Stillness. Chapter names match on desktop and Quest.
The return
tear reveals the original room: real passthrough on Quest, or the same furnished
virtual room in desktop preview. The shadow creatures patrol the woodland and watch the visitor. They do not force the camera or trigger a jump sound.

## Preview on Windows

Extract the project, then double-click **PREVIEW_DESKTOP.cmd**. It installs the
project dependencies when needed and opens the local desktop preview. Keep the
terminal window open while exploring. Node.js 24 is recommended.

Or use a terminal:

```bash
npm ci --ignore-scripts
npm run dev:http -- --host 127.0.0.1 --open
```

After adding new files under `public/`, restart the development server. Asset
folders are excluded from file watching to avoid OneDrive write-lock errors;
Vite can otherwise return the entry HTML for a newly added asset path.

## Use the headset

Use the published HTTPS link in Quest Browser, enable hand tracking, put down
the controllers and choose **Enter headset**. Pinch with both hands and pull
apart with relaxed elbows. Hold a fully open tear steady to cross; release to
let it heal. Bringing both pinches together in empty space places a new seam.

If a system menu interrupts you, open your fingers after returning, then pinch
again. The experience pauses while the menu has focus.

For local development, run `npm run dev` and open the computer's HTTPS network
address on the Quest on the same Wi-Fi. WebXR requires a secure context. Use a
trusted HTTPS deployment if the browser does not accept a development certificate.
A localhost address refers to the device opening it; it is not the computer's
address when entered on the Quest.

The headset entry requests an alpha-blend `immersive-ar` session with tracked
hands. It stays in that session for an uninterrupted transition. The later worlds
are visually fully virtual: after rendering each eye, an alpha-only pass forces
opaque output while preserving its colours. The AR opening skips that pass.
In the final world, only the open return tear becomes transparent; crossing
restores full passthrough in the same XR session.
No room scanning, real-furniture occlusion or persistent anchors are required.

## Let other people watch

For standalone Quest 3S, open [Meta casting](https://horizon.meta.com/casting) on
the laptop, use the same Meta account and Wi-Fi, then select Quick controls →
Cast → Web → Computer in the headset. Rehearse the real-room opening as well as
the virtual worlds. Opening Tear separately on the laptop creates another
instance; it does not mirror the headset automatically.

The source retains the PC VR spectator utility for explicit developer VR
sessions. The normal two-button experience uses passthrough on the headset and
Meta casting for observers. The app canvas alone does not contain the complete
real-room passthrough image.

## Desktop controls

| Input | Action |
|---|---|
| Click, then mouse | Look around; drag-to-look is available if pointer lock is refused |
| W A S D / arrows | Walk; Shift moves faster |
| F | Grip the seam, or release it |
| D / right arrow while gripping | Pull apart; Shift increases pull speed |
| A / left arrow while gripping | Ease back |
| W S / Q E while gripping | Adjust the grip vertically / in depth |
| Space | Jump, or cross when the tear is wide enough |
| T | Place a new tear ahead |
| R | Release and let the tear heal |
| H | Recall field notes for 20 seconds, or close them early |
| N | Toggle spoken narration; captions remain available |
| V | Replay the current world's narration |
| Esc | Free the mouse |

World headings are large italic Georgia; spatial instructions and keycaps use
that same serif family, with upright instruction text for readability. A small
spatial cue guides the first attempt, then idle movement/help hints fade after
20 seconds in every world. Grip, pull, healing and crossing cues remain contextual.

Press **H** on desktop to recall field notes. In the headset, hold either live
index fingertip inside the visible **Field notes** circle until its ring fills.
Move the finger away before repeating. While notes are open, nearby voice and
replay circles control narration. Notes fade after 20 seconds and close during
tearing. Targets stay anchored where placed and return to a reachable location
when a new seam is placed. Reach and tracking reliability need physical testing.

The five narration clips use Kokoro's natural male voice at its original pitch, with story copy grounded in the brief's theme of limited perspective. The mix has no bass boost or repeat echoes and a quiet 0.55-second room reflection. Captions remain visible with voice disabled.
See the [narration plan and complete script](docs/NARRATION_PLAN.md). Headphone/headset listening is still needed to approve the mix.

## Validation

```bash
npm run typecheck
npm test
npm run test:interaction
npm run test:xr-rendering
npm run test:xr-hands
npm run test:entry
npm run test:guide
npm run test:xr-help
npm run test:environments
npm run test:world-alignment
npm run test:sky-flock
npm run test:world-three-assets
npm run test:world-watcher
npm run test:marine-life
npm run test:underwater-environment
npm run test:water-threshold
npm run test:audio
npm run test:violet-audio
npm run build
```

The test scripts need Node 22.15+ or Node 24. Add `?debug` for diagnostics;
`?emulate&debug` enables the development-only hand-tracking emulator. Emulation
cannot prove real passthrough, hand tracking or headset comfort.

See [the current handoff](docs/IMPLEMENTATION_HANDOFF.md) and `validation/` for
checks performed on this revision. Earlier documents under `docs/` describe the
uploaded project's history; their dates, routes and test claims are not evidence
for this revision. A physical Quest 3S retest remains required.

## Project notes

- [Changes](docs/CHANGES.md)
- [Environment refinement](docs/ENVIRONMENT_REFINEMENT.md): implemented forest
  and violet art direction, grounding fixes and asset sources.
- [Underwater experience](docs/UNDERWATER_EXPERIENCE.md): reef, marine life, water transition and audio.
- [Creature sources](docs/CREATURE_SOURCES.md): original models, licenses and animation handling.
- [Environment shortlist](docs/ENVIRONMENT_OPTIONS.md): earlier researched alternatives.
- [Current XR behaviour](docs/XR_FEASIBILITY.md)
- [Quest rehearsal](docs/HEADSET_REHEARSAL.md)
- [Asset licences](ASSETS.md)

Source areas: `src/worlds` environments, `src/tear` simulation and membrane,
`src/interaction` desktop/hand inputs, `src/portal` composition, `src/ui` guidance,
`src/audio` sound, `src/xr` optional PC spectator rendering. `_legacy/` preserves
the earlier project.
