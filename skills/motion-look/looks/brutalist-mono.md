# brutalist-mono

Status: **untested until used**.

- Palette (example hex): Ink `#111111`, paper `#F0ECE5`, hard accent `#E85D26`.
- Type pairing (free fonts): Barlow (heavy display) + IBM Plex Mono (small labels).
- Nearest HyperFrames frame preset: `broadside` (nearest flat, hard-edged high-contrast type plane).
- Motion signature: `straight-cut`, `mask-line-reveal`, `flood`. Use hard edges to put the claim first.
- Motion signature fields (the look test shows them, D61):
  - Easing family: `ease-out` with short, hard stops; no soft settle.
  - Camera behavior: `punch-in` onto the claim, then a `drift` on the held word.
  - Light behavior: flat, even light; a hard `flood` of the accent color changes the scene light.
  - Transition family: `straight-cut` and `flood` on the beat.
- Variation axis 1: Contrast mode: black-on-paper or paper-on-black.
- Variation axis 2: type mass: one huge word or a stacked short claim.
- HyperFrames feasibility: flat DOM color planes and oversized clipped typography; GSAP one-axis transforms.
- Remotion feasibility: deterministic hard-edge SVG planes and per-frame type masks.
- Look-specific pattern addition: Full-frame slogan without proof → bold claim beside one concrete product detail.
- Public reference (direction only, not an asset license): https://en.wikipedia.org/wiki/Brutalist_architecture
