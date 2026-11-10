# Quaternius forest and shadow animals

Source: [Ultimate Animated Animal Pack](https://quaternius.com/packs/ultimateanimatedanimals.html), by Quaternius, CC0 1.0.
The creator's page links to the public Drive folder recorded in `SOURCE-MANIFEST.json`.
Only three animal files were downloaded. Original glTF files are retained byte-for-byte.

| File | Measured triangles | Mesh parts | Animation examples |
|---|---:|---:|---|
| Wolf.gltf | 1,962 | 4 skinned | Idle, Idle_2_HeadLow, Walk, Gallop |
| Stag.gltf | 3,670 | 5 skinned + antlers | Idle, Idle_Headlow, Walk, Eating |
| Deer.gltf | 2,098 | 7 skinned | Idle, Idle_Headlow, Walk, Eating |

These are material-colored, stylized animals. They have no image textures and are not photogrammetry scans.
Runtime materials and scene lighting are separate project work. They are from the same creator as the marine shark, whale and ray already in this project.

All face +Z with +Y up. The existing `Head` bone is parented to `Neck3`, following `Neck1` and `Neck2`.
Apply a head offset after the animation mixer update so the authored animation does not overwrite the offset.
Use independent skeleton clones for each instance. Normalize measured skinned bounds before assigning a world-space size: the source wolf is about 5.28 units long and stag about 5.36 units high including its antlers.

`SOURCE-MANIFEST.json` records direct download URLs, exact hashes, complete clip names/durations, and sampled bounds.
Local inspection used the installed Three.js GLTFLoader and sampled the source Idle animations at 0.3 seconds.
No creator code was executed. Retained source animations do not imply that runtime interaction or behavior came from the pack.
