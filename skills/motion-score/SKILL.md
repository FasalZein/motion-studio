---
name: motion-score
description: Score a motion film with original synthesized music and sound effects. Use when planning audio against a storyboard, replacing an unchosen bed, rendering cue-synced stems, or revising sound after the G4 listen.
---

# Motion score

Make one original music-and-SFX plan from the film's beat contract. `motion-studio` owns gates; this skill owns the score. An unchosen or reused bed is a defect, not a finished score. Run the Score phase after Blocking and before Animatic. G4 uses that output and revises it only when needed.

## Score the film

1. **Read the timing.** Read `BRIEF.md`, `storyboard.json`, `beatmap.md` and the chosen style bible. Use `meta.fps`, `meta.durationFrames`, shot ranges and seams, `audio.beatFrames`, downbeats and drops, and `shots[].soundCues`. Pick the main reveal and logo from existing cue frames. Read [craft.md](reference/craft.md) before choosing tempo, palette and cues. Keep only the important hits; the renderer scores every declared cue. Complete when the music and SFX share one written arc and the reveal and logo each have an existing cue.
2. **Prepare the palette.** Use Python 3.11 or later and `ffmpeg` on PATH. Create a local venv, not global packages:
   ```sh
   python3 -m venv films/<slug>/.score-venv
   films/<slug>/.score-venv/bin/python -m pip install -r <motion-score>/scripts/requirements.txt
   ```
   Resolve `<motion-score>` to this installed skill's directory. Resolve Pixabay assets at run time from `~/.agents/skills/media-use/audio/assets/sfx`. The default needs `impact-bass-1.mp3` and `click-soft.mp3`; a missing bundle is a blocker. Choose `--sfx-density 0` explicitly for a synthesized-only plan. Complete when imports of numpy, scipy, pedalboard and librosa succeed and ffmpeg runs.
3. **Render a revision.** Choose a seed, tonic MIDI note, palette and new output directory. For example:
   ```sh
   films/<slug>/.score-venv/bin/python <motion-score>/scripts/score.py films/<slug> \
     --out films/<slug>/audio/scores/r1 --seed 51 \
     --reveal-frame 180 --logo-frame 360 --tonic-midi 62 --palette warm
   ```
   The frame values are examples, not film defaults. The script reads the storyboard directly; it does not invent a cue file. It reuses a constant whole-frame grid, or chooses 80-140 BPM with whole frames per beat. An off-grid cue refuses the render: correct the board and beat contract first. `--help` lists supported controls. Render each revision into a new directory. Complete when `audio-report.json` has `passed: true`, every hit is within one frame, `score.wav` measures -14 +/- 0.5 LUFS with true peak at or below -1 dBTP, and a second seeded render has identical WAV bytes.
4. **Record rights and mix.** With the CLI installed, run:
   ```sh
   motion-studio score-import films/<slug> films/<slug>/audio/scores/r1/audio-report.json --id score-r1
   motion-studio mix films/<slug>
   ```
   `score-import` checks input and WAV hashes, measures the preview, records every WAV through the asset ledger, and writes the storyboard through its standard writer. It sets `audio.track` to `music.wav` and replaces each sound cue with its composite hit stem and measured peak offset. It keeps narration unchanged. `score.wav` is the listening preview, not the bed: using it as the bed would double the SFX. `mix` supplies the existing narration ducking, normalization and delivery limiter. Use the grid approved at G2. If synthesis needs a new grid, return to Board and present G2 again before continuing. Complete when each chosen format has a current `mix.wav` and `sync.json`, and each audio file has an original-synthesis or Pixabay license record.
5. **Listen at G4, then stop.** Follow `motion-studio/reference/g4.md` with the playable draft, this revision's report, and the listening questions below. Save the user's exact answers in `audio/scores/<revision>/listening.md`. Apply one named parameter per answer, then rescore, import under a new revision id, mix and deliver a new draft. Objective checks cannot prove mood, masking or sound quality. The critic's audible judgment stays unverified until it actually hears the film. Complete when the user answers the questions and decides G4; silence is not approval. G4 approval requires a passing report, unchanged imported audio, a receipt matching the current bed and non-empty listening answers. An explicitly chosen licensed track needs the director's `--waive score --note "<reason>"`; rights checks still apply.

## Listening questions

| Ask the user while the draft plays with sound | Change one parameter |
|---|---|
| Which main hits feel early or late? Give the timecode. | Cue offset: correct the affected storyboard `soundCues[].eventFrame` against the actual visual event and update the beat contract. Keep it on the grid; rebuild picture if its cue changed. |
| Does the mood fit: fits, too dark, too busy, or too generic? | Palette: `--palette` changes voicing, register, bass and lead instruments. For “too busy”, change only `--density` to `sparse`; it reduces rhythmic subdivisions, kicks and lead notes. |
| Is anything harsh, muddy or too loud? Give the timecode. | EQ band: `--eq-hz` for harshness, or the affected stem's EQ in the saved script for low-band mud or excess. |
| Does the ending resolve on the logo? | Sting: `--tonic-midi`, or the original tonic voicing in the saved script. |
| Is there too much or too little SFX? | SFX density: `--sfx-density` for stock layers; remove or add selected storyboard cues for the number of hits. |

A response of “fits” or “yes” can mean keep the parameter. Record that explicitly. A large audible timing change requires a new board decision, not a relaxed timing check.

## Rights and limits

- Synthesize the logo sting only. Pixabay prohibits trademark use; none of its samples enter that stem.
- Export stock only inside creatively layered composite hit stems or the complete score. Keep bundled MP3 files outside the film and delivery bundle. Never ship a stock-only stem.
- `license.json` records each WAV, source hashes, and the Pixabay license URL when used. The CLI ledger carries that evidence for delivery.
- Tool licenses differ from output rights: pedalboard is GPL-3.0; librosa is ISC; numpy/scipy are BSD. Install them in the venv; do not bundle their code into a closed-source product without review.
- Warm uses low detuned pads, saw bass and sparse bells. Bright uses high pads, plucks, eighth-note bass and sixteenth hats. Dark uses minor low pads, sub bass and half-time drums with no arp. `--density sparse|normal|busy` changes note counts independently of palette.
- The report includes RMS/onset evidence per stem, loudness, true peak, determinism, band energy, pre-limiter peak and L/R correlation. Diagnostic fields are advisory. CLAP, FAD and aesthetics scores are not gates.
- Determinism covers the same script, seed, inputs, source assets and installed tool versions. Keep `score.py`, `instruments.py`, `arranger.py`, requirements, `audio-report.json`, `license.json`, seed and stems with the film. Change a parameter in a new revision, not in an approved output.
