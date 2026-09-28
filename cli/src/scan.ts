import {access, mkdtemp, open, rm, stat, writeFile} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {join, relative} from 'node:path';
import {tmpdir} from 'node:os';
import {CliError, type Format, type Project, type Shot} from './project.js';
import {round3, type Tools} from './seam.js';
import type {Report} from './validate.js';
import type {Outputs} from './outputs.js';

// scan decodes every frame of one video once. Each frame is converted through its color tags to RGB and
// area-averaged onto a fixed GRID x GRID cell grid, whatever the format, so thresholds do not depend on the canvas
// size and single-pixel noise averages away. All values below run from 0 (same) to 1 (full scale).
const GRID = 64;
const CELL_BYTES = GRID*GRID*3;
// Calibrated on the 320x180 fixtures in test/scan.test.ts, built frame by frame with known defects. Lossless renders
// give exact duplicates; the STILL margin absorbs the rounding of a lossy standalone input.
export const THRESHOLDS = {
  /** A frame whose every cell is within this of the frame mean color is blank (black, white or one flat color). */
  blankSpread:0.02,
  /** A step whose worst cell changes less than this is a repeated frame. */
  still:0.004,
  /** A step whose worst cell changes more than this is motion. */
  moving:0.02,
  /** Pop: the worst cell changes at least this much into the frame and out of it again... */
  pop:0.1,
  /** ...while the frames on either side differ by at most this share of the mean change into and out of it. */
  popReturn:0.25,
  /** Flash fit: a 1-frame flash is a brightness change when a per-channel gain and offset of the frame before predicts
   * it. A mean residual more than this above the change between its neighbors (motion) makes it a wrong frame (a pop). */
  flashFit:0.02,
  /** Flash: the mean luma moves at least this much and returns within FLASH_FRAMES frames... */
  flash:0.15,
  /** ...to within this of the luma before the flash. */
  flashReturn:0.05,
  /** Color jump: a channel of the mean color steps at least this much and then stays... */
  colorJump:0.04,
  /** ...within this share of the jump over the next 3 frames. */
  colorStay:0.25,
  /** Hitch: one motion step is at least this many times the median of the two steps on each side. */
  hitch:2.5,
  /** Ghost: the frames on either side differ by at least this mean change... */
  ghostChange:0.03,
  /** ...and the middle frame is a blend of them with a residual of at most this share of that change. */
  ghostResidual:0.2,
};
const FLASH_FRAMES = 3;
const STUTTER_FRAMES = 2;
/** A blend weight outside this range is one side, not a double exposure. */
const GHOST_BLEND = [0.2,0.8];

export type FlagKind = 'blank'|'flat'|'frame-count'|'pop'|'cell-pop'|'stutter'|'hitch'|'flash'|'color-jump'|'ghost';
// Technical failures block; the other flags are evidence for the reviewer (SPEC `scan`).
const blocking:Record<FlagKind,boolean> = {'blank':true,'flat':false,'frame-count':true,'pop':true,'cell-pop':false,'stutter':false,'hitch':false,'flash':false,'color-jump':false,'ghost':false};
/** A flag is a defect, or it falls on declared context: a cut or handoff seam, a hold or an effect. */
type Status = {status:'defect'}|{status:'context'; context:string};
export type Flag = {kind:FlagKind; frame:number; frames:number; shot:string|null; localFrame:number|null; severity:'blocking'|'advisory'; measure:Record<string,number>}&Status;

type Frame = {mean:[number,number,number]; luma:number; spread:number};
/** `fit`: mean residual of the best per-channel gain and offset from the earlier frame to the later one. */
type Step = {mad:number; peak:number; fit:number};
/** `skips[i]` also holds the blend fit of frame i and the worst cell pop of frame i (0 when no cell pops). */
type Skip = {mad:number; peak:number; blend:number; residual:number; cellPop:number};
/** Per-frame and per-step measures; `steps[i]` compares frame i-1 with frame i, `skips[i]` frame i-1 with frame i+1. */
type Measures = {frames:Frame[]; steps:Step[]; skips:Skip[]};

function frameOf(cells:Buffer):Frame {
  const mean:[number,number,number] = [0,0,0];
  for (let i=0;i<cells.length;i++) mean[i%3] += cells[i];
  for (let c=0;c<3;c++) mean[c] /= GRID*GRID*255;
  let spread = 0;
  for (let i=0;i<cells.length;i++) spread = Math.max(spread,Math.abs(cells[i]/255-mean[i%3]));
  return {mean, luma:0.2126*mean[0]+0.7152*mean[1]+0.0722*mean[2], spread};
}
function diffOf(a:Buffer, b:Buffer):{mad:number; peak:number} {
  let sum = 0, peak = 0;
  for (let i=0;i<a.length;i+=3) {
    const d = Math.abs(a[i]-b[i])+Math.abs(a[i+1]-b[i+1])+Math.abs(a[i+2]-b[i+2]);
    sum += d;
    peak = Math.max(peak,d);
  }
  return {mad:sum/(a.length*255), peak:peak/(3*255)};
}
/** Fits b as gain*a + offset per channel (least squares) and returns the mean residual. */
function fitOf(a:Buffer, b:Buffer):number {
  let residual = 0;
  for (let c=0;c<3;c++) {
    let ma = 0, mb = 0, cov = 0, variance = 0;
    const count = a.length/3;
    for (let i=c;i<a.length;i+=3) {ma += a[i]; mb += b[i];}
    ma /= count; mb /= count;
    for (let i=c;i<a.length;i+=3) {cov += (a[i]-ma)*(b[i]-mb); variance += (a[i]-ma)**2;}
    const gain = variance ? cov/variance : 0;
    for (let i=c;i<a.length;i+=3) residual += Math.abs(b[i]-(mb+gain*(a[i]-ma)));
  }
  return residual/(a.length*255);
}
const stepOf = (a:Buffer, b:Buffer):Step => ({...diffOf(a,b), fit:fitOf(a,b)});
/** Cell pop: the worst change into and out of b over the cells that change at most `moving` from a to c (0 when none). */
function cellPopOf(a:Buffer, b:Buffer, c:Buffer):number {
  let worst = 0;
  for (let i=0;i<a.length;i+=3) {
    const d = (x:Buffer, y:Buffer) => (Math.abs(x[i]-y[i])+Math.abs(x[i+1]-y[i+1])+Math.abs(x[i+2]-y[i+2]))/(3*255);
    if (d(a,c) <= THRESHOLDS.moving) worst = Math.max(worst,Math.min(d(a,b),d(b,c)));
  }
  return worst;
}
/** Fits b as blend*a + (1-blend)*c and returns the weight and the mean residual. */
function blendOf(a:Buffer, b:Buffer, c:Buffer):{blend:number; residual:number} {
  let dot = 0, norm = 0;
  for (let i=0;i<a.length;i++) {dot += (b[i]-c[i])*(a[i]-c[i]); norm += (a[i]-c[i])**2;}
  const blend = norm ? dot/norm : 0;
  let residual = 0;
  for (let i=0;i<a.length;i++) residual += Math.abs(b[i]-(blend*a[i]+(1-blend)*c[i]));
  return {blend, residual:residual/(a.length*255)};
}

/** Decodes the video to the cell grid in a temp file and measures it three frames at a time. */
async function measure(tools:Tools, video:string):Promise<Measures> {
  const temp = await mkdtemp(join(tmpdir(),'motion-scan-'));
  try {
    const raw = join(temp,'cells.rgb');
    await tools.command('ffmpeg',['-hide_banner','-loglevel','error','-y','-i',video,'-map','0:v:0','-fps_mode','passthrough','-vf',`scale=${GRID}:${GRID}:flags=area,format=rgb24`,'-f','rawvideo',raw]);
    const count = Math.floor((await stat(raw)).size/CELL_BYTES);
    const none:Skip = {mad:0,peak:0,blend:0,residual:0,cellPop:0};
    const result:Measures = {frames:[], steps:[{mad:0,peak:0,fit:0}], skips:[none]};
    const file = await open(raw);
    try {
      const window:Buffer[] = [];
      for (let i=0;i<count;i++) {
        const cells = Buffer.alloc(CELL_BYTES);
        await file.read(cells,0,CELL_BYTES,i*CELL_BYTES);
        window.push(cells);
        if (window.length > 3) window.shift();
        result.frames.push(frameOf(cells));
        if (i > 0) result.steps.push(stepOf(window.at(-2)!,cells));
        if (i > 1) result.skips.push({...diffOf(window[0],cells),...blendOf(window[0],window[1],cells),cellPop:cellPopOf(window[0],window[1],cells)});
      }
    } finally {await file.close();}
    if (count > 1) result.skips.push(none);
    return result;
  } finally {await rm(temp,{recursive:true,force:true});}
}

type Found = {kind:FlagKind; frame:number; frames:number; measure:Record<string,number>};
/** Raw frame-difference findings, before declared context is applied. */
function detect({frames,steps,skips}:Measures):Found[] {
  const found:Found[] = [];
  const n = frames.length;
  const add = (kind:FlagKind, frame:number, length:number, measure:Record<string,number>) => found.push({kind,frame,frames:length,measure:Object.fromEntries(Object.entries(measure).map(([k,v]) => [k,round3(v)]))});
  const T = THRESHOLDS;
  // Frames already explained by a single-frame finding (blank, flash, pop, ghost). The steps into and out of such a
  // frame belong to that finding, so they do not also count as a stutter, hitch or color jump.
  const odd = new Set<number>();
  const touches = (first:number, last:number) => Array.from({length:last-first+1},(_,k) => first+k).some(f => odd.has(f));
  // Flat runs (D47). A run is a blank dropout when it appears suddenly: content on both sides and an abrupt step into
  // and out of it. A flat opening or ending, and a cut to or a fade from a flat color, are advisory `flat` runs;
  // scanVideo makes a run that covers a whole shot blank.
  for (let i=0;i<n;) {
    if (frames[i].spread > T.blankSpread) {i++; continue;}
    let j = i;
    while (j+1 < n && frames[j+1].spread <= T.blankSpread) j++;
    const sudden = i > 0 && j < n-1 && steps[i].peak >= T.pop && steps[j+1].peak >= T.pop;
    add(sudden ? 'blank' : 'flat',i,j-i+1,{spread:Math.max(...frames.slice(i,j+1).map(f => f.spread))});
    for (let k=i;k<=j;k++) odd.add(k);
    i = j+1;
  }
  // Flash: the mean luma leaves and returns to its level within FLASH_FRAMES frames.
  for (let i=1;i<n-1;i++) {
    const before = frames[i-1].luma;
    if (Math.abs(frames[i].luma-before) < T.flash || odd.has(i)) continue;
    for (let j=i;j<Math.min(i+FLASH_FRAMES,n-1);j++) {
      if (Math.abs(frames[j+1].luma-before) > T.flashReturn) continue;
      if (!touches(i,j)) {
        // One frame that no brightness change of the frame before explains is a wrong frame: a pop, not a flash.
        const wrong = i === j && steps[i].fit-skips[i].mad > T.flashFit;
        add(wrong ? 'pop' : 'flash',i,j-i+1,{luma:frames[i].luma-before, fit:steps[i].fit, neighbors:skips[i].mad});
        for (let k=i;k<=j;k++) odd.add(k);
      }
      i = j;
      break;
    }
  }
  for (let i=1;i<n-1;i++) {
    if (odd.has(i)) continue;
    // Pop: one frame differs from both neighbors, which match each other. Slow motion elsewhere in the frame still
    // lets the neighbors match closely; steady fast motion does not.
    const spike = Math.min(steps[i].peak,steps[i+1].peak);
    const change = Math.min(steps[i].mad,steps[i+1].mad);
    if (spike >= T.pop && skips[i].mad <= T.popReturn*change) {
      add('pop',i,1,{change:spike,neighbors:skips[i].mad/change});
      odd.add(i);
      continue;
    }
    // Ghost: one frame is a blend of two different neighbors (a double exposure).
    const {mad,blend,residual} = skips[i];
    if (mad >= T.ghostChange && blend >= GHOST_BLEND[0] && blend <= GHOST_BLEND[1] && residual <= T.ghostResidual*mad && steps[i].peak > T.moving && steps[i+1].peak > T.moving) {
      add('ghost',i,1,{blend,residual,change:mad});
      odd.add(i);
      continue;
    }
    // Cell pop: a local pop that the whole-frame test misses because the rest of the frame moves. Fast thin objects
    // can look the same, so it is advisory. Next to a blank, flat or flash frame the cell comparison means nothing.
    if (skips[i].cellPop >= T.pop && !touches(i-1,i+1)) {
      add('cell-pop',i,1,{change:skips[i].cellPop});
      odd.add(i);
    }
  }
  // Color jump: the mean color steps and stays at the new level. A flash returns, so it is not a jump.
  const jumps = new Set<number>();
  for (let i=1;i<n;i++) {
    const jump = Math.max(...[0,1,2].map(c => Math.abs(frames[i].mean[c]-frames[i-1].mean[c])));
    if (jump < T.colorJump || touches(i-1,i)) continue;
    const after = frames.slice(i+1,i+4);
    if (after.every(f => Math.max(...[0,1,2].map(c => Math.abs(f.mean[c]-frames[i].mean[c]))) <= T.colorStay*jump)) {
      add('color-jump',i,1,{jump});
      jumps.add(i);
    }
  }
  // Stutter: 1 or 2 repeated frames inside motion. A longer repeat is a hold.
  for (let i=2;i<n;i++) {
    if (steps[i].peak > T.still || steps[i-1].peak <= T.moving) continue;
    let r = 1;
    while (i+r < n && steps[i+r].peak <= T.still) r++;
    if (r <= STUTTER_FRAMES && i+r < n && steps[i+r].peak > T.moving && !touches(i-2,i+r)) add('stutter',i,r,{repeated:r});
    i += r;
  }
  // Hitch: one step much larger than the steady motion around it (skipped frames).
  for (let i=3;i<n-2;i++) {
    const around = [steps[i-2],steps[i-1],steps[i+1],steps[i+2]];
    if (around.some(s => s.peak <= T.moving) || touches(i-1,i) || jumps.has(i)) continue;
    const median = around.map(s => s.mad).sort((a,b) => a-b).slice(1,3).reduce((a,b) => a+b)/2;
    if (median > 0 && steps[i].mad >= T.hitch*median) add('hitch',i,1,{step:steps[i].mad,median});
  }
  return found.sort((a,b) => a.frame-b.frame || a.kind.localeCompare(b.kind));
}

/** Declared context of the film: seams (the first frame of every shot after the first), holds and effects. */
type Seam = {handoff:boolean; reason:string};
type Context = {shots:Shot[]; seams:Map<number,Seam>; holds:[number,number][]; effects:[number,number,string][]};
function contextOf(shots:Shot[]):Context {
  return {
    shots,
    seams:new Map(shots.slice(1).map(s => [s.startFrame,{handoff:s.entry === 'handoff', reason:`${s.entry === 'handoff' ? 'handoff seam' : 'declared cut'} into shot ${s.id}`}])),
    holds:shots.flatMap(s => (s.holds ?? []).map(h => [s.startFrame+h.start,s.startFrame+h.start+h.frames] as [number,number])),
    effects:shots.flatMap(s => (s.effects ?? []).map(e => [s.startFrame+e.start,s.startFrame+e.start+e.frames,`effect ${e.term} in shot ${s.id}`] as [number,number,string])),
  };
}
/** Why a finding is context, or null when it is a defect. Frame-count errors are never context. */
function explain(f:Found, {seams,holds,effects}:Context):string|null {
  if (f.kind === 'frame-count') return null;
  const first = f.frame, last = f.frame+f.frames-1;
  // A declared run explains a finding only when the finding lies inside it, so a fault that runs past it still shows.
  const inside = ([a,b]:[number,number]|[number,number,string]) => first >= a && last < b;
  const effect = effects.find(inside);
  if (effect) return effect[2];
  // Seams explain the step-based flags whose change crosses the seam. A pop needs matching neighbors, which a cut
  // never gives, so a pop at a seam is a wrong first or last frame. A cell pop needs only one matching cell, which a
  // cut can give by chance. Blank frames, flashes and blended frames are defects at a cut too: a clean cut has none.
  const crossing:Partial<Record<FlagKind,number[]>> = {'cell-pop':[first,first+1], 'color-jump':[first], hitch:[first], stutter:Array.from({length:f.frames+1},(_,k) => first+k)};
  const seam = (crossing[f.kind] ?? []).map(frame => seams.get(frame)).find(s => s !== undefined);
  // A repeated frame continues the motion at a handoff seam; at a cut it is a doubled frame.
  if (seam && (f.kind !== 'stutter' || seam.handoff)) return seam.reason;
  if ((f.kind === 'stutter' || f.kind === 'hitch') && holds.some(inside)) return 'declared hold';
  return null;
}

export type ScanInput = {video:string; label:string; fps:number; expectedFrames:number|null; shots:Shot[]};
export type ScanReport = {video:string; sha256:string; fps:number; grid:number; thresholds:typeof THRESHOLDS; frameCount:{expected:number|null; decoded:number}; flags:Flag[]; counts:{blocking:number; advisory:number; context:number}};

async function sha256(file:string):Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
/** Scans one video and returns the report. */
export async function scanVideo(input:ScanInput, tools:Tools):Promise<ScanReport> {
  const measures = await measure(tools,input.video);
  const decoded = measures.frames.length;
  const found = detect(measures);
  // A flat run that covers a whole shot means the engine rendered nothing there (D47). With no shots, the whole video.
  const spans = input.shots.length ? input.shots.map(s => [s.startFrame,s.endFrame]) : [[0,decoded]];
  for (const f of found) if (f.kind === 'flat' && spans.some(([a,b]) => f.frame <= a && f.frame+f.frames >= b)) f.kind = 'blank';
  if (input.expectedFrames !== null && decoded !== input.expectedFrames) found.unshift({kind:'frame-count',frame:Math.min(decoded,input.expectedFrames),frames:Math.abs(decoded-input.expectedFrames),measure:{expected:input.expectedFrames,decoded}});
  const context = contextOf(input.shots);
  const flags = found.map((f):Flag => {
    const shot = input.shots.find(s => f.frame >= s.startFrame && f.frame < s.endFrame) ?? input.shots.at(-1) ?? null;
    const why = explain(f,context);
    return {...f, shot:shot?.id ?? null, localFrame:shot ? f.frame-shot.startFrame : null, severity:blocking[f.kind] ? 'blocking' : 'advisory', ...(why === null ? {status:'defect'} : {status:'context', context:why})};
  });
  const defects = flags.filter(f => f.status === 'defect');
  return {video:input.label, sha256:await sha256(input.video), fps:input.fps, grid:GRID, thresholds:THRESHOLDS, frameCount:{expected:input.expectedFrames, decoded}, flags,
    counts:{blocking:defects.filter(f => f.severity === 'blocking').length, advisory:defects.filter(f => f.severity === 'advisory').length, context:flags.length-defects.length}};
}

const where = (f:Flag) => f.kind === 'frame-count' ? `expected ${f.measure.expected} frames, decoded ${f.measure.decoded}` : `at frame ${f.frame}${f.frames > 1 ? ` (${f.frames} frames)` : ''}${f.shot === null ? '' : ` (shot ${f.shot}, local frame ${f.localFrame})`}`;
/** Prints one summary line on stdout and one line per defect on stderr; returns the number of blocking flags. */
function print(name:string, output:string, report:ScanReport):number {
  const {blocking:b,advisory:a,context:c} = report.counts;
  console.log(`scan ${name}: ${b} blocking, ${a} advisory, ${c} context (${output})`);
  for (const f of report.flags.filter(f => f.status === 'defect' && f.severity === 'advisory')) console.error(`warning: ${name}: ${f.kind} ${where(f)}`);
  for (const f of report.flags.filter(f => f.status === 'defect' && f.severity === 'blocking')) console.error(`error: ${name}: ${f.kind} ${where(f)}`);
  return b;
}

/** Film mode: scans the master of each format and writes `scan.json` beside it. */
export async function scanFilm(project:Project, formats:Format[], outputsOf:(format:Format) => Outputs, tools:Tools):Promise<number> {
  const {root, storyboard:{shots, meta}} = project;
  let failures = 0;
  for (const format of formats) {
    const out = outputsOf(format);
    try {await access(out.marker); await access(out.master);}
    catch {throw new CliError(`successful render and stitch required before scan: ${format}`);}
    const report = await scanVideo({video:out.master, label:relative(root,out.master), fps:meta.fps, expectedFrames:meta.durationFrames, shots}, tools);
    const file = join(out.dir,'scan.json');
    await writeFile(file,JSON.stringify({format,...report},null,2)+'\n');
    failures += print(format,relative(root,file),report);
  }
  return failures;
}

/**
 * Standalone mode: scans any video file with no declared context. The frame rate comes from the stream; the expected
 * frame count is the stream's own frame count when the container records one.
 */
export async function scanFile(video:string, args:string[], tools:Tools):Promise<number> {
  if (args.length && (args.length !== 2 || args[0] !== '--report' || !args[1])) throw new CliError('usage: motion-studio scan <video-file> [--report <file.json>]');
  const probe = JSON.parse(await tools.command('ffprobe',['-v','error','-select_streams','v:0','-show_entries','stream=r_frame_rate,nb_frames','-of','json',video]).catch(() => {throw new CliError(`cannot read video ${video}`);}));
  const stream = probe.streams?.[0];
  if (!stream) throw new CliError(`no video stream in ${video}`);
  const [num,den] = String(stream.r_frame_rate).split('/').map(Number);
  const recorded = Number(stream.nb_frames);
  const report = await scanVideo({video, label:video, fps:round3(num/(den || 1)), expectedFrames:Number.isSafeInteger(recorded) && recorded > 0 ? recorded : null, shots:[]}, tools);
  if (args[1]) await writeFile(args[1],JSON.stringify(report,null,2)+'\n');
  return print(video,args[1] ?? 'no report file',report);
}

/** validate: holds and effects must lie inside their shot. */
export function checkScanContext({storyboard:{shots}}:Project):Report {
  const errors:string[] = [];
  for (const shot of shots) {
    const length = shot.endFrame-shot.startFrame;
    for (const [name,spans] of [['hold',shot.holds ?? []],['effect',shot.effects ?? []]] as const)
      for (const span of spans) if (span.start+span.frames > length) errors.push(`shot ${shot.id}: ${name} at local frame ${span.start} for ${span.frames} frames ends after the shot (shot-local frames 0 to ${length-1})`);
  }
  return {errors, warnings:[]};
}
