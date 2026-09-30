# Score direction and timing

Read this before arranging a film. Music and effects are one plan, not a bed with late whooshes.

## Derive the arc from the board

Read each `beatmap.md` row for motion event, camera, seam thread, sound cue and live content. Name the introduction, build, main reveal, proof and logo resolution. Tie the strongest musical return to the most important visual reveal, not every seam.

For a 15-second film, select about 3-6 important events. Add those events to the existing `shots[].soundCues`; their `eventFrame` is a film frame, not a shot-local frame. The reveal and logo selectors name existing cues. No second cue sheet carries different times.

The renderer replaces planned cue assets with new synthesized composites. It synthesizes attacks on the cue's event frame, then measures each new stem's peak. Import records the corresponding whole-frame `peakOffsetFrames` for `mix`, whose placement uses peaks rather than onsets. Existing source-file peak offsets do not describe these new sounds. If a source cue requires an intentional pre-hit, revise that audio plan before synthesis; keep risers in the music bed and impacts in hit stems.

## Tempo and structure

Frames per beat = fps * 60 / BPM. At 30 fps, 120 BPM is 15 frames per beat; 100 BPM is 18. Use the supplied constant whole-frame grid planned before G2 in `motion-studio/agents/board.md` step 1. An empty grid refuses scoring and points back to that step. A detected grid with jitter must be corrected before synthesis. The renderer refuses off-grid events instead of silently changing the board.

A synthesized intro stays sparse. Bass, drums and a pitched pattern become stronger at the reveal. Drop the music for 1-4 beats before that reveal. A filtered noise riser ends at the event sample; the 95-to-36 Hz, 1.4-second sub drop starts there. The riser is a separate anticipation stem in the bed, not a pre-onset in the hit stem. Its final 100 ms targets 0.12 stereo RMS before mastering; the report compares it with the post-reveal bed. Musical buses fade over 10 ms into a measured silent dropout.

UI sounds last 90 ms and use the tonic scale. The logo sting resolves to the tonic with a low tonic voice and a 2.4-second chord tail, trimmed at the film end. Leave enough picture time for that tail. Choose tonic, palette and instruments from the brand and idea. The included electronic palette is a starting arrangement, not evidence that one stock pattern fits every film. Edit the saved score script when the brand needs a different original arrangement.

## Mix and rights

The score produces drums, bass, harmony, texture, anticipation, music, individual hit composites, and a mastered `score.wav` preview. Stems are 48 kHz stereo, 24-bit PCM. The bed includes anticipation; the hit stems have silence before their event. The preview contains both. Use only the music bed and the hit cues as CLI mix inputs.

The reusable instrument library makes polyBLEP saws, detuned chord pads with cutoff sweeps, saw/sub bass, kicks, hats, claps, noise cracks, panning whooshes and FM UI bells. The arranger applies kick sidechain, seeded convolution reverb and beat-relative ping-pong delay. Chord bars count backward from the actual logo frame so the last bar is V, then the logo lands on I. Cue kind comes from existing asset names, shot descriptions, timed moves, transitions and camera vocabulary; hit filenames retain that kind for later revisions. Pedalboard filters, compresses and limits the signal. ffmpeg loudnorm supplies an oversampled true-peak ceiling. The CLI performs its own final loudness check and limiter after adding narration. It ducks only the bed by its existing 12 dB rule; it does not duck the SFX or logo. That existing contract takes precedence over the research's general 3-6 dB suggestion.

Resolve Pixabay at `Path.home() / '.agents/skills/media-use/audio/assets/sfx'` on every run. Decode, trim, fade and layer it with original synthesis. The logo branch never reads stock. Export neither raw MP3 copies nor stock-only stems. Record source path, content hash and Pixabay Content License URL in every composite's evidence. A source path is not proof of rights; retain the bundle's license evidence when using a different bundle.

## Objective checks and their limits

- Measure the delivered preview with ffmpeg ebur128, not a pre-master bus. Require -14 +/- 0.5 LUFS and true peak <= -1 dBTP.
- Decode each hit stem. Use librosa RMS at hop 128 and its backtracked onset detector at 48 kHz. Both the first audible energy and detected onset must be within one frame of the cue. A mix peak is not an onset check.
- Render again from the same seeded inputs. Compare SHA-256 for every WAV, including stems. Keep the script and library hashes, environment versions and input hashes with the report. Different ffmpeg, plugin or Python package versions can change bytes.
- Treat band energy, pre-limiter peak and stereo correlation as diagnostics. They identify risks, not calibrated aesthetic failures. Inspect the planned musical dropout separately from the riser that intentionally fills it.
- CLAP is a mood hint, FAD compares sets, and aesthetics models are weak signals. None can block this skill's delivery.

The G4 listen settles mood, harshness, masking, perceived timing, ending and SFX density. Objective success does not supply ears. Use the five questions and parameter map in `SKILL.md`.
