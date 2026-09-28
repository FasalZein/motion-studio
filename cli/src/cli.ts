#!/usr/bin/env node
import {readFile, mkdir, mkdtemp, readdir, rename, rm, writeFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {createRequire} from 'node:module';
import {bundle} from '@remotion/bundler';
import {renderFrames, selectComposition} from '@remotion/renderer';
import {handoff} from './handoff.js';
import {mix} from './mix.js';

type Shot = {id:string; engine:'remotion'|'hyperframes'; start:number; end:number; entry:string; composition?:string};
type Project = {fps:24|25|30|60; width:number; height:number; beatsSeconds:number[]; wordsSeconds:number[]; shots:Shot[]};
const rates = [24,25,30,60];
const require = createRequire(import.meta.url);
const hfBin = resolve(dirname(require.resolve('hyperframes/package.json')), 'bin/hyperframes.mjs');
const configuredTimeout = process.env.MOTION_STUDIO_CHILD_TIMEOUT_MS;
const timeoutMs = configuredTimeout === undefined ? 120_000 : Number(configuredTimeout);
if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw Error('invalid child timeout');

function frame(seconds:number, fps:number):number {
  if (!Number.isFinite(seconds) || seconds < 0) throw Error('time must be a non-negative finite number');
  return Math.round(seconds * fps);
}
function parseProject(value:unknown):Project {
  if (typeof value !== 'object' || value === null) throw Error('project must be an object');
  const obj = value as Record<string,unknown>;
  if (!rates.includes(obj.fps as number) || !Number.isInteger(obj.width) || !Number.isInteger(obj.height) || (obj.width as number) < 1 || (obj.height as number) < 1) throw Error('invalid fps or dimensions');
  if (!Array.isArray(obj.shots) || obj.shots.length === 0 || !Array.isArray(obj.beatsSeconds) || !Array.isArray(obj.wordsSeconds)) throw Error('invalid shots or times');
  for (const seconds of [...obj.beatsSeconds, ...obj.wordsSeconds]) frame(seconds, obj.fps as number);
  let previousEnd = 0;
  const ids = new Set<string>();
  for (const s of obj.shots) {
    if (!s || typeof s.id !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(s.id) || ids.has(s.id) || !['remotion','hyperframes'].includes(s.engine) || typeof s.entry !== 'string' || !s.entry || (s.engine === 'remotion' && typeof s.composition !== 'string')) throw Error('invalid shot');
    if (!Number.isInteger(s.start) || !Number.isInteger(s.end) || s.start !== previousEnd || s.end <= s.start) throw Error(`gap or overlap at shot ${s.id}`);
    previousEnd = s.end; ids.add(s.id);
  }
  return obj as Project;
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
  if (audio.streams?.length) throw Error(`audio stream in video-only clip: ${path}`);
  const data = JSON.parse(await command('ffprobe',['-v','error','-select_streams','v:0','-count_frames','-show_entries','stream=nb_read_frames,width,height,codec_name,pix_fmt,color_space,color_transfer,color_primaries:frame=best_effort_timestamp_time','-show_frames','-of','json',path]));
  const video = data.streams?.[0];
  if (Number(video?.nb_read_frames) !== expected || data.frames?.length !== expected || video.width !== width || video.height !== height || video.codec_name !== 'ffv1' || video.pix_fmt !== 'yuv444p' || video.color_space !== 'bt709' || video.color_transfer !== 'bt709' || video.color_primaries !== 'bt709') throw Error(`media contract failed: ${path}`);
  for (let i=0;i<expected;i++) {
    const timestamp = data.frames[i].best_effort_timestamp_time;
    if (timestamp === undefined || timestamp === null || timestamp === '' || !Number.isFinite(Number(timestamp)) || Math.abs(Number(timestamp) - i/fps) > .0006) throw Error(`timestamp mismatch: ${path} frame ${i}`);
  }
}
async function renderShot(shot:Shot, project:Project, base:string, output:string) {
  const temp = await mkdtemp(join(tmpdir(),'motion-shot-'));
  try {
    const entry = resolve(base,shot.entry);
    const frames = join(temp,'frames');
    await mkdir(frames);
    if (shot.engine === 'remotion') {
      const serveUrl = await bundle({entryPoint:entry, publicDir:join(dirname(entry),'public')});
      try {
        const composition = await selectComposition({serveUrl,id:shot.composition!});
        if (composition.durationInFrames !== shot.end-shot.start || composition.fps !== project.fps || composition.width !== project.width || composition.height !== project.height) throw Error(`composition metadata mismatch: ${shot.id}`);
        await renderFrames({serveUrl,composition,inputProps:{},outputDir:frames,imageFormat:'png',muted:true,onStart:()=>{},onFrameUpdate:()=>{},concurrency:1});
      } finally {await rm(serveUrl,{recursive:true,force:true});}
    } else {
      await command('node',[hfBin,'render',dirname(entry),'--composition',shot.entry.split('/').at(-1)!,'--output',frames,'--format','png-sequence','--fps',String(project.fps),'--workers','1','--sdr','--quiet'],base);
    }
    const pngs = (await readdir(frames)).filter(f => f.endsWith('.png')).sort();
    if (pngs.length !== shot.end-shot.start) throw Error(`rendered frame count mismatch: ${shot.id} got ${pngs.length}`);
    // Both renderers write numbered PNGs. Concat demuxer accepts their different numbering schemes.
    const list = join(temp,'frames.txt');
    await writeFile(list,pngs.map(p => `file '${join(frames,p).replaceAll("'", "'\\''")}'`).join('\n')+'\n');
    await command('ffmpeg',['-hide_banner','-loglevel','error','-y','-r',String(project.fps),'-f','concat','-safe','0','-i',list,'-an','-vf','setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709','-c:v','ffv1','-level','3','-pix_fmt','yuv444p','-colorspace','bt709','-color_trc','bt709','-color_primaries','bt709',output]);
    await verify(output,shot.end-shot.start,project.fps,project.width,project.height);
  } finally {await rm(temp,{recursive:true,force:true});}
}
async function main() {
  const [action,filename] = process.argv.slice(2);
  if (!['render','stitch','still','handoff','mix'].includes(action) || !filename) throw Error('usage: motion-studio <render|stitch|still|handoff|mix> <project.json> [shot-id]');
  const base = dirname(resolve(filename));
  const project = parseProject(JSON.parse(await readFile(filename,'utf8')));
  const output = join(base,'output');
  if (action === 'handoff') return console.log(await handoff(project,output,process.argv[4],process.argv[5],{command,verify}));
  if (action === 'mix') return console.log(await mix(project,(project as {mix?:unknown}).mix,base,output,{command,verify}));
  if (action === 'render' || action === 'still') {
    const shots = action === 'still' ? project.shots.filter(s => s.id === process.argv[4]) : project.shots;
    if (!shots.length) throw Error('unknown shot');
    const stillFrame = action === 'still' ? Number(process.argv[5] ?? '0') : 0;
    if (!Number.isInteger(stillFrame) || stillFrame < 0 || (action === 'still' && stillFrame >= shots[0].end-shots[0].start)) throw Error('still frame outside shot');
    // The success marker must be absent throughout a rerender, even if old clips remain.
    if (action === 'render') {
      await rm(join(output,'render.json'),{force:true});
      await rm(join(output,'master.mkv'),{force:true});
    }
    const staging = await mkdtemp(join(base,'.motion-render-'));
    try {
      for (const shot of shots) await renderShot(shot,project,base,join(staging,`${shot.id}.mkv`));
      if (action === 'still') {
        const shot = shots[0];
        await command('ffmpeg',['-hide_banner','-loglevel','error','-y','-i',join(staging,`${shot.id}.mkv`),'-vf',`select=eq(n\\,${stillFrame})`,'-vsync','0','-frames:v','1',join(staging,`${shot.id}.png`)]);
        await rm(join(staging,`${shot.id}.mkv`));
      }
      await mkdir(output,{recursive:true});
      for (const file of await readdir(staging)) await rename(join(staging,file),join(output,file));
      if (action === 'render') await writeFile(join(output,'render.json'), JSON.stringify({beats:project.beatsSeconds.map(t => frame(t,project.fps)),words:project.wordsSeconds.map(t => frame(t,project.fps))}));
    } finally {await rm(staging,{recursive:true,force:true});}
  } else {
    try {await readFile(join(output,'render.json'),'utf8');}
    catch {throw Error('successful render required before stitch');}
    for (const shot of project.shots) await verify(join(output,`${shot.id}.mkv`),shot.end-shot.start,project.fps,project.width,project.height);
    const list = join(output,'clips.txt');
    await writeFile(list,project.shots.map(s=>`file '${join(output,`${s.id}.mkv`).replaceAll("'", "'\\''")}'`).join('\n')+'\n');
    try {
      await command('ffmpeg',['-hide_banner','-loglevel','error','-y','-f','concat','-safe','0','-i',list,'-map','0:v:0','-an','-c','copy',join(output,'master.mkv')]);
      await verify(join(output,'master.mkv'),project.shots.at(-1)!.end,project.fps,project.width,project.height);
    } finally {await rm(list,{force:true});}
  }
  console.log(`${action} verified ${action === 'stitch' ? project.shots.at(-1)!.end : project.shots.map(s=>s.end-s.start).join('+')} frames`);
}
main().catch(e => {console.error(e);process.exitCode=1;});
