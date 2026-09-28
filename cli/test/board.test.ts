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
  return result.stdout;
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

// Board stills with one distinct solid color each, so every animatic frame shows which still it holds.
const colors:Record<string,string> = {'remotion-f000':'0xE02020','remotion-f005':'0x20E020','hyperframes-f000':'0x2020E0','hyperframes-f005':'0xE0E020'};
function paint(file:string, color:string) {
  const made = spawnSync('ffmpeg',['-v','error','-y','-f','lavfi','-i',`color=c=${color}:s=320x180`,'-frames:v','1','-pix_fmt','rgb24',file],{encoding:'utf8',timeout:15000});
  expect(made.status).toBe(0);
}
const solid = (color:string) => [Number(`0x${color.slice(2,4)}`),Number(`0x${color.slice(4,6)}`),Number(`0x${color.slice(6,8)}`)];
/** The still whose color is nearest to the mean color of a decoded frame, and that distance. */
function held(pixels:Uint8Array):[string,number] {
  const mean = [0,1,2].map(c => {let sum = 0; for (let i=c;i<pixels.length;i+=3) sum += pixels[i]; return sum/(pixels.length/3);});
  return Object.entries(colors).map(([name,color]) => [name,Math.max(...solid(color).map((v,c) => Math.abs(v-mean[c])))] as [string,number]).sort((a,b) => a[1]-b[1])[0];
}

test('animatic holds the frozen G2 stills on the real track, with each shot entry and exit frame', async () => {
  const dir = await copyFilm();
  try {
    const g2 = join(dir,'stills','G2','16x9');
    await mkdir(g2,{recursive:true});
    for (const [name,color] of Object.entries(colors)) paint(join(g2,`${name}.png`),color);
    // Before G2 is approved there are no frozen stills to assemble.
    const early = run('node','animatic',dir);
    expect(early.stderr).toBe('error: animatic uses the frozen G2 stills: approve G2 first (G2 is pending)\n');
    expect(early.status).toBe(1);

    await mkdir(join(dir,'stills','G1'),{recursive:true});
    await writeFile(join(dir,'stills','G1','look-a.png'),'look');
    ok('node','gate',dir,'G1','approve');
    ok('node','gate',dir,'G2','approve');
    // A later live change is not what G2 approved: the animatic keeps using the frozen copy.
    paint(join(g2,'remotion-f000.png'),'0xFFFFFF');
    expect(ok('bun','animatic',dir)).toMatch(/^animatic 16:9: 12 frames from 2 shots, stills stills\/approved\/G2-[0-9a-f]{8}\/16x9, audio music-bed -> animatic\.mp4\n$/);

    const video = join(dir,'animatic.mp4');
    const streams = probe(video);
    expect(streams.map((s:{codec_type:string}) => s.codec_type).sort()).toEqual(['audio','video']);
    expect(Number(streams.find((s:{codec_type:string}) => s.codec_type === 'video').nb_read_frames)).toBe(12);
    // 12 frames at 30 fps: the track is cut to 0.4 s (AAC frames are 1024 samples, about 21 ms).
    expect(Math.abs(Number(streams.find((s:{codec_type:string}) => s.codec_type === 'audio').duration) - 0.4)).toBeLessThan(0.025);
    // The track is the fixture's music bed, not silence.
    const peak = spawnSync('ffmpeg',['-hide_banner','-nostats','-i',video,'-map','0:a:0','-af','astats=measure_overall=Peak_level:measure_perchannel=none','-f','null','-'],{encoding:'utf8',timeout:15000}).stderr;
    expect(Number(/Peak level dB:\s*(-?[\d.]+|-inf)/.exec(peak)?.[1])).toBeGreaterThan(-40);
    // Stills hold until the next still of the shot; each shot's exit still shows on its last frame (5 and 11).
    const expected = ['remotion-f000','remotion-f000','remotion-f000','remotion-f000','remotion-f000','remotion-f005',
      'hyperframes-f000','hyperframes-f000','hyperframes-f000','hyperframes-f000','hyperframes-f000','hyperframes-f005'];
    const shown = expected.map((_,frame) => held(rgb(video,frame)));
    expect(shown.map(s => s[0])).toEqual(expected);
    for (const [,distance] of shown) expect(distance).toBeLessThan(8);

    // Without an exit still the animatic cannot show the shot's exit frame, so it refuses.
    await rm(join(g2,'hyperframes-f005.png'));
    paint(join(g2,'remotion-f000.png'),colors['remotion-f000']);
    ok('node','gate',dir,'G2','approve');
    const missing = run('node','animatic',dir);
    expect(missing.stderr).toMatch(/^error: frozen G2 stills \(.*\) miss hyperframes exit frame 5; render them with stills and approve G2 again\n$/);
    expect(missing.status).toBe(1);
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
    story.shots.push({...story.shots[0], id:'tail', startFrame:785, endFrame:790, soundCues:[], stillFrames:[0]});
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
