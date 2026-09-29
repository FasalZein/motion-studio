---
genre: product-launch
status: worked
duration-seconds: 15
fps: 30
primary-format: 16:9
extra-formats: 9:16, 1:1
audio: track
---

# Product launch | worked

<inputs>Ask: Which product URL, true core claim, audience and action? Which authentic UI state and logo? Default: source URL supplied by user, one claim proven by page, real UI captures and site art, one clear action. Ask for track or voice; default: licensed 120 BPM track with an explicit drop, if available.</inputs>
<direction>Default: 2–3 directions built around the brand's real material (D78): the look comes from the brand's palette, type, radius and one motif from its mark, with a `motion-look` file as fallback. Each direction has its own idea device, world and camera logic. Real captures are hero material: move them with camera, masks, depth, 3D tilt and cuts on action. Rebuild UI in code only where behavior needs it (typing, filtering), matched to the captures (`motion-direction` `reference/product-ui.md`). Reframe rather than crop every requested format.</direction>
<structure>Template for ~15 seconds at 30 fps: 0–2 s problem/hook; 2–6 s authentic input; 6–10 s result on a verified drop or downbeat; 10–13 s proof; 13–15 s claim plus action. Every beat has a motion event and a camera move. Give the core result a 0.5–1.5 s living hold (the camera drifts, the result streams in or light moves over it); size other living holds to actual reading time and keep them inside the liveness limits (`motion-direction` `reference/living-holds.md`).</structure>
<build>Prefer a morph within one engine. At an engine switch, carry a thread through the seam: a shared element, shape match or movement match, or a beat cut with motion on both sides when no shared pose exists. Record logo, UI captures, fonts and SFX rights in the ledger.</build>
<gotchas>Message truth needs authentic UI: real captures, or UI rebuilt to match them, with capture URL and date in the ledger, and a source for every displayed product claim. Grey placeholder UI is a defect. A stylized mock needs a clear label. Avoid inventing product capabilities from stock assets.</gotchas>
<start>Worked beat example: at 120 BPM, 30 fps. Frames 0–59: over the real captured window, a query types itself into the search field (rebuilt for the typing behavior, matched to the capture) while the camera pushes in from wide. Frames 60–119: results stream in under the field and the claim rises beside the top result while the camera drifts left to right; thread: the search field. Frames 120–179: the camera follows the top result as it expands into a sourced feature; thread: the result card. Frames 180–239: the camera pulls out to the whole world as the field condenses into the logo, with the claim and action; thread: the field's shape. Present the beat contract table (`motion-direction` `reference/beat-contract.md`) and the start and end still of each beat before full motion. This is an illustrative structure, not an approved claim.</start>
