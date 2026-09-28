# motion-studio CLI: two-engine media seam

Requires Node 22+, ffmpeg, ffprobe, and Chromium. Develop with Bun 1.4.0. Install with `npm install`, then run `npm run build`. For a packaged install, run `npm pack` and install the tarball in a project.

Commands:

- `init <slug>` creates `films/<slug>/` in the current directory with `assets/`, `shots/`, `stills/`, `renders/`, `audio/`, `critique/`, an empty valid `storyboard.json`, an empty `ledger.json` and a `BRIEF.md` with the XML sections inputs, direction, structure, build, gotchas and start. It never overwrites an existing folder.
- `validate <film-dir>` checks `storyboard.json` and `ledger.json` against `schema/storyboard.schema.json` and `schema/ledger.schema.json`, then checks cross-references: engine entrypoints exist, every asset id is in the ledger, every ledger file exists with the recorded SHA-256, shot ranges are half-open and contiguous from frame 0 to `meta.durationFrames`, each `cut` between shots falls on `audio.beatFrames` when a beat grid exists (handoff seams and shots with an `offBeatCut` reason are exempt), handoffs are declared on both sides of a seam, and still frames are inside their shot. It exits 1 and prints one `error:` line per problem.
- `status <film-dir>` prints each gate state (G1 to G5) and the next step. On a film with cross-reference errors it adds a `validation: N errors` line and still exits 0; only a schema or JSON failure exits 1.

Expected failures (usage, invalid project, init refusal, media checks) print `error: <message>` lines without a stack trace.
- `render <film-dir>`, `stitch <film-dir>` and `still <film-dir> <shot-id> [local-frame]` read the shots from `storyboard.json`. They validate the project first and write nothing when it is invalid.

Outputs live in the film's `output/` directory. `still` renders a PNG at the given zero-based shot-local frame (default 0). `render` creates video-only FFV1 Matroska clips and a `render.json` success marker that lists the rendered shot ranges. `stitch` checks the clips and creates the video-only master. Handoff comparison and mixing are separate work.

The storyboard fields are described in `skills/motion-studio/reference/storyboard-schema.md` and defined by the JSON Schemas. `meta.fps` is 24, 25, 30 or 60. `meta.canvas` gives the master width and height. Each shot has `startFrame` and `endFrame` (half-open) and an `engine` (`remotion` or `hyperframes`). A HyperFrames `entrypoint` is an HTML file under `shots/<id>/`. A Remotion `entrypoint` is the composition id; its entry file is `shots/<id>/src/index.ts` or `src/index.tsx` and its public directory is `shots/<id>/public/`. Remotion composition dimensions, frame rate and duration must equal the canvas, fps and shot range. HyperFrames compositions set their dimensions and duration in HTML. See `fixtures/two-engine/` for a working film folder.

Both engines produce PNG frame sequences, then ffmpeg encodes the same lossless FFV1/yuv444p/BT.709 intermediate. The CLI requires a successful render marker for stitching and invalidates it before every rerender. A failed rerender cannot stitch stale clips. A test-only `MOTION_STUDIO_CHILD_TIMEOUT_MS` overrides the 120-second subprocess timeout. The CLI verifies frame count, dimensions, color tags and ordered presentation timestamps in both clips and the stitched master. Matroska timestamps have millisecond precision, so checks allow 0.6 ms rounding error. Engine audio is not included. The fixture includes one OFL-licensed IBM Plex Sans local font, recorded in its ledger, and the same color patch in both compositions; the font license is in `fixtures/two-engine/assets/OFL.txt`.

Run `npm run typecheck` and `npm test` (it builds and packs first, then runs the suite under the Node and Bun test runners) for the process-level fixture checks under both Node and Bun. Remotion's company license is required for companies with more than three people.
