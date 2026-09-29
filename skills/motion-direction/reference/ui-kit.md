# UI kit

Build a UI kit when captures are missing or a shot needs product behavior. Build it before any shot uses it. [D: D78]

## 1. Build the kit

- Keep the kit in its own film project, for example `films/<slug>-ui-kit/` made with `motion-studio init`, one shot per component. The film's `storyboard.json` holds only film shots: `validate` requires shots to tile the film from frame 0 to `meta.durationFrames`, so a kit shot there breaks validation or ends up in the film. Copy a checked component into the film shot that uses it, with its token file.
- Build it in Remotion (React). Use the brand's own components when their source is public; otherwise copy shadcn component source into the shot and theme it with the brand tokens from the sourced-assets list ([asset first](asset-first.md)). The CLI bundle has no Tailwind step and imports only the packages the Remotion engine contract lists, so write the styles as inline styles read from a JSON token file in the shot folder.
- Copied shadcn source imports packages the bundle does not have. Rewrite each import before the first render: a Radix primitive becomes a plain element (the shot drives state from the frame, not from input events); a `cva` variant set becomes a style object keyed by variant; a `lucide-react` icon becomes an inline `<svg>` with the icon's path copied in and a comment that names lucide and its ISC license, or the brand's own icon; `cn(...)` class names become merged inline styles.
- Read every visual value from one token file (palette, radius, type scale, shadows). A literal color or size in a component is a token that went missing.
- Use the real type scale, the brand's icons, real shadows and realistic content: real product names, plausible data, text that fills its box the way the product's text does. Grey bars in place of text are placeholder UI, a defect. [D: D78]
- Write each behavior as a function of the frame (`useCurrentFrame`): typing, filtering, selection, expand. The interaction script for each UI beat is in [product UI](product-ui.md).

Done when each component the board names exists in the kit project, imports only the Remotion contract packages and reads all its visual values from the token file.

## 2. Render stills and behavior clips

- Render each component as a still at its key state and as a short behavior clip, in its own Remotion shot of the kit project, with `motion-studio still` and `motion-studio render`.
- The fixture `cli/fixtures/ui-kit` in the motion-studio repository shows the minimal form: one search field themed from `tokens.json`, a still at frames 0 and 11 and a 12-frame clip in which the query types and the selection sweeps in.

Done when every component has a still and every behavior the board names has a clip.

## 3. Check fidelity before use

Compare each kit still with the brand site (a capture of the same screen) or with a designed reference frame, side by side at the same size. Check palette, type face and scale, radius, spacing, icons and content. List each difference and fix it, or write why it stays.

Done when every kit still has a side-by-side comparison with no unexplained difference. Only then may a shot use the component.
