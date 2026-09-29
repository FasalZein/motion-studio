# Timing and physics

Use frame-based timing. A hold is a living hold: the viewer reads or listens while something keeps moving, and it stays inside the D59 liveness limits (`motion-direction` `reference/living-holds.md`).

- **Hold** (`hold`) - A living hold: the read element stays legible while the viewer reads or listens, and camera drift, parallax, light or UI behavior keeps moving. Use only inside a beat that has a motion event, sized to reading time.
  - HF: Land the read element's tween, then run a slow drift, parallax or light tween on the paused timeline across the held frames until the next move.
  - Remotion: Clamp the read element's `interpolate()` value and keep a frame-driven drift, parallax or light value moving across the held frames.
- **Ease-out** (`ease-out`) - A move starts quickly and slows as it reaches its target.
  - HF: GSAP `fromTo` with a decelerating `power3.out` ease.
  - Remotion: Apply `Easing.bezier()` to a clamped `interpolate()` frame interval.
- **Ease-in-out** (`ease-in-out`) - A move gains speed, then loses speed before it stops.
  - HF: GSAP `fromTo` with `power2.inOut` on the intended time interval.
  - Remotion: Use an ease-in-out curve with `interpolate()` across the frame interval.
- **Anticipation** (`anticipation`) - A brief preparatory motion points against or toward the main action.
  - HF: Add a short pre-move tween before the primary GSAP transform tween.
  - Remotion: Interpolate a small pre-move over its own frames before the main trajectory.
- **Overshoot and settle** (`overshoot-settle`) - An object passes its destination slightly and returns to rest.
  - HF: `spring-pop-entrance` for a deliberate arrival, with restrained overshoot.
  - Remotion: Use `spring()` with a bounded local frame and damping suited to the intended rest.
- **Closed-form spring** (`closed-form-spring`) - A spring pose is computed directly from time and target changes without simulating prior frames.
  - HF: Sample an analytic step response at timeline time in a GSAP-driven proxy; sum one response per target change.
  - Remotion: Evaluate an analytic step response at `frame / fps`; sum one response per target change.
- **Follow-through** (`follow-through`) - A secondary part finishes moving after the main body has stopped.
  - HF: Give the secondary part a delayed GSAP transform tween after the parent move.
  - Remotion: Use a second offset frame interval for the secondary part's transform.
- **Stagger** (`stagger`) - Related objects start the same move at short, ordered offsets.
  - HF: GSAP `fromTo` with index-derived stagger on one paused timeline.
  - Remotion: Subtract an index-based frame offset before each item's `interpolate()`.
- **Beat hit** (`beat-hit`) - A pose reaches its emphasis exactly at a chosen beat frame.
  - HF: Place the landing tween's endpoint on the beat's paused-timeline label.
  - Remotion: Set the `interpolate()` endpoint to the beat frame and clamp after it.
- **Dead time** (`dead-time`) - A stretch tells nothing new or nothing in it moves; move the next reveal onto its cue, give the stretch live motion, or trim it.
  - HF: Move the next GSAP reveal to the relevant word cue or shorten the unused scene interval.
  - Remotion: Shift the next `<Sequence>` to the word cue or trim the empty frame range.
