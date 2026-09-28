import {test as nodeTest} from 'node:test';
const {expect} = await import('bun' in process.versions ? 'bun:test' : 'expect');
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {cp, mkdtemp, readdir, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';

const test = (name:string, fn:()=>Promise<void>, timeout=600000) => nodeTest(name,{timeout},fn);
const here = dirname(fileURLToPath(import.meta.url));
const cli = resolve(here,'../dist/cli.js');
const fixture = resolve(here,'../fixtures/safezone');
// Each test runner checks the CLI under its own runtime; npm test runs both runners.
const runtime = 'bun' in process.versions ? 'bun' : 'node';
const run = (...args:string[]) => spawnSync(runtime,[cli,...args],{encoding:'utf8',timeout:300000});
type Rect = {x:number; y:number; width:number; height:number};
type Check = {shot:string; id:string; frame:number; source:string; bounds:Rect|null; status:string};
const json = async (file:string) => JSON.parse(await readFile(file,'utf8'));
// The Remotion measure wrapper and the HyperFrames staging copy must not stay in the author's shot folders.
async function expectNoMeasureFiles(dir:string) {
  expect((await readdir(join(dir,'shots'))).sort()).toEqual(['hyperframes','remotion']);
  expect((await readdir(join(dir,'shots/remotion'))).sort()).toEqual(['mark-bounds.json','public','src']);
  expect(await readdir(join(dir,'shots/remotion/src'))).toEqual(['index.tsx']);
}
async function withFilm(fn:(dir:string)=>Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(),'motion-studio-safezone-'));
  try {
    await cp(fixture,dir,{recursive:true,filter:src => !src.endsWith('/renders')});
    await fn(dir);
  } finally {await rm(dir,{recursive:true,force:true});}
}

// Values below come from how fixtures/safezone is built: layouts 16:9 320x180 safe 32,18 256x144;
// 9:16 180x320 safe 18,48 144x224; 1:1 240x240 safe 24,24 192x192. In both engines the title is 20px text on a
// 24px line, placed at the safe rectangle's top-left with the safe width, over full-bleed diagonal stripes.
// It slides in over frames 0-1 and holds from frame 2. The Remotion SVG mark has declared geometry
// (shots/remotion/mark-bounds.json). A "LIVE" corner label at 2,2 is marked data-protected="corner" but is not protected.
const safe:Record<string,Rect> = {'16x9':{x:32,y:18,width:256,height:144}, '9x16':{x:18,y:48,width:144,height:224}, '1x1':{x:24,y:24,width:192,height:192}};
const mark:Record<string,Rect> = {'16x9':{x:264,y:138,width:16,height:16}, '9x16':{x:138,y:248,width:16,height:16}, '1x1':{x:192,y:192,width:16,height:16}};

test(`${runtime}: safezone measures wrapped titles in both engines for 16:9, 9:16 and 1:1`, async () => withFilm(async dir => {
  const result = run('safezone',dir);
  expect(result.stderr).not.toContain('error:');
  expect(result.status).toBe(0);
  const heights:Record<string,Record<string,number>> = {};
  for (const [folder,rect] of Object.entries(safe)) {
    const report = await json(join(dir,'renders',folder,'safezone.json'));
    expect(report.safe).toEqual(rect);
    const checks:Check[] = report.checks;
    // Per format: title in two shots at frames 2 and 5, and the mark at frames 0 and 5.
    expect(checks.length).toBe(6);
    expect(checks.every(c => c.status === 'inside')).toBe(true);
    expect(checks.filter(c => c.id === 'mark').map(c => c.bounds)).toEqual([mark[folder],mark[folder]]);
    for (const c of checks.filter(c => c.id === 'title')) {
      const b = c.bounds!;
      expect(c.source).toBe('measured');
      // Painted text starts within a few pixels of the safe corner and never spans the stripes around it.
      expect(b.x - rect.x).toBeLessThanOrEqual(3);
      expect(b.y - rect.y).toBeLessThanOrEqual(8);
      expect(b.width).toBeLessThanOrEqual(rect.width);
      heights[c.shot] = {...heights[c.shot], [folder]:b.height};
    }
  }
  // The narrow portrait safe width wraps the title onto at least one more 24px line than landscape.
  for (const shot of ['remotion','hyperframes']) expect(heights[shot]['9x16']).toBeGreaterThanOrEqual(heights[shot]['16x9'] + 20);
  await expectNoMeasureFiles(dir);
}), 600000);

test(`${runtime}: safezone fails held protected content outside the safe rectangle, not travel`, async () => withFilm(async dir => {
  const path = join(dir,'storyboard.json');
  const storyboard = await json(path);
  // The corner label is held at 2,2, outside every safe rectangle.
  storyboard.shots[1].protected.push({id:'corner', bounds:'measured', heldFrames:[3]});
  // Frame 1 is mid-travel (the title is half off the left edge); declaring it held makes it fail.
  storyboard.shots[0].protected[0].heldFrames = [1,5];
  // An element id that no composition marks has no painted pixels.
  storyboard.shots[0].protected.push({id:'ghost', bounds:'measured', heldFrames:[4]});
  // A protected badge whose own text sits inside the safe rectangle, but whose child sets visibility:visible
  // and paints at x=300 (badge left 40 + child left 260), right of the safe edge at 288. The hide rule must
  // hide the child too, so the badge's measured bounds reach past the safe rectangle.
  storyboard.shots[1].protected.push({id:'badge', bounds:'measured', heldFrames:[3]});
  const html = join(dir,'shots/hyperframes/index.html');
  await writeFile(html,(await readFile(html,'utf8')).replace('<div id="corner"','<div data-protected="badge" style="position:absolute;left:40px;top:100px;font-size:10px;line-height:12px;color:#ffffff">OK<span style="position:absolute;left:260px;top:0;visibility:visible">X</span></div><div id="corner"'));
  await writeFile(path,JSON.stringify(storyboard));
  const bounds = await json(join(dir,'shots/remotion/mark-bounds.json'));
  bounds['16:9'].x = 290;
  await writeFile(join(dir,'shots/remotion/mark-bounds.json'),JSON.stringify(bounds));
  const result = run('safezone',dir,'16:9');
  expect(result.status).toBe(1);
  const errors = result.stderr.split('\n').filter(l => l.startsWith('error:'));
  expect(errors.length).toBe(6);
  expect(result.stderr).toContain('error: safezone 16:9 remotion/mark frame 0: held declared bounds 290,138 16x16 outside safe rectangle 32,18 256x144');
  expect(result.stderr).toContain('error: safezone 16:9 remotion/ghost frame 4: no painted pixels for data-protected="ghost"');
  expect(result.stdout).toContain('safezone 16:9 remotion/title frame 5: inside');
  expect(result.stdout).toContain('safezone 16:9: 3 of 9 checks inside');
  const checks:Check[] = (await json(join(dir,'renders','16x9','safezone.json'))).checks;
  const find = (shot:string, id:string, frame:number) => checks.find(c => c.shot === shot && c.id === id && c.frame === frame)!;
  const corner = find('hyperframes','corner',3);
  expect(corner.status).toBe('outside');
  expect(corner.bounds!.x).toBeLessThan(safe['16x9'].x);
  expect(corner.bounds!.y).toBeLessThan(safe['16x9'].y);
  const badge = find('hyperframes','badge',3);
  expect(badge.status).toBe('outside');
  expect(badge.bounds!.x).toBeLessThanOrEqual(42);
  expect(badge.bounds!.x + badge.bounds!.width).toBeGreaterThan(300);
  const travel = find('remotion','title',1);
  expect(travel.status).toBe('outside');
  expect(travel.bounds!.x).toBe(0);
  // Only the requested format was checked.
  expect((await readdir(join(dir,'renders'))).sort()).toEqual(['16x9']);
  await expectNoMeasureFiles(dir);
  const unknown = run('safezone',dir,'4:5');
  expect(unknown.status).toBe(1);
  expect(unknown.stderr).toContain('error: format 4:5 is not a chosen format (16:9, 9:16, 1:1)');
}), 600000);

test(`${runtime}: render and stitch reframe every chosen format into renders/<format>/`, async () => withFilm(async dir => {
  const render = run('render',dir);
  expect(render.status).toBe(0);
  expect(run('stitch',dir).status).toBe(0);
  for (const [folder,size] of [['16x9','320x180'],['9x16','180x320'],['1x1','240x240']]) {
    const probe = JSON.parse(spawnSync('ffprobe',['-v','error','-select_streams','v:0','-count_frames','-show_entries','stream=width,height,nb_read_frames','-of','json',join(dir,'renders',folder,'master.mkv')],{encoding:'utf8'}).stdout).streams[0];
    expect(`${probe.width}x${probe.height}`).toBe(size);
    expect(Number(probe.nb_read_frames)).toBe(12);
  }
  expect(render.stdout).toContain('render 9:16 verified 6+6 frames');
  // The HyperFrames staging copy is removed after each render.
  expect((await readdir(join(dir,'shots'))).sort()).toEqual(['hyperframes','remotion']);
}), 600000);
