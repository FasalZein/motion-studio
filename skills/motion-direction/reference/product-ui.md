# Product UI in motion

For product films only. Real captures are hero material; built UI adds behavior where a capture cannot show it. [D: D78; the UI part of D67 is superseded]

## Captures first, built UI for behavior

- Source the product's real screens first ([asset first](asset-first.md)): 2x screenshots and screen recordings, with the capture URL and date in the ledger. [D: D78]
- Move each capture as hero material: camera push and parallax over it, masks and crops that reveal one region, depth and 3D tilt, cuts on action. A capture that only scales or fades in place has no motion event. [D: D78]
- Rebuild UI in code only where the beat needs behavior: typing, cursor, selection, filtering, list reflow, results arriving, expand. Build it as a [UI kit](ui-kit.md) from the brand tokens, matched to the captures. [D: D78; S: apple-tv-ui, webex-ipad, wwdc18 (behavior over animation)]
- Grey placeholder UI (empty boxes, grey text bars, windows with no content) is a defect. [D: D78]
- Message truth comes from the capture: built UI shows only states the product has. [D: D78]

## Part of the world, not the structure

- The film is motion design, not a UI demo: the UI sits inside the world the camera moves through, next to type, shapes and light. [D: D67]
- The film's structure comes from the idea line, not from the order of app screens. [D: D67; S: clair-simple]
- Derive each visual device from the product itself (its shapes, its key object, its core action, the motif of its mark). [D: D78; S: guizang (idea only)]

## Write UI beats as interaction scripts

- For each UI beat, write the input sequence with frames: keystrokes, cursor path, click, result state. Use `motion-vocabulary` `terms/interface-in-shot.md` ids (`cursor-click`, `control-target-sync`, `result-reveal`, `ui-shared-element`). [S: webex-ipad; I]
- The UI keeps moving during a reading hold: a caret blinks, a result streams in, a list settles, the camera drifts across a capture. [D: D67]
- A UI element can be the thread of a seam (`shared-element-thread`, for example the search field carried into the next shot). [S: wwdc24]
