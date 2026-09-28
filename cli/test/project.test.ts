import {test as nodeTest} from 'node:test';
const {expect} = await import('bun' in process.versions ? 'bun:test' : 'expect');
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {mkdtemp, cp, rm, readFile, writeFile, readdir, stat, mkdir, realpath} from 'node:fs/promises';
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
  {kind:'sound cue asset not in ledger', change:d => edit(d,'storyboard.json',s => {s.shots[1].soundCues.push({asset:'sfx-01',eventFrame:6,peakOffsetFrames:0});}), message:'shot hyperframes sound cue uses asset sfx-01, which is not in ledger.json'},
  {kind:'ledger path missing', change:d => edit(d,'ledger.json',l => {l.assets[0].localPath = 'assets/missing.ttf';}), message:'ledger asset font-plex: file assets/missing.ttf not found'},
  {kind:'ledger hash mismatch', change:d => edit(d,'ledger.json',l => {l.assets[0].sha256 = '0'.repeat(64);}), message:`ledger asset font-plex: sha256 of shots/remotion/public/IBMPlexSans.ttf is 3b031aa4216174205bd8471f88a49b91f093169e9e87bd5262242bc5967fe2e3, ledger records ${'0'.repeat(64)}`},
  {kind:'known license without a name', change:d => edit(d,'ledger.json',l => {l.assets[0].license.name = null;}), message:'ledger.json /assets/0/license: a known license needs a non-empty name'},
  {kind:'unknown license without evidence', change:d => edit(d,'ledger.json',l => {l.assets[0].license = {status:'unknown',name:null,evidence:''};}), message:'ledger.json /assets/0/license/evidence: must NOT have fewer than 1 characters'},
  {kind:'ledger path outside the film folder', change:d => edit(d,'ledger.json',l => {l.assets[0].localPath = '../outside.ttf';}), message:'ledger asset font-plex: path ../outside.ttf is outside the film folder'},
  {kind:'absolute ledger path', change:d => edit(d,'ledger.json',l => {l.assets[0].localPath = '/etc/hosts';}), message:'ledger asset font-plex: path /etc/hosts is outside the film folder'},
  {kind:'one-sided handoff', change:d => edit(d,'storyboard.json',s => {s.shots[0].exit = 'handoff';}), message:'seam remotion -> hyperframes: exit is handoff but entry is cut; both sides must be cut or both handoff'},
  {kind:'handoff after the last shot', change:d => edit(d,'storyboard.json',s => {s.shots[1].exit = 'handoff';}), message:'shot hyperframes: exit is handoff but no shot comes after it'},
  {kind:'handoff before the first shot', change:d => edit(d,'storyboard.json',s => {s.shots[0].entry = 'handoff';}), message:'shot remotion: entry is handoff but no shot comes before it'},
  {kind:'offBeatCut on a handoff', change:d => edit(d,'storyboard.json',s => {s.shots[0].exit = 'handoff'; s.shots[1].entry = 'handoff'; s.shots[1].offBeatCut = 'word-timed';}), message:'shot hyperframes: offBeatCut applies to cuts only, but entry is handoff'},
  {kind:'empty offBeatCut reason', change:d => edit(d,'storyboard.json',s => {s.shots[1].offBeatCut = '';}), message:'storyboard.json /shots/1/offBeatCut: must NOT have fewer than 1 characters'},
  {kind:'worst issue without a repair', change:d => edit(d,'storyboard.json',s => {s.critique = [{loop:1,revisionHash:'a'.repeat(64),filmScores:{},shotScores:{},worstIssues:[{shot:'remotion',frame:3,term:'pop',issue:'patch jumps'}],stillMatches:[]}];}), message:'storyboard.json /critique/0/worstIssues/0: missing required field "repair"'},
  {kind:'gap', change:d => edit(d,'storyboard.json',s => {s.shots[1].startFrame = 7; s.audio.beatFrames = [];}), message:'gap: shot remotion ends at frame 6 but shot hyperframes starts at frame 7; frames [6, 7) have no shot'},
  {kind:'gap at the timeline start', change:d => edit(d,'storyboard.json',s => {s.shots[0].startFrame = 1;}), message:'gap: the timeline starts at frame 0 but shot remotion starts at frame 1; frames [0, 1) have no shot'},
  {kind:'overlap', change:d => edit(d,'storyboard.json',s => {s.shots[1].startFrame = 5; s.audio.beatFrames = [];}), message:'overlap: shot remotion ends at frame 6 but shot hyperframes starts at frame 5; frames [5, 6) are covered twice'},
  {kind:'empty half-open range', change:d => edit(d,'storyboard.json',s => {s.shots[0].endFrame = 0; s.shots[1].startFrame = 0; s.audio.beatFrames = [];}), message:'shot remotion: endFrame 0 must be greater than startFrame 0'},
  {kind:'shots do not cover the duration', change:d => edit(d,'storyboard.json',s => {s.meta.durationFrames = 13;}), message:'shots cover [0, 12) but meta.durationFrames is 13'},
  {kind:'off-grid cut', change:d => edit(d,'storyboard.json',s => {s.shots[0].endFrame = 4; s.shots[1].startFrame = 4;}), message:'off-grid: the cut into shot hyperframes at frame 4 is not a beat frame (nearest beat: frame 3); move it to a beat or declare "offBeatCut" with a reason'},
  {kind:'sound cue outside its shot', change:d => edit(d,'storyboard.json',s => {s.shots[0].soundCues.push({asset:'font-plex',eventFrame:6,peakOffsetFrames:0});}), message:'shot remotion: sound cue font-plex eventFrame 6 is outside the shot [0, 6) (event frames are film frames)'},
  {kind:'still frame outside the shot', change:d => edit(d,'storyboard.json',s => {s.shots[0].stillFrames = [6];}), message:'shot remotion: still frame 6 is outside the shot (still frames are shot-local, 0 to 5)'},
  {kind:'canvas does not match its format', change:d => edit(d,'storyboard.json',s => {s.meta.layouts['16:9'].canvas.height = 200;}), message:'meta.layouts 16:9: canvas 320x200 does not match the format'},
  {kind:'chosen format without a layout', change:d => edit(d,'storyboard.json',s => {s.meta.formats.extra = ['9:16'];}), message:'meta.layouts has no layout for chosen format 9:16'},
  {kind:'layout for a format that is not chosen', change:d => edit(d,'storyboard.json',s => {s.meta.layouts['1:1'] = {canvas:{width:100,height:100},safe:{x:0,y:0,width:100,height:100},overlay:null};}), message:'meta.layouts has a layout for 1:1, which is not a chosen format'},
  {kind:'safe rectangle outside the canvas', change:d => edit(d,'storyboard.json',s => {s.meta.layouts['16:9'].safe = {x:40,y:9,width:288,height:162};}), message:'meta.layouts 16:9: safe rectangle 40,9 288x162 is outside the canvas 320x180'},
  {kind:'protected held frame outside the shot', change:d => edit(d,'storyboard.json',s => {s.shots[0].protected = [{id:'title',bounds:'measured',heldFrames:[6]}];}), message:'shot remotion: protected title held frame 6 is outside the shot (held frames are shot-local, 0 to 5)'},
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
    expect(render.stderr).toContain(`error: ${message}`);
    // Expected failures print messages only, never a stack trace.
    expect(render.stderr).not.toMatch(/^\s+at /m);
    expect((await readdir(dir)).sort()).toEqual(before);
  });
});

// Off-beat seams that D41 allows: no beat grid, a declared offBeatCut, or a handoff. The transition term is optional (D42).
const offBeatValid:{kind:string; change:(s:Json)=>void}[] = [
  {kind:'the project has no beat grid', change:s => {s.audio.beatFrames = [];}},
  {kind:'the cut declares offBeatCut', change:s => {s.shots[1].offBeatCut = 'word-timed reveal';}},
  {kind:'the seam is a handoff', change:s => {s.shots[0].exit = 'handoff'; s.shots[1].entry = 'handoff'; s.shots[1].transition = 'match-cut';}},
];
for (const {kind,change} of offBeatValid) test(`a seam off the beat grid is valid when ${kind}`, async () => {
  await withFixture(async dir => {
    await edit(dir,'storyboard.json',s => {s.shots[0].endFrame = 4; s.shots[0].stillFrames = [0,3]; s.shots[1].startFrame = 4; change(s);});
    const result = run('node',['validate',dir]);
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });
});

test('the storyboard example in docs/v0-contract.md validates', async () => {
  const doc = await readFile(resolve(here,'../../docs/v0-contract.md'),'utf8');
  const example = doc.split('## storyboard.json')[1].match(/```json\n([\s\S]*?)```/)![1];
  const cwd = await mkdtemp(join(tmpdir(),'motion-studio-doc-'));
  try {
    expect(run('node',['init','doc'],cwd).status).toBe(0);
    const root = join(cwd,'films','doc');
    await writeFile(join(root,'storyboard.json'),example);
    await mkdir(join(root,'shots','s01'));
    await writeFile(join(root,'shots','s01','index.html'),'<!doctype html>');
    const result = run('bun',['validate',root]);
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  } finally {await rm(cwd,{recursive:true,force:true});}
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
      expect(again.stderr).toBe(`error: ${await realpath(root)} already exists; init never overwrites a project\n`);
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
    // An unfinished film with cross-reference errors still gets its status. Expected errors: gap [6, 7), still frame 5
    // outside the shortened shot, coverage [0, 12) vs 900 frames, the cut at frame 7 off the beat grid, and the
    // sound cue at frame 6, now outside its shot.
    await edit(dir,'storyboard.json',s => {for (const g of s.gates) g.state = 'pending'; s.shots[1].startFrame = 7; s.meta.durationFrames = 900;});
    const unfinished = run('node',['status',dir]);
    expect(unfinished.stderr).toBe('');
    expect(unfinished.status).toBe(0);
    expect(unfinished.stdout).toBe(`G1 pending\nG2 pending\nG3 pending\nG4 pending\nG5 pending\nnext: brief, hero assets and look test, then present G1\nvalidation: 5 errors; run motion-studio validate ${dir}\n`);
    // A schema failure stops status with one line per problem and no stack trace.
    await edit(dir,'storyboard.json',s => {s.meta.fps = 29.97;});
    const broken = run('bun',['status',dir]);
    expect(broken.status).toBe(1);
    expect(broken.stdout).toBe('');
    expect(broken.stderr).toBe('error: storyboard.json /meta/fps: must be one of 24, 25, 30, 60\n');
  });
});
