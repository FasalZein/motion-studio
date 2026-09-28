# motion-studio: design decisions (grilling log)

Sources: research artifacts kept outside the repo (source articles, landscape survey, taste research, skill-reuse inventory, suites survey, two spec reviews).

Environment facts (2026-09-28): no heygen CLI, no video-model keys (FAL/REPLICATE/RUNWAY/etc.), no PEXELS key; GOOGLE_CLOUD_PROJECT + GEMINI_MODEL set. node 26, ffmpeg 8.1.

## Settled

| # | Decision | Answer |
|---|---|---|
| D0 | HeyGen scope | HyperFrames engine + HeyGen catalog via media-use (heygen CLI must be installed + signed in; not installed today) |
| D0b | Standalone vs layer | Standalone studio; may be several skills; CLI wrapper if needed; must be distinct from existing tools |
| D1 | Core | Director system + engine backends: structured project file (brief, style bible, beat map, shot list, asset ledger, gate status) is the contract |
| D2 | Engines | Remotion AND HyperFrames; mixed per shot inside one video; clips joined on the shared timeline |
| D3 | Genres v1 | Product launch/ad, UI morph loop, Explainer/data story, Showreel, Social kinetic-type clip (character/music video deferred) |
| D4 | Human gates | Brief + look; Beat map + storyboard stills; Animatic; Full pass; Final render |
| D5 | Asset sources | HeyGen catalog, product website capture, free stock (Mixkit/Pexels/Google Fonts), code-made, AI image gen, video models (generate-then-trace) — all into one ledger (source, license, path) |
| D6 | Audio | Real audio default (track + real SFX at measured peaks, -14 LUFS), synth fallback; beat grid always required |
| D7 | Look | Named-look library + reference extraction + shared banned-template list |
| D7b | Vocabulary | Add a motion-graphics vocabulary skill in the style of animation-vocabulary |
| D8 | Intake | Grilling rounds until the brief is complete; "use defaults" escape |

| D9 | Skill split | SUPERSEDED by D21. Was: 5+ skills, one per phase |
| D10 | CLI | Bun + TypeScript, deterministic tooling only (status/gates, beats, assets ledger, stills, animatic, contact sheets + pop scan, stitch, audio mix, multi-format render); agent does creative work |
| D11 | Project file | BRIEF.md with XML sections (inputs/direction/structure/build/gotchas/start) + storyboard.json (beats, shots, engine per shot, assets, gates), CLI validates |
| D12 | Engine handoff | Switch engine only on a cut or a verified handoff frame (A last frame == B first frame, CLI pixel diff) |
| D13 | Critique | Separate fresh-context reviewer subagent, fixed per-shot rubric, 3 worst issues, stop at all >= 8 or 3 loops then escalate |
| D14 | Authoring | Write every skill with writing-for-agents (incl. SKILL-MECHANICS.md) |
| D15 | Taste | Research taste complaints on viral posts; study better-ui and similar taste skills; feed rubric + banned list |
| D16 | Taste enforcement | 8-dim rubric (taste-research.md s.3) + CLI transition flags (motioner-style POP/STUTTER/FLASH/GHOST...) before reviewer + persistent cross-project taste profile |
| D17 | UI skills | better-ui / better-typography / better-colors only for fidelity of product UI shown inside a shot; never on film timing or the critique gate |
| D18 | Vocabulary | Self-contained glossary (film + motion-graphics terms), one-line definitions, each mapped to a HyperFrames rule id or Remotion recipe |
| D19 | Video models | Deferred to v2; ledger keeps a slot |
| D20 | Context concern (user) | Do not load many HF/Remotion skills into one agent; prefer subagent-based phases; minimize install requirements |
| D21 | Packaging | 4 visible skills: motion-studio (orchestrator), motion-critique, motion-look, motion-vocabulary. Internal agents/*.md phase briefs (brief, board, assets, build-hyperframes, build-remotion, render) run in fresh subagents; orchestrator holds state + gates only |
| D22 | Engine deps | Suite ships short per-engine contracts and calls CLIs; engine skills optional for deep API lookup by that build subagent; doctor checks CLIs + heygen |
| D23 | Harness | Generalised: pi + Claude Code at minimum; generic dispatch wording, inline sequential fallback when no subagent tool |
| D24 | Formats | Multi-format in v1, chosen at brief; layout function + per-format safe zones; CLI renders each and checks |
| D25 | Names | Repo, orchestrator skill and CLI all `motion-studio`; siblings motion-critique, motion-look, motion-vocabulary |
| D26 | Distribution | Public, MIT, from day one (FasalZein/motion-studio). Copy only MIT/Apache excerpts; unlicensed repos (PDoomVideo, Austerlitz) are reference only. State Remotion company-license requirement |
| D27 | Tracer | Product launch / ad is the first end-to-end acceptance test only; core pipeline stays genre-neutral (user: not building toward this one genre) |
| D28 | Seed looks | 8: keynote minimal, Swiss grid, editorial serif, liquid glass, paper collage, data journalism, retro pixel / PC-98, brutalist mono |
| D29 | Tracking | Authorized: create public repo FasalZein/motion-studio, publish spec + tracer tickets via to-spec / to-tickets; show spec text before publishing |
| D30 | Overfit guard | v1 done only after product launch AND explainer/data story tracers pass every gate with no core-pipeline change; genre rules live in playbooks |
| D31 | Taste profile | Global ~/.motion-studio/taste.json; each project snapshots it for reproducibility |
| D32 | Test seams | (1) CLI black-box on fixture projects; (2) skill evals in pi + Claude Code incl. known-bad critique fixtures; (3) two tracer videos pass every gate |
| D33 | Spec home | docs/SPEC.md in repo (source of truth) + one tracking issue that parents ticket issues |
| D34 | CLI language | TypeScript on Bun, published to npm; Remotion renderer API in-process, hyperframes CLI as subprocess; CI under Bun and Node. One CLI wraps both engines |
| D35 | v1 depth | All 5 genres + 8 looks as compact data + short guidance; 2 tracer genres get worked examples + evals; other genres/looks untested until used (after spec review, Fable vs Astra) |
| D36 | First slice | Mixed-engine integration proof first (Remotion shot + HyperFrames shot, cut + handoff, stitched + mixed, measured frame-exact) |
| D37 | Unknown license | Final render blocks until user acknowledges each unresolved asset or swaps it |
| D38 | Runtime (fact-driven refinement of D34) | HyperFrames CLI requires Node 22+, so Node 22+ is required; CLI authored in TS, developed with Bun, npm package Node-compatible; Bun runtime supported where the packed-CLI render smoke test passes |
| D39 | Delivery order change (user, 2026-09-28) | Ship v0 skills now (guidance-level, calling hyperframes/remotion/ffmpeg directly; contract in docs/v0-contract.md) and start ticket #2 in parallel. Refines D36. heygen v0.8.1 installed and signed in (free plan); media-use doctor passes |
| D40 | Build and test mode (user, 2026-09-28) | Frontier-parallel workers in git worktrees (max 3), merge to main on green after parent inspection; per ticket: worker black-box tests under Node and Bun + independent code review, material findings fixed before merge. After #2-#19 merge, an Opus worker (anthropic/claude-opus-5-5) installs from GitHub, plays director, runs tracers #20 and #21; failures become new tickets |
| D41 | Beat-grid rule for cuts (parent, low-risk, from #4 review) | `validate` checks only `cut` boundaries against the beat grid; handoff seams are exempt; a shot may declare an intentional off-beat cut with a reason (e.g. word-timed cut in an explainer). Matches rubric and playbooks that allow intentional off-beat cuts |
| D42 | entry/exit vs vocabulary (parent, resolves spec contradiction) | `entry`/`exit` stay `cut` or `handoff`; an optional `transition` field holds the motion-vocabulary term for the named move. `camera` and `transition` are vocabulary-controlled |
| D43 | Gate input binding (parent, resolves spec contradiction from #5 review) | A gate binds what it showed plus the inputs whose change the flow table says resets it. Rendered media shown at a gate (animatic, full-pass master, delivery-check files) bind as frozen copies made at approval, never as live files, because a re-render or re-stitch changes bytes without a content change. G1: brief, style bible, frozen look-test stills. G2: beat grid fields (`bpm`, `beatFrames`, `downbeatFrames`, `dropFrames`), `voice`, `beats.json` (the v0 manual grid), `meta.fps`, `meta.durationFrames`, per-shot `id`/`startFrame`/`endFrame` (the beat map), frozen G2 stills; shot descriptions and fill-mode `assets`/`soundCues` do not stale G2. G3: frozen G2 stills, frozen animatic. G4: frozen full-pass master; step 7 polish edits to shots and ledger do not stale G4. G5: shot sources (engine-generated folders inside a shot excluded), ledger, the whole `shots` and `audio` objects, `meta.layouts`, frozen delivery checks (poster, contact sheet, safe-zone report, mix, sync and handoff reports), so the final render is bound to what G5 approved |
| D44 | Stale approvals in validate (parent, from #5 review) | `validate` rejects a stale approval as an error (SPEC test list). Render commands (`render`, `stitch`, `still`, `mix`, `safezone`) run the structural checks without the gate check, because re-rendering after an edit is how a film resumes |
| D45 | Protected-bounds measurement (parent, from #9 review) | `safezone` measures painted pixels: the shot renders once normally and once with only the protected element hidden with `opacity:0`, and the changed pixels give the bounds. This works the same in both engines and needs no page hook. Declared geometry stays for canvas and SVG. An element that paints nothing fails the check |
| D46 | Glitch scan input and context (worker, #8) | `scan` reads the stitched master `renders/<format>/master.mkv` per chosen format and writes `renders/<format>/scan.json` (with the master's SHA-256); `scan <video-file>` scans a lone video for standalone critique, with no context. Declared context is data in `storyboard.json`: seams come from shot boundaries; optional `shots[].holds` and `shots[].effects` are shot-local runs `{start, frames}` (effects add a vocabulary `term`). Context never blocks; a frame-count error is never context; blank frames, flashes and blended frames at a cut stay defects. The blank rule is D47. A declared run (hold or effect) explains a finding only when the finding lies inside it. A seam never explains a pop. A repeat that ends at a seam (an ease-out before the cut) is context at any seam; a repeat that starts at or crosses a seam is context only at a handoff seam. An effect lies inside one shot, so it cannot span a seam: to cut to black across shots, make the black its own shot with an effect. A one-frame flash stays a flash when a uniform gain and offset or a per-cell blend toward white or black explains it (glow, bloom, light leak); otherwise it is a pop. Cell pops less than 3 frames apart form one flag. Known limit: a whole-frame pop needs matching neighbors, so during motion a small pop is only an advisory `cell-pop`, and a pop over a moving area is not found. G5 binds `renders/*/scan.json` with the other delivery checks, not G4, because a report that appears after G4 approval would stale G4. Known limit: the per-cell flash model also accepts a wrong frame in a grey palette or a mostly white or black wrong frame as an advisory flash |
| D47 | Blank rule of the glitch scan (user decision, #8 review) | A flat frame blocks (`blank`) only when it appears suddenly between non-flat frames (content on both sides, and a step of at least the pop threshold into and out of the run), or when a whole shot is flat (the engine rendered nothing; in standalone mode, the whole video). A flat run at the film start or end is not sudden. Flat openings, endings, cuts to a flat color and fades become the advisory kind `flat`. Trade-off: a render fault that leaves the first or last frames flat is only advisory, so the reviewer must read the advisory flags |
| D48 | Paid-generation consent and HeyGen license (parent, from #10/#11 reviews) | Every paid provider call (HeyGen `voice` TTS, the image provider) refuses before any provider call unless `assets resolve` gets `--paid-ok`; the agent passes it only after the user agrees to the cost. HeyGen catalog assets are recorded with license status `unknown`, because neither the catalog reply nor the media-use record states a license, so D37 blocks the final render until the user acknowledges each one |
| D49 | Animatic still timing (parent, from #7 review) | Each animatic frame shows the nearest still of its shot, switching at the midpoint between two stills (ties go to the later still). The entry still starts on the shot's first frame and the exit still ends on its last frame |
| D50 | Render and still layout (parent, from #22 and #7) | Shot clips and `still` images live in `renders/<format>/shots/`, apart from pipeline and delivery outputs; one resolver (`outputsOf`) builds these paths. Board stills go straight to `stills/G2/<format>/<shot-id>-f<frame>.png`. HyperFrames stills render the shot once per format to PNG frames and keep the requested ones, because `hyperframes snapshot` cannot take layout inputs and may call Gemini; revisit when HyperFrames renders a frame range with variables |
| D56 | Unknown vocabulary terms warn (parent, from #12 review) | `validate` and the render commands print a `warning:` for a `camera`, `transition`, `effects[].term` or critique `term` that is neither a glossary id nor `custom:<description>`, and do not fail. Matches the #12 ticket and SPEC flow text; rejecting would block renders over a naming slip. The glossary ships as `dist/vocabulary.json`, built from `skills/motion-vocabulary/terms/` |

Assumptions (low-risk, reversible): storyboard stills are static key frames rendered by the shot's engine and reused as the build start; CLI in Bun + TypeScript inside the repo.

## Open (frontier)
None. User confirmed shared understanding on 2026-09-28.
