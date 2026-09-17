# Assets and licences

The project combines original procedural geometry, MIT-licensed tree-generation
components and CC0 assets. Source textures and licence copies are retained with
the files. All runtime assets are served locally with the project.

## Active creature library: Gobkit

The uploaded GLBs embed `Gobkit`, `CC0-1.0` and a Creative Commons licence URL.
The [official free collection](https://gobkit.com/freebies) confirms commercial
use, modification and redistribution under CC0.

| Asset | Role |
|---|---|
| `minion-c01.glb` | Yellow forest companion |
| `Owl.glb` | Forest sky flock; original wingbeat animation authored for its existing rig |
| `Jellyfish.glb` | Original jellyfish restored to the violet dimension |
| `minion-d01.glb` | Retained source alternative; the active watcher is original procedural geometry |

The local files have separate named `idle`, `attack`, `dead` clips, and the animal
files also contain `walk`. They do not contain a dedicated flight clip. Each
skinned clone uses an independent skeleton. Model bounds are measured after
skinning, then normalized to metres before placement.

Other original animal, Kenney Nature Kit and Gobkit nature files are retained
as source alternatives; presence in the archive does not mean they are rendered.

## Forest trees

`public/models/refined/{oak,ash}.glb` and their `_lod` companions are baked with
[@dgreenheck/ez-tree 1.1.0](https://github.com/dgreenheck/ez-tree) (MIT). The generator
runs only during asset preparation. Its licence, deterministic bake script and
model metrics are included. Leaf PNGs come from the MIT package; bark textures
are credited there to Poly Haven's CC0 `bark_brown_02` asset. See
`public/textures/refined/README.md` and `BARK-SOURCES.md`.

## Materials and light

- [ambientCG Ground037](https://ambientcg.com/view?id=Ground037), CC0: forest moss/soil.
- [ambientCG Rock030](https://ambientcg.com/view?id=Rock030), CC0: stones and violet terrain.
- [Poly Haven qwantani_sunset_puresky](https://polyhaven.com/a/qwantani_sunset_puresky), CC0: forest environment lighting.
- [Poly Haven forest_ground_04](https://polyhaven.com/a/forest_ground_04), CC0: original retained floor texture.
- Forest sun/clouds and violet sky/stars are procedural shaders. They remain
  spatial sky meshes so portal stencil clipping works in both eyes.

## Recorded and generated sound

Recorded forest ambience is CC0 from BigSoundBank:
[forest birds](https://bigsoundbank.com/sound-0100-forest.html),
[forest stream](https://bigsoundbank.com/sound-2716-forest-and-stream-3.html), and
[countryside](https://bigsoundbank.com/countryside-s0097.html).
Tearing and creature voices are synthesized locally. The unknown shadow
watcher is original geometry.

No assets from Pokémon GO, Moss or other visual reference games were copied.

### Violet world: dread drone

- `public/audio/dread-drone.mp3`: "Low Frequency Vibrating Drone with Heart Pressure Rumbles and Booms" by bassimat ([Freesound](https://freesound.org/people/bassimat/sounds/860781/)), CC0. Grounded in real research: sustained low-frequency sound (infrasound-adjacent, below ~20Hz) is documented to cause unease/dread without a person consciously hearing anything — the effect behind Vic Tandy's 1998 "haunted lab" case (eyeball and chest resonance near 19Hz). Played on a slow ~26s volume swell (`swellPeriod`/`swellMin` in `src/audio/Soundscape.ts`) so it breathes — rises, peaks, fades toward-but-not-quite-silent, repeats — rather than holding one flat level. Replaces the previously fully-synthesized `droneBuffer` as this world's bed; `droneBuffer` remains as the load-failure fallback. Chimes and the near-field unease texture are untouched, still synthesized.

## Underwater world

- [Microsoft/Khronos BarramundiFish](https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/BarramundiFish), CC0: textured fish, optimized embedded textures, authored runtime swim motion.
- [Quaternius Animated Fish Pack](https://quaternius.com/packs/animatedfish.html), CC0: shark, whale and manta ray with original skeletal swim clips. Local conversions and refinements are detailed in `public/models/marine/manifest.json`.
- `public/models/marine/README.md`, manifest and full CC0 legal text preserve provenance. All animal files are bundled locally; no marketplace is queried at runtime.
- Reef geometry, smooth shoaling fish and turtles, water shaders, caustics, marine snow, bubbles and water-threshold effects are original procedural work for this project. Rock surfaces reuse the credited ambientCG maps above.
- Bubbles and the nearby current are original local synthesis. A mermaid was investigated as an optional addition but no suitable downloadable asset was included.

### Underwater sound: whale calls and deep-ocean bed

- `public/audio/whale-moan-1.wav`, `whale-moan-2.wav`, `whale-whup.wav`, `whale-feeding.wav`: real humpback whale vocalizations (moans, "whups", and one longer trumpet-like feeding call), trimmed from hydrophone recordings made by the U.S. National Park Service at Glacier Bay National Park and Preserve, Alaska ([source page](https://www.nps.gov/glba/learn/nature/soundclips.htm)). U.S. government work, public domain in the United States (17 U.S.C. §105); credit: NPS. Played by `src/audio/WhaleVoice.ts`, attached directly to the whale model so the call always sounds where the whale actually is; calls are infrequent (10–15s apart) and never repeat back to back. `src/audio/synth.ts`'s `whaleBuffer` is kept only as an offline/load-failure fallback.
- `public/audio/deep-ocean.wav`: a hydrophone recording from the MARS deep-sea observatory (~890m depth, Monterey Bay), 2024-01-05, published as part of MBARI's [Pacific Ocean Sound Recordings](https://registry.opendata.aws/pacific-sound/) dataset. Licence: CC BY 4.0 — credit: "Pacific Ocean Sound Recordings, Monterey Bay Aquarium Research Institute (MBARI), accessed 2026-09-17 from https://registry.opendata.aws/pacific-sound." The raw recording is extremely quiet; it was DC-offset-corrected and gain-boosted (no other processing) before being bundled. Used as the underwater world's ambient bed in place of the synthesized `underwaterBuffer`, which remains as its load-failure fallback.
