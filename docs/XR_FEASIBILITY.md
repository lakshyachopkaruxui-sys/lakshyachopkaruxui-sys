# Tear: current headset and phone behaviour

Reviewed against the current project source and primary WebXR documentation.
This is a software audit, not a physical Quest 3S certification.

## The requested first world is implemented

The public **Enter headset** button calls `requestSession('immersive-ar')`,
requires `local-floor` and `hand-tracking`, and checks for `alpha-blend` output.
The synthetic room root is hidden and the scene clears transparently. Therefore
the intended first view is the live room/classroom from Quest passthrough,
with the digital membrane, tracked hand markers and spatial instructions.
The app refuses unsupported passthrough instead of silently showing a fake room.

[Meta's Browser documentation](https://developers.meta.com/horizon/documentation/web/webxr-mixed-reality/)
describes the immersive-ar/transparent-background approach used here.

The wearer pinches the seam with both hands, pulls apart, and holds the fully
open tear for 1.2 seconds. The opening grows and the forest becomes the entire
view. The underwater sanctuary follows, then the violet dimension. The final tear reveals the real room again.
All phases stay in the same XR session; the virtual worlds receive opaque
output so the real room does not show through their transparent effects.

## Differences between devices

| Device | Supported route |
|---|---|
| Meta Quest 3S, standalone Quest Browser | Real-room opening/return, tracked hands, stereoscopic forest, underwater and violet worlds |
| Computer with mouse and keyboard | Furnished virtual-room opening/return, keyboard/mouse interaction, same forest, underwater and violet worlds |
| Touch-only phone/tablet | Opening and setup help; interactive touch controls are not implemented |

The headset route is hand-driven; there is no controller-button substitute.
The wearer can complete the crossings standing or sitting in place, without
walking through a physical doorway. Headset floor calibration, room lighting,
tracking quality and stereo comfort still need device testing.

## Corrections from the headset audit

- Reject invisible hand roots even when Three.js retains visible fingertip
  objects from an earlier frame. This prevents stale pinches during system UI.
- Pause interaction and crossing time while the session is blurred/hidden or
  lacks a current viewer pose. Listen to visibility changes even if no XR frame
  is delivered. Require the user to open their fingers before a fresh pinch.
- Preserve the depth/stencil data needed by successive portal render passes on
  the Quest render target. Use a single-sample fallback where the browser's
  multisample resolve would discard intermediate color. Desktop stays unchanged.
- Explain the mouse/keyboard requirement on touch-only entry and keep the help
  page accessible instead of launching an unusable phone preview.

The [WebXR visibility-state specification](https://immersive-web.github.io/webxr/#dom-xrsession-visibilitystate)
defines blurred/hidden sessions as not processing normal application input.
The fixes were also checked against the actual installed Three.js implementation.
See BROWSER_QA.md for exact automated-test scope and remaining hardware limits.

## Watching on another device

Open [Meta casting](https://horizon.meta.com/casting) on the demonstration
computer and use the headset's casting controls. Rehearse the actual classroom
network and both the real-room and virtual phases. An independently opened
Tear page on a laptop or phone is another instance, not a headset mirror.
The WebGL canvas alone does not contain the composited passthrough camera view.
The project retains a separate same-computer spectator utility for explicit
PC VR development sessions; it is not used for the public Quest AR journey.
