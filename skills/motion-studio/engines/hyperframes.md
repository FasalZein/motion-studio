# HyperFrames shot contract

This contract owns the shot. Work only inside `shots/<id>/`, or `shots/_look/<look-id>/` for a G1 look test.

## Entrypoint and time

- **Entrypoint:** the shot's `index.html`, named by `entrypoint` in `storyboard.json` (for example `shots/s02/index.html`). Its root element carries `data-composition-id`, `data-width` and `data-height` (the primary canvas) and `data-duration` (the shot length in seconds), and is sized `width:100%; height:100%`.
- **Timeline:** register one paused GSAP timeline as `window.__timelines["<composition id>"]`, at the end of the `document.fonts.ready` callback, after every tween is added.
- **Time determinism:** each frame is a pure function of shot-local time. Use finite, seek-safe tweens and one closed-form spring per target change. Take randomness from a fixed seed. Read time only from the timeline, never from a clock or a frame loop.
- **Files:** write `index.html` by hand from this contract. Keep every asset local and linked to a ledger id. The layout comes from the look, the board and the approved stills; `hyperframes init` templates bring a template layout, so keep them out of the shot.
- **Catalog motion (D55):** a registry block or component (`npx hyperframes catalog`, `hyperframes add`) may supply motion code: timing, easing and effects. Copy that code into the shot's own elements and layout. The block's layout, placeholder content and sub-composition wiring stay out of the shot; delete the installed block files once their motion is copied.

## Frame

- **Background:** paint it on the first child of the root, a full-bleed element `<div style="position:absolute;inset:0;background:…">`. The CLI renders PNG frames, which leave the page (`html`, `body`) and the root's own background transparent. `motion-studio stills` and `render` refuse a frame with any transparent pixel, because a clip or still shows it as black.
- **Composition:** place elements for the look and the board: an asymmetric or edge-anchored layout unless the look names a centered one. Centered text over a flat or gradient fill is a template pattern (`motion-look` `patterns.md`).

## Layout inputs

`motion-studio render` renders every chosen format. It sets the root's `data-width` and `data-height` to the format canvas in a staged copy of the shot folder and passes the layout as variables: `format`, `canvasWidth`, `canvasHeight`, `safeX`, `safeY`, `safeWidth`, `safeHeight`, `overlay` (empty when none). Declare all eight in `data-composition-variables` on `<html>` with the primary layout as defaults. Read them once with `window.__hyperframes.getVariables()` or use `var(--safeX)` and the other CSS properties. Place every held text, logo and key UI element inside the safe rectangle; let text wrap to the safe width. Reframe for each format; never assume 16:9.

## Handoff seams

At a seam declared `handoff`, motion continues through the seam (D63). Shot A's motion continues one frame past its end, and that frame equals shot B's first frame; B then moves on at the same velocity. `motion-studio handoff` renders that frame: it sets the staged root's `data-duration` one frame longer (`(length + 1) / fps`) and keeps the last rendered frame. Keep every tween, seek function and clip that carries an element across the seam running past the shot's end: a clip whose `data-start` + `data-duration` ends at the shot end is hidden in that frame, so give it a `data-duration` that reaches past the end. When this shot is B, its frame 0 is the pose and motion step the previous shot shows one frame past its end.

## Fonts

Load pinned local font files with `@font-face` (a path relative to the shot, for example `url('Inter.ttf')`), and build the timeline inside `document.fonts.ready`. In each still, check the font family and the actual glyph shapes: a fallback font shows as different letterforms and line breaks.

## Protected bounds

Mark each protected element with `data-protected="<id>"` (the `protected[].id` in `storyboard.json`) and set `bounds` to `"measured"`. `motion-studio safezone` measures its painted pixels at each held frame: it renders the shot once normally and once with only that element hidden by `opacity:0`, and the changed pixels give the bounds (D45). A child cannot escape this hide, so the bounds include every child. For content drawn inside a `<canvas>` or an SVG shape that shares one element with other content, write declared geometry per format to a JSON file and set `bounds` to its path. List only held frames in `heldFrames`, including every held keyframe pose; entrance and exit travel is allowed. Do not mark full-bleed art as protected.

## Keyframe mode

Build the poses on the codebase that full mode will extend. Each pose is a local frame: entry (frame 0), each beat, and exit (the last frame). At each pose frame the element positions are final values, not mid-tween values. Put the pose frames in the shot's `stillFrames` and the held pose frames in `heldFrames`.

Completion for a film shot: `motion-studio stills films/<slug> <shot-ids>` and `motion-studio safezone films/<slug> --shots <shot-ids>` both exit 0 for your assigned shots, which proves engine-rendered, opaque stills in every chosen format and protected bounds inside each safe rectangle. Both commands check only the named shots, so they pass while the other engine's shots are unbuilt; the board phase runs the film-wide checks after every builder finishes. A look test is not in the storyboard: render it with `npx hyperframes check <shot-folder> --at <shot-local-seconds> --snapshots`, inspect the overview frames, and save the chosen frame as `stills/G1/<look-id>.png`. `snapshot --at` is not documented in the installed skill; verify it before use.

## Full mode

Open the approved keyframe source and add motion between its poses. Keep its files, element ids, pose values and timing; change an approved pose only for a named gate note. Seek frames out of order (for example the last pose, then frame 0, then a middle beat) and check that each frame matches a clean render. Completion: `motion-studio stills films/<slug> <shot-id> --frames <approved still frames>` exits 0, each new still is compared with its frozen copy under `stills/approved/`, and each visible difference cites a named gate note.

## Render

The render phase renders every format with `motion-studio render films/<slug>` once every shot exists. For a manual check, run `npx hyperframes check <shot-folder> --snapshots` and inspect the resulting frames. Do not use `--resolution` for another format: it scales and keeps the aspect ratio; it does not reframe. Strip audio and normalize with the [media contract](media-contract.md). The installed render reference supports 24, 30 or 60 fps, not 25: for a 25 fps project, verify a sequence route or change the project fps before G1.

## API depth allow-list

Read only these installed files, and only the ones the shot needs. `<skills>` is the installed skill root: `~/.agents/skills` (pi and others) or `~/.claude/skills` (Claude Code); use the one where the file exists.

- `<skills>/hyperframes-core/SKILL.md` (its note that a root fill survives a normal render does not hold for the CLI's PNG render; use the background child above)
- `<skills>/hyperframes-core/references/minimal-composition.md` (root, clip and timeline structure only; its `body` background and centered `.clip` grid are placeholders that this contract replaces)
- `<skills>/hyperframes-core/references/data-attributes.md`
- `<skills>/hyperframes-core/references/determinism-rules.md`
- `<skills>/hyperframes-core/references/variables-and-media.md`
- `<skills>/hyperframes-cli/references/lint-validate-inspect.md`
- `<skills>/hyperframes-cli/references/preview-render.md`
- `<skills>/hyperframes-animation/rules-index.md` and `<skills>/hyperframes-animation/adapters/gsap.md`
- `<skills>/hyperframes-registry/SKILL.md` and `<skills>/hyperframes-registry/references/discovery.md` (catalog motion only, as above)

Every other skill is outside the build. In particular, the `hyperframes` router skill re-plans the film and scaffolds a new project; never invoke it for a shot.
