# World Three — the blue sanctuary

The journey is **room → living glade → blue sanctuary → violet drift → room**.
The established forest and violet scenes retain their art direction. The violet
scene is now World Four; its original `WorldThree` source class remains named
that way to avoid unrelated code churn.

## Experience

Opening the forest membrane reveals the underwater environment and releases a
small water stream. Its width follows the actual visual opening. Droplets,
foam and ripples follow the sloping forest floor; the effect stays below the
hands and fades before the world swap. Crossing needs no physical forward
step and does not push or rotate the camera.

Inside, a sandy reef corridor provides a clear landing and close details to
explore. Branching coral, layered plates, tube sponges, brain-like mounds,
lace fans, kelp and seagrass form groups on low reef shelves. Scallops, starfish
and anemones sit at the actual terrain surface. Water patterns move across the
sand and reef, suspended particles drift slowly, and bubbles rise toward a
sunlit water ceiling.

Three schools contain 102 original smooth fish. Five textured barramundi and
independent animated sharks and manta rays circulate in the middle water;
a 10.5-metre whale passes high overhead. Two original turtles travel more
slowly. Routes are closed and deterministic, with real size normalization,
independent skeletal animation and clearance above the seabed. This is an
art-directed marine sanctuary, not a scientifically exact mixed-species habitat.

Four restrained synthesized layers create water, bubbles, a nearby current and
distant whale-like motifs. Their low-pass limits remain in place after entry.
The forest fades away; after the next tear, the violet soundscape returns.

## Sources and design references

- [Quaternius Animated Fish Pack](https://quaternius.com/packs/animatedfish.html)
  supplied CC0 shark, whale and manta-ray rigs and original swimming clips.
- [Microsoft/Khronos BarramundiFish](https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/BarramundiFish)
  supplied the CC0 textured fish. Its static source receives authored swimming.
- [Wevr theBlu](https://wevr.com/theblu) informed the calm pacing, overhead scale
  and layered reef-to-open-water composition. No theBlu assets are included.
- [NOAA coral reef ecosystems](https://www.noaa.gov/education/resource-collections/marine-life/coral-reef-ecosystems)
  informed reef habitat grouping and close substrate detail.

Exact source URLs, licences, modifications and hashes are bundled beside the
GLBs in `public/models/marine`. No purchased assets, hotlinked models or account
sign-ins are needed. A mermaid was optional; no suitable downloadable model was
included, rather than adding an unfinished placeholder character.

## Desktop and Quest

Both modes share the same reef, animals and water effects. Desktop uses the
existing walk/look/tear controls. Quest uses the existing tracked-hand gesture
and stays in one alpha-blend XR session: only the first and return room show
passthrough. The forest, underwater and violet environments have opaque output
in both eyes. The final tear restores the real room on Quest and the furnished
virtual room on desktop.

The underwater additions do not change the headset reach reduction, pause on
system menus, fresh-release hand gate, casting guidance or phone setup route.
Phones still provide setup guidance; playable touchscreen controls were not
part of this addition.

## Verification boundaries

See [BROWSER_QA.md](BROWSER_QA.md) for exact checks. Automated tests use actual
terrain and animal geometry plus controlled renderer/XR sessions. Separate
Mesa/EGL scene and shader diagnostics check composition and compilation; they
are not browser screenshots and do not reproduce the Quest compositor.
A graphics-capable desktop and physical Quest 3S rehearsal are still required
for final appearance, stereo, frame rate, physical gesture comfort and audio.
