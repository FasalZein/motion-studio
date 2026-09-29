# Threads

A thread is what a seam carries from one shot into the next (D64). Every shot after the first names its thread in `shots[].thread`: `kind` is one id below or `custom:<description>`, and `shared` names the carried thing in words, for example `"the blue search field"`. Each shot is its own engine project, so build each side in its own shot and make the two sides meet at the seam frame.

- **Shared-element thread** (`shared-element-thread`) - One object stays on screen across the seam and keeps its identity.
  - HF: End the outgoing timeline and start the incoming one with the object at the same position, size and color; use `card-morph-anchor` when it changes role.
  - Remotion: Render the same component from the same asset on both sides and give its bounds equal values at the seam frame.
- **Shape-match thread** (`shape-match-thread`) - A different object takes over the outgoing silhouette at the same place in the frame.
  - HF: Pose both shapes to the same bounding box and outline at the seam, then let the incoming shape change inside its own timeline.
  - Remotion: Interpolate the incoming shape from the outgoing silhouette's bounds and radius, starting at its first frame.
- **Movement-match thread** (`movement-match-thread`) - Motion continues through the seam in the same direction and at the same speed.
  - HF: Give the outgoing and incoming tweens equal velocity at the seam; set the incoming tween's first frame mid-move, not from rest.
  - Remotion: Match the slope of the two `interpolate()` curves at the seam frame so position per frame stays equal.
- **Camera-direction thread** (`camera-direction-thread`) - The viewpoint keeps travelling the same way, so the next shot feels like the next part of one move.
  - HF: Tween the `.world` wrapper in the same direction on both sides with the `viewport-change` approach and matched speed.
  - Remotion: Drive the camera wrapper's transform in the same direction on both sides with equal per-frame change at the seam.
- **Light thread** (`light-thread`) - A light source, glow or color field carries across and sets the next shot's light.
  - HF: Keep the light layer's color, position and intensity equal on both seam frames, then move it in the incoming timeline.
  - Remotion: Render the same gradient or glow element with equal props at the seam frame on both sides.
- **Sound thread** (`sound-thread`) - One sound runs or lands across the seam and ties the two pictures together.
  - HF: Land a visual event on the cue frame in the shot that holds that frame, and let the other shot's motion lead into or out of it; place the sound once in the master mix with a `soundCues` entry.
  - Remotion: Key a visual event to the cue frame in the shot that holds it and run the other shot's motion toward or away from it; the sound goes in the master mix, not the shot render.
- **Beat-cut thread** (`beat-cut-thread`) - The cut lands on a beat while something moves on both sides, so the rhythm carries the change.
  - HF: Cut on a `beatFrames` frame with a tween running through the last outgoing frame and from the first incoming frame.
  - Remotion: Put the seam on a beat frame and keep an `interpolate()` range active across both seam frames.
