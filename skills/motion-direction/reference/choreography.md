# Choreography

How elements move inside a beat. Use `motion-vocabulary` `terms/timing-physics.md` for ids and engine recipes.

## Staging

- One element leads at a time; the eye follows one thing. Everything else supports it or waits. [S: video-storytelling]
- Every motion has a job: it reveals, connects, explains or lands a beat. Motion for its own sake is noise. [S: wwdc18]
- Start from what matters most, then layer detail on top. [S: ordinary-folk]

## Stagger and overlap

- Related elements enter in sequence, not on one frame (`stagger`). The source gives offsets of 3 to 6 frames. [S: remotion-motion-graphics]
- The next move starts before the previous one settles (`follow-through`, overlap), so motion reads as one continuous curve. [S: wwdc18 (seamless motion)]
- An entrance moves 2 to 3 properties together (for example position, scale and opacity); a lone fade is weak. [S: remotion-motion-graphics]

## Springs and easing

- No linear easing on an entrance or exit. Use `ease-out`, `ease-in-out` or a spring. [S: remotion-motion-graphics]
- Prefer springs and velocity-preserving curves; give mass per object (light for small UI, heavy for panels), so different sizes settle differently. [S: wwdc18, wwdc23, video-storytelling]
- Keep velocity continuous: no sudden direction change when a new move joins. [S: wwdc18]
- Save the strongest ease (overshoot) for the beat that deserves it; reuse it rarely. [S: video-storytelling]

## Faster exits

- Exits are faster than entrances; the source gives about 10 frames against about 20. [S: remotion-motion-graphics, video-storytelling]
- A finished element leaves or recedes: it stays quiet but legible while the next element takes focus. [S: video-storytelling]

## Spatial consistency

- An element leaves the way it came. [S: wwdc18]
- Directions keep their meaning across shots (for example forward is left to right). [S: video-storytelling]
- A shared element keeps its size, color and place across a seam unless its change is the motion event. [S: wwdc24]
