# retro-pixel-pc98

Status: **untested until used**.

- Palette (example hex): Midnight `#16142C`, violet `#65539B`, amber `#F2B86B`, phosphor `#E9DBB6`.
- Type pairing (free fonts): DotGothic16 (pixel display) + Noto Sans JP (readable supporting copy).
- Nearest HyperFrames frame preset: none (the listed presets have occasional pixel motifs, not a PC-98 pixel scene).
- Motion signature: `straight-cut`, `mask-line-reveal`, `shape-morph`. Use stepped sprite changes for narrative objects.
- Motion signature fields (the look test shows them, D61):
  - Easing family: stepped timing on twos or fours: sprite frames change, positions snap to whole pixels.
  - Camera behavior: a stepped `pan` or `truck` across a tiled scene, in whole-pixel steps.
  - Light behavior: palette-cycled light: a color ramp moves through the scene (`light-thread` across seams).
  - Transition family: `straight-cut` and pixel `wipe`; `shape-morph` in sprite steps.
- Variation axis 1: Pixel scale: coarse sprite or fine tiled scene.
- Variation axis 2: era treatment: clean digital or restrained CRT scanline.
- HyperFrames feasibility: canvas or SVG pixel layers with integer coordinates and nearest-neighbor scaling.
- Remotion feasibility: frame-indexed sprite sheets and nearest-neighbor canvas/SVG output.
- Look-specific pattern addition: Random glitch overlay → a pixel change that reveals a real product state.
- Public reference (direction only, not an asset license): https://en.wikipedia.org/wiki/PC-98
