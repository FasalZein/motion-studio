# motion-studio skill evals

Artifact checks for SPEC seam 2. [check.mjs](check.mjs) runs them; it needs Node and no install.

- `node check.mjs brief <BRIEF.md>`: a complete brief within 3 intake rounds. Every XML section is filled; `Source URL:` is a URL with its retrieval date or `none`; `Intake rounds:` is at most 3; `Sources:` and `Track:` or `Voice:` are set; the logline is one sentence with no "and"; `Genre:` is a playbook genre; 2 or 3 `Direction <n>:` lines each name an idea device, a world and camera, and a look; `Formats:` names a primary format; `Duration:` is set.
- `node check.mjs playbooks`: the five genre playbooks as data. Each has front matter (`genre`, `status`, `duration-seconds`, `fps`, `primary-format`, `extra-formats`, `audio`) that matches its heading, all six XML sections, and no line that offers a hold as an alternative to a motion event (D67). Exactly three are `untested`.

## Brief eval

Run each case in [cases.json](cases.json) this way:

1. Make a scratch folder outside the repository and a scratch `HOME` (the taste profile must stay untouched). Run `motion-studio init <case id>` there.
2. Dispatch a fresh subagent with only the `motion-studio` skill path, the case `request`, the case `url` and the film path. Act as the user: answer each round with the case's next `answers` entry, word for word. Answer `use defaults` when the entries run out.
3. Run `node check.mjs brief films/<case id>/BRIEF.md`. The case passes when it prints `brief ok` and the agent asked at most 3 rounds.
4. Record the run in [runs.md](runs.md): date, model and harness, case, rounds asked, check result, and independence. A run is `independent` only when a fresh subagent that did not write these skill files produced the brief. A run by the skill's author, or inline in the same session, is `non-independent`.

Skill runs vary. Repeat each case 3 times before claiming it passes; say how many runs a claim rests on.
