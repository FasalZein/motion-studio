# World and camera

## One persistent world

- Build the film as one space the camera moves through. What the viewer has seen stays where they left it; new material joins the space instead of replacing it. [S: video-storytelling]
- A new blank scene per beat makes the viewer restart comprehension each time. That is the slideshow failure. [S: video-storytelling, ordinary-folk]
- Fix a spatial grammar early (for example left to right is progress) and keep it. Break it once, on purpose, for meaning. [S: video-storytelling]
- For a shot per engine, the world continues across the seam through its thread (see [seams](seams-and-in-betweens.md)). [I]

## The camera as a character

- Give every shot a camera move with a start pose and an end pose. The camera has intent: it looks closer, reveals, follows or pulls back to pay off. [S: linear-releases, if-jessica-jones; I]
- `locked-off` is a choice with a written reason, for example a type moment where the letters themselves travel. When the camera is locked off, something else in the frame must carry the motion. [I; D: D67]
- Move between adjacent altitudes: world (orientation, payoff), region (most of the runtime), detail (one number, one state change). Jump from detail to world only as a deliberate payoff. [S: video-storytelling]
- Two moves in a row on the same subject read as a glitch; make it one move. [S: video-storytelling]
- A camera move and a full-frame wipe run in sequence, not at the same time. [S: video-storytelling]

## Camera language

Use the `motion-vocabulary` camera ids in `shots[].camera`. The common moves:

| Move | Use it for | Evidence |
|---|---|---|
| `drift` | a slow continuous move that keeps a reading beat alive | [S: linear-releases] |
| `push-in` | look closer at the part the viewer already understands | [S: video-storytelling, linear-releases] |
| `punch-in` | a fast, beat-locked snap to one detail | [S: raycast-its-out] |
| `parallax` with `pan` or `truck` | a parallax pan: layers at different depths move at different speeds | [S: linear-releases, metrics-study (Mad Men collage)] |
| `zoom-through` | pass through an object into the next space; also a seam | [S: som-transitions] |
| `pull-out` | the payoff: everything built so far is still there | [S: video-storytelling] |

`shots[].camera` holds one id; name a combined move in the description. Recipes per engine are in `motion-vocabulary` `terms/camera.md`; write `custom:<description>` for a move without a term.

## Camera share is not the goal

A world-class film can move with almost no camera motion (Stranger Things 3 titles: light, type scale and glow move instead). The rule is that the frame keeps moving, not that the camera always does. [S: metrics-study]
