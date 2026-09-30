# motion-studio

Agent skills for directed motion-graphics films. You act as the director. The agent interviews you, shows you a look test, a beat map with real stills, and an animatic, and then builds the film. It can use Remotion and HyperFrames shots in the same video, and it scores the result for taste before you see it.

> **Status: v0 preview.** The six skills work today. They call `hyperframes`, `remotion` and `ffmpeg` directly, and mark any check they cannot run as unverified. Progress is tracked in [issue #1](https://github.com/FasalZein/motion-studio/issues/1).
>
> The `motion-studio` CLI in `cli/` is partly built. When it is installed, the skills use it for `init`, `validate`, `status`, `handoff` and `mix`. The documented CLI route from render to mix, and fixes to its frame clock and output paths, are tracked in issue #22.
>
> - **Works today:** `init`, `validate`, `status`, `render`, `stitch`, `still`, `handoff` and `mix`. See [cli/README.md](cli/README.md).
> - **In progress:** gate records with revision hashes (#5), the beat grid (#6), and per-format layouts with safe zones (#9).
> - **Still manual:** gate hashing and stale marks, the beat grid, contact sheets and the animatic, the technical scan, safe-zone checks, and asset search and HeyGen import. `validate` does not check vocabulary ids yet (#12).

## What you get

| Skill | Use it to |
|---|---|
| `motion-studio` | Direct a new film, resume a film project, or record a gate decision. |
| `motion-look` | Pick or adapt one of 8 named looks, extract a style bible from your references, or update your taste profile. |
| `motion-direction` | Direct motion events, camera moves, seams, living holds and product UI. |
| `motion-score` | Make an original synthesized score and sound-effect layer from the film’s beat contract; check timing, loudness and repeatability. |
| `motion-critique` | Score any rendered video for motion and taste, or review a render against its approved board. |
| `motion-vocabulary` | Name a motion or film move (for example "whip pan", "flood" or "hit on the drop") and get the recipe for each engine. |

### How a film is made

1. **Brief.** The agent interviews you for up to 3 rounds, and each question comes with a recommended answer. Reply `use defaults` at any time to skip.
2. **G1: look test.** You see one still for each of 2 or 3 candidate looks, rendered with your real logo, type and palette.
3. **G2: beat map and stills.** You see every beat on the music grid, with one real engine still per beat.
4. **G3: moving animatic.** You see every beat move with its real timing at placeholder fidelity, on the real track and narration, with a liveness verdict as advice.
5. **G4: full pass.** You see the full MP4 with a reviewer scorecard. A fresh-context reviewer scores 8 dimensions, and the builder fixes the 3 worst issues until every score is 8 or more (at most 3 loops).
6. **G5: delivery check.** You see the poster, the contact sheet, the safe-zone report, and each asset with an unknown license. You approve the final render.

Give notes like a director ("this part is too slow", "make the zoom hit on the drop"). Each gate allows 3 rounds of notes. An approval is bound to the exact files you approved. If an upstream file changes, the later gates become stale.

**Genres:** product launch, UI morph loop, explainer or data story, showreel, social kinetic-type clip. The product launch and explainer playbooks have worked examples. The other three are untested until someone uses them.

**Looks:** keynote minimal, Swiss grid, editorial serif, liquid glass, paper collage, data journalism, retro pixel / PC-98, brutalist mono.

**Assets:** the HeyGen catalog (music, SFX, images, icons, voice), your product website, free stock (Mixkit, Pexels, Google Fonts), code-made assets, data sources, and AI images. Every asset goes into one ledger with its source and license status.

## Prerequisites

| Tool | Why | Install |
|---|---|---|
| Node.js 22+ | HyperFrames and Remotion | https://nodejs.org or `brew install node` |
| ffmpeg + ffprobe | frames, stitching, audio | `brew install ffmpeg` |
| HyperFrames | HTML/GSAP engine, website capture, media-use | runs through `npx hyperframes` (no global install) |
| Remotion | React engine | installed per shot project by the build step |
| HeyGen CLI | free catalog music, SFX, images, voice | `curl -fsSL https://static.heygen.ai/cli/install.sh \| bash`, then `heygen auth login --oauth` |
| Bun (optional) | CLI development | https://bun.sh |
| `motion-studio` CLI (optional) | frame-exact render, stitch, handoff and mix checks | not on npm yet: `cd cli && npm install && npm run build && npm pack`, then `npm install -g ./motion-studio-*.tgz` |

Check your setup:

```bash
npx hyperframes doctor                   # Node, ffmpeg, Chrome
heygen auth status                       # signed in?
npx hyperframes media-use resolve --doctor   # HeyGen catalog ready?
```

These are optional local fallbacks that `hyperframes doctor` lists: `brew install whisper-cpp` (transcription and word timings for narration), Kokoro (local TTS) and MusicGen (local music). Without HeyGen, the assets phase uses the other sources and records the gap. It never starts paid generation without your consent.

## Install the skills

```bash
# all six skills, globally, for every supported agent (pi, Claude Code, and others)
npx skills add FasalZein/motion-studio -g -a '*' -y

# or install one skill only (standalone critique)
npx skills add FasalZein/motion-studio -g --skill motion-critique motion-vocabulary

# list what the repo offers
npx skills add FasalZein/motion-studio --list
```

`bunx skills add ...` works the same way. Install all six skills together, because `motion-studio` loads the other five by name. `motion-critique`, `motion-vocabulary` and `motion-direction` also work alone.

Update later with `npx skills update -g`.

## Use it

Start in an empty working folder. Films are written to `films/<slug>/`.

```text
Use the motion-studio skill. Make a directed film: a 20-second product launch for https://example.com, 16:9 with a 9:16 cut, keynote-minimal or Swiss-grid look, music from the HeyGen catalog around 120 BPM.
```

Other entry points:

```text
Use motion-critique to score ./renders/launch.mp4. There is no brief; tell me which dimensions you cannot verify.
Use motion-look to extract a style bible from ./refs/reference.mp4 for my product at https://example.com.
Use motion-vocabulary: what is it called when a button grows into the next page?
Use motion-studio to resume films/acme-launch.
```

## Project layout

```text
films/<slug>/
  BRIEF.md            the brief, in XML sections (inputs, direction, structure, build, gotchas, start)
  storyboard.json     machine source of truth: shots, engine per shot, beats, gates, critique
  ledger.json         every asset with source and license status
  style-bible.md      when you give references
  shots/<id>/         one HyperFrames or Remotion project per shot
  stills/  animatic.mp4  renders/<format>/  audio/  critique/
```

Your taste profile is stored in `~/.motion-studio/taste.json`, and each film keeps a snapshot of it.

## Repository

```text
skills/     the six skills (installable with `npx skills add`)
cli/        the motion-studio CLI (partly built; see the status above)
docs/       SPEC.md (source of truth), DECISIONS.md, v0-contract.md
```

## Licensing

MIT, see [LICENSE](LICENSE). Remotion is not MIT: companies with more than 3 people need a paid Remotion company license. See https://www.remotion.dev/docs/license. HeyGen catalog assets follow HeyGen's terms. Check each asset's license status in `ledger.json` before you publish.
