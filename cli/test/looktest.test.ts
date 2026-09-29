import {test as nodeTest, after} from 'node:test';
const {expect} = await import('bun' in process.versions ? 'bun:test' : 'expect');
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {appendFile, chmod, cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';

// Black-box look-test checks (D61). The fixture film has a 320x180 primary layout and a 180x320 extra layout, and
// three look tests of 24 frames at 30 fps: hf-slide (HyperFrames) and rm-slide (Remotion) draw the same scene: a
// 40x40 red box crosses the safe area, x = safe.x + (safe.width-40)*frame/23, y centered in the safe area, and the
// background turns from blue #172b46 to green #2d4a2f at frame 12. still-card never moves. Expected pixels below are
// computed from those formulas and the layouts in the fixture's storyboard.json.
const test = (name:string, fn:()=>Promise<void>, timeout=300000) => nodeTest(name,{timeout},fn);
const here = dirname(fileURLToPath(import.meta.url));
const cli = resolve(here,'../dist/cli.js');
const fixture = resolve(here,'../fixtures/looktest');
const looksDir = resolve(here,'../../skills/motion-look/looks');
const termsDir = resolve(here,'../../skills/motion-vocabulary/terms');
const runtime = 'bun' in process.versions ? 'bun' : 'node';
const privateTmp = await mkdtemp(join(tmpdir(),'motion-studio-looktest-tmp-'));
after(async () => {await rm(privateTmp,{recursive:true,force:true});});
const run = (...args:string[]) => spawnSync(runtime,[cli,...args],{encoding:'utf8',timeout:240000,env:{...process.env,TMPDIR:privateTmp},stdio:['ignore','pipe','pipe']});
type Json = Record<string,any>;

async function film(fn:(dir:string)=>Promise<void>) {
  const base = await mkdtemp(join(tmpdir(),'motion-studio-looktest-'));
  try {
    const dir = join(base,'film');
    await cp(fixture,dir,{recursive:true});
    await fn(dir);
  } finally {await rm(base,{recursive:true,force:true});}
}
const sha256 = async (file:string) => createHash('sha256').update(await readFile(file)).digest('hex');
function probe(file:string):Json {
  const r = spawnSync('ffprobe',['-v','error','-select_streams','v:0','-count_frames','-show_entries','stream=codec_name,width,height,nb_read_frames','-of','json',file],{encoding:'utf8'});
  return JSON.parse(r.stdout).streams[0];
}
/** RGB of one pixel of one frame (frame index into the video; a PNG has one frame). */
function pixel(file:string, frame:number, x:number, y:number):number[] {
  const r = spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-nostdin','-i',file,'-vf',`select=eq(n\\,${frame}),crop=1:1:${x}:${y}`,'-fps_mode','passthrough','-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','-'],{maxBuffer:1<<20});
  return [...r.stdout];
}
const near = (actual:number[], hex:string) => {
  const want = [1,3,5].map(i => parseInt(hex.slice(i,i+2),16));
  expect(actual.every((v,i) => Math.abs(v-want[i]) <= 6)).toBe(true);
};
const RED = '#e05b45', BLUE = '#172b46', GREEN = '#2d4a2f';
const hidden = async (dir:string) => (await readdir(dir)).filter(f => f.startsWith('.motion-'));

test('looktest renders a HyperFrames and a Remotion look test into clip, poster and liveness report at the primary layout', async () => {
  await film(async dir => {
    for (const [look,engine] of [['hf-slide','hyperframes'],['rm-slide','remotion']]) {
      const result = run('looktest',dir,look);
      expect(result.status).toBe(0);
      expect(result.stdout).toContain(`liveness look test ${look}: pass: moving 1,`);
      expect(result.stdout).toContain(`looktest ${look}: ${engine} 16:9 24 frames -> stills/G1/${look}.mkv, poster frame 12 -> stills/G1/${look}.png\n`);
      const clip = join(dir,'stills/G1',`${look}.mkv`), poster = join(dir,'stills/G1',`${look}.png`);
      // The clip follows the render media contract at the primary layout: FFV1, 320x180, every frame.
      expect(probe(clip)).toMatchObject({codec_name:'ffv1', width:320, height:180, nb_read_frames:'24'});
      expect(probe(poster)).toMatchObject({width:320, height:180});
      // Poster frame 12: the box spans x 144.7-184.7 and y 70-110 on the green background.
      near(pixel(poster,0,164,90),RED);
      near(pixel(poster,0,10,170),GREEN);
      // Clip frame 0: the box spans x 32-72 on the blue background.
      near(pixel(clip,0,52,90),RED);
      near(pixel(clip,0,200,170),BLUE);
      const report = JSON.parse(await readFile(join(dir,'stills/G1',`${look}.liveness.json`),'utf8'));
      expect(report).toMatchObject({lookId:look, engine, format:'16:9', frames:24, posterFrame:12, video:`stills/G1/${look}.mkv`, durationSeconds:0.8, pass:true, failures:[]});
      expect(report.sha256).toBe(await sha256(clip));
    }
    // Scratch folders are gone: the film's staging, the HyperFrames stage beside the look test, and the private TMPDIR.
    expect(await hidden(dir)).toEqual([]);
    expect(await hidden(join(dir,'shots/_look'))).toEqual([]);
    expect(await readdir(privateTmp)).toEqual([]);
  });
});

test('a look test promoted to a shot renders in a second format without source edits', async () => {
  await film(async dir => {
    const board = JSON.parse(await readFile(join(dir,'storyboard.json'),'utf8'));
    await cp(join(dir,'shots/_look/hf-slide'),join(dir,'shots/hero-a'),{recursive:true});
    await cp(join(dir,'shots/_look/rm-slide'),join(dir,'shots/hero-b'),{recursive:true});
    const shot = {camera:'custom:look test', entry:'cut', exit:'cut', assets:[], soundCues:[], stillFrames:[0], protected:[]};
    board.meta.durationFrames = 48;
    board.shots = [
      {id:'hero-a', startFrame:0, endFrame:24, engine:'hyperframes', entrypoint:'shots/hero-a/index.html', description:'promoted HyperFrames look test', ...shot},
      {id:'hero-b', startFrame:24, endFrame:48, engine:'remotion', entrypoint:'Look', description:'promoted Remotion look test', thread:{kind:'shared-element-thread', shared:'the red box'}, ...shot},
    ];
    await writeFile(join(dir,'storyboard.json'),JSON.stringify(board,null,2));
    const result = run('render',dir,'9:16');
    expect(result.stderr).toBe('');
    expect(result.stdout).toBe('render 9:16 verified 24+24 frames\n');
    for (const id of ['hero-a','hero-b']) {
      const clip = join(dir,'renders/9x16/shots',`${id}.mkv`);
      expect(probe(clip)).toMatchObject({width:180, height:320, nb_read_frames:'24'});
      // 9:16 safe area x 18, y 48, 144x224: at frame 12 the box spans x 72.3-112.3 and y 140-180, a place the
      // 16:9 layout leaves as background, so the source read the 9:16 layout inputs.
      near(pixel(clip,12,92,160),RED);
      near(pixel(clip,12,160,20),GREEN);
    }
    // The promoted sources are the look tests byte for byte.
    for (const [from,to] of [['hf-slide/index.html','hero-a/index.html'],['rm-slide/src/index.tsx','hero-b/src/index.tsx']]) {
      expect(await sha256(join(dir,'shots',to))).toBe(await sha256(join(fixture,'shots/_look',from)));
    }
  });
});

test('approving G1 freezes the look-test clip and poster; a changed approved clip makes G1 stale', async () => {
  await film(async dir => {
    expect(run('looktest',dir,'hf-slide').status).toBe(0);
    const approve = run('gate',dir,'G1','approve','--note','the sliding box');
    expect(approve.status).toBe(0);
    const [frozen] = await readdir(join(dir,'stills/approved'));
    expect(frozen).toMatch(/^G1-[0-9a-f]{8}$/);
    expect((await readdir(join(dir,'stills/approved',frozen))).sort()).toEqual(['hf-slide.liveness.json','hf-slide.mkv','hf-slide.png']);
    for (const file of ['hf-slide.mkv','hf-slide.png']) expect(await sha256(join(dir,'stills/approved',frozen,file))).toBe(await sha256(join(dir,'stills/G1',file)));
    const status = () => run('status',dir).stdout.split('\n')[0];
    expect(status()).toBe('G1 approved');
    // D43 unchanged: the approval binds the frozen copy, so a new live render leaves G1 approved.
    await appendFile(join(dir,'stills/G1/hf-slide.mkv'),'x');
    expect(status()).toBe('G1 approved');
    // Changing the approved clip itself makes G1 stale.
    const approvedClip = join(dir,'stills/approved',frozen,'hf-slide.mkv');
    await chmod(approvedClip,0o644);
    await appendFile(approvedClip,'x');
    expect(status()).toBe('G1 stale (changed: stills/G1/hf-slide.mkv)');
  });
});

test('looktest refuses a look test whose clip fails the liveness limits and removes its earlier outputs', async () => {
  await film(async dir => {
    await mkdir(join(dir,'stills/G1'),{recursive:true});
    for (const f of ['still-card.mkv','still-card.png','still-card.liveness.json']) await writeFile(join(dir,'stills/G1',f),'earlier run');
    const result = run('looktest',dir,'still-card');
    expect(result.status).toBe(1);
    // Nothing moves, so the whole clip is one trailing still span (0.75 s over 9 steps), excluded as an end card.
    expect(result.stdout).toBe('liveness look test still-card: fail: moving 0, still over 0.5 s 0, over 1 s 0, over 2 s 0, longest still 0 s (refused, nothing written to stills/G1)\n  excluded end-card 0.75 s at 0 s\n');
    expect(result.stderr).toBe('error: look test still-card: moving share 0 is below the minimum 0.75\n');
    expect(await readdir(join(dir,'stills/G1'))).toEqual([]);
    expect(await hidden(dir)).toEqual([]);
  });
});

test('looktest checks its arguments and the look-test declaration before rendering', async () => {
  await film(async dir => {
    const fails = (args:string[], message:string) => {
      const result = run('looktest',dir,...args);
      expect(result.stderr).toBe(`error: ${message}\n`);
      expect(result.status).toBe(1);
    };
    fails([],'usage: motion-studio looktest <film-dir> <look-id>');
    fails(['hf-slide','extra'],'usage: motion-studio looktest <film-dir> <look-id>');
    fails(['../hf-slide'],'invalid look id "../hf-slide": use lowercase letters, digits and hyphens');
    fails(['absent'],'look test not declared: shots/_look/absent/look-test.json not found');
    const declare = (value:unknown) => writeFile(join(dir,'shots/_look/hf-slide/look-test.json'),JSON.stringify(value));
    await declare({engine:'flash', entrypoint:'', frames:0, posterFrame:-1});
    fails(['hf-slide'],'shots/_look/hf-slide/look-test.json: engine must be "hyperframes" or "remotion"; entrypoint must be a non-empty string; frames must be a positive integer; posterFrame must be a frame of the look test (0 to frames-1)');
    await declare({engine:'hyperframes', entrypoint:'../rm-slide/index.html', frames:24, posterFrame:24});
    fails(['hf-slide'],'shots/_look/hf-slide/look-test.json: posterFrame must be a frame of the look test (0 to frames-1); entrypoint ../rm-slide/index.html must be an HTML file inside shots/_look/hf-slide/');
    // A look test obeys the same determinism guard as a film shot, so its promoted source passes validate.
    await declare({engine:'hyperframes', entrypoint:'index.html', frames:24, posterFrame:12});
    await appendFile(join(dir,'shots/_look/hf-slide/index.html'),'<script>const t = Date.now();</script>\n');
    const guarded = run('looktest',dir,'hf-slide');
    expect(guarded.status).toBe(1);
    expect(guarded.stderr).toMatch(/^error: look test hf-slide is not deterministic:\nerror: shot _look\/hf-slide: shots\/_look\/hf-slide\/index\.html:\d+ uses /);
    expect(await readdir(join(dir,'stills'),{recursive:true}).catch(() => [])).toEqual([]);
  });
});

test('every motion-look look declares the four motion signature fields with motion-vocabulary term ids', async () => {
  const terms = new Set<string>();
  for (const file of await readdir(termsDir)) for (const m of (await readFile(join(termsDir,file),'utf8')).matchAll(/^- \*\*[^*]+\*\* \(`([a-z0-9-]+)`\)/gm)) terms.add(m[1]);
  const looks = (await readdir(looksDir)).filter(f => f.endsWith('.md'));
  expect(looks).toHaveLength(8);
  for (const file of looks) {
    const text = await readFile(join(looksDir,file),'utf8');
    for (const field of ['Easing family','Camera behavior','Light behavior','Transition family']) {
      const line = new RegExp(`^  - ${field}: (.+)$`,'m').exec(text);
      expect([file,field,Boolean(line?.[1].trim())]).toEqual([file,field,true]);
      // Every backticked id in a field is a vocabulary term, so a builder can look up its recipe.
      for (const [,id] of line![1].matchAll(/`([^`]+)`/g)) expect([file,id,terms.has(id)]).toEqual([file,id,true]);
    }
  }
});
