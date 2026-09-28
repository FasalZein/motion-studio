# Kinetic type

Use the text itself to deliver a claim; align narration-led reveals to the spoken words.

- **Mask-line reveal** (`mask-line-reveal`) - A line rises into view from behind a fixed clipping edge.
  - HF: Put the line inside an overflow-hidden wrapper; GSAP `fromTo` its vertical transform.
  - Remotion: Clip a fixed-height line wrapper and `interpolate()` the child's vertical position.
- **Per-word stagger** (`per-word-stagger`) - Words enter in sequence so each word receives a separate moment.
  - HF: `dynamic-content-sequencing` schedules word intervals, then GSAP `fromTo` each word.
  - Remotion: Give each word a frame offset in `<Sequence>` and interpolate its entry locally.
- **Per-character stagger** (`per-character-stagger`) - Letters enter in order rather than as a complete word.
  - HF: GSAP `fromTo` indexed glyph spans with a short, bounded stagger.
  - Remotion: Split into glyph spans and offset each glyph's local frame before interpolation.
- **Type-on** (`type-on`) - Characters appear as if someone is entering them into a text field.
  - HF: `discrete-text-sequence` chooses the visible substring at each threshold.
  - Remotion: Slice the source string by a frame-derived character index; use fixed line breaks if needed.
- **Token swap** (`token-swap`) - One variable word changes while the rest of the sentence remains fixed.
  - HF: `discrete-text-sequence` swaps only the variable span at beat thresholds.
  - Remotion: Select a token from frame thresholds inside a fixed-size span to prevent layout jumps.
- **Beat slam** (`beat-slam`) - A short phrase arrives forcefully and locks to a musical accent.
  - HF: `kinetic-beat-slam` puts distinct phrase entrances on a shared beat array.
  - Remotion: Map each beat frame to a phrase `<Sequence>` and interpolate translation or scale to its landing.
- **Tracking spread** (`tracking-spread`) - The gaps between letters change while their word remains readable.
  - HF: GSAP tween `letterSpacing` on a fixed-width text layer and check line wraps.
  - Remotion: Interpolate `letterSpacing` within a fixed text box and measure the end layout.
- **Number count-up** (`number-count-up`) - A displayed value advances to a sourced final number.
  - HF: `counting-dynamic-scale` drives a numeric display on a seek-safe timeline.
  - Remotion: Round an interpolated value from a source field; use tabular figures for stable width.
- **Marker sweep** (`marker-sweep`) - A highlight stroke crosses a phrase to direct attention.
  - HF: `css-marker-patterns` scales a highlight strip from its leading edge.
  - Remotion: Interpolate an overlay strip's `scaleX` behind the measured phrase bounds.
- **Word-cued reveal** (`word-cued-reveal`) - A visual phrase appears when narration reaches the matching word.
  - HF: Map word timestamps to paused timeline labels; `asr-keyword-glow` can accent the spoken token.
  - Remotion: Convert each word timestamp to a frame and start a `<Sequence>` at that frame.
