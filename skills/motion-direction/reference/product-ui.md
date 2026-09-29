# Product UI in motion

For product films only. The UI is one live object inside the film's world. [D: D67]

## A live object, not a screenshot

- Rebuild the UI in code (DOM or React) from a captured state and animate it as behavior: typing, cursor, selection, list reflow, results arriving. [D: D67; S: apple-tv-ui, webex-ipad, wwdc18 (behavior over animation)]
- Keep the capture URL and date in the ledger; the rebuild must stay true to the captured state. Message truth comes from the capture, motion from the rebuild. [D: D67]
- A screenshot appears only as a reference, a labeled plate or a background. A bitmap that only scales or fades is a pasted screenshot. [D: D67]

## Part of the world, not the structure

- The film is motion design, not a UI demo: the UI sits inside the world the camera moves through, next to type, shapes and light. [D: D67]
- The film's structure comes from the idea line, not from the order of app screens. [D: D67; S: clair-simple]
- Derive each visual device from the product itself (its shapes, its key object, its core action). [S: guizang (idea only)]

## Write UI beats as interaction scripts

- For each UI beat, write the input sequence with frames: keystrokes, cursor path, click, result state. Use `motion-vocabulary` `terms/interface-in-shot.md` ids (`cursor-click`, `control-target-sync`, `result-reveal`, `ui-shared-element`). [S: webex-ipad; I]
- The UI keeps behaving during a reading hold: a caret blinks, a result streams in, a list settles, the camera drifts across it. [D: D67]
- A UI element can be the thread of a seam (`shared-element-thread`, for example the search field carried into the next shot). [S: wwdc24]
