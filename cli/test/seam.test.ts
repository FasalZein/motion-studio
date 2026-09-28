import {test as nodeTest} from 'node:test';
const {expect} = await import('bun' in process.versions ? 'bun:test' : 'expect');
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {cp, mkdir, mkdtemp, readFile, rm, stat, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';

const test = (name:string, fn:()=>Promise<void>, timeout=600000) => nodeTest(name,{timeout},fn);
const here = dirname(fileURLToPath(import.meta.url));
const cli = resolve(here,'../dist/cli.js');
const fixtures = resolve(here,'../fixtures');
const run = (runtime:string, ...args:string[]) => spawnSync(runtime,[cli,...args],{encoding:'utf8',timeout:180000});
const ffmpeg = (...args:string[]) => {
  const result = spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-y',...args],{encoding:'utf8',timeout:30000});
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
};
const exists = (file:string) => stat(file).then(() => true,() => false);
const copyFixtures = async (prefix:string) => {
  const dir = await mkdtemp(join(tmpdir(),prefix));
  await cp(fixtures,dir,{recursive:true,filter: src => !src.endsWith('/output')});
  return dir;
};
/** Decodes the audio of a file to interleaved 48 kHz stereo float samples, independently of the CLI. */
const audio = (file:string) => {
  const bytes = spawnSync('ffmpeg',['-v','error','-i',file,'-map','0:a:0','-f','f32le','-c:a','pcm_f32le','-'],{encoding:null,timeout:30000,maxBuffer:1e9}).stdout;
  return new Float32Array(new Uint8Array(bytes).buffer);
};
/** Sample frame of the largest absolute value within [from, to) sample frames. */
const peakAt = (samples:Float32Array, from:number, to:number) => {
  let best = -1, at = -1;
  for (let i=from*2;i<to*2;i++) if (Math.abs(samples[i]) > best) {best = Math.abs(samples[i]); at = Math.floor(i/2);}
  return at;
};
// Measured with ffmpeg's loudnorm analysis, a different filter from the CLI's ebur128 measurement.
const lufs = (file:string) => Number(JSON.parse(/\{[^{}]*"input_i"[^{}]*\}/.exec(spawnSync('ffmpeg',['-hide_banner','-nostats','-i',file,'-map','0:a:0','-af','loudnorm=print_format=json','-f','null','-'],{encoding:'utf8',timeout:30000}).stderr)![0]).input_i);
const streams = (file:string) => JSON.parse(spawnSync('ffprobe',['-v','error','-count_frames','-show_entries','stream=codec_type,sample_rate,channels,nb_read_frames','-of','json',file],{encoding:'utf8'}).stdout).streams;
const frame = (file:string, n:number) => spawnSync('ffmpeg',['-v','error','-i',file,'-map','0:v:0','-vf',`select=eq(n\\,${n})`,'-fps_mode','passthrough','-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','-'],{encoding:null,timeout:15000}).stdout;

for (const runtime of ['bun','node']) test(`${runtime}: real two-engine fixture reports the cut as a handoff mismatch and mixes an SFX peak at the seam`, async () => {
  const dir = await copyFixtures('motion-studio-seam-');
  try {
    const project = join(dir,'two-engine','project.json');
    const output = join(dir,'two-engine','output');
    expect(run(runtime,'render',project).status).toBe(0);
    expect(run(runtime,'stitch',project).status).toBe(0);
    // The fixture's shots meet at a deliberate text cut, so a handoff check must report the mismatch.
    const checked = run(runtime,'handoff',project,'remotion','hyperframes');
    expect(checked.status).not.toBe(0);
    expect(checked.stderr).toContain('handoff mismatch remotion -> hyperframes');
    const handoffReport = JSON.parse(await readFile(join(output,'handoff-remotion-hyperframes.json'),'utf8'));
    expect(handoffReport.status).toBe('mismatch');
    expect(handoffReport.cutFrame).toBe(6);
    expect(handoffReport.pair.structure).toBeGreaterThan(handoffReport.thresholds.structure);
    expect(await exists(join(output,'handoff-remotion-hyperframes.png'))).toBe(true);

    const mixed = run(runtime,'mix',project);
    expect(mixed.stderr).toBe('');
    expect(mixed.status).toBe(0);
    const sync = JSON.parse(await readFile(join(output,'sync.json'),'utf8'));
    // By construction: hit.wav peaks at 0.05 s, the event is frame 6 (0.2 s at 30 fps), and the cut at frame 6 is on the 0.2 s beat.
    expect(sync).toMatchObject({fps:30,sampleRate:48000,channels:2,targetLufs:-14});
    expect(sync.sfx).toEqual([{id:'seam-hit',eventFrame:6,sourcePeakSeconds:0.05,peakFrame:6,offsetFrames:0}]);
    expect(sync.cuts).toEqual([{frame:6,beatFrame:6,offsetFrames:0}]);
    const final = join(output,'final.mkv');
    const kinds = streams(final);
    expect(kinds.map((s:{codec_type:string}) => s.codec_type).sort()).toEqual(['audio','video']);
    const audioStream = kinds.find((s:{codec_type:string}) => s.codec_type === 'audio');
    expect(Number(audioStream.sample_rate)).toBe(48000);
    expect(audioStream.channels).toBe(2);
    expect(Number(kinds.find((s:{codec_type:string}) => s.codec_type === 'video').nb_read_frames)).toBe(12);
    expect(frame(final,6)).toEqual(frame(join(output,'master.mkv'),6));
    const samples = audio(final);
    expect(samples.length).toBe(0.4*48000*2);
    // The seam is 0.2 s = sample 9600; allow one sample of measurement slack.
    expect(Math.abs(peakAt(samples,0,samples.length/2)-9600)).toBeLessThanOrEqual(1);
    expect(Math.abs(lufs(final)+14)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(sync.integratedLufs-lufs(final))).toBeLessThanOrEqual(0.2);
  } finally {await rm(dir,{recursive:true,force:true});}
}, 360000);

for (const runtime of ['bun','node']) test(`${runtime}: matching two-engine handoff passes and an encoded color jump in the master strip fails`, async () => {
  const dir = await copyFixtures('motion-studio-handoff-');
  try {
    const project = join(dir,'handoff','project.json');
    const output = join(dir,'handoff','output');
    expect(run(runtime,'render',project).status).toBe(0);
    expect(run(runtime,'stitch',project).status).toBe(0);
    const matched = run(runtime,'handoff',project,'remotion','hyperframes');
    expect(matched.stderr).toBe('');
    expect(matched.status).toBe(0);
    expect(matched.stdout).toContain('handoff verified remotion -> hyperframes');
    const report = JSON.parse(await readFile(join(output,'handoff-remotion-hyperframes.json'),'utf8'));
    expect(report.status).toBe('match');
    expect(report.strip.frames).toEqual([5,6]);
    expect(report.strip.deviationFromShots).toEqual([{structure:0,color:0},{structure:0,color:0}]);

    // Re-encode the master with a red shift of 24 levels from the cut on. Each shot clip is unchanged.
    const master = join(output,'master.mkv');
    const jumped = join(dir,'jump.mkv');
    ffmpeg('-i',master,'-vf',"lutrgb=r='val+24':enable='gte(n,6)',format=yuv444p,setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709",'-c:v','ffv1','-level','3','-pix_fmt','yuv444p','-colorspace','bt709','-color_trc','bt709','-color_primaries','bt709',jumped);
    await cp(jumped,master);
    const broken = run(runtime,'handoff',project,'remotion','hyperframes');
    expect(broken.status).not.toBe(0);
    expect(broken.stderr).toContain('encoded color jump in master strip at frame 6');
    const jumpReport = JSON.parse(await readFile(join(output,'handoff-remotion-hyperframes.json'),'utf8'));
    expect(jumpReport.status).toBe('encoded-color-jump');
    expect(jumpReport.pair).toEqual(report.pair);
    // 24 of 255 levels in one channel is a mean color change of about 0.094.
    expect(Math.abs(jumpReport.strip.deviationFromShots[1].color-24/255)).toBeLessThan(0.01);
  } finally {await rm(dir,{recursive:true,force:true});}
}, 360000);

/** A project with a synthetic stitched master (no engine render): 25 fps, 75 frames, a cut at frame 50. */
async function synthetic(runtime:string) {
  const dir = await mkdtemp(join(tmpdir(),'motion-studio-mix-'));
  const output = join(dir,'output');
  await mkdir(output);
  await mkdir(join(dir,'audio'));
  const project = {fps:25,width:64,height:36,beatsSeconds:[0.5,1.98],wordsSeconds:[],shots:[{id:'a',engine:'hyperframes',start:0,end:50,entry:'a.html'},{id:'b',engine:'hyperframes',start:50,end:75,entry:'b.html'}],
    mix:{track:'audio/track.wav',sfx:[{id:'early',file:'audio/early.wav',frame:0},{id:'cut',file:'audio/cut.wav',frame:50}]}};
  await writeFile(join(dir,'project.json'),JSON.stringify(project));
  ffmpeg('-f','lavfi','-i','color=c=0x172b46:s=64x36:r=25:d=3','-vf','setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709','-c:v','ffv1','-level','3','-pix_fmt','yuv444p','-colorspace','bt709','-color_trc','bt709','-color_primaries','bt709',join(output,'master.mkv'));
  await writeFile(join(output,'render.json'),'{}');
  // Track: 44.1 kHz stereo 997 Hz sine, amplitude 0.05, 5 s (longer than the 3 s film).
  ffmpeg('-f','lavfi','-i','aevalsrc=0.05*sin(2*PI*997*t)|0.05*sin(2*PI*997*t):s=44100:d=5','-c:a','pcm_s16le',join(dir,'audio','track.wav'));
  // Pulses with one known peak: 0.05 s into early.wav (so its lead-in is trimmed at frame 0) and 0.2 s into cut.wav.
  ffmpeg('-f','lavfi','-i','aevalsrc=0.15*exp(-abs(t-0.05)*20000):s=48000:d=0.1','-c:a','pcm_s16le',join(dir,'audio','early.wav'));
  ffmpeg('-f','lavfi','-i','aevalsrc=0.15*exp(-abs(t-0.2)*20000):s=48000:d=0.3','-c:a','pcm_s16le',join(dir,'audio','cut.wav'));
  return {dir,output,project:join(dir,'project.json'),mix:(...args:string[]) => run(runtime,'mix',join(dir,'project.json'),...args)};
}

for (const runtime of ['bun','node']) test(`${runtime}: mix normalizes to -14 LUFS, trims an early SFX lead-in and reports fractional cut-to-beat offsets`, async () => {
  const {dir,output,project,mix} = await synthetic(runtime);
  try {
    const result = mix();
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    const sync = JSON.parse(await readFile(join(output,'sync.json'),'utf8'));
    expect(sync.fps).toBe(25);
    expect(sync.sfx).toEqual([
      {id:'early',eventFrame:0,sourcePeakSeconds:0.05,peakFrame:0,offsetFrames:0},
      {id:'cut',eventFrame:50,sourcePeakSeconds:0.2,peakFrame:50,offsetFrames:0},
    ]);
    // The 1.98 s beat is frame 49.5 at 25 fps; the cut at frame 50 is half a frame late.
    expect(sync.cuts).toEqual([{frame:50,beatFrame:49.5,offsetFrames:0.5}]);
    // The track alone is about -26 LUFS before normalization.
    expect(sync.gainDb).toBeGreaterThan(10);
    const final = join(output,'final.mkv');
    expect(Math.abs(lufs(final)+14)).toBeLessThanOrEqual(0.5);
    const samples = audio(final);
    expect(samples.length).toBe(3*48000*2);
    expect(Math.abs(peakAt(samples,0,2400)-0)).toBeLessThanOrEqual(2);
    expect(Math.abs(peakAt(samples,96000-2400,96000+2400)-96000)).toBeLessThanOrEqual(2);
    expect(Math.abs(lufs(join(output,'mix.wav'))+14)).toBeLessThanOrEqual(0.5);

    // A louder SFX would clip after normalization: the mix fails and removes the earlier deliverables.
    ffmpeg('-f','lavfi','-i','aevalsrc=0.9*exp(-abs(t-0.2)*3000):s=48000:d=0.3','-c:a','pcm_s16le',join(dir,'audio','cut.wav'));
    const clipped = mix();
    expect(clipped.status).not.toBe(0);
    expect(clipped.stderr).toContain('mix would clip');
    for (const name of ['final.mkv','mix.wav','sync.json']) expect(await exists(join(output,name))).toBe(false);
    expect(await exists(project)).toBe(true);
  } finally {await rm(dir,{recursive:true,force:true});}
}, 120000);

test('mix and handoff reject invalid requests', async () => {
  const {dir,output,project,mix} = await synthetic('node');
  try {
    const data = JSON.parse(await readFile(project,'utf8'));
    const expectFailure = async (change:(d:any)=>void, message:string, ...args:string[]) => {
      const copy = structuredClone(data);
      change(copy);
      await writeFile(project,JSON.stringify(copy));
      const result = args.length ? run('node',...args) : mix();
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain(message);
    };
    await expectFailure(d => {delete d.mix;},'project has no mix section');
    await expectFailure(d => {d.mix.sfx[1].frame = 75;},'sfx cut event frame outside the timeline');
    await expectFailure(() => {},'does not directly follow shot b','handoff',project,'b','a');
    await rm(join(output,'render.json'));
    await expectFailure(() => {},'successful render and stitch required');
  } finally {await rm(dir,{recursive:true,force:true});}
}, 60000);
