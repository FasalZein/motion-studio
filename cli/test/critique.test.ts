import {test as nodeTest} from 'node:test';
const {expect} = await import('bun' in process.versions ? 'bun:test' : 'expect');
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';

// Black-box checks of the deterministic parts of motion-critique: the evidence packet (packet), the dimension 7 rule
// and the calibration band check (calibrate). Every master frame carries its own frame index as the grey level of an
// 8x8 corner patch (level = 6 * frame), so an extracted still-pair frame proves which master frame it is.
const test = (name:string, fn:()=>Promise<void>, timeout=120000) => nodeTest(name,{timeout},fn);
const here = dirname(fileURLToPath(import.meta.url));
const cli = resolve(here,'../dist/cli.js');
const fixture = resolve(here,'../fixtures/two-engine');
const bands = resolve(here,'../../skills/motion-critique/evals/calibration-bands.json');
const evalBands = resolve(here,'../../skills/motion-critique/evals/expect.json');
const runtime = 'bun' in process.versions ? 'bun' : 'node';
const run = (...args:string[]) => spawnSync(runtime,[cli,...args],{encoding:'utf8',timeout:60000});
type Json = Record<string,any>;

const W = 320, H = 180, FRAMES = 40, CUT = 20, LEVEL = 6;
/** Frame `f`: the background changes at CUT; the corner patch and the box show pose `g` (default f). */
function draw(f:number, g = f):Buffer {
  const frame = Buffer.alloc(W*H*3);
  const bg = f < CUT ? [40,40,48] : [30,60,110];
  for (let p=0;p<W*H;p++) frame.set(bg,p*3);
  for (let y=0;y<8;y++) for (let x=0;x<8;x++) frame.fill(LEVEL*g,(y*W+x)*3,(y*W+x)*3+3);
  for (let y=70;y<110;y++) for (let x=20+2*g;x<60+2*g;x++) frame.set([230,200,60],(y*W+x)*3);
  return frame;
}
// A film with one frozen hold inside shot "hyperframes": frames HOLD_FIRST-HOLD_LAST repeat one pose (0.8 s at 30 fps),
// then the box moves again. Liveness samples at 12 fps, so the span it locates lies within one sample (2.5 frames) of these.
const HOLD_FRAMES = 66, HOLD_FIRST = 28, HOLD_LAST = 51;
const drawHold = (f:number) => draw(f,f <= HOLD_FIRST ? f : f <= HOLD_LAST ? HOLD_FIRST : f-(HOLD_LAST-HOLD_FIRST));
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
function ffmpeg(args:string[], input?:Buffer) {
  const full = ['-hide_banner','-loglevel','error','-y',...args];
  const r = input ? ffmpegWithInput(full,input) : spawnSync('ffmpeg',full,{maxBuffer:1<<28,timeout:60000});
  if (r.status !== 0) throw Error(`ffmpeg failed: ${r.stderr}`);
  return r.stdout;
}
const raw = ['-f','rawvideo','-pix_fmt','rgb24','-s',`${W}x${H}`];
/** The grey level of the corner patch of a PNG, which names the master frame it came from. */
const cornerLevel = (png:string) => ffmpeg(['-i',png,'-f','rawvideo','-pix_fmt','rgb24','-'])[3*(4*W+4)];

async function withFilm(fn:(dir:string)=>Promise<void>, frames = FRAMES, drawer:(f:number)=>Buffer = draw) {
  const dir = await mkdtemp(join(tmpdir(),'motion-studio-critique-'));
  try {
    await cp(fixture,dir,{recursive:true,filter:src => !src.endsWith('/renders')});
    const s = JSON.parse(await readFile(join(dir,'storyboard.json'),'utf8'));
    s.meta.durationFrames = frames;
    s.audio.beatFrames = [CUT];
    s.shots[0].endFrame = CUT;
    Object.assign(s.shots[1],{startFrame:CUT, endFrame:frames, soundCues:[]});
    await writeFile(join(dir,'storyboard.json'),JSON.stringify(s,null,2));
    await mkdir(join(dir,'renders/16x9'),{recursive:true});
    ffmpeg([...raw,'-r','30','-i','-','-vf','scale=out_color_matrix=bt709,format=yuv444p,setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709','-c:v','ffv1','-level','3','-colorspace','bt709','-color_trc','bt709','-color_primaries','bt709',join(dir,'renders/16x9/master.mkv')],Buffer.concat(Array.from({length:frames},(_,f) => drawer(f))));
    await writeFile(join(dir,'renders/16x9/render.json'),'{}');
    await fn(dir);
  } finally {await rm(dir,{recursive:true,force:true});}
}
const packet = async (dir:string):Promise<Json> => JSON.parse(await readFile(join(dir,'critique/packet-16x9/packet.json'),'utf8'));
const items = (p:Json) => p.missing.map((m:Json) => m.item);
const sync = (over:Json = {}) => ({targetLufs:-14, integratedLufs:-14.1, truePeakDbtp:-1.3, syncWindowFrames:3,
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
  expect(items(p)).toEqual(['look or style bible','contact sheet and transition strips','scan report','mix sync report','liveness report']);
  expect(p.liveness).toBe(null);
  expect(p.dimension7.score).toBe('unverified');
  expect(p.logline).toBe('One Remotion shot cuts on the beat to one HyperFrames shot.');
  expect(p.beatGrid.beatFrames).toEqual([CUT]);
  expect(result.stdout).toContain('packet 16:9: 2 still pairs, 5 missing items, dimension 7 unverified, liveness missing');
}));

test(`${runtime}: a stale G2 approval gives no still pairs and no G2 revision hash`, async () => withFilm(async dir => {
  await mkdir(join(dir,'stills/G2/16x9'),{recursive:true});
  ffmpeg([...raw,'-i','-','-frames:v','1',join(dir,'stills/G2/16x9/remotion-f005.png')],draw(5));
  for (const g of ['G1','G2']) expect(run('gate',dir,g,'approve').status).toBe(0);
  // beats.json is a G2 input: writing it stales the approval, while storyboard.json still records G2 approved.
  await writeFile(join(dir,'beats.json'),'{"bpm":120}');
  expect(JSON.parse(await readFile(join(dir,'storyboard.json'),'utf8')).gates.find((g:Json) => g.id === 'G2').state).toBe('approved');
  expect(run('packet',dir).status).toBe(0);
  const p = await packet(dir);
  expect(p.stillPairs).toEqual([]);
  expect(Object.keys(p.revisionHashes)).toEqual(['G1']);
  const stills = p.missing.find((m:Json) => m.item === 'frozen approved stills');
  expect(stills.action).toContain('G2 approval is stale');
}));

test(`${runtime}: packet gathers sheet, a current scan and the sync report; a scan of another master is missing`, async () => withFilm(async dir => {
  expect(run('sheet',dir).status).toBe(0);
  expect(run('scan',dir).status).toBe(0);
  // The box moves every frame, so the film passes liveness and dimension 2 has no cap.
  expect(run('liveness',dir).status).toBe(0);
  await writeFile(join(dir,'renders/16x9/sync.json'),JSON.stringify(sync()));
  const board = JSON.parse(await readFile(join(dir,'storyboard.json'),'utf8'));
  board.look.id = 'swiss-grid';
  await writeFile(join(dir,'storyboard.json'),JSON.stringify(board,null,2));
  expect(run('packet',dir).status).toBe(0);
  let p = await packet(dir);
  expect(items(p)).toEqual(['frozen approved stills']);
  // The pattern lists of skills/motion-look: 7 shared rows in patterns.md plus the addition in looks/swiss-grid.md.
  expect(p.patterns.shared).toHaveLength(7);
  expect(p.patterns.shared).toContainEqual({pattern:'Crossfade', replacement:'A cut on the beat or `shape-morph`'});
  expect(p.patterns.lookPairs).toEqual([{pattern:'Floating labels without alignment', replacement:'labels anchored to a visible column or baseline'}]);
  expect(p.sheet.strips.map((x:Json) => [x.file,x.cut])).toEqual([['renders/16x9/transition-remotion-hyperframes.png',CUT]]);
  expect(p.sheet.pages.map((x:Json) => x.frames)).toEqual([[0,30]]);
  expect(p.scan.report).toBe('renders/16x9/scan.json');
  expect(p.dimension7.score).toBe(8);
  expect([p.liveness.pass,p.liveness.stillSpans,p.liveness.dimension2Max]).toEqual([true,[],null]);
  // A report whose master hash differs describes an earlier render.
  const scan = JSON.parse(await readFile(join(dir,'renders/16x9/scan.json'),'utf8'));
  await writeFile(join(dir,'renders/16x9/scan.json'),JSON.stringify({...scan, sha256:'0'.repeat(64)}));
  expect(run('packet',dir).status).toBe(0);
  p = await packet(dir);
  expect(p.scan).toBe(null);
  expect(items(p)).toContain('scan report (describes an earlier master)');
  // A look outside the motion-look catalogue has no bundled additions.
  board.look.id = 'house-style';
  await writeFile(join(dir,'storyboard.json'),JSON.stringify(board,null,2));
  expect(run('packet',dir).status).toBe(0);
  p = await packet(dir);
  expect(p.patterns.lookPairs).toBe(null);
  expect(items(p)).toContain('look-specific patterns of house-style (not a motion-look catalogue look)');
}));

test(`${runtime}: packet adds the liveness report, the seam threads and strips around each seam and inside each hold`, async () => withFilm(async dir => {
  expect(run('liveness',dir).status).toBe(1);
  const result = run('packet',dir);
  expect(result.status).toBe(0);
  const p = await packet(dir);
  const report = JSON.parse(await readFile(join(dir,'renders/16x9/liveness.json'),'utf8'));
  // The packet reads the content-basis moving share, the value the G4 gate checks (D72), and names that basis.
  expect(p.liveness).toMatchObject({report:'renders/16x9/liveness.json', pass:false, movingShareBasis:'content', movingShare:report.movingShare, movingShareWholeFilm:report.movingShareWholeFilm, waiver:null, dimension2Max:7});
  // One hold: the frozen frames, located in shot hyperframes to within one 12 fps sample; its strip tiles lie inside it.
  expect(p.liveness.stillSpans).toHaveLength(1);
  const [hold] = p.liveness.stillSpans;
  expect(hold.shots).toEqual(['hyperframes']);
  expect(Math.abs(hold.firstFrame-HOLD_FIRST)).toBeLessThanOrEqual(3);
  expect(Math.abs(hold.lastFrame-HOLD_LAST)).toBeLessThanOrEqual(3);
  expect(hold.file).toBe('critique/packet-16x9/strips/hold-01.png');
  expect(hold.frames).toHaveLength(8);
  for (const f of hold.frames) expect(f >= HOLD_FIRST && f <= HOLD_LAST).toBe(true);
  // One seam, with the fixture's thread and an 11-frame strip centred on the cut.
  expect(p.seams).toEqual([{from:'remotion', to:'hyperframes', frame:CUT, entry:'cut', thread:{kind:'shared-element-thread', shared:'the shared color patch'},
    bothMove:true, strip:'critique/packet-16x9/strips/seam-remotion-hyperframes.png', frames:[15,16,17,18,19,20,21,22,23,24,25]}]);
  // Strip images: one tile per listed frame (tiles at most 320 wide, 4-pixel margin and padding, like sheet).
  const width = (png:string) => Number(spawnSync('ffprobe',['-v','error','-show_entries','stream=width','-of','csv=p=0',join(dir,png)],{encoding:'utf8'}).stdout.trim());
  expect(width(p.seams[0].strip)).toBe(11*320+12*4);
  expect(width(hold.file)).toBe(8*320+9*4);
  expect(result.stdout).toContain('liveness fail (dimension 2 at most 7)');
  // A written G4 waiver lifts the dimension 2 cap and is shown to the reviewer.
  for (const id of ['G1','G2','G3']) expect(run('gate',dir,id,'approve').status).toBe(0);
  // G4 approval also needs a fresh reviewer's report naming this packet and its master (D78).
  await writeFile(join(dir,'critique/loop-1.md'),`# Critique loop 1\nMode: in-studio; independence: independent\nPacket: critique/packet-16x9/packet.json; master sha256: ${p.render.masterSha256}\n`);
  expect(run('gate',dir,'G4','approve','--waive','liveness','--note','deliberate hold for the title').status).toBe(0);
  expect(run('packet',dir).status).toBe(0);
  expect((await packet(dir)).liveness).toMatchObject({pass:false, waiver:{reason:'deliberate hold for the title'}, dimension2Max:null});
  // Only a liveness waiver lifts the cap: a critique waiver (D80) does not, and the older single `waiver` shape still does.
  const setWaivers = async (g4:Json) => {
    const s = JSON.parse(await readFile(join(dir,'storyboard.json'),'utf8'));
    const {waiver:_, waivers:__, ...rest} = s.gates[3];
    s.gates[3] = {...rest, ...g4};
    await writeFile(join(dir,'storyboard.json'),JSON.stringify(s,null,2));
    expect(run('packet',dir).status).toBe(0);
    return (await packet(dir)).liveness;
  };
  expect(await setWaivers({waivers:[{check:'critique', reason:'no subagent tool'}]})).toMatchObject({waiver:null, dimension2Max:7});
  expect(await setWaivers({waiver:{check:'liveness', reason:'older shape'}})).toMatchObject({waiver:{reason:'older shape'}, dimension2Max:null});
  // A report of another master is not current evidence.
  await writeFile(join(dir,'renders/16x9/liveness.json'),JSON.stringify({...report, sha256:'0'.repeat(64)}));
  expect(run('packet',dir).status).toBe(0);
  const stale = await packet(dir);
  expect(stale.liveness).toBe(null);
  expect(items(stale)).toContain('liveness report (describes an earlier master)');
  expect(stale.seams[0].bothMove).toBe(null);
}, HOLD_FRAMES, drawHold));

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
  // mix searches 3 frames either side of the planned peak: a peak on that edge means the hit was not found (2).
  const edge = await score(sync({sfx:[{asset:'sfx-hit', eventFrame:20, plannedOffsetFrames:0, peakFrame:17, offsetFrames:-3}]}));
  expect(edge.score).toBe(2);
  expect(edge.reasons.join('\n')).toContain('not found');
  expect((await score(sync({cuts:[{shot:'hyperframes', frame:20, beatFrame:16, offsetFrames:4}]}))).worstOffsetFrames).toBe(4);
  expect((await score(sync({cuts:[{shot:'hyperframes', frame:20, beatFrame:16, offsetFrames:4}]}))).score).toBe(2);
  // A planned peak offset is intent: the error is measured from the plan.
  expect((await score(sync({sfx:[{asset:'sfx-hit', eventFrame:20, plannedOffsetFrames:3, peakFrame:23, offsetFrames:3}]}))).score).toBe(8);
  // An off-beat cut is judged against its declared timing, not a beat.
  const offBeat = await score(sync({cuts:[{shot:'hyperframes', frame:20, beatFrame:15, offsetFrames:5, offBeatCut:'lands on the word'}]}));
  expect(offBeat.score).toBe(8);
  expect(offBeat.reasons.join('\n')).toContain('declared off-beat');
  // Loudness: 1.5 LU off is inconsistent level (5); 5 LU off is wide (2), like the case-2 calibration case.
  expect((await score(sync({integratedLufs:-15.5}))).score).toBe(5);
  expect((await score(sync({integratedLufs:-19}))).score).toBe(2);
  expect((await score(sync({truePeakDbtp:-0.5}))).score).toBe(5);
  // The eval fixtures stay within what mix can report: on time gives 8; the off-beat side gives 2 (a hit not found).
  const fixtures = JSON.parse(await readFile(resolve(here,'../../skills/motion-critique/evals/cases.json'),'utf8')).sync;
  expect((await score(fixtures.onTime)).score).toBe(8);
  for (const c of fixtures.offBeat.sfx) expect(Math.abs(c.offsetFrames-c.plannedOffsetFrames)).toBeLessThanOrEqual(fixtures.offBeat.syncWindowFrames);
  expect((await score(fixtures.offBeat)).score).toBe(2);
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
    expect([p.liveness.report,p.liveness.pass,p.liveness.stillSpans,p.seams]).toEqual(['liveness.json',true,[],[]]);
    expect(run('packet',video).status).toBe(1);
  } finally {await rm(dir,{recursive:true,force:true});}
});

test(`${runtime}: standalone packet measures liveness and adds a strip inside each hold of a lone video`, async () => {
  const dir = await mkdtemp(join(tmpdir(),'motion-studio-critique-'));
  try {
    const video = join(dir,'clip.mp4');
    ffmpeg([...raw,'-r','30','-i','-','-c:v','libx264','-pix_fmt','yuv420p',video],Buffer.concat(Array.from({length:HOLD_FRAMES},(_,f) => drawHold(f))));
    const result = run('packet',video,'--out',join(dir,'review'));
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('liveness fail');
    const p = JSON.parse(await readFile(join(dir,'review/packet.json'),'utf8'));
    const report = JSON.parse(await readFile(join(dir,'review/liveness.json'),'utf8'));
    expect(p.liveness).toMatchObject({report:'liveness.json', pass:false, movingShareBasis:'content', movingShare:report.movingShare, dimension2Max:7});
    // A lone video has no film frames: the hold is placed by seconds, then converted at the video's 30 fps.
    const [hold] = p.liveness.stillSpans;
    expect(p.liveness.stillSpans).toHaveLength(1);
    expect(hold.firstFrame).toBe(null);
    expect(hold.file).toBe('strips/hold-01.png');
    expect(Math.abs(hold.frames[0]-HOLD_FIRST)).toBeLessThanOrEqual(3);
    expect(Math.abs(hold.frames.at(-1)-HOLD_LAST)).toBeLessThanOrEqual(3);
    expect((await readdir(join(dir,'review/strips')))).toEqual(['hold-01.png']);
    // A rerun replaces its own strips; Finder's .DS_Store inside strips/ stays.
    await writeFile(join(dir,'review/strips/.DS_Store'),'');
    expect(run('packet',video,'--out',join(dir,'review')).status).toBe(0);
    expect((await readdir(join(dir,'review/strips'))).sort()).toEqual(['.DS_Store','hold-01.png']);
    // A file the user put into strips/ makes the folder foreign: the rerun refuses and deletes nothing.
    await writeFile(join(dir,'review/strips/notes.txt'),'mine');
    const refused = run('packet',video,'--out',join(dir,'review'));
    expect(refused.status).toBe(1);
    expect(refused.stderr).toContain('strips/notes.txt');
    expect((await readdir(join(dir,'review/strips'))).sort()).toEqual(['.DS_Store','hold-01.png','notes.txt']);
  } finally {await rm(dir,{recursive:true,force:true});}
});

// ffmpeg's fps filter gives input frame n the 12 fps time round(n x 12 / 30) and keeps the last frame of each time, so
// sample k shows the last frame n with n < 2.5 k + 1.25: samples 11, 12, 23 and 24 show frames 28, 31, 58 and 61. A
// freeze on frames 31-60 therefore starts on the even sample 12, whose rounded frame (2.5 x 12 = 30) is still moving,
// and ends on sample 23. Every tile of its hold strip must lie inside the freeze and show the same picture.
const EVEN_FIRST = 31, EVEN_LAST = 60, EVEN_FRAMES = 90;
const drawEven = (f:number) => draw(f,f < EVEN_FIRST ? f : f <= EVEN_LAST ? EVEN_FIRST : f-(EVEN_LAST-EVEN_FIRST));

test(`${runtime}: a hold strip of a freeze that starts on an even sample shows only frozen frames`, async () => {
  const dir = await mkdtemp(join(tmpdir(),'motion-studio-critique-'));
  try {
    const video = join(dir,'clip.mkv');
    ffmpeg([...raw,'-r','30','-i','-','-c:v','ffv1',video],Buffer.concat(Array.from({length:EVEN_FRAMES},(_,f) => drawEven(f))));
    expect(run('packet',video,'--out',join(dir,'review')).status).toBe(0);
    const p = JSON.parse(await readFile(join(dir,'review/packet.json'),'utf8'));
    expect(p.liveness.stillSpans).toHaveLength(1);
    const [hold] = p.liveness.stillSpans;
    // The span holds samples 12-23: 1 s and 11/12 s. Its first and last sampled frames are 31 and 58; eight tiles spread
    // between them are round(31 + 27 i / 7).
    expect([hold.startSecond,hold.seconds]).toEqual([1,0.917]);
    expect(hold.frames).toEqual([31,35,39,43,46,50,54,58]);
    // Tiles: 320x180 each, after a 4-pixel margin, 4 pixels apart (the sheet layout). All eight hold one picture.
    const rgb = ffmpeg(['-i',join(dir,'review',hold.file),'-f','rawvideo','-pix_fmt','rgb24','-']);
    const stripWidth = 8*320+9*4;
    const tileAt = (i:number) => Buffer.concat(Array.from({length:180},(_,y) => rgb.subarray(3*((4+y)*stripWidth+4+i*324),3*((4+y)*stripWidth+4+i*324+320))));
    for (let i=1;i<8;i++) expect(tileAt(i).equals(tileAt(0))).toBe(true);
  } finally {await rm(dir,{recursive:true,force:true});}
});

test(`${runtime}: standalone packet measures the audio stream of a video with sound`, async () => {
  const dir = await mkdtemp(join(tmpdir(),'motion-studio-critique-'));
  try {
    // PCM audio in a .mov: a lossy codec would add its own overshoot to the true peak.
    const video = join(dir,'clip.mov');
    // lavfi's sine has amplitude 1/8: peak 20*log10(1/8) = -18.1 dBFS. A mono sine's mean square is half its peak
    // squared (-21.1 dB), and BS.1770 loudness is -0.691 + 10*log10(mean square) with ~0 dB K-weighting at 440 Hz: -21.8.
    ffmpeg([...raw,'-r','30','-i','-','-f','lavfi','-i','sine=frequency=440:sample_rate=48000:duration=1.34','-c:v','libx264','-pix_fmt','yuv420p','-c:a','pcm_s16le','-shortest',video],Buffer.concat(Array.from({length:FRAMES},(_,f) => draw(f))));
    expect(run('packet',video,'--out',join(dir,'review')).status).toBe(0);
    const p = JSON.parse(await readFile(join(dir,'review/packet.json'),'utf8'));
    expect(p.impossible.map((m:Json) => m.item)).not.toContain('audio stream');
    expect(Math.abs(p.loudness.integratedLufs+21.8)).toBeLessThan(1);
    expect(Math.abs(p.loudness.truePeakDbtp+18.1)).toBeLessThan(1);
    expect(p.patterns.shared).toHaveLength(7);
  } finally {await rm(dir,{recursive:true,force:true});}
});

test(`${runtime}: standalone packet never deletes files it did not write in an existing --out folder`, async () => {
  const dir = await mkdtemp(join(tmpdir(),'motion-studio-critique-'));
  try {
    const video = join(dir,'clip.mp4');
    ffmpeg([...raw,'-r','30','-i','-','-c:v','libx264','-pix_fmt','yuv420p',video],Buffer.concat(Array.from({length:FRAMES},(_,f) => draw(f))));
    await writeFile(join(dir,'notes.txt'),'mine');
    const before = await readdir(dir);
    // The folder that holds the input video and the user's notes is refused and left as it was.
    const refused = run('packet',video,'--out',dir);
    expect(refused.status).toBe(1);
    expect(refused.stderr).toContain('holds files no packet wrote');
    expect((await readdir(dir)).sort()).toEqual(before.sort());
    expect(await readFile(join(dir,'notes.txt'),'utf8')).toBe('mine');
    // An empty folder is used; a second run replaces its own earlier packet.
    await mkdir(join(dir,'review'));
    expect(run('packet',video,'--out',join(dir,'review')).status).toBe(0);
    expect(run('packet',video,'--out',join(dir,'review')).status).toBe(0);
    expect((await readdir(join(dir,'review'))).sort()).toEqual(['contact-sheet-001.png','liveness.json','packet.json','scan.json']);
    // Finder's .DS_Store and a staging folder left by a killed run do not make the folder foreign; both stay.
    await writeFile(join(dir,'review/.DS_Store'),'');
    await mkdir(join(dir,'review/.motion-packet-left'));
    expect(run('packet',video,'--out',join(dir,'review')).status).toBe(0);
    expect((await readdir(join(dir,'review'))).sort()).toEqual(['.DS_Store','.motion-packet-left','contact-sheet-001.png','liveness.json','packet.json','scan.json']);
    // A file added beside an earlier packet makes the folder foreign again.
    await writeFile(join(dir,'review/notes.txt'),'mine too');
    expect(run('packet',video,'--out',join(dir,'review')).status).toBe(1);
    expect(await readFile(join(dir,'review/notes.txt'),'utf8')).toBe('mine too');
    expect(await readFile(join(dir,'review/packet.json'),'utf8')).toContain('"standalone"');
  } finally {await rm(dir,{recursive:true,force:true});}
});

test(`${runtime}: calibrate passes scores inside the shipped bands and voids a run that misses one`, async () => {
  const dir = await mkdtemp(join(tmpdir(),'motion-studio-critique-'));
  try {
    const shot = {'3':'unverified','4':3,'5':4,'6':2,'8':2};
    // case-1 has only a 1 fps sheet: motion quality (3) and technical finish (8) must stay unverified.
    const good = {film:{'1':8,'2':9,'7':8,'7-audible':'unverified'}, shots:{s01:{'3':'unverified','4':9,'5':8,'6':8,'8':'unverified'}, s02:{'3':'unverified','4':8,'5':9,'6':9,'8':'unverified'}}};
    const scores = {cases:{'case-2':{film:{'1':2,'2':3,'7':2,'7-audible':'unverified'}, shots:{s01:shot, s03:shot}}, 'case-1':good}};
    const file = join(dir,'scores.json');
    await writeFile(file,JSON.stringify(scores));
    let result = run('calibrate',file,bands);
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('calibration within bands');
    // A case-1 shot below 8 voids the run and names the missed band.
    await writeFile(file,JSON.stringify({cases:{...scores.cases, 'case-1':{...good, shots:{...good.shots, s02:{...good.shots.s02, '5':6}}}}}));
    result = run('calibrate',file,bands);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('error: run void: 1 band missed');
    expect(result.stderr).toContain('case-1: shot * dimension 5 >= 8: got 6');
    // An audible judgment scored without listening is a miss, not a pass.
    await writeFile(file,JSON.stringify({cases:{...scores.cases, 'case-2':{...scores.cases['case-2'], film:{'1':2,'2':3,'7':2,'7-audible':6}}}}));
    result = run('calibrate',file,bands);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('case-2: film dimension 7-audible unverified: got 6');
    // Scoring a full-rate judgment from the 1 fps case-1 sheet is a miss.
    await writeFile(file,JSON.stringify({cases:{...scores.cases, 'case-1':{...good, shots:{...good.shots, s01:{...good.shots.s01, '3':8}}}}}));
    result = run('calibrate',file,bands);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('case-1: shot * dimension 3 unverified: got 8');
    // case-2 is the slideshow: its liveness report fails without a waiver, so dimension 2 at 8 voids the run.
    await writeFile(file,JSON.stringify({cases:{...scores.cases, 'case-2':{...scores.cases['case-2'], film:{...scores.cases['case-2'].film, '2':8}}}}));
    result = run('calibrate',file,bands);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('case-2: film dimension 2 <= 7: got 8');
  } finally {await rm(dir,{recursive:true,force:true});}
});

test(`${runtime}: the shipped liveness reports agree with the cases: the slideshows fail and the moving films pass`, async () => {
  const skill = resolve(here,'../../skills/motion-critique');
  const report = async (file:string) => JSON.parse(await readFile(join(skill,file),'utf8'));
  const cases = await report('evals/cases.json');
  const pace = cases.pairs['slideshow-pace'];
  expect((await report(join('evals',pace.bad.liveness))).pass).toBe(false);
  expect((await report(join('evals',pace.good.liveness))).pass).toBe(true);
  // data-story/good must reach 8 on dimension 2, so both data-story sides carry the passing report of the moving bars film.
  const story = cases.pairs['data-story'];
  for (const side of [story.bad,story.good]) expect((await report(join('evals',side.liveness))).pass).toBe(true);
  // The reviewer gets a copy of each report: its video field names no case.
  const reports = [...['slideshow','moving','bars'].map(n => `evals/liveness/${n}.json`), 'calibration/case-1-liveness.json', 'calibration/case-2-liveness.json'];
  for (const file of reports) expect((await report(file)).video).toBe('film.mkv');
  // cases.md names each report beside its sheet; case-2 is the slideshow the calibration bands cap on dimension 2.
  const text = await readFile(join(skill,'calibration/cases.md'),'utf8');
  for (const name of ['case-1','case-2']) expect(text).toContain(`Liveness report: \`${name}-liveness.json\``);
  expect((await report('calibration/case-1-liveness.json')).pass).toBe(true);
  const slideshow = await report('calibration/case-2-liveness.json');
  expect([slideshow.pass,slideshow.movingShare < 0.75]).toEqual([false,true]);
  expect((await report('evals/calibration-bands.json')).cases['case-2']).toContainEqual({dimension:'2', max:7});
});

test(`${runtime}: the eval grader accepts a worst issue in any damaged shot and rejects one outside them`, async () => {
  const dir = await mkdtemp(join(tmpdir(),'motion-studio-critique-'));
  try {
    const file = join(dir,'scores.json');
    const side = (shot:string, frame:number) => ({film:{'1':3}, shots:{}, worstIssues:[{shot, frame, term:'straight-cut', repair:'give the layout an asymmetric focal subject'}]});
    const grade = async (shot:string, frame:number) => {
      await writeFile(file,JSON.stringify({cases:{'default-look/bad':side(shot,frame)}}));
      return run('calibrate',file,evalBands);
    };
    // default-look damages every shot: s03 (frames 60-89) at frame 70 is a correct finding.
    // The other eval cases have no scores here, so the run still exits 1; only default-look/bad is graded.
    let result = await grade('s03',70);
    expect(result.stdout).toContain('pass default-look/bad: film dimension 1 <= 7');
    expect(result.stdout).toContain('pass default-look/bad: a worst issue in s01 at frames 0-29 or');
    expect(result.stderr).not.toContain('default-look/bad:');
    // A frame outside the named shot is not.
    result = await grade('s03',10);
    expect(result.stderr).toContain('default-look/bad: a worst issue in s01 at frames 0-29 or');
    expect(result.stderr).toContain('no matching worst issue');
  } finally {await rm(dir,{recursive:true,force:true});}
});
