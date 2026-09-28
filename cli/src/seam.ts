import {access} from 'node:fs/promises';
import {join} from 'node:path';

/** The part of the project file that the seam checks read. */
export type Timeline = {fps:number; width:number; height:number; beatsSeconds:number[]; shots:{id:string; start:number; end:number}[]};
/** Process and media helpers owned by cli.ts, passed in so the seam modules do not import the entry point. */
export type Tools = {
  command:(bin:string, args:string[], cwd?:string) => Promise<string>;
  verify:(path:string, expected:number, fps:number, width:number, height:number) => Promise<void>;
};

/** Requires a successful render and a stitched master that still meets the media contract. */
export async function requireMaster(timeline:Timeline, output:string, tools:Tools):Promise<string> {
  const master = join(output,'master.mkv');
  try {await access(join(output,'render.json')); await access(master);}
  catch {throw Error('successful render and stitch required');}
  await tools.verify(master,timeline.shots.at(-1)!.end,timeline.fps,timeline.width,timeline.height);
  return master;
}

export const round3 = (value:number) => Math.round(value*1000)/1000;
