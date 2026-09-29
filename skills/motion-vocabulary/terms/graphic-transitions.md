# Graphic transitions

A handoff across engine shots carries motion through the seam: the frame the outgoing shot would show one past its end must equal the incoming shot's first frame (D63). Animate a transition inside one engine when possible.

- **Wipe** (`wipe`) - A moving edge replaces one image with another.
  - HF: GSAP tween a clipped incoming layer's reveal edge across the frame.
  - Remotion: Use `TransitionSeries.Transition` with `wipe()` within one shot, or interpolate a clip mask.
- **Flood** (`flood`) - A shape expands until its color covers the frame and becomes the next scene.
  - HF: GSAP `fromTo` a source shape's scale past the farthest canvas corner and swap content under full cover.
  - Remotion: Interpolate a source-centered circle or rounded shape past the farthest corner; change content only under coverage.
- **Iris** (`iris`) - An opening or closing circular aperture reveals or hides a scene.
  - HF: Animate a circular clip or SVG mask radius on the paused timeline.
  - Remotion: Interpolate an SVG mask or CSS `clipPath` circle radius around the focal point.
- **Shape morph** (`shape-morph`) - One silhouette changes continuously into another with a shared identity.
  - HF: `card-morph-anchor` changes a container's scale, radius and surface on one timeline.
  - Remotion: Interpolate compatible SVG paths or the shape's transform and corner radius by frame.
- **Shared element** (`shared-element`) - An object keeps its identity while its position or role changes between scenes.
  - HF: `card-morph-anchor` carries the anchor shape; match its geometry at any shot handoff.
  - Remotion: Render the same asset on both sides with interpolated bounds and matched seam poses.
- **Push transition** (`push-transition`) - The entering scene visibly forces the outgoing scene off-screen.
  - HF: `reactive-displacement` binds the outgoing position to the entering element's progress.
  - Remotion: Translate both layers from one shared progress value; keep their edges touching.
- **Scale swap** (`scale-swap`) - An old element contracts as a new element expands at the same center.
  - HF: `scale-swap-transition` coordinates the two elements on one timeline.
  - Remotion: Interpolate opposite scales at a common transform origin, with separate opacity envelopes if needed.
- **Zoom-through handoff** (`zoom-through-handoff`) - An enlarging detail covers the frame before the next scene appears through it.
  - HF: `coordinate-target-zoom` grows the detail beyond the canvas; match the next scene's covered entry.
  - Remotion: Interpolate the detail's scale to full cover; put the next scene behind it at the matching frame.
- **Line draw** (`line-draw`) - A line or contour becomes visible along its path.
  - HF: `svg-path-draw` animates stroke dash offset from measured length to zero.
  - Remotion: Interpolate SVG `strokeDashoffset` from path length to zero.
- **Liquid merge** (`liquid-merge`) - Nearby shapes seem to flow together into one silhouette.
  - HF: Animate overlapping shapes under an SVG blur-and-alpha-threshold filter on one paused timeline.
  - Remotion: Frame-drive overlapping SVG shapes behind a blur-and-threshold filter; keep their final outline stable.
