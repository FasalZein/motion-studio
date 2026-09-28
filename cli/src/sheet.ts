import {mkdtemp, readdir, rename, rm, writeFile} from 'node:fs/promises';
import {join} from 'node:path';

import {layoutOf, type Project} from './project.js';
import {requireMaster, type Tools} from './seam.js';
import type {Outputs} from './outputs.js';

// Tile layout of the evidence packet (motion-critique evidence-packet.md): 5x5 contact pages, 11-frame strips.
const COLUMNS = 5, ROWS = 5, TILE_MAX_WIDTH = 320, GAP = 4;
// A transition strip shows the cut frame and this many frames on each side, clamped to the film.
const STRIP_SIDE = 5;

/** Tile size and filters shared by every sheet: tiles at most 320 pixels wide, 4-pixel margin and padding. */
export function tiling(width:number, height:number) {
  const tileWidth = Math.min(TILE_MAX_WIDTH,width);
  // Even tile height, the nearest to the canvas aspect.
  const tileHeight = 2*Math.round(tileWidth*height/width/2);
  return {tileWidth, tileHeight, scale:`scale=${tileWidth}:${tileHeight}:flags=lanczos`};
}
export const tile = (columns:number, rows:number) => `tile=${columns}x${rows}:margin=${GAP}:padding=${GAP}`;
export const SHEET_COLUMNS = COLUMNS;

const sheetFile = (file:string) => /^contact-sheet-\d{3}\.png$/.test(file) || /^transition-.+\.png$/.test(file) || file === 'sheet.json';
/** Removes every sheet output of a format, so a new render, stitch or sheet run leaves no stale page or strip. */
export async function clearSheetOutputs(dir:string) {
  for (const file of await readdir(dir).catch(() => [] as string[])) if (sheetFile(file)) await rm(join(dir,file),{force:true});
}

/**
 * `sheet <film-dir> [format]`: from the stitched master of a format, writes contact pages at one frame per second
 * (`contact-sheet-001.png`, ... ; frames 0, fps, 2*fps, ...; 5x5 tiles left to right, then top to bottom), one
 * full-frame-rate transition strip per seam (`transition-<a>-<b>.png`: the cut frame, the first frame of shot b,
 * in the middle of up to 5 frames on each side) and `sheet.json`, the index map of every tile's global frame.
 */
export async function sheet(project:Project, out:Outputs, tools:Tools):Promise<string> {
  const {storyboard:{shots,meta:{fps,durationFrames}}} = project;
  const master = await requireMaster(project,out,tools);
  await clearSheetOutputs(out.dir);
  const {width,height} = layoutOf(project.storyboard,out.format).canvas;
  const {tileWidth,tileHeight,scale} = tiling(width,height);
  const samples = Array.from({length:Math.ceil(durationFrames/fps)},(_,k) => k*fps);
  const pages = Array.from({length:Math.ceil(samples.length/(COLUMNS*ROWS))},(_,p) => ({file:`contact-sheet-${String(p+1).padStart(3,'0')}.png`, frames:samples.slice(p*COLUMNS*ROWS,(p+1)*COLUMNS*ROWS)}));
  const strips = shots.slice(1).map((b,i) => {
    const cut = b.startFrame;
    const first = Math.max(0,cut-STRIP_SIDE), last = Math.min(durationFrames-1,cut+STRIP_SIDE);
    return {file:`transition-${shots[i].id}-${b.id}.png`, shots:[shots[i].id,b.id], cut, frames:Array.from({length:last-first+1},(_,k) => first+k)};
  });
  const staging = await mkdtemp(join(out.dir,'.motion-sheet-'));
  try {
    const ffmpeg = (filter:string, output:string, frames?:number) => tools.command('ffmpeg',['-hide_banner','-loglevel','error','-nostdin','-y','-i',master,'-vf',filter,'-fps_mode','passthrough',...(frames ? ['-frames:v',String(frames)] : []),'-pix_fmt','rgb24',join(staging,output)]);
    // Exact frame indices, not the fps filter: a sample is the frame whose index is a whole second.
    await ffmpeg(`select='not(mod(n\\,${fps}))',${scale},${tile(COLUMNS,ROWS)}`,'contact-sheet-%03d.png');
    for (const strip of strips) await ffmpeg(`select='between(n\\,${strip.frames[0]}\\,${strip.frames.at(-1)})',${scale},${tile(strip.frames.length,1)}`,strip.file,1);
    const written = (await readdir(staging)).sort();
    const expected = [...pages.map(p => p.file),...strips.map(s => s.file)].sort();
    if (written.join() !== expected.join()) throw Error(`sheet wrote ${written.join(', ')}, expected ${expected.join(', ')}`);
    await writeFile(join(staging,'sheet.json'),JSON.stringify({format:out.format, fps, durationFrames, source:'master.mkv',
      tile:{width:tileWidth, height:tileHeight, margin:GAP, padding:GAP, order:'left to right, then top to bottom'},
      contact:{columns:COLUMNS, rows:ROWS, pages}, strips},null,2)+'\n');
    for (const file of await readdir(staging)) await rename(join(staging,file),join(out.dir,file));
  } finally {await rm(staging,{recursive:true,force:true});}
  return `sheet ${out.format}: ${pages.length} contact page${pages.length === 1 ? '' : 's'} (${samples.length} frames at 1 per second), ${strips.length} transition strip${strips.length === 1 ? '' : 's'}`;
}
