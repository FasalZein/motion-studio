# Asset first

Source the brand's real material before the board, then design the idea line and the motif around what exists. [D: D78]

## 1. Source the brand's material

Collect each item into the ledger with `motion-studio assets <film> add` (see `motion-studio` `agents/assets.md`). Record the source URL and the capture date for every item.

- **Site images and card art**: the images the brand already uses (hero art, feature cards, product photos). Keep the original file, not a screenshot of it.
- **UI captures**: screenshots at 2x device scale, and screen recordings of the product doing its core action. `npx hyperframes capture <URL> -o <folder> </dev/null` saves site pixels and extracted tokens.
- **Logo**: the SVG from the brand's site or press kit. A raster logo is a fallback, labeled as such.
- **Fonts**: the brand's font files, or the nearest licensed match named as a substitute.
- **Design tokens**: palette hex values, corner radius, type scale, shadows and line weights, read from the site CSS or the design system.

Done when every item above exists in the ledger with its source URL and capture date, or has a written reason why the brand has none.

## 2. Write the sourced-assets list

Put a **Sourced assets** list at the top of the board (beat map): one row per ledger id with its role in the film (hero capture, card art, logo, font, token file), source URL and capture date. When the brand has no real material (a new product, no site), write that reason in the list instead of rows.

Done when the list exists. A board without the list, or without a stated reason for an empty list, fails the board completion check.

## 3. Design around what exists

- Take the idea line from the material: what the real card art, captures or mark can do on screen. The Bayland reference film built its whole idea from the brand mark's square cell and the site's own card art. [D: D78; I]
- Choose one motif from the brand mark (a shape, a cell, a stroke) and let it carry the seams. [D: D78]
- Derive the look from the brand when it has a site or design system: palette, type, radius, the motif. The `motion-look` library is a fallback for a brand without one. [D: D78]

Done when the idea line and the motif each name the ledger ids they are built from.

## 4. Treat captures as hero material

Real captures are hero material, moved with camera, masks, depth, 3D tilt and cuts on action. [D: D78]

- Move the camera over and through a capture: `push-in` to the detail that carries the claim, `parallax` across layered crops, a tilt in 3D space.
- Mask and crop to the one region that matters, and reveal it with the motion event of the beat.
- Cut on action from one capture to the next, so each cut lands while something moves.
- Grey placeholder UI (empty boxes, grey lines for text, windows with no content) is a defect. The board check and the critic name it. [D: D78]

## 5. Choose the UI source per shot

- A capture shows what the product looks like. Use it when the shot needs the real screen.
- Built UI shows what the product does. Build it only where the shot needs behavior a capture cannot show (typing, filtering, selection, expand), and match it to the captures. Build it as a UI kit first: [UI kit](ui-kit.md).
- Built UI renders in Remotion. Kinetic type, captures and catalog-block moves can stay in HyperFrames. Write the engine reason per shot in the board. [D: D78]

Done when every shot that shows the product names its UI source (capture ledger id or UI kit component) and its engine reason.
