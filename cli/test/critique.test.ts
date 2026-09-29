import {test as nodeTest} from 'node:test';
const {expect} = await import('bun' in process.versions ? 'bun:test' : 'expect');
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
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
  expect(items(p)).toEqual(['look or style bible','contact sheet and transition strips','scan report','mix sync report']);
  expect(p.dimension7.score).toBe('unverified');
  expect(p.logline).toBe('One Remotion shot cuts on the beat to one HyperFrames shot.');
  expect(p.beatGrid.beatFrames).toEqual([CUT]);
  expect(result.stdout).toContain('packet 16:9: 2 still pairs, 4 missing items, dimension 7 unverified');
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
  // Loudness: 1.5 LU off is inconsistent level (5); 5 LU off is wide (2), like the known-bad calibration case.
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
    expect(run('packet',video).status).toBe(1);
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
    expect((await readdir(join(dir,'review'))).sort()).toEqual(['contact-sheet-001.png','packet.json','scan.json']);
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
    // known-good has only a 1 fps sheet: motion quality (3) and technical finish (8) must stay unverified.
    const good = {film:{'1':8,'2':9,'7':8,'7-audible':'unverified'}, shots:{s01:{'3':'unverified','4':9,'5':8,'6':8,'8':'unverified'}, s02:{'3':'unverified','4':8,'5':9,'6':9,'8':'unverified'}}};
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
    // Scoring a full-rate judgment from the 1 fps known-good sheet is a miss.
    await writeFile(file,JSON.stringify({cases:{...scores.cases, 'known-good':{...good, shots:{...good.shots, s01:{...good.shots.s01, '3':8}}}}}));
    result = run('calibrate',file,bands);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('known-good: shot * dimension 3 unverified: got 8');
  } finally {await rm(dir,{recursive:true,force:true});}
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
