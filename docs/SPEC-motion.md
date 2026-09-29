# motion-studio: motion amendment (world-class motion of any length)

Status: approved amendment to `docs/SPEC.md` (2026-09-29). Decisions: `docs/DECISIONS.md` D57-D67. Glossary: `CONTEXT.md`. `docs/SPEC.md` stays the source of truth; it points here for the motion rules.

## Problem Statement

The first end-to-end film (a 15 s Raycast launch film, 2026-09-28) passed every gate and every CLI check, but it is a slideshow, not motion design. Each shot has a short entrance of 0.3 to 0.6 s and then freezes. The frozen spans last 2.4 to 4.3 s. The camera never moves, every cut is a plain straight cut, and the product UI is a pasted screenshot. Measured with the reference method, the film has 19 % moving frames and 73 % of its content time in still spans over 1 s. In 18 pieces by world-class studios the worst values are 69 % and 5.0 %.

The creator wants films like the best motion designers and studios make: fluid, connected, telling a story, at any length from a 10 s spot to a multi-minute film. Developer-tool launch videos are not the standard.

The system allowed the slideshow for five reasons:

1. **No skill teaches directing motion.** The four skills cover orchestration, looks, a glossary and critique. Nothing teaches world and camera, continuity across cuts, in-betweens, living holds, choreography or structure for longer films. Ordinary Folk names the failure: "style frame, transition, style frame".
2. **The guidance favors holds.** The launch playbook offers "an intentional event or hold per beat". The rubric says a long reading hold can be correct. The handoff rule makes the moving element stop on both seam frames.
3. **The gates approve still frames.** G1 shows a still look test and G3 shows an animatic of stills. Nothing shows motion before the full pass.
4. **Nothing measures motion.** `scan` flags short glitches only. A 4 s frozen span passes silently.
5. **The builders cannot reach the techniques.** The engine allow-lists block the installed motion material (HyperFrames blueprints and transitions, Remotion 3D and transitions), and 3D is not in the stack.

## Solution

Motion becomes a first-class, measured part of the studio.

- **A fifth skill, `motion-direction`,** holds the motion craft. The board, the look-test builders, the shot builders and the reviewer load it (D57). Its content is distilled from studio practice and from external skills, with attribution and within their licenses (D58).
- **The gates show motion.** G1 shows a moving look test for each direction (D61). G3 shows a moving animatic, built from blocking renders in the real engines and locked to the real audio (D62). G4 shows the full pass with its liveness report.
- **A liveness report measures stillness** with the method and limits taken from 18 world-class pieces (D59). A failing full pass cannot be approved at G4 unless the director writes a waiver (D60).
- **Seams carry motion.** Every seam declares its continuity thread (D64), and a handoff lets motion continue through the seam (D63).
- **The builders get the techniques.** 3D (three.js in both engines), all GSAP plugins, noise, motion blur and path tools are pinned in the CLI. The allow-lists name the installed engine files for API detail. A determinism guard keeps every frame a pure function of time (D65, D66).
- **Product UI is a live object** inside the film's world, never a pasted screenshot, and every hold is a living hold (D67).

## User Stories

### Direction and structure
1. As a creator, I want every film to start from one simple idea I can repeat in a sentence, so that the motion serves a story and not a sequence of screens.
2. As a creator, I want 2 to 3 directions that differ in idea, world and camera logic (not only in color), so that I choose a concept and not a palette.
3. As a creator, I want the film planned against the audio (music, voice or a click track) before any boards, so that cuts, camera hits and reveals land on the rhythm.
4. As a creator, I want a film of any length to use the same process, so that a 15 s spot and a 3-minute film both come out fluid.
5. As a creator of a longer film, I want the plan to name recurring motifs, sequence types and a pacing curve, so that a long film varies its rhythm and keeps attention.
6. As a director, I want each beat to name its motion event (what moves from where to where), so that no beat is "the headline appears".
7. As a director, I want each seam to name the thread that carries into the next shot, so that shots connect instead of restarting.
8. As a director, I want the in-between from one beat to the next designed, not only the key poses, so that the film is not "style frame, transition, style frame".
9. As a director, I want the camera treated as a character with a stated move per shot, so that a locked-off camera is a choice with a reason.

### Look test (G1)
10. As a creator, I want each look candidate shown as a short moving clip, so that I judge motion, light and material response and not a poster.
11. As a creator, I want the look test to contain one seam and one type or UI beat, so that I see how the direction connects and how text moves.
12. As a builder, I want the look test rendered by the CLI in either engine, so that a Remotion look test does not need an unpinned tool.
13. As a builder, I want the look test to read the same layout inputs as a shot, so that the approved hero promotes into every chosen format without a rewrite.
14. As a creator, I want the look test to pass the same liveness limits as the film, so that a still direction cannot win G1.

### Board and animatic (G2, G3)
15. As a director, I want G2 to show the beat map with the thread of each seam beside the stills, so that I approve connections and not only poses.
16. As a director, I want G3 to show a moving animatic in the real engines at placeholder fidelity, locked to the real track, so that I judge timing, camera and seams before any polish.
17. As a director, I want the animatic's liveness report shown at G3 as advice, so that I see stillness while changes are cheap.
18. As a builder, I want a blocking mode between keyframe and full mode, so that I extend the same source from poses, to timed motion, to finished shots.
19. As a builder, I want the animatic refused when a shot render is older than its source, so that G3 never shows stale motion.

### Liveness (G4, G5)
20. As a creator, I want every rendered film measured for stillness with limits taken from world-class work, so that "fluid" is a number and not an opinion.
21. As a director, I want G4 approval refused while the full pass fails a liveness limit, so that a slideshow cannot pass silently.
22. As a director, I want to approve a deliberate still moment with a written waiver, so that I stay the director for the rare film that needs it.
23. As a builder, I want the report to locate each failing still span by shot and frame, so that I know what to fix.
24. As a reviewer, I want a liveness report for any video file, so that standalone critique can measure stillness too.
25. As a creator, I want G5 to show the liveness report of each final draft, so that polish did not reintroduce frozen spans.
26. As a maintainer, I want the per-piece reference table and the derivation of every limit in the repo, so that anyone can re-derive the limits when the reference set grows.

### Seams
27. As a builder, I want a handoff to accept motion that continues through the seam, so that a connected seam does not force a stop.
28. As a builder, I want a handoff to fail when the pose or the velocity jumps at the seam, so that a false match is caught.
29. As an operator, I want `handoff` on a film without handoff seams to exit 0, so that a scripted route does not break.
30. As an operator, I want `handoff` to refuse a named seam that is a declared cut, so that a cut is not compared as a handoff.
31. As a director, I want `validate` to reject a seam without a declared thread, so that a disconnected cut is a visible decision.
32. As a reviewer, I want the report to say for each cut whether both sides move, so that I can judge a beat cut.

### Techniques and engines
33. As a builder, I want three.js available in both engines with pinned versions, so that the board can call for 3D worlds, product reveals and camera flights.
34. As a builder, I want 3D only where the board declares it with a reason, so that 3D serves the idea and its cost stays visible.
35. As a builder, I want all GSAP plugins (SplitText, Flip, MorphSVG, DrawSVG, MotionPath) as local pinned files, so that HyperFrames shots render offline and the same way every time.
36. As a builder, I want seeded noise, motion blur and path tools in Remotion, so that living holds, drift and morphs are easy to build.
37. As a builder, I want the allow-lists to name the exact installed engine files for the techniques I use, so that I read real API detail without loading router skills.
38. As a maintainer, I want `validate` to reject wall clocks, unseeded randomness and network loads in shot sources, so that every frame stays a pure function of time.
39. As a builder, I want `repro` to render a 3D shot twice and compare frame hashes, so that a nondeterministic WebGL shot is caught before review.
40. As an operator, I want the render report to record the GL backend, so that a film is not rebuilt on another backend without a note.

### Product UI
41. As a creator of a product film, I want the UI rebuilt in code and animated as real behavior, so that the product feels alive and not pasted.
42. As a creator, I want the UI to be one element inside the film's world, so that the film is motion design and not a UI demo.
43. As a maintainer, I want the capture URL and date of the UI state kept in the ledger, so that message truth survives the rebuild.

### Critique
44. As a reviewer, I want the evidence packet to include the liveness report, the seam threads and frame strips around each seam and inside each hold, so that I judge motion from motion evidence.
45. As a reviewer, I want rubric anchors that no longer reward frozen holds, so that the score agrees with the measurement.
46. As a reviewer, I want a checklist for slideshow rhythm, disconnected cuts, style-frame alternation, repeated template layouts and a missing idea, so that I name these failures in the three worst issues.
47. As a maintainer, I want a slideshow known-bad calibration case, so that a reviewer who scores a slideshow high is voided.

### Verification
48. As a creator, I want the Raycast film rebuilt with the new skills and gates and measured against the slideshow baseline, so that the improvement is proven, not claimed.

## Implementation Decisions

### Modules
- **`motion-direction` (new skill, D57).** A skill root beside the other four. The body routes to reference files by topic: idea and structure for any length; world and camera; seams, threads and in-betweens; living holds and liveness; choreography; 2D and 3D; product UI in motion; the per-beat contract; sources with licenses. Rules carry their evidence level: a named source, an inference, or a proposal. Proposal-only rules (sequence types for films over about 45 s, the pacing curve, motif counts, the look-test length) stay marked as proposals until measured. The skill describes techniques and points at the allow-listed engine files for API detail; it holds no engine API text itself.
- **`motion-studio` guidance.** The launch playbook, the board brief and the build briefs drop hold-favoring language (D67). The board records per beat: idea line, frames, motion event, camera start and end, seam thread, in-between plan, sound cue, and live content. The flow adds directions at G1, a blocking phase before G3, and the liveness gate at G4.
- **`motion-vocabulary`.** Gains the thread kinds (D64) and "use only when" notes on `locked-off`, `straight-cut` and `hold`. A hold is a living hold.
- **`motion-look`.** Each look declares its motion signature fields used by the look test: easing family, camera behavior, light behavior and transition family.
- **`motion-critique`.** Reads the liveness report and seam threads; rubric anchors stop rewarding frozen holds; a reviewer checklist names the motion failures; a slideshow calibration case joins the known-bad set.
- **Engine contracts.** Add blocking mode, the local pinned GSAP and three files for HyperFrames, 3D rules for Remotion, the determinism rules, and the extended allow-lists (D58, D65, D66).
- **CLI.** New commands `liveness`, `looktest` and `repro`. Changed behavior: `animatic`, `handoff`, `validate`, `gate`, `status`, `beatmap`, `render` (GL backend in its report).

### Liveness report (D59, D60)
- `liveness <film-dir> [format]` measures the current stitched master of each chosen format and writes a report beside it with the master's hash. `liveness <video-file>` measures any video for standalone critique.
- The report holds: moving share; content-time shares in still spans over 0.5, 1 and 2 s; the longest still span; each still span over 0.5 s located by shot and film frame; the excluded black spans and end-card hold with their lengths; and the advisory metrics (longest motion run, cuts with motion on both sides per declared cut, cut rate, onsets per second). Camera share is optional advisory evidence.
- The method and limits are exactly those of D59. The film-length rule for the longest still span uses the film's duration.
- Exit status is non-zero when a limit fails. `status` shows the verdict per format.
- `gate G4 approve` refuses while any chosen format's report is missing, stale against the current master or failing, unless the director passes a liveness waiver with a note. G5 binds each final draft's report as a delivery check.

Reference distribution (18 world-class pieces, from the 2026-09-29 study; the moving share row is whole-film, the still rows are content basis; ours = the first Raycast film). The gate checks the moving share on the content basis, which is never lower than the whole-film value (D72):

| Metric | min | p10 | median | p90 | max | Limit | Ours |
|---|---|---|---|---|---|---|---|
| Moving share | 0.687 | 0.777 | 0.910 | 0.984 | 0.993 | >= 0.75 | 0.190 |
| Still > 0.5 s share | 0 | 0 | 0 | 0.068 | 0.100 | <= 0.10 | 0.730 |
| Still > 1 s share | 0 | 0 | 0 | 0.043 | 0.050 | <= 0.05 | 0.730 |
| Still > 2 s share | 0 | 0 | 0 | 0.027 | 0.037 | <= 0.04 | 0.604 |
| Longest still span, s | 0 | 0 | 0.34 | 2.48 | 5.92 | <= 2 (under 90 s), <= 3 (90 s and more) | 4.25 |
| Longest motion run, s | 3.33 | | | | | advisory >= 3 | 0.92 |
| Cuts with motion both sides | 0.567 | 0.745 | 0.90 | 1.0 | 1.0 | advisory >= 0.70 (5 or more cuts) | none |

Moving share is the whole-film value in the study; the content basis only removes still spans, so its value is never lower. Recognition and years of the pieces were not re-verified. The set has one piece under 30 s and one pure explainer, so the limits are pooled, not per style.

### Look test (D61)
- `looktest <film-dir> <look-id>` renders `shots/_look/<look-id>/` through its declared engine at the primary format's layout inputs. It writes the clip and a poster still into `stills/G1/` and a liveness report for the clip.
- A look test is a direction: idea device, world and camera logic, and look. It contains one seam with motion on both sides and one type or UI beat. Its length is the builder's choice; it must be long enough for that content and pass the liveness limits.
- The look-test build brief requires the layout inputs, so promotion of the chosen hero to `shots/<id>/` works in every chosen format.
- D43 binding is unchanged: G1 hashes and freezes `stills/G1/**`. The taste profile's check for a shown look (`stills/G1/<look-id>.*`) accepts the clip or the poster.

### Blocking mode and animatic (D62)
- Build modes are keyframe (static poses for G2 stills), blocking (full timing, camera paths, seams and living holds at placeholder fidelity) and full. Each mode extends the same shot source.
- `animatic` takes the current stitched master of the primary format, verifies each shot render is newer than its source, muxes the real track and narration, and writes the animatic. It prints the animatic's liveness verdict as advice. D49 is superseded.

### Seams (D63, D64)
- `handoff` compares B's first frame with A rendered one frame past its end. The comparison keeps the current structure and color thresholds and the stitched-master check. Pose and velocity both carry, because A's next frame must equal B's first frame.
- `shots[]` gains a seam thread for every shot after the first: a thread kind from the vocabulary plus the shared thing in words. `validate` errors when it is missing; `beatmap` prints a thread column. Exact field names are set in the ticket.

### Techniques (D65, D66)
- Pinned CLI dependencies as listed in D65. The Remotion bundler already resolves shot imports from the CLI's packages (D54); the contract's import list grows to the pinned packages.
- HyperFrames shots load GSAP (with plugins) and three from local pinned files that the CLI provides in the shot folder. The HyperFrames contract shows the composition-variables array form (e2e defect 1).
- A shot declares 3D in the storyboard with a reason. `validate` errors when shot sources import three.js without the declaration, and on the D66 banned calls and network loads.
- `repro <film-dir> <shot-id> [format]` renders the shot twice and compares per-frame hashes. The 3D builder completion check requires it.
- The render report records the GL backend and GPU mode.

## Testing Decisions

- **Good tests check external behavior:** CLI exit codes, output files and measured properties. Expected values come from how fixtures are built, never from the implementation.
- **Seam 1, CLI black-box** (the existing seam; prior art: `scan`, `handoff`, `safezone` and `board` tests):
  - `liveness`: synthetic videos built by construction with known still spans. A slideshow pattern fails; continuous motion passes; a black head and a trailing end card are left out of the content basis; each boundary of each limit is tested on both sides; the film-length rule switches at 90 s; a still span is located by shot and frame; the standalone mode works on a lone file. A cross-check on the first Raycast master reproduces the study's numbers (recorded in the PR, not a repo test, because the film is outside the repo).
  - `gate`: G4 approval refused on a failing, missing or stale report; accepted with a waiver and its note recorded; accepted on a passing report.
  - `handoff`: an element moving at constant velocity through a seam passes in both engines; a velocity jump fails; a pose mismatch fails; no seams exits 0; a named cut seam is refused.
  - `validate`: a seam without a thread, a banned clock call, `Math.random`, a network script, and an undeclared three.js import are each rejected.
  - `repro`: a 3D shot in each engine renders identical frame hashes twice; a shot seeded from the wall clock fails.
  - `looktest`: a look test in each engine writes clip, poster and report at the primary layout, and promotes into a second format without source changes.
  - `animatic`: built from blocking renders with the track; refused when a shot render is older than its source.
- **Seam 2, skill evals:** a board produced with `motion-direction` has a thread for every seam and a motion event for every beat; a look test passes liveness; the reviewer voids a run that scores the slideshow calibration case high.
- **Seam 3, acceptance:** the Raycast 15 s film rebuilt from a fresh CLI tarball with the installed skills passes the liveness gate without a waiver, and its report is compared with the slideshow baseline.

## Out of Scope

- Automatic detection of template layouts, style-frame alternation or pacing curves as gates. They stay reviewer judgments until a method is measured.
- Per-style liveness limits. The reference set is too small; limits are pooled.
- Lottie, Rive, drei and postprocessing until each passes its own determinism probe.
- WebGPU and TypeGPU paths (they need a special Chrome build).
- Cross-machine pixel identity for WebGL. `repro` proves one machine and one GL backend.
- Character films and music videos with rigs remain out of scope (SPEC).

## Further Notes

- **Research inputs (outside the repo):** world-class metrics study with its script and per-piece JSON, craft research (studio process and rules), first-pass craft research (Apple and launch films), and the tooling survey with determinism probes. Paths are in the architect plan artifact.
- **Risks:**
  - The GSAP Standard License bars tools that compete with Webflow. motion-studio already depends on GSAP through HyperFrames. Get a legal read before publishing.
  - Studios give few quotable rules on pacing curves, motifs, easing and living holds. Those rules are proposals until the e2e and tracers test them.
  - The liveness limits come from n = 18 pieces with YouTube compression; re-derive them when the set grows.
  - A blocking phase adds build and render cost before G3.
