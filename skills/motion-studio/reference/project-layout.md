# Per-film project layout

Create this tree in the user's working directory, not inside the installed skill. Keep all engine projects within their shot folder. Paths in `storyboard.json` and `ledger.json` are relative to the film root.

```text
films/<slug>/
  BRIEF.md                  XML sections: inputs, direction, structure, build, gotchas, start
  storyboard.json           canonical film and gate state
  ledger.json               canonical rights and asset provenance
  style-bible.md            when a reference was supplied
  taste-snapshot.json       copy of global taste at G1
  beats.json                corrected or imported master grid
  assets/                   frozen local media, including pinned fonts
  shots/<shot-id>/          one engine project per shot
  stills/<gate>/            engine-rendered review frames
  stills/approved/<gate>-<hash8>/   immutable approval copies
  animatic.mp4
  renders/<format>/         shot clips, master picture, safezone.json, delivery files (16x9, 9x16, 1x1)
  audio/                    track, voice and SFX sources; master mix
  critique/loop-<n>.md      each reviewer output and evidence references
```

Store source URLs, retrieval dates, file hashes and rights in `ledger.json`. Engine manifests may exist but link each source back to a canonical ledger id. Preserve the same frame timeline for every format; render a fresh layout for each format.

Completion: every storyboard path resolves within this root and every used asset id resolves in the ledger.
