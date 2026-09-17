# Marine animal sources

These are locally bundled glTF 2.0 models for the IMD underwater world. No external asset host is contacted at runtime. The manifest records exact source links, licence, measured geometry, animation clips, bounds, changes and SHA-256 hashes.

| File | Creator and source | Licence | Triangles | Animation |
| --- | --- | --- | ---: | --- |
| BarramundiFish.glb | Microsoft, [Khronos glTF Sample Assets](https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/BarramundiFish) | CC0-1.0 | 3,864 | Static source; runtime swimming is authored by this project |
| Shark.glb | [Quaternius Animated Fish Pack](https://quaternius.com/packs/animatedfish.html) | CC0-1.0 | 10,304 | Armature\|Swim, 1.25 s |
| Whale.glb | Same Quaternius pack | CC0-1.0 | 7,104 | Armature\|Swim, 2.79 s |
| MantaRay.glb | Same Quaternius pack | CC0-1.0 | 2,784 | Armature\|Swim, 4.21 s |

## Adaptation and normalization

Barramundi geometry and original surface attributes are unchanged. Its embedded base-color map is resized from 2048 to 1024 pixels, with normal and ORM maps at 512 pixels. This reduces the GLB from 12.49 MB to 1.75 MB while retaining mapped scales, fins and shading.

The three Quaternius source FBX files were obtained from the public Drive folder linked directly on the author's pack page. They were converted to GLB, with coincident vertices welded where the other attributes agree, smooth vertex normals recalculated, and original material colors retained in physically based standard materials. Alternating FBX material partitions were then collapsed to one primitive per animal, with their original linear colors baked into a vertex-color attribute. Vertices are duplicated only at material-color boundaries; positions, smooth normals, joints, weights and animation tracks are preserved. Each rigged GLB therefore renders in one draw call per animal. The shark and whale then received two baked Loop subdivision passes, and the manta one pass, to smooth their actual outlines. The shark changed from 644 to 10,304 triangles, whale from 444 to 7,104, and manta from 696 to 2,784. Color boundaries inherit the original face colors. Skin weights are interpolated with the subdivision coefficients, with the strongest four influences retained and normalized. Original bones, inverse binds and animation tracks are retained. These are refined, stylized meshes; they are not scans. No subdivision runs during the experience. FBXLoader retains four influences per vertex and reports trimming excess influences on the whale/ray. Real animation samples are checked in the integration tests.

All four complete imported scenes face +Z. The Barramundi geometry alone has a 180-degree authored root rotation: preserve or bake that transform before applying any tail deformation. Source units differ substantially; use precise skinned bounds, not raw mesh geometry bounds. Use SkeletonUtils.clone for independently animated copies of each rigged animal.

The original Quaternius animation names are `Armature|Swim`. Preserve them or explicitly match `/swim/i`; there is no `idle` clip in these three files. Barramundi has no source animation.

## Sources considered but not shipped

- [Gobkit Obsidian Manta](https://gobkit.com/s/2wskyet3jxug), Alice Liu, and [Trench Naga Siren](https://gobkit.com/s/h7yq3f2n), ariescar: their primary pages declare CC0, but the binary downloads returned HTTP 403 to the build environment. Neither is included or represented as downloaded.
- [Poly Pizza's Quaternius Shark listing](https://poly.pizza/m/AyHTK3zUSG) and [Whale listing](https://poly.pizza/m/JGFwp6xWgk) confirm CC0, but the author's own public download folder was used.
- A mermaid was optional. No sufficiently suitable, licence-verified, directly downloadable mermaid model was obtained; this revision makes no claim to include one.

`LICENSE-CC0-1.0.txt` contains the full licence text. Attribution is optional under CC0, but these source credits are preserved for the portfolio and future editing.
