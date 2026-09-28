# Composition

Framing is relative to the output format. Check protected text and UI in each format's safe rectangle.

- **Title safe** (`title-safe`) - Text stays inside the area reserved for readable titles.
  - HF: Use format-specific layout inputs to place text inside the safe rectangle before GSAP motion.
  - Remotion: Derive text bounds from format props and keep the held title inside the safe rectangle.
- **Platform safe zone** (`platform-safe-zone`) - Key content avoids the controls overlaid by its delivery platform.
  - HF: Position protected content using per-platform layout inputs and check its held bounds.
  - Remotion: Apply platform overlay insets from format props and check text bounds at key frames.
- **Negative space** (`negative-space`) - Open space separates the focal subject from competing detail.
  - HF: Set a stable grid with an empty region and tween only the focal content into it.
  - Remotion: Layout content with a deliberate empty region; interpolate the focal element without filling the gap.
- **Visual hierarchy** (`visual-hierarchy`) - Size, contrast and placement tell the eye what to read first.
  - HF: Establish a primary target in CSS and stage secondary GSAP entrances after it.
  - Remotion: Size the primary element in layout and offset secondary `<Sequence>` arrivals.
- **Rule of thirds** (`rule-of-thirds`) - A main subject sits near a third-line rather than at dead center.
  - HF: Place the subject at a format-relative one-third anchor; animate its transform around that anchor.
  - Remotion: Derive the anchor from composition dimensions and interpolate toward it.
- **Leading lines** (`leading-lines`) - Edges or paths guide the eye toward the focal subject.
  - HF: `svg-path-draw` reveals a guiding path that terminates at the subject.
  - Remotion: Draw a frame-driven SVG path toward the held subject.
- **Split frame** (`split-frame`) - Two regions show a comparison at the same time.
  - HF: `split-tilt-cards` presents paired surfaces on opposing sides.
  - Remotion: Give each side a stable half-canvas region and interpolate paired entries.
- **Focal point** (`focal-point`) - One location receives the clearest visual emphasis in the shot.
  - HF: `depth-of-field-blur` softens non-focal layers while the subject stays sharp.
  - Remotion: Hold the subject sharp and interpolate competing layers' opacity or blur.
- **Data encoding** (`data-encoding`) - A chart's position or length represents values from its source consistently.
  - HF: `stat-bars-and-fills` scales bars from a shared zero baseline using sourced values.
  - Remotion: Compute bar geometry from sourced values and one shared scale before frame-based reveal.
- **End card** (`end-card`) - The final composition holds the main claim and brand mark together.
  - HF: `svg-path-draw` or a simple GSAP entrance reveals the mark, then holds claim and mark.
  - Remotion: Offset the mark's `<Sequence>` entrance and keep both mark and claim visible through the end frame.
