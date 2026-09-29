import {mkdir, mkdtemp, readFile, rename, rm, stat, writeFile} from 'node:fs/promises';
import {join, relative, resolve} from 'node:path';

import {CliError, layoutOf, type Engine, type Format, type Project, type Shot} from './project.js';
import {shotDeterminismErrors} from './determinism.js';
import {measureLiveness, printLiveness} from './liveness.js';
import type {Tools} from './seam.js';

/**
 * A look test (D61) is a G1 direction built in `shots/_look/<look-id>/`, outside the storyboard. Its builder declares
 * how to render it in `look-test.json`: the engine, the entrypoint (a Remotion composition id, or the HyperFrames HTML
 * file relative to the look-test folder), its length in frames (the builder's choice) and the poster frame.
 */
export type LookTest = {engine:Engine; entrypoint:string; frames:number; posterFrame:number; threeD?:{reason:string}};
export const lookTestFile = 'look-test.json';
/** Renders one shot of a project in one format into a verified FFV1 clip: the `render` command's shot path. */
export type RenderShot = (shot:Shot, project:Project, format:Format, output:string) => Promise<void>;
export const lookTestUsage = 'usage: motion-studio looktest <film-dir> <look-id>';

const isObject = (v:unknown):v is Record<string,unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
/** Reads and checks `shots/_look/<look-id>/look-test.json`; every problem is one clause of the error. */
async function readLookTest(root:string, lookId:string):Promise<LookTest> {
  const dir = join(root,'shots','_look',lookId);
  const file = `shots/_look/${lookId}/${lookTestFile}`;
  let value:unknown;
  try {value = JSON.parse(await readFile(join(dir,lookTestFile),'utf8'));}
  catch (e) {throw new CliError((e as NodeJS.ErrnoException).code === 'ENOENT' ? `look test not declared: ${file} not found` : `${file}: invalid JSON`);}
  if (!isObject(value)) throw new CliError(`${file}: must be an object`);
  const {engine,entrypoint,frames,posterFrame,threeD} = value;
  const problems:string[] = [];
  if (engine !== 'hyperframes' && engine !== 'remotion') problems.push('engine must be "hyperframes" or "remotion"');
  if (typeof entrypoint !== 'string' || !entrypoint) problems.push('entrypoint must be a non-empty string');
  if (!Number.isSafeInteger(frames) || (frames as number) < 1) problems.push('frames must be a positive integer');
  if (!Number.isSafeInteger(posterFrame) || (posterFrame as number) < 0 || (Number.isSafeInteger(frames) && (posterFrame as number) >= (frames as number))) problems.push('posterFrame must be a frame of the look test (0 to frames-1)');
  if (threeD !== undefined && !(isObject(threeD) && typeof threeD.reason === 'string' && threeD.reason)) problems.push('threeD must be {"reason": "<text>"}');
  if (engine === 'hyperframes' && typeof entrypoint === 'string' && entrypoint) {
    const rel = relative(dir,resolve(dir,entrypoint));
    if (rel.startsWith('..') || !rel.endsWith('.html') || !await stat(join(dir,rel)).then(s => s.isFile(),() => false)) problems.push(`entrypoint ${entrypoint} must be an HTML file inside shots/_look/${lookId}/`);
  }
  if (problems.length) throw new CliError(`${file}: ${problems.join('; ')}`);
  return value as LookTest;
}

/**
 * `looktest <film-dir> <look-id>`: renders the look test through its declared engine at the primary format's layout
 * inputs, with the same shot render path and media contract as `render`, then measures the clip's liveness (D59).
 * A passing look test lands in `stills/G1/` as `<look-id>.mkv` (clip), `<look-id>.png` (poster) and
 * `<look-id>.liveness.json`; G1 hashes and freezes them (D43). A failing one is refused: nothing lands, and the
 * previous outputs of that look are removed, because they no longer show its source. Returns whether it passed.
 */
export async function looktest(project:Project, args:string[], tools:Tools, renderShot:RenderShot):Promise<boolean> {
  const [lookId,...extra] = args;
  if (!lookId || extra.length) throw new CliError(lookTestUsage);
  if (!/^[a-z0-9][a-z0-9-]*$/.test(lookId)) throw new CliError(`invalid look id "${lookId}": use lowercase letters, digits and hyphens`);
  const {root,storyboard} = project;
  const spec = await readLookTest(root,lookId);
  const format = storyboard.meta.formats.primary;
  const {width,height} = layoutOf(storyboard,format).canvas;
  // The look test renders as a shot whose folder is shots/_look/<look-id>/, so both engines resolve it like a film shot.
  const shot:Shot = {
    id:`_look/${lookId}`, startFrame:0, endFrame:spec.frames, engine:spec.engine,
    entrypoint:spec.engine === 'hyperframes' ? join('shots','_look',lookId,spec.entrypoint) : spec.entrypoint,
    description:`look test ${lookId}`, camera:'custom:look test', entry:'cut', exit:'cut', assets:[], soundCues:[],
    stillFrames:[spec.posterFrame], protected:[], ...(spec.threeD ? {threeD:spec.threeD} : {}),
  };
  const guard = await shotDeterminismErrors(root,shot);
  if (guard.length) throw new CliError(`look test ${lookId} is not deterministic:\nerror: ${guard.join('\nerror: ')}`);

  const g1 = join(root,'stills','G1');
  const outputs = {clip:join(g1,`${lookId}.mkv`), poster:join(g1,`${lookId}.png`), report:join(g1,`${lookId}.liveness.json`)};
  for (const file of Object.values(outputs)) await rm(file,{force:true});
  // Inside the film, so the final renames stay on one file system; hidden folders are never gate inputs.
  const stage = await mkdtemp(join(root,'.motion-looktest-'));
  try {
    const clip = join(stage,'clip.mkv'), poster = join(stage,'poster.png');
    await renderShot(shot,project,format,clip);
    // The poster is a frame of the clip itself, so it shows exactly what the clip shows; rgb24 as in `stills`.
    await tools.command('ffmpeg',['-hide_banner','-loglevel','error','-nostdin','-y','-i',clip,'-vf',`select=eq(n\\,${spec.posterFrame})`,'-fps_mode','passthrough','-frames:v','1','-pix_fmt','rgb24',poster]);
    const size = JSON.parse(await tools.command('ffprobe',['-v','error','-select_streams','v:0','-show_entries','stream=width,height','-of','json',poster])).streams?.[0];
    if (size?.width !== width || size?.height !== height) throw new CliError(`poster size mismatch: ${lookId} is ${size?.width}x${size?.height}, expected ${width}x${height}`);
    const label = relative(root,outputs.clip);
    const report = await measureLiveness(tools,clip,label,null,spec.frames/storyboard.meta.fps);
    printLiveness(`look test ${lookId}`,report.pass ? relative(root,outputs.report) : 'refused, nothing written to stills/G1',report);
    if (!report.pass) return false;
    await mkdir(g1,{recursive:true});
    await rename(clip,outputs.clip);
    await rename(poster,outputs.poster);
    await writeFile(outputs.report,JSON.stringify({lookId, engine:spec.engine, format, frames:spec.frames, posterFrame:spec.posterFrame, ...report},null,2)+'\n');
    console.log(`looktest ${lookId}: ${spec.engine} ${format} ${spec.frames} frames -> ${label}, poster frame ${spec.posterFrame} -> ${relative(root,outputs.poster)}`);
    return true;
  } finally {await rm(stage,{recursive:true,force:true});}
}
