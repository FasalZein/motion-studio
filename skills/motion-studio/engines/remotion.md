# Remotion shot contract

This contract owns the shot. Work only inside `shots/<id>/`, or `shots/_look/<look-id>/` for a G1 look test.

## Entrypoint and time

- **Entrypoint:** `shots/<id>/src/index.tsx` (or `index.ts`) calls `registerRoot()` with a root that registers one `<Composition>`. Its `id` is the shot's `entrypoint` in `storyboard.json`. Its `durationInFrames` is `endFrame-startFrame`, its `fps` is the project fps, and frame zero is the shot entry. Static files live in `shots/<id>/public/` and load with `staticFile()`.
- **Imports:** import only `react`, `remotion` and `@remotion/transitions` (with its subpaths, for example `@remotion/transitions/fade`); the CLI bundles the shot with its own copies of these (D54).
- **Time determinism:** drive every pose from `useCurrentFrame()` and props. Use `interpolate()` and closed-form springs, one per target change, and `random(<seed>)` for randomness. Keep no state between frames, and read time only from the frame.
- **Files:** write the component by hand from this contract. The layout comes from the look, the board and the approved stills; `npx create-video` and template projects bring a template layout, so keep them out of the shot.

## Frame

- **Background:** paint it on the component's outer element (for example `<AbsoluteFill style={{backgroundColor:…}}>`) or on a full-bleed first child. A page background (`body`) and an unpainted area stay transparent in the PNG frames the CLI renders. `motion-studio stills` and `render` refuse a frame with any transparent pixel, because a clip or still shows it as black.
- **Composition:** place elements for the look and the board: an asymmetric or edge-anchored layout unless the look names a centered one. Centered text over a flat or gradient fill is a template pattern (`motion-look` `patterns.md`).

## Layout inputs

`motion-studio render` renders every chosen format and passes the input props `{layout:{format, canvas:{width,height}, safe:{x,y,width,height}, overlay}}` (`overlay` is a preset name or `null`). Give the composition `defaultProps` with the primary layout and set its size from the props: `calculateMetadata={({props}) => ({width: props.layout.canvas.width, height: props.layout.canvas.height})}`. The CLI fails when the size, fps or length differs from the storyboard. Place every held text, logo and key UI element inside `layout.safe`; let text wrap to the safe width. Reframe for each format; never assume 16:9.

## Fonts

Keep pinned font files in `public/`. Declare them with `@font-face` and `staticFile('<file>')`, hold the render with `delayRender()` until `document.fonts.load('<size> <family>')` resolves, then call `continueRender()` (`cancelRender()` on failure). In each still, check the font family and the actual glyph shapes: a fallback font shows as different letterforms and line breaks.

## Protected bounds

Mark each protected element with `data-protected="<id>"` (the `protected[].id` in `storyboard.json`) and set `bounds` to `"measured"`. `motion-studio safezone` measures its painted pixels at each held frame: it renders the shot once normally and once with only that element hidden by `opacity:0`, and the changed pixels give the bounds (D45). A child cannot escape this hide, so the bounds include every child. For content drawn inside a `<canvas>` or an SVG shape that shares one element with other content, write declared geometry per format to a JSON file and set `bounds` to its path. List only held frames in `heldFrames`, including every held keyframe pose; entrance and exit travel is allowed. Do not mark full-bleed art as protected.

## Keyframe mode

Build the poses in the component that full mode will extend. Each pose is a local frame: entry (frame 0), each beat, and exit (the last frame). At each pose frame the element positions are final values, not mid-motion values. Put the pose frames in the shot's `stillFrames` and the held pose frames in `heldFrames`.

Completion for a film shot: `motion-studio stills films/<slug> <shot-ids>` and `motion-studio safezone films/<slug> --shots <shot-ids>` both exit 0 for your assigned shots, which proves engine-rendered, opaque stills in every chosen format and protected bounds inside each safe rectangle. Both commands check only the named shots, so they pass while the other engine's shots are unbuilt; the board phase runs the film-wide checks after every builder finishes. A look test is not in the storyboard: from its folder run `npx remotion still src/index.tsx <composition-id> <output.png> --frame=<local-frame>` and save the chosen frame as `stills/G1/<look-id>.png`. This command form is unverified; check `npx remotion still --help` before use.

## Full mode

Open the approved keyframe component and add motion between its poses. Keep its files, element ids, pose values and timing; change an approved pose only for a named gate note. Render frames out of order (for example the last pose, then frame 0, then a middle beat) and check that each frame matches a clean render. Completion: `motion-studio stills films/<slug> <shot-id> --frames <approved still frames>` exits 0, each new still is compared with its frozen copy under `stills/approved/`, and each visible difference cites a named gate note.

## Render

The render phase renders every format with `motion-studio render films/<slug>` once every shot exists. The CLI renders silent frames at each format's canvas; strip audio and normalize with the [media contract](media-contract.md) for any manual render.

## API depth allow-list

Read only these installed files, and only the ones the shot needs. `<skills>` is the installed skill root: `~/.agents/skills` (pi and others) or `~/.claude/skills` (Claude Code); use the one where the file exists.

- `<skills>/remotion-create/video-layout.md` (text sizes; the safe area comes from `layout.safe`)
- `<skills>/remotion-markup/compositions.md`
- `<skills>/remotion-markup/calculate-metadata.md`
- `<skills>/remotion-markup/sequencing.md`
- `<skills>/remotion-markup/timing.md`
- `<skills>/remotion-markup/measuring-dom-nodes.md`
- `<skills>/remotion-render/SKILL.md` (manual renders only)

Every other skill is outside the build. In particular, the `remotion-best-practices` router skill re-plans the video and scaffolds a new project; never invoke it for a shot, and read `remotion-markup` files from the standalone `remotion-markup` folder, not from inside the router.
