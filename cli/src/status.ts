import type {Gate, GateId, GateState} from './project.js';
import {noteRounds, type GateView} from './gates.js';

// Work that produces each gate, from the flow table in docs/SPEC.md.
const gateWork:Record<GateId,string> = {
  G1:'brief, hero assets and look test',
  G2:'board: beat map, keyframe builds and stills',
  G3:'blocking builds, render and stitch of the primary format, and the moving animatic',
  G4:'fill assets, full build, polish (D81), liveness and a fresh reviewer\'s critique loop A',
  G5:'mix, draft renders per format, critique loop B and license check',
};

export function nextStep(views:GateView[]):string {
  const view = views.find((v):v is GateView & {state:Exclude<GateState,'approved'>} => v.state !== 'approved');
  if (!view) return 'final render, then user acceptance of the files';
  const gate:Gate = view.gate;
  switch (view.state) {
    case 'pending': return `${gateWork[gate.id]}, then present ${gate.id}`;
    case 'stale': return `${gate.id} is stale: rerun ${gateWork[gate.id]}, then present ${gate.id} again`;
    case 'changes': return gate.rounds >= noteRounds
      ? `${gate.id} used ${gate.rounds} of ${noteRounds} note rounds: ask the user to accept, rescope or stop`
      : `apply the ${gate.id} notes (round ${gate.rounds} of ${noteRounds}), then present ${gate.id} again`;
    default: {const unreachable:never = view.state; return unreachable;}
  }
}

/** One line per gate with its effective state, note rounds and stale reason, then the next step. */
export function statusLines(views:GateView[]):string[] {
  return [...views.map(({gate:g,state,reason}) => `${g.id} ${state}${g.rounds ? ` (rounds ${g.rounds}/${noteRounds})` : ''}${reason ? ` (${reason})` : ''}`), `next: ${nextStep(views)}`];
}
