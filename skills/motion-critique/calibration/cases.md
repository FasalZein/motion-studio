# Calibration cases

Score both cases from this file and the files beside it. Each case is a 12-second film at 10 fps with four 3-second shots: s01 frames 0-29, s02 30-59, s03 60-89, s04 90-119. Each sheet is a 1 fps contact page: tile n shows global frame 10n, left to right, then top to bottom. The sheets carry no text; the claims and sources are stated below. Each case has a liveness report measured on its full-rate film with `motion-studio liveness <video>`. The films were measured as lone videos, so the reports locate still spans by seconds and name no cuts. No seam strips and no clip ship. Judge motion through each seam (global frames 30, 60 and 90) from the report: a seam inside a still span over 0.5 s is frozen, and a seam outside every still span moved at the report's 12 fps sampling.

## case-1
- Sheet: `case-1.png`. Liveness report: `case-1-liveness.json`. No full-rate strips, no playable clip and no scan report.
- Look: `data-journalism` (motion-look), adapted to a dark field with one teal accent.
- Non-product data story: monthly rainfall of four cities from a public weather dataset, retrieved 2026-09-01; bars start at a zero baseline. The bars grow in s01 and sort by value in s02. In s03 the wettest city is highlighted and its value callout grows. s04 is the end card that states the claim. A teal month marker travels along the top edge through the whole film.
- Seam threads: s01 -> s02 `shared-element-thread` (the four bars); s02 -> s03 `shared-element-thread` (the wettest city's bar); s03 -> s04 `shared-element-thread` (the teal accent, from the callout to the end-card line).
- Sync report: every SFX hit and beat-targeted cut at 0 frames; -14.1 LUFS, true peak -1.3 dBTP. Audio cannot be heard.

## case-2
- Sheet: `case-2.png`. Liveness report: `case-2-liveness.json`. No full-rate strips, no playable clip and no scan report. No liveness waiver.
- Logline: a recorded temperature fell. The white bar in s03 is the displayed temperature value; it has no cited source, and it runs past the right frame edge.
- Seam threads: s01 -> s02, s02 -> s03 and s03 -> s04 `beat-cut-thread` (the cut lands on the beat).
- Sync report: SFX hits at +2 frames and at -3 frames, the second at the edge of the 3-frame window `mix` searches, so that hit was not found within it; beat-targeted cuts at +3 and -4 frames; integrated -19 LUFS against -14. Audio cannot be heard.

Write scores as JSON for `motion-studio calibrate`: `{"cases": {"case-1": {"film": {"1", "2", "7", "7-audible"}, "shots": {"s01": {"3","4","5","6","8"}, ...}}, "case-2": {...}}}`. Each value is 1 to 10 or `"unverified"`.
