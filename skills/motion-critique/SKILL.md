---
name: motion-critique
description: Score a rendered video for motion and taste; review a render against its approved board; calibrate taste with known-good and known-bad examples.
---

# Motion critique

Review what the render shows, not what the source code promises. Use the same rubric for every genre. Load the relevant `motion-studio` genre playbook for genre evidence. Use `motion-vocabulary` kebab ids in findings.

## 1. Choose the mode

- **In-studio:** Receive the project path, format, revision hashes, loop number and full packet defined in [evidence-packet.md](evidence-packet.md). Loop A reviews the full pass before G4. Loop B reviews the polished, mixed, per-format drafts. Run `scan` first when the CLI exists. In v0, inspect the equivalent flags in the packet. Verified blank dropouts, fully flat shots, frame-count errors and unintended single-frame pops block review until repaired. Give ambiguous flags to the reviewer as evidence, not automatic failures.
- **Standalone:** Accept any readable video file. Make the accessible packet with [evidence-packet.md](evidence-packet.md). Ask for a brief, board, beat grid or ledger only if available. State that approved-still match cannot be verified without a board; look adherence and intended message cannot be verified without direction; claim provenance and SFX source cannot be verified without a ledger. Score only dimensions supported by readable evidence. A video alone does not establish factual truth or measured sound sync.

**Done when:** The mode, reviewed file and revision (if any), evidence paths, and missing inputs are recorded.

## 2. Prepare evidence and calibrate

Follow [evidence-packet.md](evidence-packet.md) to make real frames and measurements. Verify extracted images open and show the actual render. Read [rubric.md](rubric.md) and dispatch a fresh subagent with [reviewer.md](reviewer.md), the packet paths and the report destination. Send no builder transcript and no expected calibration bands. The reviewer first scores both text calibration cases in its own session and writes the scores in its report header. Compare them with these bands, which only the dispatcher holds:

- **Known bad:** dimensions 1, 2 and 7 below 8; shot s03 dimensions 6 and 8 below 8; audible quality unverified.
- **Known good:** dimensions 1, 2, 3, 4, 5, 6 and 8 at least 8; the measured part of 7 at least 8; audible sound quality unverified.

A case passes when every named below-8 and at-least-8 condition holds and unsupported audible judgment is marked unverified. If either case misses, the run is void: discard its film scores, tell the user which condition missed, and dispatch a fresh reviewer. When dispatch is unavailable, run the same brief inline, write the calibration scores before you compare them with the bands, and label the result **non-independent**. A fresh session or human review is needed to claim independent review.

**Done when:** Each readable packet item is checked, missing evidence is listed, the dispatcher has compared both calibration results with the bands above and neither missed, and review independence is labeled.

## 3. Score and repair

The reviewer scores film-level and per-shot dimensions separately, marks unsupported judgments **unverified**, and writes `critique/loop-<n>.md` in-studio. For standalone work, write the same format to a user-selected location or return it in chat. Include three worst actionable issues and one match, drift or departure line per approved still. Use [reviewer.md](reviewer.md) for the output contract. A score is not approval: present the result at the relevant gate.

In-studio, repair the three worst issues through the builder, render again, regenerate the packet, and use a fresh reviewer. Keep the result bound to the input revision hashes. Changes to inputs stale the affected gate and later gates; consult `motion-studio` for reset rules. Stop when every verified applicable dimension is at least 8 **and** no required judgment remains unverified, or when 3 loops for that revision are used. If evidence is unreadable, seek a readable source or human review rather than treating an unverified dimension as a pass.

**Done when:** A report identifies each score's evidence and every unverified check; a new render was measured after each repair or the loop stopped.

## 4. Escalate when needed

On loop 3 without a verified pass, show the scorecard and the delta from each prior loop. Offer **accept at current scores**, **give notes**, or **rescope**. Notes start a new revision only after changed inputs are recorded; never silently reset the budget on an unchanged render. `motion-studio` owns gates and approvals. Standalone review ends with its report, not an approval.

**Done when:** The user sees the current scores, per-loop changes, unresolved checks and the three explicit options, or all dimensions pass.
