# Style bible: ledger-launch

Fixture for `motion-studio style-bible`. It follows the motion-look style-bible template: two references, one video and one image folder, each with evidence, take and do-not-take lines.

## Product translation
- Logline and product: Ledger closes the books in one click, https://example.com/ledger
- Real assets: logo `assets/logo.svg`, Inter Tight and IBM Plex Mono files, palette ink `#111111` and signal `#E4572E` from the brand kit
- Look and axes: swiss-grid; grid density: dense 6-column; signal use: whole data row
- Visual rule: paper canvas, dominant type left-aligned on column 1, one signal accent, focal object the close button
- Motion rule: `mask-line-reveal` for each claim, `straight-cut` on the downbeat, one `push-in` onto the button

## References

### ref-a: reference/launch-film.mp4 (creator upload, rights: direction only)
- Evidence: frames/ref-a/sheet-001.png cells A1 to D4 (0 to 7.5 s), sheet-002.png cells A1 to B2 (8 to 9.5 s)
- Structure and pacing: title card, three UI close-ups cut on the beat, end card; observed cuts only, no camera travel
- Type, palette and material: heavy grotesk, black on off-white, one red rule per frame
- Take: hard cuts on the beat between full-bleed UI crops, one red rule that marks the changed value
- Do not take: their product UI, their slogan and the red logo lockup; use the Ledger close flow and the Ledger mark

### ref-b: reference/posters/ (image folder, rights: unknown)
- Evidence: frames/ref-b/sheet-001.png cells A1 to C1 (poster-1.jpg, poster-2.jpg, poster-3.jpg)
- Structure and pacing: stills only; motion is not observable and any motion here is inferred
- Type, palette and material: six-column grid with hanging captions, flat print paper
- Take: captions anchored to a visible column line, numbers set in a mono face
- Do not take: the poster photographs and the exhibition names; replace them with Ledger totals

## Build handoff
- Hero pose: close button at column 5, claim on columns 1 to 4, same grid for 16:9 and 9:16
- Applied shared and look-specific pattern replacements: Uniform fade-in → `mask-line-reveal`; Floating labels without alignment → labels on a column line
- Open facts: rights for ref-b are unknown
