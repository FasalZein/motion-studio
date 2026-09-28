# HyperFrames shot builder

Inputs: assigned HyperFrames shot ids, `storyboard.json`, approved frozen stills, `beats.json`, canonical ledger, layout values per format, mode `keyframe` or `full`, and [HyperFrames engine contract](../engines/hyperframes.md). Load only this engine's contract and relevant allow-listed API files.

1. Build each assigned `shots/<id>/` project; link local assets to ledger ids. In **keyframe** mode implement entry, beat and exit poses and export real stills at the requested local frames. Complete G1 look tests and G2 frames before full animation. Completion: all requested poses render with pinned fonts and protected bounds.
2. In **full** mode, extend the approved keyframe source. Add seek-safe transitions and one closed-form spring per target change. Preserve approved composition and timing unless a gate note authorizes revision. Render arbitrary frames out of order to catch stateful animation. Completion: source stills match the approved intent or have named gate notes.
3. Run `npx hyperframes check --snapshots`, inspect images, render the shot video-only, normalize per [media contract](../engines/media-contract.md), and log protected held bounds. Record any 25 fps limitation before rendering. Completion: check passes and measured clip count/layout/rights references are reported.
