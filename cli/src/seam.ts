import {access, readdir, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {CliError, layoutOf, type Project} from './project.js';
import type {Outputs} from './outputs.js';

/** Process and media helpers owned by cli.ts, passed in so the seam modules do not import the entry point. */
export type Tools = {
  command:(bin:string, args:string[], cwd?:string) => Promise<string>;
  verify:(path:string, expected:number, fps:number, width:number, height:number) => Promise<void>;
};

/** Files that `handoff` and `mix` derive from the master. */
const mixOutputs = ['final.mkv','mix.wav','sync.json'];
export const isHandoffOutput = (file:string) => file.startsWith('handoff-') && (file.endsWith('.json') || file.endsWith('.png'));

/** Removes every handoff and mix output, so a new render or stitch never leaves stale seam evidence. */
export async function clearSeamOutputs(output:string) {
  const files = await readdir(output).catch(() => [] as string[]);
  for (const file of files) if (isHandoffOutput(file) || mixOutputs.includes(file)) await rm(join(output,file),{force:true});
}
export async function clearMixOutputs(output:string) {
  for (const file of mixOutputs) await rm(join(output,file),{force:true});
}

/** Requires a successful render and a stitched master of the format that still meets the media contract. */
export async function requireMaster({storyboard}:Project, out:Outputs, tools:Tools):Promise<string> {
  const {shots,meta} = storyboard;
  const {width,height} = layoutOf(storyboard,out.format).canvas;
  try {await access(out.marker); await access(out.master);}
  catch {throw new CliError(`successful render and stitch required: ${out.format}`);}
  await tools.verify(out.master,shots.at(-1)!.endFrame,meta.fps,width,height);
  return out.master;
}

export const round3 = (value:number) => Math.round(value*1000)/1000;
