# motion-studio skill evals

Artifact checks for SPEC seam 2. [check.mjs](check.mjs) runs them; it needs Node and no install.

- `node check.mjs brief <BRIEF.md>`: a complete brief within 3 intake rounds. Every XML section is filled, with no template token left from [agents/brief.md](../agents/brief.md) (an angle-bracket token such as `<who>`, `TODO`, `TBD`, or a section that still holds the template text); `Source URL:` is a URL with its retrieval date or `none`; `Intake rounds:` is 1 to 3; `Sources:` and `Track:` or `Voice:` are set; the logline is one sentence with no "and"; `Genre:` is a playbook genre; 2 or 3 `Direction <n>:` lines each name an idea device, a world and camera, and a look; `Formats:` names a primary format; `Duration:` is set.
- `node check.mjs playbooks`: the five genre playbooks as data. Each has front matter (`genre`, `status`, `duration-seconds`, `fps`, `primary-format`, `extra-formats`, `audio`) that matches its heading, all six XML sections, and no sentence that offers a hold as an alternative to a motion event (D67). The hold rule is a heuristic: it matches a motion word and a hold word joined by `or`, `instead of`, `rather than` or `in place of`, and skips a "living hold". Back it with a manual read of every hold sentence. Exactly three are `untested`.
- `node check.mjs playbook <file.md>`: one playbook's own rules; the file name is its genre id.
- [fixtures/](fixtures/): `briefs/ok.md` passes; each other brief and playbook breaks one rule. `cli/test/brief-check.test.ts` runs the checker on the shipped playbooks and on every fixture.

## Brief eval

Run each case in [cases.json](cases.json) this way:

1. Make a scratch folder outside the repository and a scratch `HOME` (the taste profile must stay untouched). Run `motion-studio init <case id>` there.
2. Dispatch a fresh subagent with only the `motion-studio` skill path, the case `request`, the case `url` and the film path. Act as the user: answer each round with the case's next `answers` entry, word for word. Answer `use defaults` when the entries run out.
3. From the scratch folder, run `node <this skill>/evals/check.mjs brief films/<case id>/BRIEF.md`. The case passes when it prints `brief ok` and the agent asked at most 3 rounds.
4. Record the run in [runs.md](runs.md): date, model and harness, case, rounds asked, check result, and independence. A run is `independent` only when a fresh subagent that did not write these skill files produced the brief. A run by the skill's author, or inline in the same session, is `non-independent`.

Skill runs vary. Repeat each case 3 times before claiming it passes; say how many runs a claim rests on.
