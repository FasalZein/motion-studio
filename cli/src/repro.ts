import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {CliError, type Format, type Project, type Shot} from './project.js';
import {framePngs, glBackend, hyperframesGpu, remotionBundle, renderHyperframesFrames, renderRemotionFrames} from './engines.js';
import type {Outputs} from './outputs.js';
import type {Tools} from './seam.js';

/** The report `repro` writes: one SHA-256 per frame and run, and the frames whose hashes differ. */
export type ReproReport = {
  shot:string; format:Format; engine:Shot['engine']; renderer:{remotionGl:string; hyperframesGpu:string};
  status:'match'|'mismatch'; mismatchedFrames:number[]; runs:[string[],string[]];
};

async function frameHashes(project:Project, shot:Shot, format:Format, tools:Tools, dir:string):Promise<string[]> {
  const framesDir = join(dir,'frames');
  await mkdir(framesDir,{recursive:true});
  if (shot.engine === 'remotion') {
    // A fresh bundle per run, so the second run shares no build state with the first.
    const {serveUrl,dispose} = await remotionBundle(project,shot,false);
    try {await renderRemotionFrames(project,shot,serveUrl,{format,framesDir});}
    finally {await dispose();}
  } else await renderHyperframesFrames(project,shot,tools,{format,framesDir});
  const hashes:string[] = [];
  for (const png of await framePngs(shot,framesDir)) hashes.push(createHash('sha256').update(await readFile(png)).digest('hex'));
  return hashes;
}

/**
 * Renders one shot twice in one format and compares the SHA-256 of every PNG frame (D66). Writes
 * `renders/<format>/repro-<shot-id>.json` and throws a CliError that names the differing frames on a mismatch.
 */
export async function repro(project:Project, shotId:string, out:Outputs, tools:Tools):Promise<string> {
  const shot = project.storyboard.shots.find(s => s.id === shotId);
  if (!shot) throw new CliError(`unknown shot ${shotId}`);
  const report = join(out.dir,`repro-${shot.id}.json`);
  await rm(report,{force:true});
  const temp = await mkdtemp(join(tmpdir(),'motion-repro-'));
  try {
    const first = await frameHashes(project,shot,out.format,tools,join(temp,'a'));
    const second = await frameHashes(project,shot,out.format,tools,join(temp,'b'));
    const mismatchedFrames = first.flatMap((hash,frame) => hash === second[frame] ? [] : [frame]);
    const result:ReproReport = {shot:shot.id, format:out.format, engine:shot.engine, renderer:{remotionGl:glBackend, hyperframesGpu},
      status:mismatchedFrames.length ? 'mismatch' : 'match', mismatchedFrames, runs:[first,second]};
    await mkdir(out.dir,{recursive:true});
    await writeFile(report,JSON.stringify(result,null,2)+'\n');
    if (mismatchedFrames.length) throw new CliError(`repro ${shot.id} ${out.format}: ${mismatchedFrames.length} of ${first.length} frames differ between two renders (frames ${mismatchedFrames.join(', ')}); report ${report}`);
    return `repro ${shot.id} ${out.format}: ${first.length} frames match across two renders -> ${report}`;
  } finally {await rm(temp,{recursive:true,force:true});}
}
