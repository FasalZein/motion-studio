---
name: motion-studio
description: Directed film with a storyboard, animatic and gated approvals. Use for a new directed film, resuming a film project from storyboard.json, or recording a gate decision on a film.
---

# Motion studio

Direct a film across HyperFrames and Remotion shots. You are the director and the builder (D78): one agent writes the brief, chooses the direction and builds. The CLI and the film folder hold state; this conversation does not. Read [project layout](reference/project-layout.md) and [storyboard fields](reference/storyboard-schema.md) before the first phase. Engine rules live only in the builder briefs and engine contracts; load them inside a build phase, never here. The motion craft lives in the `motion-direction` skill; each phase brief names the files it loads.

## State and resume

1. For a new film, run `motion-studio init <slug>`. For an existing film, run `motion-studio status films/<slug>` and start at the phase its `next:` line names (the first pending, stale or noted gate). Run `status` again before every gate decision. Without the CLI, use [v0 commands](reference/v0-commands.md) and mark each check it cannot run as unverified. Completion: the next phase and its packet are known.
2. **Independence.** The critique reviewer and skill evals run in a fresh subagent that receives only their packet. When the harness has no subagent tool, tell the user at the start: `This harness runs without independent subagents; every review is non-independent.` Label each such review **non-independent** beside its scorecard until a fresh session or the user reviews it. Completion: every review shown carries its independence label.

## Phase packets

A phase packet is a short list of explicit paths: the brief to load, inputs, outputs and the completion check. Load only what the packet names. After the phase, keep its output paths and check result, and drop its working detail. Hero asset capture and renders may go to a helper subagent with the same packet; you inspect its outputs against the check. Packets up to G1:

| Phase | Load | Inputs | Outputs | Completion check |
|---|---|---|---|---|
| Brief | [agents/brief.md](agents/brief.md), one [playbook](playbooks/) | request, brand URL, `motion-studio taste show` | `BRIEF.md`, `storyboard.json` `meta` | `node evals/check.mjs brief films/<slug>/BRIEF.md` prints `brief ok` (path relative to this skill) |
| Hero assets | [agents/assets.md](agents/assets.md) mode `hero`, `motion-direction` [reference/asset-first.md](../motion-direction/reference/asset-first.md) | `BRIEF.md`, `ledger.json` | `assets/`, `ledger.json` | its hero completion; `motion-studio assets films/<slug> list` shows logo, fonts, palette and real captures |
| Directions | `motion-look` steps 1-4; `motion-direction` `reference/idea-and-structure.md`, `reference/world-and-camera.md` | `BRIEF.md`, hero ledger ids, references | `BRIEF.md` `Direction <n>:` lines, `style-bible.md` when a reference exists, one look-test build brief per direction | 2-3 directions, each with a look taken from the brand (a `motion-look` file only as fallback) and naming the ledger ids of its logo, type, palette and captures |
| Look tests | `agents/build-<engine>.md` for each look test | its build brief | `shots/_look/<look-id>/` | `motion-studio looktest films/<slug> <look-id>` exits 0 for each |
| G1 | [reference/g1.md](reference/g1.md) | brief, ledger, `stills/G1/`, `style-bible.md` | G1 gate record | `motion-studio status` shows the decision |

Later phases use the same packet shape: the brief in `agents/`, the inputs and outputs the flow table names, and the phase brief's completion check.

## Flow and gates

A gate presents the actual artifact, its current input hashes and choices to approve or give notes. Each gate permits at most 3 note rounds per revision; then ask the user to accept, rescope or stop. `use defaults` fills intake gaps and is also a valid G5 decision. Store the decision, notes and round count in `storyboard.json`; never infer approval from silence.

| Phase and artifact | Gate shows | Note re-entry | Reset |
|---|---|---|---|
| Brief (at most 3 intake rounds); assets **hero** (track, logo, type, palette, real captures and site art, voice script); directions from the brand and moving look tests in `shots/_look/<look-id>/` | G1 ([reference/g1.md](reference/g1.md)): full brief, hero assets, 2–3 directions, each a moving look test (clip, poster and passing liveness report from `motion-studio looktest`) with real assets, style-bible take/do-not-take | Brief or look test | G2–G5 |
| Board, engine keyframes, real stills | G2: beat contract table with its thread column (what each seam carries) and the start and end stills of each beat, on a contact sheet built from the hashed stills at presentation time | Named beats in board; keyframes as needed | G3–G5; G2 too if beat time changes |
| Blocking builds (every beat moves with its real timing at placeholder fidelity); render and stitch of the primary format; moving animatic on the real track and narration | G3: playable moving animatic, with its liveness verdict as advice | Board, keyframes or blocking for named shots | G4–G5 |
| Assets **fill**, full build, scan, liveness, critique loop A | G4: full-pass MP4, liveness report and scorecard | Build or board for named shots | G5 |
| Polish, master mix, per-format draft renders, scan, critique loop B | No gate; examine real deliverables | Named defects in build/render | G5 when inputs change |
| License check (D37) and final-render cost approval | G5: poster, contact sheet, safe-zone report, unresolved-license list | Render only | None |
| Final render and bundle | Acceptance of actual files | Render only | None |

Approval binds to a revision. Record every decision with `motion-studio gate films/<slug> <G1-G5> <approve|changes|rescope> --note "<user's words>"`; it stores the decision, notes, round count and the hashes of the gate inputs listed in the CLI's `schema/gate-inputs.json` (D43). G1: brief, style bible, the `look` record without its taste snapshot, look-test stills `stills/G1/`. G2 adds the beat grid, the narration script and word-timing file (when `voice` is set), the beat map (shot ids and frames) and stills, including the contact sheet `stills/G2/<format>/sheet.png` made from them (`motion-studio stills` rebuilds it on every run; rebuild it by hand after any manual still change). G3 adds the animatic. G4 adds the full-pass master; G4 approval also needs a current passing liveness report per format (`motion-studio liveness`, D59), or the director's written waiver (`--waive liveness --note "<reason>"`, D60). G5 adds shot sources (engine output folders inside a shot excluded), ledger, the whole `shots` and `audio` records, layouts (`meta.layouts`), delivery checks and the liveness reports. On approval it freezes what the gate showed (stills, animatic, master, delivery checks) under `stills/approved/<gate>-<hash8>/`, and the approval binds these frozen copies, so a re-render does not stale it; give builders and the reviewer the frozen copies, not the live stills. Shot descriptions, seam threads and fill-mode assets do not stale G2; polish after G4 stales only G5. It refuses a decision while an earlier gate is missing, not approved or stale, and a fourth note round. On resume and before every decision run `motion-studio status films/<slug>`: it recomputes the hashes, shows stale gates with the changed inputs and names the next step. A changed input makes its gate and every later gate stale, and `motion-studio validate` fails until they are presented again; render commands still run; rerun the affected work and present those gates again. Earlier approved gates stay approved. Without the CLI (manual v0 substitute): hash the same inputs with `shasum -a 256`, also hash the look-test sources under `shots/_look/` for G1, record path-to-hex entries in `gates[].inputHashes` with decision and notes, freeze approved still copies under `stills/approved/<gate>-<hash8>/`, and on any changed hash mark its gate and all later gates `stale` by hand (see [v0 commands](reference/v0-commands.md)).

Delegate taste reads and writes to `motion-look` (CLI: `motion-studio taste`): read before recommended brief answers; snapshot at G1; record the chosen look as liked at G1, and a shown-but-passed look as rejected only when its still honored its applied pattern replacements (otherwise as a note); record every gate note with named `motion-vocabulary` terms; record look, signature moves and pacing at acceptance. Use the project snapshot for later renders.

Look tests are not film shots: `storyboard.json` never lists `shots/_look/`, and `validate` and renders ignore it. Keep `shots/_look/` unchanged after G1; the manual gate hashes it, so an edit there stales G1 (the CLI binds the frozen G1 stills instead). When the board assigns the hero shot to the chosen candidate's engine, copy `shots/_look/<look-id>/` to `shots/<shot-id>/` and continue the keyframe build there. For a different engine, rebuild the hero shot with the G1 still as reference. Later edits to `shots/<shot-id>/` do not stale G1. Completion: the hero shot source exists under `shots/<shot-id>/` and G1 hashes still match.

For loops A and B, run technical scan first, then dispatch `motion-critique` in fresh context with the logline, approved frozen stills, look/style bible, beat grid, measured sync report, contact sheet, transition strips, scan and draft. Give the builder only the three worst findings. Stop when every verified score is at least 8, or after 3 loops **per revision**; show score changes per loop and offer accept at current scores, notes, or rescope. Mark unavailable evidence unverified. Manual scan substitutes are in [v0 commands](reference/v0-commands.md) (CLI: `motion-studio scan`, #8).

Before G5, inspect every ledger entry: each `unknown` or `restricted` right needs an explicit user acceptance or a licensed replacement (D37). Show the final render cost before running it. After rendering, show the files and request acceptance. Completion: accepted files match G5 inputs and every open licensing decision is explicit.
