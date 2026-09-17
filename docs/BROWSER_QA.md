# Browser and device verification

Revision: violet atmosphere and approaching shadow — 16 September 2026.

## Automated checks

- TypeScript and the production build pass.
- **8 interaction checks:** reduced physical hand travel still opens the tear,
  with unchanged crossing threshold, two-hand requirement, healing, tracking
  loss and regripping behaviour.
- **24 rendering/session checks:** transparent opening, opaque virtual output,
  RGB-preserving alpha seal, return-tear transparency confined to its stencil,
  restored passthrough after crossing, desktop parity, session rejection,
  aligned walking bounds, world isolation and membrane synchronization.
  Tests also verify the room → forest → underwater → violet → original-room route and that
  the watcher receives the live camera pose only in the active violet world.
  Additional regressions call the installed Three.js WebGLTextures implementation
  to reproduce Quest inter-pass buffer invalidation and verify normal MSAA and
  single-sample fallback preservation. The GL calls are controlled test doubles.
- **9 environment checks:** independent raycasts compare actual terrain with
  contact queries, including 5,636 synthetic samples and 1,101 transformed
  forest samples. Plant attachment bases, island closure/winding, aligned
  island contacts and all four baked tree variants are checked. Asset loaders
  are stubbed for scene construction; real tree binary geometry is parsed.
- **4 bird/companion checks:** real Owl skeletons and independent materials,
  async stencil assignment, continuous closed flights over 200 simulated
  seconds, fallback birds and correct named companion animation selection.
- **3 violet asset checks:** actual Jellyfish GLBs, cloned rigs and idle motion,
  normalized sizes, neutral white materials and async stencil; original shadow
  geometry and pale eye accents; 450 bounded upward-moving stars. Embedded image textures are
  omitted in these Node-based asset tests; geometry and bones are real.
- **8 shadow watcher checks:** a six-second arrival grace period, distant reveal,
  actual eye sighting before pursuit, continuous bounded approach around cover,
  freezing while watched, minimum separation, proximity concealment,
  inactive-state reset and transformed coordinates.

Controlled rendering tests use a renderer/session test double. They verify
render order and material/alpha state, not the Quest compositor itself.

- **7 XR hand/focus checks:** actual Three controller visible/blurred joint
  behaviour, handedness, disconnect, no-frame menu interruptions, missing viewer
  pose, fresh release/re-pinch, paused/resumed crossing and listener cleanup.
- **7 entry checks:** actual entry module with controlled DOM/App dependencies;
  touch-only guidance, hybrid devices, a newly attached mouse, headset activation
  before audio awaits, unsupported setup, permission retry and session ending.

- **6 underwater environment checks:** rendered-triangle floor contact after
  translated and rotated alignment; every reef attachment; a clear arrival;
  opaque ocean volume/ceiling and portal stencil; bounded particles/bubbles;
  finite geometry and explicit scene budgets.
- **5 marine-life checks:** actual local GLBs, independent rigs and genuine swim
  clips, normalized animated bounds, 450 seconds of finite closed paths, fish
  separation, safe heights, async stencil and scene batching.
- **7 water-threshold checks:** active-route isolation, opening-width limits,
  independence from swallow scale, exact sloping ground contact, bounded pools,
  pause/reentry and the transition cutoff.
- **5 violet audio checks:** finite levels and loop joins; sparse creaks and
  breath textures; real spatial source mapping; stable activation/filter limits;
  fade to silence and re-entry without accumulating sources.
- **6 underwater audio checks:** finite loops, loop boundaries, silence intervals, decoded
  memory, startup, sustained underwater filtering, world-local spatial sources
  and smooth fade to zero.

The preceding underwater revision passed all **93 automated checks**. This
violet refinement updates its watcher/asset suites and adds five dedicated
violet audio checks. The 55 affected asset, watcher, audio, environment and XR-rendering checks
pass for this revision, together with TypeScript and the production build;
unchanged earlier results are retained above. Responsive CSS now uses a scrollable flex layout
with safe auto margins. This structural correction has not been checked on a
physical phone. Browser entry was checked again for the underwater revision. This does not
constitute 3D browser or device validation.

## Actual browser checks

The preceding underwater revision was opened in cloud Chrome through its
managed development preview. The DOM confirms the two entry choices and the
updated room / glade / blue sanctuary / violet / home journey. Enter headset opens the correct
HTTPS/setup help on this HTTP preview, including the return-room explanation
and Meta casting link. The expanded help names all three virtual destinations. Desktop preview attempts WebGL initialization and
shows a clear graphics-unavailable message while leaving headset help usable.

The available browser previously reported `GL_VENDOR = Disabled` and
`GL_RENDERER = Disabled`; that revision could not create a WebGL context. The violet refinement uses
focused geometry, audio and offline visual checks; no new browser/device claim
is made.
This is startup/error-path verification, not a successful desktop journey.
The latest screenshot capture timed out. The existing BROWSER_ENTRY.jpg
records the earlier entry-layout inspection, not the revised 3D worlds.

## Separate offline composition inspection

A Mesa/EGL diagnostic renderer draws exported scene triangles, instances,
textured baked trees, and actual skinned creatures. Forest views were inspected
for canopy depth, sun/cloud composition, owl position and grounded details.
Violet views were inspected for clear landing, distinct dark atmosphere,
original jellyfish, twisted basalt silhouettes and a covered watcher. The
latest violet pass checks the white jellyfish, modestly denser stars and the
new shadow at distant and closer positions.
Underwater arrival, overhead and near-reef views were also inspected. That
review identified and resolved a finite water-ceiling edge and excessive animal
material partitions, and prompted refinement of the large marine silhouettes.
Underwater material and water-threshold shader programs compiled in Mesa after
adapting Three.js shader interfaces/output chunks.

These are approximate offline diagnostic views, **not browser or headset
screenshots**. Their lighting, alpha, point sprites and color output are not
identical to Three.js; browser shadows, normal maps, water effects, portals
and XR stereo are not reproduced. Geometry tests and these views complement
rather than replace device testing.

## Still requires your computer / Quest 3S

No full 3D browser journey, physical headset test, frame-rate measurement,
stereo check, hand comfort test, audio audition or casting rehearsal was
performed here. No claim of device-verified performance is made.

1. In a graphics-capable browser, open the hosted link or launch the extracted
   project with PREVIEW_DESKTOP.cmd. Test look/walk, F to grip, D to pull,
   Space to cross, R to heal and H for notes. Look up in the forest for the
   sun, clouds and three unusual owls.
2. Open the forest tear and watch water meet the ground beneath it. Enter the
   blue sanctuary; inspect grounded reef details and look overhead for the water
   ceiling, schools and large animals. The underwater sound should stay muffled.
   Then enter the violet drift. Check the dim rock/frond silhouettes, floating
   white jellyfish and rising stars. After settling, locate the distant eyes,
   look away, then back: the shadow should approach slowly off-screen and
   freeze when viewed. It must stay well away, remain hidden in portal previews
   and reset after returning home. Listen for quiet creaks and breath-like layers.
3. Tear back home: the desktop must return to the original furnished room.
4. Open the same HTTPS link in Quest Browser with hand tracking enabled.
   Confirm real-room passthrough on entry, fully virtual forest/underwater/violet worlds
   in both eyes, then real passthrough only inside the final return tear and
   across the entire view after crossing. The same XR session should remain.
5. Release/regrip, briefly lower hands out of tracking, and exit/re-enter midway.
   Check initial seam placement, comfortable reach and stable recovery.
6. Rehearse Meta casting on the demonstration laptop, including the real-room
   opening/return, all three virtual worlds, audio, framing and network delay.


## Final chapter names and alignment review

The final four chapter names are now shared by desktop and headset. The forest
and violet roots now follow tear yaw, consistently with the underwater root.
The full automated suite passes: **102 checks**, including three new integration
checks using actual world floors and App transitions for desktop and controlled
Quest camera poses. TypeScript validation also passes.

The numerical tests confirm a stationary viewer, level floor, consistent scene
scale, ground contact and journey order under moved and rotated entry points.
They do not establish the visual result in either eye of a physical headset.
The previously recorded cloud-browser WebGL limitation still applies.

The updated entry page was also opened in the live managed browser. Expanding
“Four worlds, one journey” showed all four exact names and descriptions with
clean spacing and no clipping at the available desktop viewport. The production
build succeeded. This UI check does not change the WebGL/headset limitations.


## Typography and recalled guidance

- The live entry page was visually checked with its expanded chapter list:
  larger italic serif headings fit without clipping at the desktop viewport.
- A temporary typography view rendered the actual DiegeticLabel canvases in
  the browser: all four chapter names and the contextual tear prompt were
  inspected. This checks text rasterization, not the WebGL/stereo composition.
- TypeScript validation and 66 affected software checks passed, covering guide
  expiry/recall, hand-pose recognition, named joint freshness, App integration,
  input comfort, XR rendering and device entry. The gesture was tested with
  controlled poses, not native Quest hand tracking.
- Physical Quest rehearsal remains necessary for reading comfort, hand-pose
  tolerance and possible interaction with the headset's system UI.
