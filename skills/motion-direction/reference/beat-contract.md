# The beat contract

The board sets these fields for every beat, one row per beat (a shot may hold several beats; `motion-studio beatmap` prints one row per shot), plus the spoken line and the engine with its reason for the beat's shot; builders deliver them and reviewers check them. They replace a list of poses. [S: ordinary-folk; D: D67; spec `docs/SPEC-motion.md` "motion-studio guidance"]

| Field | Content | Invalid | Recorded in |
|---|---|---|---|
| Idea line | The part of the film's idea line this beat tells, in words. | a label ("feature 2") | beat map |
| Frames | Start and end film frame on the beat grid. | off-grid without a reason | beat map; the shot's `startFrame`/`endFrame` |
| Motion event | What moves, from where to where, with which easing or spring. | "appears", "shows", "is displayed" | beat map; shot `description` |
| Camera start and end | The move id and its start and end pose. `locked-off` carries its reason. | a camera with no move and no reason | shot `camera` plus poses in `description` |
| Thread | At a seam: the thread kind and the shared thing. Inside a shot: the element that carries into the next beat. | `none`, empty | shot `thread` (D70); beat map |
| In-between plan | How the frame travels from this beat's end pose into the next beat. | "fade", "transition" alone | beat map |
| Sound cue | The beat, word or SFX the motion lands on. | none on a beat-driven film | beat map; `soundCues`, `reveals` |
| Live content | What keeps moving during any hold: drift, parallax, light, type or UI behavior. Type and UI are live objects, not bitmaps. | a frozen pose; a pasted screenshot | beat map |

Evidence per field: motion event [S: wwdc18; I], camera [S: linear-releases, if-jessica-jones], thread [S: flavien; D: D64], in-between plan [S: ordinary-folk], sound cue [S: buck-2021, flavien], live content [D: D67; S: metrics-study].

## Check

- Every beat has a motion event with a verb of change and a start and an end state. A hold is never the whole beat. [D: D67]
- Every seam has a thread; `motion-studio validate` names each seam without one, and `motion-studio beatmap` prints the thread column. [D: D70]
- The stills at G2 are start and end poses of motion; they do not approve the motion itself. The moving animatic at G3 and the liveness report do. [D: D62, D59]

## Example (15 s launch spot, 30 fps, 120 BPM)

| Beat | Frames | Idea line | Motion event | Camera | Thread | In-between plan | Sound cue | Live content |
|---|---|---|---|---|---|---|---|---|
| 1 | 0-60 | the question is slow to answer | a query types itself into a search field that rises from below on a spring | `push-in`, wide to field | (first beat) | the field's glow brightens and the camera keeps pushing into it | downbeat 0 | caret blinks, camera drifts |
| 2 | 60-120 | the answer arrives in one search | results stream in and reflow under the field; the top result expands | `drift`, left to right | `shared-element-thread`: the search field | the top result lifts toward the camera | beat 60, SFX on expand | list settles, light sweeps the card |
