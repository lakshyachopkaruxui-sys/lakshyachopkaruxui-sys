# Tear / IMD: environment options researched on 16 September 2026

Historical shortlist for the earlier three-world design. The implemented route
is now room → forest → underwater → violet → room; see
[UNDERWATER_EXPERIENCE.md](UNDERWATER_EXPERIENCE.md) for the new World Three.


## Recommended visual direction

Use **the user's actual room through headset passthrough → a warm, lush forest clearing → a violet, impossible sky landscape**. This is a strong progression from familiar reality to believable nature to fantasy. Keep the existing tearing interaction, spatial scale, and world identity. The list below records the earlier alternatives. The selected and implemented components are now documented in ENVIRONMENT_REFINEMENT.md; free tree assets and PBR materials have been integrated.

A downloaded photograph, HDRI, or scanned room is not live AR. World 1 should use supported headset passthrough; a realistic room panorama or 3D reconstruction is a separate desktop fallback. An HDRI is a surrounding image and lighting source, not terrain the user can walk through. A 3D scene supplies spatial geometry but still needs navigation, collision, interaction, and performance work.

## Specific shortlist

Suitability comments are engineering/design judgments, not claims that these assets have been benchmarked on the user's headset. Source formats and licensing are stated only where verified. Page links are the primary asset listings.

| Option | World and role | Type / verified format | License / access | Fit and work required |
|---|---|---|---|---|
| [Small Empty Room 1 — Poly Haven](https://polyhaven.com/a/small_empty_room_1) | World 1 desktop fallback; preferred neutral option | Photographed interior HDRI; HDR / EXR, tonemapped JPG | Free, CC0 | Soft daylight and uncluttered room keep the tear and instructions prominent. Use a reduced-resolution panorama for a stationary desktop starting view. It does not reproduce the user's current room or supply parallax when moving. |
| [Art Studio — Poly Haven](https://polyhaven.com/a/art_studio) | World 1 desktop fallback; creative studio alternative | Photographed interior HDRI; HDR / EXR, JPG | Free, CC0 | Art-studio context suits a design portfolio; more visually busy than the empty room. Same panorama limitations. |
| [Sunset Forest — Poly Haven](https://polyhaven.com/a/sunset_forest) | World 2; preferred warm lighting/background reference | Forest panorama, HDR / EXR, JPG | Free, CC0 | Warm summer woodland atmosphere closely matches a golden-hour glade. Combine with actual foreground terrain and vegetation; do not treat the pictured trees as explorable meshes. |
| [Niederwihl Forest — Poly Haven](https://polyhaven.com/a/niederwihl_forest) | World 2; greener, shaded alternative | Forest-clearing panorama, HDR / EXR, JPG | Free, CC0 | Moss, logs, and a shaded clearing support a quieter forest. Source lighting is overcast, so it is a different mood from the golden-hour direction. |
| [Tree Small 02](https://polyhaven.com/a/tree_small_02) + [Tree Stump 01](https://polyhaven.com/a/tree_stump_01) — Poly Haven | World 2; modular realistic foreground | Actual 3D models; Tree Small 02 lists Blend, glTF, USD, FBX | Free, CC0 | Best controllable building blocks for a custom glade. Tree Small 02 lists **5 million source triangles**, so use low-detail variants or simplify, instance, and reduce textures. These are components, not a complete scene. |
| [Forest Field — sueti begum / Blendkit](https://www.blendkit.com/asset-gallery-detail/3c5ba348-9fbd-45c5-bff8-51f48b41649f/) | World 2; complete composition alternative | Blender scene; browser-ready GLB not verified | Full Plan; Royalty Free shown on listing | Detailed realistic trees/foliage, but the listed file is approximately **519 MiB**. Requires substantial scene reduction, material baking, GLB export, and headset testing. This specific listing is paid even though other assets share its name. |
| [Photogrammetry: 3D Scan Nature Landscape — Laslo.S](https://sketchfab.com/3d-models/photogrammetry-3d-scan-nature-landscape-7b0eee8cae194d5c9aeea8b9f962bfe3) | World 2; optional distant-landscape scan/reference | Drone-captured 3D landscape; exact download formats unverified | Downloadable listing found; exact current license needs confirmation on asset page | Good example of a real scanned environment, but aerial capture is not evidence of good eye-level tree detail. Full listing fetch was blocked. Inspect mesh holes, foliage, scale, formats, and license before selecting; not my first choice for the close-up glade. |
| [Rosendal Park Sunset — Pure Sky / Poly Haven](https://polyhaven.com/a/rosendal_park_sunset_puresky) + [Boulder 01](https://polyhaven.com/a/boulder_01) | World 3; preferred customizable foundation | Sky-only HDR / EXR / JPG plus 3D rock model in glTF / Blend / USD / FBX | Free, CC0 | Use the natural sunset sky as a base for an authored violet color treatment and sculpt floating-island silhouettes using rock surfaces. The source sky is blue/warm sunset, **not already violet**. Boulder source lists **124K triangles**; simplify before repeated use. Water and clouds remain authored scene elements. |
| [Purple Twilight Sunset Sky — Blendkit](https://www.blendkit.com/asset-gallery-detail/d40cbd89-b84f-4065-8601-7cf594f998da/) | World 3; ready-made purple color reference / sky alternative | HDRI listing; exact source extension unverified | Full Plan; Royalty Free shown | Direct theme match for a violet sky. Listing reports approximately **345 MiB**, so downsample substantially. Still only a sky, with no floating terrain. Redistribution conditions need to fit the final web delivery. |
| [Floating Island with Roots and Rocks — Dennis / Sketchfab](https://sketchfab.com/3d-models/floating-island-with-roots-and-rocks-4c05ffef4d1c45ab847ac565b8184a5b) | World 3; floating-island geometry alternative | Downloadable 3D island; exact formats unverified | Creator listing indexed as CC Attribution; recheck version/details at download | Distinctive hanging roots and rock silhouette fit the surreal landscape. Indexed listing reports **131.5K triangles**. Inspect materials and underside, reduce for repeated instances, add required credit, and recolor/relight for violet. Full page fetch was blocked, so this is a conditional candidate. |

## Resource websites worth using

| Site | What it adds to Tear | Important distinction |
|---|---|---|
| [Poly Haven](https://polyhaven.com/) | Real photographed HDRIs, PBR surfaces, detailed 3D natural objects | Public CC0 assets; good starting point for a shareable portfolio project. Model detail may greatly exceed mobile VR budgets. |
| [ambientCG](https://ambientcg.com/) | Additional photographic skies and ground/rock surfaces | CC0. For example, [Evening Sky HDRI 032 A](https://ambientcg.com/view?id=EveningSkyHDRI032A) is a stitched sky panorama offered from 1K to 16K; it is orange/yellow, not a ready-made violet environment. |
| [Sketchfab](https://sketchfab.com/) | Creator-made scans and viewable 3D environment previews | Download availability, attribution, commercial use, formats, and scene completeness vary by asset. An AR-viewer button does not make a model the user's real environment. |
| [Blendkit, formerly BlenderKit](https://www.blendkit.com/) | Complete artistic scenes and themed skies | A render-ready Blender scene is not a drop-in WebXR scene. Check the exact item, since free and Full Plan items can share names. |
| [Fab](https://www.fab.com/) | Larger environment packs, vegetation, and Megascans options | Useful if the user wants a paid pack, but only after verifying its actual export formats and license. Do not assume Unreal-only material systems or dense environment packs will run directly in Three.js. No specific Fab pack was sufficiently verified to recommend over the shortlist. |

## Integration approach after the user chooses

1. Retain real passthrough as World 1 on supported hardware, with small spatial instruction cues and the tear. Select a separate desktop room fallback.
2. Build a bounded glade with actual terrain, a few detailed foreground objects, lightweight repeated vegetation, and a photographic background/lighting source. Preserve an open space around the viewer and tear.
3. Keep World 3 as an authored fantasy scene. Use a violet sky, textured islands, restrained cloud layers, and water/sky reflections rather than a single flat panorama of islands.
4. Convert meshes/materials for glTF/GLB, use suitable LODs, bake expensive shading, reduce texture resolution, and profile on the actual target headset. A working browser preview alone cannot prove headset frame rate or comfort.
5. Keep attribution and asset provenance. For open project ZIP/source delivery, prefer CC0 and confirmed CC BY assets. Blendkit's Royalty Free terms restrict redistribution outside incorporated content, so inspect how a chosen asset can be delivered in a web project before acquisition. See the [official terms](https://www.blendkit.com/terms-and-conditions-2018/).

## Relevant source checks

- [Poly Haven license](https://polyhaven.com/license): assets are CC0; this applies to the assets rather than granting rights over the website itself.
- [Tree Small 02](https://polyhaven.com/a/tree_small_02): license, formats, dimensions, LOD categorization, and 5M source-triangle figure verified on the asset listing.
- [Boulder 01](https://polyhaven.com/a/boulder_01): license, formats, and 124K source-triangle figure verified on the listing.
- [Forest Field](https://www.blendkit.com/asset-gallery-detail/3c5ba348-9fbd-45c5-bff8-51f48b41649f/): Full Plan, Royalty Free, and 518.7 MiB verified on the specific creator listing; the displayed polygon count of 1 is not a credible total scene budget and was not used.
- [Purple Twilight Sunset Sky](https://www.blendkit.com/asset-gallery-detail/d40cbd89-b84f-4065-8601-7cf594f998da/): current indexed creator listing states Full Plan, Royalty Free, and 345.4 MiB. Direct page retrieval was inconsistent.
- Sketchfab candidates rely on indexed creator listings because direct requests returned access errors. Download packages, meshes, exact license versions, and texture sizes have not been inspected.

## Confirmed implementation choices

- Meta Quest 3S with a live passthrough opening.
- Desktop: realistic walkable room.
- World 2: sunlit forest glade; World 3: fully virtual violet garden.
- Free MIT/CC0 components; no paid pack required.
- Current source selection and integration: ENVIRONMENT_REFINEMENT.md.
