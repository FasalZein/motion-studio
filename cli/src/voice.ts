import {readFile, stat} from 'node:fs/promises';
import {isAbsolute, relative, resolve} from 'node:path';
import {CliError, type Fps, type Project, type Shot, type Voice} from './project.js';
import {secondsToFrame} from './frames.js';

/** One narration word, in seconds from the start of the narration audio (the HyperFrames words-file shape). */
export type Word = {text:string; start:number; end:number};

/** A film-relative path inside the film folder, or null. */
function insideFilm(root:string, path:string):string|null {
  const full = resolve(root,path);
  const rel = relative(root,full);
  return isAbsolute(path) || rel === '' || rel.startsWith('..') || isAbsolute(rel) ? null : full;
}
const isObject = (v:unknown):v is Record<string,unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
// Float slack for comparing a word end (decimal seconds) with the film end.
const END_TOLERANCE_SECONDS = 1e-6;
const round6 = (v:number) => Math.round(v*1e6)/1e6;
const time = (v:unknown):v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;

/**
 * Reads voice.wordTimings: a JSON array of {text, start, end} (an optional id is ignored), seconds from the start
 * of the narration audio, with non-decreasing starts and end >= start. Returns the words or one error per problem.
 */
export async function readWords(root:string, voice:Voice):Promise<{words:Word[]; errors:[]}|{words:null; errors:string[]}> {
  const where = `voice.wordTimings ${voice.wordTimings}`;
  const full = insideFilm(root,voice.wordTimings);
  if (!full) return {words:null, errors:[`${where} is outside the film folder`]};
  let value:unknown;
  try {value = JSON.parse(await readFile(full,'utf8'));}
  catch (e) {return {words:null, errors:[(e as NodeJS.ErrnoException).code === 'ENOENT' ? `${where} not found` : `${where}: invalid JSON (${(e as Error).message})`]};}
  if (!Array.isArray(value)) return {words:null, errors:[`${where} must be a JSON array of {"text", "start", "end"} words`]};
  const errors:string[] = [];
  const words:Word[] = [];
  for (const [i,w] of value.entries()) {
    if (!isObject(w) || typeof w.text !== 'string' || !w.text || !time(w.start) || !time(w.end)) {errors.push(`${where}: word ${i} needs a non-empty "text" and non-negative "start" and "end" seconds`); continue;}
    if (w.end < w.start) errors.push(`${where}: word ${i} "${w.text}" ends at ${w.end} s, before its start ${w.start} s`);
    const previous = words.at(-1);
    if (previous && w.start < previous.start) errors.push(`${where}: word ${i} "${w.text}" starts at ${w.start} s, before word ${i-1} (${previous.start} s); starts must not decrease`);
    words.push({text:w.text, start:w.start, end:w.end});
  }
  return errors.length ? {words:null, errors} : {words, errors:[]};
}

/** The film frame of a word: the voice start frame plus the nearest frame of the word's start (the shared rule). */
export const wordFrame = (voice:Voice, word:Word, fps:Fps) => (voice.startFrame ?? 0) + secondsToFrame(word.start,fps);

/** Words of a voiced project, or a CliError naming the first problems. Commands that need the words call this. */
export async function requireWords(project:Project):Promise<Word[]> {
  const {voice} = project.storyboard;
  if (voice === null) return [];
  const read = await readWords(project.root,voice);
  if (read.words === null) throw new CliError(read.errors.join('\nerror: '));
  return read.words;
}

/**
 * validate: the voice files exist in the film, the words start inside the film, and every spoken reveal names its
 * word by index and text and sits on the word's nearest frame inside its shot.
 */
export async function checkVoice({root,storyboard:{voice,shots,meta}}:Project):Promise<{errors:string[]; warnings:string[]}> {
  const errors:string[] = [];
  const withReveals = shots.filter(s => s.reveals?.length);
  if (voice === null) return {errors:withReveals.map(s => `shot ${s.id} has reveals but voice is null; reveals follow the narration words`), warnings:[]};
  const script = insideFilm(root,voice.script);
  if (!script) errors.push(`voice.script ${voice.script} is outside the film folder`);
  else if (!await stat(script).then(s => s.isFile(),() => false)) errors.push(`voice.script ${voice.script} not found`);
  const read = await readWords(root,voice);
  if (read.words === null) return {errors:[...errors,...read.errors], warnings:[]};
  const {words} = read;
  for (const [i,word] of words.entries()) {
    const frame = wordFrame(voice,word,meta.fps);
    if (frame >= meta.durationFrames) {errors.push(`voice word ${i} "${word.text}" starts at film frame ${frame}, at or after the film end (${meta.durationFrames} frames)`); continue;}
    // mix cuts the narration at the film end, so a word that runs past it would be clipped mid-word.
    const end = (voice.startFrame ?? 0)/meta.fps + word.end;
    if (end > meta.durationFrames/meta.fps + END_TOLERANCE_SECONDS) errors.push(`voice word ${i} "${word.text}" ends at ${round6(end)} s of film time, after the film end (${round6(meta.durationFrames/meta.fps)} s); lengthen the film or move voice.startFrame earlier`);
  }
  for (const shot of withReveals) for (const reveal of shot.reveals!) {
    const at = `shot ${shot.id}: reveal of word ${reveal.word} "${reveal.text}"`;
    const word = words[reveal.word];
    if (!word) {errors.push(`${at}: the word-timing file has ${words.length} words (0 to ${words.length-1})`); continue;}
    if (word.text !== reveal.text) {errors.push(`${at}: word ${reveal.word} in ${voice.wordTimings} is "${word.text}"`); continue;}
    const expected = wordFrame(voice,word,meta.fps);
    if (reveal.frame !== expected) errors.push(`${at} is at frame ${reveal.frame}, but the word starts at ${word.start} s, nearest film frame ${expected}; move the reveal to frame ${expected}`);
    else if (reveal.frame < shot.startFrame || reveal.frame >= shot.endFrame) errors.push(`${at} at frame ${reveal.frame} is outside the shot [${shot.startFrame}, ${shot.endFrame}) (reveal frames are film frames)`);
  }
  return {errors, warnings:[]};
}

const cell = (text:string) => text.replaceAll('|','\\|').replaceAll('\n',' ') || '-';
function entryOf(shot:Shot, index:number, beats:number[]):string {
  if (index === 0) return 'start';
  if (shot.entry === 'handoff') return 'handoff';
  if (!beats.length) return 'cut';
  if (beats.includes(shot.startFrame)) return 'cut on beat';
  return shot.offBeatCut === undefined ? 'cut off beat' : `cut off beat: ${shot.offBeatCut}`;
}

/**
 * `beatmap <film-dir>`: the beat map as a Markdown table, one row per shot. The spoken line lists the narration words
 * whose nearest frame falls inside the shot, so words and cuts can be read against each other.
 */
export async function beatMap(project:Project):Promise<string[]> {
  const {storyboard:{shots,audio,voice,meta:{fps}}} = project;
  const words = await requireWords(project);
  const seconds = (frame:number) => (frame/fps).toFixed(2);
  const rows = shots.map((shot,i) => {
    const spoken = voice === null ? [] : words.filter(w => {const f = wordFrame(voice,w,fps); return f >= shot.startFrame && f < shot.endFrame;});
    return [shot.id, `[${shot.startFrame}, ${shot.endFrame})`, `${seconds(shot.startFrame)}-${seconds(shot.endFrame)}`, entryOf(shot,i,audio.beatFrames),
      shot.description, shot.camera, spoken.length ? `"${spoken.map(w => w.text).join(' ')}"` : '',
      (shot.reveals ?? []).map(r => `"${r.text}" f${r.frame}`).join(', '),
      shot.soundCues.map(c => `${c.asset} f${c.eventFrame}`).join(', '), shot.engine].map(cell);
  });
  const header = ['shot','frames','seconds','entry','visual event','camera','spoken line','reveals','sound cues','engine'];
  return [header,header.map(() => '---'),...rows].map(r => `| ${r.join(' | ')} |`);
}
