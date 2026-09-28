import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, relative, resolve} from 'node:path';
import {CliError, writeStoryboard, type Fps, type Project, type Storyboard} from './project.js';
import {secondsToFrame} from './frames.js';
import type {Tools} from './seam.js';

// Beat detection runs in TypeScript on mono PCM decoded by ffmpeg. The bundled `hyperframes beats` utility was
// checked first and not wrapped: it has no downbeats or drops, reports confidence only in its console line,
// needs headless Chrome and a HyperFrames project, and returns a constant-tempo grid from a rounded BPM
// (119.8 for an exact 120 BPM 16 s click track, 122.2 for a 120 BPM groove), which drifts over a whole song.

export type Audio = Storyboard['audio'];
/** A beat grid in seconds: the format of `audio/beats.detected.json` and of `--corrected` and `--imported` files. */
export type GridFile = {bpm:number; beats:number[]; downbeats:number[]; drops:number[]};
type UserGrid = 'corrected'|'imported';
type Meter = 3|4;

/** Proposal written by detection, relative to the film root. */
export const DETECTED_FILE = 'audio/beats.detected.json';
// Analysis sample rate: mono float PCM from ffmpeg. Enough for beat accents and energy.
const ANALYSIS_RATE = 22_050;
// A track whose largest sample is below -60 dBFS is silent: there is nothing to detect.
const SILENCE_PEAK = 10 ** (-60/20);
// Accent window around a detected beat time.
const ACCENT_BEFORE_S = 0.01;
const ACCENT_AFTER_S = 0.06;
// A meter is clear when, in the median bar, the downbeat peak is at least 1.25 times the mean of the other beats.
const ACCENT_RATIO = 1.25;
// A bar start is clear only when its score is at least 1.2 times the score of every other start in that meter.
// Accents every 2 beats (kick on 1 and 3, snare on 2 and 4) score two starts of a 4-beat bar about equally.
const PHASE_MARGIN = 1.2;
// A drop is a rise of at least +6 dB RMS from the two bars before a beat to the bar that starts on it.
const DROP_RATIO = 2;
const BEATS_PER_BAR_WITHOUT_METER = 4;

/** True when any beat time or the tempo differs. G2 hashes these same four fields, so a true result makes G2 and every later gate stale (D43). */
export function gridChanged(before:Audio, after:Audio):boolean {
  const key = (a:Audio) => JSON.stringify([a.bpm,a.beatFrames,a.downbeatFrames,a.dropFrames]);
  return key(before) !== key(after);
}

async function pcm(tools:Tools, file:string, temp:string):Promise<Float32Array> {
  const out = join(temp,'analysis.f32');
  await tools.command('ffmpeg',['-hide_banner','-loglevel','error','-y','-i',file,'-vn','-ac','1','-ar',String(ANALYSIS_RATE),'-f','f32le','-c:a','pcm_f32le',out]);
  return new Float32Array(new Uint8Array(await readFile(out)).buffer);
}
function peakIn(samples:Float32Array, fromS:number, toS:number):number {
  let peak = 0;
  for (let i=Math.max(0,Math.floor(fromS*ANALYSIS_RATE));i<Math.min(samples.length,Math.ceil(toS*ANALYSIS_RATE));i++) peak = Math.max(peak,Math.abs(samples[i]));
  return peak;
}
function meanSquare(samples:Float32Array, fromS:number, toS:number):number {
  const from = Math.max(0,Math.floor(fromS*ANALYSIS_RATE)), to = Math.min(samples.length,Math.ceil(toS*ANALYSIS_RATE));
  let sum = 0;
  for (let i=from;i<to;i++) sum += samples[i]*samples[i];
  return to > from ? sum/(to-from) : 0;
}
const median = (values:number[]) => {
  const sorted = [...values].sort((a,b) => a-b);
  return sorted.length % 2 ? sorted[(sorted.length-1)/2] : (sorted[sorted.length/2-1]+sorted[sorted.length/2])/2;
};
const mean = (values:number[]) => values.reduce((a,b) => a+b,0)/values.length;

// Onset envelope: one value every ONSET_HOP samples (2.9 ms), comparing the RMS of the ONSET_WINDOW samples
// (11.6 ms) that start there with the RMS of the window just before. It peaks where a sound starts.
const ONSET_HOP = 64;
const ONSET_WINDOW = 256;
// Tempo search range. Faster music is reported at half tempo, slower music at double tempo.
const MIN_BPM = 70;
const MAX_BPM = 180;
// Each beat is snapped to the strongest onset within this fraction of a beat period of its prediction.
const SNAP_FRACTION = 0.1;
// Beat evidence, calibrated by hand on the test fixtures, two commercial songs (1.85 and 3.95), a voice memo (1.03),
// white noise (1.16) and a sine tone (onset share 0.002): the autocorrelation peak must be at least PERIODICITY_MIN
// times its mean over the tempo range, and the mean onset value at least ONSET_SHARE_MIN of the track RMS.
const PERIODICITY_MIN = 1.4;
const ONSET_SHARE_MIN = 0.01;
// An onset counts as a beat when it is at least this fraction of the median snapped onset strength
// of the FLOOR_REACH beats on each side.
const ONSET_FLOOR = 0.3;
const FLOOR_REACH = 4;
// Tempo is sure when at least this share of beats land on an onset and beat intervals vary by less than 5 %.
const SURE_ONSET_SHARE = 0.9;
const SURE_INTERVAL_SPREAD = 0.05;

function onsetEnvelope(samples:Float32Array):number[] {
  const rms = (from:number) => {
    let sum = 0;
    for (let i=from;i<from+ONSET_WINDOW;i++) sum += samples[i]*samples[i];
    return Math.sqrt(sum/ONSET_WINDOW);
  };
  const steps = ONSET_WINDOW/ONSET_HOP;
  const onset:number[] = [];
  for (let n=0;n*ONSET_HOP+ONSET_WINDOW<=samples.length;n++) onset.push(n < steps ? 0 : Math.max(0,rms(n*ONSET_HOP)-rms((n-steps)*ONSET_HOP)));
  return onset;
}

/**
 * Beat times in seconds from the onset envelope, or null when the track has no periodic onsets.
 * 1. Tempo: the lag between MIN_BPM and MAX_BPM with the largest autocorrelation of the envelope,
 *    refined below one envelope step by a parabola through its two neighbours.
 * 2. Phase: the offset whose beat positions (each the largest value within one step) collect the most onset strength.
 * 3. Tracking: from the first beat, predict the next one a period later and snap it to the strongest onset
 *    within SNAP_FRACTION of a period. A beat without an onset keeps its prediction. This follows tempo drift.
 * 4. Beats before the first and after the last onset beat are dropped: the grid is not extended into silence.
 */
function trackBeats(samples:Float32Array):{times:number[]; bpm:number; sure:boolean}|null {
  const onset = onsetEnvelope(samples);
  const hopsPerSecond = ANALYSIS_RATE/ONSET_HOP;
  const minLag = Math.floor(hopsPerSecond*60/MAX_BPM), maxLag = Math.ceil(hopsPerSecond*60/MIN_BPM);
  if (onset.length < 2*maxLag) return null;
  const correlation = (l:number) => {
    let sum = 0;
    for (let n=l;n<onset.length;n++) sum += onset[n]*onset[n-l];
    return sum/(onset.length-l);
  };
  let best = 0, bestCorrelation = 0, total = 0;
  for (let l=minLag;l<=maxLag;l++) {
    const c = correlation(l);
    total += c;
    if (c > bestCorrelation) {bestCorrelation = c; best = l;}
  }
  // Without a beat the autocorrelation is flat: its peak stays close to its mean over the tempo range.
  if (!best || bestCorrelation < PERIODICITY_MIN*total/(maxLag-minLag+1)) return null;
  // A sustained sound (a tone or a pad) has only a small ripple for an envelope, which can still look periodic.
  if (mean(onset) < ONSET_SHARE_MIN*Math.sqrt(meanSquare(samples,0,samples.length/ANALYSIS_RATE))) return null;
  const [left,right] = [correlation(best-1),correlation(best+1)];
  const curve = left - 2*bestCorrelation + right;
  const lag = best + (curve < 0 ? (left-right)/(2*curve) : 0);
  const strongestNear = (center:number, reach:number) => {
    let at = -1, strength = 0;
    for (let n=Math.max(0,Math.round(center-reach));n<=Math.min(onset.length-1,Math.round(center+reach));n++) if (onset[n] > strength) {strength = onset[n]; at = n;}
    return {at, strength};
  };
  let phase = 0, bestPhase = -1;
  for (let p=0;p<best;p++) {
    let sum = 0;
    for (let k=0;p+k*lag<onset.length;k++) sum += strongestNear(p+k*lag,1).strength;
    if (sum > bestPhase) {bestPhase = sum; phase = p;}
  }
  const snapped:{at:number; strength:number}[] = [];
  for (let predicted=phase;predicted<onset.length;predicted = snapped.at(-1)!.at + lag) {
    const hit = strongestNear(predicted,Math.max(1,lag*SNAP_FRACTION));
    snapped.push(hit.at < 0 ? {at:predicted, strength:0} : hit);
  }
  // Snapping chose the strongest nearby value; below the floor it is not an onset, so the prediction stays.
  // The floor follows the local level (the beats within FLOOR_REACH on each side), so a quiet intro still counts.
  const strengths = snapped.map(s => s.strength);
  if (!strengths.some(s => s > 0)) return null;
  let previous = -Infinity;
  const tracked = snapped.map((s,k) => {
    const onBeat = s.strength > 0 && s.strength >= ONSET_FLOOR*median(strengths.slice(Math.max(0,k-FLOOR_REACH),k+FLOOR_REACH+1));
    const at = onBeat || !k ? s.at : previous + lag;
    previous = at;
    return {at, onBeat};
  });
  const beats = tracked.slice(tracked.findIndex(b => b.onBeat), tracked.length - [...tracked].reverse().findIndex(b => b.onBeat));
  if (beats.length < 2) return null;
  const times = beats.map(b => b.at*ONSET_HOP/ANALYSIS_RATE);
  const intervals = times.slice(1).map((t,k) => t-times[k]);
  const period = median(intervals);
  const spread = Math.sqrt(mean(intervals.map(i => (i-period)**2)))/period;
  const share = beats.filter(b => b.onBeat).length/beats.length;
  // The mean period over the whole track; single intervals carry the envelope's 2.9 ms step.
  return {times, bpm:60*(times.length-1)/(times.at(-1)!-times[0]), sure:share >= SURE_ONSET_SHARE && spread < SURE_INTERVAL_SPREAD};
}

/**
 * Downbeats from accents. For each meter (3 or 4) and phase, each complete bar gives the ratio of its first
 * beat's peak to the mean peak of its other beats; the score is the median ratio. A meter is chosen only when
 * it reaches ACCENT_RATIO, the other meter does not, and its best phase beats every other phase by PHASE_MARGIN;
 * otherwise the bar start is ambiguous or unaccented.
 */
function findMeter(accents:number[]):{meter:Meter; phase:number}|{meter:null; reason:string} {
  const best = ([3,4] as const).map(meter => {
    const scores = Array.from({length:meter},(_,phase) => {
      const ratios:number[] = [];
      for (let start=phase;start+meter<=accents.length;start+=meter) {
        const others = mean(accents.slice(start+1,start+meter));
        if (others > 0) ratios.push(accents[start]/others);
      }
      return ratios.length ? median(ratios) : 0;
    });
    const phase = scores.indexOf(Math.max(...scores));
    const runnerUp = Math.max(...scores.filter((_,p) => p !== phase));
    return {meter, phase, score:scores[phase], runnerUp};
  });
  const clear = best.filter(b => b.score >= ACCENT_RATIO);
  const unsure = clear.find(b => b.score < PHASE_MARGIN*b.runnerUp);
  if (unsure) return {meter:null, reason:`ambiguous bar start: accents fit more than one first beat in a ${unsure.meter}-beat bar`};
  if (clear.length === 1) return {meter:clear[0].meter, phase:clear[0].phase};
  return {meter:null, reason:clear.length ? 'ambiguous meter: accents fit both 3 and 4 beats per bar' : 'no accent pattern marks the first beat of a bar'};
}

/** Beat indices where the RMS of the bar that starts there is at least DROP_RATIO times the RMS of the two bars before it. */
function findDrops(samples:Float32Array, times:number[], barLength:number, candidates:number[]):number[] {
  const end = (i:number) => i < times.length ? times[i] : times.at(-1)! + median(times.slice(1).map((t,k) => t-times[k]));
  const ratioAt = (i:number) => {
    if (i < 2*barLength || i+barLength > times.length) return 0;
    const before = meanSquare(samples,times[i-2*barLength],times[i]);
    const after = meanSquare(samples,times[i],end(i+barLength));
    return before > 0 ? Math.sqrt(after/before) : 0;
  };
  const ratios = candidates.map(i => ({i, ratio:ratioAt(i)}));
  // A step raises the ratio at neighbouring candidates too; keep only the candidate where it peaks.
  return ratios.filter((r,k) => r.ratio >= DROP_RATIO && r.ratio >= (ratios[k-1]?.ratio ?? 0) && r.ratio > (ratios[k+1]?.ratio ?? 0)).map(r => r.i);
}

type Proposal = {kind:'none'; reason:string}|{kind:'grid'; grid:GridFile; confidence:'high'|'low'; notes:string[]; meter:Meter|null};

async function detect(tools:Tools, track:string):Promise<Proposal> {
  const temp = await mkdtemp(join(tmpdir(),'motion-beats-'));
  try {
    const samples = await pcm(tools,track,temp);
    if (peakIn(samples,0,samples.length/ANALYSIS_RATE) < SILENCE_PEAK) return {kind:'none', reason:'silent track (peak below -60 dBFS)'};
    const found = trackBeats(samples);
    if (!found) return {kind:'none', reason:'no periodic onsets found in the track'};
    const {times} = found;
    const notes:string[] = [];
    if (!found.sure) notes.push('tempo estimate is unsure');
    const accents = times.map(t => peakIn(samples,t-ACCENT_BEFORE_S,t+ACCENT_AFTER_S));
    const meter = findMeter(accents);
    const downbeats = meter.meter === null ? [] : times.map((_,i) => i).filter(i => i % meter.meter === meter.phase);
    if (meter.meter === null) notes.push(`${meter.reason}; no downbeats proposed`);
    // Without a meter, a drop may start on any beat, and a bar counts as four beats.
    const drops = findDrops(samples,times,meter.meter ?? BEATS_PER_BAR_WITHOUT_METER,meter.meter === null ? times.map((_,i) => i) : downbeats);
        return {kind:'grid', meter:meter.meter, confidence:notes.length ? 'low' : 'high', notes,
      grid:{bpm:found.bpm, beats:times, downbeats:downbeats.map(i => times[i]), drops:drops.map(i => times[i])}};
  } finally {await rm(temp,{recursive:true,force:true});}
}

/** Checks a grid file and converts it to frames; returns every problem found. */
function parseGrid(value:unknown, fps:Fps):{ok:true; frames:{bpm:number; beatFrames:number[]; downbeatFrames:number[]; dropFrames:number[]}}|{ok:false; errors:string[]} {
  const keys = ['bpm','beats','downbeats','drops'] as const;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {ok:false, errors:['the grid must be a JSON object with bpm, beats, downbeats and drops']};
  const record = value as Record<string,unknown>;
  const errors = [
    ...keys.filter(k => !(k in record)).map(k => `missing field "${k}"`),
    ...Object.keys(record).filter(k => !(keys as readonly string[]).includes(k)).map(k => `unknown field "${k}" (allowed: ${keys.join(', ')})`),
  ];
  if ('bpm' in record && !(typeof record.bpm === 'number' && Number.isFinite(record.bpm) && record.bpm > 0)) errors.push('bpm must be a number greater than 0');
  const lists:Partial<Record<'beats'|'downbeats'|'drops',number[]>> = {};
  for (const key of ['beats','downbeats','drops'] as const) {
    const list = record[key];
    if (!(key in record)) continue;
    if (!Array.isArray(list) || !list.every(t => typeof t === 'number' && Number.isFinite(t) && t >= 0)) {errors.push(`${key} must be a list of times in seconds, each 0 or more`); continue;}
    if (list.some((t,i) => i > 0 && t <= list[i-1])) {errors.push(`${key} must be in increasing order without repeats`); continue;}
    lists[key] = list;
  }
  if (lists.beats && !lists.beats.length) errors.push('beats must not be empty');
  if (errors.length || !lists.beats || !lists.downbeats || !lists.drops) return {ok:false, errors};
  const toFrames = (list:number[]) => list.map(t => secondsToFrame(t,fps));
  const beatFrames = toFrames(lists.beats);
  for (const [i,frame] of beatFrames.entries()) if (i > 0 && frame === beatFrames[i-1]) errors.push(`beats ${lists.beats[i-1]} s and ${lists.beats[i]} s both fall on frame ${frame} at ${fps} fps`);
  const onBeat = new Set(beatFrames);
  const downbeatFrames = toFrames(lists.downbeats), dropFrames = toFrames(lists.drops);
  for (const [i,frame] of downbeatFrames.entries()) if (!onBeat.has(frame)) errors.push(`downbeat ${lists.downbeats[i]} s (frame ${frame}) is not on a beat frame`);
  for (const [i,frame] of dropFrames.entries()) if (!onBeat.has(frame)) errors.push(`drop ${lists.drops[i]} s (frame ${frame}) is not on a beat frame`);
  return errors.length ? {ok:false, errors} : {ok:true, frames:{bpm:record.bpm as number, beatFrames, downbeatFrames, dropFrames}};
}

const frameList = (frames:number[]) => frames.length ? frames.join(', ') : 'none';

/**
 * `beats <film-dir>` proposes a grid from audio.track. `beats <film-dir> --corrected|--imported <grid.json>`
 * applies a user grid in seconds. Both write the audio fields of storyboard.json and print the result.
 */
export async function beats(project:Project, args:string[], tools:Tools):Promise<string[]> {
  const {root, storyboard, ledger} = project;
  const before = storyboard.audio;
  const fps = storyboard.meta.fps;
  const lines:string[] = [];
  let after:Audio;
  if (args.length) {
    const [flag,file] = args;
    if ((flag !== '--corrected' && flag !== '--imported') || !file || args.length > 2) throw new CliError('usage: motion-studio beats <film-dir> [--corrected <grid.json> | --imported <grid.json>]');
    const source:UserGrid = flag === '--corrected' ? 'corrected' : 'imported';
    let value:unknown;
    try {value = JSON.parse(await readFile(file,'utf8'));}
    catch (e) {throw new CliError(`cannot read grid file ${file}: ${(e as Error).message}`);}
    const parsed = parseGrid(value,fps);
    if (!parsed.ok) {
      for (const e of parsed.errors) console.error(`error: ${file}: ${e}`);
      throw new CliError(`invalid grid file ${file}: ${parsed.errors.length} error${parsed.errors.length === 1 ? '' : 's'}`);
    }
    // The creator supplied or confirmed this grid, so it is not a guess (as in the docs/v0-contract.md example).
    after = {track:before.track, grid:source, ...parsed.frames, confidence:'high'};
    lines.push(`grid ${source}: bpm ${after.bpm}, ${after.beatFrames.length} beats (frames ${after.beatFrames[0]} to ${after.beatFrames.at(-1)})`,
      `downbeats: ${frameList(after.downbeatFrames)}`, `drops: ${frameList(after.dropFrames)}`);
  } else {
    if (before.grid === 'corrected' || before.grid === 'imported') throw new CliError(`audio.grid is ${before.grid}; detection would discard it. Apply a grid with --corrected or --imported, or set audio.grid to null in storyboard.json to detect again`);
    if (before.track === null) throw new CliError('audio.track is not set; add the track to ledger.json and set audio.track to its id');
    const asset = ledger.assets.find(a => a.id === before.track);
    if (!asset) throw new CliError(`audio.track uses asset ${before.track}, which is not in ledger.json`);
    const trackPath = resolve(root,asset.localPath);
    if (relative(root,trackPath).startsWith('..')) throw new CliError(`ledger asset ${asset.id}: path ${asset.localPath} is outside the film folder`);
    const proposal = await detect(tools,trackPath);
    const detectedFile = join(root,DETECTED_FILE);
    if (proposal.kind === 'none') {
      after = {track:before.track, grid:null, bpm:null, beatFrames:[], downbeatFrames:[], dropFrames:[], confidence:null};
      await rm(detectedFile,{force:true});
      lines.push(`grid: none (${proposal.reason})`, 'import a grid with --imported <grid.json> if the film needs one');
    } else {
      const {grid} = proposal;
      const toFrames = (list:number[]) => [...new Set(list.map(t => secondsToFrame(t,fps)))];
      const bpm = Math.round(grid.bpm*10)/10;
      after = {track:before.track, grid:'detected', bpm, beatFrames:toFrames(grid.beats), downbeatFrames:toFrames(grid.downbeats), dropFrames:toFrames(grid.drops), confidence:proposal.confidence};
      await mkdir(join(root,'audio'),{recursive:true});
      await writeFile(detectedFile,JSON.stringify({...grid, bpm} satisfies GridFile,null,2)+'\n');
      lines.push(`grid detected: bpm ${after.bpm}, ${after.beatFrames.length} beats (frames ${after.beatFrames[0]} to ${after.beatFrames.at(-1)}), confidence ${proposal.confidence}`,
        ...proposal.notes.map(n => `low confidence: ${n}`),
        proposal.meter === null ? 'downbeats: none' : `downbeats (meter ${proposal.meter}): ${frameList(after.downbeatFrames)}`,
        after.dropFrames.length ? `drops: ${frameList(after.dropFrames)}` : `drops: none (no bar rises +6 dB or more over the two bars before it)`,
        `wrote ${DETECTED_FILE} (times in seconds); correct a copy and apply it with --corrected <file>`);
    }
  }
  const changed = gridChanged(before,after);
  await writeStoryboard(root,{...storyboard, audio:after});
  lines.push(changed ? 'grid changed' : 'grid unchanged');
  return lines;
}
