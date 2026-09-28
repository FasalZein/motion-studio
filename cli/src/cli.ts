#!/usr/bin/env node
import {readFile, mkdir, mkdtemp, readdir, rename, rm, writeFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {createRequire} from 'node:module';
import {bundle} from '@remotion/bundler';
import {renderFrames, selectComposition} from '@remotion/renderer';

import {CliError, initProject, parseProject, type Project, type Shot} from './project.js';
import {checkProject, remotionEntry, validateProject} from './validate.js';
import {statusLines} from './status.js';
import {handoff} from './handoff.js';
import {mix} from './mix.js';
import {clearSeamOutputs} from './seam.js';

const require = createRequire(import.meta.url);
const hfBin = resolve(dirname(require.resolve('hyperframes/package.json')), 'bin/hyperframes.mjs');
const configuredTimeout = process.env.MOTION_STUDIO_CHILD_TIMEOUT_MS;
const timeoutMs = configuredTimeout === undefined ? 120_000 : Number(configuredTimeout);
if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw Error('invalid child timeout');

/** Prints findings as `error:` and `warning:` lines on stderr. */
function report(errors:string[], warnings:string[]) {
  for (const w of warnings) console.error(`warning: ${w}`);
  for (const e of errors) console.error(`error: ${e}`);
}
/** Loads a film folder; any validation error stops the command before it writes anything. */
async function loadProject(filmRoot:string):Promise<Project> {
  const {errors,warnings,project} = await validateProject(filmRoot);
  report(errors,warnings);
  if (errors.length || !project) throw new CliError(`invalid project ${resolve(filmRoot)}: ${errors.length} error${errors.length === 1 ? '' : 's'}`);
  return project;
}
async function command(bin:string,args:string[],cwd?:string):Promise<string> {
  return new Promise((ok,fail) => {
    const child = spawn(bin,args,{cwd,detached:process.platform !== 'win32',stdio:['ignore','pipe','pipe']});
    let output = '';
    child.stdout.on('data',d => { output += d; });
    child.stderr.on('data',d => { output += d; });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      if (child.pid && process.platform !== 'win32') { try {process.kill(-child.pid, 'SIGKILL');} catch {} }
      else child.kill('SIGKILL');
    },timeoutMs);
    child.on('error',err => {clearTimeout(timer); fail(err);});
    child.on('close',code => {clearTimeout(timer); code === 0 && !timedOut ? ok(output) : fail(Error(timedOut ? `${bin} timed out after ${timeoutMs} ms` : `${bin} exited ${code}: ${output.slice(-3500)}`));});
  });
}
async function verify(path:string, expected:number, fps:number, width:number, height:number) {
  const audio = JSON.parse(await command('ffprobe',['-v','error','-select_streams','a','-show_entries','stream=index','-of','json',path]));
  if (audio.streams?.length) throw new CliError(`audio stream in video-only clip: ${path}`);
  const data = JSON.parse(await command('ffprobe',['-v','error','-select_streams','v:0','-count_frames','-show_entries','stream=nb_read_frames,width,height,codec_name,pix_fmt,color_space,color_transfer,color_primaries:frame=best_effort_timestamp_time','-show_frames','-of','json',path]));
  const video = data.streams?.[0];
  if (Number(video?.nb_read_frames) !== expected || data.frames?.length !== expected || video.width !== width || video.height !== height || video.codec_name !== 'ffv1' || video.pix_fmt !== 'yuv444p' || video.color_space !== 'bt709' || video.color_transfer !== 'bt709' || video.color_primaries !== 'bt709') throw new CliError(`media contract failed: ${path}`);
  for (let i=0;i<expected;i++) {
    const timestamp = data.frames[i].best_effort_timestamp_time;
    if (timestamp === undefined || timestamp === null || timestamp === '' || !Number.isFinite(Number(timestamp)) || Math.abs(Number(timestamp) - i/fps) > .0006) throw new CliError(`timestamp mismatch: ${path} frame ${i}`);
  }
}
async function renderShot(shot:Shot, project:Project, output:string) {
  const {root:base, storyboard:{meta:{fps,canvas:{width,height}}}} = project;
  const frameCount = shot.endFrame-shot.startFrame;
  const temp = await mkdtemp(join(tmpdir(),'motion-shot-'));
  try {
    const frames = join(temp,'frames');
    await mkdir(frames);
    if (shot.engine === 'remotion') {
      const entry = await remotionEntry(base,shot);
      if (!entry) throw new CliError(`Remotion project entry missing: ${shot.id}`);
      const serveUrl = await bundle({entryPoint:entry, publicDir:join(base,'shots',shot.id,'public')});
      try {
        const composition = await selectComposition({serveUrl,id:shot.entrypoint});
        if (composition.durationInFrames !== frameCount || composition.fps !== fps || composition.width !== width || composition.height !== height) throw new CliError(`composition metadata mismatch: ${shot.id}`);
        await renderFrames({serveUrl,composition,inputProps:{},outputDir:frames,imageFormat:'png',muted:true,onStart:()=>{},onFrameUpdate:()=>{},concurrency:1});
      } finally {await rm(serveUrl,{recursive:true,force:true});}
    } else {
      const entry = resolve(base,shot.entrypoint);
      await command('node',[hfBin,'render',dirname(entry),'--composition',shot.entrypoint.split('/').at(-1)!,'--output',frames,'--format','png-sequence','--fps',String(fps),'--workers','1','--sdr','--quiet'],base);
    }
    const pngs = (await readdir(frames)).filter(f => f.endsWith('.png')).sort();
    if (pngs.length !== frameCount) throw new CliError(`rendered frame count mismatch: ${shot.id} got ${pngs.length}`);
    // Both renderers write numbered PNGs. Concat demuxer accepts their different numbering schemes.
    const list = join(temp,'frames.txt');
    await writeFile(list,pngs.map(p => `file '${join(frames,p).replaceAll("'", "'\\''")}'`).join('\n')+'\n');
    await command('ffmpeg',['-hide_banner','-loglevel','error','-y','-r',String(fps),'-f','concat','-safe','0','-i',list,'-an','-vf','setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709','-c:v','ffv1','-level','3','-pix_fmt','yuv444p','-colorspace','bt709','-color_trc','bt709','-color_primaries','bt709',output]);
    await verify(output,frameCount,fps,width,height);
  } finally {await rm(temp,{recursive:true,force:true});}
}
const usage = 'usage: motion-studio init <slug> | validate <film-dir> | status <film-dir> | render <film-dir> | stitch <film-dir> | still <film-dir> <shot-id> [local-frame] | handoff <film-dir> [<shot-a> <shot-b>] | mix <film-dir>';
async function main() {
  const [action,target] = process.argv.slice(2);
  if (!['init','validate','status','render','stitch','still','handoff','mix'].includes(action) || !target) throw new CliError(usage);
  if (action === 'init') {
    console.log(`created ${await initProject(process.cwd(),target)}`);
    return;
  }
  if (action === 'validate') {
    const {errors,warnings} = await validateProject(target);
    report(errors,warnings);
    if (errors.length) {process.exitCode = 1; return;}
    console.log(`valid ${resolve(target)}`);
    return;
  }
  if (action === 'status') {
    // Status must work on an unfinished film: only a schema failure stops it.
    const parsed = await parseProject(target);
    if (!parsed.ok) {report(parsed.errors,[]); process.exitCode = 1; return;}
    const {errors} = await checkProject(parsed.project);
    for (const line of statusLines(parsed.project.storyboard.gates)) console.log(line);
    if (errors.length) console.log(`validation: ${errors.length} error${errors.length === 1 ? '' : 's'}; run motion-studio validate ${target}`);
    return;
  }
  const project = await loadProject(target);
  const {root:base, storyboard:{shots, meta:{fps, canvas:{width,height}}}} = project;
  if (!shots.length) throw new CliError('project has no shots');
  const output = join(base,'output');
  if (action === 'handoff') return handoff(project,output,process.argv.slice(4),{command,verify});
  if (action === 'mix') return console.log(await mix(project,output,{command,verify}));
  // Handoff and mix evidence describes one master; a new render or stitch makes it stale.
  if (action === 'render' || action === 'stitch') await clearSeamOutputs(output);
  if (action === 'render' || action === 'still') {
    const selected = action === 'still' ? shots.filter(s => s.id === process.argv[4]) : shots;
    if (!selected.length) throw new CliError('unknown shot');
    const stillFrame = action === 'still' ? Number(process.argv[5] ?? '0') : 0;
    if (!Number.isInteger(stillFrame) || stillFrame < 0 || (action === 'still' && stillFrame >= selected[0].endFrame-selected[0].startFrame)) throw new CliError('still frame outside shot');
    // The success marker must be absent throughout a rerender, even if old clips remain.
    if (action === 'render') {
      await rm(join(output,'render.json'),{force:true});
      await rm(join(output,'master.mkv'),{force:true});
    }
    const staging = await mkdtemp(join(base,'.motion-render-'));
    try {
      for (const shot of selected) await renderShot(shot,project,join(staging,`${shot.id}.mkv`));
      if (action === 'still') {
        const shot = selected[0];
        await command('ffmpeg',['-hide_banner','-loglevel','error','-y','-i',join(staging,`${shot.id}.mkv`),'-vf',`select=eq(n\\,${stillFrame})`,'-vsync','0','-frames:v','1',join(staging,`${shot.id}.png`)]);
        await rm(join(staging,`${shot.id}.mkv`));
      }
      await mkdir(output,{recursive:true});
      for (const file of await readdir(staging)) await rename(join(staging,file),join(output,file));
      if (action === 'render') await writeFile(join(output,'render.json'), JSON.stringify({shots:shots.map(s => ({id:s.id, startFrame:s.startFrame, endFrame:s.endFrame}))}));
    } finally {await rm(staging,{recursive:true,force:true});}
  } else {
    try {await readFile(join(output,'render.json'),'utf8');}
    catch {throw new CliError('successful render required before stitch');}
    for (const shot of shots) await verify(join(output,`${shot.id}.mkv`),shot.endFrame-shot.startFrame,fps,width,height);
    const list = join(output,'clips.txt');
    await writeFile(list,shots.map(s=>`file '${join(output,`${s.id}.mkv`).replaceAll("'", "'\\''")}'`).join('\n')+'\n');
    try {
      await command('ffmpeg',['-hide_banner','-loglevel','error','-y','-f','concat','-safe','0','-i',list,'-map','0:v:0','-an','-c','copy',join(output,'master.mkv')]);
      await verify(join(output,'master.mkv'),shots.at(-1)!.endFrame,fps,width,height);
    } finally {await rm(list,{force:true});}
  }
  console.log(`${action} verified ${action === 'stitch' ? shots.at(-1)!.endFrame : shots.map(s=>s.endFrame-s.startFrame).join('+')} frames`);
}
main().catch(e => {console.error(e instanceof CliError ? `error: ${e.message}` : e);process.exitCode=1;});
