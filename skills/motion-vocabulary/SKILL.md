---
name: motion-vocabulary
description: Name a motion or film move from a visual description; translate a director note into controlled terms and HyperFrames or Remotion recipes. Use for storyboard camera and transitions, or to name a critique issue and repair.
---

# Motion Vocabulary

## Instructions

1. If invoked without a move or note, ask: "What motion do you want to name or change?" Identify the visible action and its purpose. Load only the relevant category below. Done when the proposed term describes what changes on screen or in sound.
2. Give the closest **name** and `kebab-id`, then a one-line definition. For ambiguous notes, contrast up to two alternatives, such as a push-in versus a zoom-through. Done when the user can choose the intended move.
3. When implementation is requested, give the category's `HF` and `Remotion` recipes and identify the beat or frame where the move lands. A rule id names an installed HyperFrames recipe; an approach is guidance, not an id. Done when each engine has a concrete path.
4. For a storyboard, use the exact `kebab-id` in `shots[].camera` and `shots[].transition`. `transition` names the move at the shot's entry, for example `straight-cut` or `shared-element`. Use `locked-off` for a camera that does not move. `entry` and `exit` are not vocabulary fields: they stay `cut` or `handoff`. For critique issues, use the term id. Use `custom:<description>` for a move without a term. For each shot after the first, set `shots[].thread` to `{"kind": <thread id>, "shared": <the carried thing in words>}` from [Threads](terms/threads.md). Done when every named move resolves to a term here or starts with `custom:`; `motion-studio validate` prints a `warning:` line for each term that does not, and an `error:` line for a missing thread, a kind that is not a thread id or `custom:<description>`, or an empty `shared`.

A transition between shots needs a cut or a verified handoff. A shape morph across engines needs a matched last and first frame; animate each side within its own shot. Audio belongs to the master mix, not an engine's video-only shot render. Terms name intent, not a required style or timing bound; load the genre playbook for pacing.

## Examples

- "Make the button become the next page" → **Shared element** (`shared-element`), with **flood** (`flood`) if its fill covers the frame. Keep the button's geometry and color continuous across the handoff.
- "The chart speaks before it shows" → **Word-cued reveal** (`word-cued-reveal`), then a **hold** (`hold`) long enough to read the value.
- "The zoom must hit on the drop" → **Hit on the drop** (`hit-on-the-drop`) for the landing, and **push-in** (`push-in`) if the camera moves closer rather than passing through an object.

## Glossary

Each entry gives an original one-line definition, an HF rule or GSAP approach, and a Remotion frame recipe. Load one category at a time.

- [Editing](terms/editing.md): cuts, continuity and sound overlaps.
- [Camera](terms/camera.md): viewpoint, focus and depth.
- [Kinetic type](terms/kinetic-type.md): text entrances and changes.
- [Graphic transitions](terms/graphic-transitions.md): wipes, floods and morphs.
- [Timing and physics](terms/timing-physics.md): holds, beats and settling.
- [Composition](terms/composition.md): framing, hierarchy and data layout.
- [Finishing](terms/finishing.md): blur, texture and color.
- [Audio sync](terms/audio-sync.md): music structure, cues and loudness.
- [Interface in shot](terms/interface-in-shot.md): cursor-driven product motion.
- [Threads](terms/threads.md): what each seam carries into the next shot.
