# Evidence packet and v0 extraction

Build one packet **per reviewed render and format**. Record the file path, format, fps, revision/input hashes, duration in frames and extraction commands. Check the generated images against the real video before dispatch. All frame numbers below are zero-based global timeline frames. Convert a shot-local frame by adding `shots[].startFrame`; `[startFrame, endFrame)` is half-open. Use the same storyboard fps for every conversion: `round(seconds * fps)`.

## Required in-studio inputs

The third column names the v0 route. "Manual" means the dispatcher copies the item into the packet by hand; no CLI command assembles the packet yet. A ticket number names the CLI command that will replace the step.

| Input | Source and check | v0 route |
|---|---|---|
| Logline, genre and shot descriptions | `BRIEF.md` and `storyboard.json`; note any mismatch. Load the `motion-studio` genre playbook for claims and timing. | Manual |
| Chosen look or style bible | The approved look, its variation axes and `style-bible.md` if supplied. | Manual |
| Shared and look-specific pattern → replacement pairs | Load `motion-look`; pass the actual list, not a remembered list. | Manual |
| Frozen approved still beside its matching rendered frame | Use `stills/approved/<gate>-<hash8>/`, shot id, approved local frame and exact global frame; place both images in the review packet with labels. Verify the frame matches the render revision. | Extract and pair below (#7). For a handoff seam, `motion-studio handoff` writes the seam frame pair and report |
| Contact sheet | Sample 1 fps across the **entire** rendered clip. Keep numbered pages and timestamps; do not substitute an old sheet. | Tile below (`sheet`, #7) |
| Transition strips | Full-rate frames around **every** declared cut or handoff, including the preceding and following frame. Record each cut frame and shot pair. Include suspected fast-motion spans if the video reader cannot scrub. | Tile below (`sheet`, #7) |
| Glitch findings | `renders/<format>/scan.json` from `motion-studio scan films/<slug> [format]`, run on the reviewed master. Check that its `sha256` matches the reviewed file. Flags with `status: "context"` fall on a declared cut, handoff seam, hold or effect and are not defects. Blocking flags (blank frames, frame-count errors, unintended single-frame pops) stop review until fixed; pass advisory flags (stutter, hitch, flash, color jump, ghost) to the reviewer with their shot and frame, and inspect those frames in the strips. In standalone mode run `motion-studio scan <video-file> --report <file.json>`; it knows no cuts or holds, so treat its advisory flags as questions. | `motion-studio scan` |
| Beat grid and sync report | Beat grid from `storyboard.json` `audio` (`beats.json` in the v0 manual flow), storyboard beat and cut/event frames, measured integrated LUFS and measured SFX peaks. Note low-confidence or corrected grids. | `motion-studio mix` writes `sync.json`; otherwise measure below |
| Draft clip | Give the actual video path if the harness can read video. Otherwise state that continuous motion and audio listening are not directly verified; strips cannot prove continuous easing. | Manual |

In standalone mode, the video is the only required input. Generate sheets and strips where possible. Record each missing brief, board, look, beat grid and ledger; pass unverified checks to the reviewer. Never fill absent evidence with a guess.

## Image commands (CLI: `sheet`, #7)

Use `ffprobe` to verify fps and frame count before extracting. The examples assume a constant-frame-rate video whose first decoded frame is global frame 0. If timestamps or variable frame rate differ, reconcile them with the project timeline before comparing stills or reporting offsets. Use a unique output directory for each render and format. Set `VIDEO` to the actual render and `OUT` to that directory.

```sh
mkdir -p "$OUT"
ffprobe -v error -count_frames -select_streams v:0 \
  -show_entries stream=r_frame_rate,avg_frame_rate,nb_read_frames \
  -of default=noprint_wrappers=1 "$VIDEO"
# 1 fps; tile writes numbered pages of at most 25 samples, not just page one.
ffmpeg -hide_banner -nostdin -i "$VIDEO" \
  -vf 'fps=1,scale=320:-1:flags=lanczos,tile=5x5:margin=4:padding=4' \
  -vsync vfr "$OUT/contact-%03d.png"
# For each cut at first frame C of the next shot, set CUT=C; 11 consecutive frames.
# Use a full-frame-rate input. Clamp the range at the actual first and last frame.
ffmpeg -hide_banner -nostdin -i "$VIDEO" \
  -vf "select='between(n,$((CUT-5)),$((CUT+5)))',scale=320:-1:flags=lanczos,tile=11x1:margin=4:padding=4" \
  -vsync vfr -frames:v 1 "$OUT/transition-${CUT}.png"
# Extract one rendered frame G=shot.startFrame+approvedLocalFrame for a still pair.
ffmpeg -hide_banner -nostdin -i "$VIDEO" \
  -vf "select='eq(n,$G)'" -vsync vfr -frames:v 1 "$OUT/render-frame-${G}.png"
```

Contact tiles run left to right, then top to bottom. Page 1 starts at second 0; page 2 starts at second 25. Use the source timestamps to confirm this map, especially if the video does not start at zero. A full-width transition tile runs left to right from `CUT-5` through `CUT+5`; its center is `CUT`. Write this index map beside each sheet and strip. The tile is a navigation image, not the only source for technical judgment. Inspect native-size source frames for a suspected defect. For a transition within five frames of either end, set the tile width to the number of selected frames, or extract those frames individually. Check the count of contact pages, each cut strip and every still pair against the actual frame indices. Do not use approximate `-ss` seeking to certify an exact still.

## Sync report

When the film was mixed with `motion-studio mix`, use its `sync.json` (integrated LUFS, per-cue peak offsets, cut-to-beat offsets and `offBeatCut` reasons) and check that it belongs to the reviewed render. Otherwise v0 reports evidence, not a finished mix. Measure the **actual reviewed mix**. Parse `input_i` from loudnorm's JSON for integrated LUFS; `output_i` from a normalization run is not a measurement of the final file. Read the actual beat grid (`storyboard.json` `audio`, or `beats.json` in the v0 manual flow) and storyboard frames rather than guessing tempo. Example:

```sh
ffmpeg -hide_banner -nostdin -i "$VIDEO" -map 0:a:0 \
  -af 'loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json' -f null - 2> "$OUT/loudnorm.txt"
# For each SFX source, measure the peak of consecutive 480-sample windows at 48 kHz.
ffmpeg -hide_banner -nostdin -i "$SFX" -map 0:a:0 \
  -af "aresample=48000,pan=mono|c0=0.5*c0+0.5*c1,asetnsamples=n=480:p=1,astats=metadata=1:reset=1,ametadata=mode=print:key=lavfi.astats.Overall.Peak_level:file=$OUT/sfx-peaks.txt" \
  -f null - 2> "$OUT/sfx-metadata-log.txt"
# When onset must be inferred rather than declared, tune the threshold to this mix.
ffmpeg -hide_banner -nostdin -i "$VIDEO" -map 0:a:0 \
  -af 'silencedetect=noise=-35dB:d=0.015' -f null - 2> "$OUT/onsets.txt"
```

For mono SFX, omit the `pan` filter; for more than two channels, downmix explicitly and document it. Read `lavfi.astats.Overall.Peak_level` for each window and take the largest value with its window index `k`. The source peak time is approximately `(k + 0.5) * 480 / 48000` seconds. Find the placed SFX start frame from the storyboard/mix placement record. Compute `peakFrame = round((placementSeconds + peakSeconds) * fps)` and `offsetFrames = peakFrame - visualEventFrame`. If placement is already in frames, use `round(placementFrame + peakSeconds * fps)`. Windowing adds at most 5 ms of time uncertainty; note collisions or ties. Cross-check a masked or heavily processed hit against the actual mix. Without a reliable placement record, report peak sync **unverified** rather than attributing an onset to the wrong sound.

For each cut declared to land on a beat, compute `cutFrame - nearestBeatFrame` from the approved grid. Record the nearest beat frame and signed offset. List intentional off-beat cuts separately. If storyboard cues or beat metadata are absent, leave those comparisons unverified. `silencedetect` gives candidate `silence_end` onset times only when a quiet gap precedes the event. Music beds, overlapping SFX and compression hide onsets; annotate events manually against the waveform when needed. Report integrated LUFS, every measured offset, exceptions, and the exact command/input files. When no audio stream exists, state that loudness and audio sync are unverified.
