# v0 preview contract

v0 ships the four skills before the `motion-studio` CLI exists (decision D39). The skills follow `docs/SPEC.md`. Wherever the spec names a CLI command, v0 runs the engine or ffmpeg command directly. Each CLI ticket later replaces the manual step. This file keeps the four skills consistent while they are written in parallel.

## Repository layout

```
skills/
  motion-studio/        orchestrator skill
    SKILL.md            flow, gate table, dispatch rules, resume
    agents/             internal phase briefs, loaded only by subagents
      brief.md  assets.md  board.md  build-hyperframes.md  build-remotion.md  render.md
    playbooks/          one file per genre (5)
    engines/            engine contracts: hyperframes.md, remotion.md, media-contract.md
    reference/          project-layout.md, storyboard-schema.md, v0-commands.md
  motion-look/
    SKILL.md
    looks/              8 look files
    patterns.md         shared template-pattern -> replacement list (single source of truth)
    reference/          style-bible template, taste-profile format
  motion-critique/
    SKILL.md
    reviewer.md         reviewer brief (loaded by the reviewer subagent)
    rubric.md           8 dimensions, genre-neutral anchors (single source of truth)
    evidence-packet.md  inputs the reviewer receives
  motion-vocabulary/
    SKILL.md            glossary index and rules
    terms/              one file per category (9)
cli/                    the CLI (ticket #2 onward)
docs/
```

## Single source of truth (who owns what)

| Meaning | Owner file | Others |
|---|---|---|
| Flow, gate table, re-entry, resets, round caps | `motion-studio/SKILL.md` | cite by skill name |
| Project folder layout | `motion-studio/reference/project-layout.md` | cite |
| `storyboard.json` fields | `motion-studio/reference/storyboard-schema.md` | cite |
| v0 command substitutes | `motion-studio/reference/v0-commands.md` | cite |
| Genre rules, timing bounds, genre evidence for "message truth" | `motion-studio/playbooks/*` | cite |
| Engine rules, file allow-lists | `motion-studio/engines/*` | cite |
| Looks, pattern list, style bible, taste profile | `motion-look` | cite by skill name |
| Rubric, evidence packet, reviewer output format | `motion-critique` | cite by skill name |
| Term names and recipes | `motion-vocabulary` | use terms verbatim |

Cross-skill references use the skill name ("load the `motion-look` skill"). Never use a path into another skill. Paths inside a skill are relative.

## Project folder layout (per film, in the user's working directory)

```
films/<slug>/
  BRIEF.md                 XML sections: inputs, direction, structure, build, gotchas, start
  storyboard.json          machine source of truth
  ledger.json              canonical asset ledger
  style-bible.md           when a reference was given
  taste-snapshot.json      copy of ~/.motion-studio/taste.json at G1
  beats.json               beat grid
  assets/                  frozen local asset files
  shots/<shot-id>/         one engine project per shot (HyperFrames or Remotion)
  stills/<gate>/           rendered stills; approved copies frozen under stills/approved/<gate>-<hash8>/
  animatic.mp4
  renders/<format>/        shot clips, master, final
  audio/                   mix inputs and master mix
  critique/loop-<n>.md     reviewer output per loop
```

## storyboard.json (v0 field names; ticket #4 schema)

The CLI JSON Schemas `cli/schema/storyboard.schema.json` and `cli/schema/ledger.schema.json` define every field. `skills/motion-studio/reference/storyboard-schema.md` explains them. The example below is a minimal valid project: `motion-studio validate` accepts it when `shots/s01/index.html` exists (a CLI test checks this).

```json
{
  "version": "0",
  "meta": { "title": "Atlas launch", "logline": "Find the answer in one search.", "genre": "product-launch",
            "formats": { "primary": "16:9", "extra": ["9:16"] }, "fps": 30, "durationFrames": 60,
            "canvas": { "width": 1920, "height": 1080 } },
  "look": { "id": "keynote-minimal", "styleBible": null, "axes": {}, "tasteSnapshot": null },
  "audio": { "track": null, "grid": "imported", "bpm": 120,
             "beatFrames": [0, 15, 30, 45], "downbeatFrames": [0], "dropFrames": [], "confidence": "high" },
  "voice": null,
  "shots": [ { "id": "s01", "startFrame": 0, "endFrame": 60, "engine": "hyperframes",
               "entrypoint": "shots/s01/index.html", "description": "Query becomes a search field", "camera": "custom:slow push",
               "entry": "cut", "exit": "cut", "assets": [], "soundCues": [],
               "stillFrames": [0, 30, 59], "protected": [] } ],
  "gates": [ { "id": "G1", "state": "pending", "inputHashes": {}, "decision": null, "notes": [], "rounds": 0 },
             { "id": "G2", "state": "pending", "inputHashes": {}, "decision": null, "notes": [], "rounds": 0 },
             { "id": "G3", "state": "pending", "inputHashes": {}, "decision": null, "notes": [], "rounds": 0 },
             { "id": "G4", "state": "pending", "inputHashes": {}, "decision": null, "notes": [], "rounds": 0 },
             { "id": "G5", "state": "pending", "inputHashes": {}, "decision": null, "notes": [], "rounds": 0 } ],
  "critique": []
}
```

Allowed values: `genre` is `product-launch`, `ui-morph-loop`, `explainer`, `showreel`, `social-kinetic-type` or `null`; `grid` is `detected`, `corrected`, `imported` or `null`; `confidence` is `high`, `low` or `null`; `engine` is `hyperframes` or `remotion`; `entry` and `exit` are `cut` or `handoff`; gate `state` is `pending`, `approved`, `changes` or `stale`. Optional shot fields: `transition` (a `motion-vocabulary` term for the named move, D42) and `offBeatCut` (the reason a cut is intentionally off the beat grid, D41).

Ranges are half-open: `[startFrame, endFrame)`. Beat time to frame: `round(seconds * fps)`, one rule everywhere.

## Taste profile (`~/.motion-studio/taste.json`)

```json
{ "version": 1, "liked": [ { "kind": "look|move|pacing", "value": "", "note": "", "date": "" } ],
  "rejected": [ { "kind": "look|move|pacing", "value": "", "note": "", "date": "" } ],
  "notes": [ { "text": "", "terms": [], "date": "" } ] }
```

## Writing rules for every skill file

- Follow the `writing-for-agents` skill and its `SKILL-MECHANICS.md`. Each step ends on a checkable completion criterion. Use progressive disclosure: SKILL.md stays short and points to files.
- Plain simple English: short sentences, active voice, no em dashes. State the positive target; pair any unavoidable ban with its replacement.
- Harness-neutral dispatch wording: "dispatch a fresh subagent with brief X and paths Y". Give the inline fallback and label its review as non-independent.
- Copy content only from MIT or Apache-2.0 sources, with attribution.
- Mark every manual v0 step with the ticket that replaces it, for example "(CLI: `motion-studio mix`, #3)".
