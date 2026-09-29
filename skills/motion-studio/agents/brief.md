# Intake brief phase

Inputs: user request, film root, optional brand or product URL, reference paths, `motion-studio taste show` output. Output: `BRIEF.md` (the `motion-studio init` skeleton, filled) and `storyboard.json` `meta` (title, logline, genre, formats, fps, duration). Load `motion-direction` `reference/idea-and-structure.md` for the idea line. Directions come later, after the hero assets (see the G1 packets in the `motion-studio` skill); this phase only names their starting ideas.

1. **URL first.** Read the brand's site before any question: product name, verifiable claims, palette, type, logo, UI and site art. Record the URL and retrieval date. Mark each fact as observed (with its page) or unknown. Ask only what the site does not answer. Without a URL, write `Source URL: none` and ask for the brand's material in round 1. Completion: sourced observations and unknowns are listed.
2. **Pick the genre playbook.** Choose one file in [playbooks](../playbooks/) whose `genre` matches the request. Its front matter holds the defaults (`duration-seconds`, `fps`, `primary-format`, `extra-formats`, `audio`); its `<inputs>` holds the genre questions. A playbook marked `status: untested` has not made a film yet: tell the user so. Completion: the genre id is set.
3. **Interview in at most 3 rounds.** Ask only questions that change the film: audience, one message or claim, action, duration, track or voice, references, formats, budget and limits. Group them in one message per round. Give one recommended answer per question: from the site, else the taste profile, else the playbook default. `use defaults` applies every recommended answer at once. After round 3, apply the recommendation to every open question. Completion: every question has the user's answer or a recorded default, within 3 rounds.
4. **Write `BRIEF.md`.** Fill each XML section with short, specific sentences and the field lines below. The logline is the idea line: one sentence, no "and". Mark each playbook default `(default)`. Store each factual claim with its evidence. Name 2-3 direction seeds, each with an idea device, a world and camera logic, and a look taken from the brand (the `motion-look` library only as fallback); the directions packet completes them against the real hero assets. Completion: `node <this skill>/evals/check.mjs brief films/<slug>/BRIEF.md` prints `brief ok`, and `storyboard.json` `meta` matches the brief.

```xml
<inputs>
Source URL: <url> (retrieved YYYY-MM-DD) | none
Intake rounds: <1-3>; defaults: <fields or none>
Sources: <brand material seen on the site, user files, rights status>
Track: <ledger id or need> | Voice: <source>; script: <path or text>
Claims: <each claim with its page>
</inputs>
<direction>
Logline: <one sentence, no "and">
Genre: <playbook genre id>
Audience: <who>
Direction 1: <name>; idea device: <one sentence>; world and camera: <world, camera logic>; look: <brand palette, type, motif; or a motion-look id>
Direction 2: ...
References: <paths or URLs with take and do-not-take, or none>
</direction>
<structure>
Duration: <seconds> at <fps> fps
Formats: primary <16:9|9:16|1:1>; extra <formats or none>
Arc: <beats and their anchors, spoken words>
</structure>
<build>Engine limits, layout, deliverables and budget.</build>
<gotchas>Claim risks, rights gaps, format risks and deliberate limits.</gotchas>
<start>First hero assets to source, look tests to build and the G1 decision to request.</start>
```

The XML section pattern is adapted from @twoclipping's published prompt structure as a pattern only; no sample prompt text is copied.
