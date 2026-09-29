import {access, mkdtemp, open, readFile, rm, stat, writeFile} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {join, relative} from 'node:path';
import {tmpdir} from 'node:os';
import {chosenFormats, CliError, type Format, type Project, type Shot} from './project.js';
import {outputsOf, type Outputs} from './outputs.js';
import {round3, type Tools} from './seam.js';

// Liveness measures stillness with the method of the reference study (D59), so the study's limits apply. Every value
// below comes from D59; change them only with a new decision.
export const METHOD = {
  /** Samples per second: absorbs animation on twos and duplicate frames of 24, 25 and 30 fps sources. */
  sampleFps:12,
  width:320,
  height:180,
  /** Noise floor T = clip(3 x p5(d), 0.03, 0.25), in 8-bit luma levels. */
  noiseFloor:{factor:3, percentile:5, min:0.03, max:0.25},
  /** A sample also moves when more than this share of pixels changes by more than pixelDelta levels. */
  pixelShare:0.0005,
  pixelDelta:6,
  /** A still span whose picture has a mean luma below this is black and leaves the content basis. */
  blackLuma:8,
  /** A trailing still span at least this long (seconds) is an end-card hold and leaves the content basis. */
  endCardSeconds:0.5,
};
/** D59 limits, compared at reporting precision (3 decimals). */
export const LIMITS = {
  movingShare:0.75,
  stillOver0_5:0.10,
  stillOver1:0.05,
  stillOver2:0.04,
  /** Longest still span in seconds: `short` for a film under `filmSeconds`, `long` from `filmSeconds` up. */
  longestStill:{short:2, long:3, filmSeconds:90},
};
const FRAME_BYTES = METHOD.width*METHOD.height;

/** A run of samples: `start` is the index of its first step, `steps` its number of steps (step i compares sample i with i+1). */
type Run = {start:number; steps:number};
type Samples = {d:number[]; pixels:number[]; luma:number[]};

/** Decodes the video with the study's ffmpeg chain and returns per-step differences and per-sample mean luma. */
async function sample(tools:Tools, video:string):Promise<Samples> {
  const temp = await mkdtemp(join(tmpdir(),'motion-liveness-'));
  try {
    const raw = join(temp,'luma.gray');
    await tools.command('ffmpeg',['-hide_banner','-loglevel','error','-nostdin','-y','-i',video,'-map','0:v:0','-an','-vf',`fps=${METHOD.sampleFps},scale=${METHOD.width}:${METHOD.height}:flags=area,format=gray`,'-f','rawvideo',raw]);
    const count = Math.floor((await stat(raw)).size/FRAME_BYTES);
    const result:Samples = {d:[], pixels:[], luma:[]};
    const file = await open(raw);
    try {
      let previous:Buffer|undefined;
      for (let i=0;i<count;i++) {
        const frame = Buffer.alloc(FRAME_BYTES);
        await file.read(frame,0,FRAME_BYTES,i*FRAME_BYTES);
        let sum = 0;
        for (let p=0;p<FRAME_BYTES;p++) sum += frame[p];
        result.luma.push(sum/FRAME_BYTES);
        if (previous) {
          let total = 0, changed = 0;
          for (let p=0;p<FRAME_BYTES;p++) {
            const delta = Math.abs(frame[p]-previous[p]);
            total += delta;
            if (delta > METHOD.pixelDelta) changed++;
          }
          result.d.push(total/FRAME_BYTES);
          result.pixels.push(changed/FRAME_BYTES);
        }
        previous = frame;
      }
    } finally {await file.close();}
    return result;
  } finally {await rm(temp,{recursive:true,force:true});}
}

/** Percentile with linear interpolation between the closest ranks (numpy's default, as in the study). */
function percentile(values:number[], q:number):number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a,b) => a-b);
  const position = (sorted.length-1)*q/100;
  const low = Math.floor(position), high = Math.ceil(position);
  return sorted[low]+(sorted[high]-sorted[low])*(position-low);
}
function runsOf(mask:boolean[]):Run[] {
  const runs:Run[] = [];
  for (let i=0;i<mask.length;) {
    if (!mask[i]) {i++; continue;}
    let j = i;
    while (j < mask.length && mask[j]) j++;
    runs.push({start:i, steps:j-i});
    i = j;
  }
  return runs;
}

/** Film context for locating spans and cuts; absent for a lone video. */
export type FilmContext = {fps:number; shots:Shot[]};
/** Where a run of samples lies: seconds from the start, and in a film the film frames and shots it touches. */
export type Place = {startSecond:number; seconds:number; firstFrame:number|null; lastFrame:number|null; shots:string[]};
export type Excluded = Place & {kind:'black'|'end-card'};
export type LimitCheck = {metric:string; value:number; limit:number; direction:'min'|'max'; pass:boolean};
export type LivenessReport = {
  video:string; sha256:string; method:typeof METHOD;
  /** Seconds the longest-span rule uses: the film's duration, or the sampled length of a lone video. */
  durationSeconds:number;
  samples:number; noiseFloor:number;
  contentSeconds:number; excluded:Excluded[];
  /** Content basis; `movingShareWholeFilm` is the study's whole-film value. */
  movingShare:number; movingShareWholeFilm:number;
  stillShare:{over0_5:number; over1:number; over2:number};
  longestStillSeconds:number;
  /** Every content still span over 0.5 s. */
  stillSpans:Place[];
  advisory:{
    longestMotionRunSeconds:number;
    /** Per declared cut: whether at least 2 of the 3 steps on each side move (null when a side is outside the video). */
    cuts:{shot:string; frame:number; bothMove:boolean|null}[];
    cutsBothMoving:number|null; cutRate:number|null; onsetsPerSecond:number;
  };
  limits:LimitCheck[]; failures:string[]; pass:boolean;
};

/** Measures one video. `durationSeconds` defaults to the sampled length (samples / 12). */
export async function measureLiveness(tools:Tools, video:string, label:string, film:FilmContext|null, durationSeconds?:number):Promise<LivenessReport> {
  const {d,pixels,luma} = await sample(tools,video);
  const steps = d.length;
  if (steps < 1) throw new CliError(`${label}: too short to measure; liveness needs at least 2 samples at ${METHOD.sampleFps} fps`);
  const fps = METHOD.sampleFps;
  const {factor,percentile:q,min,max} = METHOD.noiseFloor;
  const floor = Math.min(max,Math.max(min,factor*percentile(d,q)));
  const moving = d.map((v,i) => v > floor || pixels[i] > METHOD.pixelShare);

  // Film frame of a sample; the 12 fps sample grid places it to within one sample.
  const frameOf = (s:number) => film ? Math.round(s*film.fps/fps) : null;
  const place = (run:Run):Place => {
    const firstFrame = frameOf(run.start), lastFrame = frameOf(run.start+run.steps);
    const shots = film && firstFrame !== null && lastFrame !== null ? film.shots.filter(s => s.startFrame <= lastFrame && s.endFrame > firstFrame).map(s => s.id) : [];
    return {startSecond:round3(run.start/fps), seconds:round3(run.steps/fps), firstFrame, lastFrame, shots};
  };

  // Content basis (D59): black still spans and one trailing end-card hold leave it. The study reads the luma of the
  // sample after the span's first one.
  const excluded:Excluded[] = [];
  const content:Run[] = [];
  let excludedSteps = 0;
  for (const run of runsOf(moving.map(m => !m))) {
    const black = luma[Math.min(run.start+1,steps)] < METHOD.blackLuma;
    const endCard = run.start+run.steps >= steps && run.steps/fps >= METHOD.endCardSeconds;
    if (black || endCard) {excluded.push({kind:black ? 'black' : 'end-card', ...place(run)}); excludedSteps += run.steps;}
    else content.push(run);
  }
  const contentSteps = steps-excludedSteps;
  const movingSteps = moving.filter(Boolean).length;
  const share = (seconds:number) => contentSteps ? content.filter(r => r.steps/fps > seconds).reduce((sum,r) => sum+r.steps,0)/contentSteps : 0;
  const longest = content.reduce((m,r) => Math.max(m,r.steps),0)/fps;
  const duration = durationSeconds ?? luma.length/fps;

  // Advisory metrics, as in the study: onsets are moving steps after at least 2 still steps.
  let still = Infinity, onsets = 0;
  for (const m of moving) {if (m && still >= 2) onsets++; still = m ? 0 : still+1;}
  const cuts = film ? film.shots.slice(1).filter(s => s.entry === 'cut').map(s => {
    const k = Math.round(s.startFrame/film.fps*fps);
    const before = moving.slice(Math.max(k-4,0),Math.max(k-1,0)), after = moving.slice(k+1,k+4);
    const count = (a:boolean[]) => a.filter(Boolean).length;
    return {shot:s.id, frame:s.startFrame, bothMove:before.length && after.length ? count(before) >= 2 && count(after) >= 2 : null};
  }) : [];
  const judged = cuts.filter(c => c.bothMove !== null);

  const values = {
    movingShare:round3(contentSteps ? movingSteps/contentSteps : 0),
    stillShare:{over0_5:round3(share(0.5)), over1:round3(share(1)), over2:round3(share(2))},
    longestStillSeconds:round3(longest),
  };
  const longLimit = duration >= LIMITS.longestStill.filmSeconds;
  const limitSeconds = longLimit ? LIMITS.longestStill.long : LIMITS.longestStill.short;
  const limits:LimitCheck[] = [
    {metric:'moving share', value:values.movingShare, limit:LIMITS.movingShare, direction:'min', pass:values.movingShare >= LIMITS.movingShare},
    {metric:'still over 0.5 s share', value:values.stillShare.over0_5, limit:LIMITS.stillOver0_5, direction:'max', pass:values.stillShare.over0_5 <= LIMITS.stillOver0_5},
    {metric:'still over 1 s share', value:values.stillShare.over1, limit:LIMITS.stillOver1, direction:'max', pass:values.stillShare.over1 <= LIMITS.stillOver1},
    {metric:'still over 2 s share', value:values.stillShare.over2, limit:LIMITS.stillOver2, direction:'max', pass:values.stillShare.over2 <= LIMITS.stillOver2},
    {metric:'longest still span', value:values.longestStillSeconds, limit:limitSeconds, direction:'max', pass:values.longestStillSeconds <= limitSeconds},
  ];
  const lengthRule = `film ${longLimit ? `${LIMITS.longestStill.filmSeconds} s or longer` : `under ${LIMITS.longestStill.filmSeconds} s`}`;
  const failures = limits.filter(l => !l.pass).map(l => l.metric === 'longest still span'
    ? `${l.metric} ${l.value} s is above the maximum ${l.limit} s (${lengthRule})`
    : `${l.metric} ${l.value} is ${l.direction === 'min' ? 'below the minimum' : 'above the maximum'} ${l.limit}`);
  const spanSteps = Math.round(0.5*fps);
  return {
    video:label, sha256:await sha256(video), method:METHOD,
    durationSeconds:round3(duration), samples:luma.length, noiseFloor:round3(floor),
    contentSeconds:round3(contentSteps/fps), excluded,
    movingShare:values.movingShare, movingShareWholeFilm:round3(movingSteps/steps),
    stillShare:values.stillShare, longestStillSeconds:values.longestStillSeconds,
    stillSpans:content.filter(r => r.steps > spanSteps).map(place),
    advisory:{
      longestMotionRunSeconds:round3(runsOf(moving).reduce((m,r) => Math.max(m,r.steps),0)/fps),
      cuts, cutsBothMoving:judged.length ? round3(judged.filter(c => c.bothMove).length/judged.length) : null,
      cutRate:film ? round3(cuts.length/duration) : null, onsetsPerSecond:round3(onsets/(steps/fps)),
    },
    limits, failures, pass:!failures.length,
  };
}

async function sha256(file:string):Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
const spanText = (p:Place) => p.firstFrame === null ? `at ${p.startSecond} s` : `at frames ${p.firstFrame}-${p.lastFrame} (shot ${p.shots.join(', ')})`;
/** One summary line and one line per located still span on stdout, one `error:` line per failed limit on stderr. */
export function printLiveness(name:string, output:string, r:LivenessReport) {
  const {movingShare:m, stillShare:s, longestStillSeconds:l} = r;
  console.log(`liveness ${name}: ${r.pass ? 'pass' : 'fail'}: moving ${m}, still over 0.5 s ${s.over0_5}, over 1 s ${s.over1}, over 2 s ${s.over2}, longest still ${l} s (${output})`);
  for (const e of r.excluded) console.log(`  excluded ${e.kind} ${e.seconds} s ${spanText(e)}`);
  for (const span of r.stillSpans) console.log(`  still ${span.seconds} s ${spanText(span)}`);
  for (const f of r.failures) console.error(`error: ${name}: ${f}`);
}

export const livenessFile = (out:Outputs) => join(out.dir,'liveness.json');

/** Film mode: measures the stitched master of each format and writes `liveness.json` beside it. Returns the number of failing formats. */
export async function livenessFilm(project:Project, formats:Format[], tools:Tools):Promise<number> {
  const {root, storyboard:{shots, meta}} = project;
  let failures = 0;
  for (const format of formats) {
    const out = outputsOf(root,format);
    try {await access(out.marker); await access(out.master);}
    catch {throw new CliError(`successful render and stitch required before liveness: ${format}`);}
    const report = await measureLiveness(tools,out.master,relative(root,out.master),{fps:meta.fps, shots},meta.durationFrames/meta.fps);
    const file = livenessFile(out);
    await writeFile(file,JSON.stringify({format,...report},null,2)+'\n');
    printLiveness(format,relative(root,file),report);
    if (!report.pass) failures++;
  }
  return failures;
}

/** Standalone mode: measures any video with no film context. Returns 1 when a limit fails. */
export async function livenessVideo(video:string, args:string[], tools:Tools):Promise<number> {
  if (args.length && (args.length !== 2 || args[0] !== '--report' || !args[1])) throw new CliError('usage: motion-studio liveness <video-file> [--report <file.json>]');
  const report = await measureLiveness(tools,video,video,null).catch(e => {
    if (e instanceof CliError) throw e;
    throw new CliError(`cannot read video ${video}`);
  });
  if (args[1]) await writeFile(args[1],JSON.stringify(report,null,2)+'\n');
  printLiveness(video,args[1] ?? 'no report file',report);
  return report.pass ? 0 : 1;
}

/** The liveness verdict of one format's master: pass, fail, or why no current report exists. */
export type Verdict = {format:Format; state:'pass'|'fail'|'missing'|'stale'|'no master'; detail:string};
export async function livenessVerdict(project:Project, format:Format):Promise<Verdict> {
  const out = outputsOf(project.root,format);
  const report = relative(project.root,livenessFile(out));
  const master = await sha256(out.master).catch(() => null);
  if (master === null) return {format, state:'no master', detail:`no ${relative(project.root,out.master)}`};
  let parsed:Partial<LivenessReport>;
  try {parsed = JSON.parse(await readFile(livenessFile(out),'utf8'));}
  catch {return {format, state:'missing', detail:`no readable ${report}`};}
  if (parsed.sha256 !== master) return {format, state:'stale', detail:`${report} describes another master`};
  if (parsed.pass !== true) return {format, state:'fail', detail:(parsed.failures ?? []).join('; ') || 'report does not pass'};
  return {format, state:'pass', detail:report};
}

/** status: one verdict line per chosen format that has a master or a report. */
export async function livenessLines(project:Project):Promise<string[]> {
  const lines:string[] = [];
  for (const format of chosenFormats(project.storyboard.meta)) {
    const out = outputsOf(project.root,format);
    const present = await Promise.all([out.master,livenessFile(out)].map(f => access(f).then(() => true,() => false)));
    if (!present.some(Boolean)) continue;
    const v = await livenessVerdict(project,format);
    lines.push(`liveness ${format} ${v.state} (${v.detail})`);
  }
  return lines;
}

/** D60: why G4 approval is refused, one entry per chosen format without a passing current report; empty when none. */
export async function livenessRefusals(project:Project):Promise<string[]> {
  const verdicts = await Promise.all(chosenFormats(project.storyboard.meta).map(f => livenessVerdict(project,f)));
  return verdicts.filter(v => v.state !== 'pass').map(v => `liveness ${v.format} ${v.state} (${v.detail})`);
}
