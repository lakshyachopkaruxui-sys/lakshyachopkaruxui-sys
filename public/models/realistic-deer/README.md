# Textured Kelgar doe

“Deer Female” by Čestmír Dammer (CDmir), with TinyWorlds listed as collaborator,
created for Kelgar. Source: https://opengameart.org/content/deer-female

The creator's page and the supplied `source/License.txt` both state CC0.
The original `source/doe.blend` is retained without changes. This is a textured
game model with natural animal proportions, not a photogrammetry scan.

`doe.glb` has 4,784 triangles, 31 rig joints, two embedded 1024px diffuse maps,
and the source Idle, LookAround, Run and Eat clips. Blender's glTF exporter
baked the rig constraints. Legacy materials were rebuilt for glTF, invalid
mesh bookkeeping was repaired, obsolete animation curves targeting a misspelled
nonexistent bone were removed, and the four highest bone influences were
retained and normalized. Texture UVs and the animal's original shape remain.

Rebuild with a local Blender 4.5 executable:

```
blender --background --disable-autoexec public/models/realistic-deer/source/doe.blend --python scripts/convert-realistic-deer.py
```

The runtime sizes the doe to 1.4 metres at its ears. Viewer gaze, a small head
tilt and one short approach are project code in `ForestFauna.ts`; these behaviors
are not supplied by the model creator. The source running gait briefly lifts
all hooves during its airborne phase. The creature rests after approaching and
does not pursue the visitor.

Exact source/runtime hashes and conversion details: `SOURCE-MANIFEST.json`.
