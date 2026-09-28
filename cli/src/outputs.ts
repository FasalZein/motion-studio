import {join} from 'node:path';
import {formatDir, type Format} from './project.js';

/**
 * The one path resolver for a format's render outputs. Pipeline outputs (render.json, master.mkv, handoff
 * and mix files, safezone.json, scan.json) sit in `renders/<format>/`. Shot clips and stills sit in its `shots/`
 * folder, so a legal shot id such as `final`, `master` or `poster` never names a pipeline output.
 */
export type Outputs = {
  format:Format;
  /** `renders/<format>/`: pipeline and delivery outputs. */
  dir:string;
  /** `renders/<format>/shots/`: one clip (and optional still) per shot id. */
  shots:string;
  marker:string;
  master:string;
  clip:(shotId:string) => string;
  still:(shotId:string) => string;
};

export function outputsOf(root:string, format:Format):Outputs {
  const dir = join(root,'renders',formatDir(format));
  const shots = join(dir,'shots');
  return {
    format, dir, shots,
    marker:join(dir,'render.json'),
    master:join(dir,'master.mkv'),
    clip:id => join(shots,`${id}.mkv`),
    still:id => join(shots,`${id}.png`),
  };
}
