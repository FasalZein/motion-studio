import {test as nodeTest} from 'node:test';
const {expect} = await import('bun' in process.versions ? 'bun:test' : 'expect');
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {cp, mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';

// Black-box scan fixtures (spec seam 1). Each video is drawn frame by frame in this file and encoded with ffmpeg into
// the lossless master format, so every defect, its frame and its shot are known by construction. A defect video is
// the clean video with one change. The clean video holds the counterexamples: a hard cut at frame 20 (new background
// and box color), a declared 2-frame hold, an undeclared 8-frame hold and fast motion with motion blur.
const test = (name:string, fn:()=>Promise<void>, timeout=120000) => nodeTest(name,{timeout},fn);
const here = dirname(fileURLToPath(import.meta.url));
const cli = resolve(here,'../dist/cli.js');
const fixture = resolve(here,'../fixtures/two-engine');
// Each test runner checks the CLI under its own runtime; npm test runs both runners.
const runtime = 'bun' in process.versions ? 'bun' : 'node';
const run = (...args:string[]) => spawnSync(runtime,[cli,'scan',...args],{encoding:'utf8',timeout:60000});
type Json = Record<string,any>;

const W = 320, H = 180, FRAMES = 40, CUT = 20;
type RGB = [number,number,number];
type Scene = {bg:RGB; box:RGB; x:number; blur:number};
/** Shot "remotion" (frames 0-19): box moves 2 px per frame over frames 0-8, holds over 9-16, moves again over 17-19. */
const slowX = (f:number) => 20 + 2*Math.min(f,8) + 2*Math.max(0,f-16);
/** Shot "hyperframes" (frames 20-39): box moves 14 px per frame with motion blur across each step. */
const fastX = (f:number) => 10 + 14*(f-CUT);
const clean = ():Scene[] => Array.from({length:FRAMES},(_,f) => f < CUT
  ? {bg:[40,40,48], box:[230,200,60], x:slowX(f), blur:0}
  : {bg:[30,60,110], box:[240,240,240], x:fastX(f), blur:14});
// The declared hold: frames 6-7 repeat frame 5 inside motion.
const withDeclaredHold = (scenes:Scene[]) => {scenes[6] = {...scenes[5]}; scenes[7] = {...scenes[5]}; return scenes;};

function draw({bg,box,x,blur}:Scene):Buffer {
  const frame = Buffer.alloc(W*H*3);
  for (let p=0;p<W*H;p++) frame.set(bg,p*3);
  // Motion blur: the 40x40 box averaged over 8 positions across the step, like an open shutter.
  const samples = blur ? 8 : 1;
  const cover = new Float64Array(W);
  for (let s=0;s<samples;s++) {
    const left = Math.round(x + (blur ? blur*(s/(samples-1) - 0.5) : 0));
    for (let px=Math.max(0,left);px<Math.min(W,left+40);px++) cover[px] += 1/samples;
  }
  for (let y=70;y<110;y++) for (let px=0;px<W;px++) if (cover[px]) for (let c=0;c<3;c++) frame[(y*W+px)*3+c] = Math.round(bg[c]*(1-cover[px]) + box[c]*cover[px]);
  return frame;
}
const blend = (a:Buffer, b:Buffer, weight:number) => Buffer.from(a.map((v,i) => Math.round(v*weight + b[i]*(1-weight))));
/**
 * Runs ffmpeg with raw input from a temp file instead of stdin: under load, spawnSync with a large `input` hung
 * twice with ffmpeg waiting on stdin and the test process idle (full suite, 2026-09-29).
 */
function ffmpegWithInput(args:string[], input:Buffer) {
  const file = join(mkdtempSync(join(tmpdir(),'motion-studio-raw-')),'input.raw');
  // The same 60 s bound as this file's CLI runs, so a stall fails the test instead of hanging the suite.
  try {
    writeFileSync(file,input);
    return spawnSync('ffmpeg',args.map((a,i) => a === '-' && args[i-1] === '-i' ? file : a),{maxBuffer:1<<30,timeout:60000});
  }
  finally {rmSync(dirname(file),{recursive:true,force:true});}
}
/** Encodes RGB frames into the master format: FFV1, yuv444p, BT.709 tags, 30 fps. */
async function encode(frames:Buffer[], file:string) {
  await mkdir(dirname(file),{recursive:true});
  const result = ffmpegWithInput(['-hide_banner','-loglevel','error','-y','-f','rawvideo','-pix_fmt','rgb24','-s',`${W}x${H}`,'-r','30','-i','-','-vf','scale=out_color_matrix=bt709,format=yuv444p,setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709','-c:v','ffv1','-level','3','-colorspace','bt709','-color_trc','bt709','-color_primaries','bt709',file],Buffer.concat(frames));
  if (result.status !== 0) throw Error(`ffmpeg failed: ${result.stderr}`);
}
/** A film of two shots cut on the beat at frame 20, with a stitched master built from the given frames. */
async function withFilm(frames:Buffer[], fn:(dir:string)=>Promise<void>, change:(s:Json)=>void = () => {}) {
  const dir = await mkdtemp(join(tmpdir(),'motion-studio-scan-'));
  try {
    await cp(fixture,dir,{recursive:true,filter:src => !src.endsWith('/renders')});
    const s = JSON.parse(await readFile(join(dir,'storyboard.json'),'utf8'));
    s.meta.durationFrames = FRAMES;
    s.audio.beatFrames = [CUT];
    s.shots[0].endFrame = CUT;
    s.shots[0].holds = [{start:6, frames:2}];
    Object.assign(s.shots[1],{startFrame:CUT, endFrame:FRAMES, soundCues:[]});
    change(s);
    await writeFile(join(dir,'storyboard.json'),JSON.stringify(s,null,2));
    await encode(frames,join(dir,'renders/16x9/master.mkv'));
    await writeFile(join(dir,'renders/16x9/render.json'),'{}');
    await fn(dir);
  } finally {await rm(dir,{recursive:true,force:true});}
}
const report = async (dir:string):Promise<Json> => JSON.parse(await readFile(join(dir,'renders/16x9/scan.json'),'utf8'));
const defects = (r:Json) => r.flags.filter((f:Json) => f.status === 'defect').map((f:Json) => [f.kind,f.frame,f.shot,f.localFrame,f.severity]);
const summary = (blocking:number, advisory:number, context:number) => `scan 16:9: ${blocking} blocking, ${advisory} advisory, ${context} context (renders/16x9/scan.json)\n`;
const cleanFrames = () => withDeclaredHold(clean()).map(draw);

test(`${runtime}: a clean film with a hard cut, holds and fast motion blur has no defects`, async () => withFilm(cleanFrames(), async dir => {
  const result = run(dir);
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
  const r = await report(dir);
  expect(defects(r)).toEqual([]);
  expect(r.frameCount).toEqual({expected:FRAMES, decoded:FRAMES});
  // The hard cut and the declared hold are found and reported as context, not as defects.
  expect(r.flags.map((f:Json) => [f.kind,f.frame,f.context])).toEqual([['stutter',6,'declared hold'],['color-jump',CUT,'declared cut into shot hyperframes']]);
  expect(result.stdout).toBe(summary(0,0,2));
}));

test(`${runtime}: without the declared hold, a 2-frame repeat inside motion is an advisory stutter`, async () => withFilm(cleanFrames(), async dir => {
  const result = run(dir);
  expect(result.status).toBe(0);
  expect(defects(await report(dir))).toEqual([['stutter',6,'remotion',6,'advisory']]);
  expect(result.stderr).toBe('warning: 16:9: stutter at frame 6 (2 frames) (shot remotion, local frame 6)\n');
}, s => {delete s.shots[0].holds;}));

test(`${runtime}: a blank frame blocks, unless a declared effect covers it`, async () => {
  const frames = cleanFrames();
  frames[5] = draw({bg:[0,0,0], box:[0,0,0], x:0, blur:0});
  await withFilm(frames, async dir => {
    const result = run(dir);
    expect(result.status).toBe(1);
    expect(result.stderr).toBe('error: 16:9: blank at frame 5 (shot remotion, local frame 5)\n');
    expect(defects(await report(dir))).toEqual([['blank',5,'remotion',5,'blocking']]);
  });
  await withFilm(frames, async dir => {
    const result = run(dir);
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect((await report(dir)).flags.find((f:Json) => f.kind === 'blank').context).toBe('effect custom:black frame in shot remotion');
  }, s => {s.shots[0].effects = [{start:5, frames:1, term:'custom:black frame'}];});
});

test(`${runtime}: an unintended single-frame pop blocks`, async () => {
  const scenes = withDeclaredHold(clean());
  scenes[4] = {...scenes[4], x:scenes[4].x+100};
  await withFilm(scenes.map(draw), async dir => {
    const result = run(dir);
    expect(result.status).toBe(1);
    expect(result.stderr).toBe('error: 16:9: pop at frame 4 (shot remotion, local frame 4)\n');
    expect(defects(await report(dir))).toEqual([['pop',4,'remotion',4,'blocking']]);
  });
});

/** One picture across the seam: the slow box keeps moving 2 px per frame over the same background in both shots. */
const continuous = ():Scene[] => Array.from({length:FRAMES},(_,f) => ({bg:[40,40,48], box:[230,200,60], x:20+2*f, blur:0}));

test(`${runtime}: a pop on the first frame of a shot blocks; a seam explains no pop`, async () => {
  // Both shots show the same picture, so frames 19 and 21 match; frame 20 (shot hyperframes, local 0) is wrong.
  const scenes = continuous();
  scenes[CUT] = {...scenes[CUT], x:scenes[CUT].x+100};
  await withFilm(scenes.map(draw), async dir => {
    const result = run(dir);
    expect(result.status).toBe(1);
    expect(result.stderr).toBe('error: 16:9: pop at frame 20 (shot hyperframes, local frame 0)\n');
  }, s => {delete s.shots[0].holds;});
});

test(`${runtime}: a repeated frame at a cut is a stutter; at a handoff seam it is context`, async () => {
  // Shot hyperframes opens on the last frame of shot remotion, then the motion continues.
  const frames = continuous().map(draw);
  frames[CUT] = frames[CUT-1];
  await withFilm(frames, async dir => {
    const result = run(dir);
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('warning: 16:9: stutter at frame 20 (shot hyperframes, local frame 0)\n');
  }, s => {delete s.shots[0].holds;});
  await withFilm(frames, async dir => {
    const result = run(dir);
    expect(result.stderr).toBe('');
    expect((await report(dir)).flags.map((f:Json) => [f.kind,f.frame,f.context])).toEqual([['stutter',CUT,'handoff seam into shot hyperframes']]);
  }, s => {delete s.shots[0].holds; s.shots[0].exit = 'handoff'; s.shots[1].entry = 'handoff';});
});

test(`${runtime}: an ease-out that stops before a cut is context, not a stutter`, async () => {
  // Frames 18 and 19 repeat frame 17: the box settles 2 frames before the cut at frame 20.
  const scenes = withDeclaredHold(clean());
  scenes[18] = {...scenes[17]}; scenes[19] = {...scenes[17]};
  await withFilm(scenes.map(draw), async dir => {
    const result = run(dir);
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect((await report(dir)).flags.find((f:Json) => f.kind === 'stutter' && f.frame === 18).context).toBe('declared cut into shot hyperframes');
  });
});

test(`${runtime}: a flat opening and a fade in from a flat color are advisory`, async () => {
  // Frames 0-3 show only the background, then the content cuts in.
  const opening = cleanFrames();
  for (let f=0;f<4;f++) opening[f] = draw({bg:[40,40,48], box:[40,40,48], x:0, blur:0});
  await withFilm(opening, async dir => {
    const result = run(dir);
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('warning: 16:9: flat at frame 0 (4 frames) (shot remotion, local frame 0)\n');
  });
  // Shot hyperframes cuts to black for frames 20-24, then a still box fades in over 12 frames: the flat run has a
  // hard edge into it but a soft edge out of it, so it is not a sudden dropout.
  const fade = cleanFrames();
  const black:RGB = [0,0,0], still = {bg:black, box:[240,240,240] as RGB, x:140, blur:0};
  for (let f=CUT;f<FRAMES;f++) fade[f] = blend(draw(still),draw({...still, box:black}),Math.min(1,Math.max(0,(f-24)/12)));
  await withFilm(fade, async dir => {
    const result = run(dir);
    expect(result.status).toBe(0);
    expect(defects(await report(dir))).toEqual([['flat',CUT,'hyperframes',0,'advisory']]);
  });
});

test(`${runtime}: a sudden flat dropout and a fully flat shot block`, async () => {
  // Frames 30-33 go black between moving frames, with hard edges in and out.
  const dropout = cleanFrames();
  for (let f=30;f<34;f++) dropout[f] = draw({bg:[0,0,0], box:[0,0,0], x:0, blur:0});
  await withFilm(dropout, async dir => {
    const result = run(dir);
    expect(result.status).toBe(1);
    expect(result.stderr).toBe('error: 16:9: blank at frame 30 (4 frames) (shot hyperframes, local frame 10)\n');
  });
  // An effect explains a run only when the run lies inside it: an effect over frames 30-31 does not explain 30-33.
  await withFilm(dropout, async dir => {
    const result = run(dir);
    expect(result.status).toBe(1);
    expect(defects(await report(dir))).toEqual([['blank',30,'hyperframes',10,'blocking']]);
  }, s => {s.shots[1].effects = [{start:10, frames:2, term:'custom:black frame'}];});
  // Shot hyperframes rendered nothing: all its frames are the flat background, up to the end of the film.
  const empty = cleanFrames();
  for (let f=CUT;f<FRAMES;f++) empty[f] = draw({bg:[30,60,110], box:[30,60,110], x:0, blur:0});
  await withFilm(empty, async dir => {
    const result = run(dir);
    expect(result.status).toBe(1);
    expect(result.stderr).toBe('error: 16:9: blank at frame 20 (20 frames) (shot hyperframes, local frame 0)\n');
  });
});

test(`${runtime}: one wrong frame blocks as a pop, while a one-frame brightness flash stays advisory`, async () => {
  // Frame 12 is a bright frame from another scene, inside the undeclared hold of shot remotion.
  const wrong = cleanFrames();
  wrong[12] = draw({bg:[220,220,200], box:[20,20,20], x:200, blur:0});
  await withFilm(wrong, async dir => {
    const result = run(dir);
    expect(result.status).toBe(1);
    expect(result.stderr).toBe('error: 16:9: pop at frame 12 (shot remotion, local frame 12)\n');
  });
  const flash = cleanFrames();
  flash[12] = blend(draw({bg:[255,255,255], box:[255,255,255], x:0, blur:0}),flash[12],0.6);
  await withFilm(flash, async dir => {
    const result = run(dir);
    expect(result.status).toBe(0);
    expect(defects(await report(dir))).toEqual([['flash',12,'remotion',12,'advisory']]);
  });
});

test(`${runtime}: a one-frame radial glow is an advisory flash, in a still and in a fast shot`, async () => {
  // A white glow at the frame center that fades to nothing at the edges: a flash that no single gain explains.
  const glow = (frame:Buffer) => {
    const g = Buffer.from(frame);
    for (let y=0;y<H;y++) for (let x=0;x<W;x++) {
      const a = 0.9*Math.max(0,1-Math.hypot((x-160)/160,(y-90)/90));
      for (let c=0;c<3;c++) g[(y*W+x)*3+c] = Math.round(255*a + g[(y*W+x)*3+c]*(1-a));
    }
    return g;
  };
  const frames = cleanFrames();
  frames[12] = glow(frames[12]);
  frames[30] = glow(frames[30]);
  await withFilm(frames, async dir => {
    const result = run(dir);
    expect(result.status).toBe(0);
    expect(defects(await report(dir))).toEqual([['flash',12,'remotion',12,'advisory'],['flash',30,'hyperframes',10,'advisory']]);
  });
});

test(`${runtime}: a thin bar sweeping fast gives one cell-pop run, not one flag per frame`, async () => {
  // A 4 px yellow bar crosses shot hyperframes at 40 px per frame, wrapping every 8 frames.
  const frames = cleanFrames().map((frame,f) => {
    if (f < CUT) return frame;
    const b = Buffer.from(frame), x0 = (f-CUT)*40 % W;
    for (let y=10;y<50;y++) for (let x=x0;x<Math.min(W,x0+4);x++) b.set([255,255,0],(y*W+x)*3);
    return b;
  });
  await withFilm(frames, async dir => {
    const result = run(dir);
    expect(result.status).toBe(0);
    const pops = defects(await report(dir)).filter((d:any[]) => d[0] === 'cell-pop');
    expect(pops.length).toBe(1);
    expect(result.stderr.split('\n').filter((l:string) => l.includes('cell-pop')).length).toBe(1);
  });
});

test(`${runtime}: a small one-frame pop during fast motion is an advisory cell pop`, async () => {
  // A 20x20 white square appears for frame 30 only, away from the moving box.
  const frames = cleanFrames();
  frames[30] = Buffer.from(frames[30]);
  for (let y=20;y<40;y++) for (let x=260;x<280;x++) frames[30].set([255,255,255],(y*W+x)*3);
  await withFilm(frames, async dir => {
    const result = run(dir);
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('warning: 16:9: cell-pop at frame 30 (shot hyperframes, local frame 10)\n');
  });
});

test(`${runtime}: a declared move explains a cell pop inside it, but never a pop`, async () => {
  // The cell pop of the test above (frame 30, local frame 10 of shot hyperframes) inside a declared move over local
  // frames 8-12: a spring overshoot gives the same per-cell change and return, so the declaration makes it context.
  const frames = cleanFrames();
  frames[30] = Buffer.from(frames[30]);
  for (let y=20;y<40;y++) for (let x=260;x<280;x++) frames[30].set([255,255,255],(y*W+x)*3);
  await withFilm(frames, async dir => {
    const result = run(dir);
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    // Context: the declared hold, the cut and the cell pop.
    expect(result.stdout).toBe(summary(0,0,3));
    const flags = (await report(dir)).flags.filter((f:Json) => f.kind === 'cell-pop');
    expect(flags.map((f:Json) => [f.frame,f.status,f.context])).toEqual([[30,'context','move custom:spring overshoot in shot hyperframes']]);
  }, s => {s.shots[1].moves = [{start:8, frames:5, term:'custom:spring overshoot'}];});
  // The whole-frame pop at frame 4 inside a declared move over local frames 2-6 of shot remotion still blocks.
  const scenes = withDeclaredHold(clean());
  scenes[4] = {...scenes[4], x:scenes[4].x+100};
  await withFilm(scenes.map(draw), async dir => {
    const result = run(dir);
    expect(result.status).toBe(1);
    expect(result.stderr).toBe('error: 16:9: pop at frame 4 (shot remotion, local frame 4)\n');
  }, s => {s.shots[0].moves = [{start:2, frames:5, term:'custom:spring overshoot'}];});
});

test(`${runtime}: a frame-count error blocks`, async () => withFilm(cleanFrames().slice(0,FRAMES-1), async dir => {
  const result = run(dir);
  expect(result.status).toBe(1);
  expect(result.stderr).toBe(`error: 16:9: frame-count expected ${FRAMES} frames, decoded ${FRAMES-1}\n`);
  expect(defects(await report(dir))).toEqual([['frame-count',FRAMES-1,'hyperframes',FRAMES-1-CUT,'blocking']]);
}));

test(`${runtime}: a hitch (skipped frames) inside motion is advisory`, async () => {
  // From frame 30 the fast box is 2 steps further on: one 42 px step between 14 px steps.
  const scenes = withDeclaredHold(clean()).map((s,f) => f >= 30 ? {...s, x:s.x+28} : s);
  await withFilm(scenes.map(draw), async dir => {
    const result = run(dir);
    expect(result.status).toBe(0);
    expect(defects(await report(dir))).toEqual([['hitch',30,'hyperframes',10,'advisory']]);
  });
});

test(`${runtime}: a flash is advisory, and a declared effect makes it context`, async () => {
  const frames = cleanFrames();
  const white = draw({bg:[255,255,255], box:[255,255,255], x:0, blur:0});
  for (const f of [30,31]) frames[f] = blend(white,frames[f],0.6);
  await withFilm(frames, async dir => {
    const result = run(dir);
    expect(result.status).toBe(0);
    expect(defects(await report(dir))).toEqual([['flash',30,'hyperframes',10,'advisory']]);
    expect(result.stderr).toBe('warning: 16:9: flash at frame 30 (2 frames) (shot hyperframes, local frame 10)\n');
  });
  await withFilm(frames, async dir => {
    const result = run(dir);
    expect(result.stderr).toBe('');
    expect(defects(await report(dir))).toEqual([]);
  }, s => {s.shots[1].effects = [{start:10, frames:2, term:'custom:beat flash'}];});
});

test(`${runtime}: a color jump inside a shot is advisory`, async () => {
  // From frame 30 every pixel gains 30 levels of red: a grade change with no cut.
  const frames = cleanFrames().map((frame,f) => f < 30 ? frame : Buffer.from(frame.map((v,i) => i%3 === 0 ? Math.min(255,v+30) : v)));
  await withFilm(frames, async dir => {
    const result = run(dir);
    expect(result.status).toBe(0);
    expect(defects(await report(dir))).toEqual([['color-jump',30,'hyperframes',10,'advisory']]);
  });
});

test(`${runtime}: a blended frame at a cut is an advisory ghost`, async () => {
  const frames = cleanFrames();
  frames[CUT] = blend(frames[CUT-1],frames[CUT+1],0.5);
  await withFilm(frames, async dir => {
    const result = run(dir);
    expect(result.status).toBe(0);
    expect(defects(await report(dir))).toEqual([['ghost',CUT,'hyperframes',0,'advisory']]);
  });
});

test(`${runtime}: standalone scan of a video file has no declared context`, async () => {
  const dir = await mkdtemp(join(tmpdir(),'motion-studio-scan-file-'));
  try {
    // A pop inside the undeclared 8-frame hold (frames 8-16).
    const scenes = withDeclaredHold(clean());
    scenes[12] = {...scenes[12], x:scenes[12].x+100};
    const video = join(dir,'pop.mkv');
    await encode(scenes.map(draw),video);
    const result = run(video,'--report',join(dir,'scan.json'));
    expect(result.status).toBe(1);
    const r = JSON.parse(await readFile(join(dir,'scan.json'),'utf8'));
    expect(r.fps).toBe(30);
    // Matroska records no frame count, so the count is not checked. With no declared cut or hold, the hard cut and
    // the hold go to the reviewer as advisory flags; the pop still blocks.
    expect(r.frameCount).toEqual({expected:null, decoded:FRAMES});
    expect(defects(r)).toEqual([['stutter',6,null,null,'advisory'],['pop',12,null,null,'blocking'],['color-jump',CUT,null,null,'advisory']]);
    expect(result.stdout).toBe(`scan ${video}: 1 blocking, 2 advisory, 0 context (${join(dir,'scan.json')})\n`);
  } finally {await rm(dir,{recursive:true,force:true});}
});

test(`${runtime}: scan needs a stitched master, and validate rejects a hold outside its shot`, async () => withFilm(cleanFrames(), async dir => {
  await rm(join(dir,'renders/16x9/render.json'));
  const result = run(dir);
  expect(result.status).toBe(1);
  expect(result.stderr).toBe('error: successful render and stitch required before scan: 16:9\n');
  const s = JSON.parse(await readFile(join(dir,'storyboard.json'),'utf8'));
  s.shots[1].effects = [{start:19, frames:2, term:'custom:flash'}];
  s.shots[1].moves = [{start:18, frames:3, term:'custom:spring overshoot'}];
  await writeFile(join(dir,'storyboard.json'),JSON.stringify(s));
  const invalid = spawnSync(runtime,[cli,'validate',dir],{encoding:'utf8'});
  expect(invalid.status).toBe(1);
  expect(invalid.stderr).toBe('error: shot hyperframes: effect at local frame 19 for 2 frames ends after the shot (shot-local frames 0 to 19)\nerror: shot hyperframes: move at local frame 18 for 3 frames ends after the shot (shot-local frames 0 to 19)\n');
}));
