# Per-film project layout

Create this tree in the user's working directory, not inside the installed skill. Keep all engine projects within their shot folder. Paths in `storyboard.json` and `ledger.json` are relative to the film root.

```text
films/<slug>/
  BRIEF.md                  XML sections: inputs, direction, structure, build, gotchas, start
  storyboard.json           canonical film and gate state
  ledger.json               canonical rights and asset provenance
  style-bible.md            when a reference was supplied
  taste-snapshot.json       copy of global taste at G1
  beats.json                v0 manual grid; with the CLI the grid is storyboard.json audio
  assets/                   frozen local media, including pinned fonts
  shots/<shot-id>/          one engine project per shot
  shots/_look/<look-id>/    one G1 look-test project per candidate; not a film shot
  stills/<gate>/            engine-rendered review frames; G1 look tests at stills/G1/<look-id>.png
  stills/G2/sheet.png       G2 contact sheet built from the stills/G2/ frames; hashed with them
  stills/approved/<gate>-<hash8>/   immutable approval copies
  animatic.mp4
  renders/<format>/         shot clips, master picture, safezone.json, delivery files (16x9, 9x16, 1x1)
  audio/                    track, voice and SFX sources; master mix; beats.detected.json (CLI grid proposal, seconds)
  critique/loop-<n>.md      each reviewer output and evidence references
```

Store source URLs, retrieval dates, file hashes and rights in `ledger.json`. Engine manifests may exist but link each source back to a canonical ledger id. Preserve the same frame timeline for every format; render a fresh layout for each format.

`shots/_look/` holds G1 look tests only. `storyboard.json` never lists it, and its files are G1 inputs. After G1, the chosen candidate's source is copied to the hero shot's `shots/<shot-id>/` (see the `motion-studio` skill); `shots/_look/` stays unchanged.

Completion: every storyboard path resolves within this root and every used asset id resolves in the ledger.
