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

Assumptions (low-risk, reversible): storyboard stills are static key frames rendered by the shot's engine and reused as the build start; CLI in Bun + TypeScript inside the repo.

## Open (frontier)
None. User confirmed shared understanding on 2026-09-28.
