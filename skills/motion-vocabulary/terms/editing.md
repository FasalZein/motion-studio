# Editing

Cuts change shots; audio overlaps belong to the master mix. Match each cut or handoff to the storyboard's frame boundary. Between two storyboard shots, `motion-studio stitch` makes the cut: each shot is its own project, so pose its first and last frame and never put two storyboard shots in one composition. The Remotion `<Series>` and `<Sequence>` recipes below apply only to cuts inside one shot.

- **Straight cut** (`straight-cut`) - One shot replaces another on a single frame without an overlap.
  - HF: End the first paused timeline and start the second at the cut frame.
  - Remotion: Inside one shot, place adjacent scenes in `<Series>` with no transition or overlapping frames.
- **Match cut** (`match-cut`) - A cut joins shots that share a shape, action or screen position.
  - HF: Pose both sides to match the same silhouette at the cut; use `card-morph-anchor` within a shot if the shape moves.
  - Remotion: Render matching end and start poses; inside one shot, put the two scenes in adjacent `<Sequence>` ranges and cut at that frame.
- **Cut on action** (`cut-on-action`) - A cut changes view during a movement that continues in the next shot.
  - HF: Tween the same object's direction through the two cut poses on separate timelines.
  - Remotion: Key both shot components to the same action pose and direction at their shared frame.
- **Smash cut** (`smash-cut`) - A sudden change of image or sound creates a sharp contrast.
  - HF: Cut between contrasting fixed poses without a transition tween.
  - Remotion: Inside one shot, place contrasting scenes in adjacent `<Series.Sequence>` components; put the sound accent in the master mix.
- **Jump cut** (`jump-cut`) - A cut skips time within one stable view while the subject stays recognizable.
  - HF: Swap two time states at a timeline threshold with the same virtual camera pose.
  - Remotion: Inside one shot, put two trimmed views of the same scene in adjacent `<Sequence>` ranges.
- **J-cut** (`j-cut`) - The next scene's sound starts before its image appears.
  - HF: Keep video shots cut-only; start the next sound early in the master mix.
  - Remotion: Keep video shots adjacent; schedule the incoming sound earlier on the master audio timeline.
- **L-cut** (`l-cut`) - The current scene's sound continues after its image changes.
  - HF: Cut picture at the boundary and extend the outgoing sound in the master mix.
  - Remotion: Cut video on the shared frame and extend the outgoing sound on the master audio timeline.
- **Whip pan** (`whip-pan`) - A fast sideways camera swing hides the seam between two views.
  - HF: Tween the `.world` wrapper quickly in one direction with `viewport-change`; match exit and entry velocity.
  - Remotion: `interpolate()` the camera wrapper's horizontal position across each side; cut while it moves fastest.
- **Cross-dissolve** (`cross-dissolve`) - One shot loses opacity while the next gains opacity over shared frames.
  - HF: Overlap two scene layers and tween their opacity in opposite directions on one timeline.
  - Remotion: Use `TransitionSeries.Transition` with `fade()` inside a single shot; a multi-engine seam needs a verified handoff.
- **Cut-the-curve** (`cut-the-curve`) - A cut keeps motion flowing by matching direction and speed across its boundary.
  - HF: Set both timelines to matching transform velocities at the seam; use the `viewport-change` approach for virtual-camera motion.
  - Remotion: Interpolate matching transform slopes on either side of adjacent shot ranges.
