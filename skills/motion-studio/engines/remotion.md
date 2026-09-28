# Remotion shot contract

Work only inside `shots/<id>/`. Entrypoint: the registered `<Composition id>` in its Remotion project. Its duration is `endFrame-startFrame`, and frame zero is the shot entry. Drive poses from `useCurrentFrame()` and local props, including format dimensions, safe rectangle, overlay and ledger asset paths. Keep animations seek-safe; use deterministic time functions and closed-form springs, one per target change. Keep pinned font files local in `public/`; load with `@remotion/fonts` `loadFont()` and await readiness before rendering.

In keyframe mode, make entry, beat and exit poses in the **same component** that full mode extends. Export held protected DOM bounds through a measured still/check pass; declare geometry for canvas/SVG. In full mode, preserve approved poses and add motion between them. Pass layout props for each chosen format and check wrapping, safe rectangles and actual font rendering.

Run `npx remotion still <entrypoint> <output.png> --frame=<local-frame>` and `npx remotion render <entrypoint> <output.mp4>` **from the shot project**; exact CLI arguments and the render's audio-disable/frame-range flags require verification against the installed CLI help before use. Prefer a silent composition and strip audio during normalization per [media contract](media-contract.md). Use the composition's registered fps/duration/dimensions for each format.

**API depth allow-list (installed paths only):** `<skills>` is the installed skill root: `~/.agents/skills` (pi and others) or `~/.claude/skills` (Claude Code); use the one where the skill exists. `<skills>/remotion-create/SKILL.md` and `video-layout.md`; `<skills>/remotion-render/SKILL.md`; `<skills>/remotion-best-practices/remotion-markup/{compositions,sequencing,timing,local-fonts,measuring-dom-nodes}.md`. Read only applicable files. The `remotion-best-practices` router is not a build input; this contract owns the shot.

Completion: each requested local frame renders, protected held bounds fit each layout, and normalized video passes the media contract.
