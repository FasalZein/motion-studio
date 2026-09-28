import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {requireMaster, round3, type Timeline, type Tools} from './seam.js';

// Normalization: every frame is decoded through its own color tags to RGB and
// area-averaged onto a fixed GRID x GRID cell grid, whatever the format. The
// grid hides sub-pixel rasterization differences between the two engines.
const GRID = 32;
// Two fixed thresholds, each from 0 (same) to 1:
// - structure: the worst cell's mean absolute RGB difference. Measured on the
//   fixtures: matching two-engine handoff 0.077 (text rasterization), one-digit
//   text change 0.184, text cut 0.272, 12 px slide 0.316.
// - color: the largest per-channel difference of the whole-frame mean color.
//   Measured on the matching handoff: 0.0067. A shift of 5 of 255 levels is 0.0196.
export const THRESHOLDS = {structure:0.15, color:0.02};
type Difference = {structure:number; color:number};

type Status = 'match'|'mismatch'|'encoded-color-jump';

async function cells(tools:Tools, file:string, index:number, out:string):Promise<Buffer> {
  await tools.command('ffmpeg',['-hide_banner','-loglevel','error','-y','-i',file,'-vf',`select=eq(n\\,${index}),scale=${GRID}:${GRID}:flags=area,format=rgb24`,'-fps_mode','passthrough','-frames:v','1','-f','rawvideo',out]);
  const data = await readFile(out);
  if (data.length !== GRID*GRID*3) throw Error(`cannot decode frame ${index} of ${file}`);
  return data;
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

/** Checks the handoff from shot `fromId` to the directly following shot `toId`; writes a report and a strip image. */
export async function handoff(timeline:Timeline, output:string, fromId:string|undefined, toId:string|undefined, tools:Tools):Promise<string> {
  const from = timeline.shots.find(s => s.id === fromId);
  const to = timeline.shots.find(s => s.id === toId);
  if (!from || !to) throw Error('usage: motion-studio handoff <project.json> <shot-a> <shot-b>');
  if (from.end !== to.start) throw Error(`shot ${to.id} does not directly follow shot ${from.id}`);
  const master = await requireMaster(timeline,output,tools);
  for (const shot of [from,to]) await tools.verify(join(output,`${shot.id}.mkv`),shot.end-shot.start,timeline.fps,timeline.width,timeline.height);
  const cut = to.start;
  const temp = await mkdtemp(join(output,'.motion-handoff-'));
  try {
    const last = await cells(tools,join(output,`${from.id}.mkv`),from.end-from.start-1,join(temp,'last.rgb'));
    const first = await cells(tools,join(output,`${to.id}.mkv`),0,join(temp,'first.rgb'));
    const before = await cells(tools,master,cut-1,join(temp,'before.rgb'));
    const after = await cells(tools,master,cut,join(temp,'after.rgb'));
    const pair = difference(last,first);
    const strip = difference(before,after);
    const deviation = [difference(before,last),difference(after,first)];
    const jump = [strip,...deviation].find(exceeds);
    const status:Status = exceeds(pair) ? 'mismatch' : jump ? 'encoded-color-jump' : 'match';
    const name = `handoff-${from.id}-${to.id}`;
    // The strip image lets the creator inspect the two master frames at the cut.
    await tools.command('ffmpeg',['-hide_banner','-loglevel','error','-y','-i',master,'-vf',`select=between(n\\,${cut-1}\\,${cut}),tile=2x1`,'-fps_mode','passthrough','-frames:v','1',join(output,`${name}.png`)]);
    await writeFile(join(output,`${name}.json`),JSON.stringify({from:from.id,to:to.id,cutFrame:cut,thresholds:THRESHOLDS,pair,strip:{frames:[cut-1,cut],acrossCut:strip,deviationFromShots:deviation},status},null,2)+'\n');
    if (status === 'mismatch') throw Error(`handoff mismatch ${from.id} -> ${to.id}: ${describe(pair)}`);
    if (jump) throw Error(`encoded color jump in master strip at frame ${cut}: ${describe(jump)}`);
    return `handoff verified ${from.id} -> ${to.id}: ${describe(pair)}`;
  } finally {await rm(temp,{recursive:true,force:true});}
}
