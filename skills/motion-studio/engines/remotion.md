# Remotion shot contract

Work only inside `shots/<id>/`. Entrypoint: the registered `<Composition id>` in its Remotion project. Its duration is `endFrame-startFrame`, and frame zero is the shot entry. Drive poses from `useCurrentFrame()` and props. Keep animations seek-safe; use deterministic time functions and closed-form springs, one per target change. Keep pinned font files local in `public/`; load with `@remotion/fonts` `loadFont()` and await readiness before rendering.

**Layout inputs.** `motion-studio render` renders every chosen format and passes the input props `{layout:{format, canvas:{width,height}, safe:{x,y,width,height}, overlay}}` (`overlay` is a preset name or `null`). Give the composition `defaultProps` with the primary layout and set its size from the props: `calculateMetadata={({props}) => ({width: props.layout.canvas.width, height: props.layout.canvas.height})}`. The CLI fails when the size differs from the format canvas. Place every held text, logo and key UI element inside `layout.safe`; let text wrap to the safe width. Reframe for each format; never assume 16:9.

**Protected bounds.** Mark each protected element with `data-protected="<id>"` (the `protected[].id` in `storyboard.json`) and set `bounds` to `"measured"`. `motion-studio safezone` measures its painted pixels at each held frame: it renders the shot once normally and once with only that element hidden by `opacity:0`, and the changed pixels give the bounds (D45). A child cannot escape this hide, so the bounds include every child. For content drawn inside a `<canvas>` or an SVG shape that shares one element with other content, write declared geometry per format to a JSON file and set `bounds` to its path. List only held frames in `heldFrames`; entrance and exit travel is allowed. Do not mark full-bleed art as protected.

In keyframe mode, make entry, beat and exit poses in the **same component** that full mode extends. In full mode, preserve approved poses and add motion between them. Check wrapping, safe rectangles and actual font rendering in every format.

Run `npx remotion still <entrypoint> <output.png> --frame=<local-frame>` and `npx remotion render <entrypoint> <output.mp4>` **from the shot project**; exact CLI arguments and the render's audio-disable/frame-range flags require verification against the installed CLI help before use. Prefer a silent composition and strip audio during normalization per [media contract](media-contract.md). Use the composition's registered fps/duration/dimensions for each format.

**API depth allow-list (installed paths only):** `~/.agents/skills/remotion-create/SKILL.md` and `video-layout.md`; `~/.agents/skills/remotion-render/SKILL.md`; `~/.agents/skills/remotion-best-practices/remotion-markup/{compositions,sequencing,timing,local-fonts,measuring-dom-nodes}.md`. Read only applicable files. The `remotion-best-practices` router is not a build input; this contract owns the shot.

Render all formats with `motion-studio render films/<slug>` and check them with `motion-studio safezone films/<slug>`.

Completion: each requested local frame renders, `motion-studio safezone` passes for every format, and normalized video passes the media contract.
