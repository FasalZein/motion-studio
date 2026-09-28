# Finishing

Apply effects to support the approved look; inspect fast-motion frames and transition seams in the render.

- **Motion blur** (`motion-blur`) - Fast motion leaves a directional trace that resolves when the object stops.
  - HF: `motion-blur-streak` ties a directional SVG blur or echo to the speed envelope.
  - Remotion: Derive directional blur from frame-to-frame displacement; return it to zero at rest.
- **Subframe motion blur** (`subframe-motion-blur`) - Several time samples inside one output frame combine into a smooth motion trace.
  - HF: Render multiple deterministic timeline samples within each frame and blend them before encoding.
  - Remotion: Sample a pure pose at several fractional frame times and composite samples within a shot; never blend across a cut.
- **Color grade** (`color-grade`) - Consistent color and contrast give separate shots one shared appearance.
  - HF: Apply the approved color transforms to each shot's rendered layers or common finishing pass.
  - Remotion: Use the same color matrix or graded assets on every shot, then compare rendered seams.
- **Grain** (`grain`) - Fine image texture breaks up flat digital surfaces without obscuring content.
  - HF: Overlay a fixed or time-indexed seeded grain texture on the paused timeline.
  - Remotion: Select a seeded grain frame from `useCurrentFrame()` and blend it over the shot.
- **Dither** (`dither`) - Low-level noise reduces visible steps in a smooth gradient.
  - HF: Add a deterministic fine-noise layer over the gradient before output encoding.
  - Remotion: Apply a fixed seeded noise texture to the gradient before render.
- **Vignette** (`vignette`) - Darkened or softened edges draw attention toward the frame's center.
  - HF: Overlay a fixed radial-gradient layer with a controlled opacity tween.
  - Remotion: Overlay a radial gradient and clamp its opacity by frame.
- **Bloom** (`bloom`) - Light from a bright subject appears to spread into nearby pixels.
  - HF: `ambient-glow-bloom` creates a bounded glow layer behind a hero.
  - Remotion: Composite a blurred duplicate of the bright layer beneath the sharp source.
- **Chromatic split** (`chromatic-split`) - Red, green and blue edges separate briefly to mark impact or disruption.
  - HF: `chromatic-glitch` offsets deterministic color copies and returns them to alignment.
  - Remotion: Offset color-channel duplicates by a frame-derived amount, then restore sharp alignment.
- **Sharp resolve** (`sharp-resolve`) - An effect ends with a clean, stable subject rather than a lingering blur.
  - HF: Set blur and echo strength to zero at the landing frame in `motion-blur-streak`.
  - Remotion: Clamp blur and duplicate opacity to zero at the landing frame.
- **Continuity check** (`continuity-check`) - The join between shots preserves intended pose, color and direction.
  - HF: Render the outgoing last and incoming first frames and compare them at the handoff.
  - Remotion: Render both boundary frames and a stitched transition strip; compare against the approved handoff.
