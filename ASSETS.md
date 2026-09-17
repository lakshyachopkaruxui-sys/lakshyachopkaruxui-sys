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
Tearing, creature voices and the violet drone, creaks and breath-like ambience
are synthesized locally. The unknown shadow watcher is original geometry.

No assets from Pokémon GO, Moss or other visual reference games were copied.

## Underwater world

- [Microsoft/Khronos BarramundiFish](https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/BarramundiFish), CC0: textured fish, optimized embedded textures, authored runtime swim motion.
- [Quaternius Animated Fish Pack](https://quaternius.com/packs/animatedfish.html), CC0: shark, whale and manta ray with original skeletal swim clips. Local conversions and refinements are detailed in `public/models/marine/manifest.json`.
- `public/models/marine/README.md`, manifest and full CC0 legal text preserve provenance. All animal files are bundled locally; no marketplace is queried at runtime.
- Reef geometry, smooth shoaling fish and turtles, water shaders, caustics, marine snow, bubbles and water-threshold effects are original procedural work for this project. Rock surfaces reuse the credited ambientCG maps above.
- Underwater sound is original local synthesis: muffled water, bubbles, distant whale-like calls and nearby currents. These are designed sounds, not wildlife recordings.
- A mermaid was investigated as an optional addition but no suitable downloadable asset was included.
