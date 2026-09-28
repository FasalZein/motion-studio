import {readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';

import {CliError, type Format, type Shot} from './project.js';
import type {Tools} from './seam.js';

/**
 * Refuses engine frames that have a transparent pixel. Clips and stills drop alpha, so a transparent pixel shows as
 * black: a background painted on the page (`html`, `body`) instead of inside the composition root is lost this way.
 * `frames` are PNGs of one shot in one format, each with its shot-local frame; `scratch` is a folder for the
 * ffmpeg list and report. One ffmpeg pass reads the lowest alpha of every frame; a PNG without alpha reads 255.
 */
export async function requireOpaque(tools:Tools, shot:Shot, format:Format, frames:{frame:number; png:string}[], scratch:string) {
  if (!frames.length) return;
  const list = join(scratch,'opaque.txt');
  const report = join(scratch,'opaque-alpha.txt');
  await writeFile(list,frames.map(f => `file '${f.png.replaceAll("'", "'\\''")}'`).join('\n')+'\n');
  // The input rate only gives each image its own timestamp. ffmpeg runs in the scratch folder, so the filter graph gets a plain relative report name to parse, never a path.
  await tools.command('ffmpeg',['-hide_banner','-loglevel','error','-nostdin','-y','-r','30','-f','concat','-safe','0','-i',list,'-vf','format=rgba,alphaextract,signalstats,metadata=print:key=lavfi.signalstats.YMIN:file=opaque-alpha.txt','-f','null','-'],scratch);
  const minima = [...(await readFile(report,'utf8')).matchAll(/lavfi\.signalstats\.YMIN=(\d+)/g)].map(m => Number(m[1]));
  // A frame the concat demuxer skipped would otherwise pass unread.
  if (minima.length !== frames.length) throw new CliError(`alpha check read ${minima.length} of ${frames.length} frames: ${shot.id} (${format})`);
  const index = minima.findIndex(alpha => alpha < 255);
  if (index >= 0) throw new CliError(`transparent pixels in ${shot.id} frame ${frames[index].frame} (${format}): paint an opaque full-bleed background inside the composition root`);
}
