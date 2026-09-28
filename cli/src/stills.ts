import {mkdir, mkdtemp, readdir, rename, rm, writeFile} from 'node:fs/promises';
import {join} from 'node:path';

import {chosenFormats, CliError, formatDir, layoutOf, type Format, type Project, type Shot} from './project.js';
import {framePngs, remotionBundle, renderHyperframesFrames, renderRemotionStills} from './engines.js';
import type {Tools} from './seam.js';
import {SHEET_COLUMNS, tile, tiling} from './sheet.js';
import {requireOpaque} from './opaque.js';

/** Board stills live where G2 hashes and freezes them: `stills/G2/<format>/<shot-id>-f<frame>.png` (D43). */
export const boardStillsDir = (root:string, format:Format) => join(root,'stills','G2',formatDir(format));
/** File name of one board still; the frame is shot-local and zero-padded to 3 digits, for example `s01-f059.png`. */
export const boardStillName = (shotId:string, frame:number) => `${shotId}-f${String(frame).padStart(3,'0')}.png`;
const boardStillPattern = /^(.+)-f(\d{3,})\.png$/;
/** Parses a board still file name back to its shot id and shot-local frame; null for any other file. */
export function parseBoardStill(file:string):{shotId:string; frame:number}|null {
  const match = boardStillPattern.exec(file);
  return match ? {shotId:match[1], frame:Number(match[2])} : null;
}

function checkFrames(shot:Shot, frames:number[]) {
  const length = shot.endFrame-shot.startFrame;
  for (const frame of frames) if (!Number.isInteger(frame) || frame < 0 || frame >= length) throw new CliError(`still frame ${frame} is outside shot ${shot.id} (shot-local frames 0 to ${length-1})`);
}

/**
 * Captures shot-local frames of one shot in one format as RGB PNG files, one per `{frame, output}`.
 * Remotion renders only the requested frames (`renderStill`). HyperFrames 0.8.81 has no frame-range render, and its
 * `snapshot` command takes neither the composition file nor `--variables`, so it cannot receive the format's layout
 * inputs. The shot is therefore rendered once to PNG frames (no video encode or clip check) and the requested frames
 * are kept; revisit when HyperFrames renders a frame range or snapshots with variables.
 * Every still goes through the same RGBA-to-RGB conversion as a clip frame, so a still equals the clip frame.
 */
export async function captureStills(project:Project, shot:Shot, format:Format, requests:{frame:number; output:string}[], tools:Tools) {
  checkFrames(shot,requests.map(r => r.frame));
  const {width,height} = layoutOf(project.storyboard,format).canvas;
  // Inside the film, not the OS temp folder: the final rename must stay on one file system (a tmpfs /tmp or an
  // external film drive would fail with EXDEV). Hidden folders are never gate inputs.
  const temp = await mkdtemp(join(project.root,'.motion-still-'));
  try {
    const raw = requests.map((r,i) => ({...r, raw:join(temp,`raw-${i}.png`)}));
    if (shot.engine === 'remotion') {
      const {serveUrl,dispose} = await remotionBundle(project,shot,false);
      try {await renderRemotionStills(project,shot,serveUrl,format,raw.map(r => ({frame:r.frame, output:r.raw})));}
      finally {await dispose();}
    } else {
      const framesDir = join(temp,'frames');
      await mkdir(framesDir);
      await renderHyperframesFrames(project,shot,tools,{format,framesDir});
      const pngs = await framePngs(shot,framesDir);
      for (const r of raw) await rename(pngs[r.frame],r.raw);
    }
    await requireOpaque(tools,shot,format,raw.map(r => ({frame:r.frame, png:r.raw})),temp);
    for (const [i,r] of raw.entries()) {
      const staged = join(temp,`rgb-${i}.png`);
      // rgb24 drops alpha the same way the clip encoder does, so a still shows what the clip shows.
      await tools.command('ffmpeg',['-hide_banner','-loglevel','error','-y','-i',r.raw,'-frames:v','1','-pix_fmt','rgb24',staged]);
      const size = JSON.parse(await tools.command('ffprobe',['-v','error','-select_streams','v:0','-show_entries','stream=width,height','-of','json',staged])).streams?.[0];
      if (size?.width !== width || size?.height !== height) throw new CliError(`still size mismatch: ${shot.id} frame ${r.frame} ${format} is ${size?.width}x${size?.height}, expected ${width}x${height}`);
      r.raw = staged;
    }
    for (const r of raw) {
      await mkdir(join(r.output,'..'),{recursive:true});
      await rename(r.raw,r.output);
    }
  } finally {await rm(temp,{recursive:true,force:true});}
}

/** Parses `stills` arguments after the film folder: shot ids, `--frames <n,...>` and `--format <format>`. */
export function stillsArgs(args:string[]):{ids:string[]; frames:number[]|undefined; named:string|undefined} {
  const ids:string[] = [];
  let frames:number[]|undefined, named:string|undefined;
  for (let i=0;i<args.length;i++) {
    if (args[i] === '--frames' || args[i] === '--format') {
      const value = args[++i];
      if (!value) throw new CliError(`${args[i-1]} needs a value`);
      if (args[i-1] === '--format') named = value;
      else frames = value.split(',').map(v => /^\d+$/.test(v) ? Number(v) : NaN);
    } else ids.push(args[i]);
  }
  if (frames?.some(f => Number.isNaN(f))) throw new CliError('--frames takes comma-separated shot-local frame numbers, for example 0,12,59');
  return {ids,frames,named};
}

/**
 * `stills <film-dir> [<shot-id>...] [--frames <n,...>] [--format <format>]`: renders board stills into `stills/G2/`.
 * Without shot ids it renders every shot; without `--frames` it renders each shot's `stillFrames`; without
 * `--format` it renders every chosen format. A shot's earlier board stills in that format are replaced, and a run
 * over every shot also removes stills of shots no longer in the storyboard, so G2 never hashes a stale still.
 */
export async function boardStills(project:Project, args:string[], tools:Tools):Promise<string[]> {
  const {shots} = project.storyboard;
  const {ids,frames,named} = stillsArgs(args);
  const selected = ids.length ? ids.map(id => shots.find(s => s.id === id) ?? (() => {throw new CliError(`unknown shot ${id}`);})()) : shots;
  const formats = chosenFormats(project.storyboard.meta);
  if (named !== undefined && !(formats as string[]).includes(named)) throw new CliError(`format ${named} is not a chosen format (${formats.join(', ')})`);
  const plan = selected.map(shot => ({shot, frames:[...new Set(frames ?? shot.stillFrames)].sort((a,b) => a-b)}));
  for (const {shot,frames:f} of plan) {
    if (!f.length) throw new CliError(`shot ${shot.id} has no stillFrames; add them to storyboard.json or pass --frames`);
    checkFrames(shot,f);
  }
  const lines:string[] = [];
  for (const format of named === undefined ? formats : [named as Format]) {
    const dir = boardStillsDir(project.root,format);
    const staging = await mkdtemp(join(project.root,'.motion-stills-'));
    try {
      for (const {shot,frames:f} of plan) await captureStills(project,shot,format,f.map(frame => ({frame, output:join(staging,boardStillName(shot.id,frame))})),tools);
      await mkdir(dir,{recursive:true});
      const replaced = new Set(plan.map(p => p.shot.id));
      for (const file of await readdir(dir)) {
        const still = parseBoardStill(file);
        if (still && (replaced.has(still.shotId) || (!ids.length && !shots.some(s => s.id === still.shotId)))) await rm(join(dir,file),{force:true});
      }
      for (const file of await readdir(staging)) await rename(join(staging,file),join(dir,file));
      await boardSheet(project,format,dir,staging,tools);
    } finally {await rm(staging,{recursive:true,force:true});}
    lines.push(`stills ${format}: ${plan.map(p => `${p.shot.id} ${p.frames.join(',')}`).join('; ')} -> stills/G2/${formatDir(format)}/`);
  }
  return lines;
}

/**
 * Rebuilds the G2 contact sheet of one format from every board still in its folder: `sheet.png` (5 tiles per row,
 * left to right, then top to bottom, in storyboard shot order, then frame order) and `sheet.json`, the index of
 * each tile's still. G2 hashes both with the stills, so the sheet always shows the stills it is approved with.
 */
async function boardSheet(project:Project, format:Format, dir:string, scratch:string, tools:Tools) {
  const {shots} = project.storyboard;
  const order = (id:string) => shots.findIndex(s => s.id === id);
  const stills = (await readdir(dir)).map(file => ({file, still:parseBoardStill(file)}))
    .filter((s):s is {file:string; still:{shotId:string; frame:number}} => s.still !== null && order(s.still.shotId) >= 0)
    .sort((a,b) => order(a.still.shotId)-order(b.still.shotId) || a.still.frame-b.still.frame);
  await rm(join(dir,'sheet.png'),{force:true});
  await rm(join(dir,'sheet.json'),{force:true});
  if (!stills.length) return;
  const {width,height} = layoutOf(project.storyboard,format).canvas;
  const {scale} = tiling(width,height);
  const list = join(scratch,'sheet.txt');
  await writeFile(list,stills.map(s => `file '${join(dir,s.file).replaceAll("'", "'\\''")}'`).join('\n')+'\n');
  const staged = join(scratch,'sheet.png');
  await tools.command('ffmpeg',['-hide_banner','-loglevel','error','-nostdin','-y','-f','concat','-safe','0','-i',list,'-vf',`${scale},${tile(SHEET_COLUMNS,Math.ceil(stills.length/SHEET_COLUMNS))}`,'-frames:v','1','-pix_fmt','rgb24',staged]);
  await writeFile(join(scratch,'sheet.json'),JSON.stringify({format, columns:SHEET_COLUMNS, order:'left to right, then top to bottom', tiles:stills.map(s => s.file)},null,2)+'\n');
  await rename(staged,join(dir,'sheet.png'));
  await rename(join(scratch,'sheet.json'),join(dir,'sheet.json'));
}
