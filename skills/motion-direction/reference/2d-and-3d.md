# 2D and 3D

## When 3D

- A shot uses 3D only when the look allows it and the board declares it on that shot with `"threeD": {"reason": ...}`, a reason tied to the idea or the world. [D: D65]
- 3D serves the world: a product reveal, a camera flight through a space, depth the idea needs. It is not a default finish. [D: D65; I]
- The board sets the ambition; pick 3D only where the engines render it cheaply and deterministically. [S: gunner; D: D66]

## Mixing 2D and 3D

- Flatten 3D toward the 2D look (flat light, a limited palette, orthographic or long-lens framing) so 3D shots match the 2D cuts around them. [S: flavien]
- Match shapes, movement or sound at a 2D to 3D seam, as at any seam. [S: flavien]
- One camera logic runs through both: if the 2D world pans left to right, the 3D camera travels the same way. [I]

## Where the API detail lives

This skill holds no engine API text. Builders read the allow-listed engine files named in the `motion-studio` engine contracts (`engines/remotion.md`, `engines/hyperframes.md`, section "API depth allow-list"):

- Remotion 3D: `remotion-markup/3d.md`, with `three`, `@react-three/fiber` and `@remotion/three` pinned in the CLI. [D: D65, D71]
- HyperFrames 3D: `hyperframes-animation/adapters/three.md`; three.js loads from the `vendor/` files the CLI copies, never a CDN. [D: D71]
- Camera journeys and velocity-matched transitions: `hyperframes-animation/blueprints-index.md` (then the one blueprint the board names) and `hyperframes-animation/techniques.md`. [D: D58]
- Remotion transitions and effects: `remotion-markup/transitions.md`, `remotion-markup/effects.md`. [D: D58]

Every frame is a pure function of time: no wall clock, no frame loop, no unseeded randomness. `validate` rejects them, and `motion-studio repro` checks every 3D shot by rendering it twice. [D: D66]
