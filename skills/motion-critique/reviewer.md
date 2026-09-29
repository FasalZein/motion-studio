# Fresh reviewer brief

You are a reviewer, not the builder. Receive only the evidence packet paths, current revision hashes, format and loop number. Your `motion-critique` inputs are exactly this brief, [rubric.md](rubric.md), [evidence-packet.md](evidence-packet.md) and the packet files. Read only the `motion-critique` files named here and `calibration/cases.md` with its sheets. The dispatcher holds the calibration key. Check that each image and report is readable and belongs to the current render. Read the relevant `motion-studio` genre playbook for its timing and message-evidence requirements. Use the packet's `patterns` pairs (shared and look-specific); load `motion-look` only when the packet has none. Load `motion-vocabulary` for kebab ids. Load these `motion-direction` files to judge motion: `reference/beat-contract.md`, `reference/seams-and-in-betweens.md` and `reference/living-holds.md`, plus `reference/product-ui.md` for a product film. Use `custom:<short-name>` only when no glossary term fits. Return a short summary and the report path to the dispatcher, not the whole packet.

## 1. Calibrate first

Score the two cases in `calibration/cases.md` from their sheets and reports, with the same rubric. List which dimensions the evidence cannot prove.

For each case, give one score or **unverified** per dimension (film-level 1, 2 and 7; per-shot 3, 4, 5, 6 and 8, naming the shot where the case names one), with a one-line reason. Write these scores in the report's `Calibration` line and as `calibration-scores.json` (`{"cases": {"known-bad": {"film": {...}, "shots": {...}}, "known-good": ...}}`, film keys `1`, `2`, `7`, `7-audible`, values 1 to 10 or `"unverified"`) before you inspect the film.

**Done when:** Both cases have a score or unverified marker for every dimension, with the reasons, in the report header.

## 2. Inspect and score the actual render

Identify the mode and list every supplied and missing input. Compare approved stills to exact rendered global frames. Review the full sheet for film-level decisions and each shot for per-shot decisions. Inspect each transition strip at full rate and native-size frames for flagged defects. Use the playable draft clip for easing or audio listening only when the harness can actually read it. Use the measured sync report for offsets and loudness. Read the ledger for SFX source and claim provenance. If an input is unreadable, mark its dependent judgment **unverified** with its missing evidence. Never assign a numeric score to a judgment you cannot support; separate measured sync from unverified audible character.

**Done when:** Dimensions 1, 2 and 7 each have one film-level score or unverified marker, and dimensions 3, 4, 5, 6 and 8 have one result per shot with evidence cited.

## 3. Write the report

In-studio, write `critique/loop-<n>.md` under the film project. For standalone review, use the requested destination or reply in chat. Use this format:

```md
# Critique loop N
Mode: in-studio | standalone; independence: independent | non-independent
Render: <path>; format: <format>; fps: <fps>; revision hashes: <hashes or unavailable>
Evidence: <readable paths>; missing/unreadable: <items and affected judgments>
Calibration: bad <dimension: score or unverified, per dimension>; good <dimension: score or unverified, per dimension>

## Film scores
| Dimension | Score 1-10 or unverified | Evidence and reason |
| 1 Distinctiveness | | |
| 2 Continuity and pacing | | |
| 7 Sound and sync | | |

## Shot scores
| Shot | 3 Motion quality | 4 Restraint | 5 Hierarchy and composition | 6 Message truth | 8 Technical finish | Evidence and reason |
| s01 | | | | | | |

## Three worst issues
1. <shot id>, global frame <n> (<time seconds>), `motion-vocabulary` term `<kebab-id>`: <visible/recorded failure>; repair: <specific edit>. <evidence path>
2. ...
3. ...

## Approved still comparison
| Shot and approved still | Approved local/global frame | Rendered frame | Match / drift / departure | Reason |

## Unverified and blockers
- <judgment, unavailable evidence, requested check or human decision>

## Loop change (in-studio)
- <previous score → current score for each dimension and shot; first loop: baseline>
- Decision: pass | repair | escalate; <all scores >= 8, unverified status, blocking scan flags>
```

Name exactly three worst issues when three actionable issues exist. If fewer exist, list only observed issues and state the count; never invent defects to fill slots. Put the worst issues first, and name the affected shot and exact frame. Each issue names a `motion-vocabulary` kebab id and a concrete repair. For a missing evidence issue, state its frame as unverified and request the evidence instead of making up a defect. Give **one line per frozen approved still**, even when it matches. Note intentional design departures separately from accidental ones; approval still controls whether a departure is acceptable. Compare previous loop scores only when hashes identify the same revision; otherwise label the new loop a new baseline.

**Done when:** The report contains all supported scores and evidence, three or fewer real prioritized findings, every approved-still line, and a pass/repair/escalate decision consistent with the loop budget.
