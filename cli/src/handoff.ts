import {mkdir, mkdtemp, readdir, readFile, rm, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {CliError, layoutOf, type Format, type Project, type Shot} from './project.js';
import {isHandoffOutput, requireMaster, round3, type Tools} from './seam.js';
import type {Outputs} from './outputs.js';
import {remotionBundle, renderHyperframesFrames, renderRemotionNextFrame} from './engines.js';
import {requireOpaque} from './opaque.js';

// A handoff lets motion continue through the seam (D63). It compares shot B's first frame with the frame shot A
// would show next: A rendered one frame past its end, in A's engine, at the format's layout inputs. That frame
// equals B's first frame only when both pose and velocity carry across the seam; an element that stops at the seam
// (B starts at A's last pose while A still moves) fails.
//
// Normalization: every frame is decoded through its own color tags to RGB and area-averaged onto a
// fixed GRID x GRID cell grid, whatever the format. The grid hides sub-pixel rasterization
// differences between the two engines.
const GRID = 32;
// Two fixed thresholds for the A-next / B-first pair, each from 0 (same) to 1:
// - structure: the worst cell's mean absolute RGB difference. Measured on the 320x180 fixtures:
//   matching two-engine handoff 0.077 (text rasterization), one-digit text change 0.184,
//   text cut 0.272, 12 px slide 0.316.
// - color: the largest per-channel difference of the whole-frame mean color. Measured on the
//   matching handoff: 0.0067. A shift of 5 of 255 levels is 0.0196.
// Calibrated on one 320x180 fixture only. Recalibrate when new formats (#9), small text or thin
// lines produce false results.
export const THRESHOLDS = {structure:0.15, color:0.02};
type Difference = {structure:number; color:number};
type Frame = {cells:Buffer; raw:Buffer};
type Status = 'match'|'mismatch'|'encoded-color-jump'|'duration-dependent';

/** Decodes frame `index` once: the normalized cell grid and the full frame in its stored yuv444p form. */
async function decode(tools:Tools, file:string, index:number, fps:number, size:number, out:string):Promise<Frame> {
  // Every FFV1 frame is intra, so an input seek is exact. The quarter-frame margin absorbs
  // Matroska's millisecond timestamp rounding.
  const seek = index > 0 ? ['-ss',String((index-0.25)/fps)] : [];
  await tools.command('ffmpeg',['-hide_banner','-loglevel','error','-y',...seek,'-i',file,'-filter_complex',`[0:v]split[g][r];[g]scale=${GRID}:${GRID}:flags=area,format=rgb24[c]`,
    '-map','[c]','-frames:v','1','-f','rawvideo',`${out}.rgb`,'-map','[r]','-frames:v','1','-f','rawvideo','-pix_fmt','yuv444p',`${out}.yuv`]);
  const frame = {cells:await readFile(`${out}.rgb`), raw:await readFile(`${out}.yuv`)};
  if (frame.cells.length !== GRID*GRID*3 || frame.raw.length !== size) throw new CliError(`cannot decode frame ${index} of ${file}`);
  return frame;
}
function difference(a:Buffer, b:Buffer):Difference {
  let structure = 0;
  const mean = [0,0,0];
  for (let i=0;i<a.length;i+=3) {
    structure = Math.max(structure,(Math.abs(a[i]-b[i])+Math.abs(a[i+1]-b[i+1])+Math.abs(a[i+2]-b[i+2]))/(3*255));
    for (let c=0;c<3;c++) mean[c] += a[i+c]-b[i+c];
  }
  return {structure:round3(structure),color:round3(Math.max(...mean.map(m => Math.abs(m)/(GRID*GRID*255))))};
}
const exceeds = (d:Difference) => d.structure > THRESHOLDS.structure || d.color > THRESHOLDS.color;
const describe = (d:Difference) => `structure ${d.structure}, color ${d.color} (limits ${THRESHOLDS.structure}, ${THRESHOLDS.color})`;

/**
 * The seams to check: an explicit adjacent pair, which must be a declared handoff, or every seam declared
 * `exit: handoff` (none is a valid answer).
 */
export function handoffSeams(shots:Shot[], pair:string[]):[Shot,Shot][] {
  if (pair.length) {
    const [from,to] = pair.map(id => shots.find(s => s.id === id));
    if (pair.length !== 2 || !from || !to) throw new CliError('usage: motion-studio handoff <film-dir> [<shot-a> <shot-b>]');
    if (from.endFrame !== to.startFrame) throw new CliError(`shot ${to.id} does not directly follow shot ${from.id}`);
    if (from.exit !== 'handoff') throw new CliError(`seam ${from.id} -> ${to.id} is a declared cut, not a handoff; handoff checks only seams declared exit: handoff`);
    return [[from,to]];
  }
  return shots.slice(0,-1).flatMap((shot,i):[Shot,Shot][] => shot.exit === 'handoff' ? [[shot,shots[i+1]]] : []);
}

/**
 * Renders the frame `shot` would show next (one frame past its end) in its own engine and format, plus its last frame
 * from the same one-frame-longer render, and stores each as a one-frame clip encoded exactly like a shot clip, so they
 * decode through the same color path as the clip frames they are compared with. Remotion bundles are cached in
 * `bundles` across formats.
 */
async function renderNextFrame(project:Project, shot:Shot, format:Format, output:{next:string; last:string}, scratch:string, tools:Tools, bundles:Map<string,Promise<{serveUrl:string; dispose:() => Promise<void>}>>) {
  const dir = await mkdtemp(join(scratch,'next-'));
  const length = shot.endFrame-shot.startFrame;
  let png = join(dir,'next.png'), lastPng = join(dir,'last.png');
  if (shot.engine === 'remotion') {
    if (!bundles.has(shot.id)) bundles.set(shot.id,remotionBundle(project,shot,false));
    await renderRemotionNextFrame(project,shot,(await bundles.get(shot.id)!).serveUrl,format,png,lastPng);
  } else {
    const framesDir = join(dir,'frames');
    await mkdir(framesDir);
    await renderHyperframesFrames(project,shot,tools,{format,framesDir,pastEnd:true});
    const pngs = (await readdir(framesDir)).filter(f => f.endsWith('.png')).sort();
    if (pngs.length !== length+1) throw new CliError(`rendered frame count mismatch: ${shot.id} one frame past its end got ${pngs.length} frames, expected ${length+1}`);
    png = join(framesDir,pngs[length]);
    lastPng = join(framesDir,pngs[length-1]);
  }
  await requireOpaque(tools,shot,format,[{frame:length, png},{frame:length-1, png:lastPng}],dir);
  for (const [file,clip] of [[png,output.next],[lastPng,output.last]]) {
    await tools.command('ffmpeg',['-hide_banner','-loglevel','error','-y','-i',file,'-frames:v','1','-an','-vf','setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709','-c:v','ffv1','-level','3','-pix_fmt','yuv444p','-colorspace','bt709','-color_trc','bt709','-color_primaries','bt709',clip]);
  }
}

/**
 * `handoff <film-dir> [<shot-a> <shot-b>] [format]` over the selected formats. Returns the lines to print; throws one
 * error listing every failing seam of every format. A film without handoff seams needs no check and no render.
 */
export async function handoffFilm(project:Project, outs:Outputs[], pair:string[], tools:Tools):Promise<string[]> {
  const selected = handoffSeams(project.storyboard.shots,pair);
  if (!selected.length) return ['no handoff seams; nothing to check'];
  const bundles = new Map<string,Promise<{serveUrl:string; dispose:() => Promise<void>}>>();
  const lines:string[] = [], failures:string[] = [];
  try {
    // Each format renders at its own canvas, so a seam can pass in one format and fail in another: check every format.
    for (const out of outs) {
      try {lines.push(...await handoff(project,out,selected,pair.length > 0,tools,bundles));}
      catch (e) {if (!(e instanceof CliError)) throw e; failures.push(e.message);}
    }
  } finally {for (const bundle of bundles.values()) await bundle.then(b => b.dispose(),() => {});}
  if (failures.length) {
    for (const line of lines) console.log(line);
    throw new CliError(failures.join('\nerror: '));
  }
  return lines;
}

/**
 * Checks each seam of one format, writes `handoff-<a>-<b>.json` and `.png` per seam, returns one line per
 * passing seam and fails with one line per failing seam.
 */
async function handoff(project:Project, out:Outputs, selected:[Shot,Shot][], named:boolean, tools:Tools, bundles:Map<string,Promise<{serveUrl:string; dispose:() => Promise<void>}>>):Promise<string[]> {
  const {meta:{fps}} = project.storyboard;
  const {width,height} = layoutOf(project.storyboard,out.format).canvas;
  const output = out.dir;
  // Old reports must never survive a failed run: checking every seam clears every report.
  const stale = named ? selected.map(([a,b]) => `handoff-${a.id}-${b.id}`).flatMap(n => [`${n}.json`,`${n}.png`]) : (await readdir(output).catch(() => [] as string[])).filter(isHandoffOutput);
  for (const file of stale) await rm(join(output,file),{force:true});
  const master = await requireMaster(project,out,tools);
  const size = width*height*3;
  const passed:string[] = [], failed:string[] = [];
  const temp = await mkdtemp(join(output,'.motion-handoff-'));
  try {
    for (const [from,to] of selected) {
      for (const shot of [from,to]) await tools.verify(out.clip(shot.id),shot.endFrame-shot.startFrame,fps,width,height);
      const cut = to.startFrame;
      const clips = {next:join(temp,'next.mkv'), last:join(temp,'longer-last.mkv')};
      await renderNextFrame(project,from,out.format,clips,temp,tools,bundles);
      const next = await decode(tools,clips.next,0,fps,size,join(temp,'next'));
      const last = await decode(tools,out.clip(from.id),from.endFrame-from.startFrame-1,fps,size,join(temp,'last'));
      // The render one frame longer must repeat A's last clip frame exactly. When it does not, A's motion depends on its
      // own duration (for example interpolate over [0, durationInFrames]), so the frame past its end is not what A would
      // show next and the pair comparison would be meaningless.
      const longerLast = await decode(tools,clips.last,0,fps,size,join(temp,'longer-last'));
      const durationIndependent = longerLast.raw.equals(last.raw);
      const first = await decode(tools,out.clip(to.id),0,fps,size,join(temp,'first'));
      const before = await decode(tools,master,cut-1,fps,size,join(temp,'before'));
      const after = await decode(tools,master,cut,fps,size,join(temp,'after'));
      const pairDifference = difference(next.cells,first.cells);
      // The pair limits also apply across the cut in the master. Motion continues through the seam, so the master frame
      // at the cut is held against A's next frame, not against the master frame before it.
      const nextVsMasterAtCut = difference(next.cells,after.cells);
      // Stitch stream-copies lossless clips, so a master frame must equal its shot frame exactly.
      const identicalToShots = [before.raw.equals(last.raw),after.raw.equals(first.raw)];
      const status:Status = !durationIndependent ? 'duration-dependent' : exceeds(pairDifference) ? 'mismatch' : identicalToShots.includes(false) || exceeds(nextVsMasterAtCut) ? 'encoded-color-jump' : 'match';
      const name = `handoff-${from.id}-${to.id}`;
      // The strip image lets the creator inspect the two master frames at the cut.
      await tools.command('ffmpeg',['-hide_banner','-loglevel','error','-y','-ss',String((cut-1.25 > 0 ? cut-1.25 : 0)/fps),'-i',master,'-vf','tile=2x1','-frames:v','1',join(output,`${name}.png`)]);
      await writeFile(join(output,`${name}.json`),JSON.stringify({from:from.id,to:to.id,cutFrame:cut,thresholds:THRESHOLDS,pair:{frames:{from:from.endFrame-from.startFrame,to:0},...pairDifference},durationIndependent,strip:{masterFrames:[cut-1,cut],identicalToShots,nextVsMasterAtCut},status},null,2)+'\n');
      if (status === 'match') passed.push(`handoff verified ${from.id} -> ${to.id} (${out.format}): ${describe(pairDifference)}`);
      else if (status === 'duration-dependent') failed.push(`handoff ${from.id} -> ${to.id} (${out.format}): shot ${from.id} renders a different last frame when it is one frame longer, so its motion depends on its duration (for example interpolate over durationInFrames); drive it from the frame number so the frame past its end is what it would show next`);
      else if (status === 'mismatch') failed.push(`handoff mismatch ${from.id} -> ${to.id} (${out.format}): ${describe(pairDifference)}`);
      else failed.push(`encoded color jump in master strip at frame ${cut} (${out.format}): ${identicalToShots.includes(false) ? `master frames ${cut-1}, ${cut} identical to shot frames: ${identicalToShots.join(', ')}` : describe(nextVsMasterAtCut)}`);
    }
  } finally {await rm(temp,{recursive:true,force:true});}
  if (failed.length) {
    for (const line of passed) console.log(line);
    throw new CliError(failed.join('\nerror: '));
  }
  return passed;
}
