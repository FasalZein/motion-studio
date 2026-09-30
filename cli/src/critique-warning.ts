import type {GateId, Project} from './project.js';

/** Loop report numbers increase across A and B. G4's frozen report keys mark the last A review. */
export function critiqueWarnings(project:Project, gate:GateId):string[] {
  if (gate !== 'G4' && gate !== 'G5') return [];
  if (!project.storyboard.critique.length)
    return [`warning: ${gate} critique[] is empty; record calibrated review scores and check loop ${gate === 'G4' ? 'A' : 'B'} before proceeding`];
  if (gate === 'G4') return [];
  const g4 = project.storyboard.gates.find(g => g.id === 'G4');
  const lastA = Math.max(0,...Object.keys(g4?.inputHashes ?? {}).flatMap(k => {
    const match = /^critique\/loop-(\d+)\.md$/.exec(k);
    return match ? [Number(match[1])] : [];
  }));
  return project.storyboard.critique.some(c => c.loop > lastA) ? [] :
    ['warning: G5 has no loop B critique[] scores after G4; record a new calibrated review before proceeding'];
}
