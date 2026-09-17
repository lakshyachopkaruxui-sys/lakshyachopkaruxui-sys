# Creature sources and implementation

Research and local binary inspection: 16 September 2026.

The reused creatures are **Gobkit** models. Their local GLBs embed
`asset.generator: Gobkit` and `asset.copyright: CC0-1.0`.
[Gobkit's official free asset page](https://gobkit.com/freebies) and
[JSON catalogue](https://gobkit.com/api/free) identify the source models.
The inspected local files contain separate named animations; implementation
uses those names rather than assuming a master timeline or a flight clip.

| Local file | Triangles | Joints | Use |
|---|---:|---:|---|
| Owl.glb | 310 | 16 | Three forest birds, independent rig and authored wing motion |
| Jellyfish.glb | 428 | 16 | Six white floating jellyfish in the violet dimension |
| minion-c01.glb | 240 | 5 | Existing forest companion, corrected named animation selection |
| minion-d01.glb | 240 | 5 | Retained original alternative; no longer used by the watcher |

Direct official asset locations:

- [Owl](https://gobkit.com/freebies/animalB/Owl.glb)
- [Jellyfish](https://gobkit.com/freebies/animal/Jellyfish.glb)
- [Observer minion](https://gobkit.com/freebies/minion/minion-d01.glb)

All runtime copies are bundled locally, including embedded image textures.
No external creature service or new paid account is required. The Owl asset
has idle/attack/dead/walk clips but no dedicated flight clip; the new wingbeat
is authored in SkyFlock.ts on its existing hand/wing joints. Creature.ts now
prefers named idle and attack clips; timeline slicing is only a fallback for
a sufficiently long unsplit clip.

Jellyfish source units span hundreds of units. Skin-aware measurements,
normalization and independent SkeletonUtils clones prevent giant models,
floating bases and shared animation state. Every async attachment receives the
current portal stencil before it can render. The watcher is now a complete original procedural silhouette and needs no
model download; birds retain an articulated fallback.

The observer is an original, elongated near-black shadow with restrained pale
eyes. It begins at a distant grounded cover stone and approaches continuously
only while out of view. Looking back freezes its motion; it stays outside the
visitor's personal space. The former minion model remains in the source asset
folder as an unused alternative. White jellyfish keep their original idle rigs
but no longer sample the coloured atlas or vertex colours.
