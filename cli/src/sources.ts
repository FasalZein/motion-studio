import {createHash} from 'node:crypto';
import {readdir, readFile, stat} from 'node:fs/promises';
import {join, relative} from 'node:path';

import {CliError, layoutOf, type Format, type Project, type Shot} from './project.js';
import type {Outputs} from './outputs.js';
import {nonSourceDirs} from './determinism.js';
import {canonical} from './gates.js';

/**
 * Folders inside a shot that are not shot source: installed packages and engine output (the same list the
 * determinism guard skips, and the G2 shot-sources exclusions), so a manual `hyperframes check --snapshots` after
 * `render` does not make the render look stale. Dot entries (CLI staging) are skipped too.
 */
const skippedDirs = nonSourceDirs;

async function sourceFiles(dir:string):Promise<string[]> {
  const entries = await readdir(dir,{withFileTypes:true}).catch(() => []);
  const files:string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.') || skippedDirs.has(entry.name)) continue;
    const full = join(dir,entry.name);
    const info = await stat(full).catch(() => null);
    if (info?.isDirectory()) files.push(...await sourceFiles(full));
    else if (info?.isFile()) files.push(full);
  }
  return files;
}

/**
 * The source hash of one shot render: SHA-256 over every file in `shots/<id>/` (path and content; dot entries,
 * `node_modules` and engine output folders left out), the shot's storyboard fields that change its pixels (engine, entrypoint, frame range),
 * the film fps, the format layout, and the ledger hash of each asset the shot lists. `render` records it per shot in
 * `render.json`; a different current hash means the source changed after the render. Content hashes, not file
 * times: a copy, checkout or touch changes a time but not the rendered source, and an edit within the same second
 * keeps the time.
 */
export async function shotSourceHash(project:Project, shot:Shot, format:Format):Promise<string> {
  const {root,ledger,storyboard} = project;
  const hash = createHash('sha256');
  const dir = join(root,'shots',shot.id);
  const files = (await sourceFiles(dir)).map(f => ({rel:relative(dir,f).split('\\').join('/'), full:f})).sort((a,b) => a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0);
  for (const {rel,full} of files) hash.update(`${rel}\0${createHash('sha256').update(await readFile(full)).digest('hex')}\n`);
  const assets = shot.assets.map(id => [id,ledger.assets.find(a => a.id === id)?.sha256 ?? null]);
  // Canonical JSON (sorted keys), so rewriting storyboard.json with another key order changes no hash.
  hash.update(canonical({engine:shot.engine, entrypoint:shot.entrypoint, startFrame:shot.startFrame, endFrame:shot.endFrame,
    fps:storyboard.meta.fps, layout:layoutOf(storyboard,format), assets}));
  return hash.digest('hex');
}

/** The per-shot source hashes `render` writes into `render.json` under `sources`. */
export async function renderSources(project:Project, format:Format):Promise<Record<string,string>> {
  const sources:Record<string,string> = {};
  for (const shot of project.storyboard.shots) sources[shot.id] = await shotSourceHash(project,shot,format);
  return sources;
}

/**
 * Refuses when a shot render of the format is older than its source: `render.json` has no recorded hash for the
 * shot (a render from before source hashes, or a shot added since) or the recorded hash differs from the current one.
 * Names every such shot.
 */
export async function requireCurrentRenders(project:Project, out:Outputs):Promise<void> {
  let recorded:Record<string,unknown> = {};
  try {
    const marker = JSON.parse(await readFile(out.marker,'utf8'));
    if (typeof marker?.sources === 'object' && marker.sources !== null) recorded = marker.sources;
  } catch {throw new CliError(`successful render and stitch required: ${out.format}`);}
  const stale:string[] = [];
  for (const shot of project.storyboard.shots) {
    const now = await shotSourceHash(project,shot,out.format);
    if (recorded[shot.id] !== now) stale.push(`${shot.id} (${typeof recorded[shot.id] === 'string' ? 'source changed since its render' : 'no source record in render.json'})`);
  }
  if (stale.length) throw new CliError(`shot render older than its source (${out.format}): ${stale.join(', ')}; run motion-studio render ${project.root} ${out.format} and stitch`);
}
