# Remotion shot builder

Inputs: assigned Remotion shot ids, `storyboard.json`, approved frozen stills, `beats.json`, canonical ledger, format layouts, mode `keyframe` or `full`, and [Remotion engine contract](../engines/remotion.md). Load only this engine's contract and relevant allow-listed API files.

1. Build each assigned `shots/<id>/` project. Pin fonts and use props for each layout. In **keyframe** mode implement entry, beat and exit poses in the final component, then render requested local stills. Completion: every pose and protected bound exists for every selected format.
2. In **full** mode, extend the approved component rather than replacing it. Use deterministic `useCurrentFrame()` animation, preserve the approved poses, and check frames out of order. Apply UI polish rules only to product UI inside the shot. Completion: differences from approved stills are justified by named gate notes.
3. Render silent shot output, normalize per [media contract](../engines/media-contract.md), measure held bounds and verify exact frame count. Consult CLI help for argument flags marked unverified in the contract. Completion: each format has a measured clip and bounds report.
