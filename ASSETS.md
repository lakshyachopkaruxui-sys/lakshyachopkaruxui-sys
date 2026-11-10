# Assets and licences

The project combines original procedural geometry, MIT-licensed tree-generation
components, CC0 assets, NPS recordings and a CC BY 4.0 ocean recording. Source
textures and available licence copies are retained with the files. Bundled
runtime assets are served locally with the project.

## Current environment rebuild

- [Poly Haven Fir Tree 01](https://polyhaven.com/a/fir_tree_01), Rico Cilliers / Rob Tuytel, CC0: three creator-authored LOD2 variants converted with photographed bark and needle textures. The active forest uses the foliage version; the shadow woodland uses a bare-wood conversion. Source, modifications and hashes are in `public/models/forest/conifers/SOURCE-MANIFEST.json`.
- [Misty Pines](https://polyhaven.com/a/misty_pines), Poly Haven, CC0: photographic atmosphere for the shadow world. The living forest uses [Forest Slope](https://polyhaven.com/a/forest_slope), Andreas Mischok, CC0, for photographic distant woodland and illumination. Both panoramas provide background context; the nearby walkable geometry is separate.
- [Boulder 01](https://polyhaven.com/a/boulder_01), Rico Cilliers / Poly Haven, CC0: the active shadow rock, converted to one connected mesh with original surface textures. Source records and the runtime hash are in `public/models/shadow/boulder_01/SOURCE-MANIFEST.json`.
- [3D Horror Game Monster](https://opengameart.org/content/3d-horror-game-monster), City Building Game Art / HorrorGameMaker.com, CC0: two independently animated instances of the same textured character, with authored Idle/Walk clips. The conversion also retains Run. Original source and output hashes, rig conversion details and license are in `public/models/shadow/horror-humanoid/`.
- [Deer (female)](https://opengameart.org/content/deer-female), CC0: three independently animated instances of the same source doe, with recurring running, grazing and attention behavior. This is a textured game model, not a photographed animal scan.

These are separate assets assembled into a Three.js environment. The supplied Unity Terrain Sample Project has not been acquired or imported. See `docs/REALISM_REBUILD.md` for current scope; the older sections below retain source history where labeled.

## Retained source creature library: Gobkit (not active)

The uploaded GLBs embed `Gobkit`, `CC0-1.0` and a Creative Commons licence URL.
The [official free collection](https://gobkit.com/freebies) confirms commercial
use, modification and redistribution under CC0.

| Asset | Role |
|---|---|
| `minion-c01.glb` | Retained previous forest companion; removed from runtime |
| `Owl.glb` | Retained previous forest flock; removed from runtime |
| `Jellyfish.glb` | Retained previous shadow jellyfish; removed from runtime |
| `minion-d01.glb` | Retained source alternative; removed from runtime |

The local files have separate named `idle`, `attack`, `dead` clips, and the animal
files also contain `walk`. They do not contain a dedicated flight clip. Each
skinned clone uses an independent skeleton. Model bounds are measured after
skinning, then normalized to metres before placement.

Other original animal, Kenney Nature Kit and Gobkit nature files are retained
as source alternatives; presence in the archive does not mean they are rendered.

## Retained procedural forest trees

`public/models/refined/{oak,ash}.glb` and their `_lod` companions are baked with
[@dgreenheck/ez-tree 1.1.0](https://github.com/dgreenheck/ez-tree) (MIT). The generator
runs only during asset preparation. Its licence, deterministic bake script and
model metrics are included. Leaf PNGs come from the MIT package; bark textures
are credited there to Poly Haven's CC0 `bark_brown_02` asset. See
`public/textures/refined/README.md` and `BARK-SOURCES.md`.

## Materials and light

- [ambientCG Ground037](https://ambientcg.com/view?id=Ground037), CC0: retained forest moss/soil fallback.
- [ambientCG Rock030](https://ambientcg.com/view?id=Rock030), CC0: stones and violet terrain.
- [Poly Haven Kloppenheim 05 (Pure Sky)](https://polyhaven.com/a/kloppenheim_05_puresky), Greg Zaal / Jarod Guest, CC0: earlier forest lighting asset retained locally. The 1K and 2K versions are retained as earlier lighting sources; size, published MD5 and local SHA-256 are recorded in `public/hdri/ENVIRONMENT-SOURCES.md`.
- [Poly Haven qwantani_sunset_puresky](https://polyhaven.com/a/qwantani_sunset_puresky), CC0: original sunset lighting retained as an inactive source alternative.
- [Poly Haven forest_ground_04](https://polyhaven.com/a/forest_ground_04), CC0: original retained floor texture.
- The earlier procedural cloud, veil, eclipse and star shaders are retained as source history. Current forest and shadow skies use photographic HDR maps on stencil-tested geometry. Vegetation and fish proximity responses are project behavior.

See `docs/ENVIRONMENT_RESEARCH.md` for the primary-source comparison, selected
assets, rejected alternatives and validation boundaries.

## Recorded and generated sound

Recorded forest ambience is CC0 from BigSoundBank:
[Forest](https://bigsoundbank.com/forest-s0100.html) and
[Countryside](https://bigsoundbank.com/countryside-s0097.html) by Joseph Sardin;
[Forest and Stream #3](https://bigsoundbank.com/forest-and-stream-3-s2716.html)
by Pierre Sibanarco. These specific source pages and their CC0 declarations
were checked on 2026-09-19. Tearing and the small companion's voice are
synthesized locally. Whale calls and environmental recordings are credited below.

### Violet world: dread drone

- `public/audio/dread-drone.mp3`: "Low Frequency Vibrating Drone with Heart Pressure Rumbles and Booms" by bassimat ([Freesound](https://freesound.org/people/bassimat/sounds/860781/)), CC0; the specific source page and license were checked on 2026-09-19. The recording supplies a low drone with rumbling accents. `Soundscape.ts` applies a slow volume swell, with the synthesized `droneBuffer` retained as a load-failure fallback. Chimes and the near-field texture are synthesized locally. This is an artistic sound choice; no physiological effect or user response has been established for the prototype.

## Underwater world

- [Microsoft/Khronos BarramundiFish](https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/BarramundiFish), CC0: textured fish, optimized embedded textures, authored runtime swim motion.
- [Quaternius Animated Fish Pack](https://quaternius.com/packs/animatedfish.html), CC0: shark, whale and manta ray with original skeletal swim clips. Local conversions and refinements are detailed in `public/models/marine/manifest.json`.
- `public/models/marine/README.md`, manifest and full CC0 legal text preserve provenance. All animal files are bundled locally; no marketplace is queried at runtime.
- Reef geometry, smooth shoaling fish and turtles, water shaders, caustics, marine snow, bubbles and water-threshold effects are original procedural work for this project. Rock surfaces reuse the credited ambientCG maps above.
- Bubbles and the nearby current are original local synthesis. A mermaid was investigated as an optional addition but no suitable downloadable asset was included.

### Underwater sound: whale calls and deep-ocean bed

The original archive's recording dates, trimming and preprocessing details are
retained below as supplied provenance. The NPS source page and MBARI dataset
license were checked on 2026-09-19; this review did not independently match the
bundled excerpts against the full original recordings. The
[NPS ownership statement](https://www.nps.gov/aboutus/disclaimer.htm) applies
to NPS-created work, and the Glacier Bay source page identifies these
hydrophone recordings as made by NPS. No protection is claimed in original
U.S. Government works.

- `public/audio/whale-moan-1.wav`, `whale-moan-2.wav`, `whale-whup.wav`, `whale-feeding.wav`: real humpback whale vocalizations (moans, "whups", and one longer trumpet-like feeding call), trimmed from hydrophone recordings made by the U.S. National Park Service at Glacier Bay National Park and Preserve, Alaska ([source page](https://www.nps.gov/glba/learn/nature/soundclips.htm)). U.S. government work, public domain in the United States (17 U.S.C. §105); credit: NPS. Played by `src/audio/WhaleVoice.ts`, attached directly to the whale model so the call always sounds where the whale actually is; calls are infrequent (10–15s apart) and never repeat back to back. `src/audio/synth.ts`'s `whaleBuffer` is kept only as an offline/load-failure fallback.
- `public/audio/deep-ocean.wav`: a hydrophone recording from the MARS deep-sea observatory (~890m depth, Monterey Bay), 2024-01-05, published as part of MBARI's [Pacific Ocean Sound Recordings](https://registry.opendata.aws/pacific-sound/) dataset. Licence: [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) — credit: "Pacific Ocean Sound Recordings, Monterey Bay Aquarium Research Institute (MBARI), accessed 2026-09-17 from https://registry.opendata.aws/pacific-sound." The raw recording is extremely quiet; it was DC-offset-corrected and gain-boosted (no other processing) before being bundled. Used as the underwater world's ambient bed in place of the synthesized `underwaterBuffer`, which remains as its load-failure fallback.

### Retained shadow surfaces from the earlier revision (not active)

- [Rock Face 01](https://polyhaven.com/a/rock_face_01), Dario Barresi / Poly Haven,
  [CC0](https://creativecommons.org/publicdomain/zero/1.0/): local glTF, geometry
  buffer, 1K diffuse, normal and packed AO/roughness/metalness maps. The former four
  supporting formations are superseded by the current grounded woodland.
- [Aerial Rocks 02](https://polyhaven.com/a/aerial_rocks_02), Rob Tuytel / Poly Haven,
  CC0: local 1K diffuse, OpenGL normal and roughness maps retained from the former landing surface.
- Exact provider URLs, MD5 verification and local SHA-256 hashes:
  `public/models/shadow/SOURCE-MANIFEST.json`. Downloads use the official API;
  runtime rendering uses local files. Asset retrieval is powered by Poly Haven.
- Mist, terrain composition, lighting, sky and reactive growth are project code.
  No Unity Asset Store environment or paid marketplace content is bundled.

### Organic worlds and watching animals

- [Dead Quiver Trunk](https://polyhaven.com/a/dead_quiver_trunk), photographed by Dario Barresi and James Ray Cock, modeled by Rico Cilliers; [Dry Branches Medium 01](https://polyhaven.com/a/dry_branches_medium_01), Rico Cilliers. Poly Haven CC0. The active shadow scene uses scanned timber and branches in a grounded woodland. The former bent root arch is superseded. Provider size/MD5 and local SHA-256 are recorded in `public/models/shadow/organic/SOURCE-MANIFEST.json`.
- [Fern 02](https://polyhaven.com/a/fern_02), Rico Cilliers / Rob Tuytel; [Tree Stump 01](https://polyhaven.com/a/tree_stump_01), Rob Tuytel; [Forest Floor](https://polyhaven.com/a/forest_floor), eye-candy.xyz. Poly Haven CC0. Four scanned fern variants, three stump instances remain active in the living forest. The original leaf-litter floor maps are retained as historical assets; the October revision uses the two surfaces below. The fern alpha map is loaded explicitly. Exact sources and checksums are in `public/models/forest/SOURCE-MANIFEST.json`.
- [Ultimate Animated Animal Pack](https://quaternius.com/packs/ultimateanimatedanimals.html), Quaternius, CC0. The earlier wolves, stag and deer are retained as source assets but are no longer instantiated. `public/models/fauna/SOURCE-MANIFEST.json` preserves their original provenance and full CC0 legal text.
- [Deer (female)](https://opengameart.org/content/deer-female), Čestmír Dammer (CDmir), with TinyWorlds/Kelgar credits from the source; CC0. The three active forest does use photographic diffuse textures and a deformation skeleton, converted from the supplied Blender model. It is a textured game model, not a photogrammetry scan. `public/models/realistic-deer/SOURCE-MANIFEST.json` records the source, conversion and output hashes.
- The earlier procedural distorted shadow figures and root arch are inactive. The current textured, animated horror character has separate source and license records. No Stranger Things character is bundled.

Quaternius also supplies the existing ocean shark, whale and manta ray. The
water-world result combines those refined stylized meshes with a textured
Khronos fish, procedural water/caustics, movement and recorded sound. No claim
is made that all environments or animals are photorealistic scans.

Asset retrieval is powered by Poly Haven. Its [CC0 license](https://polyhaven.com/license)
permits modification and redistribution of the downloaded assets. Promotional
renders from the reference pages are not bundled. See
`docs/REALISM_REBUILD.md` for current implementation and validation boundaries.

### Natural male narration revision

`public/audio/narration/` contains five locally generated Kokoro `am_michael` male speech files at their original pitch. There is no bass boost or nonlinear compression. A quiet 0.55-second room reflection uses 2.8% wet gain; there are no repeating echoes.
The revised story copy is original writing grounded in the supplied project brief; it is documented in `docs/NARRATION_PLAN.md`. The narrator is synthetic. No voice clone, cloud API or human
performer recording is used. The locally generated impulse adds no third-party
sound recording. Generator, processing settings and exact output hashes are
recorded alongside the audio. The [Kokoro model](https://huggingface.co/hexgrad/Kokoro-82M) is Apache-2.0; the [kokoro-onnx wrapper](https://github.com/thewh1teagle/kokoro-onnx) is MIT. Model and authoring dependencies are not redistributed in the website. License copies and source hashes are included. See `docs/NATURAL_VOICE_REBUILD.md`.


### Forest immersion and walking correction (October 2026)

The latest [performance revision](docs/FOREST_PERFORMANCE.md) uses bounded index reductions in `public/models/forest/optimized/`. `scripts/prepare-forest-performance-assets.mjs` reproduces these derivatives with meshoptimizer; `SOURCE.json` records original hashes, output hashes and approximation errors. Original vertex positions, UVs, normals and texture bytes are preserved. Original source files remain intact. Sources and attribution are in `public/models/forest/SOURCE-MANIFEST.json`, `public/models/forest/conifers/SOURCE-MANIFEST.json` and `public/models/forest/sample/SOURCE-MANIFEST.json`. These are the same CC0 Poly Haven grass, rock, branch, fern, stump and fir assets already used by Tear; no paid asset or new texture is introduced.

The [approved ground sample](docs/FOREST_GROUND_SAMPLE.md) and [forest-wide rollout](docs/FOREST_WORLD_ROLLOUT.md) use local derivatives of [Grass Medium 01](https://polyhaven.com/a/grass_medium_01) (Rob Tuytel photography, Rico Cilliers modeling), [Rock Moss Set 01](https://polyhaven.com/a/rock_moss_set_01) (Kless Gyzen) and [Dry Branches Medium 01](https://polyhaven.com/a/dry_branches_medium_01) (Rico Cilliers). All are [Poly Haven CC0](https://polyhaven.com/license); retrieval is powered by Poly Haven. Source and output hashes, texture sizes and geometry processing are in `public/models/forest/sample/SOURCE-MANIFEST.json`. Fuller medium/large variants come from the same grass source. Existing Forest Ground 03 pine-litter maps and licensed moss/soil surfaces remain shared. The latest [natural-grass revision](docs/FOREST_DAYLIGHT_NATURAL_GRASS.md) replaces opaque ribbon blades with three curved foliage-clump variants that reuse photographed clumps from the existing grass atlas. Source UV regions and generated geometry hashes are in `public/models/forest/natural-grass/SOURCE.json`; `scripts/prepare-forest-natural-grass.mjs` reproduces the small geometry package. Full 3D source accents fade over permanent cover. There is no new texture download or paid asset. The user-supplied reference image is inspiration only; its scene and promotional render are not bundled.

The subsequent [17 October forest cohesion revision](docs/FOREST_REFERENCE_INTEGRATION.md) uses the existing CC0 ambientCG Ground037 color, OpenGL normal and roughness maps as its primary ground, with Forest Ground 04 for earthy transitions. That earlier revision retained Ground 03 without loading it; the approved sample and current forest-wide cover now share its pine-litter maps again. The six-map sizes below describe the preceding needle-floor revision. No Sketchfab model textures or geometry are bundled; Jagobo's [Pine Forest at Sunset](https://sketchfab.com/3d-models/pine-forest-at-sunset-bef89be6b189456095db79107045d726) was a visual reference only.

- [Forest Ground 03](https://polyhaven.com/a/forrest_ground_03), Rob Tuytel, Poly Haven, CC0: photographed pine needles, soil and small debris. The provider intentionally spells the asset ID `forrest_ground_03`.
- [Forest Ground 04](https://polyhaven.com/a/forest_ground_04), Rob Tuytel (photography/processing), Rico Cilliers (minor adjustment), Poly Haven, CC0: soil and stones, blended into the existing trail and pool margins.
- Asset retrieval is powered by Poly Haven. Exact provider URLs, verified original MD5/SHA-256, processed-file hashes and dimensions are in `public/textures/forest-quality/SOURCE-MANIFEST.json`. Original downloads remain in `validation/forest-quality-2026-10-16/source-maps/`.
- Runtime color maps are 2K; normal and packed AO/roughness/metal maps are 1K. Six maps total approximately 8.5 MB on disk and 48 MiB uncompressed RGBA before mipmaps. The website uses local files, not the provider API.
- The forest-local canopy illumination texture is an original approximation generated from tree placement, not a physically baked or real-time shadow map. No new transparent shafts, particles or full-screen effects were added.
- The existing CC0 doe GLB and original Blender source are unchanged. Four-beat walking, stance-foot locking and two-bone IK are new project code. The original source has a Run clip, not a Walk clip; no claim is made that the new walk is motion-captured or supplied by CDmir.
