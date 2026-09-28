import {mkdtemp, readdir, readFile, rm, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {CliError, layoutOf, type Project, type Shot} from './project.js';
import {isHandoffOutput, requireMaster, round3, type Tools} from './seam.js';
import type {Outputs} from './outputs.js';

// A handoff compares shot A's last frame with shot B's first frame for identity, so the moving
// element must land on a still pose at the seam. One frame of motion (about 2 px at 320x180) already
// exceeds the structure limit.
//
// Normalization: every frame is decoded through its own color tags to RGB and area-averaged onto a
// fixed GRID x GRID cell grid, whatever the format. The grid hides sub-pixel rasterization
// differences between the two engines.
const GRID = 32;
// Two fixed thresholds for the A-last / B-first pair, each from 0 (same) to 1:
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
type Status = 'match'|'mismatch'|'encoded-color-jump';

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

/** The seams to check: an explicit adjacent pair, or every seam declared `exit: handoff`. */
function seams(shots:Shot[], pair:string[]):[Shot,Shot][] {
  if (pair.length) {
    const [from,to] = pair.map(id => shots.find(s => s.id === id));
    if (pair.length !== 2 || !from || !to) throw new CliError('usage: motion-studio handoff <film-dir> [<shot-a> <shot-b>]');
    if (from.endFrame !== to.startFrame) throw new CliError(`shot ${to.id} does not directly follow shot ${from.id}`);
    return [[from,to]];
  }
  const declared = shots.slice(0,-1).flatMap((shot,i):[Shot,Shot][] => shot.exit === 'handoff' ? [[shot,shots[i+1]]] : []);
  if (!declared.length) throw new CliError('no handoff seams declared (exit: handoff); name a pair: motion-studio handoff <film-dir> <shot-a> <shot-b>');
  return declared;
}

/**
 * Checks each seam of one format, writes `handoff-<a>-<b>.json` and `.png` per seam, prints one line per
 * passing seam and fails with one line per failing seam.
 */
export async function handoff(project:Project, out:Outputs, pair:string[], tools:Tools):Promise<void> {
  const {shots,meta:{fps}} = project.storyboard;
  const {width,height} = layoutOf(project.storyboard,out.format).canvas;
  const output = out.dir;
  const selected = seams(shots,pair);
  // Old reports must never survive a failed run: checking every seam clears every report.
  const stale = pair.length ? selected.map(([a,b]) => `handoff-${a.id}-${b.id}`).flatMap(n => [`${n}.json`,`${n}.png`]) : (await readdir(output).catch(() => [] as string[])).filter(isHandoffOutput);
  for (const file of stale) await rm(join(output,file),{force:true});
  const master = await requireMaster(project,out,tools);
  const size = width*height*3;
  const passed:string[] = [], failed:string[] = [];
  const temp = await mkdtemp(join(output,'.motion-handoff-'));
  try {
    for (const [from,to] of selected) {
      for (const shot of [from,to]) await tools.verify(out.clip(shot.id),shot.endFrame-shot.startFrame,fps,width,height);
      const cut = to.startFrame;
      const last = await decode(tools,out.clip(from.id),from.endFrame-from.startFrame-1,fps,size,join(temp,'last'));
      const first = await decode(tools,out.clip(to.id),0,fps,size,join(temp,'first'));
      const before = await decode(tools,master,cut-1,fps,size,join(temp,'before'));
      const after = await decode(tools,master,cut,fps,size,join(temp,'after'));
      const pairDifference = difference(last.cells,first.cells);
      const acrossCut = difference(before.cells,after.cells);
      // Stitch stream-copies lossless clips, so a master frame must equal its shot frame exactly.
      const identicalToShots = [before.raw.equals(last.raw),after.raw.equals(first.raw)];
      const status:Status = exceeds(pairDifference) ? 'mismatch' : identicalToShots.includes(false) || exceeds(acrossCut) ? 'encoded-color-jump' : 'match';
      const name = `handoff-${from.id}-${to.id}`;
      // The strip image lets the creator inspect the two master frames at the cut.
      await tools.command('ffmpeg',['-hide_banner','-loglevel','error','-y','-ss',String((cut-1.25 > 0 ? cut-1.25 : 0)/fps),'-i',master,'-vf','tile=2x1','-frames:v','1',join(output,`${name}.png`)]);
      await writeFile(join(output,`${name}.json`),JSON.stringify({from:from.id,to:to.id,cutFrame:cut,declared:from.exit === 'handoff',thresholds:THRESHOLDS,pair:pairDifference,strip:{frames:[cut-1,cut],acrossCut,identicalToShots},status},null,2)+'\n');
      if (status === 'match') passed.push(`handoff verified ${from.id} -> ${to.id} (${out.format}): ${describe(pairDifference)}`);
      else if (status === 'mismatch') failed.push(`handoff mismatch ${from.id} -> ${to.id} (${out.format}): ${describe(pairDifference)}`);
      else failed.push(`encoded color jump in master strip at frame ${cut} (${out.format}): ${identicalToShots.includes(false) ? `master frames ${cut-1}, ${cut} identical to shot frames: ${identicalToShots.join(', ')}` : describe(acrossCut)}`);
    }
  } finally {await rm(temp,{recursive:true,force:true});}
  for (const line of passed) console.log(line);
  if (failed.length) throw new CliError(failed.join('\nerror: '));
}
