import {readFile, stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {isAbsolute, join, relative, resolve} from 'node:path';
import {gateIds, parseProject, type Project, type Shot} from './project.js';
import {gateViews} from './gates.js';

export type Report = {errors:string[]; warnings:string[]};
/**
 * One project check. Each returns its own findings; `validateProject` concatenates them.
 * Later checks plug in here, for example vocabulary-term warnings (#12).
 */
type Check = (project:Project) => Promise<Report>|Report;

const formatRatio = {'16:9':[16,9], '9:16':[9,16], '1:1':[1,1]} as const;
const remotionEntryFiles = ['src/index.ts','src/index.tsx'];

async function isFile(path:string):Promise<boolean> {
  return stat(path).then(s => s.isFile(),() => false);
}
/** Resolves a path relative to the film root, or returns null when it escapes `dir`. */
function inside(root:string, path:string, dir = root):string|null {
  const full = resolve(root,path);
  const rel = relative(dir,full);
  return isAbsolute(path) || rel === '' || rel.startsWith('..') || isAbsolute(rel) ? null : full;
}
/** The Remotion project entry file of a shot: shots/<id>/src/index.ts or index.tsx. */
export async function remotionEntry(root:string, shot:Shot):Promise<string|null> {
  for (const file of remotionEntryFiles) {
    const path = join(root,'shots',shot.id,file);
    if (await isFile(path)) return path;
  }
  return null;
}
const errorsOnly = (errors:string[]):Report => ({errors, warnings:[]});
const duplicates = (values:string[]) => [...new Set(values.filter((v,i) => values.indexOf(v) !== i))];

const checkMeta:Check = ({storyboard:{meta}}) => {
  const [w,h] = formatRatio[meta.formats.primary];
  return errorsOnly(meta.canvas.width * h === meta.canvas.height * w ? [] :
    [`meta.canvas ${meta.canvas.width}x${meta.canvas.height} does not match primary format ${meta.formats.primary}`]);
};

const checkGates:Check = ({storyboard:{gates}}) => {
  const ids = gates.map(g => g.id);
  return errorsOnly(ids.join() === gateIds.join() ? [] : [`gates must be ${gateIds.join(', ')} in order; found ${ids.join(', ') || 'none'}`]);
};

const checkTimeline:Check = ({storyboard:{shots,meta,audio}}) => {
  const errors:string[] = [];
  for (const id of duplicates(shots.map(s => s.id))) errors.push(`shot id ${id} is used more than once`);
  let previous:Shot|undefined;
  for (const shot of shots) {
    if (shot.endFrame <= shot.startFrame) errors.push(`shot ${shot.id}: endFrame ${shot.endFrame} must be greater than startFrame ${shot.startFrame} (ranges are half-open [start, end))`);
    const expected = previous?.endFrame ?? 0;
    const after = previous ? `shot ${previous.id} ends at frame ${expected}` : 'the timeline starts at frame 0';
    if (shot.startFrame > expected) errors.push(`gap: ${after} but shot ${shot.id} starts at frame ${shot.startFrame}; frames [${expected}, ${shot.startFrame}) have no shot`);
    if (shot.startFrame < expected) errors.push(`overlap: ${after} but shot ${shot.id} starts at frame ${shot.startFrame}; frames [${shot.startFrame}, ${expected}) are covered twice`);
    for (const frame of shot.stillFrames) if (frame >= shot.endFrame - shot.startFrame) errors.push(`shot ${shot.id}: still frame ${frame} is outside the shot (still frames are shot-local, 0 to ${shot.endFrame - shot.startFrame - 1})`);
    previous = shot;
  }
  const end = previous?.endFrame ?? 0;
  if (end !== meta.durationFrames) errors.push(`shots cover [0, ${end}) but meta.durationFrames is ${meta.durationFrames}`);
  // D41: a beat grid, when present, is where cuts land. Handoff seams, the film start and end, and cuts
  // declared with an offBeatCut reason are exempt.
  const beats = new Set(audio.beatFrames);
  if (beats.size) {
    for (const shot of shots.slice(1)) {
      if (shot.entry !== 'cut' || shot.offBeatCut !== undefined || beats.has(shot.startFrame)) continue;
      const nearest = audio.beatFrames.reduce((best,b) => Math.abs(b - shot.startFrame) < Math.abs(best - shot.startFrame) ? b : best);
      errors.push(`off-grid: the cut into shot ${shot.id} at frame ${shot.startFrame} is not a beat frame (nearest beat: frame ${nearest}); move it to a beat or declare "offBeatCut" with a reason`);
    }
  }
  return errorsOnly(errors);
};

// A handoff joins two adjoining shots, so both sides of a seam must declare it.
const checkHandoffs:Check = ({storyboard:{shots}}) => {
  const errors:string[] = [];
  if (shots[0]?.entry === 'handoff') errors.push(`shot ${shots[0].id}: entry is handoff but no shot comes before it`);
  if (shots.at(-1)?.exit === 'handoff') errors.push(`shot ${shots.at(-1)!.id}: exit is handoff but no shot comes after it`);
  for (const [i,shot] of shots.slice(1).entries()) {
    const previous = shots[i];
    if (previous.exit !== shot.entry) errors.push(`seam ${previous.id} -> ${shot.id}: exit is ${previous.exit} but entry is ${shot.entry}; both sides must be cut or both handoff`);
    if (shot.entry === 'handoff' && shot.offBeatCut !== undefined) errors.push(`shot ${shot.id}: offBeatCut applies to cuts only, but entry is handoff`);
  }
  return errorsOnly(errors);
};

// Sound cue frames are film frames; a cue belongs to the shot whose range contains its event.
const checkSoundCues:Check = ({storyboard:{shots}}) => errorsOnly(shots.flatMap(shot => shot.soundCues
  .filter(cue => cue.eventFrame < shot.startFrame || cue.eventFrame >= shot.endFrame)
  .map(cue => `shot ${shot.id}: sound cue ${cue.asset} eventFrame ${cue.eventFrame} is outside the shot [${shot.startFrame}, ${shot.endFrame}) (event frames are film frames)`)));

const checkEntrypoints:Check = async ({root,storyboard}) => {
  const errors:string[] = [];
  for (const shot of storyboard.shots) {
    if (shot.engine === 'remotion') {
      if (!await remotionEntry(root,shot)) errors.push(`shot ${shot.id}: Remotion project entry not found (expected shots/${shot.id}/${remotionEntryFiles.join(' or ')} registering composition "${shot.entrypoint}")`);
    } else {
      const full = inside(root,shot.entrypoint,join(root,'shots',shot.id));
      if (!full) errors.push(`shot ${shot.id}: HyperFrames entrypoint ${shot.entrypoint} must be inside shots/${shot.id}/`);
      else if (!full.endsWith('.html')) errors.push(`shot ${shot.id}: HyperFrames entrypoint ${shot.entrypoint} must be an .html file`);
      else if (!await isFile(full)) errors.push(`shot ${shot.id}: HyperFrames entrypoint ${shot.entrypoint} not found`);
    }
  }
  return errorsOnly(errors);
};

const checkAssetIds:Check = ({storyboard,ledger}) => {
  const known = new Set(ledger.assets.map(a => a.id));
  const errors = duplicates(ledger.assets.map(a => a.id)).map(id => `ledger.json: asset id ${id} is used more than once`);
  const use = (id:string|null, where:string) => { if (id !== null && !known.has(id)) errors.push(`${where} uses asset ${id}, which is not in ledger.json`); };
  use(storyboard.audio.track,'audio.track');
  use(storyboard.voice?.tts ?? null,'voice.tts');
  for (const shot of storyboard.shots) {
    for (const id of shot.assets) use(id,`shot ${shot.id}`);
    for (const cue of shot.soundCues) use(cue.asset,`shot ${shot.id} sound cue`);
  }
  return errorsOnly(errors);
};

const checkLedgerFiles:Check = async ({root,ledger}) => {
  const errors:string[] = [];
  for (const asset of ledger.assets) {
    const full = inside(root,asset.localPath);
    if (!full) {errors.push(`ledger asset ${asset.id}: path ${asset.localPath} is outside the film folder`); continue;}
    if (!await isFile(full)) {errors.push(`ledger asset ${asset.id}: file ${asset.localPath} not found`); continue;}
    const actual = createHash('sha256').update(await readFile(full)).digest('hex');
    if (actual !== asset.sha256) errors.push(`ledger asset ${asset.id}: sha256 of ${asset.localPath} is ${actual}, ledger records ${asset.sha256}`);
  }
  return errorsOnly(errors);
};

// An approval whose inputs changed is a normal state while work resumes, so it warns and does not block renders.
// Gates already recorded as stale are not repeated; status lists them.
const checkGateHashes:Check = async project => {
  if (project.storyboard.gates.map(g => g.id).join() !== gateIds.join()) return errorsOnly([]);
  const views = await gateViews(project);
  return {errors:[], warnings:views.filter(v => v.state === 'stale' && v.gate.state !== 'stale')
    .map(v => `gate ${v.gate.id} ${v.gate.state} is stale: ${v.reason}; present ${v.gate.id} again`)};
};

const checks:Check[] = [checkMeta, checkGates, checkGateHashes, checkTimeline, checkHandoffs, checkSoundCues, checkEntrypoints, checkAssetIds, checkLedgerFiles];

/** Cross-reference checks on a project that already passed the schema. */
export async function checkProject(project:Project):Promise<Report> {
  const reports = await Promise.all(checks.map(check => check(project)));
  return {errors:reports.flatMap(r => r.errors), warnings:reports.flatMap(r => r.warnings)};
}

/** Schema check first; cross-reference checks run only on a schema-valid project. */
export async function validateProject(filmRoot:string):Promise<Report & {project:Project|null}> {
  const parsed = await parseProject(filmRoot);
  if (!parsed.ok) return {errors:parsed.errors, warnings:[], project:null};
  return {...await checkProject(parsed.project), project:parsed.project};
}
