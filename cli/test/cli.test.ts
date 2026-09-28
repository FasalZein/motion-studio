import {test, expect} from 'bun:test';
import {mkdtemp, cp, rm, readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';

const cli = resolve(import.meta.dir, '../dist/cli.js');
const fixture = resolve(import.meta.dir, '../fixtures/two-engine');
const run = (runtime: string, ...args: string[]) => spawnSync(runtime, [cli, ...args], {encoding: 'utf8', timeout: 180000});
const pixel = (file:string,x:number,y:number) => [...spawnSync('ffmpeg',['-v','error','-i',file,'-vf',`select=eq(n\\,0),crop=1:1:${x}:${y}`,'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','-'],{encoding:null}).stdout];
const probe = (file: string) => JSON.parse(spawnSync('ffprobe', ['-v','error','-select_streams','v:0','-show_entries','stream=nb_read_frames,pix_fmt,color_space,color_transfer,color_primaries:frame=best_effort_timestamp_time','-count_frames','-show_frames','-of','json',file], {encoding:'utf8'}).stdout);

for (const runtime of ['bun','node']) test(`${runtime}: two engines render and stitch on exact frames`, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'motion-studio-'));
  try {
    await cp(fixture, dir, {recursive:true, filter: src => !src.endsWith('/output')});
    const rendered = run(runtime, 'render', join(dir,'project.json'));
    expect(rendered.stderr).toBe('');
    expect(rendered.status).toBe(0);
    const stitched = run(runtime, 'stitch', join(dir,'project.json'));
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
    const fontHash = async (file:string) => createHash('sha256').update(await readFile(file)).digest('hex');
    expect(await fontHash(join(dir,'hyperframes','IBMPlexSans.ttf'))).toBe(await fontHash(join(dir,'remotion','public','IBMPlexSans.ttf')));
    const report = JSON.parse(await readFile(join(dir,'output','render.json'),'utf8'));
    expect(report.beats).toEqual([3,6]);
    expect(report.words).toEqual([2]);
  } finally { await rm(dir,{recursive:true,force:true}); }
}, 360000);

test('invalid timeline fails before creating output', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'motion-studio-invalid-'));
  try {
    await cp(fixture, dir, {recursive:true, filter: src => !src.endsWith('/output')});
    const path = join(dir,'project.json');
    const data = JSON.parse(await readFile(path,'utf8'));
    data.shots[1].start = 7;
    await Bun.write(path, JSON.stringify(data));
    const result = run('bun','render',path);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('gap or overlap');
  } finally {await rm(dir,{recursive:true,force:true});}
});

for (const runtime of ['bun','node']) test(`${runtime}: failed engine subprocess exits and removes staging`, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'motion-studio-fail-'));
  try {
    await cp(fixture, dir, {recursive:true, filter: src => !src.endsWith('/output')});
    const path = join(dir,'project.json');
    const data = JSON.parse(await readFile(path,'utf8'));
    data.shots[1].entry = 'hyperframes/missing.html';
    await Bun.write(path, JSON.stringify(data));
    const started = Date.now();
    const result = run(runtime,'render',path);
    expect(result.status).not.toBe(0);
    expect(result.signal).toBeNull();
    expect(Date.now()-started).toBeLessThan(120000);
    expect(result.stderr).toContain('Composition not found');
    expect((await import('node:fs/promises')).readdir(dir).then(files=>files.some(f=>f.startsWith('.motion-render-')))).resolves.toBe(false);
    expect((await import('node:fs/promises')).stat(join(dir,'output','remotion.mkv')).then(()=>true,()=>false)).resolves.toBe(false);
  } finally {await rm(dir,{recursive:true,force:true});}
}, 180000);

test('packed CLI renders stills and video under both runtimes', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'motion-studio-pack-'));
  try {
    const tarball = resolve(import.meta.dir,'../motion-studio-0.1.0.tgz');
    const install = spawnSync('npm',['install','--prefix',dir,'--no-audit','--no-fund',tarball],{encoding:'utf8',timeout:120000});
    expect(install.status).toBe(0);
    const binary = join(dir,'node_modules','motion-studio','dist','cli.js');
    const project = join(dir,'project.json');
    await cp(fixture,dir,{recursive:true, filter: src => !src.endsWith('/output')});
    for (const runtime of ['node','bun']) {
      const still = spawnSync(runtime,[binary,'still',project,'remotion'],{encoding:'utf8',timeout:180000});
      expect(still.status).toBe(0);
      expect((await import('node:fs/promises')).stat(join(dir,'output','remotion.png')).then(s=>s.size>0,()=>false)).resolves.toBe(true);
      const hyperStill = spawnSync(runtime,[binary,'still',project,'hyperframes','2'],{encoding:'utf8',timeout:180000});
      expect(hyperStill.status).toBe(0);
      expect((await import('node:fs/promises')).stat(join(dir,'output','hyperframes.png')).then(s=>s.size>0,()=>false)).resolves.toBe(true);
      const video = spawnSync(runtime,[binary,'render',project],{encoding:'utf8',timeout:180000});
      expect(video.status).toBe(0);
      const stitch = spawnSync(runtime,[binary,'stitch',project],{encoding:'utf8',timeout:180000});
      expect(stitch.status).toBe(0);
      expect(Number(probe(join(dir,'output','master.mkv')).streams[0].nb_read_frames)).toBe(12);
    }
  } finally {await rm(dir,{recursive:true,force:true});}
}, 600000);

test('stitch rejects an audio-bearing shot even when video frames match', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'motion-studio-audio-'));
  try {
    await cp(fixture,dir,{recursive:true,filter: src => !src.endsWith('/output')});
    const project = join(dir,'project.json');
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
    const project = join(dir,'project.json');
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
