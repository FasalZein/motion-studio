import type {Gate, GateId, GateState} from './project.js';

/** Note rounds allowed per gate before the user must accept, rescope or stop. */
const noteRounds = 3;
// Work that produces each gate, from the flow table in docs/SPEC.md.
const gateWork:Record<GateId,string> = {
  G1:'brief, hero assets and look test',
  G2:'board: beat map, keyframe builds and stills',
  G3:'animatic with the entry and exit frame of each shot',
  G4:'fill assets, full build and critique loop A',
  G5:'polish, mix, draft renders per format, critique loop B and license check',
};

export function nextStep(gates:Gate[]):string {
  const gate = gates.find((g):g is Gate & {state:Exclude<GateState,'approved'>} => g.state !== 'approved');
  if (!gate) return 'final render, then user acceptance of the files';
  switch (gate.state) {
    case 'pending': return `${gateWork[gate.id]}, then present ${gate.id}`;
    case 'stale': return `${gate.id} is stale: rerun ${gateWork[gate.id]}, then present ${gate.id} again`;
    case 'changes': return gate.rounds >= noteRounds
      ? `${gate.id} used ${gate.rounds} of ${noteRounds} note rounds: ask the user to accept, rescope or stop`
      : `apply the ${gate.id} notes (round ${gate.rounds} of ${noteRounds}), then present ${gate.id} again`;
    default: {const unreachable:never = gate.state; return unreachable;}
  }
}

export function statusLines(gates:Gate[]):string[] {
  return [...gates.map(g => `${g.id} ${g.state}${g.rounds ? ` (rounds ${g.rounds}/${noteRounds})` : ''}`), `next: ${nextStep(gates)}`];
}
