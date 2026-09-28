# Critique evals

Paired fixtures (SPEC seam 2): off-beat SFX, default look, slideshow pace, effect stack and a non-product data story. Each pair shares a shot layout; the bad side damages one dimension. Standalone mode is covered by the CLI test `cli/test/critique.test.ts` (the packet of a lone video lists every impossible check).

1. Regenerate the sheets with `sh build-sheets.sh` if you change them (ffmpeg only).
2. For each side of each pair in `cases.json`, dispatch a fresh reviewer with `../reviewer.md`, `../rubric.md`, the sheet, the named `sync` object as `sync.json` and the context line (plus the ledger line for `data-story`). Never give it `expect.json` or the other side.
3. Collect its scores and worst issues into one file: `{"cases": {"<pair>/<bad|good>": {"film": {...}, "shots": {...}, "worstIssues": [{"shot", "frame", "term", "repair"}]}}}`.
4. Grade with `motion-studio calibrate scores.json expect.json`. Exit 0 means every side lands in its band and every bad side names the damaged shot and frame.
5. Repeat 3 times per harness (pi, Claude Code) and record the model and harness configuration beside the scores.
