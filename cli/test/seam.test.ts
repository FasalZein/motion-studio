import {test as nodeTest} from 'node:test';
const {expect} = await import('bun' in process.versions ? 'bun:test' : 'expect');
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {cp, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';

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
const json = async (file:string) => JSON.parse(await readFile(file,'utf8'));
const copyFilm = async (name:string) => {
  const dir = await mkdtemp(join(tmpdir(),`motion-studio-${name}-`));
  await cp(join(fixtures,name),dir,{recursive:true,filter: src => !src.endsWith('/renders')});
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
const ffv1 = ['-c:v','ffv1','-level','3','-pix_fmt','yuv444p','-colorspace','bt709','-color_trc','bt709','-color_primaries','bt709'];
/** Re-encodes a lossless clip with the red channel raised by `levels` from frame `from` on. */
const redShift = async (file:string, levels:number, from:number, scratch:string) => {
  ffmpeg('-i',file,'-vf',`lutrgb=r='val+${levels}':enable='gte(n,${from})',format=yuv444p,setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709`,...ffv1,scratch);
  await cp(scratch,file);
};

for (const runtime of ['bun','node']) test(`${runtime}: real two-engine fixture mixes an SFX peak at the cut seam`, async () => {
  const dir = await copyFilm('two-engine');
  try {
    const output = join(dir,'renders','16x9');
    expect(run(runtime,'render',dir).status).toBe(0);
    expect(run(runtime,'stitch',dir).status).toBe(0);
    // This film declares only a cut, so there is no handoff to check.
    const none = run(runtime,'handoff',dir);
    expect(none.status).toBe(1);
    expect(none.stderr).toContain('no handoff seams declared');

    const mixed = run(runtime,'mix',dir);
    expect(mixed.stderr).toBe('');
    expect(mixed.status).toBe(0);
    const sync = await json(join(output,'sync.json'));
    // By construction: hit.wav peaks at 0.05 s, the cue event is frame 6 (0.2 s at 30 fps), and the cut at frame 6 is on beat frame 6.
    expect(sync).toMatchObject({fps:30,sampleRate:48000,channels:2,targetLufs:-14});
    expect(sync.sfx).toEqual([{asset:'sfx-hit',eventFrame:6,plannedOffsetFrames:0,gainDb:0,sourcePeakSeconds:0.05,peakFrame:6,offsetFrames:0}]);
    expect(sync.cuts).toEqual([{shot:'hyperframes',frame:6,beatFrame:6,offsetFrames:0}]);
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

    // A new stitch makes the mix evidence stale, so it is removed.
    expect(run(runtime,'stitch',dir).status).toBe(0);
    for (const name of ['final.mkv','mix.wav','sync.json']) expect(await exists(join(output,name))).toBe(false);
  } finally {await rm(dir,{recursive:true,force:true});}
}, 360000);

for (const runtime of ['bun','node']) test(`${runtime}: declared handoffs: the matching one passes, the intentional mismatch fails, and master and color defects are caught`, async () => {
  const dir = await copyFilm('handoff');
  try {
    const output = join(dir,'renders','16x9');
    expect(run(runtime,'render',dir).status).toBe(0);
    expect(run(runtime,'stitch',dir).status).toBe(0);
    const all = run(runtime,'handoff',dir);
    expect(all.status).toBe(1);
    expect(all.stdout).toContain('handoff verified slide -> title');
    expect(all.stderr).toContain('handoff mismatch title -> drift');
    const matched = await json(join(output,'handoff-slide-title.json'));
    expect(matched).toMatchObject({cutFrame:6,declared:true,status:'match',strip:{frames:[5,6],identicalToShots:[true,true]}});
    const mismatched = await json(join(output,'handoff-title-drift.json'));
    expect(mismatched).toMatchObject({cutFrame:12,declared:true,status:'mismatch',strip:{identicalToShots:[true,true]}});
    expect(mismatched.pair.structure).toBeGreaterThan(mismatched.thresholds.structure);
    expect(await exists(join(output,'handoff-title-drift.png'))).toBe(true);
    const pair = run(runtime,'handoff',dir,'slide','title');
    expect(pair.stderr).toBe('');
    expect(pair.status).toBe(0);

    // Encoded color jump: re-encode the master with a red shift of 3 levels from the seam on. The shot clips are unchanged.
    // The shift is below both pair limits, so only the exact master-to-shot comparison catches it.
    await redShift(join(output,'master.mkv'),3,6,join(dir,'jump.mkv'));
    const jumped = run(runtime,'handoff',dir,'slide','title');
    expect(jumped.status).toBe(1);
    expect(jumped.stderr).toContain('encoded color jump in master strip at frame 6');
    const jumpReport = await json(join(output,'handoff-slide-title.json'));
    expect(jumpReport.status).toBe('encoded-color-jump');
    expect(jumpReport.pair).toEqual(matched.pair);
    expect(jumpReport.strip.identicalToShots).toEqual([true,false]);
    expect(jumpReport.strip.acrossCut.structure).toBeLessThanOrEqual(jumpReport.thresholds.structure);
    expect(jumpReport.strip.acrossCut.color).toBeLessThanOrEqual(jumpReport.thresholds.color);

    // A run that fails before measuring leaves no report from the earlier runs.
    const marker = await readFile(join(output,'render.json'));
    await rm(join(output,'render.json'));
    const unrendered = run(runtime,'handoff',dir);
    expect(unrendered.status).toBe(1);
    expect(unrendered.stderr).toContain('successful render and stitch required');
    expect((await readdir(output)).filter(f => f.startsWith('handoff-'))).toEqual([]);

    // Color-only mismatch: the title shot's red channel is 24 levels higher; layout is unchanged.
    await writeFile(join(output,'render.json'),marker);
    await redShift(join(output,'shots','title.mkv'),24,0,join(dir,'red.mkv'));
    expect(run(runtime,'stitch',dir).status).toBe(0);
    const recolored = run(runtime,'handoff',dir,'slide','title');
    expect(recolored.status).toBe(1);
    expect(recolored.stderr).toContain('handoff mismatch slide -> title');
    const colorReport = await json(join(output,'handoff-slide-title.json'));
    expect(colorReport.pair.structure).toBeLessThanOrEqual(colorReport.thresholds.structure);
    // 24 of 255 levels in one channel is a mean color change of about 0.094.
    expect(Math.abs(colorReport.pair.color-24/255)).toBeLessThan(0.01);
  } finally {await rm(dir,{recursive:true,force:true});}
}, 360000);

const sha256 = async (file:string) => createHash('sha256').update(await readFile(file)).digest('hex');
type Cue = {asset:string; eventFrame:number; peakOffsetFrames:number; gainDb?:number};
/** A film with a synthetic stitched master (no engine render): 25 fps, 75 frames, an off-beat cut at frame 50. */
async function syntheticFilm(runtime:string) {
  const dir = await mkdtemp(join(tmpdir(),'motion-studio-mix-'));
  const output = join(dir,'renders','16x9');
  for (const sub of ['renders/16x9','audio','shots/a','shots/b']) await mkdir(join(dir,sub),{recursive:true});
  for (const id of ['a','b']) await writeFile(join(dir,'shots',id,'index.html'),'<!doctype html>');
  ffmpeg('-f','lavfi','-i','color=c=0x172b46:s=64x36:r=25:d=3','-vf','setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709',...ffv1,join(output,'master.mkv'));
  await writeFile(join(output,'render.json'),'{}');
  // Track: 44.1 kHz stereo 997 Hz sine, amplitude 0.05, 5 s (longer than the 3 s film).
  ffmpeg('-f','lavfi','-i','aevalsrc=0.05*sin(2*PI*997*t)|0.05*sin(2*PI*997*t):s=44100:d=5','-c:a','pcm_s16le',join(dir,'audio','track.wav'));
  // Pulses with one known peak: 0.05 s into early.wav (its lead-in is trimmed at frame 0) and 0.2 s into cut.wav.
  ffmpeg('-f','lavfi','-i','aevalsrc=0.15*exp(-abs(t-0.05)*20000):s=48000:d=0.1','-c:a','pcm_s16le',join(dir,'audio','early.wav'));
  ffmpeg('-f','lavfi','-i','aevalsrc=0.15*exp(-abs(t-0.2)*20000):s=48000:d=0.3','-c:a','pcm_s16le',join(dir,'audio','cut.wav'));
  const write = async (cues:{a:Cue[]; b:Cue[]}, track:string|null = 'track') => {
    const shot = (id:string, start:number, end:number, soundCues:Cue[], extra = {}) => ({id,startFrame:start,endFrame:end,engine:'hyperframes',entrypoint:`shots/${id}/index.html`,description:'',camera:'custom:locked',entry:'cut',exit:'cut',assets:[],soundCues,stillFrames:[],protected:[],...extra});
    const storyboard = {version:'0',meta:{title:'mix',logline:'',genre:null,formats:{primary:'16:9',extra:[]},fps:25,durationFrames:75,layouts:{'16:9':{canvas:{width:64,height:36},safe:{x:0,y:0,width:64,height:36},overlay:null}}},look:{id:null,styleBible:null,axes:{},tasteSnapshot:null},
      audio:{track,grid:'imported',bpm:null,beatFrames:[12,49],downbeatFrames:[],dropFrames:[],confidence:'high'},voice:null,
      shots:[shot('a',0,50,cues.a),shot('b',50,75,cues.b,{offBeatCut:'word-timed reveal'})],
      gates:['G1','G2','G3','G4','G5'].map(id => ({id,state:'pending',inputHashes:{},decision:null,notes:[],rounds:0})),critique:[]};
    const assets = [];
    for (const id of ['track','early','cut']) assets.push({id,type:id === 'track' ? 'music' : 'sfx',sourceKind:'code',sourceUrlOrGenerator:'ffmpeg aevalsrc',providerAssetId:null,license:{status:'known',name:'CC0-1.0',evidence:'generated in test'},localPath:`audio/${id}.wav`,sha256:await sha256(join(dir,'audio',`${id}.wav`)),shots:['a','b']});
    await writeFile(join(dir,'storyboard.json'),JSON.stringify(storyboard));
    await writeFile(join(dir,'ledger.json'),JSON.stringify({version:'0',assets}));
  };
  const defaultCues = {a:[{asset:'early',eventFrame:0,peakOffsetFrames:0}],b:[{asset:'cut',eventFrame:50,peakOffsetFrames:-2}]};
  await write(defaultCues);
  return {dir,output,write,defaultCues,mix:() => run(runtime,'mix',dir)};
}

for (const runtime of ['bun','node']) test(`${runtime}: mix places planned peak offsets, normalizes to -14 LUFS, reports off-beat cuts, and a per-SFX gain prevents clipping`, async () => {
  const {dir,output,write,defaultCues,mix} = await syntheticFilm(runtime);
  try {
    const result = mix();
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    const sync = await json(join(output,'sync.json'));
    expect(sync.fps).toBe(25);
    // The cut cue plans its peak 2 frames before the event: frame 48 = 1.92 s = sample 92160.
    expect(sync.sfx).toEqual([
      {asset:'early',eventFrame:0,plannedOffsetFrames:0,gainDb:0,sourcePeakSeconds:0.05,peakFrame:0,offsetFrames:0},
      {asset:'cut',eventFrame:50,plannedOffsetFrames:-2,gainDb:0,sourcePeakSeconds:0.2,peakFrame:48,offsetFrames:-2},
    ]);
    // The cut at frame 50 is one frame after beat 49 and declares an off-beat reason.
    expect(sync.cuts).toEqual([{shot:'b',frame:50,beatFrame:49,offsetFrames:1,offBeatCut:'word-timed reveal'}]);
    // The track alone is about -26 LUFS before normalization.
    expect(sync.gainDb).toBeGreaterThan(10);
    const final = join(output,'final.mkv');
    expect(Math.abs(lufs(final)+14)).toBeLessThanOrEqual(0.5);
    const samples = audio(final);
    expect(samples.length).toBe(3*48000*2);
    expect(peakAt(samples,0,2400)).toBeLessThanOrEqual(2);
    expect(Math.abs(peakAt(samples,92160-2400,92160+2400)-92160)).toBeLessThanOrEqual(2);
    expect(Math.abs(lufs(join(output,'mix.wav'))+14)).toBeLessThanOrEqual(0.5);

    // A loud SFX (peak 0.9) over the quiet track clips after normalization: the mix fails and removes the earlier outputs.
    ffmpeg('-f','lavfi','-i','aevalsrc=0.9*exp(-abs(t-0.2)*20000):s=48000:d=0.3','-c:a','pcm_s16le',join(dir,'audio','cut.wav'));
    await write(defaultCues);
    const clipped = mix();
    expect(clipped.status).toBe(1);
    expect(clipped.stderr).toContain('mix would clip');
    for (const name of ['final.mkv','mix.wav','sync.json']) expect(await exists(join(output,name))).toBe(false);

    // The same SFX 20 dB down (peak 0.09) mixes without clipping.
    await write({a:defaultCues.a,b:[{...defaultCues.b[0],gainDb:-20}]});
    const lowered = mix();
    expect(lowered.stderr).toBe('');
    expect(lowered.status).toBe(0);
    const loweredSync = await json(join(output,'sync.json'));
    expect(loweredSync.sfx[1]).toMatchObject({gainDb:-20,peakFrame:48,offsetFrames:-2});
    const loweredSamples = audio(join(output,'final.mkv'));
    expect(Math.abs(peakAt(loweredSamples,92160-2400,92160+2400)-92160)).toBeLessThanOrEqual(2);
    expect(loweredSamples.reduce((m,v) => Math.max(m,Math.abs(v)),0)).toBeLessThan(1);
    expect(Math.abs(lufs(join(output,'final.mkv'))+14)).toBeLessThanOrEqual(0.5);
  } finally {await rm(dir,{recursive:true,force:true});}
}, 120000);

test('mix and handoff reject invalid requests', async () => {
  const {dir,output,write,defaultCues,mix} = await syntheticFilm('node');
  try {
    const expectFailure = (result:ReturnType<typeof mix>, message:string) => {
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(message);
    };
    await write({a:[],b:[]},null);
    expectFailure(mix(),'nothing to mix: audio.track is null and no shot has sound cues');
    await write({a:[{asset:'early',eventFrame:50,peakOffsetFrames:0}],b:[]});
    expectFailure(mix(),'shot a: sound cue early eventFrame 50 is outside the shot [0, 50)');
    await write(defaultCues);
    // Narration is not mixed until #19: a film with a voice is refused, and earlier mix outputs do not survive.
    expect(mix().status).toBe(0);
    const board = await json(join(dir,'storyboard.json'));
    await writeFile(join(dir,'storyboard.json'),JSON.stringify({...board,voice:{script:'audio/script.md',tts:'track',wordTimings:'audio/words.json'}}));
    expectFailure(mix(),'narration mixing arrives with #19');
    for (const name of ['final.mkv','mix.wav','sync.json']) expect(await exists(join(output,name))).toBe(false);
    await write(defaultCues);
    expectFailure(run('node','handoff',dir,'b','a'),'shot a does not directly follow shot b');
    expectFailure(run('node','handoff',dir,'a','b','4:3'),'format 4:3 is not a chosen format');
    expectFailure(run('node','handoff',dir,'a'),'usage: motion-studio handoff');
    await rm(join(output,'render.json'));
    expectFailure(mix(),'successful render and stitch required');
    expectFailure(run('node','handoff',dir,'a','b'),'successful render and stitch required');
  } finally {await rm(dir,{recursive:true,force:true});}
}, 60000);

/** Decodes every frame of a file as raw RGB, one buffer per frame. */
const allFrames = (file:string, width:number, height:number) => {
  const bytes = spawnSync('ffmpeg',['-v','error','-i',file,'-map','0:v:0','-fps_mode','passthrough','-f','rawvideo','-pix_fmt','rgb24','-'],{encoding:null,timeout:30000,maxBuffer:1e9}).stdout;
  const size = width*height*3;
  return Array.from({length:bytes.length/size},(_,i) => bytes.subarray(i*size,(i+1)*size));
};
const timestamps = (file:string) => spawnSync('ffprobe',['-v','error','-select_streams','v:0','-show_entries','frame=best_effort_timestamp_time','-of','csv=p=0',file],{encoding:'utf8'}).stdout.trim().split('\n').map(Number);

// Four 7-frame shots: 7 frames is not a whole number of milliseconds at 24, 30 or 60 fps (25 fps is the control).
// Matroska stores milliseconds, so the nearest representable time of frame i is at most 0.5 ms from i/fps.
for (const fps of [24,25,30,60]) test(`stitch keeps one global frame clock for four 7-frame shots at ${fps} fps`, async () => {
  const dir = await mkdtemp(join(tmpdir(),`motion-studio-clock-${fps}-`));
  try {
    const ids = ['a','b','c','d'], length = 7, total = ids.length*length;
    const clips = join(dir,'renders','16x9','shots');
    await mkdir(clips,{recursive:true});
    const shots = ids.map((id,i) => ({id,startFrame:i*length,endFrame:(i+1)*length,engine:'hyperframes',entrypoint:`shots/${id}/index.html`,description:'',camera:'custom:locked',entry:'cut',exit:'cut',assets:[],soundCues:[],stillFrames:[],protected:[]}));
    const storyboard = {version:'0',meta:{title:'clock',logline:'',genre:null,formats:{primary:'16:9',extra:[]},fps,durationFrames:total,layouts:{'16:9':{canvas:{width:64,height:36},safe:{x:0,y:0,width:64,height:36},overlay:null}}},look:{id:null,styleBible:null,axes:{},tasteSnapshot:null},
      audio:{track:null,grid:null,bpm:null,beatFrames:[],downbeatFrames:[],dropFrames:[],confidence:null},voice:null,shots,
      gates:['G1','G2','G3','G4','G5'].map(id => ({id,state:'pending',inputHashes:{},decision:null,notes:[],rounds:0})),critique:[]};
    await writeFile(join(dir,'storyboard.json'),JSON.stringify(storyboard));
    await writeFile(join(dir,'ledger.json'),JSON.stringify({version:'0',assets:[]}));
    for (const id of ids) {await mkdir(join(dir,'shots',id),{recursive:true}); await writeFile(join(dir,'shots',id,'index.html'),'<!doctype html>');}
    // Each clip is its own slice of one testsrc sequence (its frame counter differs on every frame), encoded on its own
    // like a rendered shot; the reference is the whole sequence encoded once.
    const source = `testsrc=size=64x36:rate=${fps},setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709`;
    for (const [i,id] of ids.entries()) ffmpeg('-f','lavfi','-i',`${source},trim=start_frame=${i*length}:end_frame=${(i+1)*length},setpts=PTS-STARTPTS`,...ffv1,join(clips,`${id}.mkv`));
    ffmpeg('-f','lavfi','-i',source,'-frames:v',String(total),...ffv1,join(dir,'reference.mkv'));
    await writeFile(join(dir,'renders','16x9','render.json'),'{}');

    const stitched = run('node','stitch',dir);
    expect(stitched.stderr).toBe('');
    expect(stitched.status).toBe(0);
    const master = join(dir,'renders','16x9','master.mkv');
    const times = timestamps(master);
    expect(times.length).toBe(total);
    times.forEach((t,i) => expect(Math.abs(t-i/fps)).toBeLessThanOrEqual(0.0005+1e-9));
    // No frame dropped, duplicated or reordered: the master decodes to exactly the reference sequence.
    const frames = allFrames(master,64,36), reference = allFrames(join(dir,'reference.mkv'),64,36);
    expect(frames.length).toBe(total);
    frames.forEach((f,i) => expect(f.equals(reference[i])).toBe(true));
  } finally {await rm(dir,{recursive:true,force:true});}
}, 60000);

// Shot ids `master` and `final` are legal and name pipeline outputs; each format renders at its own canvas,
// so handoff and mix run on every chosen format.
for (const runtime of ['bun','node']) test(`${runtime}: shots named master and final render, stitch, hand off and mix in two formats`, async () => {
  const dir = await copyFilm('two-engine');
  try {
    const rename = {remotion:'master',hyperframes:'final'} as const;
    for (const [from,to] of Object.entries(rename)) await cp(join(dir,'shots',from),join(dir,'shots',to),{recursive:true});
    for (const from of Object.keys(rename)) await rm(join(dir,'shots',from),{recursive:true});
    const id = (old:string) => rename[old as keyof typeof rename] ?? old;
    const path = (p:string) => p.replace(/^shots\/(remotion|hyperframes)\//,(_,old) => `shots/${id(old)}/`);
    const ledger = await json(join(dir,'ledger.json'));
    for (const asset of ledger.assets) {asset.localPath = path(asset.localPath); asset.shots = asset.shots.map(id);}
    await writeFile(join(dir,'ledger.json'),JSON.stringify(ledger));
    // The fixture's Remotion composition is fixed at 320x180; size it from the layout prop so it renders in 9:16 too.
    const entry = join(dir,'shots','master','src','index.tsx');
    const source = await readFile(entry,'utf8');
    expect(source).toContain('height={180} />');
    await writeFile(entry,source.replace('height={180} />','height={180} calculateMetadata={({props}: any) => ({width: props.layout.canvas.width, height: props.layout.canvas.height})} />'));
    const board = await json(join(dir,'storyboard.json'));
    for (const shot of board.shots) {shot.id = id(shot.id); if (shot.engine === 'hyperframes') shot.entrypoint = path(shot.entrypoint);}
    board.meta.formats.extra = ['9:16'];
    board.meta.layouts['9:16'] = {canvas:{width:180,height:320},safe:{x:9,y:16,width:162,height:288},overlay:null};
    await writeFile(join(dir,'storyboard.json'),JSON.stringify(board));
    expect(board.shots.map((s:{id:string}) => s.id)).toEqual(['master','final']);

    const rendered = run(runtime,'render',dir);
    expect(rendered.stderr).toBe('');
    expect(rendered.status).toBe(0);
    const stitched = run(runtime,'stitch',dir);
    expect(stitched.stderr).toBe('');
    expect(stitched.status).toBe(0);
    const size = {'16x9':[320,180],'9x16':[180,320]} as const;
    for (const [folder,[width,height]] of Object.entries(size)) {
      const output = join(dir,'renders',folder);
      const master = allFrames(join(output,'master.mkv'),width,height);
      const shotMaster = allFrames(join(output,'shots','master.mkv'),width,height);
      const shotFinal = allFrames(join(output,'shots','final.mkv'),width,height);
      // The stitched master holds both shots in order; neither clip was used as, or replaced by, a pipeline output.
      expect([master.length,shotMaster.length,shotFinal.length]).toEqual([12,6,6]);
      master.forEach((f,i) => expect(f.equals(i < 6 ? shotMaster[i] : shotFinal[i-6])).toBe(true));
    }

    // The fixture's seam is a cut between different pictures, so a forced handoff check fails, but in both formats.
    const handed = run(runtime,'handoff',dir,'master','final');
    expect(handed.status).toBe(1);
    for (const format of ['16:9','9:16']) expect(handed.stderr).toContain(`handoff mismatch master -> final (${format})`);
    for (const folder of Object.keys(size)) expect(await json(join(dir,'renders',folder,'handoff-master-final.json'))).toMatchObject({from:'master',to:'final',cutFrame:6,status:'mismatch'});

    const mixed = run(runtime,'mix',dir);
    expect(mixed.stderr).toBe('');
    expect(mixed.status).toBe(0);
    expect(mixed.stdout).toContain('mix 16:9 verified 12 frames');
    expect(mixed.stdout).toContain('mix 9:16 verified 12 frames');
    for (const folder of Object.keys(size)) {
      const output = join(dir,'renders',folder);
      const kinds = streams(join(output,'final.mkv'));
      expect(kinds.map((s:{codec_type:string}) => s.codec_type).sort()).toEqual(['audio','video']);
      expect(Number(kinds.find((s:{codec_type:string}) => s.codec_type === 'video').nb_read_frames)).toBe(12);
      // The delivery file did not overwrite the shot clip of the same name.
      expect(streams(join(output,'shots','final.mkv')).map((s:{codec_type:string; nb_read_frames:string}) => [s.codec_type,Number(s.nb_read_frames)])).toEqual([['video',6]]);
    }

    // A named format limits the run to that format.
    expect(run(runtime,'mix',dir,'9:16').stdout.trim()).toMatch(/^mix 9:16 verified 12 frames/);
  } finally {await rm(dir,{recursive:true,force:true});}
}, 600000);
