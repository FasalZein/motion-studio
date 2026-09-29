# Critique evals

This folder is for the dispatcher and grader only: it holds the answer keys `expect.json` and `calibration-bands.json`.

Paired fixtures (SPEC seam 2): off-beat SFX, default look, slideshow pace, effect stack and a non-product data story. Each pair shares a shot layout; the bad side damages one dimension. Standalone mode is covered by the CLI test `cli/test/critique.test.ts` (the packet of a lone video lists every impossible check).

1. Regenerate the sheets with `sh build-sheets.sh` if you change them (ffmpeg only). It also writes the two calibration sheets in `../calibration/`, which are separate films from the eval sheets, so a reviewer's calibration step shows no eval answer.
2. For each side of each pair in `cases.json`, dispatch a fresh reviewer with `../reviewer.md`, `../rubric.md`, the sheet, the named `sync` object as `sync.json` and the context line (plus the ledger line for `data-story`). Never give it `expect.json` or the other side. Check its calibration scores with `motion-studio calibrate calibration-scores.json calibration-bands.json`; on exit 1, discard that side and dispatch a fresh reviewer.
3. Collect its scores and worst issues into one file: `{"cases": {"<pair>/<bad|good>": {"film": {...}, "shots": {...}, "worstIssues": [{"shot", "frame", "term", "repair"}]}}}`.
4. Grade with `motion-studio calibrate scores.json expect.json`. Exit 0 means every side lands in its band and every bad side names a damaged shot with a frame inside it. An `issue` list accepts a finding at any one of its places, for damage that spans several shots.
5. Repeat 3 times per harness (pi, Claude Code) and record the model and harness configuration beside the scores.
