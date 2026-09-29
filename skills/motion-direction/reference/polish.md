# Polish checklist

Run this checklist between the full build and G4. Each item names a technique; the look and the board set its values. Numbers follow the D59 limits or the look; this file adds none. [D: D78]

For each shot, mark each item **done**, **not needed** (with the reason) or **open**.

- **Motion blur on fast moves.** Blur what moves fast enough to strobe: `@remotion/motion-blur` (`CameraMotionBlur` or `Trail`) in Remotion; in HyperFrames a GSAP-driven blur filter or stacked offset copies along the path. [D: D78]
- **Easing and spring per the look.** Every move uses the look's easing family or spring. Replace each default ease (`linear`, `ease-in-out` left from a template) with the look's choice. [D: D78]
- **Secondary motion and overlap.** Parts follow the main move a little late and settle after it: a label after its card, a shadow after its object. Moves overlap instead of running one after another. [I]
- **Depth and light.** Layers sit at different depths (parallax, scale, blur, shadow). Light changes across a beat: a sweep, a glow that follows the subject, a shadow that moves with it. [I]
- **Texture.** Add the look's texture (grain, noise, paper, glass) at a level that survives compression, so flat fills do not read as placeholders. [I]
- **Type finish.** Tracking, weight and line breaks match the brand type scale; no orphan words; type moves as a unit or by designed parts (lines, words), never by accident. [I]
- **Frame rate.** Use 60 fps when the look's fast moves or the brand reference need it; record the choice in the board. [D: D78]
- **Brand name at the end.** The final frames show the brand name or wordmark, readable in every chosen format and inside the safe rectangle. [D: D78]
- **Captures and built UI.** No grey placeholder UI remains; every capture is moved with camera, mask, depth or tilt ([asset first](asset-first.md)). [D: D78]

Done when every item of every shot is done or not needed with a reason, and the shot is rendered and stitched again after the last change.
