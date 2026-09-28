# Taste profile

Global file: `~/.motion-studio/taste.json`. Create it with the empty shape below if absent. Preserve existing entries and `version: 1`. Use ISO dates in `date` (for example `2026-09-28`); keep a short note identifying the film and the decision. Each liked or rejected entry has `kind: look|move|pacing`. Each free-text gate note belongs in `notes` with exact named vocabulary term ids in `terms`.

```json
{
  "version": 1,
  "liked": [{ "kind": "look", "value": "keynote-minimal", "note": "film slug: G1 chosen", "date": "2026-09-28" }],
  "rejected": [{ "kind": "look", "value": "swiss-grid", "note": "film slug: G1 shown and passed", "date": "2026-09-28" }],
  "notes": [{ "text": "Make the type reveal more direct", "terms": ["mask-line-reveal"], "date": "2026-09-28" }]
}
```

An empty profile uses empty arrays, not the examples. Recommend from the **current global file in the brief phase**, with notes and rejected entries as context. Never turn an unshown candidate into a rejection. At G1, add the chosen look to `liked` and only shown-and-passed candidates to `rejected`. At **every** gate note, append the note and exact terms it names. At **final acceptance**, add the accepted look, named signature moves and pacing profile to `liked` using the relevant kinds. Record observed preferences only; do not invent pacing when acceptance gives no pacing evidence. Preserve both conflicting historical entries with their dates and notes; explain the conflict when recommending.

After the G1 write, copy the whole file to `films/<slug>/taste-snapshot.json` and set `storyboard.json` `look.tasteSnapshot` to `taste-snapshot.json`. The snapshot is a frozen project input. Later global writes never replace it automatically. Write valid JSON atomically (temporary file in the same directory, then rename); read it back and check the fields before continuing. A standalone profile update changes the global file only unless the user names a film project.
