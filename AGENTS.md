# AGENTS.md

motion-studio: agent skills (`skills/`) plus a TypeScript CLI (`cli/`) that plans, gates, renders and checks motion-design films with Remotion and HyperFrames.

## Project map

- `docs/SPEC.md`, `docs/SPEC-motion.md`: source of truth. `docs/DECISIONS.md`: numbered decisions (D0 onward). `CONTEXT.md`: glossary.
- `cli/src/`: CLI modules; `cli/schema/`: storyboard, ledger and gate-input schemas; `cli/fixtures/`: test films.
- `skills/`: the installed skills (motion-studio, motion-look, motion-vocabulary, motion-critique).

## Commands (run in `cli/`)

| Command | What it does |
| --- | --- |
| `npm run typecheck` | Type check only. |
| `npm test` | Builds, packs and runs the full suite under Node, then Bun (about 10 min). Run with a private `TMPDIR`. |
| `npm run test:node` / `npm run test:bun` | One runtime; needs `npm run test:prepare` first. |
| `npm run check:allowlist` | Checks allow-listed skill paths exist. Run after reinstalling skills. |
| `cd /tmp && npx -y skills add FasalZein/motion-studio -g -a '*' -y </dev/null` | Reinstalls the skills globally from GitHub. Run after a pushed change under `skills/`. |

## Traps

- This Mac has no `timeout`. Wrap long commands: `perl -e 'alarm shift; exec @ARGV' <seconds> <cmd>`.
- Add `</dev/null` to every `heygen`, `hyperframes` and media-use call; they can block on stdin for an hour.
- npm has `ignore-scripts=true`: `npm pack` alone does not build `dist/`, and the build reads `../skills`, so the package builds only inside the repo. Run `npm ci` after a lockfile change.
- Never write `~/.motion-studio/taste.json`; tests and runs use a scratch `HOME`. Taste writes go only through `cli/src/taste.ts`.
- Keep `enableCaching:false` on Remotion `bundle()` (`cli/src/engines.ts`); the webpack cache grew about 160 MB per film folder.
- Delete temp folders with `trash <path>`, not `rm -rf`.
- Paid HeyGen generation needs `--paid-ok` and the user's consent. Never print the HeyGen credential.
- When building a multi-shot storyboard in a test or fixture: every shot after the first needs `shots[].thread` (D70). Write `storyboard.json` only through `writeStoryboard` in `cli/src/project.ts`.
- If only a render test fails with a port or connection error under load, rerun that file once before treating it as a failure.
