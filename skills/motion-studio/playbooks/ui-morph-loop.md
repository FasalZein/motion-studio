---
genre: ui-morph-loop
status: untested
duration-seconds: 8
fps: 30
primary-format: 1:1
extra-formats: none
audio: track
---

# UI morph loop | untested until used

<inputs>Ask: What 6–10 UI states must one shape become, which real interactions drive it, and what is the loop's format? Default: button → loader → result → toolbar → slider → button; about 8 s; square primary; original 120 BPM score if available. Choose an original `motion-score` plan by default after Blocking and before Animatic. A reused or unchosen bed is a defect. A deliberately chosen licensed track needs the director’s `--waive score --note "director reason"` at G4, with its rights recorded. Keep narration audible; require the G4 human listen.</inputs>
<direction>One persistent visual identity changes shape, size and content. Use one local pinned UI font and one brand accent by default. Use `motion-vocabulary` interface and timing terms.</direction>
<structure>Template: establish button (one beat), action and loader (2 beats), result (2 beats), toolbar and direct manipulation (4 beats), return to button (2 beats). Allow 0.25–1 s living holds per state so an interaction reads (the UI keeps behaving); lengthen only for real text.</structure>
<build>Keep one engine through a continuous morph. Check last rendered frame against first, including cursor and audio seam, for every format.</build>
<gotchas>Message truth requires believable UI state changes and visible action-to-result causality; product-specific labels need source evidence. Guard against overlapping state text and a loop seam that jumps.</gotchas>
<start>Show the ordered state list and keyframe stills on the beat grid before full animation.</start>
