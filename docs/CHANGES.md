# Tear / IMD — current revision

Target: **Meta Quest 3S** and desktop browser.

## Violet atmosphere refinement

- Six existing jellyfish now use luminous white materials with the coloured
  atlas removed; their rigs, size and slow floating motion are preserved.
- Increase upward-moving stars from 360 to 450 without changing their direction
  or adding unbounded particle allocation.
- Replace the small imported observer with an original unknown shadow whose
  pale eyes face the visitor. After a quiet arrival, it slowly approaches when
  outside the visitor's view and stops when watched or at its distance limit.
- Add restrained eerie sound layers: a detuned low bed, distant creaks and
  breath-like texture. The return tear remains available throughout.

## New World Three: the blue sanctuary

- Insert a fully virtual underwater world between the established forest and
  violet dimension. The violet art direction is retained as World Four.
- A continuous rippled seabed supports branching and plate coral, sponges,
  sea fans, kelp, anemones, scallops and starfish. Clear sand marks the arrival.
- Textured fish, animated sharks, a whale and manta rays join smooth original
  shoals and turtles. Animals follow closed paths above the visitor.
- A moving water ceiling, restrained sunlight, caustics, marine snow and rising
  bubbles give the water depth and small details to discover.
- Opening the forest tear spills a translucent stream with foam and droplets;
  it grows with the opening and clears at the underwater crossing.
- Original muffled water, bubble, current and distant whale-like audio replace
  the forest soundscape. The journey keeps the same controls and XR session.

## Headset readiness review

- Fixed retained fingertip samples when the headset system menu hides a hand.
- Pause on XR focus/pose loss, including hidden intervals with no XR frames;
  require open fingers before the next pinch, and preserve an underway crossing.
- Preserve Quest depth/stencil between tear passes. Keep normal render-to-texture
  antialiasing; use the existing single-sample path only for the problematic
  separate-MSAA resolve that otherwise discards intermediate color.
- Keep touch-only phones on useful setup guidance instead of entering a
  mouse/keyboard-only preview. Make expanded help scroll at every viewport size.
- Add focused input/visibility and entry-route tests, with direct installed-Three
  buffer-invalidation regressions. No physical headset certification is claimed.

## Journey and contrast

**The World of Stillness → The World of Golden Growth → The World of Drowned Dreams → The World of the Watching Shadow → The World of Stillness.** The first and final world
use live passthrough on Quest, or the same furnished walkable room on desktop.
The forest, underwater sanctuary and violet dimension are fully virtual. The return tear reveals
passthrough only inside its opening; crossing restores the full real room
without changing the XR session.

## World Two: a richer living glade

- Increased the forest from 40 to 72 textured, branching trees. Twenty-four
  detailed near trees frame the clearing; 48 lighter distant trees deepen the
  canopy without multiplying the previous tree triangle count.
- Added a visible sun, soft drifting cloud banks and blue openings overhead.
- Added three unusual owls from the original Gobkit creature library, with
  independent skeletons, authored wing motion and curved flight paths above
  the nearby canopy. Their subtle cool coloring and luminous tail feathers
  connect them to the unusual ground creature.
- Enriched grounded fern, grass and flower planting; added chestnut mushrooms,
  fallen bark logs and water-level lily pads. The walking route remains open.
- Corrected the companion's animation selection to use actual named clips.

## World Four: the eerie violet drift

The calm garden direction has been removed. The violet world again reads as
an unfamiliar dimension, with a dark violet sky, suspended stone islands,
strange curled growth, four twisted basalt spires, upward-moving stars and six
original floating jellyfish.
Normal meadow flowers and green garden planting are gone. The ambient sound
uses a detuned low bed, distant metallic creaks and faint breath-like rustles.

An unknown shadow peers from behind rocks. It waits after arrival and creeps
closer only while outside the viewer's gaze, freezing when watched and keeping
a comfortable minimum distance. Looking at it can produce one quiet cue to tear back home.
The observer stays inactive in portal previews and during crossing.

## Retained structural and interaction fixes

- Subdivided forest ground and continuous, closed violet islands. Camera and
  plant contacts sample the actual rendered terrain triangles.
- Correct source-model scale and skin-aware bounds, independent creature
  skeletons and stencil assignment on asynchronous attachment.
- Destination alignment, translated walking bounds, local creature/audio
  coordinates, arrival-world isolation and membrane/mask synchronization.
- Approximately 18% less physical in-plane hand travel for the same tear
  opening. Rendered hands and depth remain tied to real tracking.
- Comfortable initial seam placement, one contextual spatial instruction,
  first-world guidance, H field notes and reduced later-world instruction noise.
- Two clear entry choices, startup error handling, Quest setup/casting help
  and the Windows PREVIEW_DESKTOP.cmd launcher.

## Validation

See [BROWSER_QA.md](BROWSER_QA.md) for completed checks and limits. Automated
regressions cover contact geometry, animations, hand interaction and the
passthrough/virtual/return render sequence. Separate offline geometry views
help assess composition. They are not browser or headset screenshots.

The cloud browser cannot create a WebGL context. Final 3D visual quality,
frame rate, stereo, hand comfort, audio and casting still require a
physical graphics-capable computer and Quest 3S.


## Chapter names and cross-device alignment review

- Applied the four final chapter names to desktop and headset titles, entry
  descriptions, diagnostics and the rehearsal guide. The common “The World of”
  prefix is a quiet smaller line above the main chapter name in spatial titles.
- Corrected forest and violet destination orientation to follow the tear's
  world-space yaw, matching underwater. A turn before tearing now keeps the
  arrival composition facing the opening. Floors remain level and life-size;
  the participant's tracked position is not moved.
- Added actual-world integration checks for the full desktop and controlled
  headset-pose journey, translated/rotated seams, rendered floor contact,
  walking bounds, and return-room visibility.
- All 102 automated checks and TypeScript validation pass. These are software
  checks, not confirmation of physical Quest stereo, frame rate or comfort.
- The four contrasting environments already complete the intended emotional
  journey; no additional content is needed before a physical Quest rehearsal.


## Larger chapter titles and on-demand help

- Enlarged world-title planes from 2.4 to 3.7 metres, with responsive FOV limits,
  larger italic main lettering and a quiet shared prefix. Arrival titles last
  4.5 seconds. Page headings use the same Georgia / Times New Roman serif family.
- Spatial instructions and keycaps now share that serif family; instruction
  sentences remain upright for legibility.
- Idle instructions fade after one 20-second onboarding window, including
  Stillness. Moving, looking, or changing worlds cannot restart the window.
  Active tearing, healing, crossing and short story cues remain available.
- H recalls desktop notes. A deliberate 1.5-second hold with both open palms
  facing the viewer recalls headset notes. A completed hold is latched until
  the pose is released, and cannot trigger while tearing or crossing.
- Recalled notes fade after 20 seconds, stay where placed, and yield to tearing.
  Tracking/focus pauses preserve reading time and cancel incomplete gestures.
