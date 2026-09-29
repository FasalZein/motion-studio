# Beat map: two-engine seam

Hero shot: `remotion`

## Sourced assets

| Ledger id | Role | Source URL | Capture date |
|---|---|---|---|
| `font-plex` | type | https://github.com/IBM/plex | 2026-09-28 |
| `music-bed` | track | audio/generate.sh | 2026-09-28 |

## Beat contract

| Beat | Shot | Frames | Idea line | Motion event | Camera | Thread | In-between plan | Sound cue | Live content | Spoken line |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `remotion` | 0-6 (0.0-0.2 s) | one frame clock counts | the counter ticks up over the patch, easing out | `drift`, left to right | (first beat) | the patch keeps sliding right into the cut | beat 3 | counter digits roll | none |
| 2 | `hyperframes` | 6-12 (0.2-0.4 s) | the second engine picks the count up | the HYPERFRAMES label slides in from the left on a spring | `drift`, left to right | `shared-element-thread`: the shared color patch | the label settles as the patch drifts on | cut on beat 6, SFX hit | the patch drifts under the label | none |

## Engines

| Shot | Engine | Reason | UI source | 3D |
|---|---|---|---|---|
| `remotion` | remotion | a component counter driven by the frame number | none | no |
| `hyperframes` | hyperframes | kinetic type over an HTML patch | none | no |
