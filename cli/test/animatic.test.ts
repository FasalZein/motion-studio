import {test as nodeTest} from 'node:test';
const {expect} = await import('bun' in process.versions ? 'bun:test' : 'expect');
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {appendFile, cp, mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';

// Moving animatic at G3 (#40, D62), checked as a black box. Expected frames come from the stitched master that
// `render` and `stitch` wrote; expected audio levels come from how the fixture audio is generated.
const test = (name:string, fn:()=>Promise<void>, timeout=600000) => nodeTest(name,{timeout},fn);
const here = dirname(fileURLToPath(import.meta.url));
const cli = resolve(here,'../dist/cli.js');
const fixture = resolve(here,'../fixtures/two-engine');
let home = '';
const run = (runtime:string, ...args:string[]) => spawnSync(runtime,[cli,...args],{encoding:'utf8',timeout:180000,env:{...process.env,HOME:home}});
const chrome = /^(Downloading Chrome Headless Shell|Downloading from: |Customize this behavior by adding a onBrowserDownload)/;
function ok(runtime:string, ...args:string[]) {
  const result = run(runtime,...args);
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
  return result.stdout.split('\n').filter(line => !chrome.test(line)).join('\n');
}
function refused(runtime:string, args:string[], stderr:string|RegExp) {
  const result = run(runtime,...args);
  if (typeof stderr === 'string') expect(result.stderr).toBe(stderr);
  else expect(result.stderr).toMatch(stderr);
  expect(result.status).toBe(1);
}
const sha = async (file:string) => createHash('sha256').update(await readFile(file)).digest('hex');
/** RGB bytes of frame n of a video, decoded by ffmpeg. */
const rgb = (file:string, n:number) => new Uint8Array(spawnSync('ffmpeg',['-v','error','-i',file,'-map','0:v:0','-vf',`select=eq(n\\,${n})`,'-fps_mode','passthrough','-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','-'],{encoding:null,timeout:30000,maxBuffer:1e8}).stdout);
/** Mean absolute channel difference, 0 to 255. */
function meanDiff(a:Uint8Array, b:Uint8Array) {
  expect(a.length).toBeGreaterThan(0);
  expect(a.length).toBe(b.length);
  let sum = 0;
  for (let i=0;i<a.length;i++) sum += Math.abs(a[i]-b[i]);
  return sum/a.length;
}
/** Mono float samples at 48 kHz of the first audio stream (channels averaged). */
function samples(file:string):Float32Array {
  const raw = spawnSync('ffmpeg',['-v','error','-i',file,'-map','0:a:0','-ac','1','-ar','48000','-f','f32le','-'],{encoding:null,timeout:30000,maxBuffer:1e8}).stdout;
  return new Float32Array(raw.buffer,raw.byteOffset,raw.length/4);
}
const rms = (s:Float32Array, from:number, to:number) => {
  const part = s.subarray(Math.round(from*48000),Math.round(to*48000));
  return Math.sqrt(part.reduce((sum,v) => sum+v*v,0)/part.length);
};
const audioDuration = (file:string) => Number(JSON.parse(spawnSync('ffprobe',['-v','error','-select_streams','a:0','-show_entries','stream=duration','-of','json',file],{encoding:'utf8'}).stdout).streams[0].duration);
const edit = async (dir:string, change:(s:any)=>void) => {
  const s = JSON.parse(await readFile(join(dir,'storyboard.json'),'utf8'));
  change(s);
  await writeFile(join(dir,'storyboard.json'),JSON.stringify(s));
};

// The film: 12 frames at 30 fps (0.4 s). Remotion shot 0-6 draws its frame number, HyperFrames shot 6-12 animates.
// track.wav: 220 Hz sine, amplitude 0.25 (RMS 0.25/sqrt 2). The narration built here: 440 Hz sine, amplitude 0.3
// (RMS 0.3/sqrt 2), 0.2 s long, placed from film frame 3 (0.1 s), so it sounds from 0.1 s to 0.3 s.
const FRAMES = 12, SECONDS = 0.4, TRACK_RMS = 0.25/Math.SQRT2, VOICE_RMS = 0.3/Math.SQRT2, VOICE_FROM = 0.1, VOICE_TO = 0.3;
// A window inside the narration and one before it, each trimmed 20 ms away from the edges (AAC smears edges).
const inVoice:[number,number] = [VOICE_FROM+0.02, VOICE_TO-0.02], beforeVoice:[number,number] = [0.02, VOICE_FROM-0.02];
// H.264 yuv420p at CRF 12 is lossy: a frame differs from its master frame by about 1 level on average (measured
// 0.55 to 0.94 on this fixture); a shifted frame differs by far more where the picture changes.
const ENCODE_MEAN = 2;

test('animatic encodes the current stitched master on the real track and narration, refuses stale renders, and prints liveness as advice', async () => {
  const dir = await mkdtemp(join(tmpdir(),'motion-studio-animatic-'));
  home = await mkdtemp(join(tmpdir(),'motion-studio-home-'));
  try {
    await cp(fixture,dir,{recursive:true,filter:src => !src.endsWith('/renders')});
    await mkdir(join(dir,'stills','G1'),{recursive:true});
    await mkdir(join(dir,'stills','G2','16x9'),{recursive:true});
    await writeFile(join(dir,'stills','G1','look-a.png'),'look');
    await writeFile(join(dir,'stills','G2','16x9','remotion-f000.png'),'still');
    const animaticArgs = ['animatic',dir];
    refused('node',animaticArgs,'error: animatic follows the approved board: approve G2 first (G2 is pending)\n');
    ok('node','gate',dir,'G1','approve');
    ok('node','gate',dir,'G2','approve');
    refused('bun',animaticArgs,'error: successful render and stitch required: 16:9\n');

    // Blocking renders of both engines, stitched into the primary master.
    ok('node','render',dir);
    ok('node','stitch',dir);
    const master = join(dir,'renders','16x9','master.mkv');
    const video = join(dir,'animatic.mp4');
    const first = ok('bun',...animaticArgs).split('\n');
    expect(first[0]).toBe('animatic 16:9: 12 frames from renders/16x9/master.mkv, audio music-bed, narration none -> animatic.mp4');
    expect(first[1]).toMatch(/^liveness animatic 16:9 \(advice\): (pass|fail): moving [\d.]+, still over 0\.5 s [\d.]+, over 1 s [\d.]+, over 2 s [\d.]+, longest still [\d.]+ s \(no report file\)$/);

    // Frame for frame: animatic frame n equals master frame n up to the encode, and is nearer to it than to any
    // other distinct master frame. Distances are taken on the pixels that change across the master (the Remotion
    // frame number), because the rest of the picture is the same in every frame.
    const masterFrames = Array.from({length:FRAMES},(_,n) => rgb(master,n));
    const changing = masterFrames[0].map((_,i) => masterFrames.some(m => Math.abs(m[i]-masterFrames[0][i]) > 32) ? 1 : 0);
    const onChanging = (a:Uint8Array, b:Uint8Array) => meanDiff(a.filter((_,i) => changing[i]),b.filter((_,i) => changing[i]));
    for (let n=0;n<FRAMES;n++) {
      const shown = rgb(video,n);
      expect(meanDiff(shown,masterFrames[n])).toBeLessThan(ENCODE_MEAN);
      const own = onChanging(shown,masterFrames[n]);
      for (let k=0;k<FRAMES;k++) if (onChanging(masterFrames[k],masterFrames[n]) > 0) expect(onChanging(shown,masterFrames[k])).toBeGreaterThan(own);
    }
    // The fixture makes that check meaningful: the six Remotion frames all differ, and the shots differ.
    const distinct = new Set(masterFrames.map(m => createHash('sha256').update(m).digest('hex')));
    expect(distinct.size).toBeGreaterThanOrEqual(7);
    expect(rgb(video,FRAMES).length).toBe(0);
    // The audio is the track cut to the film length (AAC frames are 1024 samples, about 21 ms).
    expect(Math.abs(audioDuration(video)-SECONDS)).toBeLessThan(0.025);
    const track = samples(video);
    expect(Math.abs(rms(track,0.05,0.35)/TRACK_RMS-1)).toBeLessThan(0.1);

    // A shot render older than its source is refused with the shot id; the other shot is not named.
    const html = join(dir,'shots','hyperframes','index.html');
    const original = await readFile(html);
    const before = await sha(video);
    await appendFile(html,'\n<!-- blocking pass 2 -->\n');
    const stale = /^error: shot render older than its source \(16:9\): hyperframes \(source changed since its render\); run motion-studio render .* 16:9 and stitch\n$/;
    refused('node',animaticArgs,stale);
    expect(await sha(video)).toBe(before);
    // Content, not file time: restoring the rendered source makes the render current again.
    await writeFile(html,original);
    ok('node',...animaticArgs);
    // Engine output inside a shot folder (hyperframes check --snapshots) and a storyboard rewritten with another key
    // order change no rendered source, so the render stays current.
    await mkdir(join(dir,'shots','hyperframes','snapshots'),{recursive:true});
    await writeFile(join(dir,'shots','hyperframes','snapshots','frame-0.png'),'snapshot');
    const boardFile = join(dir,'storyboard.json');
    const board = await readFile(boardFile,'utf8');
    const reversed = (v:unknown):unknown => Array.isArray(v) ? v.map(reversed) : v !== null && typeof v === 'object' ? Object.fromEntries(Object.entries(v).reverse().map(([k,x]) => [k,reversed(x)])) : v;
    await writeFile(boardFile,JSON.stringify(reversed(JSON.parse(board))));
    ok('bun',...animaticArgs);
    await writeFile(boardFile,board);
    await rm(join(dir,'shots','hyperframes','snapshots'),{recursive:true,force:true});
    // A render record from before source hashes cannot prove any shot current.
    const marker = join(dir,'renders','16x9','render.json');
    const record = await readFile(marker);
    await writeFile(marker,JSON.stringify({...JSON.parse(record.toString()),sources:undefined}));
    refused('bun',animaticArgs,/^error: shot render older than its source \(16:9\): remotion \(no source record in render\.json\), hyperframes \(no source record in render\.json\); /);
    await writeFile(marker,record);

    // A narrated film: the narration joins the animatic from its start frame. The voice is a G2 input, so G2 is approved again.
    spawnSync('ffmpeg',['-v','error','-y','-f','lavfi','-i','aevalsrc=0.3*sin(2*PI*440*t):s=48000:d=0.2','-c:a','pcm_s16le',join(dir,'audio','voice.wav')]);
    await writeFile(join(dir,'audio','script.txt'),'Now.');
    await writeFile(join(dir,'audio','words.json'),JSON.stringify([{text:'Now.',start:0,end:0.2}]));
    const ledger = JSON.parse(await readFile(join(dir,'ledger.json'),'utf8'));
    ledger.assets.push({id:'voice',type:'voice',sourceKind:'code',sourceUrlOrGenerator:'ffmpeg aevalsrc',providerAssetId:null,license:{status:'known',name:'CC0-1.0',evidence:'generated in test'},localPath:'audio/voice.wav',sha256:await sha(join(dir,'audio','voice.wav')),shots:[]});
    await writeFile(join(dir,'ledger.json'),JSON.stringify(ledger));
    await edit(dir,s => {s.voice = {script:'audio/script.txt',tts:'voice',wordTimings:'audio/words.json',startFrame:3}; s.audio.track = null;});
    ok('node','gate',dir,'G2','approve');
    // Narration alone (no track): silence before frame 3, the voice after it.
    expect(ok('node',...animaticArgs).split('\n')[0]).toBe('animatic 16:9: 12 frames from renders/16x9/master.mkv, audio none, narration voice -> animatic.mp4');
    const alone = samples(video);
    expect(rms(alone,...beforeVoice)).toBeLessThan(0.01);
    expect(Math.abs(rms(alone,...inVoice)/VOICE_RMS-1)).toBeLessThan(0.1);
    // Track and narration: a 220 Hz and a 440 Hz sine sum to RMS sqrt(track^2 + voice^2) where both sound.
    await edit(dir,s => {s.audio.track = 'music-bed';});
    ok('node','gate',dir,'G2','approve');
    expect(ok('bun',...animaticArgs).split('\n')[0]).toBe('animatic 16:9: 12 frames from renders/16x9/master.mkv, audio music-bed, narration voice -> animatic.mp4');
    const both = samples(video);
    expect(Math.abs(rms(both,...beforeVoice)/TRACK_RMS-1)).toBeLessThan(0.1);
    expect(Math.abs(rms(both,...inVoice)/Math.hypot(TRACK_RMS,VOICE_RMS)-1)).toBeLessThan(0.1);
    // A voice without narration audio is refused, as mix refuses it.
    await edit(dir,s => {s.voice.tts = null;});
    ok('node','gate',dir,'G2','approve');
    refused('node',animaticArgs,/^error: voice\.tts is null: /);
  } finally {await rm(dir,{recursive:true,force:true}); await rm(home,{recursive:true,force:true});}
});

test('a failing liveness verdict prints as advice and animatic still exits 0', async () => {
  const dir = await mkdtemp(join(tmpdir(),'motion-studio-animatic-still-'));
  home = await mkdtemp(join(tmpdir(),'motion-studio-home-'));
  try {
    await cp(fixture,dir,{recursive:true,filter:src => !src.endsWith('/renders')});
    // Two 45-frame shots of one flat color each: 3 s with only one change, far below the moving-share limit.
    for (const [id,color] of [['remotion','#203040'],['hyperframes','#402030']]) {
      const html = `<!doctype html><html><head><style>body {margin:0;} #root {position:relative;width:100%;height:100%;overflow:hidden;}</style></head><body><div id="root" data-composition-id="shot" data-width="320" data-height="180" data-duration="1.5"><div style="position:absolute;inset:0;background:${color}"></div></div><script>window.__timelines['shot'] = { duration: () => 1.5, pause: () => {}, seek: () => {} };</script></body></html>`;
      await mkdir(join(dir,'shots',id),{recursive:true});
      await writeFile(join(dir,'shots',id,'index.html'),html);
    }
    await edit(dir,s => {
      s.meta.durationFrames = 90;
      s.audio.beatFrames = [45];
      s.shots = s.shots.map((shot:any,i:number) => ({...shot,engine:'hyperframes',entrypoint:`shots/${shot.id}/index.html`,startFrame:45*i,endFrame:45*(i+1),soundCues:[],stillFrames:[0]}));
    });
    await mkdir(join(dir,'stills','G1'),{recursive:true});
    await mkdir(join(dir,'stills','G2','16x9'),{recursive:true});
    await writeFile(join(dir,'stills','G1','look-a.png'),'look');
    await writeFile(join(dir,'stills','G2','16x9','remotion-f000.png'),'still');
    ok('node','gate',dir,'G1','approve');
    ok('node','gate',dir,'G2','approve');
    ok('node','render',dir);
    ok('node','stitch',dir);
    const result = run('node','animatic',dir);
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    const lines = result.stdout.split('\n');
    expect(lines[1]).toMatch(/^liveness animatic 16:9 \(advice\): fail: moving 0(\.\d+)?, /);
    expect(lines.some(l => /^ {2}advice: moving share [\d.]+ is below the minimum 0\.75$/.test(l))).toBe(true);
  } finally {await rm(dir,{recursive:true,force:true}); await rm(home,{recursive:true,force:true});}
});
