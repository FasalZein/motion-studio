# paper-collage

Status: **untested until used**.

- Palette (example hex): Cream `#F1E8D6`, charcoal `#232221`, vermilion `#CE553E`.
- Type pairing (free fonts): Fraunces (display) + DM Sans (labels).
- Nearest HyperFrames frame preset: none (the listed presets use designed paper surfaces but not cut-paper assembly).
- Motion signature: `mask-line-reveal`, `shape-morph`, `straight-cut`. Move cutout pieces as physical layers.
- Motion signature fields (the look test shows them, D61):
  - Easing family: `overshoot-settle` for placed pieces; `ease-out` for lifted ones.
  - Camera behavior: `truck` or `pan` across the table of cutouts, with `parallax` between paper layers.
  - Light behavior: a fixed top light; paper shadows shift as pieces lift and land.
  - Transition family: `straight-cut` and `shape-morph` as a cutout becomes the next scene.
- Variation axis 1: Paper edge: clean scissor or torn texture.
- Variation axis 2: assembly: stacked evidence or one unfolding illustration.
- HyperFrames feasibility: layered SVG cutouts and texture masks; GSAP transforms with stable z-order.
- Remotion feasibility: deterministic paper-layer positions, crop masks and limited texture overlays.
- Look-specific pattern addition: Stock sticker scatter → product-specific cutouts arranged to explain the claim.
- Public reference (direction only, not an asset license): https://en.wikipedia.org/wiki/Collage
