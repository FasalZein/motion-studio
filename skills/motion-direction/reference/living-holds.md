# Living holds and liveness

## A hold is a living hold

- A hold gives the viewer time to read or listen. During it, something keeps moving: camera drift, parallax layers, a light sweep, type or UI behavior. A hold is part of a beat with a motion event, never a replacement for one. [D: D67; S: linear-releases, metrics-study]
- Name the living element of every hold in the beat contract (`live content`). [I]
- Size a hold to reading time, then check the liveness limits below. [I]
- World-class pieces keep something on screen moving at every sample; transitions are moving events, not fades to a hold. [S: metrics-study]
- Idle elements breathe: an element on screen for a while gets a small continuous motion. [S: remotion-motion-graphics]

## What keeps each style alive

Observations from the reference pieces, all [S: metrics-study]; copy the mechanism that fits your style:

- **Type-led titles**: the type is the camera subject; letters scale past the frame and a glow or light sweep moves on every frame, with almost no camera motion.
- **Collage**: background layers scroll at another speed than the figure.
- **3D brand film**: one camera move continues through the architecture, so each shot ends where the next begins.
- **3D product spot**: every shot has its own object move plus a light change, and cuts land while the object moves.
- **2D character film**: shapes morph into the next scene and characters keep moving inside each scene.
- **The slideshow we replace**: a headline plus a screenshot per scene, elements slide in and stop, then the frame holds for seconds with no camera, no motion inside the screenshot and no shared element into the next scene.

## Liveness limits (D59)

`motion-studio liveness` measures each stitched master. G4 approval refuses a failing report unless the director writes a waiver (D60). The limits, on the content basis (black spans and one trailing end card of 0.5 s or more left out):

| Measure | Limit | What it means for a builder |
|---|---|---|
| Moving share | at least 75 % | at least three of every four samples move |
| Content time in still spans over 0.5 s | at most 10 % | short settles are fine; frequent half-second stops are not |
| Content time in still spans over 1 s | at most 5 % | in a 15 s film, one 1 s still span already costs about 7 % |
| Content time in still spans over 2 s | at most 4 % | long stills are almost absent in the reference set |
| Longest still span | at most 2 s under 90 s; at most 3 s from 90 s | no single reading hold may freeze longer |

Advisory only: longest motion run (reference minimum 3.33 s), share of cuts with motion on both sides (0.70 or more with 5 or more cuts), cut rate and onsets per second. Many onsets with short motion runs is the burst-and-hold pattern of a slideshow. [D: D59; S: metrics-study]

A sample moves when its mean luma change is above the noise floor or more than 0.05 % of pixels change by more than 6/255 (320x180 luma at 12 fps). A slow drift or a light change passes; a sub-pixel wobble may not. Check the report, not a guess. [D: D59]

## Fixing a failing span

The report lists each still span over 0.5 s by shot and film frame. Fix it with motion inside the span (drift, parallax, light, type or UI behavior), not by shortening the film around it. [D: D59, D67]
