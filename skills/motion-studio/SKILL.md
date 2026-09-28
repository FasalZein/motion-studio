---
name: motion-studio
description: Directed film with a storyboard, animatic and gated approvals. Use for a new directed film, resuming a film project from storyboard.json, or recording a gate decision on a film.
---

# Motion studio v0

Direct a film across HyperFrames and Remotion shots. The project files, not this conversation, carry state. v0 does not require the `motion-studio` CLI; use [v0 commands](reference/v0-commands.md), which name the CLI form where one exists, and mark unavailable automated checks as unverified. Read [project layout](reference/project-layout.md), [storyboard fields](reference/storyboard-schema.md), and [media contract](engines/media-contract.md) before the first phase.

## Dispatch and resume

1. For a new film, create `films/<slug>/` using the project layout. Dispatch a fresh subagent with `agents/brief.md`, the user's request and explicit project paths. For an existing film, read `storyboard.json`, `BRIEF.md` and the ledger; verify gate hashes against current inputs before selecting the first pending or stale phase. Completion: the next phase and its exact input paths are known.
2. Dispatch one fresh subagent per phase with its `agents/<phase>.md` brief, explicit input and output paths, mode, shot ids and the relevant playbook path. Keep engine contracts inside their assigned builders, not the orchestrator. Receive a compact summary and artifact/report paths only; inspect those artifacts against that phase's completion criterion. Completion: the named artifact exists and its check passes or has a stated unverified check.
3. If fresh subagents are unavailable, run the same briefs inline in order and persist every handoff in files. Label inline critique **non-independent** until a fresh session or the user reviews it. Completion: the review independence status appears beside the scorecard.

## Flow and gates

A gate presents the actual artifact, its current input hashes and choices to approve or give notes. Each gate permits at most 3 note rounds per revision; then ask the user to accept, rescope or stop. `use defaults` fills intake gaps and is also a valid G5 decision. Store the decision, notes and round count in `storyboard.json`; never infer approval from silence.

| Phase and artifact | Gate shows | Note re-entry | Reset |
|---|---|---|---|
| Brief (at most 3 intake rounds); assets **hero** (track, logo, type, palette, hero screenshots, voice script); `motion-look` and keyframe look tests in `shots/_look/<look-id>/` | G1: filled brief, 2–3 candidate stills with real assets, style-bible take/do-not-take | Brief or look test | G2–G5 |
| Board, engine keyframes, real stills | G2: beat map and one still per beat | Named beats in board; keyframes as needed | G3–G5; G2 too if beat time changes |
| Entry/exit still animatic on the track | G3: playable animatic | Board or keyframes for named shots | G4–G5 |
| Assets **fill**, full build, scan, critique loop A | G4: full-pass MP4 and scorecard | Build or board for named shots | G5 |
| Polish, master mix, per-format draft renders, scan, critique loop B | No gate; examine real deliverables | Named defects in build/render | G5 when inputs change |
| License check (D37) and final-render cost approval | G5: poster, contact sheet, safe-zone report, unresolved-license list | Render only | None |
| Final render and bundle | Acceptance of actual files | Render only | None |

Approval binds to a revision: hash the exact gate inputs with `shasum -a 256`, record path-to-hex entries in `gates[].inputHashes`, plus decision and notes. G1 inputs include brief, style bible, look-test sources under `shots/_look/` and their `stills/G1/` stills, never a film shot under `shots/<shot-id>/`; G2 adds beat grid, board and stills; G3 adds frozen stills/animatic; G4 adds shot sources, ledger and full pass; G5 adds layouts, mixed drafts and delivery checks. Freeze approved still copies under `stills/approved/<gate>-<hash8>/`. On any changed input hash, mark its gate and all later gates `stale`, withdraw their approvals and rerun the affected work; preserve earlier approved gates. Recompute hashes on resume and before every decision. This is a manual v0 gate substitute (CLI: `motion-studio gate`, #5).

Delegate taste reads and writes to `motion-look`: read before recommended brief answers; snapshot at G1; record the chosen look as liked at G1, and a shown-but-passed look as rejected only when its still honored its applied pattern replacements (otherwise as a note); record every gate note with named `motion-vocabulary` terms; record look, signature moves and pacing at acceptance. Use the project snapshot for later renders.

Look tests are not film shots: `storyboard.json` never lists `shots/_look/`, and `validate` and renders ignore it. Keep `shots/_look/` unchanged after G1; an edit there stales G1. When the board assigns the hero shot to the chosen candidate's engine, copy `shots/_look/<look-id>/` to `shots/<shot-id>/` and continue the keyframe build there. For a different engine, rebuild the hero shot with the G1 still as reference. Later edits to `shots/<shot-id>/` do not stale G1. Completion: the hero shot source exists under `shots/<shot-id>/` and G1 hashes still match.

For loops A and B, run technical scan first, then dispatch `motion-critique` in fresh context with the logline, approved frozen stills, look/style bible, beat grid, measured sync report, contact sheet, transition strips, scan and draft. Give the builder only the three worst findings. Stop when every verified score is at least 8, or after 3 loops **per revision**; show score changes per loop and offer accept at current scores, notes, or rescope. Mark unavailable evidence unverified. Manual scan substitutes are in [v0 commands](reference/v0-commands.md) (CLI: `motion-studio scan`, #8).

Before G5, inspect every ledger entry: each `unknown` or `restricted` right needs an explicit user acceptance or a licensed replacement (D37). Show the final render cost before running it. After rendering, show the files and request acceptance. Completion: accepted files match G5 inputs and every open licensing decision is explicit.
