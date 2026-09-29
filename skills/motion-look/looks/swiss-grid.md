# swiss-grid

Status: **untested until used**.

- Palette (example hex): Paper `#F3F0E8`, ink `#171717`, signal red `#D32F2F`.
- Type pairing (free fonts): Archivo (display) + IBM Plex Mono (labels and numbers).
- Nearest HyperFrames frame preset: `broadside` (nearest rigid flat typography; adapt its orange and type to the grid).
- Motion signature: `mask-line-reveal`, `straight-cut`, `push-in`. Let rules and alignment carry the change.
- Motion signature fields (the look test shows them, D61):
  - Easing family: `ease-out` on rules and columns; type lands without bounce.
  - Camera behavior: `push-in` along the grid, or a `truck` from column to column.
  - Light behavior: flat, even light; the signal red moves the viewer's attention.
  - Transition family: `straight-cut` on the grid, `mask-line-reveal` and `wipe` along a rule.
- Variation axis 1: Grid density: wide 3-column or dense 6-column.
- Variation axis 2: signal use: single index marker or a whole data row.
- HyperFrames feasibility: CSS grid and clipped text layers; animate grid position without changing label order.
- Remotion feasibility: compute columns from layout props per format; reveal rules and type with frame-driven masks.
- Look-specific pattern addition: Floating labels without alignment → labels anchored to a visible column or baseline.
- Public reference (direction only, not an asset license): https://en.wikipedia.org/wiki/International_Typographic_Style
