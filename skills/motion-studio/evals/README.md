# motion-studio skill evals

Artifact checks for SPEC seam 2. [check.mjs](check.mjs) runs them; it needs Node and no install.

- `node check.mjs brief <BRIEF.md>`: a complete brief within 3 intake rounds. Every XML section is filled, with no template token left from [agents/brief.md](../agents/brief.md) (an angle-bracket token such as `<who>`, `TODO`, `TBD`, or a section that still holds the template text); `Source URL:` is a URL with its retrieval date or `none`; `Intake rounds:` is 1 to 3; `Sources:` and `Track:` or `Voice:` are set; the logline is one sentence with no "and"; `Genre:` is a playbook genre; 2 or 3 `Direction <n>:` lines each name an idea device, a world and camera, and a look; `Formats:` names a primary format; `Duration:` is set.
- `node check.mjs playbooks`: the five genre playbooks as data. Each has front matter (`genre`, `status`, `duration-seconds`, `fps`, `primary-format`, `extra-formats`, `audio`) that matches its heading, all six XML sections, and no sentence that offers a hold as an alternative to a motion event (D67). The hold rule is a heuristic: it matches a motion word and a hold word joined by `or`, `instead of`, `rather than` or `in place of`, and skips a "living hold". Back it with a manual read of every hold sentence. Exactly three are `untested`.
- `node check.mjs playbook <file.md>`: one playbook's own rules; the file name is its genre id.
- `node check.mjs board <film>`: the board is ready for G2. `beatmap.md` has a `Hero shot:` line naming a shot, a `## Sourced assets` table whose ids are in `ledger.json` (or a `No brand material:` line), a `## Beat contract` table with every beat-contract column filled and beats that cover the film in order inside their shots, and a `## Engines` table whose engine and 3D cells match `storyboard.json`. In `storyboard.json`, the shots cover the film, every seam has a thread (a `motion-vocabulary` thread kind or `custom:<description>`, and `shared` text), every `threeD` has a reason, and `stillFrames` hold the start and end pose of each beat. Every requested still `stills/G2/<format>/<shot-id>-f<NNN>.png` (zero-padded) and each `sheet.png` exist.
- `node check.mjs g2 <film>`: G1 and G2 are approved within 3 note rounds, the G2 approval holds every requested still, and every recorded G1 and G2 input hash matches again: freeze inputs against their frozen copies in `stills/approved/<gate>-<hash8>/`, storyboard inputs against `storyboard.json`, other files live.
- `node check.mjs g3 <film>`: as `g2`, plus G3 is approved with the frozen animatic `stills/approved/G3-<hash8>/animatic.mp4`.
- [fixtures/](fixtures/): `board/beatmap.md` is a complete beat map for the CLI's two-engine test film; `cli/test/board-check.test.ts` builds that film, records its gates with the CLI and breaks one rule per case. `briefs/ok.md` passes; each other brief and playbook breaks one rule. `cli/test/brief-check.test.ts` runs the checker on the shipped playbooks and on every fixture.

## Brief eval

Run each case in [cases.json](cases.json) this way:

1. Make a scratch folder outside the repository and a scratch `HOME` (the taste profile must stay untouched). Run `motion-studio init <case id>` there.
2. Dispatch a fresh subagent with only the `motion-studio` skill path, the case `request`, the case `url` and the film path. Act as the user: answer each round with the case's next `answers` entry, word for word. Answer `use defaults` when the entries run out.
3. From the scratch folder, run `node <this skill>/evals/check.mjs brief films/<case id>/BRIEF.md`. The case passes when it prints `brief ok` and the agent asked at most 3 rounds.
4. Record the run in [runs.md](runs.md): date, model and harness, case, rounds asked, check result, and independence. A run is `independent` only when a fresh subagent that did not write these skill files produced the brief. A run by the skill's author, or inline in the same session, is `non-independent`.

Skill runs vary. Repeat each case 3 times before claiming it passes; say how many runs a claim rests on.

## Board eval (G2 and G3)

Run a case that has passed the brief eval through G3 with a fresh subagent, in the same scratch folder and scratch `HOME`. Act as the user: approve each gate, or give one note at G2 and one at G3 to exercise note handling. Then run `motion-studio validate films/<case id>` and `node <this skill>/evals/check.mjs g3 films/<case id>`. The case passes when both exit 0 and each note re-ran only the beats or shots it named. Record the run in [runs.md](runs.md) with the same columns and independence rule.
