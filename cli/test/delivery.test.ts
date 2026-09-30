import {test as nodeTest} from 'node:test';
const {expect} = await import('bun' in process.versions ? 'bun:test' : 'expect');
import {createHash} from 'node:crypto';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {parseProject, writeStoryboard} from '../src/project.ts';

const runtime = 'bun' in process.versions ? 'bun' : 'node';
const here = dirname(fileURLToPath(import.meta.url));
const cli = resolve(here,'../dist/cli.js');
const fixture = resolve(here,'../fixtures/two-engine');
const test = (name:string, fn:()=>Promise<void>) => nodeTest(`${runtime}: ${name}`,{timeout:240000},fn);
const json = async (path:string) => JSON.parse(await readFile(path,'utf8'));

async function withFilm(fn:(dir:string, run:(...args:string[])=>ReturnType<typeof spawnSync<string>>)=>Promise<void>) {
  const scratch = await mkdtemp(join(tmpdir(),'motion-delivery-'));
  const dir = join(scratch,'film');
  await cp(fixture,dir,{recursive:true});
  await mkdir(join(scratch,'home'));
  const run = (...args:string[]) => spawnSync(runtime,[cli,...args],{encoding:'utf8',timeout:120000,env:{...process.env,HOME:join(scratch,'home')}});
  try {await fn(dir,run);} finally {await rm(scratch,{recursive:true,force:true});}
}
function ok(result:ReturnType<typeof spawnSync<string>>) {
  expect({code:result.status, error:result.stderr}).toEqual({code:0,error:''});
  return result.stdout;
}
function probe(file:string) {
  const r = spawnSync('ffprobe',['-v','error','-count_frames','-show_entries','stream=codec_name,codec_type,width,height,nb_read_frames,sample_rate,channels','-of','json',file],{encoding:'utf8',timeout:30000});
  expect(r.status).toBe(0);
  return JSON.parse(r.stdout).streams;
}
async function render(dir:string, run:(...args:string[])=>ReturnType<typeof spawnSync<string>>) {
  for (const g of ['G1','G2','G3']) ok(run('gate',dir,g,'approve'));
  for (const cmd of ['render','stitch','mix']) ok(run(cmd,dir));
}
async function g4(dir:string, run:(...args:string[])=>ReturnType<typeof spawnSync<string>>) {
  const sha = createHash('sha256').update(await readFile(join(dir,'renders/16x9/master.mkv'))).digest('hex');
  await mkdir(join(dir,'critique/packet-16x9'),{recursive:true});
  await writeFile(join(dir,'critique/packet-16x9/packet.json'),JSON.stringify({render:{masterSha256:sha}}));
  // Faithful fake of the external independent critic. The real gate parses its actual header.
  await writeFile(join(dir,'critique/loop-1.md'),`# Loop 1\nMode: in-studio; independence: independent\nPacket: critique/packet-16x9/packet.json; master sha256: ${sha}\n`);
  expect(ok(run('gate',dir,'G4','approve','--waive','liveness','--note','Short fixture tests delivery, not liveness'))).toContain('warning: G4 critique[] is empty');
}

test('draft bundles playable MP4, poster, sheets, ledger and source README', async () => withFilm(async (dir,run) => {
  await render(dir,run);
  ok(run('deliver',dir,'--quality','draft'));
  const streams = probe(join(dir,'delivery/draft/16x9/film.mp4'));
  expect(streams.find((s:{codec_type:string}) => s.codec_type === 'video')).toMatchObject({codec_name:'h264',width:320,height:180,nb_read_frames:'12'});
  expect(streams.find((s:{codec_type:string}) => s.codec_type === 'audio')).toMatchObject({codec_name:'aac',sample_rate:'48000',channels:2});
  expect(probe(join(dir,'delivery/draft/16x9/poster.png'))[0]).toMatchObject({width:320,height:180});
  expect(await readFile(join(dir,'delivery/draft/ledger.json'),'utf8')).toBe(await readFile(join(dir,'ledger.json'),'utf8'));
  expect(await readFile(join(dir,'delivery/draft/SOURCE-README.md'),'utf8')).toContain('shots/remotion');
  expect(await readFile(join(dir,'delivery/draft/16x9/contact-sheet-001.png'))).toEqual(await readFile(join(dir,'renders/16x9/contact-sheet-001.png')));
  expect(await readFile(join(dir,'renders/16x9/draft.mp4'))).toEqual(await readFile(join(dir,'delivery/draft/16x9/film.mp4')));
  expect(run('deliver',dir,'--quality','final','--cost-note','Approved local encode')).toMatchObject({status:1});
  expect(run('deliver',dir,'--quality','draft','--cost-note','not applicable').stderr).toContain('usage:');
  expect(run('accept',dir,'--note','Cannot accept drafts').status).toBe(1);
  // A source edit refuses the draft before changing the successful bundle.
  const before = await readFile(join(dir,'delivery/draft/manifest.json'),'utf8');
  await writeFile(join(dir,'shots/remotion/new-source.txt'),'source changed');
  expect(run('deliver',dir,'--quality','draft').stderr).toContain('shot render older than its source');
  expect(await readFile(join(dir,'delivery/draft/manifest.json'),'utf8')).toBe(before);
}));

test('final requires every rights decision and cost consent, then records exact file acceptance and detects alterations', async () => withFilm(async (dir,run) => {
  const ledger = await json(join(dir,'ledger.json'));
  ledger.assets.find((a:{id:string}) => a.id === 'music-bed').license.status = 'unknown';
  ledger.assets.find((a:{id:string}) => a.id === 'sfx-hit').license.status = 'restricted';
  await writeFile(join(dir,'ledger.json'),JSON.stringify(ledger,null,2)+'\n');
  await render(dir,run);
  await g4(dir,run);
  expect(ok(run('gate',dir,'G5','approve'))).toContain('warning: G5 critique[] is empty');
  const fail = (...args:string[]) => {
    const r = run('deliver',dir,'--quality','final',...args);
    expect(r.status).toBe(1);
    return r.stderr;
  };
  expect(fail()).toContain('needs --cost-note');
  expect(fail('--cost-note','Approved local encode')).toContain('music-bed license is unknown');
  expect(fail('--cost-note','Approved local encode','--ack-license','music-bed','Use approved by director')).toContain('sfx-hit license is restricted');
  expect(fail('--cost-note','Approved local encode','--ack-license','not-an-asset','No')).toContain('not an unresolved ledger asset');
  expect(await readdir(join(dir,'delivery')).catch(() => [])).toEqual([]);
  const approved = ['--cost-note','Approved local encode, no paid generation','--ack-license','music-bed','Director accepts the unknown music rights','--ack-license','sfx-hit','Director accepts the restricted SFX use'];
  ok(run('deliver',dir,'--quality','final',...approved));
  const path = join(dir,'delivery/final/manifest.json');
  const receipt = await json(path);
  expect(receipt).toMatchObject({quality:'final',state:'rendered',cost:{note:approved[1]},licenses:[{asset:'music-bed',status:'unknown',reason:approved[4]},{asset:'sfx-hit',status:'restricted',reason:approved[7]}]});
  expect(probe(join(dir,'delivery/final/16x9/film.mp4')).map((s:{codec_name:string}) => s.codec_name)).toEqual(['h264','aac']);
  expect(ok(run('status',dir))).toContain('next: show the final bundle, then record user acceptance');
  ok(run('accept',dir,'--note','I accept these exact files'));
  expect(await json(path)).toMatchObject({state:'accepted',acceptance:{note:'I accept these exact files'}});
  expect(ok(run('status',dir))).toContain('next: delivery complete; accepted files match the final bundle');
  const original = await readFile(join(dir,'delivery/final/16x9/film.mp4'));
  await writeFile(join(dir,'delivery/final/16x9/film.mp4'),'altered bundle');
  expect(ok(run('status',dir))).toContain('delivery final stale');
  expect(run('accept',dir,'--note','Accept changed file').stderr).toContain('final delivery is stale');
  await writeFile(join(dir,'delivery/final/16x9/film.mp4'),original);
  await writeFile(join(dir,'shots/remotion/change.txt'),'changed source');
  expect(ok(run('status',dir))).toContain('G5 stale');
  expect(run('accept',dir,'--note','Accept changed source').status).toBe(1);
}));

test('loop drafts include measured image and audio seams for every chosen format', async () => withFilm(async (dir,run) => {
  const s = await json(join(dir,'storyboard.json'));
  s.meta.genre = 'ui-morph-loop';
  s.meta.formats.extra = ['9:16'];
  s.meta.layouts['9:16'] = {canvas:{width:180,height:320},safe:{x:9,y:16,width:162,height:288},overlay:null};
  const parsed = await parseProject(dir);
  if (!parsed.ok) throw Error(parsed.errors.join('; '));
  await writeStoryboard(dir,{...parsed.project.storyboard,meta:s.meta});
  const source = join(dir,'shots/remotion/src/index.tsx');
  await writeFile(source,(await readFile(source,'utf8')).replace('width: 320, height: 180',"width: '100%', height: '100%'").replace('width={320} height={180}', 'width={320} height={180} calculateMetadata={({props}) => ({width:props.layout.canvas.width,height:props.layout.canvas.height})}'));
  await render(dir,run);
  ok(run('deliver',dir,'--quality','draft'));
  for (const folder of ['16x9','9x16']) {
    const report = await json(join(dir,`delivery/draft/${folder}/loop.json`));
    expect(report).toMatchObject({verdict:'review required',picture:{firstFrame:0,lastFrame:11},audio:{sampleRate:48000,channels:2}});
    expect(report.picture.meanAbsoluteDifference).toBeGreaterThanOrEqual(0);
    expect(report.audio.boundarySampleJump).toBeGreaterThanOrEqual(0);
  }
  expect(probe(join(dir,'delivery/draft/9x16/film.mp4'))[0]).toMatchObject({width:180,height:320,nb_read_frames:'12'});
}));
