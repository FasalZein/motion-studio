# Taste profile

Global file: `~/.motion-studio/taste.json`. Create it with the empty shape below if absent. Preserve existing entries and `version: 1`. Use ISO dates in `date` (for example `2026-09-28`); the `note` names the film slug and gate, then quotes the director's decision text from `storyboard.json` `gates[].decision`, including any stated reason (for example `raycast-launch: G1 passed: "thin serif competes with the UI"`). A note without the director's words cannot steer a later recommendation. Each liked or rejected entry has `kind: look|move|pacing`. Each free-text gate note belongs in `notes` with exact named vocabulary term ids in `terms`.

```json
{
  "version": 1,
  "liked": [{ "kind": "look", "value": "keynote-minimal", "note": "film slug: G1 chosen: \"the flood makes the action obvious\"", "date": "2026-09-28" }],
  "rejected": [{ "kind": "look", "value": "swiss-grid", "note": "film slug: G1 passed: \"the grid feels cold for this product\"", "date": "2026-09-28" }],
  "notes": [{ "text": "Make the type reveal more direct", "terms": ["mask-line-reveal"], "date": "2026-09-28" }]
}
```

An empty profile uses empty arrays, not the examples. Recommend from the **current global file in the brief phase**, with notes and rejected entries as context. Never turn an unshown candidate into a rejection. At G1, add the chosen look to `liked`. Add a shown-and-passed candidate to `rejected` only when its still honored its applied pattern replacements. When the still kept a template pattern without a stated reason, add a `notes` entry that quotes the decision and names the pattern instead; a bad execution is not evidence against the look. At **every** gate note, append the note and exact terms it names. At **final acceptance**, add the accepted look, named signature moves and pacing profile to `liked` using the relevant kinds. Record observed preferences only; do not invent pacing when acceptance gives no pacing evidence. Preserve both conflicting historical entries with their dates and notes; explain the conflict when recommending.

After the G1 write, copy the whole file to `films/<slug>/taste-snapshot.json` and set `storyboard.json` `look.tasteSnapshot` to `taste-snapshot.json`. The snapshot is a frozen project input. Later global writes never replace it automatically. Write valid JSON atomically (temporary file in the same directory, then rename); read it back and check the fields before continuing. A standalone profile update changes the global file only unless the user names a film project.
