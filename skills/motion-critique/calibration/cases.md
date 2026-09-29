# Calibration cases

Score both cases from this file and the two sheets beside it. Each case is a 12-second film at 10 fps with four 3-second shots: s01 frames 0-29, s02 30-59, s03 60-89, s04 90-119. Each sheet is a 1 fps contact page: tile n shows global frame 10n, left to right, then top to bottom. The sheets carry no text; the claims and sources are stated below.

## known-bad
- Sheet: `known-bad.png`. No full-rate strips, no playable clip and no scan report.
- Logline: a recorded temperature fell. The white bar in s03 is the displayed temperature value; it has no cited source, and it runs past the right frame edge.
- Sync report: SFX hits at +2 frames and at -3 frames, the second at the edge of the 3-frame window `mix` searches, so that hit was not found within it; beat-targeted cuts at +3 and -4 frames; integrated -19 LUFS against -14. Audio cannot be heard.

## known-good
- Sheet: `known-good.png`. No full-rate strips, no playable clip and no scan report.
- Look: `data-journalism` (motion-look), with its palette and axis style visible in every shot.
- Non-product data story: monthly rainfall of four cities from a public weather dataset, retrieved 2026-09-01; bars start at a zero baseline. The bars grow in s01 and sort by value in s02. In s03 the wettest city is highlighted and its value callout grows. s04 is the end card that states the claim.
- Sync report: every SFX hit and beat-targeted cut at 0 frames; -14.1 LUFS, true peak -1.3 dBTP. Audio cannot be heard.

Write scores as JSON for `motion-studio calibrate`: `{"cases": {"known-bad": {"film": {"1", "2", "7", "7-audible"}, "shots": {"s01": {"3","4","5","6","8"}, ...}}, "known-good": {...}}}`. Each value is 1 to 10 or `"unverified"`.
