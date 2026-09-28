# Audio sync

Shot renders contain video only. Place music, narration and effects on the master timeline, then measure their alignment.

- **Downbeat** (`downbeat`) - The first beat of a musical bar gives a strong point for a new section.
  - HF: Land a visual pose on the downbeat's timeline label; place music in the master mix.
  - Remotion: Convert downbeat time to a frame and end the visual `interpolate()` interval there.
- **Drop** (`drop`) - A music build releases into a stronger section that can carry a main reveal.
  - HF: Time the visual flood or reveal to the measured drop frame, then mix the track externally.
  - Remotion: Start the reveal `<Sequence>` at the measured drop frame; keep the track in the master mix.
- **Hit on the drop** (`hit-on-the-drop`) - A key visual pose and its accent sound land on the music's drop together.
  - HF: Set the visual landing to the drop label and align the effect's measured peak in the master mix.
  - Remotion: End the pose interpolation at the drop frame and align the effect peak on the master timeline.
- **Riser** (`riser`) - A sound grows toward a landing, creating expectation before the event.
  - HF: Start the riser in the master mix before a labeled visual landing.
  - Remotion: Lead the target landing frame with a riser clip on the master audio timeline.
- **Whoosh** (`whoosh`) - A moving sound follows a fast graphic or camera travel.
  - HF: Time the whoosh peak in the master mix to the visual speed peak.
  - Remotion: Find the interpolated speed peak and place the whoosh's measured peak on that frame in the mix.
- **Impact** (`impact`) - A brief accent sound emphasizes an arrival, cut or collision.
  - HF: Land the event at a timeline label and align the downloaded effect's measured peak in the mix.
  - Remotion: Land the event on a frame and place the effect so its measured peak reaches that frame.
- **Word cue** (`word-cue`) - A visual change starts when a specific narration word is spoken.
  - HF: Convert the word timestamp to a GSAP timeline label and reveal there.
  - Remotion: Convert the word timestamp to the nearest frame and start the visual `<Sequence>` there.
- **Audio bed** (`audio-bed`) - A continuous background layer maintains sonic context beneath discrete cues.
  - HF: Hold the picture as needed and mix the background layer on the master audio timeline.
  - Remotion: Keep video-only shots independent; mix the bed continuously across shot boundaries.
- **Stinger** (`stinger`) - A short musical phrase identifies a section or brand at a decisive moment.
  - HF: Land the logo pose at the stinger's measured emphasis and place sound in the mix.
  - Remotion: Align the logo's final frame to the stinger emphasis frame on the master timeline.
- **Loudness** (`loudness`) - The measured average level of the finished mix controls perceived playback volume.
  - HF: Mix outside the video-only shot render and measure the final master in LUFS.
  - Remotion: Keep shot output silent; measure integrated LUFS after the master mix is assembled.
