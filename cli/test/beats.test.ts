import {test as nodeTest, before, after} from 'node:test';
const {expect} = await import('bun' in process.versions ? 'bun:test' : 'expect');
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {mkdtemp, mkdir, rm, readFile, writeFile, readdir, copyFile, stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';

const test = (name:string, fn:()=>Promise<void>, timeout=120000) => nodeTest(name,{timeout},fn);
const here = dirname(fileURLToPath(import.meta.url));
const cli = resolve(here,'../dist/cli.js');
const runtimes = ['node','bun'];
type Json = Record<string,any>;

// Ground truth by construction. Every fixture that has beats puts beat k (k = 0..31) at 0.1 + 0.5k s:
// 120 BPM, 16.1 s long. At 30 fps each beat time is an exact frame, 3 + 15k, far from a rounding boundary.
const beatFrames = Array.from({length:32},(_,k) => 3+15*k);
// The accent patterns put the first beat of each 4-beat bar on k % 4 == 0.
const downbeatFrames = beatFrames.filter((_,k) => k % 4 === 0);
const beatSeconds = beatFrames.map((_,k) => 0.1+0.5*k);
const B = 'floor((t-0.1)/0.5)';        // beat index
const TAU = 'mod(t-0.1,0.5)';          // seconds since the last beat
const click = `sin(2*PI*1000*t)*exp(-60*${TAU})*lt(${TAU},0.05)*gte(t,0.1)`;
// A 150 Hz kick on every beat (louder on k % 4 == 0), a 6 kHz hat on the off-beats and a 55 Hz bass line.
const kick = `if(eq(mod(${B},4),0),1,0.6)*sin(2*PI*150*${TAU})*exp(-25*${TAU})*gte(t,0.1)`;
const groove = `(0.6*${kick}+0.15*sin(2*PI*6000*t)*exp(-80*mod(t-0.35,0.5))*gte(t,0.35)+0.1*sin(2*PI*55*t))`;
const tracks:Record<string,{expr:string; seconds:number}> = {
  // Clicks with a 3x accent on the first beat of each 4-beat bar.
  click:{expr:`if(eq(mod(${B},4),0),0.9,0.3)*${click}`, seconds:16.1},
  // The groove at -16.5 dB for 16 beats, then at full level: the drop is beat 16 (8.1 s, frame 243), a downbeat.
  music:{expr:`if(lt(t,8.1),0.15,0.9)*${groove}`, seconds:16.1},
  // The same groove at one level: no drop.
  steady:{expr:`0.6*${groove}`, seconds:16.1},
  // Accents on every 3rd and every 4th beat at once: both meters fit, so no downbeats can be chosen.
  polymeter:{expr:`(0.3+0.3*eq(mod(${B},3),0)+0.3*eq(mod(${B},4),0))*${click}`, seconds:16.1},
  // A backbeat: a 3x accent on every 2nd beat (k odd, as a snare on 2 and 4). Bar starts two beats apart fit
  // equally, so no bar start can be chosen.
  backbeat:{expr:`if(eq(mod(${B},2),1),0.9,0.3)*${click}`, seconds:16.1},
  silence:{expr:'0', seconds:8},
};

let root:string;
let privateTmp:string;
const wav = (name:string) => join(root,'tracks',`${name}.wav`);
before(async () => {
  root = await mkdtemp(join(tmpdir(),'motion-studio-beats-'));
  privateTmp = join(root,'tmp');
  await mkdir(join(root,'tracks'),{recursive:true});
  await mkdir(privateTmp);
  for (const [name,{expr,seconds}] of Object.entries(tracks)) {
    const made = spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-y','-f','lavfi','-i',`aevalsrc='${expr}':s=48000:d=${seconds}`,'-c:a','pcm_s16le',wav(name)],{encoding:'utf8'});
    if (made.status !== 0) throw Error(made.stderr);
  }
});
after(() => rm(root,{recursive:true,force:true}));

const run = (runtime:string, args:string[]) => spawnSync(runtime,[cli,...args],{encoding:'utf8',timeout:60000,env:{...process.env,TMPDIR:privateTmp}});
const readJson = async (path:string):Promise<Json> => JSON.parse(await readFile(path,'utf8'));
const exists = (path:string) => stat(path).then(() => true,() => false);

/** A new film (via `init`) whose audio.track is the named fixture, recorded in the ledger. */
async function film(runtime:string, track:string|null):Promise<string> {
  const cwd = await mkdtemp(join(root,'film-'));
  expect(spawnSync(runtime,[cli,'init','f'],{cwd,encoding:'utf8'}).status).toBe(0);
  const dir = join(cwd,'films','f');
  if (track === null) return dir;
  await copyFile(wav(track),join(dir,'audio','track.wav'));
  const sha256 = createHash('sha256').update(await readFile(join(dir,'audio','track.wav'))).digest('hex');
  await writeFile(join(dir,'ledger.json'),JSON.stringify({version:'0',assets:[{id:'track',type:'audio',sourceKind:'code',sourceUrlOrGenerator:'ffmpeg aevalsrc',providerAssetId:null,
    license:{status:'known',name:'generated',evidence:'test fixture'},localPath:'audio/track.wav',sha256,shots:[]}]}));
  const storyboard = await readJson(join(dir,'storyboard.json'));
  storyboard.audio.track = 'track';
  await writeFile(join(dir,'storyboard.json'),JSON.stringify(storyboard));
  return dir;
}
const audio = async (dir:string) => (await readJson(join(dir,'storyboard.json'))).audio;
const detected = (dir:string) => join(dir,'audio','beats.detected.json');

test('a click track with known BPM gives its beats, downbeats, no drop and high confidence', async () => {
  for (const runtime of runtimes) {
    const dir = await film(runtime,'click');
    const result = run(runtime,['beats',dir]);
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(await audio(dir)).toEqual({track:'track',grid:'detected',bpm:120,beatFrames,downbeatFrames,dropFrames:[],confidence:'high'});
    expect(result.stdout).toContain('grid detected: bpm 120, 32 beats (frames 3 to 468), confidence high');
    expect(result.stdout).toContain('drops: none');
    expect(result.stdout).toContain('grid changed');
    // The proposal file is in seconds, ready to correct.
    const proposal = await readJson(detected(dir));
    expect(proposal.bpm).toBe(120);
    expect(proposal.beats.length).toBe(32);
    for (const [k,t] of proposal.beats.entries()) expect(Math.abs(t-beatSeconds[k])).toBeLessThan(0.005);
    // The result still validates, and the analysis leaves no temp files behind.
    expect(run(runtime,['validate',dir]).status).toBe(0);
    expect(await readdir(privateTmp)).toEqual([]);
    // Running detection again on the same track proposes the same grid.
    expect(run(runtime,['beats',dir]).stdout).toContain('grid unchanged');
  }
});

test('a music track with a build and a drop gives the drop on its downbeat', async () => {
  for (const runtime of runtimes) {
    const dir = await film(runtime,'music');
    const result = run(runtime,['beats',dir]);
    expect(result.status).toBe(0);
    expect(await audio(dir)).toEqual({track:'track',grid:'detected',bpm:120,beatFrames,downbeatFrames,dropFrames:[243],confidence:'high'});
    expect(result.stdout).toContain('drops: 243');
  }
});

test('music without a drop gives an explicit "none", not an invented drop', async () => {
  for (const runtime of runtimes) {
    const dir = await film(runtime,'steady');
    const result = run(runtime,['beats',dir]);
    expect(result.status).toBe(0);
    expect(await audio(dir)).toEqual({track:'track',grid:'detected',bpm:120,beatFrames,downbeatFrames,dropFrames:[],confidence:'high'});
    expect(result.stdout).toContain('drops: none (no bar rises +6 dB or more over the two bars before it)');
  }
});

test('silence gives an explicit empty result and no proposal file', async () => {
  for (const runtime of runtimes) {
    const dir = await film(runtime,'silence');
    const result = run(runtime,['beats',dir]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('grid: none (silent track (peak below -60 dBFS))');
    expect(await audio(dir)).toEqual({track:'track',grid:null,bpm:null,beatFrames:[],downbeatFrames:[],dropFrames:[],confidence:null});
    expect(await exists(detected(dir))).toBe(false);
  }
});

test('an ambiguous meter keeps the beats but proposes no downbeats, with low confidence', async () => {
  for (const runtime of runtimes) {
    const dir = await film(runtime,'polymeter');
    const result = run(runtime,['beats',dir]);
    expect(result.status).toBe(0);
    expect(await audio(dir)).toEqual({track:'track',grid:'detected',bpm:120,beatFrames,downbeatFrames:[],dropFrames:[],confidence:'low'});
    expect(result.stdout).toContain('low confidence: ambiguous meter: accents fit both 3 and 4 beats per bar; no downbeats proposed');
  }
});

test('accents on every 2nd beat keep the beats but propose no downbeats, with low confidence', async () => {
  for (const runtime of runtimes) {
    const dir = await film(runtime,'backbeat');
    const result = run(runtime,['beats',dir]);
    expect(result.status).toBe(0);
    expect(await audio(dir)).toEqual({track:'track',grid:'detected',bpm:120,beatFrames,downbeatFrames:[],dropFrames:[],confidence:'low'});
    expect(result.stdout).toContain('low confidence: ambiguous bar start: accents fit more than one first beat in a 4-beat bar; no downbeats proposed');
  }
});

test('a manually corrected grid replaces the proposal with nearest-frame conversion', async () => {
  for (const runtime of runtimes) {
    const dir = await film(runtime,'click');
    expect(run(runtime,['beats',dir]).status).toBe(0);
    // The creator moves the first beat to 0.09 s and marks a drop at 8.1 s. At 30 fps, 0.09 s is 2.7 frames:
    // the nearest frame is 3 (truncation would give 2); 8.1 s is frame 243.
    const corrected = join(dir,'audio','beats.json');
    await writeFile(corrected,JSON.stringify({bpm:120,beats:[0.09,...beatSeconds.slice(1)],downbeats:[0.09,...beatSeconds.filter((_,k) => k && k % 4 === 0)],drops:[8.1]}));
    const result = run(runtime,['beats',dir,'--corrected',corrected]);
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(await audio(dir)).toEqual({track:'track',grid:'corrected',bpm:120,beatFrames,downbeatFrames,dropFrames:[243],confidence:'high'});
    expect(result.stdout).toContain('grid corrected: bpm 120, 32 beats (frames 3 to 468)');
    expect(result.stdout).toContain('grid changed');
    // Detection does not silently discard the creator's grid.
    const redetect = run(runtime,['beats',dir]);
    expect(redetect.status).toBe(1);
    expect(redetect.stderr).toContain('error: audio.grid is corrected; detection would discard it');
    expect((await audio(dir)).grid).toBe('corrected');
  }
});

test('an imported grid needs no track; seconds on a half frame round up', async () => {
  for (const runtime of runtimes) {
    const dir = await film(runtime,null);
    const file = join(dir,'grid.json');
    // At 25 fps: 0.02 s = 0.5 frame -> 1; 0.5 s = 12.5 -> 13; 0.58 s = 14.5 -> 15 (in floats 0.58*25 is
    // 14.499999999999998, so a plain round gives 14); 1.01 s = 25.25 -> 25.
    await writeFile(file,JSON.stringify({bpm:118.5,beats:[0.02,0.5,0.58,1.01],downbeats:[0.02],drops:[]}));
    const storyboard = await readJson(join(dir,'storyboard.json'));
    storyboard.meta.fps = 25;
    await writeFile(join(dir,'storyboard.json'),JSON.stringify(storyboard));
    const result = run(runtime,['beats',dir,'--imported',file]);
    expect(result.status).toBe(0);
    expect(await audio(dir)).toEqual({track:null,grid:'imported',bpm:118.5,beatFrames:[1,13,15,25],downbeatFrames:[1],dropFrames:[],confidence:'high'});
    expect(run(runtime,['validate',dir]).status).toBe(0);
  }
});

const badGrids:{kind:string; grid:unknown; messages:string[]}[] = [
  {kind:'downbeat off the beats', grid:{bpm:120,beats:[0.1,0.6],downbeats:[0.3],drops:[]}, messages:['downbeat 0.3 s (frame 9) is not on a beat frame']},
  {kind:'drop off the beats', grid:{bpm:120,beats:[0.1,0.6],downbeats:[],drops:[1]}, messages:['drop 1 s (frame 30) is not on a beat frame']},
  {kind:'beats out of order', grid:{bpm:120,beats:[0.6,0.1],downbeats:[],drops:[]}, messages:['beats must be in increasing order without repeats']},
  {kind:'two beats on one frame', grid:{bpm:120,beats:[0.1,0.11],downbeats:[],drops:[]}, messages:['beats 0.1 s and 0.11 s both fall on frame 3 at 30 fps']},
  {kind:'negative time', grid:{bpm:120,beats:[-0.1,0.5],downbeats:[],drops:[]}, messages:['beats must be a list of times in seconds, each 0 or more']},
  {kind:'missing bpm and unknown field', grid:{beats:[0.1],downbeats:[],drops:[],downbeat:[0.1]}, messages:['missing field "bpm"','unknown field "downbeat" (allowed: bpm, beats, downbeats, drops)']},
  {kind:'no beats', grid:{bpm:120,beats:[],downbeats:[],drops:[]}, messages:['beats must not be empty']},
];
test('an invalid grid file is rejected with every problem and changes nothing', async () => {
  for (const [i,{kind,grid,messages}] of badGrids.entries()) {
    const runtime = runtimes[i % 2];
    const dir = await film(runtime,null);
    const file = join(dir,'grid.json');
    await writeFile(file,JSON.stringify(grid));
    const before = await readFile(join(dir,'storyboard.json'),'utf8');
    const result = run(runtime,['beats',dir,'--corrected',file]);
    expect({kind,status:result.status}).toEqual({kind,status:1});
    for (const message of messages) expect(result.stderr).toContain(`error: ${file}: ${message}`);
    expect(await readFile(join(dir,'storyboard.json'),'utf8')).toBe(before);
  }
});

test('detection without audio.track fails with a clear message', async () => {
  for (const runtime of runtimes) {
    const dir = await film(runtime,null);
    const result = run(runtime,['beats',dir]);
    expect(result.status).toBe(1);
    expect(result.stderr).toBe('error: audio.track is not set; add the track to ledger.json and set audio.track to its id\n');
  }
});
