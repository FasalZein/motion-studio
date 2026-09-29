# motion-studio

A studio of agent skills and one CLI that direct motion-design films across Remotion and HyperFrames. This glossary fixes the words for the motion rules (docs/SPEC-motion.md); the full contract is docs/SPEC.md.

## Language

### Direction

**Direction**:
One G1 candidate: an idea device, a world and camera logic, and a look, shown as a moving look test.
_Avoid_: concept (alone), style option

**Idea line**:
The one sentence, with no "and", that states what the film tells.
_Avoid_: tagline, logline (the logline is the brief field that holds it)

**Beat contract**:
The fields the board sets per beat: idea line, frames, motion event, camera start and end, seam thread, in-between plan, sound cue and live content.
_Avoid_: beat row, shot notes

**Motion event**:
What moves in a beat, from where to where, with which easing or spring.
_Avoid_: "appears", "shows"

**In-between plan**:
How the frame travels from one beat's pose to the next, designed as motion and not left to a fade.
_Avoid_: transition (alone)

### Seams

**Seam**:
The boundary between two consecutive shots; its entry is a `cut` or a `handoff`.
_Avoid_: join, splice

**Thread**:
The thing a seam carries across, named by a thread kind (shared element, shape match, movement match, camera direction, light, sound, beat cut with motion) and described in words.
_Avoid_: continuity thread (in code), link

**Handoff**:
A seam where shot B's first frame equals the frame shot A would show next, so pose and velocity carry through.
_Avoid_: match (alone), freeze-frame match

### Motion measurement

**Liveness report**:
The CLI's measurement of stillness in a rendered film or video against the reference limits.
_Avoid_: motion score, slideshow score

**Still span**:
A run of consecutive samples in which nothing moves above the noise floor.
_Avoid_: freeze, hold (a hold is a directed beat, a still span is a measurement)

**Content basis**:
The film's time without black spans and without one trailing end-card hold, used for the liveness shares.
_Avoid_: net time

**Moving share**:
The fraction of samples on the content basis that move.
_Avoid_: motion percentage

**Living hold**:
A reading hold in which something keeps moving (camera drift, parallax, light, type or UI behavior).
_Avoid_: hold (alone), pause

**Waiver**:
A director's written reason, recorded on the G4 gate, to approve a full pass whose liveness report fails.
_Avoid_: override, skip

### Build

**Look test**:
A short moving clip of a direction, rendered by the CLI in one engine, with a poster still.
_Avoid_: look still, styleframe

**Keyframe mode**:
A build that renders static poses at named local frames for the G2 stills.

**Blocking mode**:
A build in which every beat moves with its real timing, camera path, seams and living holds at placeholder fidelity.
_Avoid_: rough cut, previz

**Full mode**:
The finished build of a shot, extended from its blocking source.

**Moving animatic**:
The stitched blocking renders of the primary format with the real track, shown at G3.
_Avoid_: still animatic, storyboard video

**3D declaration**:
The board's statement, per shot, that the shot uses 3D and why.
