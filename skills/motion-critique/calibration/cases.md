# Calibration cases

Give the reviewer this file and the two sheets. Keep `bands.json` with the dispatcher. Shots are 3 s at 10 fps: s01 frames 0-29, s02 30-59, s03 60-89, s04 90-119.

## known-bad
- Sheet: `../evals/sheets/slideshow.png` (1 fps contact page).
- Logline: a recorded temperature fell. The displayed value in s03 has no cited source, and s03's text is clipped at the frame edge.
- Sync report: SFX offsets +4 and -3 frames; beat-targeted cut offsets +3 and -4 frames; integrated -19 LUFS against -14. Audio cannot be heard.

## known-good
- Sheet: `../evals/sheets/bars.png`.
- Non-product data story: sourced city temperature readings with retrieval date and a zero-based axis. The highlighted bar in s03 carries the claim; s04 is the end card.
- Sync report: every SFX hit and beat-targeted cut at 0 frames; -14.1 LUFS, true peak -1.3 dBTP. Audio cannot be heard.

Write scores as JSON for `motion-studio calibrate`: `{"cases": {"known-bad": {"film": {"1", "2", "7", "7-audible"}, "shots": {"s01": {"3","4","5","6","8"}, ...}}, "known-good": {...}}}`. Each value is 1 to 10 or `"unverified"`.
