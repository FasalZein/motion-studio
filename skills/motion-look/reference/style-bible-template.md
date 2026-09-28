# Style bible: <project or standalone title>

Use this as an output template. A video supplies motion evidence; a single image supplies visual evidence only. Label inferred motion as unverified for still-image sources. Record the source URL or local path and its rights status. Reference analysis is direction, not permission to reuse source media.

## Product translation
- Logline and product: <claim, product URL>
- Real assets: <logo, type files, palette, UI, provenance>
- Look and axes: <look id or bespoke direction; axis names and values>
- Visual rule: <canvas, dominant type, accent, hierarchy, focal object>
- Motion rule: <named vocabulary terms, scene-to-scene cause>

## References

### <source id, URL or path, rights status>
- Evidence: <contact-sheet path; frame timestamps or image names>
- Structure and pacing: <ordered visual events; observed transition and camera direction; distinguish observations from inference>
- Type, palette and material: <observable properties; measured colors only when sampled>
- Take: <specific visual method to adapt to the product>
- Do not take: <subject, identifiable composition, logo, exact copy or other source-specific material; state the replacement>

Repeat this section for **every** reference. Distinguish conflicting references and choose one rule when they disagree.

## Build handoff
- Hero pose: <product asset, claim, focal point, layout for each format>
- Applied shared and look-specific pattern replacements: <source pattern → chosen move>
- Open facts: <missing asset, source rights, or motion not observable from stills>

### Video extraction in v0

Use ffmpeg directly. `motion-studio sheet` works only on a film's stitched master, not on a reference video. Set `REF` to a local video and `OUT` to a writable folder. Extract every half-second, then assemble contact sheets in time order. Quote paths and keep one source per folder so frame numbers do not mix.

```sh
mkdir -p "$OUT/frames"
ffmpeg -nostdin -i "$REF" -vf 'fps=2,scale=480:-1' "$OUT/frames/%05d.png"
ffmpeg -nostdin -pattern_type glob -i "$OUT/frames/*.png" -vf 'tile=4x4' -fps_mode passthrough "$OUT/sheet-%03d.png"
```

The tile filter emits another sheet after each group of 16. Check that **every** extracted frame appears on a sheet. Label cells in the style bible from A1 to D4, left to right, top to bottom. Sheet 1 cell A1 is `00001.png` at 0 seconds; sheet 2 cell A1 is `00017.png` at 8 seconds. The time of frame `NNNNN.png` is `(NNNNN - 1) / 2` seconds. For images, list each cell and filename instead. Done when every cell can be traced to its source file and time.
