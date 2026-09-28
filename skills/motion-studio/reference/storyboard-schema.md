# Storyboard v0

`storyboard.json` is the machine source of truth. Version `0` uses the field names below; CLI #4 will formalize validation. Frames are integers; shot ranges are half-open and cover `[0, meta.durationFrames)` without gaps or overlap. `stillFrames` are **shot-local**. Convert seconds by `round(seconds * fps)`. `entry`/`exit` are `cut` or `handoff`; a handoff requires a matching adjoining shot. `camera` uses a `motion-vocabulary` term, or `custom:<description>`. `protected` entries name elements whose held bounds must fit each layout's safe rectangle. `inputHashes` map project-relative gate input paths to SHA-256 hex strings. Gate `decision` records the user's actual words or structured choice, not an inferred approval.

```json
{
  "version": "0",
  "meta": {"title":"Atlas launch", "logline":"Find the answer in one search.", "genre":"product-launch", "formats":{"primary":"16:9", "extra":["9:16"]}, "fps":30, "durationFrames":120},
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

Completion: all shots cover the timeline, every path and asset id resolves, and gate approvals carry real hashes.
