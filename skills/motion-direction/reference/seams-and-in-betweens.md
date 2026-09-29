# Seams, threads and in-betweens

A seam is the boundary between two shots. Its entry is a `cut` or a `handoff`. Every seam carries a thread; a seam that carries nothing restarts the viewer. [D: D64, D70]

## Threads

Name each seam's thread in `shots[].thread` as `{"kind", "shared"}`, with a kind from `motion-vocabulary` `terms/threads.md`. [D: D70]

| Kind | The seam carries | Evidence |
|---|---|---|
| `shared-element-thread` | the same object across the seam | [S: wwdc24] |
| `shape-match-thread` | a new object takes the old silhouette | [S: flavien, macbook-match] |
| `movement-match-thread` | motion in the same direction and speed | [S: flavien, wwdc18] |
| `camera-direction-thread` | the camera keeps its travel direction | [S: linear-releases; I] |
| `light-thread` | a light sweep, glow or grade carries over | [S: metrics-study (Stranger Things 3, Chipotle grade shifts)] |
| `sound-thread` | a sound event bridges the seam | [S: flavien] |
| `beat-cut-thread` | a cut on a beat, with motion on both sides | [S: raycast-its-out, flavien] |

Write `shared` as the concrete thing ("the blue search field"), not a category.

## Seam moves

- **Match cut**: match shape, movement or sound so two shots read as one. [S: flavien, macbook-match, som-transitions]
- **Morph**: one form becomes the next (a ball becomes a wheel). Morph inside one shot when both forms live in one engine. [S: metrics-study (Blend Is Near), som-transitions]
- **Cut on action**: cut during a move; the incoming shot continues it. [S: som-transitions]
- **Beat cut with motion on both sides**: a hard cut is valid when it lands on a beat and both sides move at the cut. The liveness report measures the share of such cuts (advisory 0.70 or more with 5 or more cuts). [S: raycast-its-out, flavien; D: D59]
- **Zoom-through**: pass through an object into the next space. [S: som-transitions]
- A `straight-cut` with no motion on either side is the disconnected cut; use it only when the board states why the break serves the idea. [I; D: D64]
- An engine switch is a seam like any other: prefer a threaded seam (shared element, shape match or movement match), and a beat cut with motion on both sides when no shared pose exists. [S: flavien (2D/3D match cuts); I]

## Handoff through motion

- In a `handoff`, shot B's first frame equals the frame shot A would show next, so pose and velocity carry through the seam. The element keeps moving. [D: D63, D73]
- Write the seam pose and velocity (direction and pixels per frame) in both shots' descriptions; `motion-studio handoff` checks it. A velocity jump or a pose jump fails. [D: D63]
- Motion must be a function of absolute time, not of the shot's duration, or the seam fails as `duration-dependent`. [D: D73]

## Design the in-between

- The named failure is "style frame, transition, style frame": pretty poses joined by fades. [S: ordinary-folk]
- Design how the frame travels from one beat's pose to the next as motion in its own right. Write it as the **in-between plan** of the beat contract. [S: ordinary-folk]
- A beat's end pose is the start of the next move, not a resting place: the next move starts before the last one settles (overlap). [S: wwdc18 (seamless motion); I]
- Enter and leave consistently: an object leaves the way it came, and the next shot starts where the last one ended. [S: wwdc18 (spatial consistency)]
- A cross-dissolve is a fallback, not a thread: two images blend, nothing travels. Prefer a move that carries a shared thing. [S: video-storytelling; I]
