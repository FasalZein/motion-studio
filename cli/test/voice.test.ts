import {test as nodeTest} from 'node:test';
const {expect} = await import('bun' in process.versions ? 'bun:test' : 'expect');
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {mkdir, mkdtemp, readFile, rm, stat, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';

// Narration fixture (#19). Word and beat times are specified here in seconds; every expected frame below is worked
// out by hand from those times with the spec rule round(seconds * fps) at 25 fps, not taken from the CLI.
const test = (name:string, fn:()=>Promise<void>, timeout=180000) => nodeTest(name,{timeout},fn);
const here = dirname(fileURLToPath(import.meta.url));
const cli = resolve(here,'../dist/cli.js');
const run = (runtime:string, ...args:string[]) => spawnSync(runtime,[cli,...args],{encoding:'utf8',timeout:120000});
const ffmpeg = (...args:string[]) => {
  const result = spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-y',...args],{encoding:'utf8',timeout:30000});
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
};
const json = async (file:string) => JSON.parse(await readFile(file,'utf8'));
const exists = (file:string) => stat(file).then(() => true,() => false);
const sha256 = async (file:string) => createHash('sha256').update(await readFile(file)).digest('hex');
/** Decodes the first audio stream to 48 kHz stereo float samples, independently of the CLI. */
const decode = (file:string) => {
  const bytes = spawnSync('ffmpeg',['-v','error','-i',file,'-map','0:a:0','-ar','48000','-ac','2','-f','f32le','-c:a','pcm_f32le','-'],{encoding:null,timeout:30000,maxBuffer:1e9}).stdout;
  return new Float32Array(new Uint8Array(bytes).buffer);
};
/** Amplitude of one frequency in the left channel over [from, to) seconds (a single-bin DFT). */
const tone = (samples:Float32Array, hz:number, from:number, to:number) => {
  let re = 0, im = 0;
  const a = Math.round(from*48000), b = Math.round(to*48000);
  for (let i=a;i<b;i++) {const w = 2*Math.PI*hz*i/48000; re += samples[i*2]*Math.cos(w); im += samples[i*2]*Math.sin(w);}
  return 2*Math.hypot(re,im)/(b-a);
};
const db = (ratio:number) => 20*Math.log10(ratio);
const loudnorm = (file:string) => JSON.parse(/\{[^{}]*"input_i"[^{}]*\}/.exec(spawnSync('ffmpeg',['-hide_banner','-nostats','-i',file,'-map','0:a:0','-af','loudnorm=print_format=json','-f','null','-'],{encoding:'utf8',timeout:30000}).stderr)![0]);
const CEILING_DBTP = -1;
const lufs = (file:string) => Number(JSON.parse(/\{[^{}]*"input_i"[^{}]*\}/.exec(spawnSync('ffmpeg',['-hide_banner','-nostats','-i',file,'-map','0:a:0','-af','loudnorm=print_format=json','-f','null','-'],{encoding:'utf8',timeout:30000}).stderr)![0]).input_i);

const FPS = 25;
// Beats in seconds (150 BPM, as a creator's corrected grid): frames 10, 20, ..., 90 (1.21 s = 30.25 -> 30, 2.39 s = 59.75 -> 60).
const beatSeconds = [0.41,0.8,1.21,1.6,2.0,2.39,2.8,3.2,3.6];
const beatFrames = [10,20,30,40,50,60,70,80,90];
// The narration audio starts at film frame 10 (0.4 s). Word times are seconds from the start of that audio.
const VOICE_START = 10;
const words = [{id:'w0',text:'Why',start:0.3,end:0.6},{id:'w1',text:'now?',start:0.7,end:1.0},{id:'w2',text:'It',start:1.83,end:2.2},{id:'w3',text:'costs',start:2.3,end:2.6}];
// Film frames of the word starts, nearest frame: 10+round(7.5)=18, 10+round(17.5)=28, 10+round(45.75)=56, 10+round(57.5)=68.
// Truncating instead of rounding would give 17, 27, 55, 67.
const wordFrames = [18,28,56,68];
// Spoken phrases in film seconds: "Why now?" 0.7-1.4 (gap 0.1 s), then "It costs" 2.23-3.0 (gap 0.83 s from the first).
const phrases = [[0.7,1.4],[2.23,3.0]];

/** `clicks` adds a short 0.9 transient 50 ms into each word, over the sine, like consonant bursts in real speech. */
async function narratedFilm(clicks = false) {
  const dir = await mkdtemp(join(tmpdir(),'motion-studio-voice-'));
  for (const sub of ['renders/16x9','audio','shots/a','shots/b','shots/c']) await mkdir(join(dir,sub),{recursive:true});
  for (const id of ['a','b','c']) await writeFile(join(dir,'shots',id,'index.html'),'<!doctype html>');
  // A synthetic stitched master stands in for rendered shots: 100 frames (4 s) at 25 fps.
  ffmpeg('-f','lavfi','-i',`color=c=0x172b46:s=64x36:r=${FPS}:d=4`,'-vf','setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709','-c:v','ffv1','-level','3','-pix_fmt','yuv444p','-colorspace','bt709','-color_trc','bt709','-color_primaries','bt709',join(dir,'renders','16x9','master.mkv'));
  await writeFile(join(dir,'renders','16x9','render.json'),'{}');
  // Bed: 997 Hz, amplitude 0.1, 5 s. Voice: 440 Hz, amplitude 0.3, sounding exactly during each word, 3 s long.
  ffmpeg('-f','lavfi','-i','aevalsrc=0.1*sin(2*PI*997*t)|0.1*sin(2*PI*997*t):s=48000:d=5','-c:a','pcm_s16le',join(dir,'audio','bed.wav'));
  // Commas inside a filter option are escaped for the filter-graph parser.
  const spoken = words.map(w => `between(t\\,${w.start}\\,${w.end})`).join('+');
  const burst = words.map(w => `exp(-abs(t-${w.start+0.05})*4000)`).join('+');
  const voice = clicks ? `0.1*sin(2*PI*440*t)*(${spoken})+0.9*(${burst})` : `0.3*sin(2*PI*440*t)*(${spoken})`;
  ffmpeg('-f','lavfi','-i',`aevalsrc=${voice}|${voice}:s=48000:d=3`,'-c:a','pcm_s16le',join(dir,'audio','voice.wav'));
  await writeFile(join(dir,'audio','script.txt'),'Why now? It costs less.');
  await writeFile(join(dir,'audio','words.json'),JSON.stringify(words));
  await writeFile(join(dir,'audio','grid.json'),JSON.stringify({bpm:150,beats:beatSeconds,downbeats:[],drops:[]}));
  const assets = [];
  for (const [id,type] of [['bed','music'],['voice','voice']]) assets.push({id,type,sourceKind:'code',sourceUrlOrGenerator:'ffmpeg aevalsrc',providerAssetId:null,license:{status:'known',name:'CC0-1.0',evidence:'generated in test'},localPath:`audio/${id}.wav`,sha256:await sha256(join(dir,'audio',`${id}.wav`)),shots:[]});
  await writeFile(join(dir,'ledger.json'),JSON.stringify({version:'0',assets}));
  const shot = (id:string, start:number, end:number, reveals:unknown[]) => ({id,startFrame:start,endFrame:end,engine:'hyperframes',entrypoint:`shots/${id}/index.html`,description:`shot ${id}`,camera:'custom:locked',entry:'cut',exit:'cut',assets:[],reveals,soundCues:[],stillFrames:[],protected:[]});
  const storyboard = {version:'0',meta:{title:'narrated',logline:'',genre:'explainer',formats:{primary:'16:9',extra:[]},fps:FPS,durationFrames:100,layouts:{'16:9':{canvas:{width:64,height:36},safe:{x:0,y:0,width:64,height:36},overlay:null}}},look:{id:null,styleBible:null,axes:{},tasteSnapshot:null},
    audio:{track:'bed',grid:null,bpm:null,beatFrames:[],downbeatFrames:[],dropFrames:[],confidence:null},
    voice:{script:'audio/script.txt',tts:'voice',wordTimings:'audio/words.json',startFrame:VOICE_START},
    // Cuts at 40 and 70 are beat frames; the reveals sit on the word frames of "Why" (18) and "It" (56).
    shots:[shot('a',0,40,[{word:0,text:'Why',frame:wordFrames[0]}]),shot('b',40,70,[{word:2,text:'It',frame:wordFrames[2]}]),shot('c',70,100,[])],
    gates:['G1','G2','G3','G4','G5'].map(id => ({id,state:'pending',inputHashes:{},decision:null,notes:[],rounds:0})),critique:[]};
  await writeFile(join(dir,'storyboard.json'),JSON.stringify(storyboard));
  return dir;
}
const board = (dir:string) => json(join(dir,'storyboard.json'));
async function edit(dir:string, change:(s:any)=>void) {
  const s = await board(dir);
  change(s);
  await writeFile(join(dir,'storyboard.json'),JSON.stringify(s));
}

for (const runtime of ['node','bun']) test(`${runtime}: narration reveals snap to word frames, cuts sit on the corrected beat grid, and mix ducks the bed under the voice`, async () => {
  const dir = await narratedFilm();
  try {
    const grid = run(runtime,'beats',dir,'--corrected',join(dir,'audio','grid.json'));
    expect(grid.stderr).toBe('');
    expect((await board(dir)).audio.beatFrames).toEqual(beatFrames);
    const valid = run(runtime,'validate',dir);
    expect(valid.stderr).toBe('');
    expect(valid.status).toBe(0);

    // The beat map shows each shot's spoken line: the words whose frame falls inside the shot.
    const map = run(runtime,'beatmap',dir);
    expect(map.stderr).toBe('');
    expect(map.stdout.trim().split('\n')).toEqual([
      '| shot | frames | seconds | entry | visual event | camera | spoken line | reveals | sound cues | engine |',
      '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
      '| a | [0, 40) | 0.00-1.60 | start | shot a | custom:locked | "Why now?" | "Why" f18 | - | hyperframes |',
      '| b | [40, 70) | 1.60-2.80 | cut on beat | shot b | custom:locked | "It costs" | "It" f56 | - | hyperframes |',
      '| c | [70, 100) | 2.80-4.00 | cut on beat | shot c | custom:locked | - | - | - | hyperframes |',
    ]);

    const mixed = run(runtime,'mix',dir);
    expect(mixed.stderr).toBe('');
    expect(mixed.status).toBe(0);
    const out = join(dir,'renders','16x9');
    const sync = await json(join(out,'sync.json'));
    expect(sync.voice).toEqual({asset:'voice',startFrame:VOICE_START,duckDb:-12,duckSpans:phrases.map(([startSeconds,endSeconds]) => ({startSeconds,endSeconds}))});
    expect(sync.reveals).toEqual([
      {shot:'a',word:0,text:'Why',wordStartSeconds:0.3,wordFrame:18,frame:18,offsetFrames:0},
      {shot:'b',word:2,text:'It',wordStartSeconds:1.83,wordFrame:56,frame:56,offsetFrames:0},
    ]);
    expect(sync.cuts).toEqual([{shot:'b',frame:40,beatFrame:40,offsetFrames:0},{shot:'c',frame:70,beatFrame:70,offsetFrames:0}]);
    const final = join(out,'final.mkv');
    expect(Math.abs(lufs(final)+14)).toBeLessThanOrEqual(0.5);
    const heard = decode(final);
    expect(heard.length).toBe(4*48000*2);
    // The voice starts at 0.4 s + 0.3 s = 0.7 s of film time: silent before, sounding after.
    const voiced = tone(heard,440,0.72,0.98);
    expect(voiced).toBeGreaterThan(0.05);
    expect(tone(heard,440,0.1,0.68)).toBeLessThan(voiced/100);
    // Voice level against the bed's open level: 0.3 against 0.1 before normalization, so 3x.
    const open = tone(heard,997,1.6,2.0);
    expect(Math.abs(db(voiced/open)-db(3))).toBeLessThan(0.5);
    // The bed is 12 dB down inside each spoken phrase (ramps excluded) and at full level between and after them.
    for (const [from,to] of [[0.75,1.35],[2.3,2.95]]) expect(Math.abs(db(tone(heard,997,from,to)/open)+12)).toBeLessThan(0.5);
    for (const [from,to] of [[0.0,0.55],[3.2,4.0]]) expect(Math.abs(db(tone(heard,997,from,to)/open))).toBeLessThan(0.5);
  } finally {await rm(dir,{recursive:true,force:true});}
});

test('validate rejects reveals off their word frame, on a changed word, outside the shot, or without a voice', async () => {
  const dir = await narratedFilm();
  try {
    expect(run('node','beats',dir,'--corrected',join(dir,'audio','grid.json')).status).toBe(0);
    const before0 = await board(dir);
    const fails = async (change:(s:any)=>void, message:string) => {
      const before = await board(dir);
      await edit(dir,change);
      const result = run('node','validate',dir);
      expect(result.stderr).toContain(`error: ${message}`);
      expect(result.status).toBe(1);
      await writeFile(join(dir,'storyboard.json'),JSON.stringify(before));
    };
    // The truncated frame 17 is refused and the message names the nearest frame.
    await fails(s => {s.shots[0].reveals[0].frame = 17;},'shot a: reveal of word 0 "Why" is at frame 17, but the word starts at 0.3 s, nearest film frame 18; move the reveal to frame 18');
    await fails(s => {s.shots[0].reveals[0].text = 'How';},'shot a: reveal of word 0 "How": word 0 in audio/words.json is "Why"');
    await fails(s => {s.shots[0].reveals[0] = {word:9,text:'less',frame:80};},'shot a: reveal of word 9 "less": the word-timing file has 4 words (0 to 3)');
    await fails(s => {s.shots[1].reveals[0] = {word:0,text:'Why',frame:18};},'shot b: reveal of word 0 "Why" at frame 18 is outside the shot [40, 70)');
    // A later voice start moves every word frame: the reveals no longer match.
    await fails(s => {s.voice.startFrame = 11;},'shot a: reveal of word 0 "Why" is at frame 18, but the word starts at 0.3 s, nearest film frame 19');
    await fails(s => {s.voice = null;},'shot a has reveals but voice is null');
    await fails(s => {s.shots[1].startFrame = 41; s.shots[0].endFrame = 41;},'off-grid: the cut into shot b at frame 41 is not a beat frame (nearest beat: frame 40)');
    await fails(s => {s.voice.startFrame = 97;},'voice word 0 "Why" starts at film frame 105, at or after the film end (100 frames)');
    // "costs" ends 2.6 s into the narration: with the audio starting at frame 36 (1.44 s) it ends at 4.04 s, past the 4 s film.
    // At frame 35 (1.4 s) it ends exactly at 4.0 s, which fits.
    await fails(s => {s.voice.startFrame = 36; s.shots[0].reveals = []; s.shots[1].reveals = [];},'voice word 3 "costs" ends at 4.04 s of film time, after the film end (4 s)');
    await edit(dir,s => {s.voice.startFrame = 35; s.shots[0].reveals = []; s.shots[1].reveals = [];});
    expect(run('node','validate',dir).stderr).toBe('');
    await writeFile(join(dir,'storyboard.json'),JSON.stringify(before0));
    await fails(s => {s.voice.script = 'audio/missing.txt';},'voice.script audio/missing.txt not found');
    // A malformed word-timing file fails validate, beatmap and mix.
    await writeFile(join(dir,'audio','words.json'),JSON.stringify([{text:'Why',start:0.6,end:0.3}]));
    const bad = 'voice.wordTimings audio/words.json: word 0 "Why" ends at 0.3 s, before its start 0.6 s';
    for (const action of ['validate','beatmap','mix']) {
      const result = run('node',action,dir);
      expect(result.stderr).toContain(`error: ${bad}`);
      expect(result.status).toBe(1);
    }
  } finally {await rm(dir,{recursive:true,force:true});}
});

test('a voice-led film without a bed mixes the narration alone, and a voice without audio is refused', async () => {
  const dir = await narratedFilm();
  try {
    await edit(dir,s => {s.audio.track = null;});
    const mixed = run('node','mix',dir);
    expect(mixed.stderr).toBe('');
    expect(mixed.status).toBe(0);
    const heard = decode(join(dir,'renders','16x9','final.mkv'));
    expect(tone(heard,440,0.72,0.98)).toBeGreaterThan(0.05);
    expect(Math.abs(lufs(join(dir,'renders','16x9','final.mkv'))+14)).toBeLessThanOrEqual(0.5);
    await edit(dir,s => {s.voice.tts = null;});
    const refused = run('node','mix',dir);
    expect(refused.stderr).toContain('error: voice.tts is null');
    expect(refused.status).toBe(1);
    for (const name of ['final.mkv','mix.wav','sync.json']) expect(await exists(join(dir,'renders','16x9',name))).toBe(false);
  } finally {await rm(dir,{recursive:true,force:true});}
});

test('a narration with transients is limited to -1 dBTP and still mixes at -14 LUFS', async () => {
  const dir = await narratedFilm(true);
  try {
    // Precondition, measured on the source file: its true peak sits more than 13 dB above its loudness, so at
    // -14 LUFS the peaks would pass the -1 dBTP ceiling without a limiter.
    const source = loudnorm(join(dir,'audio','voice.wav'));
    const peakAtTarget = Number(source.input_tp)-Number(source.input_i)+(-14);
    expect(peakAtTarget).toBeGreaterThan(CEILING_DBTP+3);
    await edit(dir,s => {s.audio.track = null;});
    for (const runtime of ['node','bun']) {
      const mixed = run(runtime,'mix',dir);
      expect(mixed.stderr).toBe('');
      expect(mixed.status).toBe(0);
      const final = join(dir,'renders','16x9','final.mkv');
      const heard = loudnorm(final);
      expect(Number(heard.input_tp)).toBeLessThanOrEqual(CEILING_DBTP);
      expect(Math.abs(Number(heard.input_i)+14)).toBeLessThanOrEqual(0.5);
      const sync = await json(join(dir,'renders','16x9','sync.json'));
      // The limiter took the peaks down by at least their excess over the ceiling at -14 LUFS (from the source measure).
      expect(sync.limiter.maxGainReductionDb).toBeGreaterThanOrEqual(peakAtTarget-CEILING_DBTP-1);
      expect(mixed.stdout).toContain(`limiter reduced peaks by up to ${sync.limiter.maxGainReductionDb} dB`);
      // The narration sine is still there between the bursts.
      expect(tone(decode(final),440,0.8,0.98)).toBeGreaterThan(0.05);
    }
  } finally {await rm(dir,{recursive:true,force:true});}
});
