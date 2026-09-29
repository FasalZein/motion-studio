---
name: motion-critique
description: Score a rendered video for motion and taste; review a render against its approved board; calibrate the reviewer on scored cases.
---

# Motion critique

Review what the render shows, not what the source code promises. Use the same rubric for every genre. Load the relevant `motion-studio` genre playbook for genre evidence. Use `motion-vocabulary` kebab ids in findings.

## 1. Choose the mode

- **In-studio:** Receive the project path, format, revision hashes, loop number and full packet defined in [evidence-packet.md](evidence-packet.md). Loop A reviews the full pass before G4. Loop B reviews the polished, mixed, per-format drafts. Run `scan` first when the CLI exists. In v0, inspect the equivalent flags in the packet. Verified blank dropouts, fully flat shots, frame-count errors and unintended single-frame pops block review until repaired. Give ambiguous flags to the reviewer as evidence, not automatic failures.
- **Standalone:** Accept any readable video file. Make the accessible packet with [evidence-packet.md](evidence-packet.md). Ask for a brief, board, beat grid or ledger only if available. State that approved-still match cannot be verified without a board; look adherence and intended message cannot be verified without direction; claim provenance and SFX source cannot be verified without a ledger. Score only dimensions supported by readable evidence. A video alone does not establish factual truth or measured sound sync.

**Done when:** The mode, reviewed file and revision (if any), evidence paths, and missing inputs are recorded.

## 2. Prepare evidence and calibrate

In-studio, run `motion-studio packet <film-dir> [format]` after `sheet`, `scan`, `mix` and `liveness`: it writes `critique/packet-<format>/packet.json` with the logline, look, the shared and look-specific pattern pairs, still pairs (each frozen approved still beside the exact rendered frame of a current G2 approval), sheets, strips, current scan flags, beat grid, sync report, the liveness report with the content-basis moving share and the dimension 2 cap it sets, each seam with its thread and a strip around it, a strip inside each still span over 0.5 s, the dimension 7 score from the rubric rule and a `missing` list. Standalone, run `motion-studio packet <video-file> --out <dir>` with a new or empty `<dir>`; it also measures liveness and adds the hold strips; its `impossible` list names every check a lone video cannot support. Follow [evidence-packet.md](evidence-packet.md) for anything the packet lists as missing. Verify extracted images open and show the actual render. Read [rubric.md](rubric.md) and dispatch a fresh subagent with [reviewer.md](reviewer.md), the packet paths and the report destination. Send no builder transcript and no expected calibration bands. The reviewer first scores both calibration cases in [calibration/cases.md](calibration/cases.md) in its own session and writes the scores as JSON. Check them with `motion-studio calibrate <scores.json> evals/calibration-bands.json`; only the dispatcher reads the `evals/` folder. If `calibrate` exits 1, the run is void: discard its film scores, tell the user which condition missed, and dispatch a fresh reviewer. When dispatch is unavailable, run the same brief inline, write the calibration scores before you compare them with the bands, and label the result **non-independent**. A fresh session or human review is needed to claim independent review. A non-independent report cannot approve G4 on its own: the director approves it with `gate <film-dir> G4 approve --waive critique --note "<reason, e.g. no subagent tool in this harness>"`, and the report must still name the current packet and master hash (D79).

**Done when:** Each readable packet item is checked, missing evidence is listed, `calibrate` exited 0 on both calibration cases, and review independence is labeled.

## 3. Score and repair

The reviewer scores film-level and per-shot dimensions separately, marks unsupported judgments **unverified**, and writes `critique/loop-<n>.md` in-studio. For standalone work, write the same format to a user-selected location or return it in chat. Include three worst actionable issues and one match, drift or departure line per approved still. Use [reviewer.md](reviewer.md) for the output contract. A score is not approval: present the result at the relevant gate.

In-studio, repair the three worst issues through the builder, render again, regenerate the packet, and use a fresh reviewer. Keep the result bound to the input revision hashes. Changes to inputs stale the affected gate and later gates; consult `motion-studio` for reset rules. Stop when every verified applicable dimension is at least 8 **and** no required judgment remains unverified, or when 3 loops for that revision are used. If evidence is unreadable, seek a readable source or human review rather than treating an unverified dimension as a pass.

**Done when:** A report identifies each score's evidence and every unverified check; a new render was measured after each repair or the loop stopped.

## 4. Escalate when needed

On loop 3 without a verified pass, show the scorecard and the delta from each prior loop. Offer **accept at current scores**, **give notes**, or **rescope**. Notes start a new revision only after changed inputs are recorded; never silently reset the budget on an unchanged render. `motion-studio` owns gates and approvals. Standalone review ends with its report, not an approval.

**Done when:** The user sees the current scores, per-loop changes, unresolved checks and the three explicit options, or all dimensions pass.
