import {mkdir, mkdtemp, readFile, rename, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve, relative, isAbsolute} from 'node:path';

import {CliError, layoutOf, type Format, type Project, type Rect, type Shot} from './project.js';
import {framePngs, remotionBundle, renderHyperframesFrames, renderRemotionFrames} from './engines.js';
import type {Tools} from './seam.js';

/**
 * A pixel counts as part of the element when a channel changes by more than this (0-255) after hiding it.
 * Both renders come from the same engine with the same inputs, so pixels away from the element do not change.
 */
const DIFF_LEVEL = 2;

type Status = 'inside'|'outside'|'not-visible'|'no-declared-bounds';
type Check = {shot:string; id:string; frame:number; source:'measured'|'declared'; bounds:Rect|null; status:Status};

const within = (b:Rect, safe:Rect) => b.x >= safe.x && b.y >= safe.y && b.x+b.width <= safe.x+safe.width && b.y+b.height <= safe.y+safe.height;
const rectText = (r:Rect) => `${r.x},${r.y} ${r.width}x${r.height}`;

async function rgb(tools:Tools, png:string, out:string):Promise<Buffer> {
  await tools.command('ffmpeg',['-hide_banner','-loglevel','error','-y','-i',png,'-f','rawvideo','-pix_fmt','rgb24',out]);
  return readFile(out);
}
/** The smallest rectangle that holds every pixel that differs between the two frames, or null when none differ. */
function changedBounds(a:Buffer, b:Buffer, width:number):Rect|null {
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
  for (let i = 0; i < a.length; i += 3) {
    if (Math.abs(a[i]-b[i]) <= DIFF_LEVEL && Math.abs(a[i+1]-b[i+1]) <= DIFF_LEVEL && Math.abs(a[i+2]-b[i+2]) <= DIFF_LEVEL) continue;
    const p = i/3, x = p % width, y = Math.floor(p/width);
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return x1 < 0 ? null : {x:x0, y:y0, width:x1-x0+1, height:y1-y0+1};
}

/** Renders every frame of a shot for one format, optionally with one protected element hidden. */
async function renderPngs(project:Project, shot:Shot, format:Format, dir:string, tools:Tools, serveUrl:string|null, hide?:string):Promise<string[]> {
  await mkdir(dir);
  if (serveUrl) await renderRemotionFrames(project,shot,serveUrl,{format,framesDir:dir,hide});
  else await renderHyperframesFrames(project,shot,tools,{format,framesDir:dir,hide});
  return framePngs(shot,dir);
}

/**
 * Measures each measured protected element by its painted pixels: the frame rendered normally minus the
 * same frame with only that element hidden (`data-protected="<id>"`). This finds the bounds of wrapped
 * text, logos and UI in both engines through one method.
 */
async function measure(project:Project, shot:Shot, format:Format, tools:Tools):Promise<Check[]> {
  const ids = shot.protected.filter(p => p.bounds === 'measured');
  if (!ids.length) return [];
  const {width} = layoutOf(project.storyboard,format).canvas;
  const bundled = shot.engine === 'remotion' ? await remotionBundle(project,shot,true) : null;
  let temp:string|undefined;
  try {
    temp = await mkdtemp(join(tmpdir(),'motion-safezone-'));
    const base = await renderPngs(project,shot,format,join(temp,'base'),tools,bundled?.serveUrl ?? null);
    const checks:Check[] = [];
    for (const p of ids) {
      const hidden = await renderPngs(project,shot,format,join(temp,`hide-${p.id}`),tools,bundled?.serveUrl ?? null,p.id);
      for (const frame of p.heldFrames) {
        const bounds = changedBounds(await rgb(tools,base[frame],join(temp,'a.rgb')),await rgb(tools,hidden[frame],join(temp,'b.rgb')),width);
        checks.push({shot:shot.id, id:p.id, frame, source:'measured', bounds, status:bounds ? 'outside' : 'not-visible'});
      }
    }
    return checks;
  } finally {
    await bundled?.dispose();
    if (temp) await rm(temp,{recursive:true,force:true});
  }
}

/** Reads author-declared geometry for canvas or SVG content: {"<format>": {x, y, width, height}}. */
async function declared(project:Project, shot:Shot, format:Format):Promise<Check[]> {
  const checks:Check[] = [];
  for (const p of shot.protected.filter(p => p.bounds !== 'measured')) {
    const file = resolve(project.root,p.bounds);
    const rel = relative(project.root,file);
    let rect:Rect|null = null;
    if (!isAbsolute(p.bounds) && !rel.startsWith('..')) {
      const data = await readFile(file,'utf8').then(t => JSON.parse(t) as Record<string,Rect>,() => null);
      const r = data?.[format];
      if (r && [r.x,r.y,r.width,r.height].every(Number.isInteger)) rect = {x:r.x, y:r.y, width:r.width, height:r.height};
    }
    for (const frame of p.heldFrames) checks.push({shot:shot.id, id:p.id, frame, source:'declared', bounds:rect, status:rect ? 'outside' : 'no-declared-bounds'});
  }
  return checks;
}

/** Parses `safezone` arguments after the film folder: an optional format and `--shots <id,...>`. */
export function safezoneArgs(args:string[]):{format:string|undefined; shots:string[]|undefined} {
  let format:string|undefined, shots:string[]|undefined;
  for (let i=0;i<args.length;i++) {
    if (args[i] === '--shots') {
      const value = args[++i];
      if (!value) throw new CliError('--shots takes comma-separated shot ids, for example s01,s02');
      shots = value.split(',');
    } else if (format === undefined) format = args[i];
    else throw new CliError(`unexpected argument ${args[i]}`);
  }
  return {format,shots};
}

/**
 * Checks held protected content against each format's safe rectangle. Only held frames are checked, so
 * entrance and exit travel and unprotected full-bleed art never fail. Returns the number of failed checks.
 * A run over every shot writes renders/<format>/safezone.json, the G5 delivery check. A run over named shots
 * (`only`, an engine builder's own check) prints its checks and leaves that report alone, because it covers part
 * of the film.
 */
export async function safezone(project:Project, formats:Format[], renders:(f:Format) => string, tools:Tools, only?:string[]):Promise<number> {
  const {shots} = project.storyboard;
  for (const id of only ?? []) if (!shots.some(s => s.id === id)) throw new CliError(`unknown shot ${id}`);
  const selected = only ? shots.filter(s => only.includes(s.id)) : shots;
  let failures = 0;
  for (const format of formats) {
    const output = renders(format);
    if (!only) {
      await mkdir(output,{recursive:true});
      await rm(join(output,'safezone.json'),{force:true});
    }
    const layout = layoutOf(project.storyboard,format);
    const checks:Check[] = [];
    for (const shot of selected) checks.push(...await declared(project,shot,format), ...await measure(project,shot,format,tools));
    for (const c of checks) {
      if (c.bounds && within(c.bounds,layout.safe)) c.status = 'inside';
      const where = `safezone ${format} ${c.shot}/${c.id} frame ${c.frame}`;
      if (c.status === 'inside') {console.log(`${where}: inside (${c.source} ${rectText(c.bounds!)})`); continue;}
      failures++;
      console.error(`error: ${where}: ${c.status === 'outside' ? `held ${c.source} bounds ${rectText(c.bounds!)} outside safe rectangle ${rectText(layout.safe)}` : c.status === 'not-visible' ? `no painted pixels for data-protected="${c.id}"` : `no declared bounds for ${format} in ${c.shot}`}`);
    }
    if (!only) {
      const report = join(output,'.safezone.json.tmp');
      await writeFile(report,JSON.stringify({format, canvas:layout.canvas, safe:layout.safe, overlay:layout.overlay, checks},null,2)+'\n');
      await rename(report,join(output,'safezone.json'));
    }
    console.log(`safezone ${format}: ${checks.length - checks.filter(c => c.status !== 'inside').length} of ${checks.length} checks inside`);
  }
  return failures;
}
