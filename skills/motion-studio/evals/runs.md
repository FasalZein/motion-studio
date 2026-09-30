# Eval runs

| Date | Model and harness | Case | Rounds asked | `check.mjs brief` | Independence |
|---|---|---|---|---|---|
| 2026-09-30 | Claude (pi worker, ticket #43), inline | raycast-launch | 2 | brief ok | non-independent: the skill author ran it in the authoring session |
| 2026-09-30 | Claude (pi worker, ticket #43), inline | tide-explainer | 1 | brief ok | non-independent: the skill author ran it in the authoring session |

These two runs show the check and the flow work end to end. They are not a pass: the eval needs 3 independent runs per case.

## G4-G5 delivery routing, 2026-09-30

Fixture: `delivery-routing.json`. Each fresh read-only session received only the router path and each case's id, state and request. Expected packet paths and requirements were withheld. Tool traces confirm reads of `SKILL.md`, `reference/g4.md` and `reference/g5.md` in every session. No film was built.

| Model and harness | Repeats | Cases per repeat | Exact packet routes | G5 approval stop | Independence |
|---|---|---|---|---|---|
| OpenAI Codex gpt-5.5, pi | 3 | 5 | 15/15 pass | explicit in all 3 G5-drafts answers | fresh context; author-launched routing check, not independent film critique |
| Claude Sonnet, Claude Code | 3 | 5 | 15/15 pass | explicit in all 3 G5-drafts answers | fresh context; author-launched routing check, not independent film critique |

Packet routes were stable across these repeats. Semantic compliance was not fully stable: two pi no-subagent answers suggested an invalid combined two-waiver command despite requesting separate reasons; one Claude budget answer omitted the technical-pass quality disclaimer; some answers did not explicitly repeat the current-packet requirement. Do not call these a full semantic pass.

Reproduction: `/Users/tothemoon/.pi/artifacts/worker/t45-routing-eval.py pi` and the same script with `claude`. Raw outputs, prompt, observed reads, route comparisons and the complete semantic audit: `/Users/tothemoon/.pi/artifacts/worker/t45-routing-rerun/audit.md`. The artifact directory holds six session traces and all 30 case answers. These checks verify routing and decision instructions only, not rendered-film quality.
