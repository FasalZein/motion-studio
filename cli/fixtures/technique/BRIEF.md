# Brief

<inputs>
Test fixture. No product URL (none). No track or voice. No ledger assets.
</inputs>

<direction>
Logline: Pinned local 3D, GSAP plugins and seeded noise in both engines.
</direction>

<structure>
Shot hf3d (HyperFrames): frames [0, 6). Shot r3d (Remotion): frames [6, 12). Shot rnoise (Remotion): frames [12, 18). Cuts at frames 6 and 12.
</structure>

<build>
hf3d and r3d declare 3D. hf3d loads GSAP, SplitText, Flip and three from vendor/, which the CLI provides in the staged shot.
</build>

<gotchas>
Text uses the system sans-serif font, so frames match only on one machine.
</gotchas>

<start>
Run `motion-studio render` on this folder, then `motion-studio repro` on hf3d and r3d.
</start>
