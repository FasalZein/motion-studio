import {test as nodeTest, after} from 'node:test';
const {expect} = await import('bun' in process.versions ? 'bun:test' : 'expect');
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';

// Black-box liveness fixtures (spec seam 1). Every video is drawn here sample by sample: a 40x40 box on a fixed
// textured background moves 2 px per step, or holds by repeating the picture. A lone video is encoded at 12 fps, so
// one frame is one analysis sample; a film master at 24 fps draws each sample twice. Every still span, share and
// limit below is counted from the drawn pattern: a hold of n steps is a still span of n/12 s.
const test = (name:string, fn:()=>Promise<void>, timeout=180000) => nodeTest(name,{timeout},fn);
const here = dirname(fileURLToPath(import.meta.url));
const cli = resolve(here,'../dist/cli.js');
const fixture = resolve(here,'../fixtures/two-engine');
const runtime = 'bun' in process.versions ? 'bun' : 'node';
// The CLI's scratch files go to a private TMPDIR, so the test can check that it leaves none behind.
const privateTmp = await mkdtemp(join(tmpdir(),'motion-studio-liveness-tmp-'));
after(async () => {await rm(privateTmp,{recursive:true,force:true});});
const run = (...args:string[]) => spawnSync(runtime,[cli,...args],{encoding:'utf8',timeout:120000,env:{...process.env,TMPDIR:privateTmp}});
type Json = Record<string,any>;

const W = 320, H = 180;
// A fixed pseudo-random texture: an H.264 encode then leaves small residual changes in held pictures.
const texture = (() => {
  const t = Buffer.alloc(W*H);
  let seed = 7;
  for (let i=0;i<t.length;i++) {seed = (seed*1103515245+12345) % 2147483648; t[i] = 40+(seed>>16)%60;}
  return t;
})();
type Picture = {kind:'box'; pos:number}|{kind:'black'}|{kind:'card'};
function draw(p:Picture):Buffer {
  if (p.kind === 'black') return Buffer.alloc(W*H);
  const frame = Buffer.from(texture);
  // The box wraps around after 130 positions, so two consecutive positions never draw the same picture.
  const [x,y,w,h] = p.kind === 'box' ? [20+2*(p.pos%130),70,40,40] : [60,80,200,20];
  for (let r=y;r<y+h;r++) frame.fill(220,r*W+x,r*W+x+w);
  return frame;
}
/** Segments in steps: `move` advances the box once per step, `hold` repeats the last picture. */
type Segment = ['move'|'hold'|'black'|'card', number];
function samples(segments:Segment[], start:Picture|null = {kind:'box', pos:0}):Picture[] {
  const out:Picture[] = start ? [start] : [];
  let pos = 0;
  for (const [kind,n] of segments) for (let i=0;i<n;i++) {
    if (kind === 'move') out.push({kind:'box', pos:++pos});
    else if (kind === 'hold') out.push(out.at(-1)!);
    else out.push({kind});
  }
  return out;
}
/**
 * Runs ffmpeg with raw input from a temp file instead of stdin: under load, spawnSync with a large `input` hung
 * twice with ffmpeg waiting on stdin and the test process idle (full suite, 2026-09-29).
 */
function ffmpegWithInput(args:string[], input:Buffer) {
  const file = join(mkdtempSync(join(tmpdir(),'motion-studio-raw-')),'input.raw');
  // A 60 s bound, as in the scan and critique CLI runs, so a stall fails the test instead of hanging the suite.
  try {
    writeFileSync(file,input);
    return spawnSync('ffmpeg',args.map((a,i) => a === '-' && args[i-1] === '-i' ? file : a),{maxBuffer:1<<30,timeout:60000});
  }
  finally {rmSync(dirname(file),{recursive:true,force:true});}
}
function encode(pictures:Picture[], file:string, fps:number, codec:'ffv1'|'h264') {
  const repeat = fps/12;
  const raw = Buffer.concat(pictures.flatMap(p => Array(repeat).fill(draw(p))));
  const args = codec === 'ffv1' ? ['-c:v','ffv1','-pix_fmt','gray'] : ['-c:v','libx264','-crf','23','-pix_fmt','yuv420p'];
  const result = ffmpegWithInput(['-hide_banner','-loglevel','error','-y','-f','rawvideo','-pix_fmt','gray','-s',`${W}x${H}`,'-r',String(fps),'-i','-',...args,file],raw);
  if (result.status !== 0) throw Error(`ffmpeg failed: ${result.stderr}`);
}

/** Runs standalone liveness on a drawn 12 fps video and returns the process result and the report. */
async function lone(segments:Segment[], codec:'ffv1'|'h264' = 'ffv1') {
  const dir = await mkdtemp(join(tmpdir(),'motion-studio-liveness-'));
  try {
    const video = join(dir,codec === 'ffv1' ? 'lone.mkv' : 'lone.mp4');
    encode(samples(segments),video,12,codec);
    const result = run('liveness',video,'--report',join(dir,'report.json'));
    return {result, report:JSON.parse(await readFile(join(dir,'report.json'),'utf8')) as Json, video};
  } finally {await rm(dir,{recursive:true,force:true});}
}
const failed = (r:Json) => r.limits.filter((l:Json) => !l.pass).map((l:Json) => l.metric);
const times = (n:number, ...segments:Segment[]):Segment[] => Array.from({length:n},() => segments).flat();

test(`${runtime}: continuous motion passes; burst and hold fails every limit`, async () => {
  const smooth = await lone([['move',120]]);
  expect(smooth.result.stderr).toBe('');
  expect(smooth.result.status).toBe(0);
  expect(smooth.report).toMatchObject({pass:true, movingShare:1, stillShare:{over0_5:0, over1:0, over2:0}, longestStillSeconds:0, samples:121, excluded:[], stillSpans:[]});
  // 0.5 s of motion, then a 2.5 s hold, five times, then 0.5 s of motion: 36 moving steps of 186.
  const burst = await lone([...times(5,['move',6],['hold',30]),['move',6]]);
  expect(burst.result.status).toBe(1);
  expect(burst.report.pass).toBe(false);
  expect(burst.report.movingShare).toBe(Math.round(36/186*1000)/1000);
  expect(burst.report.stillShare).toEqual({over0_5:0.806, over1:0.806, over2:0.806});
  expect(burst.report.longestStillSeconds).toBe(2.5);
  expect(burst.report.stillSpans.map((s:Json) => [s.startSecond,s.seconds])).toEqual([0.5,3.5,6.5,9.5,12.5].map(t => [t,2.5]));
  expect(failed(burst.report)).toEqual(['moving share','still over 0.5 s share','still over 1 s share','still over 2 s share','longest still span']);
  const video = burst.video;
  expect(burst.result.stderr).toBe([
    'moving share 0.194 is below the minimum 0.75',
    'still over 0.5 s share 0.806 is above the maximum 0.1',
    'still over 1 s share 0.806 is above the maximum 0.05',
    'still over 2 s share 0.806 is above the maximum 0.04',
    'longest still span 2.5 s is above the maximum 2 s (film under 90 s)',
  ].map(l => `error: ${video}: ${l}\n`).join(''));
  expect((await readdir(privateTmp)).filter(f => f.startsWith('motion-liveness-'))).toEqual([]);
});

// Each boundary: the pass side sits on the limit, the fail side one step past it; the other limits stay met. Every
// pattern ends in motion, so no trailing hold leaves the content basis.
async function boundary(pass:Segment[], fail:Segment[], metric:string, values:[unknown,unknown], read:(r:Json)=>unknown) {
  const ok = await lone(pass);
  expect(read(ok.report)).toEqual(values[0]);
  expect(failed(ok.report)).toEqual([]);
  expect(ok.result.status).toBe(0);
  const bad = await lone(fail);
  expect(read(bad.report)).toEqual(values[1]);
  expect(failed(bad.report)).toEqual([metric]);
  expect(bad.result.status).toBe(1);
  expect(bad.result.stderr).toContain(`error: ${bad.video}: ${metric} `);
}

test(`${runtime}: moving share passes at 75 % and fails below`, async () => {
  // Five 0.5 s holds (6 steps, not over 0.5 s) in 120 steps: 90 move. One more held step: 89 of 120.
  await boundary([...times(5,['move',15],['hold',6]),['move',15]], [...times(5,['move',15],['hold',6]),['move',7],['hold',1],['move',7]],
    'moving share', [0.75,0.742], r => r.movingShare);
});

test(`${runtime}: still over 0.5 s share passes at 10 % and fails above`, async () => {
  // Two 7-step holds (0.583 s) in 140 steps: 14/140. Then 7 and 8 steps: 15/140.
  await boundary([['move',60],['hold',7],['move',60],['hold',7],['move',6]], [['move',60],['hold',7],['move',59],['hold',8],['move',6]],
    'still over 0.5 s share', [0.1,0.107], r => r.stillShare.over0_5);
});

test(`${runtime}: still over 1 s share passes at 5 % and fails above`, async () => {
  // One 13-step hold (1.083 s) in 260 steps: 13/260. A 14-step hold: 14/260.
  await boundary([['move',120],['hold',13],['move',127]], [['move',120],['hold',14],['move',126]],
    'still over 1 s share', [0.05,0.054], r => r.stillShare.over1);
});

test(`${runtime}: still over 2 s share passes at 4 % and fails above`, async () => {
  // A film of 90 s or more, so spans up to 3 s are allowed: two 25-step holds (2.083 s) in 1250 steps: 50/1250.
  // Then 25 and 26 steps: 51/1250.
  await boundary([['move',600],['hold',25],['move',575],['hold',25],['move',25]],
    [['move',600],['hold',25],['move',574],['hold',26],['move',25]],
    'still over 2 s share', [0.04,0.041], r => r.stillShare.over2);
});

test(`${runtime}: the longest still span passes at 2 s and fails above in a film under 90 s`, async () => {
  // 650 steps (54 s): a 24-step hold is 2.0 s; 25 steps is 2.083 s, still only 25/650 = 0.038 of the content.
  await boundary([['move',300],['hold',24],['move',326]], [['move',300],['hold',25],['move',325]],
    'longest still span', [2,2.083], r => r.longestStillSeconds);
});

test(`${runtime}: the longest still span limit switches from 2 s to 3 s at a film length of 90 s`, async () => {
  // A 2.5 s hold (30 steps). 1079 samples are 89.92 s: limit 2 s, fail. 1080 samples are 90 s: limit 3 s, pass.
  const short = await lone([['move',500],['hold',30],['move',548]]);
  expect([short.report.durationSeconds,short.report.longestStillSeconds]).toEqual([89.917,2.5]);
  expect(short.report.limits.at(-1)).toEqual({metric:'longest still span', value:2.5, limit:2, direction:'max', pass:false});
  expect(short.result.status).toBe(1);
  const long = await lone([['move',500],['hold',30],['move',549]]);
  expect([long.report.durationSeconds,long.report.longestStillSeconds]).toEqual([90,2.5]);
  expect(long.report.limits.at(-1)).toEqual({metric:'longest still span', value:2.5, limit:3, direction:'max', pass:true});
  expect(long.result.status).toBe(0);
  // From 90 s up, 3 s passes and 37 steps (3.083 s) fail.
  await boundary([['move',500],['hold',36],['move',543]], [['move',500],['hold',37],['move',542]],
    'longest still span', [3,3.083], r => r.longestStillSeconds);
});

test(`${runtime}: an H.264 encode keeps the drawn pattern: continuous passes, burst and hold fails`, async () => {
  // The encoder leaves small residual changes in held pictures; the noise floor keeps them still, so the H.264 encode
  // measures the same 36 moving steps of 186 and the same 2.5 s spans as the drawn pattern.
  const smooth = await lone([['move',120]],'h264');
  expect(smooth.report.movingShare).toBe(1);
  expect(smooth.result.status).toBe(0);
  const burst = await lone([...times(5,['move',6],['hold',30]),['move',6]],'h264');
  expect(burst.report.movingShare).toBe(0.194);
  expect(burst.report.longestStillSeconds).toBe(2.5);
  expect(burst.report.stillSpans.map((s:Json) => s.seconds)).toEqual([2.5,2.5,2.5,2.5,2.5]);
  expect(burst.result.status).toBe(1);
});

// A film master at 24 fps: a 1 s black head (12 black samples), 97 content steps with one 0.75 s hold inside shot
// "hyperframes", and a trailing end card (18 samples). 126 samples, 252 film frames; the cut into shot
// "hyperframes" is at frame 120 (sample 60), inside motion.
const FILM:Segment[] = [['black',12],['move',68],['hold',9],['move',19],['card',18]];
// The same film with a 2.5 s hold across the cut in place of the 0.75 s hold.
const SLIDESHOW:Segment[] = [['black',12],['move',47],['hold',30],['move',19],['card',18]];
const FILM_FRAMES = 252;
async function withFilm(segments:Segment[], fn:(dir:string)=>Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(),'motion-studio-liveness-film-'));
  try {
    await cp(fixture,dir,{recursive:true,filter:src => !src.endsWith('/renders')});
    const s = JSON.parse(await readFile(join(dir,'storyboard.json'),'utf8'));
    s.meta.fps = 24;
    s.meta.durationFrames = FILM_FRAMES;
    s.audio.beatFrames = [120];
    s.shots[0].endFrame = 120;
    Object.assign(s.shots[1],{startFrame:120, endFrame:FILM_FRAMES, soundCues:[]});
    await writeFile(join(dir,'storyboard.json'),JSON.stringify(s,null,2));
    await master(dir,segments);
    await writeFile(join(dir,'renders/16x9/render.json'),'{}');
    await mkdir(join(dir,'stills/G1'),{recursive:true});
    await writeFile(join(dir,'stills/G1/look-a.png'),'look A');
    await fn(dir);
  } finally {await rm(dir,{recursive:true,force:true});}
}
async function master(dir:string, segments:Segment[]) {
  await mkdir(join(dir,'renders/16x9'),{recursive:true});
  encode(samples(segments,null),join(dir,'renders/16x9/master.mkv'),24,'ffv1');
}
const filmReport = async (dir:string):Promise<Json> => JSON.parse(await readFile(join(dir,'renders/16x9/liveness.json'),'utf8'));

test(`${runtime}: a film leaves its black head and end card out of the content basis and locates each still span`, async () => withFilm(FILM, async dir => {
  const result = run('liveness',dir);
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
  const r = await filmReport(dir);
  // Black head: samples 0-11 (11 still steps, frames 0-22). End card: samples 108-125 (17 steps, frames 216-250).
  expect(r.excluded).toEqual([
    {kind:'black', startSecond:0, seconds:0.917, firstFrame:0, lastFrame:22, shots:['remotion']},
    {kind:'end-card', startSecond:9, seconds:1.417, firstFrame:216, lastFrame:250, shots:['hyperframes']},
  ]);
  // 125 steps less 28 excluded; 9 of the 97 content steps are held. The whole-film share counts the excluded steps.
  expect(r).toMatchObject({format:'16:9', video:'renders/16x9/master.mkv', durationSeconds:10.5, contentSeconds:8.083, movingShare:0.907, movingShareWholeFilm:0.704,
    stillShare:{over0_5:0.093, over1:0, over2:0}, longestStillSeconds:0.75, pass:true});
  // The hold repeats sample 79 (frame 158) up to sample 88 (frame 176), inside shot hyperframes.
  expect(r.stillSpans).toEqual([{startSecond:6.583, seconds:0.75, firstFrame:158, lastFrame:176, shots:['hyperframes']}]);
  expect(r.advisory.cuts).toEqual([{shot:'hyperframes', frame:120, bothMove:true}]);
  expect(r.sha256).toMatch(/^[0-9a-f]{64}$/);
  expect(result.stdout).toBe([
    'liveness 16:9: pass: moving 0.907, still over 0.5 s 0.093, over 1 s 0, over 2 s 0, longest still 0.75 s (renders/16x9/liveness.json)',
    '  excluded black 0.917 s at frames 0-22 (shot remotion)',
    '  excluded end-card 1.417 s at frames 216-250 (shot hyperframes)',
    '  still 0.75 s at frames 158-176 (shot hyperframes)',
  ].join('\n')+'\n');
}));

test(`${runtime}: a slideshow film fails, and the report locates the hold across the cut`, async () => withFilm(SLIDESHOW, async dir => {
  const result = run('liveness',dir,'16:9');
  expect(result.status).toBe(1);
  const r = await filmReport(dir);
  // The hold repeats sample 58 (frame 116) up to sample 88 (frame 176), across the cut at frame 120.
  expect(r.stillSpans).toEqual([{startSecond:4.833, seconds:2.5, firstFrame:116, lastFrame:176, shots:['remotion','hyperframes']}]);
  expect(r.advisory.cuts).toEqual([{shot:'hyperframes', frame:120, bothMove:false}]);
  expect(result.stderr).toContain('error: 16:9: longest still span 2.5 s is above the maximum 2 s (film under 90 s)\n');
  expect(run('liveness',dir,'9:16').stderr).toBe('error: format 9:16 is not a chosen format (16:9)\n');
}));

test(`${runtime}: status shows the liveness verdict of each format with a master`, async () => withFilm(SLIDESHOW, async dir => {
  const verdict = () => run('status',dir).stdout.split('\n').filter(l => l.startsWith('liveness'));
  expect(verdict()).toEqual(['liveness 16:9 missing (no readable renders/16x9/liveness.json)']);
  run('liveness',dir);
  expect(verdict()[0]).toMatch(/^liveness 16:9 fail \(moving share 0\.\d+ is below the minimum 0\.75; .*longest still span 2\.5 s is above the maximum 2 s \(film under 90 s\)\)$/);
  await master(dir,FILM);
  expect(verdict()).toEqual(['liveness 16:9 stale (renders/16x9/liveness.json describes another master)']);
  run('liveness',dir);
  expect(verdict()).toEqual(['liveness 16:9 pass (renders/16x9/liveness.json)']);
}));

test(`${runtime}: G4 approval needs a current passing report or a written waiver`, async () => withFilm(SLIDESHOW, async dir => {
  for (const id of ['G1','G2','G3']) expect(run('gate',dir,id,'approve').status).toBe(0);
  const storyboard = async () => JSON.parse(await readFile(join(dir,'storyboard.json'),'utf8'));
  const hint = `; run motion-studio liveness ${dir}, or approve with --waive liveness --note <reason>\n`;
  const refused = async (message:string) => {
    const before = await readFile(join(dir,'storyboard.json'),'utf8');
    const result = run('gate',dir,'G4','approve');
    expect(result.stderr).toBe(`error: cannot approve G4: ${message}${hint}`);
    expect(result.status).toBe(1);
    expect(await readFile(join(dir,'storyboard.json'),'utf8')).toBe(before);
  };
  await refused('liveness 16:9 missing (no readable renders/16x9/liveness.json)');
  expect(run('liveness',dir).status).toBe(1);
  const failing = await filmReport(dir);
  await refused(`liveness 16:9 fail (${failing.failures.join('; ')})`);
  // A new master makes the report stale, even when the new master would pass.
  await master(dir,FILM);
  await refused('liveness 16:9 stale (renders/16x9/liveness.json describes another master)');
  // A waiver needs a note, and applies only to G4 approve.
  expect(run('gate',dir,'G4','approve','--waive','liveness').stderr).toBe('error: --waive liveness needs a --note with the reason\n');
  expect(run('gate',dir,'G3','approve','--waive','liveness','--note','x').stderr).toBe('error: --waive liveness applies only to G4 approve\n');
  expect(run('gate',dir,'G4','approve','--waive','other','--note','x').status).toBe(1);
  // The director waives the stale report with a reason; the gate record keeps it.
  const waived = run('gate',dir,'G4','approve','--waive','liveness','--note','deliberate 2.5 s title hold');
  expect(waived.stderr).toBe('');
  expect(waived.status).toBe(0);
  expect(waived.stdout).toContain('waived: liveness\n');
  expect((await storyboard()).gates[3]).toMatchObject({state:'approved', notes:['deliberate 2.5 s title hold'], waiver:{check:'liveness', reason:'deliberate 2.5 s title hold'}});
  expect(run('validate',dir).status).toBe(0);
  // A passing current report approves without a waiver; the new approval drops the old waiver.
  expect(run('liveness',dir).status).toBe(0);
  const approved = run('gate',dir,'G4','approve');
  expect(approved.stderr).toBe('');
  expect(approved.status).toBe(0);
  const g4 = (await storyboard()).gates[3];
  expect(g4.state).toBe('approved');
  expect(g4.waiver).toBeUndefined();
}));
