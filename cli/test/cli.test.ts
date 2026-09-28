import {test as nodeTest} from 'node:test';
const {expect} = await import('bun' in process.versions ? 'bun:test' : 'expect');
import {dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const test = (name:string, fn:()=>Promise<void>, timeout=600000) => nodeTest(name,{timeout},fn);
import {mkdtemp, cp, rm, readFile, writeFile, chmod} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';

const cli = resolve(dirname(fileURLToPath(import.meta.url)), '../dist/cli.js');
const fixture = resolve(dirname(fileURLToPath(import.meta.url)), '../fixtures/two-engine');
const run = (runtime: string, ...args: string[]) => spawnSync(runtime, [cli, ...args], {encoding: 'utf8', timeout: 180000});
const pixel = (file:string,x:number,y:number) => [...spawnSync('ffmpeg',['-v','error','-i',file,'-vf',`select=eq(n\\,0),crop=1:1:${x}:${y}`,'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','-'],{encoding:null}).stdout];
const decodedFrame = (file:string, frame:number) => spawnSync('ffmpeg',['-v','error','-i',file,'-vf',`select=eq(n\\,${frame})`,'-vsync','0','-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','-'],{encoding:null,timeout:15000}).stdout;
const probe = (file: string) => JSON.parse(spawnSync('ffprobe', ['-v','error','-select_streams','v:0','-show_entries','stream=nb_read_frames,pix_fmt,color_space,color_transfer,color_primaries:frame=best_effort_timestamp_time','-count_frames','-show_frames','-of','json',file], {encoding:'utf8'}).stdout);

for (const runtime of ['bun','node']) test(`${runtime}: two engines render and stitch on exact frames`, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'motion-studio-'));
  try {
    await cp(fixture, dir, {recursive:true, filter: src => !src.endsWith('/output')});
    const rendered = run(runtime, 'render', dir);
    expect(rendered.stderr).toBe('');
    expect(rendered.status).toBe(0);
    const stitched = run(runtime, 'stitch', dir);
    expect(stitched.status).toBe(0);
    for (const name of ['remotion','hyperframes','master']) {
      const data = probe(join(dir,'output',`${name}.mkv`));
      expect(Number(data.streams[0].nb_read_frames)).toBe(name === 'master' ? 12 : 6);
      expect(data.streams[0].pix_fmt).toBe('yuv444p');
      expect(data.streams[0].color_space).toBe('bt709');
      const file = join(dir,'output',`${name}.mkv`);
      expect(pixel(file,14,14)).toEqual([223,91,69]);
      expect(pixel(file,290,140)).toEqual([23,43,70]);
      data.frames.forEach((f: {best_effort_timestamp_time:string}, i:number) => expect(Math.abs(Number(f.best_effort_timestamp_time)-i/30)).toBeLessThan(0.0006));
    }
    const master=join(dir,'output','master.mkv');
    const before=decodedFrame(master,5);
    const after=decodedFrame(master,6);
    expect(before.length).toBe(320*180*3);
    expect(after.length).toBe(320*180*3);
    expect(before).toEqual(decodedFrame(join(dir,'output','remotion.mkv'),5));
    expect(after).toEqual(decodedFrame(join(dir,'output','hyperframes.mkv'),0));
    expect(after.equals(before)).toBe(false);
    const fontHash = async (file:string) => createHash('sha256').update(await readFile(file)).digest('hex');
    expect(await fontHash(join(dir,'shots','hyperframes','IBMPlexSans.ttf'))).toBe(await fontHash(join(dir,'shots','remotion','public','IBMPlexSans.ttf')));
    const report = JSON.parse(await readFile(join(dir,'output','render.json'),'utf8'));
    expect(report.shots).toEqual([{id:'remotion',startFrame:0,endFrame:6},{id:'hyperframes',startFrame:6,endFrame:12}]);
  } finally { await rm(dir,{recursive:true,force:true}); }
}, 360000);

for (const runtime of ['bun','node']) test(`${runtime}: failed engine subprocess exits and removes staging`, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'motion-studio-fail-'));
  try {
    await cp(fixture, dir, {recursive:true, filter: src => !src.endsWith('/output')});
    // An unreadable entry passes validation (the file exists) but makes the real HyperFrames process fail.
    const entry = join(dir,'shots','hyperframes','index.html');
    await chmod(entry,0o000);
    const started = Date.now();
    const result = run(runtime,'render',dir);
    await chmod(entry,0o644);
    expect(result.status).not.toBe(0);
    expect(result.signal).toBeNull();
    expect(Date.now()-started).toBeLessThan(120000);
    expect(result.stderr).toContain('node exited 1');
    expect(result.stderr).toContain('EACCES');
    expect((await import('node:fs/promises')).readdir(dir).then(files=>files.some(f=>f.startsWith('.motion-render-')))).resolves.toBe(false);
    expect((await import('node:fs/promises')).stat(join(dir,'output','remotion.mkv')).then(()=>true,()=>false)).resolves.toBe(false);
  } finally {await rm(dir,{recursive:true,force:true});}
}, 180000);

test('packed CLI renders stills and video under both runtimes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'motion-studio-pack-'));
  try {
    const tarball = resolve(dirname(fileURLToPath(import.meta.url)),'../motion-studio-0.1.0.tgz');
    const install = spawnSync('npm',['install','--prefix',dir,'--no-audit','--no-fund',tarball],{encoding:'utf8',timeout:120000});
    expect(install.status).toBe(0);
    const binary = join(dir,'node_modules','motion-studio','dist','cli.js');
    const project = join(dir,'film');
    await cp(fixture,project,{recursive:true, filter: src => !src.endsWith('/output')});
    for (const runtime of ['node','bun']) {
      const still = spawnSync(runtime,[binary,'still',project,'remotion'],{encoding:'utf8',timeout:180000});
      expect(still.status).toBe(0);
      expect((await import('node:fs/promises')).stat(join(project,'output','remotion.png')).then(s=>s.size>0,()=>false)).resolves.toBe(true);
      const hyperStill = spawnSync(runtime,[binary,'still',project,'hyperframes','2'],{encoding:'utf8',timeout:180000});
      expect(hyperStill.status).toBe(0);
      expect((await import('node:fs/promises')).stat(join(project,'output','hyperframes.png')).then(s=>s.size>0,()=>false)).resolves.toBe(true);
      const video = spawnSync(runtime,[binary,'render',project],{encoding:'utf8',timeout:180000});
      expect(video.status).toBe(0);
      const stitch = spawnSync(runtime,[binary,'stitch',project],{encoding:'utf8',timeout:180000});
      expect(stitch.status).toBe(0);
      expect(Number(probe(join(project,'output','master.mkv')).streams[0].nb_read_frames)).toBe(12);
    }
  } finally {await rm(dir,{recursive:true,force:true});}
}, 600000);

test('stitch rejects an audio-bearing shot even when video frames match', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'motion-studio-audio-'));
  try {
    await cp(fixture,dir,{recursive:true,filter: src => !src.endsWith('/output')});
    const project = dir;
    expect(run('node','render',project).status).toBe(0);
    const original = join(dir,'output','remotion.mkv');
    const altered = join(dir,'audio.mkv');
    const mux = spawnSync('ffmpeg',['-v','error','-y','-i',original,'-f','lavfi','-i','sine=frequency=440:duration=0.2','-map','0:v','-map','1:a','-c:v','copy','-c:a','pcm_s16le',altered],{encoding:'utf8',timeout:15000});
    expect(mux.status).toBe(0);
    await (await import('node:fs/promises')).rename(altered,original);
    const result = run('node','stitch',project);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('audio stream');
  } finally {await rm(dir,{recursive:true,force:true});}
}, 180000);

test('stitch rejects a shifted presentation timestamp', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'motion-studio-pts-'));
  try {
    await cp(fixture,dir,{recursive:true,filter: src => !src.endsWith('/output')});
    const project = dir;
    expect(run('bun','render',project).status).toBe(0);
    const original = join(dir,'output','hyperframes.mkv');
    const altered = join(dir,'shifted.mkv');
    const shift = spawnSync('ffmpeg',['-v','error','-y','-i',original,'-vf','setpts=PTS+1/(30*TB)','-c:v','ffv1','-level','3','-pix_fmt','yuv444p',altered],{encoding:'utf8',timeout:15000});
    expect(shift.status).toBe(0);
    await (await import('node:fs/promises')).rename(altered,original);
    const result = run('bun','stitch',project);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('timestamp mismatch');
  } finally {await rm(dir,{recursive:true,force:true});}
}, 180000);

test('failed rerender invalidates earlier clips before stitch', async () => {
  const dir = await mkdtemp(join(tmpdir(),'motion-studio-rerender-'));
  try {
    await cp(fixture,dir,{recursive:true,filter: src => !src.endsWith('/output')});
    const project = dir;
    expect(run('node','render',project).status).toBe(0);
    expect(run('node','stitch',project).status).toBe(0);
    const entry = join(dir,'shots','hyperframes','index.html');
    await chmod(entry,0o000);
    const failed = run('node','render',project);
    await chmod(entry,0o644);
    expect(failed.status).not.toBe(0);
    expect(failed.stderr).toContain('EACCES');
    const stale = run('node','stitch',project);
    expect(stale.status).not.toBe(0);
    expect(stale.stderr).toContain('successful render required');
  } finally {await rm(dir,{recursive:true,force:true});}
},180000);

test('stitch rejects missing and unparseable frame timestamps from ffprobe', async () => {
  const dir = await mkdtemp(join(tmpdir(),'motion-studio-probe-'));
  try {
    await cp(fixture,dir,{recursive:true,filter: src => !src.endsWith('/output')});
    const project = dir;
    expect(run('node','render',project).status).toBe(0);
    const realProbe = spawnSync('which',['ffprobe'],{encoding:'utf8'}).stdout.trim();
    const shimDir = join(dir,'bin');
    await (await import('node:fs/promises')).mkdir(shimDir);
    const fake = join(shimDir,'ffprobe');
    await writeFile(fake,`#!/usr/bin/env node\nconst {spawnSync}=require('node:child_process');\nconst a=process.argv.slice(2);\nconst result=spawnSync(process.env.REAL_FFPROBE,a,{encoding:'utf8'});\nif(result.status!==0){process.stderr.write(result.stderr);process.exit(result.status)}\nconst data=JSON.parse(result.stdout);\nif(a.includes('-show_frames')){if(process.env.PROBE_MODE==='missing') delete data.frames[0].best_effort_timestamp_time; else data.frames[0].best_effort_timestamp_time='N/A'}\nprocess.stdout.write(JSON.stringify(data));\n`);
    await (await import('node:fs/promises')).chmod(fake,0o755);
    for (const mode of ['missing','invalid']) {
      const result=spawnSync('node',[cli,'stitch',project],{encoding:'utf8',timeout:15000,env:{...process.env,PATH:`${shimDir}:${process.env.PATH}`,REAL_FFPROBE:realProbe,PROBE_MODE:mode}});
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('timestamp mismatch');
    }
  } finally {await rm(dir,{recursive:true,force:true});}
},180000);

test('hung engine subprocess kills descendant and removes staging and shot temp', async () => {
  const dir = await mkdtemp(join(tmpdir(),'motion-studio-hang-'));
  try {
    await cp(fixture,dir,{recursive:true,filter: src => !src.endsWith('/output')});
    const shotBefore = new Set((await (await import('node:fs/promises')).readdir(tmpdir())).filter(x=>x.startsWith('motion-shot-')));
    const bin = join(dir,'bin');
    await (await import('node:fs/promises')).mkdir(bin);
    const childPid = join(dir,'descendant.pid');
    const fakeNode=join(bin,'node');
    await writeFile(fakeNode,`#!/bin/sh\ncase "$1" in\n  *hyperframes.mjs) sleep 60 & echo $! > "$HANG_PID"; wait;;\n  *) exec "$REAL_NODE" "$@";;\nesac\n`);
    await (await import('node:fs/promises')).chmod(fakeNode,0o755);
    const originalNode=spawnSync('which',['node'],{encoding:'utf8'}).stdout.trim();
    const started=Date.now();
    const result=spawnSync('bun',[cli,'render',dir],{encoding:'utf8',timeout:20000,env:{...process.env,PATH:`${bin}:${process.env.PATH}`,HANG_PID:childPid,REAL_NODE:originalNode,MOTION_STUDIO_CHILD_TIMEOUT_MS:'3000'}});
    expect(result.status).not.toBe(0);
    expect(result.signal).toBeNull();
    expect(result.stderr).toContain('timed out after 3000 ms');
    expect(Date.now()-started).toBeLessThan(20000);
    const pid=Number(await readFile(childPid,'utf8'));
    expect(Number.isSafeInteger(pid)).toBe(true);
    const state=spawnSync('ps',['-p',String(pid),'-o','stat='],{encoding:'utf8'}).stdout.trim();
    expect(state === '' || state.startsWith('Z')).toBe(true);
    const shotAfter=(await (await import('node:fs/promises')).readdir(tmpdir())).filter(x=>x.startsWith('motion-shot-'));
    expect(shotAfter.filter(x=>!shotBefore.has(x))).toEqual([]);
    expect((await (await import('node:fs/promises')).readdir(dir)).some(x=>x.startsWith('.motion-render-'))).toBe(false);
    const stitch=run('bun','stitch',dir);
    expect(stitch.status).not.toBe(0);
  } finally {await rm(dir,{recursive:true,force:true});}
},180000);
