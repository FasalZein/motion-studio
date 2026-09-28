# Taste profile

Global file: `~/.motion-studio/taste.json` (under `$HOME`). The `motion-studio taste` commands are the only writers. Each write goes through a temporary file in the same folder and a rename, is read back and must match `cli/schema/taste.schema.json`. An absent file is the empty profile; an invalid file stops the command and is never overwritten.

```json
{
  "version": 1,
  "liked": [{ "kind": "look", "value": "keynote-minimal", "note": "raycast-launch: G1 chosen: \"the flood makes the action obvious\"", "date": "2026-09-28" }],
  "rejected": [{ "kind": "look", "value": "swiss-grid", "note": "raycast-launch: G1 passed: \"the grid feels cold for this product\"", "date": "2026-09-28" }],
  "notes": [{ "text": "make the mask-line-reveal more direct", "terms": ["mask-line-reveal"], "date": "2026-09-28", "film": "raycast-launch", "gate": "G2" }]
}
```

`kind` is `look`, `move` or `pacing`. `date` is the UTC day of the write. A `note` names the film slug and gate, then quotes every note of that gate record in order, joined by ` / `. The director's words come from `motion-studio gate ... --note`; a gate without notes gives a later recommendation nothing to weigh, so `taste g1` refuses it. A notes entry names its `film` and `gate` when a command wrote it.

## Reads

In the brief phase, run `motion-studio taste show`; it prints the profile JSON. Recommend from liked entries with relevant notes, and use rejected entries and notes as context. The profile keeps conflicting entries with their dates and notes; explain the conflict when recommending. Never turn an unshown candidate into a rejection.

## Writes

| When | Command | Writes |
|---|---|---|
| G1 approved | `taste g1 <film-dir> [--rejected <look-id>]... [--kept <look-id>:<pattern>]...` | `look.id` to `liked`; each `--rejected` look to `rejected`; each `--kept` look to `notes` (its still kept the named template pattern, so the director passed on the execution, not the look); then the snapshot |
| Any gate note | `taste notes <film-dir> <G1-G5>` | each note of the gate record that the profile does not hold yet, with `terms` |
| G5 approved | `taste accept <film-dir> [--move <term-id>]... [--pacing <text>]` | `look.id`, each move and the pacing to `liked` |

`taste g1` and `taste accept` need their gate approved and not stale, and `storyboard.json` `look.id` set. `--move` takes a `motion-vocabulary` term id or `custom:<description>`. Record pacing only when acceptance gives pacing evidence. A rerun adds nothing: an entry with the same kind, value and note is kept once, and `taste notes` adds only notes past the count already held for that film and gate. `terms` lists every vocabulary term id the text contains as a whole word, so write a move by its exact id in a gate note. A common word that is also a term id, such as `hold` or `drop`, is tagged too.

## Snapshot

`taste g1` copies the whole profile, after its own write, byte for byte to `films/<slug>/taste-snapshot.json` and sets `storyboard.json` `look.tasteSnapshot` to `taste-snapshot.json`. The snapshot is written after the G1 decision, so G1 hashes the look record without `tasteSnapshot`. Later global writes never replace it; only another `taste g1` run on the film does.

## Without the CLI or a film

For a standalone update with no film project, or without the CLI, edit the JSON by hand with the same shape and rules: create the empty shape `{"version":1,"liked":[],"rejected":[],"notes":[]}` if absent, write through a temporary file and a rename, then check it with `jq -e .`. In a film without the CLI, copy the file to the snapshot after the G1 write. A standalone update changes the global file only.
