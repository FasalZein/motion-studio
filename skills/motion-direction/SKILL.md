---
name: motion-direction
description: Direct motion in a film of any length - asset-first brand material, the idea line, one world with a camera, seam threads, designed in-betweens, living holds, choreography, 2D and 3D, product UI and UI kits, polish, and the per-beat contract. Use when sourcing brand assets, boarding beats, building a look test or shot, polishing before G4, or reviewing motion. Style belongs to motion-look; scoring belongs to motion-critique.
---

# Motion direction

Direct what moves, where it goes and what carries the eye from one beat to the next. A film is one continuous piece of motion, not a sequence of still frames with transitions between them. `motion-look` owns style, `motion-studio` owns the phases and gates, `motion-critique` owns scores; this skill owns the craft between them (D57).

## Evidence levels

Every rule carries one tag. Keep the tag when you quote a rule in a board, brief or report.

- **[S: id]**: a named source states it. The id resolves in [sources](reference/sources.md).
- **[D: Dnn]**: a project decision in `docs/DECISIONS.md`. It binds.
- **[I]**: our inference from the sources. Follow it unless the brief gives a reason.
- **[P]**: our proposal, not yet measured. Use it as a default and report what happened.

A numeric limit comes only from D59 or a cited source; every other number is marked **[P]**.

## Load by phase

Load only the files your phase names. Each file is short and self-contained.

| Phase | Files |
|---|---|
| Assets (before directions and the board) | [asset first](reference/asset-first.md) |
| Brief and directions (G1 candidates) | [idea and structure](reference/idea-and-structure.md), [world and camera](reference/world-and-camera.md) |
| Look test build | [world and camera](reference/world-and-camera.md), [seams](reference/seams-and-in-betweens.md), [living holds](reference/living-holds.md), [choreography](reference/choreography.md) |
| Board (beat map, G2) | [asset first](reference/asset-first.md), [beat contract](reference/beat-contract.md), [idea and structure](reference/idea-and-structure.md), [world and camera](reference/world-and-camera.md), [seams](reference/seams-and-in-betweens.md), [living holds](reference/living-holds.md) |
| Shot build (keyframe, blocking, full) | [beat contract](reference/beat-contract.md), [seams](reference/seams-and-in-betweens.md), [living holds](reference/living-holds.md), [choreography](reference/choreography.md) |
| Polish (after the full build, before G4) | [polish checklist](reference/polish.md) |
| Review | [beat contract](reference/beat-contract.md), [seams](reference/seams-and-in-betweens.md), [living holds](reference/living-holds.md) |

Add [2D and 3D](reference/2d-and-3d.md) when a shot declares 3D or mixes 3D with 2D. Add [product UI in motion](reference/product-ui.md) when the film shows a product interface, and [UI kit](reference/ui-kit.md) before building UI in code.

## The one test

Every beat has a **motion event** (what moves, from where to where, with which easing or spring), and every seam has a **thread** (what carries across). A hold is a living hold: something keeps moving while the viewer reads. Done when a board, a shot or a review can name both for every beat and every seam.
