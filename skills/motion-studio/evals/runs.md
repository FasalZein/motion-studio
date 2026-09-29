# Eval runs

| Date | Model and harness | Case | Rounds asked | `check.mjs brief` | Independence |
|---|---|---|---|---|---|
| 2026-09-30 | Claude (pi worker, ticket #43), inline | raycast-launch | 2 | brief ok | non-independent: the skill author ran it in the authoring session |
| 2026-09-30 | Claude (pi worker, ticket #43), inline | tide-explainer | 1 | brief ok | non-independent: the skill author ran it in the authoring session |

These two runs show the check and the flow work end to end. They are not a pass: the eval needs 3 independent runs per case.
