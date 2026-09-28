---
name: motion-vocabulary
description: Name a motion or film move from a visual description; translate a director note into controlled terms and HyperFrames or Remotion recipes. Use for storyboard camera and transitions, or to name a critique issue and repair.
---

# Motion Vocabulary

## Initial response

If invoked without a move or note, ask: "What motion do you want to name or change?"

## Quick start

For "the image gets closer to the product," answer: **Push-in** (`push-in`): the virtual camera advances toward the subject. Add the relevant engine recipe only if the user needs an implementation or a storyboard note.

## Instructions

1. Identify the visible action and its purpose. Load only the relevant category below. Done when the proposed term describes what changes on screen or in sound.
2. Give the closest **name** and `kebab-id`, then a one-line definition. For ambiguous notes, contrast up to two alternatives, such as a push-in versus a zoom-through. Done when the user can choose the intended move.
3. When implementation is requested, give the category's `HF` and `Remotion` recipes and identify the beat or frame where the move lands. A rule id names an installed HyperFrames recipe; an approach is guidance, not an id. Done when each engine has a concrete path.
4. For a storyboard, use the exact `kebab-id` in `shots[].camera`. Keep `entry` and `exit` as `cut` or `handoff`; name the specific transition in the shot description. For critique issues, use the term id. Use `custom:<description>` for a move without a term. Done when every named move resolves to a term here or starts with `custom:`.

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
