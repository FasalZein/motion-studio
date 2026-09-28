import {test as nodeTest} from 'node:test';
const {expect} = await import('bun' in process.versions ? 'bun:test' : 'expect');
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {mkdtemp, cp, rm, readFile, writeFile, readdir, stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';

const test = (name:string, fn:()=>Promise<void>, timeout=120000) => nodeTest(name,{timeout},fn);
const here = dirname(fileURLToPath(import.meta.url));
const cli = resolve(here,'../dist/cli.js');
const fixture = resolve(here,'../fixtures/two-engine');
const runtimes = ['node','bun'];
const run = (runtime:string, args:string[], cwd?:string) => spawnSync(runtime,[cli,...args],{encoding:'utf8',timeout:60000,cwd});
const exists = (path:string) => stat(path).then(() => true,() => false);
type Json = Record<string,any>;

async function withFixture(fn:(dir:string)=>Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(),'motion-studio-project-'));
  try {
    await cp(fixture,dir,{recursive:true,filter:src => !src.endsWith('/output')});
    await fn(dir);
  } finally {await rm(dir,{recursive:true,force:true});}
}
async function edit(dir:string, file:'storyboard.json'|'ledger.json', change:(data:Json)=>void) {
  const path = join(dir,file);
  const data = JSON.parse(await readFile(path,'utf8'));
  change(data);
  await writeFile(path,JSON.stringify(data,null,2));
}

// Expected messages come from the fixture: shots [0,6) remotion and [6,12) hyperframes, beats at frames 3 and 6,
// one ledger font whose file hash is 3b031aa4...e2e3.
const invalid:{kind:string; change:(dir:string)=>Promise<void>; message:string}[] = [
  {kind:'missing engine', change:d => edit(d,'storyboard.json',s => {delete s.shots[1].engine;}), message:'storyboard.json /shots/1: missing required field "engine"'},
  {kind:'unknown engine', change:d => edit(d,'storyboard.json',s => {s.shots[0].engine = 'blender';}), message:'storyboard.json /shots/0/engine: must be one of "hyperframes", "remotion"'},
  {kind:'bad fps', change:d => edit(d,'storyboard.json',s => {s.meta.fps = 29.97;}), message:'storyboard.json /meta/fps: must be one of 24, 25, 30, 60'},
  {kind:'invalid JSON', change:d => writeFile(join(d,'ledger.json'),'{"version":'), message:'ledger.json: invalid JSON'},
  {kind:'missing HyperFrames entrypoint', change:d => edit(d,'storyboard.json',s => {s.shots[1].entrypoint = 'shots/hyperframes/missing.html';}), message:'shot hyperframes: HyperFrames entrypoint shots/hyperframes/missing.html not found'},
  {kind:'HyperFrames entrypoint outside its shot folder', change:d => edit(d,'storyboard.json',s => {s.shots[1].entrypoint = 'shots/hyperframes/../../BRIEF.md';}), message:'shot hyperframes: HyperFrames entrypoint shots/hyperframes/../../BRIEF.md must be inside shots/hyperframes/'},
  {kind:'missing Remotion entry file', change:d => rm(join(d,'shots/remotion/src/index.tsx')), message:'shot remotion: Remotion project entry not found (expected shots/remotion/src/index.ts or src/index.tsx registering composition "Shot")'},
  {kind:'asset id not in ledger', change:d => edit(d,'storyboard.json',s => {s.shots[0].assets.push('logo-01');}), message:'shot remotion uses asset logo-01, which is not in ledger.json'},
  {kind:'sound cue asset not in ledger', change:d => edit(d,'storyboard.json',s => {s.shots[1].soundCues.push({asset:'sfx-01',eventFrame:0,peakOffsetFrames:0});}), message:'shot hyperframes sound cue uses asset sfx-01, which is not in ledger.json'},
  {kind:'ledger path missing', change:d => edit(d,'ledger.json',l => {l.assets[0].localPath = 'assets/missing.ttf';}), message:'ledger asset font-plex: file assets/missing.ttf not found'},
  {kind:'ledger hash mismatch', change:d => edit(d,'ledger.json',l => {l.assets[0].sha256 = '0'.repeat(64);}), message:`ledger asset font-plex: sha256 of shots/remotion/public/IBMPlexSans.ttf is 3b031aa4216174205bd8471f88a49b91f093169e9e87bd5262242bc5967fe2e3, ledger records ${'0'.repeat(64)}`},
  {kind:'known license without a name', change:d => edit(d,'ledger.json',l => {l.assets[0].license.name = null;}), message:'ledger.json /assets/0/license/name: must be string'},
  {kind:'gap', change:d => edit(d,'storyboard.json',s => {s.shots[1].startFrame = 7; s.audio.beatFrames = [];}), message:'gap: shot remotion ends at frame 6 but shot hyperframes starts at frame 7; frames [6, 7) have no shot'},
  {kind:'gap at the timeline start', change:d => edit(d,'storyboard.json',s => {s.shots[0].startFrame = 1;}), message:'gap: the timeline starts at frame 0 but shot remotion starts at frame 1; frames [0, 1) have no shot'},
  {kind:'overlap', change:d => edit(d,'storyboard.json',s => {s.shots[1].startFrame = 5; s.audio.beatFrames = [];}), message:'overlap: shot remotion ends at frame 6 but shot hyperframes starts at frame 5; frames [5, 6) are covered twice'},
  {kind:'empty half-open range', change:d => edit(d,'storyboard.json',s => {s.shots[0].endFrame = 0; s.shots[1].startFrame = 0; s.audio.beatFrames = [];}), message:'shot remotion: endFrame 0 must be greater than startFrame 0'},
  {kind:'shots do not cover the duration', change:d => edit(d,'storyboard.json',s => {s.meta.durationFrames = 13;}), message:'shots cover [0, 12) but meta.durationFrames is 13'},
  {kind:'off-grid cut', change:d => edit(d,'storyboard.json',s => {s.shots[0].endFrame = 4; s.shots[1].startFrame = 4;}), message:'off-grid: shot hyperframes starts at frame 4, which is not a beat frame (nearest beat: frame 3)'},
  {kind:'still frame outside the shot', change:d => edit(d,'storyboard.json',s => {s.shots[0].stillFrames = [6];}), message:'shot remotion: still frame 6 is outside the shot (still frames are shot-local, 0 to 5)'},
  {kind:'canvas does not match the primary format', change:d => edit(d,'storyboard.json',s => {s.meta.formats.primary = '9:16';}), message:'meta.canvas 320x180 does not match primary format 9:16'},
  {kind:'missing gate', change:d => edit(d,'storyboard.json',s => {s.gates.pop();}), message:'gates must be G1, G2, G3, G4, G5 in order; found G1, G2, G3, G4'},
];

test('the converted two-engine fixture is a valid project under both runtimes', async () => {
  for (const runtime of runtimes) {
    const result = run(runtime,['validate',fixture]);
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(result.stdout).toBe(`valid ${fixture}\n`);
  }
});

for (const [i,{kind,change,message}] of invalid.entries()) test(`validate rejects ${kind}; render writes nothing`, async () => {
  await withFixture(async dir => {
    await change(dir);
    const before = (await readdir(dir)).sort();
    for (const runtime of runtimes) {
      const result = run(runtime,['validate',dir]);
      expect(result.status).toBe(1);
      expect(result.stdout).toBe('');
      expect(result.stderr).toContain(`error: ${message}`);
    }
    // Render must refuse the same project before creating output or staging folders.
    const render = run(runtimes[i % 2],['render',dir]);
    expect(render.status).not.toBe(0);
    expect(render.stderr).toContain(message);
    expect((await readdir(dir)).sort()).toEqual(before);
  });
});

test('a cut off the beat grid is valid when the project has no beat grid', async () => {
  await withFixture(async dir => {
    await edit(dir,'storyboard.json',s => {s.shots[0].endFrame = 4; s.shots[0].stillFrames = [0,3]; s.shots[1].startFrame = 4; s.shots[1].endFrame = 12; s.audio.beatFrames = [];});
    const result = run('node',['validate',dir]);
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });
});

test('init creates the fixed layout and an empty valid project; status shows pending gates', async () => {
  const cwd = await mkdtemp(join(tmpdir(),'motion-studio-init-'));
  try {
    for (const runtime of runtimes) {
      const slug = `atlas-${runtime}`;
      const root = join(cwd,'films',slug);
      const created = run(runtime,['init',slug],cwd);
      expect(created.stderr).toBe('');
      expect(created.status).toBe(0);
      expect((await readdir(root)).sort()).toEqual(['BRIEF.md','assets','audio','critique','ledger.json','renders','shots','stills','storyboard.json']);
      const brief = await readFile(join(root,'BRIEF.md'),'utf8');
      for (const section of ['inputs','direction','structure','build','gotchas','start']) expect(brief).toContain(`<${section}>\n</${section}>`);
      const storyboard = JSON.parse(await readFile(join(root,'storyboard.json'),'utf8'));
      expect(Object.keys(storyboard).sort()).toEqual(['audio','critique','gates','look','meta','shots','version','voice']);
      expect(storyboard.shots).toEqual([]);
      expect(storyboard.gates.map((g:Json) => `${g.id}:${g.state}`)).toEqual(['G1:pending','G2:pending','G3:pending','G4:pending','G5:pending']);
      expect(JSON.parse(await readFile(join(root,'ledger.json'),'utf8'))).toEqual({version:'0',assets:[]});
      const valid = run(runtime,['validate',`films/${slug}`],cwd);
      expect(valid.status).toBe(0);
      const status = run(runtime,['status',root]);
      expect(status.status).toBe(0);
      expect(status.stdout).toBe('G1 pending\nG2 pending\nG3 pending\nG4 pending\nG5 pending\nnext: brief, hero assets and look test, then present G1\n');
      // A second init must refuse and leave the project untouched.
      await writeFile(join(root,'BRIEF.md'),'edited');
      const again = run(runtime,['init',slug],cwd);
      expect(again.status).toBe(1);
      expect(again.stderr).toContain('already exists');
      expect(await readFile(join(root,'BRIEF.md'),'utf8')).toBe('edited');
    }
    const badSlug = run('node',['init','Bad Slug'],cwd);
    expect(badSlug.status).toBe(1);
    expect(badSlug.stderr).toContain('invalid slug');
    expect(await exists(join(cwd,'films','Bad Slug'))).toBe(false);
  } finally {await rm(cwd,{recursive:true,force:true});}
});

test('status reports gate states and the next step', async () => {
  await withFixture(async dir => {
    const cases:[(gates:Json[])=>void,string][] = [
      [g => {g[0].state = 'approved'; g[1].state = 'stale';}, 'G1 approved\nG2 stale\nG3 pending\nG4 pending\nG5 pending\nnext: G2 is stale: rerun board: beat map, keyframe builds and stills, then present G2 again\n'],
      [g => {g[0].state = 'changes'; g[0].rounds = 1;}, 'G1 changes (rounds 1/3)\nG2 pending\nG3 pending\nG4 pending\nG5 pending\nnext: apply the G1 notes (round 1 of 3), then present G1 again\n'],
      [g => {g[0].state = 'changes'; g[0].rounds = 3;}, 'G1 changes (rounds 3/3)\nG2 pending\nG3 pending\nG4 pending\nG5 pending\nnext: G1 used 3 of 3 note rounds: ask the user to accept, rescope or stop\n'],
      [g => {for (const gate of g) gate.state = 'approved';}, 'G1 approved\nG2 approved\nG3 approved\nG4 approved\nG5 approved\nnext: final render, then user acceptance of the files\n'],
    ];
    for (const [i,[change,expected]] of cases.entries()) {
      await edit(dir,'storyboard.json',s => {for (const g of s.gates) {g.state = 'pending'; g.rounds = 0;} change(s.gates);});
      const result = run(runtimes[i % 2],['status',dir]);
      expect(result.stderr).toBe('');
      expect(result.status).toBe(0);
      expect(result.stdout).toBe(expected);
    }
    await edit(dir,'storyboard.json',s => {s.shots[1].startFrame = 7;});
    const broken = run('node',['status',dir]);
    expect(broken.status).toBe(1);
    expect(broken.stderr).toContain('gap: shot remotion ends at frame 6');
  });
});
