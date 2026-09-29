import {test as nodeTest} from 'node:test';
const {expect} = await import('bun' in process.versions ? 'bun:test' : 'expect');
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';

// Board tooling (#7): stills, animatic and sheet, checked as a black box. Expected pixels come from the engines'
// own rendered clips or from a master built here with ffmpeg, never from the commands under test.
const test = (name:string, fn:()=>Promise<void>, timeout=600000) => nodeTest(name,{timeout},fn);
const here = dirname(fileURLToPath(import.meta.url));
const cli = resolve(here,'../dist/cli.js');
const fixture = resolve(here,'../fixtures/two-engine');
const run = (runtime:string, ...args:string[]) => spawnSync(runtime,[cli,...args],{encoding:'utf8',timeout:180000});
function ok(runtime:string, ...args:string[]) {
  const result = run(runtime,...args);
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
  // On a fresh install the first Remotion call downloads its headless Chrome and says so on stdout; that is not CLI output.
  return result.stdout.split('\n').filter(line => !/^(Downloading Chrome Headless Shell|Downloading from: |Customize this behavior by adding a onBrowserDownload)/.test(line)).join('\n');
}
const copyFilm = async () => {
  const dir = await mkdtemp(join(tmpdir(),'motion-studio-board-'));
  await cp(fixture,dir,{recursive:true,filter:src => !src.endsWith('/renders')});
  return dir;
};
/** RGB bytes of frame n of any image or video, decoded by ffmpeg; an optional crop x:y:w:h. */
const rgb = (file:string, n = 0, crop?:string) => new Uint8Array(spawnSync('ffmpeg',['-v','error','-i',file,'-map','0:v:0','-vf',`select=eq(n\\,${n})${crop ? `,crop=${crop}` : ''}`,'-fps_mode','passthrough','-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','-'],{encoding:null,timeout:30000,maxBuffer:1e8}).stdout);
/** Largest absolute difference of any channel sample, 0 to 255. */
function diff(a:Uint8Array, b:Uint8Array) {
  expect(a.length).toBeGreaterThan(0);
  expect(a.length).toBe(b.length);
  let max = 0;
  for (let i=0;i<a.length;i++) max = Math.max(max,Math.abs(a[i]-b[i]));
  return max;
}
const size = (file:string) => JSON.parse(spawnSync('ffprobe',['-v','error','-select_streams','v:0','-show_entries','stream=width,height','-of','json',file],{encoding:'utf8'}).stdout).streams[0];
const probe = (file:string) => JSON.parse(spawnSync('ffprobe',['-v','error','-count_frames','-show_entries','stream=codec_type,codec_name,nb_read_frames,duration','-of','json',file],{encoding:'utf8'}).stdout).streams;
// A still is the engine's frame before the lossless yuv444p clip encode; that round trip moves a channel sample by a
// few levels at most. A different frame differs by far more where its content changed (the Remotion frame number).
const PARITY = 8;

test('stills render named shots at shot-local frames in both engines and match the rendered clips', async () => {
  const dir = await copyFilm();
  try {
    const g2 = join(dir,'stills','G2','16x9');
    // A stale still of a shot that is no longer in the storyboard is removed by a run over every shot.
    await mkdir(g2,{recursive:true});
    await writeFile(join(g2,'gone-f000.png'),'old');
    expect(ok('node','stills',dir)).toBe('stills 16:9: remotion 0,5; hyperframes 0,5 -> stills/G2/16x9/\n');
    expect((await readdir(g2)).sort()).toEqual(['hyperframes-f000.png','hyperframes-f005.png','remotion-f000.png','remotion-f005.png','sheet.json','sheet.png']);
    ok('bun','render',dir);
    for (const shot of ['remotion','hyperframes']) for (const frame of [0,5]) {
      const still = join(g2,`${shot}-f${String(frame).padStart(3,'0')}.png`);
      expect(size(still)).toEqual({width:320,height:180});
      const clip = join(dir,'renders','16x9','shots',`${shot}.mkv`);
      expect(diff(rgb(still),rgb(clip,frame))).toBeLessThan(PARITY);
    }
    // The Remotion shot draws its frame number, so its stills are frame-specific: frame 5 is not frame 0.
    const remotionClip = join(dir,'renders','16x9','shots','remotion.mkv');
    expect(diff(rgb(join(g2,'remotion-f005.png')),rgb(remotionClip,0))).toBeGreaterThan(PARITY);

    // The G2 contact sheet tiles every still in storyboard order, 5 per row, with a 4-pixel margin and padding.
    expect(size(join(g2,'sheet.png'))).toEqual({width:5*324+4, height:184+4});
    const order = ['remotion-f000.png','remotion-f005.png','hyperframes-f000.png','hyperframes-f005.png'];
    expect(JSON.parse(await readFile(join(g2,'sheet.json'),'utf8')).tiles).toEqual(order);
    for (const [i,file] of order.entries()) expect(diff(rgb(join(g2,'sheet.png'),0,`320:180:${4+i*324}:4`),rgb(join(g2,file)))).toBeLessThan(PARITY);

    // Named shot and frames replace only that shot's stills, and the sheet is rebuilt.
    expect(ok('bun','stills',dir,'remotion','--frames','3,1','--format','16:9')).toBe('stills 16:9: remotion 1,3 -> stills/G2/16x9/\n');
    expect((await readdir(g2)).sort()).toEqual(['hyperframes-f000.png','hyperframes-f005.png','remotion-f001.png','remotion-f003.png','sheet.json','sheet.png']);
    expect(diff(rgb(join(g2,'remotion-f003.png')),rgb(remotionClip,3))).toBeLessThan(PARITY);
    expect(JSON.parse(await readFile(join(g2,'sheet.json'),'utf8')).tiles).toEqual(['remotion-f001.png','remotion-f003.png','hyperframes-f000.png','hyperframes-f005.png']);

    // Capture temp files stay inside the film folder, so the final rename never crosses file systems (EXDEV with
    // a tmpfs /tmp). A PATH shim logs every ffmpeg argument; each PNG ffmpeg reads or writes must be in the film.
    const shimDir = await mkdtemp(join(tmpdir(),'motion-studio-board-shim-'));
    try {
      const log = join(shimDir,'ffmpeg.log');
      const realFfmpeg = spawnSync('which',['ffmpeg'],{encoding:'utf8'}).stdout.trim();
      await writeFile(join(shimDir,'ffmpeg'),`#!/bin/sh\nfor a in "$@"; do printf '%s\\n' "$a" >> '${log}'; done\nexec '${realFfmpeg}' "$@"\n`,{mode:0o755});
      const shimmed = spawnSync('node',[cli,'still',dir,'remotion','2'],{encoding:'utf8',timeout:180000,env:{...process.env,PATH:`${shimDir}:${process.env.PATH}`}});
      expect(shimmed.status).toBe(0);
      const pngs = (await readFile(log,'utf8')).split('\n').filter(a => a.endsWith('.png'));
      expect(pngs.length).toBeGreaterThan(0);
      for (const png of pngs) expect(png.startsWith(dir+'/')).toBe(true);
    } finally {await rm(shimDir,{recursive:true,force:true});}

    // `still` captures one frame directly into renders/<format>/shots/.
    ok('node','still',dir,'hyperframes','4');
    const hyperClip = join(dir,'renders','16x9','shots','hyperframes.mkv');
    expect(diff(rgb(join(dir,'renders','16x9','shots','hyperframes.png')),rgb(hyperClip,4))).toBeLessThan(PARITY);

    // A frame outside the shot and an unknown shot are refused, and nothing changes.
    for (const [args,message] of [[['remotion','--frames','6'],'still frame 6 is outside shot remotion (shot-local frames 0 to 5)'],[['nope'],'unknown shot nope']] as const) {
      const refused = run('node','stills',dir,...args);
      expect(refused.stderr).toBe(`error: ${message}\n`);
      expect(refused.status).toBe(1);
    }
    expect((await readdir(g2)).sort()).toEqual(['hyperframes-f000.png','hyperframes-f005.png','remotion-f001.png','remotion-f003.png','sheet.json','sheet.png']);
    expect((await readdir(dir)).filter(f => f.startsWith('.'))).toEqual([]);
  } finally {await rm(dir,{recursive:true,force:true});}
});

test('stills reframe every chosen format and take the requested frame of a moving HyperFrames shot', async () => {
  const dir = await mkdtemp(join(tmpdir(),'motion-studio-board-formats-'));
  try {
    await cp(resolve(here,'../fixtures/safezone'),dir,{recursive:true,filter:src => !src.endsWith('/renders')});
    // The title slides in over frames 0 to 1, so frame 0 and frame 1 differ.
    expect(ok('node','stills',dir,'hyperframes','--frames','0,1')).toBe(['16:9','9:16','1:1'].map(f => `stills ${f}: hyperframes 0,1 -> stills/G2/${f.replace(':','x')}/`).join('\n')+'\n');
    for (const [folder,width,height] of [['16x9',320,180],['9x16',180,320],['1x1',240,240]] as const)
      for (const frame of ['000','001']) expect(size(join(dir,'stills','G2',folder,`hyperframes-f${frame}.png`))).toEqual({width,height});
    ok('bun','render',dir,'9:16');
    const clip = join(dir,'renders','9x16','shots','hyperframes.mkv');
    const g2 = join(dir,'stills','G2','9x16');
    for (const frame of [0,1]) expect(diff(rgb(join(g2,`hyperframes-f00${frame}.png`)),rgb(clip,frame))).toBeLessThan(PARITY);
    expect(diff(rgb(join(g2,'hyperframes-f001.png')),rgb(clip,0))).toBeGreaterThan(40);
  } finally {await rm(dir,{recursive:true,force:true});}
});

test('sheet writes 1 fps contact pages and full-rate transition strips from the stitched master', async () => {
  const dir = await copyFilm();
  try {
    const out = join(dir,'renders','16x9');
    const refused = run('node','sheet',dir);
    expect(refused.stderr).toBe('error: successful render and stitch required: 16:9\n');
    expect(refused.status).toBe(1);

    // 790 frames at 30 fps: 27 one-second samples (frames 0 to 780), so two contact pages. The last cut, at 785,
    // is 5 frames before the end, so its strip is clamped to 10 frames.
    const story = JSON.parse(await readFile(join(dir,'storyboard.json'),'utf8'));
    story.meta.durationFrames = 790;
    story.audio.beatFrames = [400,785];
    story.shots[0].endFrame = 400;
    Object.assign(story.shots[1],{startFrame:400, endFrame:785});
    story.shots[1].soundCues[0].eventFrame = 400;
    story.shots.push({...story.shots[0], id:'tail', startFrame:785, endFrame:790, soundCues:[], stillFrames:[0], thread:{kind:'shared-element-thread', shared:'the frame counter'}});
    await cp(join(dir,'shots','remotion'),join(dir,'shots','tail'),{recursive:true});
    await writeFile(join(dir,'storyboard.json'),JSON.stringify(story,null,2));
    // The master is built here: testsrc2 changes every frame, so each tile shows exactly one frame.
    await mkdir(out,{recursive:true});
    const master = join(out,'master.mkv');
    const made = spawnSync('ffmpeg',['-v','error','-y','-f','lavfi','-i','testsrc2=s=320x180:r=30','-frames:v','790','-vf','setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709',
      '-c:v','ffv1','-level','3','-pix_fmt','yuv444p','-colorspace','bt709','-color_trc','bt709','-color_primaries','bt709',master],{encoding:'utf8',timeout:60000});
    expect(made.stderr).toBe('');
    await writeFile(join(out,'render.json'),'{}');
    await writeFile(join(out,'contact-sheet-003.png'),'stale page');

    expect(ok('bun','sheet',dir)).toBe('sheet 16:9: 2 contact pages (27 frames at 1 per second), 2 transition strips\n');
    expect((await readdir(out)).sort()).toEqual(['contact-sheet-001.png','contact-sheet-002.png','master.mkv','render.json','sheet.json','transition-hyperframes-tail.png','transition-remotion-hyperframes.png']);
    // Tile (column c, row r) sits at 4 + c*(320+4), 4 + r*(180+4): margin and padding of 4 pixels.
    const tileAt = (file:string, index:number, columns:number) => rgb(join(out,file),0,`320:180:${4+(index%columns)*324}:${4+Math.floor(index/columns)*184}`);
    const shows = (file:string, index:number, columns:number, frame:number) => {
      const tile = tileAt(file,index,columns);
      expect(diff(tile,rgb(master,frame))).toBeLessThan(8);
      // A neighbouring frame does not match: the tile is that exact frame.
      expect(diff(tile,rgb(master,frame+1))).toBeGreaterThan(40);
    };
    expect(size(join(out,'contact-sheet-001.png'))).toEqual({width:5*324+4, height:5*184+4});
    expect(size(join(out,'contact-sheet-002.png'))).toEqual({width:5*324+4, height:5*184+4});
    for (const k of [0,1,7,24]) shows('contact-sheet-001.png',k,5,30*k);
    shows('contact-sheet-002.png',0,5,750);
    shows('contact-sheet-002.png',1,5,780);
    expect(size(join(out,'transition-remotion-hyperframes.png'))).toEqual({width:11*324+4, height:188});
    for (const i of [0,4,5,6,10]) shows('transition-remotion-hyperframes.png',i,11,395+i);
    expect(size(join(out,'transition-hyperframes-tail.png'))).toEqual({width:10*324+4, height:188});
    for (const i of [0,5,8]) shows('transition-hyperframes-tail.png',i,10,780+i);
    const index = JSON.parse(await readFile(join(out,'sheet.json'),'utf8'));
    expect(index.contact.pages).toEqual([
      {file:'contact-sheet-001.png', frames:Array.from({length:25},(_,k) => 30*k)},
      {file:'contact-sheet-002.png', frames:[750,780]},
    ]);
    expect(index.strips).toEqual([
      {file:'transition-remotion-hyperframes.png', shots:['remotion','hyperframes'], cut:400, frames:Array.from({length:11},(_,k) => 395+k)},
      {file:'transition-hyperframes-tail.png', shots:['hyperframes','tail'], cut:785, frames:Array.from({length:10},(_,k) => 780+k)},
    ]);
  } finally {await rm(dir,{recursive:true,force:true});}
});

// Engine contract (#14): a frame with transparent pixels is refused. The clip and the still drop alpha, so a lost
// background turns black, as s02 did in the e2e run. The fixture paints #172b46 on a full-bleed child of the root.
test('stills and render refuse transparent frames in both engines; a full-bleed background child passes', async () => {
  const dir = await copyFilm();
  try {
    const html = join(dir,'shots','hyperframes','index.html');
    const tsx = join(dir,'shots','remotion','src','index.tsx');
    const [page,component] = [await readFile(html,'utf8'),await readFile(tsx,'utf8')];
    const child = '<div style="position:absolute;inset:0;background:#172b46"></div>';
    // Author mistakes: the background painted on the page, as in the installed minimal HyperFrames composition, or
    // on the HyperFrames composition root, which the PNG render leaves transparent.
    const refuse = async (shot:string, frame:number) => {
      const refused = run('node','stills',dir,shot,'--frames',`${frame},5`);
      expect(refused.stderr).toBe(`error: transparent pixels in ${shot} frame ${frame} (16:9): paint an opaque full-bleed background inside the composition root\n`);
      expect(refused.status).toBe(1);
    };
    await writeFile(tsx,component.replace("backgroundColor: '#172b46', ",'').replace('<style>{`','<style>{`body {background:#172b46;} '));
    await refuse('remotion',1);
    await writeFile(html,page.replace(child,'').replace('body {margin:0;}','html,body {margin:0;background:#172b46;}'));
    await refuse('hyperframes',0);
    await writeFile(html,page.replace(child,'').replace('#root {','#root {background:#172b46;'));
    await refuse('hyperframes',0);
    // render renders the Remotion shot first; with it fixed, the HyperFrames shot (root background) is refused too.
    for (const shot of ['remotion','hyperframes']) {
      if (shot === 'hyperframes') await writeFile(tsx,component);
      const render = run('bun','render',dir);
      expect(render.stderr).toBe(`error: transparent pixels in ${shot} frame 0 (16:9): paint an opaque full-bleed background inside the composition root\n`);
      expect(render.status).toBe(1);
    }
    expect(await readdir(join(dir,'stills')).catch(() => [])).toEqual([]);
    expect(await readdir(join(dir,'renders')).catch(() => [])).toEqual([]);

    // The contract's form: a full-bleed background child inside the composition root (HyperFrames), and the
    // component's outer element (Remotion).
    await writeFile(html,page);
    expect(ok('node','stills',dir,'--frames','0')).toBe('stills 16:9: remotion 0; hyperframes 0 -> stills/G2/16x9/\n');
    // A background pixel away from the patch and the text keeps the painted color.
    for (const shot of ['remotion','hyperframes']) expect(diff(rgb(join(dir,'stills','G2','16x9',`${shot}-f000.png`),0,'1:1:300:170'),new Uint8Array([0x17,0x2b,0x46]))).toBeLessThanOrEqual(1);
    ok('bun','render',dir);
  } finally {await rm(dir,{recursive:true,force:true});}
});

// D54: a Remotion shot may import @remotion/transitions. The film lives outside the CLI, so this proves the bundler
// finds the CLI's copy. Two 4-frame scenes with a 2-frame fade make a 6-frame shot: frame 0 shows only the first
// scene and frame 5 only the second.
test('a Remotion shot that imports TransitionSeries from @remotion/transitions bundles and renders', async () => {
  const dir = await copyFilm();
  try {
    await writeFile(join(dir,'shots','remotion','src','index.tsx'),`import React from 'react';
import {AbsoluteFill, Composition, registerRoot} from 'remotion';
import {linearTiming, TransitionSeries} from '@remotion/transitions';
import {fade} from '@remotion/transitions/fade';
const Shot = () => <TransitionSeries>
  <TransitionSeries.Sequence durationInFrames={4}><AbsoluteFill style={{backgroundColor: '#aa2200'}} /></TransitionSeries.Sequence>
  <TransitionSeries.Transition presentation={fade()} timing={linearTiming({durationInFrames: 2})} />
  <TransitionSeries.Sequence durationInFrames={4}><AbsoluteFill style={{backgroundColor: '#0022aa'}} /></TransitionSeries.Sequence>
</TransitionSeries>;
registerRoot(() => <Composition id="Shot" component={Shot} durationInFrames={6} fps={30} width={320} height={180} />);
`);
    // The bundle writes no webpack cache: each film folder would add a new entry that nothing removes. Webpack puts
    // the cache under the package.json nearest the working directory; npm test runs in cli/, so that is this folder.
    const cacheDir = resolve(here,'../node_modules/.cache/webpack');
    const cacheEntries = async () => (await readdir(cacheDir,{recursive:true}).catch(() => [])).length;
    const cachedBefore = await cacheEntries();
    expect(ok('node','stills',dir,'remotion','--frames','0,5')).toBe('stills 16:9: remotion 0,5 -> stills/G2/16x9/\n');
    expect(await cacheEntries()).toBe(cachedBefore);
    const still = (frame:string) => rgb(join(dir,'stills','G2','16x9',`remotion-f${frame}.png`),0,'1:1:160:90');
    expect(diff(still('000'),new Uint8Array([0xaa,0x22,0x00]))).toBeLessThanOrEqual(1);
    expect(diff(still('005'),new Uint8Array([0x00,0x22,0xaa]))).toBeLessThanOrEqual(1);
  } finally {await rm(dir,{recursive:true,force:true});}
});
