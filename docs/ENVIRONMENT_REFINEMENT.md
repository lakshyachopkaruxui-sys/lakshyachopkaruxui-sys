# Environment refinement — 16 September 2026

The two virtual worlds now have deliberately different emotional roles:
World Two offers nature and discovery; World Four creates quiet unease and a
reason to return home. Both preserve the earlier geometry/contact corrections.

## Grounding repairs retained

The earlier forest floor was a circle fan whose analytic height function did
not match the visible triangles, with measured differences up to 3.02 metres.
The replacement is a subdivided height field. Planting and walking now sample
its rendered triangles. Violet islands have connected tops, rims and downward
stone undersides; plants belong to each island's coordinate frame.

Imported creature bounds include skin transforms and are normalized before
placement. Async models receive the current portal stencil before display.
World alignment moves terrain, props, lights, sounds and walking bounds together.

## Living glade

The forest uses 24 detailed oak/ash trees near the clearing and 48 simpler
but similarly textured trees beyond it. Baked trees are instanced, and only
near trees cast shadows. The four model variants total 321,504 tree triangles
in the intended scene layout, compared with approximately 310,000 previously.
This is a geometry budget comparison, not a measured headset frame rate.

A stencil-aware procedural sky adds a sun and slowly moving clouds. Three
original-library owls fly above the nearby canopy on continuous curved paths.
Ferns, grass, flowers, mushrooms, fallen logs and lily pads give the eye detail
at different distances while preserving the clear walking area and shoreline.

## Violet drift

The previous calm violet garden has been superseded. The landing surface is
weathered violet stone, surrounded by suspended islands, alien curled blades,
four twisted basalt spires, dim mineral seams and an impossible dark sky.
450 stars move upward. Six luminous white original
Jellyfish models drift independently, using their own cloned skeletons and idle
animations rather than sharing bone state.

An original unknown shadow becomes the observer, with pale eyes as its clearest
feature. It begins behind a distant cover stone after a quiet arrival and creeps
closer only while out of view, freezing when watched. Its movement is continuous
and grounded, with a minimum distance from the visitor. Low detuned ambience,
distant metallic creaks and breath-like rustles deepen the uneasy atmosphere.
The return seam remains available and leads to the original room, including
live passthrough on Quest.

## Visual references and sources

References guide composition; no game artwork or characters were copied.
Pokémon GO is an AR/location-based mobile game, rather than headset VR. Its
readable foreground and framed natural backgrounds inform the forest only.
The violet dimension follows the user's original eerie concept.

- [Pokémon GO biome update](https://pokemongo.com/rediscovergo?hl=en): encounter
  space, coherent planting and natural background layers.
- [Moss: Book II environment design](https://blog.playstation.com/2022/02/10/creating-the-connected-world-of-moss-book-ii/): grounded scale and surface detail.
- [Gobkit free creatures](https://gobkit.com/freebies): the project's existing
  Owl, Jellyfish and minion variants, with CC0 metadata in their local GLBs.
- [EZ-Tree](https://github.com/dgreenheck/ez-tree): MIT tree generator and leaf
  textures. Full oak/ash models have 7,908/7,620 triangles; their new distant
  variants each have 2,816 triangles. All are normalized to 8 metres.
- [ambientCG Ground037](https://ambientcg.com/view?id=Ground037) and
  [Rock030](https://ambientcg.com/view?id=Rock030): CC0 PBR ground and rock maps.
- EZ-Tree's distributed bark images are Poly Haven CC0; license copies and
  provenance accompany the bundled assets.

No paid asset pack was purchased. Original source models and legacy files
remain in the archive. See ASSETS.md and CREATURE_SOURCES.md for provenance;
BROWSER_QA.md records verification boundaries.
