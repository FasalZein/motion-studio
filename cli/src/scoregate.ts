import {createHash} from 'node:crypto';
import {lstat, readFile, readdir} from 'node:fs/promises';
import {join} from 'node:path';
import type {Project, Storyboard} from './project.js';

/** This decision applies to every film at G4; the configured root is the canonical revision folder. */
export type ScoreRule = {gate:'G4'; revisions:'audio/scores'};
const hash = (bytes:string|Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const record = (value:unknown):value is Record<string,unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const finite = (value:unknown):value is number => typeof value === 'number' && Number.isFinite(value);

/** Inputs after score import, excluding gate records and unrelated visual source/polish fields. */
export function scoreStateHash(board:Storyboard):string {
  return hash(JSON.stringify({fps:board.meta.fps,durationFrames:board.meta.durationFrames,
    audio:[board.audio.track,board.audio.grid,board.audio.bpm,board.audio.beatFrames,board.audio.downbeatFrames,board.audio.dropFrames,board.audio.confidence],
    shots:board.shots.map(s => [s.id,s.startFrame,s.endFrame,s.description,s.camera,s.entry,s.exit,s.transition ?? null,
      s.moves?.map(m => [m.start,m.frames,m.term]) ?? [],s.effects?.map(e => [e.start,e.frames,e.term]) ?? [],
      s.soundCues.map(c => [c.asset,c.eventFrame,c.peakOffsetFrames,c.gainDb ?? 0])])}));
}

/** A current imported report and listening record are required; a score waiver bypasses this whole check. */
export async function scoreRefusals(project:Project, rule:ScoreRule):Promise<string[]> {
  const base = join(project.root,rule.revisions);
  const revisions = (await readdir(base,{withFileTypes:true}).catch(()=>[])).filter(d=>d.isDirectory()).sort((a,b)=>a.name.localeCompare(b.name));
  let matched = false;
  for (const revision of revisions) {
    const dir = join(base,revision.name);
    const receipt:unknown = await readFile(join(dir,'import.json'),'utf8').then(JSON.parse).catch(()=>null);
    if (!record(receipt) || !project.storyboard.audio.track || receipt.track !== project.storyboard.audio.track) continue;
    matched = true;
    const bytes = await readFile(join(dir,'audio-report.json')).catch(()=>null);
    let report:unknown;
    try {report = bytes ? JSON.parse(bytes.toString('utf8')) : null;} catch {continue;}
    if (!record(report) || !bytes || report.version !== 1 || report.passed !== true || report.timingPassed !== true || report.determinismPassed !== true) continue;
    if (receipt.reportSha256 !== hash(bytes) || receipt.scoreStateSha256 !== scoreStateHash(project.storyboard)) continue;
    if (report.fps !== project.storyboard.meta.fps || report.durationFrames !== project.storyboard.meta.durationFrames) continue;
    if (!record(report.loudness) || !finite(report.loudness.integratedLufs) || !finite(report.loudness.truePeakDbtp) || Math.abs(report.loudness.integratedLufs+14) > .5 || report.loudness.truePeakDbtp > -1) continue;
    const beatmap = await readFile(join(project.root,'beatmap.md')).catch(()=>null);
    if (!beatmap || !beatmap.toString('utf8').trim() || !record(report.inputHashes) || report.inputHashes['beatmap.md'] !== hash(beatmap)) continue;
    if (!(await readFile(join(dir,'listening.md'),'utf8').catch(()=>'')).trim()) continue;
    if (!Array.isArray(report.files) || !report.files.length) continue;
    let current = true;
    let bed = false;
    for (const file of report.files) {
      if (!record(file) || typeof file.file !== 'string' || !/^[a-z0-9-]+\.wav$/.test(file.file) || typeof file.sha256 !== 'string') {current = false; break;}
      const path = join(dir,file.file);
      const info = await lstat(path).catch(()=>null);
      const audio = await readFile(path).catch(()=>null);
      if (!info?.isFile() || info.isSymbolicLink() || !audio || file.sha256 !== hash(audio)) {current = false; break;}
      const asset = project.ledger.assets.find(a => a.localPath === `${rule.revisions}/${revision.name}/${file.file}` && a.sha256 === file.sha256);
      if (!asset) {current = false; break;}
      if (file.file === 'music.wav' && asset.id === receipt.track) bed = true;
    }
    if (current && bed) return [];
  }
  return [matched ? 'score stale or incomplete (need a passing unchanged report, current imported audio, import receipt and non-empty listening.md)' : 'score missing (no import receipt matches the current audio.track)'];
}
