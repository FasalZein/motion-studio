# liquid-glass

Status: **untested until used**.

- Palette (example hex): Deep blue `#172A46`, mist `#EAF3F8`, cyan `#72CADC`; use the real product palette for UI content.
- Type pairing (free fonts): Manrope (display and UI) + IBM Plex Mono (instrument labels).
- Nearest HyperFrames frame preset: none (the listed presets lack refractive material and its changing background).
- Motion signature: `shape-morph`, `shared-element`, `flood`, `closed-form-spring`. Use refraction to expose a real scene change.
- Motion signature fields (the look test shows them, D61):
  - Easing family: `closed-form-spring` with a soft settle.
  - Camera behavior: slow `parallax` behind the glass and a gentle `drift`.
  - Light behavior: the refraction and rim light move across the glass as the background changes (`light-thread` across seams).
  - Transition family: `shape-morph`, `shared-element` and `liquid-merge` through the glass control.
- Variation axis 1: Refraction strength: subtle rim or strong lens.
- Variation axis 2: material carrier: one control or one transitioning panel.
- HyperFrames feasibility: duplicate the scene behind a clipped glass element; use SVG displacement and a sharp rim. Validate Chromium capture.
- Remotion feasibility: compose a frame-driven background duplicate, distortion map and rim in one deterministic layer.
- Look-specific pattern addition: Glass on every card → one glass control that reveals the underlying product state.
- Public reference (direction only, not an asset license): https://developer.apple.com/design/human-interface-guidelines/materials
