import {createHash} from 'node:crypto';
import {lstat, readFile, readdir} from 'node:fs/promises';
import {join} from 'node:path';
import type {Project, Storyboard} from './project.js';

/** This decision applies to every film at G4; the configured root is the canonical revision folder. */
export type ScoreRule = {gate:'G4'; revisions:'audio/scores'};
const hash = (bytes:string|Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const record = (value:unknown):value is Record<string,unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const finite = (value:unknown):value is number => typeof value === 'number' && Number.isFinite(value);

/** Only fields read by cue_kind/derive: polish, gate records and grid annotations do not alter synthesis. */
export function scoreStateHash(board:Storyboard):string {
  return hash(JSON.stringify({fps:board.meta.fps,durationFrames:board.meta.durationFrames,
    audio:[board.audio.bpm,board.audio.beatFrames],
    shots:board.shots.map(s => [s.id,s.startFrame,s.endFrame,s.description,s.camera,s.transition ?? null,
      s.moves?.map(m => [m.start,m.frames,m.term]) ?? [],
      s.soundCues.map(c => [c.asset,c.eventFrame])])}));
}

async function revisionRefusal(project:Project, rule:ScoreRule, name:string, receipt:Record<string,unknown>):Promise<string|null> {
  const relative = `${rule.revisions}/${name}`;
  const dir = join(project.root,relative);
  const bytes = await readFile(join(dir,'audio-report.json')).catch(()=>null);
  let report:unknown;
  try {report = bytes ? JSON.parse(bytes.toString('utf8')) : null;} catch {return `score report missing or invalid (${relative}/audio-report.json)`;}
  if (!record(report) || !bytes || report.version !== 1) return `score report missing or invalid (${relative}/audio-report.json)`;
  if (report.passed !== true || report.timingPassed !== true || report.determinismPassed !== true) return 'score report has not passed timing and determinism';
  if (receipt.reportSha256 !== hash(bytes)) return 'score report changed since import';
  if (receipt.scoreStateSha256 !== scoreStateHash(project.storyboard)) return 'score storyboard inputs changed since import';
  if (report.fps !== project.storyboard.meta.fps || report.durationFrames !== project.storyboard.meta.durationFrames) return 'score report timeline does not match current film';
  if (!record(report.loudness) || !finite(report.loudness.integratedLufs) || !finite(report.loudness.truePeakDbtp) || Math.abs(report.loudness.integratedLufs+14) > .5 || report.loudness.truePeakDbtp > -1) return 'score loudness outside -14 +/- 0.5 LUFS or -1 dBTP';
  const beatmap = await readFile(join(project.root,'beatmap.md')).catch(()=>null);
  if (!beatmap || !beatmap.toString('utf8').trim() || !record(report.inputHashes) || report.inputHashes['beatmap.md'] !== hash(beatmap)) return 'score beat contract missing or changed since render';
  if (!(await readFile(join(dir,'listening.md'),'utf8').catch(()=>'')).trim()) return `score listening answers missing or empty (${relative}/listening.md)`;
  if (!Array.isArray(report.files) || !report.files.length) return 'score report file manifest missing or invalid';
  let bed = false;
  for (const file of report.files) {
    if (!record(file) || typeof file.file !== 'string' || !/^[a-z0-9-]+\.wav$/.test(file.file) || typeof file.sha256 !== 'string') return 'score report file manifest missing or invalid';
    const path = join(dir,file.file);
    const info = await lstat(path).catch(()=>null);
    const audio = await readFile(path).catch(()=>null);
    if (!info?.isFile() || info.isSymbolicLink() || !audio || file.sha256 !== hash(audio)) return `score audio changed or missing (${relative}/${file.file})`;
    const asset = project.ledger.assets.find(a => a.localPath === `${relative}/${file.file}` && a.sha256 === file.sha256);
    if (!asset) return `score ledger entry missing or changed (${relative}/${file.file})`;
    if (file.file === 'music.wav' && asset.id === receipt.track) bed = true;
  }
  return bed ? null : 'score music bed does not match current audio.track';
}

/** A current imported report and listening record are required; a score waiver bypasses this whole check. */
export async function scoreRefusals(project:Project, rule:ScoreRule):Promise<string[]> {
  const base = join(project.root,rule.revisions);
  const revisions = (await readdir(base,{withFileTypes:true}).catch(()=>[])).filter(d=>d.isDirectory()).sort((a,b)=>a.name.localeCompare(b.name));
  let firstFailure:string|undefined;
  for (const revision of revisions) {
    const receipt:unknown = await readFile(join(base,revision.name,'import.json'),'utf8').then(JSON.parse).catch(()=>null);
    if (!record(receipt) || !project.storyboard.audio.track || receipt.track !== project.storyboard.audio.track) continue;
    const refusal = await revisionRefusal(project,rule,revision.name,receipt);
    if (refusal === null) return [];
    firstFailure ??= refusal;
  }
  return [firstFailure ?? 'score missing (no import receipt matches the current audio.track)'];
}
