# keynote-minimal

Status: **worked**.

- Palette (example hex): Warm paper `#F5F5F2`, ink `#0E0E10`, product accent example `#CDF24F`; replace the example accent with the verified brand accent.
- Type pairing (free fonts): Geist (headline and UI) + Instrument Serif (short editorial claim).
- Nearest HyperFrames frame preset: `blue-professional` (nearest restrained light canvas; replace its cobalt and card chrome with the product brand).
- Motion signature: `mask-line-reveal`, `shared-element`, `shape-morph`, `flood`, `closed-form-spring`. Keep product UI the focal object.
- Motion signature fields (the look test shows them, D61):
  - Easing family: `closed-form-spring` for UI changes; `ease-out` for type.
  - Camera behavior: one continuous `push-in` or `drift` toward the product UI (`one-camera-move-per-beat`).
  - Light behavior: a soft glow follows the product action; the accent `flood` changes the scene light.
  - Transition family: `shared-element` from UI to page, `shape-morph` and `flood`.
- Variation axis 1: Canvas temperature: warm paper or brand-neutral white.
- Variation axis 2: accent carrier: one UI action or one full-frame flood.
- HyperFrames feasibility: DOM/SVG masks, GSAP transforms and one shared-element layer for a continuous UI-to-page handoff.
- Remotion feasibility: frame-driven CSS/SVG masks and interpolated geometry; use deterministic spring functions per target change.
- Look-specific pattern addition: Floating generic device mockup → a real product screen whose action changes the scene.
- Public reference (direction only, not an asset license): https://www.apple.com/apple-events/
