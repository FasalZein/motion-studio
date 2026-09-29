# Intake brief phase

Inputs: user request, project root, optional product URL, available reference paths, taste recommendations from `motion-look`, and one genre playbook selected from [playbooks](../playbooks/). Output: `BRIEF.md` and draft `storyboard.json` meta/look/audio. Use the playbook for genre-specific questions and defaults. Load `motion-direction` `reference/idea-and-structure.md` and `reference/world-and-camera.md` for the idea line and the directions.

1. Read the product URL before asking questions. Record source URL and retrieval date, product name, verifiable claims, palette and logo provenance. Label missing or uncertain evidence; ask only what the page does not answer. Completion: sourced observations and unknowns are listed.
2. Interview in at most **3 rounds**. Group only questions that affect the direction: audience, one message/claim, action, duration, voice/music, reference, look, formats, budget and constraints. Give **one recommended answer per question**, using the taste profile when relevant, otherwise the playbook default. If the user says `use defaults`, apply recorded defaults to all unanswered choices immediately. Completion: each remaining question has a user answer or recorded default by round 3.
3. Write `BRIEF.md` with the XML sections below. Use short, specific sentences. Name the genre, the idea line as the logline (one sentence, no "and"), 2–3 candidate directions (each an idea device, a world and camera logic, and a look from `motion-look`), primary and extra formats (16:9, 9:16, 1:1), track ledger id **or** voice source/script, and source URL (`none` for a project without a product URL). Store factual claims with their evidence. Completion: **every XML section has an answer or explicitly marked playbook default**, and all named fields are set.

```xml
<inputs>Product, source URL, user assets, track or voice, sources and rights.</inputs>
<direction>Logline, audience, genre, look candidates, references and take/do-not-take.</direction>
<structure>Duration, format set, arc, beat anchors and spoken words.</structure>
<build>Engine constraints, layout, deliverables and budget.</build>
<gotchas>Claim risks, rights gaps, format risks and deliberate limitations.</gotchas>
<start>First hero assets, look tests and the G1 decision request.</start>
```

The XML section pattern is adapted from @twoclipping's published prompt structure as a pattern only; no sample prompt text is copied. Show the complete filled brief to the user at G1. (CLI: `motion-studio init/validate`, #4.)
