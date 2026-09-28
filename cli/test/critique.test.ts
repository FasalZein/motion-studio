import {test as nodeTest} from 'node:test';
const {expect} = await import('bun' in process.versions ? 'bun:test' : 'expect');
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {cp, mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';

// Black-box checks of the deterministic parts of motion-critique: the evidence packet (packet), the dimension 7 rule
// and the calibration band check (calibrate). Every master frame carries its own frame index as the grey level of an
// 8x8 corner patch (level = 6 * frame), so an extracted still-pair frame proves which master frame it is.
const test = (name:string, fn:()=>Promise<void>, timeout=120000) => nodeTest(name,{timeout},fn);
const here = dirname(fileURLToPath(import.meta.url));
const cli = resolve(here,'../dist/cli.js');
const fixture = resolve(here,'../fixtures/two-engine');
const bands = resolve(here,'../../skills/motion-critique/calibration/bands.json');
const runtime = 'bun' in process.versions ? 'bun' : 'node';
const run = (...args:string[]) => spawnSync(runtime,[cli,...args],{encoding:'utf8',timeout:60000});
type Json = Record<string,any>;

const W = 320, H = 180, FRAMES = 40, CUT = 20, LEVEL = 6;
function draw(f:number):Buffer {
  const frame = Buffer.alloc(W*H*3);
  const bg = f < CUT ? [40,40,48] : [30,60,110];
  for (let p=0;p<W*H;p++) frame.set(bg,p*3);
  for (let y=0;y<8;y++) for (let x=0;x<8;x++) frame.fill(LEVEL*f,(y*W+x)*3,(y*W+x)*3+3);
  for (let y=70;y<110;y++) for (let x=20+2*f;x<60+2*f;x++) frame.set([230,200,60],(y*W+x)*3);
  return frame;
}
function ffmpeg(args:string[], input?:Buffer) {
  const r = spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-y',...args],{input,maxBuffer:1<<28});
  if (r.status !== 0) throw Error(`ffmpeg failed: ${r.stderr}`);
  return r.stdout;
}
const raw = ['-f','rawvideo','-pix_fmt','rgb24','-s',`${W}x${H}`];
/** The grey level of the corner patch of a PNG, which names the master frame it came from. */
const cornerLevel = (png:string) => ffmpeg(['-i',png,'-f','rawvideo','-pix_fmt','rgb24','-'])[3*(4*W+4)];

async function withFilm(fn:(dir:string)=>Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(),'motion-studio-critique-'));
  try {
    await cp(fixture,dir,{recursive:true,filter:src => !src.endsWith('/renders')});
    const s = JSON.parse(await readFile(join(dir,'storyboard.json'),'utf8'));
    s.meta.durationFrames = FRAMES;
    s.audio.beatFrames = [CUT];
    s.shots[0].endFrame = CUT;
    Object.assign(s.shots[1],{startFrame:CUT, endFrame:FRAMES, soundCues:[]});
    await writeFile(join(dir,'storyboard.json'),JSON.stringify(s,null,2));
    await mkdir(join(dir,'renders/16x9'),{recursive:true});
    ffmpeg([...raw,'-r','30','-i','-','-vf','scale=out_color_matrix=bt709,format=yuv444p,setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709','-c:v','ffv1','-level','3','-colorspace','bt709','-color_trc','bt709','-color_primaries','bt709',join(dir,'renders/16x9/master.mkv')],Buffer.concat(Array.from({length:FRAMES},(_,f) => draw(f))));
    await writeFile(join(dir,'renders/16x9/render.json'),'{}');
    await fn(dir);
  } finally {await rm(dir,{recursive:true,force:true});}
}
const packet = async (dir:string):Promise<Json> => JSON.parse(await readFile(join(dir,'critique/packet-16x9/packet.json'),'utf8'));
const items = (p:Json) => p.missing.map((m:Json) => m.item);
const sync = (over:Json = {}) => ({targetLufs:-14, integratedLufs:-14.1, truePeakDbtp:-1.3,
  sfx:[{asset:'sfx-hit', eventFrame:20, plannedOffsetFrames:0, peakFrame:20, offsetFrames:0}],
  cuts:[{shot:'hyperframes', frame:20, beatFrame:20, offsetFrames:0}], ...over});

test(`${runtime}: packet pairs each frozen approved still with the exact master frame and lists missing evidence`, async () => withFilm(async dir => {
  // Board stills: shot "remotion" local frame 5 (global 5) and shot "hyperframes" local frame 3 (global 23).
  await mkdir(join(dir,'stills/G2/16x9'),{recursive:true});
  for (const [name,f] of [['remotion-f005',5],['hyperframes-f003',23]] as const) ffmpeg([...raw,'-i','-','-frames:v','1',join(dir,`stills/G2/16x9/${name}.png`)],draw(f));
  for (const g of ['G1','G2']) expect(run('gate',dir,g,'approve').status).toBe(0);
  const result = run('packet',dir);
  expect(result.status).toBe(0);
  const p = await packet(dir);
  expect(p.stillPairs.map((x:Json) => [x.shot,x.localFrame,x.globalFrame])).toEqual([['hyperframes',3,23],['remotion',5,5]]);
  for (const pair of p.stillPairs) {
    expect(pair.approved).toMatch(/^stills\/approved\/G2-[0-9a-f]{8}\/16x9\//);
    // Color conversion through yuv444p rounds by a level or two; neighbouring frames differ by 6.
    expect(Math.abs(cornerLevel(join(dir,pair.rendered))-LEVEL*pair.globalFrame)).toBeLessThanOrEqual(2);
  }
  expect(items(p)).toEqual(['look or style bible','contact sheet and transition strips','scan report','mix sync report']);
  expect(p.dimension7.score).toBe('unverified');
  expect(p.logline).toBe('One Remotion shot cuts on the beat to one HyperFrames shot.');
  expect(p.beatGrid.beatFrames).toEqual([CUT]);
  expect(result.stdout).toContain('packet 16:9: 2 still pairs, 4 missing items, dimension 7 unverified');
}));

test(`${runtime}: packet gathers sheet, a current scan and the sync report; a scan of another master is missing`, async () => withFilm(async dir => {
  expect(run('sheet',dir).status).toBe(0);
  expect(run('scan',dir).status).toBe(0);
  await writeFile(join(dir,'renders/16x9/sync.json'),JSON.stringify(sync()));
  expect(run('packet',dir).status).toBe(0);
  let p = await packet(dir);
  expect(items(p)).toEqual(['look or style bible','frozen approved stills']);
  expect(p.sheet.strips.map((x:Json) => [x.file,x.cut])).toEqual([['renders/16x9/transition-remotion-hyperframes.png',CUT]]);
  expect(p.sheet.pages.map((x:Json) => x.frames)).toEqual([[0,30]]);
  expect(p.scan.report).toBe('renders/16x9/scan.json');
  expect(p.dimension7.score).toBe(8);
  // A report whose master hash differs describes an earlier render.
  const scan = JSON.parse(await readFile(join(dir,'renders/16x9/scan.json'),'utf8'));
  await writeFile(join(dir,'renders/16x9/scan.json'),JSON.stringify({...scan, sha256:'0'.repeat(64)}));
  expect(run('packet',dir).status).toBe(0);
  p = await packet(dir);
  expect(p.scan).toBe(null);
  expect(items(p)).toContain('scan report (describes an earlier master)');
}));

test(`${runtime}: dimension 7 follows the documented rule for offsets and loudness`, async () => withFilm(async dir => {
  const score = async (report:Json) => {
    await writeFile(join(dir,'renders/16x9/sync.json'),JSON.stringify(report));
    expect(run('packet',dir).status).toBe(0);
    return (await packet(dir)).dimension7;
  };
  expect((await score(sync())).score).toBe(8);
  // Within 1 frame is on time; 2-3 frames is noticeable (5); 4 or more is wide (2).
  expect((await score(sync({sfx:[{asset:'sfx-hit', eventFrame:20, plannedOffsetFrames:0, peakFrame:21, offsetFrames:1}]}))).score).toBe(8);
  expect((await score(sync({sfx:[{asset:'sfx-hit', eventFrame:20, plannedOffsetFrames:0, peakFrame:22, offsetFrames:2}]}))).score).toBe(5);
  expect((await score(sync({cuts:[{shot:'hyperframes', frame:20, beatFrame:16, offsetFrames:4}]}))).worstOffsetFrames).toBe(4);
  expect((await score(sync({cuts:[{shot:'hyperframes', frame:20, beatFrame:16, offsetFrames:4}]}))).score).toBe(2);
  // A planned peak offset is intent: the error is measured from the plan.
  expect((await score(sync({sfx:[{asset:'sfx-hit', eventFrame:20, plannedOffsetFrames:3, peakFrame:23, offsetFrames:3}]}))).score).toBe(8);
  // An off-beat cut is judged against its declared timing, not a beat.
  const offBeat = await score(sync({cuts:[{shot:'hyperframes', frame:20, beatFrame:15, offsetFrames:5, offBeatCut:'lands on the word'}]}));
  expect(offBeat.score).toBe(8);
  expect(offBeat.reasons.join('\n')).toContain('declared off-beat');
  // Loudness: 1.5 LU off is inconsistent level (5); 5 LU off is wide (2), like the known-bad calibration case.
  expect((await score(sync({integratedLufs:-15.5}))).score).toBe(5);
  expect((await score(sync({integratedLufs:-19}))).score).toBe(2);
  expect((await score(sync({truePeakDbtp:-0.5}))).score).toBe(5);
  const quiet = await score(sync({sfx:[], cuts:[]}));
  expect(quiet.score).toBe(8);
  expect(quiet.reasons).toEqual(expect.arrayContaining(['no SFX hit tested','no beat-targeted cut tested']));
  expect(quiet.unverified[0]).toContain('audible sound quality');
}));

test(`${runtime}: standalone packet of a lone video lists every impossible check`, async () => {
  const dir = await mkdtemp(join(tmpdir(),'motion-studio-critique-'));
  try {
    const video = join(dir,'clip.mp4');
    ffmpeg([...raw,'-r','30','-i','-','-c:v','libx264','-pix_fmt','yuv420p',video],Buffer.concat(Array.from({length:FRAMES},(_,f) => draw(f))));
    const result = run('packet',video,'--out',join(dir,'review'));
    expect(result.status).toBe(0);
    const p = JSON.parse(await readFile(join(dir,'review/packet.json'),'utf8'));
    expect(p.mode).toBe('standalone');
    expect(p.impossible.map((m:Json) => m.item)).toEqual(['brief and logline','look or style bible','board (approved stills)','declared cuts, holds and effects','beat grid','SFX placement record','asset ledger','audio stream']);
    expect(p.contactSheets).toEqual([{file:'contact-sheet-001.png', frames:[0,30]}]);
    expect(cornerLevel(join(dir,'review/contact-sheet-001.png'))).toBeLessThan(LEVEL);
    expect(p.dimension7.score).toBe('unverified');
    expect(p.scan.report).toBe('scan.json');
    expect(run('packet',video).status).toBe(1);
  } finally {await rm(dir,{recursive:true,force:true});}
});

test(`${runtime}: calibrate passes scores inside the shipped bands and voids a run that misses one`, async () => {
  const dir = await mkdtemp(join(tmpdir(),'motion-studio-critique-'));
  try {
    const shot = {'3':'unverified','4':3,'5':4,'6':2,'8':2};
    const good = {film:{'1':8,'2':9,'7':8,'7-audible':'unverified'}, shots:{s01:{'3':8,'4':9,'5':8,'6':8,'8':8}, s02:{'3':8,'4':8,'5':9,'6':9,'8':8}}};
    const scores = {cases:{'known-bad':{film:{'1':2,'2':3,'7':2,'7-audible':'unverified'}, shots:{s01:shot, s03:shot}}, 'known-good':good}};
    const file = join(dir,'scores.json');
    await writeFile(file,JSON.stringify(scores));
    let result = run('calibrate',file,bands);
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('calibration within bands');
    // A known-good shot below 8 voids the run and names the missed band.
    await writeFile(file,JSON.stringify({cases:{...scores.cases, 'known-good':{...good, shots:{...good.shots, s02:{...good.shots.s02, '5':6}}}}}));
    result = run('calibrate',file,bands);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('error: run void: 1 band missed');
    expect(result.stderr).toContain('known-good: shot * dimension 5 >= 8: got 6');
    // An audible judgment scored without listening is a miss, not a pass.
    await writeFile(file,JSON.stringify({cases:{...scores.cases, 'known-bad':{...scores.cases['known-bad'], film:{'1':2,'2':3,'7':2,'7-audible':6}}}}));
    result = run('calibrate',file,bands);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('known-bad: film dimension 7-audible unverified: got 6');
  } finally {await rm(dir,{recursive:true,force:true});}
});
