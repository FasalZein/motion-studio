# Storyboard v0

`storyboard.json` is the machine source of truth. Version `0` uses the field names below. The CLI JSON Schemas `cli/schema/storyboard.schema.json` and `cli/schema/ledger.schema.json` define every field; `motion-studio validate films/<slug>` checks them (CLI #4). Frames are integers; shot ranges are half-open and cover `[0, meta.durationFrames)` without gaps or overlap. `stillFrames` are **shot-local**. Convert seconds by `round(seconds * fps)`. `entry`/`exit` are `cut` or `handoff`; a handoff requires a matching adjoining shot (the previous shot's `exit` equals this shot's `entry`). `camera` and the optional `transition` use a `motion-vocabulary` term, or `custom:<description>`. `transition` names the move at the shot's entry (D42). The optional `offBeatCut` gives the reason the cut at the shot's `startFrame` is intentionally off the beat grid (D41). `protected` entries name elements whose held bounds must fit each layout's safe rectangle. `inputHashes` map project-relative gate input paths to SHA-256 hex strings; a part of `storyboard.json` uses a key such as `storyboard.json#/audio` and is hashed as canonical JSON. `motion-studio gate` writes them (CLI #5). Gate `decision` records the user's actual words or structured choice, not an inferred approval.

```json
{
  "version": "0",
  "meta": {"title":"Atlas launch", "logline":"Find the answer in one search.", "genre":"product-launch", "formats":{"primary":"16:9", "extra":["9:16"]}, "fps":30, "durationFrames":120, "canvas":{"width":1920, "height":1080}},
  "look": {"id":"keynote-minimal", "styleBible":"style-bible.md", "axes":{"contrast":"high", "density":"spare"}, "tasteSnapshot":"taste-snapshot.json"},
  "audio": {"track":"music-01", "grid":"corrected", "bpm":120, "beatFrames":[0,15,30,45,60,75,90,105], "downbeatFrames":[0,60], "dropFrames":[], "confidence":"high"},
  "voice": {"script":"audio/voice-script.txt", "tts":"voice-01", "wordTimings":"audio/word-times.json"},
  "shots": [
    {"id":"s01", "startFrame":0, "endFrame":60, "engine":"hyperframes", "entrypoint":"shots/s01/index.html", "description":"Query becomes a search field", "camera":"custom:slow push", "entry":"cut", "exit":"cut", "assets":["music-01","logo-01"], "soundCues":[{"asset":"sfx-01","eventFrame":30,"peakOffsetFrames":0}], "stillFrames":[0,30,59], "protected":[{"id":"query","bounds":"shots/s01/protected.json","heldFrames":[15,45]}]},
    {"id":"s02", "startFrame":60, "endFrame":120, "engine":"remotion", "entrypoint":"AtlasResult", "description":"Real results and claim", "camera":"custom:locked", "entry":"cut", "exit":"cut", "assets":["logo-01","ui-01"], "soundCues":[], "stillFrames":[0,30,59], "protected":[{"id":"claim","bounds":"shots/s02/protected.json","heldFrames":[20,45]}]}
  ],
  "gates": [
    {"id":"G1", "state":"approved", "inputHashes":{"BRIEF.md":"<64 hex SHA-256 of the actual file>","stills/G1/hero.png":"<64 hex SHA-256 of the actual file>"}, "decision":"approved keynote minimal", "notes":[], "rounds":0},
    {"id":"G2", "state":"pending", "inputHashes":{}, "decision":null, "notes":[], "rounds":0},
    {"id":"G3", "state":"pending", "inputHashes":{}, "decision":null, "notes":[], "rounds":0},
    {"id":"G4", "state":"pending", "inputHashes":{}, "decision":null, "notes":[], "rounds":0},
    {"id":"G5", "state":"pending", "inputHashes":{}, "decision":null, "notes":[], "rounds":0}
  ],
  "critique": [{"loop":1, "revisionHash":"<64 hex SHA-256 of the reviewed revision>", "filmScores":{"distinctiveness":8,"continuityAndPacing":8,"soundAndSync":8}, "shotScores":{"s01":{"motionQuality":8,"restraint":8,"hierarchyAndComposition":8,"messageTruth":8,"technicalFinish":8}}, "worstIssues":[], "stillMatches":[{"shot":"s01","frame":30,"status":"match","reason":"query matches approved still"}]}]
}
```

The example is illustrative: replace hash placeholders with real hashes before any approval; add ledger entries for every named asset. `voice` may be `null`; `audio.track` may be `null` when voice drives the film. `dropFrames` is empty when no drop exists. `confidence` can be `low`. Genres: `product-launch`, `ui-morph-loop`, `explainer`, `showreel`, `social-kinetic-type`. Gates use `pending`, `approved`, `changes`, or `stale`. Only record scores backed by reviewer evidence; mark other dimensions unverified.

## Changes from the first v0 draft (CLI #4)

- `meta.canvas` `{width,height}` is required. It is the master canvas of the primary format in pixels and must match the primary aspect ratio. Add it to older files; `init` writes 1920x1080 for 16:9.
- An empty project uses `null` for `meta.genre`, `look.id`, `audio.track`, `audio.grid`, `audio.bpm` and `audio.confidence` until the brief and beat phases set them.
- HyperFrames `entrypoint` is an HTML file under `shots/<id>/`. Remotion `entrypoint` is the composition id; its project entry file is `shots/<id>/src/index.ts` or `src/index.tsx`, and its public files live in `shots/<id>/public/`.
- `gates` lists `G1` to `G5` in this order. `critique[].worstIssues` holds at most 3 items.
- When `audio.beatFrames` is not empty, every `cut` between shots must be a beat frame (D41). Handoff seams are exempt. For an intentional off-beat cut, set `offBeatCut` on the later shot to a non-empty reason, for example `"word-timed reveal"`. The critique packet lists these cuts separately.
- Optional shot field `transition` holds the vocabulary term for the named move (D42). `entry` and `exit` stay `cut` or `handoff`, and both sides of a seam must agree. The first shot cannot enter by handoff and the last shot cannot exit by handoff.
- `critique[].worstIssues` items are `{shot, frame, term, issue, repair}`.
- Sound cues (CLI #3): `eventFrame` is a film frame and must lie inside the owning shot. `peakOffsetFrames` is the planned distance from the event to the SFX peak (0 puts the peak on the event, negative before it). The optional `gainDb` (-60 to 24, default 0) sets the SFX level before the mix is normalized. `audio.track` and each cue `asset` are ledger ids; `mix` reads their files from the ledger.
- `ledger.json` is `{"version":"0","assets":[...]}`; each entry has the fields in the assets brief. Every license needs non-empty evidence; a `known` license also needs a name. `localPath` is film-relative and `sha256` must match the file.

`validate` rejects a missing or unknown engine, a missing entrypoint, an asset id not in the ledger, a ledger file that is missing, outside the film folder or has the wrong hash, a gap or overlap in the half-open ranges, shots that do not cover `durationFrames`, an off-grid cut without `offBeatCut`, an unmatched handoff, a still frame outside its shot and an fps other than 24, 25, 30 or 60. `status films/<slug>` prints each gate state and the next step; on an unfinished film it also prints the number of validation errors instead of failing.

Completion: all shots cover the timeline, every path and asset id resolves, and gate approvals carry real hashes.
