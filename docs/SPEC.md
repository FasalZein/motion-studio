# motion-studio: specification

Status: approved v2 (2026-09-28). Decision log: `docs/DECISIONS.md` (D0-D38). v2 applies the findings of two independent spec reviews (Astra, Fable).

## Problem Statement

People now ask coding agents to make motion graphics videos: launch films, UI animations, explainers, social clips. The agent writes code, and a renderer turns it into frames. The results have three problems.

1. **They look the same.** Without a reference, the agent uses a default look: centered text on a gradient, a generic sans, everything fading in, a logo at the end. Viewers and motion designers call this "template", "PowerPoint" and "lacks taste".
2. **There is no direction.** A one-line prompt tests the renderer, not the idea. The good viral videos came from long director's briefs, beat maps, reference frames and many review rounds. Today that work is manual and lives in chat history.
3. **The tools are split.** Each open-source harness supports one engine and one genre. Remotion (React) and HyperFrames (HeyGen's HTML and GSAP framework) each have skills, but nothing directs a film across both engines. Nothing keeps one asset ledger, gives the user a storyboard and animatic to approve, or scores the result for taste against what the user approved.

The user wants a repeatable studio: direction and storyboards first, then a build that can use Remotion and HyperFrames in the same video, with assets from the HeyGen catalog, from websites and from code.

## Solution

`motion-studio` is a public, MIT-licensed suite of agent skills plus one CLI.

- **Four visible skills:**
  - `motion-studio`: the orchestrator. It holds project state and gates, and it dispatches each phase to a fresh subagent.
  - `motion-critique`: a taste review for any rendered video.
  - `motion-look`: named looks, reference extraction and the taste profile.
  - `motion-vocabulary`: a film and motion-graphics glossary. Each term maps to an engine recipe.
- **Internal phase briefs** that only subagents load: brief, assets, board, build-hyperframes, build-remotion and render. The orchestrator never loads engine rules.
- **One CLI, `motion-studio`.** It is written in TypeScript and published to npm. It wraps Remotion and HyperFrames behind one command set, and it does every deterministic job: state and gates, beat grids, the asset ledger, stills, animatics, contact sheets and glitch flags, handoff checks, stitching, the audio mix, and renders in several formats. The agent does the creative work. The CLI measures, assembles and verifies.

The user works as a director. The agent interviews the user in capped grilling rounds. The user sees real renders at five gates, and each gate shows a different thing:
1. A look test built with the product's real assets.
2. The beat map with stills.
3. An animatic with the entry and exit frame of each shot.
4. The full pass with its scorecard.
5. The delivery check.

A separate reviewer subagent scores the film against the approved stills, the look and the logline. The builder then fixes the three worst issues, and the loop stops when all scores are 8 or more, or after a fixed budget.

## User Stories

### Intake and brief
1. As a creator, I want the agent to interview me in rounds with a recommended answer per question, so that I get a complete brief without writing a long prompt.
2. As a creator, I want the interview capped at 3 rounds, with gaps filled from playbook defaults and the filled brief shown to me, so that intake never drags.
3. As a creator, I want to say "use defaults" at any point, so that I can skip questions I do not care about.
4. As a creator, I want the agent to read my product URL first and skip the questions it already answers (product name, claims, palette, logo), so that the questions are specific.
5. As a creator, I want the brief in the community XML sections (inputs, direction, structure, build, gotchas, start), so that it matches prompts that already work.
6. As a creator, I want a one-line logline in the brief, so that every later decision can be checked against it.
7. As a creator, I want to choose a primary format and extra formats (16:9, 9:16, 1:1) at the brief, so that the film is designed for every format.
8. As a creator, I want to name the genre (product launch, UI morph loop, explainer or data story, showreel, social kinetic-type clip), so that the right playbook applies.
9. As a creator, I want to answer in film words ("whip pan", "hold", "hit on the drop"), so that I do not need code terms.
10. As a creator, I want the recommended look and pacing answers to come from my taste profile when it has entries, so that the studio learns me.

### Look and taste
11. As a creator, I want 8 named looks (keynote minimal, Swiss grid, editorial serif, liquid glass, paper collage, data journalism, retro pixel / PC-98, brutalist mono), so that I start from a strong style.
12. As a creator, I want each look adapted to my product along the look's variation axes, so that looks do not become new defaults.
13. As a creator, I want to give a reference video, frame or image folder and get a style bible, so that the film copies pacing, type and palette but not the subject.
14. As a creator, I want the style bible to state what to take and what not to take from each reference, so that the film is not a copy.
15. As a creator, I want gate 1 to show one still per candidate look (2 or 3), rendered with my real logo, type and palette, so that I judge a look by sight, not by name.
16. As a creator, I want a shared list of template patterns, each with its replacement, so that the common template tells are replaced by a stronger move.
17. As a creator, I want my chosen and rejected looks, my gate notes and my final film's signature moves saved in a global taste profile, so that later projects start from my taste.
18. As a creator, I want each project to snapshot the taste profile, so that an old project renders the same after my taste changes.
19. As a creator, I want to use `motion-look` alone to produce a style bible, so that I can use it outside a full film.

### Beat map, storyboard and animatic
20. As a creator, I want the agent to propose BPM, beats, downbeats and drop from my track, and I want to correct or import the grid, so that timing is right even on ambiguous music.
21. As a creator, I want a beat map table (beat, time, what happens, camera, spoken line, sound cue, engine), so that I approve the structure before any animation.
22. As a creator, I want real stills rendered by each shot's engine at key moments, so that I see what the film will look like.
23. As a creator, I want an animatic with the entry and exit frame of each shot on the real track, so that I judge pacing and transitions before the full build.
24. As a creator, I want to give notes in director language, and I want to know which phase re-runs and what gets reset, so that notes are predictable.
25. As a creator, I want approved stills frozen and used as the reference for critique, so that the finished film is checked against what I approved.
26. As a creator making an explainer, I want reveals timed to the words of the narration and cuts timed to the beat, so that voice and music both drive the edit.

### Assets
27. As a creator, I want music, SFX, images, icons, logos and voice from the HeyGen catalog, so that I use licensed assets without searching by hand.
28. As a creator, I want screenshots, logo, colors, fonts and copy captured from my product website with the source URL, so that every claim on screen is true.
29. As a creator, I want free stock assets (Mixkit, Pexels, Google Fonts), so that I have options when the catalog misses.
30. As a creator, I want assets made in code (SVG, canvas, shaders, synthesized sound), so that the film has a look nobody else can download.
31. As a creator, I want AI image generation for concept frames and textures when a provider is available, so that I can explore a look before building it.
32. As a creator making a data story, I want every number on screen linked to its data source with retrieval date and field, so that claims are verifiable.
33. As a creator, I want one asset ledger with source, license status, path and use per asset, so that I can publish without licensing doubt.
34. As a creator, I want the final render to list assets with unknown or restricted rights and wait until I accept or swap each one, so that nothing is silently marked licensed.
35. As a creator, I want real sound effects by default, each placed at its measured peak, with synthesis as the fallback, so that sound does not feel cheap.
36. As a creator, I want a missing provider reported, never replaced by paid generation without my consent, so that I control cost.

### Build
37. As a creator, I want the agent to choose Remotion or HyperFrames per shot and state why, so that each shot uses the engine that fits it.
38. As a creator, I want Remotion and HyperFrames shots in one film, so that I am not locked into one engine.
39. As a creator, I want engine switches only on a cut or on a verified handoff, so that morphs stay seamless across engines.
40. As a creator, I want every shot to be a pure function of time, so that renders are identical and a fix is a small edit.
41. As a creator, I want closed-form springs with one spring per target change, so that motion feels physical and any frame renders alone.
42. As a creator, I want shots written against layout inputs per format, so that 9:16 is reframed, not cropped from 16:9.
43. As a creator, I want the builder to extend the approved keyframe code instead of replacing it, so that the film stays true to the board.
44. As a creator, I want product UI inside a shot to follow UI polish rules (better-ui, better-typography, better-colors), so that recreated UI looks real.

### Critique
45. As a creator, I want a separate reviewer with fresh context to score the film, so that the builder does not grade its own work.
46. As a creator, I want the reviewer to receive the approved stills, the look or style bible, the pattern list, the logline, the beat grid and the measured sync report, so that it scores against what I approved, not its own defaults.
47. As a creator, I want film-level scores (distinctiveness, continuity and pacing, sound and sync) and per-shot scores (motion quality, restraint, hierarchy and composition, message truth, technical finish), so that each dimension is judged at the right scale.
48. As a creator, I want sound and sync scored from measured offsets and loudness, so that a reviewer that cannot hear does not guess.
49. As a creator, I want a match, drift or departure line for each approved still, so that I see where the film left the board.
50. As a creator, I want findings in film vocabulary with shot, time and a concrete repair, so that notes are actionable.
51. As a creator, I want automated glitch flags before review, with technical failures blocking and ambiguous flags passed to the reviewer as evidence, so that defects are caught without banning legal cuts and holds.
52. As a creator, I want the loop to stop at all scores 8 or more, or after 3 loops per revision, and then show me the scorecard with the change per loop and the option to accept, so that it never loops forever.
53. As a creator, I want judgments the reviewer could not verify marked as unverified, so that it never invents a score.
54. As a creator, I want to run `motion-critique` on any video file and have it state which checks were impossible without a brief or board, so that I can review outside videos honestly.

### Render and delivery
55. As a creator, I want per-shot clips stitched frame-exact on one master timeline, so that mixed-engine films play as one.
56. As a creator, I want one master audio mix with SFX on measured peaks and loudness at -14 LUFS, so that the film sounds finished.
57. As a creator, I want every chosen format rendered from one timeline and checked against its safe zones, so that I get all deliverables in one pass.
58. As a creator, I want a final bundle (MP4s, poster frame, contact sheet, loop check for loop genres, asset ledger, source README), so that I can ship and reuse the project.
59. As a creator, I want to approve the cost of the final render and then accept the rendered files, so that nothing expensive runs and nothing ships without my consent.

### Operation
60. As a creator, I want `motion-studio doctor` to report Node, ffmpeg, Chromium, both engines, the heygen CLI and any image provider, so that setup problems show before work starts.
61. As a creator, I want every approval bound to the exact artifact revision, and upstream changes to mark later approvals stale, so that I never ship something I did not approve.
62. As a creator, I want any session to resume from the project file, so that work survives restarts.
63. As a creator, I want the suite to work in pi and Claude Code, and to run in sequence when no subagent tool exists, with the reduced review independence stated, so that it is portable and honest.
64. As a creator, I want each project in its own folder with a fixed layout, so that I can find every artifact.
65. As a maintainer, I want genre rules only in genre playbooks, so that adding a genre never changes the core pipeline.
66. As a maintainer, I want each skill written with writing-for-agents and its SKILL-MECHANICS rules, so that agents follow the same process every run.
67. As a maintainer, I want the README to state the Remotion company-license requirement, so that users know when they need a license.

## Implementation Decisions

### Modules
- **`motion-studio` (orchestrator skill).** Reads state through the CLI and decides the next step from the flow table. Dispatches one phase subagent with an input packet of explicit paths. Receives only a compact summary plus report paths. Checks the phase completion criterion through the CLI. Presents each gate. It carries no engine or design rules.
- **Phase briefs (internal, subagent-only).** `brief`, `assets` (with hero and fill modes), `board`, `build-hyperframes` and `build-remotion` (each with keyframe and full modes), and `render`. Each brief ends on a completion criterion that the CLI can check.
- **`motion-look`.** Holds 8 looks as compact data files. Each look has palette and type (citing the nearest HyperFrames frame preset where one exists), a motion signature, two variation axes the agent must set per project, one feasibility line per engine, references, and look-specific additions to the pattern list. It also does reference extraction (frames to a style bible) and owns taste-profile reads and writes.
- **`motion-critique`.** The reviewer brief, the rubric, the calibration sheets, the evidence packet contract and the output format.
- **`motion-vocabulary`.** A self-contained glossary in the style of animation-vocabulary. It has 9 categories: editing, camera, kinetic type, graphic transitions, timing and physics, composition, finishing, audio sync, and interface motion inside a shot. Each term has a one-line definition and its HyperFrames rule or Remotion recipe.
- **Genre playbooks (all 5, compact data plus guidance).** Each playbook holds its intake questions and defaults, beat templates, genre timing rules (for example reading holds for explainers), the genre evidence required for "message truth", and gotchas. The launch and explainer playbooks get worked examples and evals. The other 3 are marked "untested until used".
- **Engine contracts.** One short contract per engine covers:
  - Determinism, and the shot entrypoint (the composition or file id).
  - How layout inputs arrive.
  - Keyframe mode (static poses at named local times) and full mode.
  - How protected-element bounds are exported.
  - The render command.
  - An **allow-list of exact installed files** that the builder may read for API depth. Invoking the `hyperframes` or `remotion-best-practices` router skills is forbidden, because they re-plan or scaffold a new project.
- **CLI.** Written in TypeScript and developed with Bun. The npm package is Node-compatible, and Node 22+ is required because the HyperFrames CLI needs it. The Bun runtime is supported where the packed-CLI render smoke test passes. The CLI uses the Remotion renderer API in-process and the `hyperframes` CLI as a subprocess. Tested engine versions are pinned.

### Skill descriptions (trigger branches)
- `motion-studio`: a new directed film with storyboard and animatic; resume a film project; record a gate decision. Its leading words ("directed film", "storyboard", "animatic", "gated") separate it from the engine routers.
- `motion-critique`: score a rendered video; review a render against its board; calibrate taste.
- `motion-look`: pick or adapt a look; extract a style bible from references; update the taste profile.
- `motion-vocabulary`: name a motion or film move; translate a director note into terms and recipes.

### Flow and gates
Phases run in this order. Each gate lists what it shows, what a note re-runs, and what it resets. Each gate allows 3 note rounds; after that, the orchestrator asks the user to accept, rescope or stop.

| Step | Phase | Gate shows | A note re-runs | Resets |
|---|---|---|---|---|
| 1 | brief (max 3 rounds) | none | none | none |
| 2 | assets, hero mode: track, logo, type, palette, hero screenshots, voice script if any | none | none | none |
| 3 | look test: keyframe build of 1 hero still for each of 2-3 candidate looks | **G1: filled brief + look-test stills + style-bible take and do-not-take lines** | brief or look test | G2-G5 |
| 4 | board: beat map and per-shot description; then keyframe builds per engine; then `stills` | **G2: beat map + one still per beat** | board for named beats only | G3-G5, and G2 only when a beat time changes |
| 5 | `animatic` | **G3: animatic with entry and exit frame of each shot on the track** | board or keyframes for named shots | G4-G5 |
| 6 | assets, fill mode (SFX, stock, icons, code and AI assets); full build extends keyframes; critique loop A | **G4: full-pass MP4 + scorecard** | build or board for named shots | G5 |
| 7 | polish; `mix`; per-format renders at draft quality; critique loop B on the real deliverables | none | none | none |
| 8 | license check (D37), then approve the final render cost | **G5: delivery check (poster, contact sheet, safe-zone report, unresolved-license list); "use defaults" allowed** | render only | none |
| 9 | final render, then user acceptance of the files | acceptance | render only | none |

- **Revision binding.** The CLI hashes each gate's input artifacts: brief, look, beat grid, stills, shot sources, ledger and layout. Approvals and critique results store those hashes. A changed hash marks that gate and every later gate stale. Approved stills are frozen copies, not live paths.
- **Critique loop.** `scan` runs first, then the reviewer. The budget is 3 loops per revision. When the budget runs out, the orchestrator shows the user the scorecard with the change per loop and three options: accept at the current scores, give notes, or rescope. Loop A scores the full pass. Loop B scores the polished, mixed, per-format drafts.
- **Taste profile writes:** at G1 (chosen look liked, shown-and-passed looks rejected), at every gate note (the note text tagged with the vocabulary terms it names), and at acceptance (look, signature moves, pacing profile). **Reads:** in the brief phase, for the recommended answers.

### Project contract
- **`BRIEF.md`** holds the XML sections: inputs, direction, structure, build, gotchas and start. The brief is complete when every section has an answer or a recorded playbook default, and when logline, genre, look candidates, formats, track (or voice) and source URL are set.
- **`storyboard.json`** is the machine source of truth, and the CLI validates it. Its fields are decided; exact names are set in the first schema ticket:
  - `meta`: title, logline, genre, formats, fps, duration in frames.
  - `look`: look id or style-bible path, variation-axis values, taste snapshot id.
  - `audio`: track ledger id, grid source (detected, corrected or imported), BPM, beat and downbeat frames, drop frames or none, confidence.
  - `voice` (optional): script path, TTS ledger id, word-timing file.
  - `shots[]`: id, start and end frame (half-open), engine, entrypoint, description, camera, entry, exit (cut, or handoff to the next shot), asset ids, sound cues, still times (shot-local frames), protected elements.
  - `gates[]`: state, input hashes, decision, notes, rounds used.
  - `critique[]`: film-level and per-shot scores, three worst issues, still match lines, loop count, revision hash.
- **Controlled vocabulary.** `shots[].camera`, `entry` and `exit`, and the reviewer's issues use `motion-vocabulary` terms. Free text needs a `custom:` prefix. `validate` warns on unknown terms.
- **Asset ledger (canonical).** Each entry has id, type and source kind (`heygen`, `website`, `stock`, `code`, `ai-image`, `data`, and a reserved `video-model`). It also has source URL or generator, the provider asset id, license status (`known` with a license name, `unknown` or `restricted`) with evidence, local path with content hash, and the shots that use it. The `assets` command imports media-use records into this ledger, and engine-local copies link back to it.

### Media contract (mixed-engine timeline)
- **One master timeline in frames.** fps is one of 24, 25, 30 or 60 per project. One shared function converts beat and word times to frames (nearest frame). Both engine adapters use it. Shot ranges are half-open. Gaps and overlaps are validation errors.
- **Shot renders are video only**, at the master dimensions of each format, in one lossless intermediate format with BT.709 SDR tags and one pixel format.
- **Audio has one owner: the master `mix`.** It runs at 48 kHz stereo. Engine-side audio is disabled in shot renders.
- **Fonts are local pinned files** used by both engines. The engine contracts define how each engine waits until fonts are loaded.
- **`handoff`** compares shot A's rendered last frame with shot B's rendered first frame after normalization, against a fixed threshold. It then checks a transition strip cut from the stitched master, so encoded color jumps are caught.

### Multi-format layout
- Each format has canvas width and height, a safe rectangle and an optional platform-overlay preset. The same layout inputs reach Remotion (as props) and HyperFrames (as project data).
- Protected elements (text, logos, key UI) export their bounds at the still and check times. DOM measurement is used where it exists; author-declared geometry is used for canvas and SVG. `safezone` fails protected content that is held outside the safe rectangle. Entrance and exit travel and declared full-bleed art are allowed.

### CLI command surface (behavior)
- `init`: create the project folder layout and an empty project file.
- `doctor`: report Node, ffmpeg, Chromium, both engines, the heygen CLI (>= 0.3.0 and its readiness check) and the image provider. It reports capability; it does not install anything.
- `status`: show gate states, stale gates and the next step.
- `validate`: check the schema, cross-references, beat-grid alignment, ledger paths and hashes, and vocabulary terms.
- `beats`: propose a grid with confidence, and accept a corrected or imported grid. Silence or a missing drop gives an explicit result, not a guess.
- `assets`: add, resolve, import and list ledger entries across all source kinds. A provider failure leaves no partial entry.
- `stills`: render named shots at shot-local frames through each engine.
- `animatic`: assemble the frozen stills and the track into an MP4.
- `sheet`: make contact sheets (1 frame per second) and per-transition strips.
- `scan`: frame-difference flags (pop, stutter, hitch, flash, blank, color jump, ghost). It knows the declared cuts, holds and effects. Blank frames, frame-count errors and unintended single-frame pops block. The other flags are advisory evidence for the reviewer.
- `handoff`: as defined in the media contract.
- `render`: render shots per engine and per format, at draft or final quality.
- `stitch`: join shot clips on the master timeline and verify the frame count and timestamps.
- `mix`: place SFX at measured peaks, mix under the track, normalize to -14 LUFS, and write a sync report (SFX-peak-to-event offsets and cut-to-beat offsets in frames, integrated LUFS).
- `safezone`: as defined above.
- `loopcheck`: compare the end and start frames and audio for loop genres.
- `gate`: record a decision with input hashes.

### Critique
- **Evidence packet:**
  - the brief logline;
  - the look or style bible;
  - the shared and look-specific pattern list;
  - the frozen approved stills, each beside the matching rendered frame;
  - the 1-per-second contact sheet;
  - per-transition strips at full frame rate;
  - the `scan` report;
  - the beat grid and the `mix` sync report;
  - a draft clip, when the harness can read video.
- **Rubric.** 8 dimensions with genre-neutral 1/5/8/10 anchors. Dimension 6 is "message truth": the visuals explain the stated message and factual claims have sources. Each playbook adds genre evidence: authentic UI for launches, data provenance and truthful encoding for data stories. Film-level dimensions are 1 distinctiveness, 2 continuity and pacing, and 7 sound and sync. Per-shot dimensions are 3 motion quality, 4 restraint, 5 hierarchy and composition, 6 message truth, and 8 technical finish. Dimension 7 is scored from the `mix` sync report: 8 means every hit is within 1 frame and every cut is within 1 frame of a beat. The ledger shows whether each SFX is real.
- **Calibration.** Before the film, the reviewer scores one known-bad and one known-good sheet in the same session. The run is void if either sheet lands outside its band.
- **Capability awareness.** A judgment that needs evidence the harness cannot read (video, audio) is marked unverified and sent to the user. It is never given an invented score.
- **Output:** scores; the 3 worst issues, each with shot, frame, vocabulary term and repair; and a match, drift or departure line for each approved still.
- **Standalone mode** states which dimensions it cannot verify without a brief, board or ledger.

### Taste rules
- **Shared pattern list: template pattern → replacement.** The list covers only the default-look and cheap-effect failures:
  - centered text on a gradient → an asymmetric layout on the look's canvas;
  - uniform fade-in → mask-line reveal or morph;
  - crossfade → cut on the beat or shape morph;
  - blur-in → mask reveal;
  - glow and particle filler → one accent used with purpose;
  - logo-only outro → an end card that carries the claim and the mark;
  - reversing camera moves → one camera move per beat.

  Looks can add pairs but cannot remove them. Timing rules (holds, dead time) live in genre playbooks with bounds for each genre.
- UI polish skills apply only to product UI inside a shot. They are never part of the critique gate.

### Portability, dependencies, packaging
- **Normal mode:** each phase and the reviewer run in fresh subagents. The orchestrator receives compact summaries and report paths only.
- **Degraded mode** (no subagent tool): phases run inline in sequence, and state passes through files. The review is labeled non-independent until the user reviews it or a fresh session re-runs it.
- **Requirements:** Node 22+, ffmpeg and Chromium are required. HeyGen catalog features need the heygen CLI to be ready. Without it, the assets phase uses the other sources and records the gap. It never starts paid generation without consent.
- **Repository and publication.** The public repo is `FasalZein/motion-studio` under MIT. `docs/SPEC.md` is the source of truth, and one tracking issue parents the ticket issues. The 4 skills are installable skill roots, and each bundles its internal briefs, contracts, rubric, calibration sheets, looks, playbooks and glossary inside the repo. Nothing depends on files outside the repo or on optional engine skills. Installation targets are `~/.agents/skills` (pi) and `~/.claude/skills` (Claude Code).
- **Licensing and attribution.** Content copied from other projects comes only from MIT or Apache-2.0 sources, with attribution. Unlicensed repos are reference only. The README states the Remotion company-license requirement.

### Delivery order
1. **Mixed-engine integration proof** (D36). One Remotion shot and one HyperFrames shot, with a cut, a matching handoff and an intentional mismatch, a beat that does not fall on a frame, a shared font and color patch, and an SFX peak at the seam. The shots are stitched and mixed, then measured, under Node and Bun.
2. The CLI core (schema, state, gates, hashes).
3. Skills and phase briefs.
4. The product launch tracer.
5. The explainer tracer.

## Testing Decisions

- **Good tests check external behavior only:** CLI exit codes, output files and their measured properties. Expected values come from how fixtures are built, never from the implementation.
- **Seam 1, CLI black-box.** Each command runs as a process on fixture projects:
  - **Real two-engine fixture:** the delivery-order-1 proof. Check frame count, timestamps, continuity across the handoff, detection of the mismatch, and SFX peak placement at the seam, in every format.
  - **beats:** a click track with known BPM, a music track, silence, music with no drop, ambiguous meter, and a manually corrected grid.
  - **scan:** paired clips for each flag (pop, stutter, flash, blank, color jump, ghost) against counterexamples (clean hard cut, intentional hold, fast motion blur).
  - **handoff:** a matching pair, a mismatched pair, and an encoded color jump in the stitched strip.
  - **safezone:** landscape, portrait and square layouts in both engines, with text wrapping, full-bleed art, and protected text outside the safe zone.
  - **mix:** loudness at -14 LUFS within tolerance, and the offsets in the sync report.
  - **validate:** each invalid project kind (missing engine, asset not in the ledger, off-grid shot, gap or overlap, unknown vocabulary term, stale hash) is rejected with a clear message.
  - **gates:** resume after an upstream edit, after a rejection, after an exhausted loop budget, and after a change made after approval.
  - **assets:** missing or expired heygen auth, successful catalog resolution into a shot of each engine, provider failure without a partial entry, and unknown-license blocking.
  - **Runtime:** a packed-CLI still and video render smoke test under each supported runtime, including renderer cleanup and bounded termination on a subprocess failure.
- **Seam 2, skill evals.** These run in pi and Claude Code, and each run records the model and harness configuration. Skill runs are not deterministic, so each eval repeats a fixed number of times.
  - **Artifact checks** per phase: a complete `BRIEF.md` within 3 rounds, a valid `storyboard.json`, frozen stills, ledger coverage and gate hashes.
  - **Critique evals** use paired fixtures with the same stills but different timing or sound. Known-bad fixtures (default look, slideshow pacing, effect stack, off-beat SFX) must score below 8 on the matching dimension. Known-good fixtures, including a non-product data story, must reach 8 on the applicable dimensions. Findings must name the damaged shot and time with a relevant repair.
  - **Context routing:** one dispatch-and-resume scenario for each harness, with context measured in tokens. The parent must receive only summaries and paths. Each engine worker must receive only its own contract. The reviewer must start without the builder transcript. A degraded-mode scenario must report reduced independence.
  - **Clean install:** from a checkout with the engine skills absent. Every referenced path resolves.
- **Seam 3, acceptance.** Two tracer videos pass every gate with no core-pipeline change between them, and each uses both engines and at least two formats: (1) a product launch film for a real product URL, and (2) an explainer or data story. A separate authenticated check proves HeyGen catalog resolution. Tracers that pass on fallback sources do not count as HeyGen proof.
- **Prior art:** Tarquished/motioner (transition flags, evals) and Kimeur/motion-launch-videos (automated checks). The repo has no code yet, so the CLI suite sets the pattern.

## Out of Scope

- Video models for generate-then-trace (Seedance, Kling, Veo). This is deferred to v2. The `video-model` source kind is reserved.
- Character films and music videos with rigs and character bibles.
- A raw `seek(t)` HTML engine as a third backend.
- HeyGen avatar or presenter videos.
- A compiler from `storyboard.json` to engine code. Agents write the shot code.
- Automatic semantic certainty in music analysis. Grids are proposed and the user corrects them.
- HDR, arbitrary codecs or fps, multiple image providers, and alternative render strategies.
- Hosted rendering (Remotion Lambda, cloud queues) and a paid service layer.
- Editing live-action footage, except as an asset inside a shot.

## Further Notes

- **Research inputs** (outside the repo): the source articles by @0xMovez and @twoclipping; 12 exported posts; the landscape survey; the taste research (8 failures, rubric); the installed-skill reuse inventory; the competing-suites survey; and two spec reviews. Rubric anchors, calibration sheets and the glossary ship inside the repo.
- **Recorded risks:**
  - X search was rate-limited during the taste research, so complaint counts are low.
  - Vocabulary source licenses are unverified.
  - Remotion support for Bun is "mostly supported", with a known process-exit caveat. The runtime smoke test covers this.
  - HeyGen catalog support is unproven until the authenticated check passes.
  - 3 genres and 6 looks stay untested until a project uses them.
- **Remotion license.** Remotion needs a paid company license for companies with more than 3 people.
- **Differentiators.** In the survey, no inspected tool combines all of these:
  - engine-rendered boards and an animatic that the user approves and that the critique uses as reference;
  - one frame-exact timeline across two engines with verified handoffs;
  - critique bound to revisions and scored against the approved artifacts;
  - a taste profile across projects;
  - one asset ledger with license status across catalog, web, code, data and AI sources;
  - several formats from one timeline.
