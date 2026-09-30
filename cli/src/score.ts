import {createHash} from 'node:crypto';
import {readFile, writeFile} from 'node:fs/promises';
import {dirname, join, relative, resolve} from 'node:path';
import {assets} from './assets.js';
import {CliError, parseProject, schemaErrors, writeStoryboard, type Project, type Storyboard} from './project.js';
import {realInside} from './validate.js';
import type {Tools} from './seam.js';

const usage = 'usage: motion-studio score-import <film-dir> <audio-report.json> --id <revision-id>';
const hash = (bytes:Uint8Array) => createHash('sha256').update(bytes).digest('hex');
function object(value:unknown):Record<string,unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new CliError('score report: expected an object');
  return value as Record<string,unknown>;
}
function text(value:unknown):string {
  if (typeof value !== 'string' || !value.length) throw new CliError('score report: expected non-empty text');
  return value;
}
function number(value:unknown):number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new CliError('score report: expected a finite number');
  return value;
}
function integer(value:unknown):number {
  const n = number(value);
  if (!Number.isInteger(n)) throw new CliError('score report: expected a whole number');
  return n;
}
function list(value:unknown):unknown[] {
  if (!Array.isArray(value)) throw new CliError('score report: expected a list');
  return value;
}
function filename(value:unknown):string {
  const name = text(value);
  if (!/^[a-z0-9-]+\.wav$/.test(name)) throw new CliError('score report: invalid WAV filename');
  return name;
}

/** Imports a checked score through the existing asset ledger and storyboard writer. Does not replace narration. */
export async function importScore(project:Project, args:string[], tools:Tools):Promise<string[]> {
  const [file, flag, prefix] = args;
  if (args.length !== 3 || flag !== '--id' || !prefix || !/^[A-Za-z0-9_-]+$/.test(prefix)) throw new CliError(usage);
  const reportPath = resolve(file);
  if (!await realInside(project.root,reportPath)) throw new CliError('score report must be inside the film folder');
  const report = object(JSON.parse(await readFile(reportPath,'utf8')));
  if (report.version !== 1 || report.passed !== true || report.timingPassed !== true || report.determinismPassed !== true) throw new CliError('score report must pass timing, loudness and determinism before import');
  const inputs = object(report.inputHashes);
  for (const name of ['storyboard.json','beatmap.md']) {
    if (hash(await readFile(join(project.root,name))) !== inputs[name]) throw new CliError(`score report is stale: ${name} changed; rescore before import`);
  }
  if (report.fps !== project.storyboard.meta.fps || report.durationFrames !== project.storyboard.meta.durationFrames) throw new CliError('score report does not match the film timeline');
  const files = list(report.files).map(value => {
    const f = object(value);
    const license = text(f.license);
    if (!['synthesized original','synthesized original + Pixabay Content License'].includes(license)) throw new CliError('score report: unsupported audio license');
    return {file:filename(f.file), sha256:text(f.sha256), license, sources:list(f.sources)};
  });
  if (new Set(files.map(f => f.file)).size !== files.length || !files.some(f => f.file === 'music.wav') || !files.some(f => f.file === 'score.wav')) throw new CliError('score report: duplicate or missing audio files');
  const directory = dirname(reportPath);
  const id = (name:string) => `${prefix}-${name.slice(0,-4)}`;
  for (const f of files) {
    if (project.ledger.assets.some(a => a.id === id(f.file))) throw new CliError(`score asset id already exists: ${id(f.file)}; use a new revision id`);
    if (!await realInside(project.root,join(directory,f.file)) || hash(await readFile(join(directory,f.file))) !== f.sha256) throw new CliError(`score file changed: ${f.file}; rescore before import`);
  }
  const hits = list(report.hits).map(value => {
    const h = object(value);
    const eventFrame = integer(h.eventFrame);
    if (Math.abs(number(h.onsetFrame)-eventFrame) > 1 || Math.abs(number(h.librosaOnsetFrame)-eventFrame) > 1) throw new CliError('score report: a hit is more than one frame off');
    const file = filename(h.file);
    if (!files.some(f => f.file === file)) throw new CliError('score report: hit file is not in files');
    return {file, shot:text(h.shot), eventFrame, peakOffsetFrames:integer(h.peakOffsetFrames)};
  });
  const original = project.storyboard.shots.flatMap(shot => shot.soundCues.map(cue => ({shot:shot.id, eventFrame:cue.eventFrame})));
  if (hits.length !== original.length || hits.some((h,i) => h.shot !== original[i].shot || h.eventFrame !== original[i].eventFrame)) throw new CliError('score report does not match storyboard sound cues');
  // Re-measure the delivered preview. A passing JSON flag alone is not a loudness check.
  const measured = await tools.command('ffmpeg',['-hide_banner','-nostats','-i',join(directory,'score.wav'),'-af','ebur128=peak=true','-f','null','-']);
  const lufs = Number(/Integrated loudness:\s*I:\s*(-?[\d.]+) LUFS/.exec(measured)?.[1]);
  const peak = Number(/True peak:\s*Peak:\s*(-?[\d.]+) dBFS/.exec(measured)?.[1]);
  if (!Number.isFinite(lufs) || !Number.isFinite(peak) || Math.abs(lufs+14) > .5 || peak > -1) throw new CliError('score preview does not meet -14 +/- 0.5 LUFS and -1 dBTP');
  const next:Storyboard = {...project.storyboard,
    audio:{track:id('music.wav'),grid:'imported',bpm:number(report.bpm),beatFrames:list(report.beatFrames).map(integer),downbeatFrames:list(report.downbeatFrames).map(integer),dropFrames:list(report.dropFrames).map(integer),confidence:'high'},
    shots:project.storyboard.shots.map(shot => ({...shot,soundCues:hits.filter(h => h.shot === shot.id).map(h => ({asset:id(h.file),eventFrame:h.eventFrame,peakOffsetFrames:h.peakOffsetFrames}))}))};
  const errors = await schemaErrors('storyboard.json',next);
  if (errors.length) throw new CliError(`score import would produce an invalid storyboard: ${errors.join('; ')}`);
  const lines:string[] = [];
  let current = project;
  for (const f of files) {
    const owners = hits.filter(h => h.file === f.file).map(h => h.shot);
    lines.push(...await assets(current,['add',id(f.file),'--file',join(directory,f.file),'--type','audio','--source-kind','code','--source',`motion-score seed ${integer(report.seed)}, script sha256 ${text(report.scriptSha256)}`,'--license','known','--license-name',f.license,'--evidence',JSON.stringify({report:relative(project.root,reportPath),sources:f.sources}),...owners.flatMap(shot => ['--shot',shot])],new Map()));
    const parsed = await parseProject(project.root);
    if (!parsed.ok) throw new CliError(parsed.errors.join('; '));
    current = parsed.project;
  }
  await writeStoryboard(project.root,next);
  await writeFile(join(directory,'import.json'),JSON.stringify({reportSha256:hash(await readFile(reportPath)),storyboardSha256:hash(await readFile(join(project.root,'storyboard.json'))),track:next.audio.track},null,2)+'\n');
  lines.push(`score imported: ${next.audio.track}; ${hits.length} hit stems; run mix to apply narration ducking and delivery limiting`);
  return lines;
}
