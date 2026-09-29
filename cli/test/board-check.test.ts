import {test as nodeTest} from 'node:test';
const {expect} = await import('bun' in process.versions ? 'bun:test' : 'expect');
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chmod, cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';

// Black-box skill eval (#44): check.mjs board|g2|g3 on a film whose gates the packed CLI recorded. The film is the
// two-engine fixture (shots remotion [0, 6) and hyperframes [6, 12), still frames 0 and 5, primary 16:9 only) with
// the skill's fixture beat map (evals/fixtures/board/beatmap.md) and placeholder bytes for the stills and animatic;
// the gates hash bytes, not pictures. Each broken case changes one thing in a copy of that film.
const test = (name:string, fn:()=>Promise<void>, timeout=120000) => nodeTest(name,{timeout},fn);
const here = dirname(fileURLToPath(import.meta.url));
const cli = resolve(here,'../dist/cli.js');
const fixture = resolve(here,'../fixtures/two-engine');
const skill = resolve(here,'../../skills/motion-studio');
const check = join(skill,'evals/check.mjs');
const runtime = 'bun' in process.versions ? 'bun' : 'node';
const run = (file:string, args:string[]) => spawnSync(runtime,[file,...args],{encoding:'utf8',timeout:60000,input:''});
type Json = Record<string,any>;

// Every still frame of every shot, zero-padded to 3 digits as `motion-studio stills` names them (e2e defect 7).
const stills = ['remotion-f000.png','remotion-f005.png','hyperframes-f000.png','hyperframes-f005.png','sheet.png'];

async function write(dir:string, path:string, text:string) {
  await mkdir(dirname(join(dir,path)),{recursive:true});
  await writeFile(join(dir,path),text);
}
function cliOk(args:string[]):string {
  const result = run(cli,args);
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
  return result.stdout;
}
const frozenDir = (stdout:string) => /frozen stills: (\S+)/.exec(stdout)![1];

let root:string;
type Film = {board:string; g2:string; g3:string; g2Frozen:string; g3Frozen:string};
let films:Promise<Film>|undefined;
/** Builds the film once per stage: `board` before G2, `g2` after G2 approval, `g3` after G3 approval. */
function build():Promise<Film> {
  return films ??= (async () => {
    root = await mkdtemp(join(tmpdir(),'motion-studio-board-'));
    const board = join(root,'board');
    await cp(fixture,board,{recursive:true});
    await cp(join(skill,'evals/fixtures/board/beatmap.md'),join(board,'beatmap.md'));
    for (const name of stills) await write(board,`stills/G2/16x9/${name}`,`still ${name}`);
    const g2 = join(root,'g2');
    await cp(board,g2,{recursive:true});
    cliOk(['gate',g2,'G1','approve','--note','direction chosen']);
    const g2Frozen = frozenDir(cliOk(['gate',g2,'G2','approve','--note','poses approved']));
    const g3 = join(root,'g3');
    await cp(g2,g3,{recursive:true});
    await write(g3,'animatic.mp4','animatic bytes');
    const g3Frozen = frozenDir(cliOk(['gate',g3,'G3','approve','--note','motion approved']));
    return {board, g2, g3, g2Frozen, g3Frozen};
  })();
}
let copies = 0;
async function copyOf(film:string):Promise<string> {
  const dir = join(root,`case-${copies++}`);
  await cp(film,dir,{recursive:true});
  return dir;
}
async function editStoryboard(dir:string, change:(s:Json)=>void) {
  const s = JSON.parse(await readFile(join(dir,'storyboard.json'),'utf8'));
  change(s);
  await writeFile(join(dir,'storyboard.json'),JSON.stringify(s,null,2));
}
async function editBeatMap(dir:string, from:string, to:string) {
  const text = await readFile(join(dir,'beatmap.md'),'utf8');
  expect(text).toContain(from);
  await writeFile(join(dir,'beatmap.md'),text.replace(from,to));
}
function fails(name:string, stage:string, dir:string, messages:string[]) {
  const result = run(check,[stage,dir]);
  expect({name,status:result.status,stdout:result.stdout}).toEqual({name,status:1,stdout:''});
  for (const message of messages) expect({name,stderr:result.stderr}).toEqual({name,stderr:expect.stringContaining(`check: ${message}\n`)});
}

test(`${runtime}: check.mjs passes a film at each stage, and the CLI finds the same film valid`, async () => {
  const film = await build();
  const board = run(check,['board',film.board]);
  expect(board.stderr).toBe('');
  expect(board.stdout).toBe('board ok: 2 beats, 2 shots, 1 seam(s) threaded, 5 G2 stills and sheets\n');
  const g2 = run(check,['g2',film.g2]);
  expect(g2.stderr).toBe('');
  expect(g2.stdout).toBe(`g2 ok: 2 beats, 2 shots, 1 seam(s) threaded, 5 G2 stills and sheets, G2 frozen in ${film.g2Frozen}\n`);
  const g3 = run(check,['g3',film.g3]);
  expect(g3.stderr).toBe('');
  expect(g3.stdout).toBe(`g3 ok: 2 beats, 2 shots, 1 seam(s) threaded, 5 G2 stills and sheets, G2 frozen in ${film.g2Frozen}, animatic frozen in ${film.g3Frozen}\n`);
  expect(g3.status).toBe(0);
  // The frozen copies the checker compared are the ones the CLI wrote.
  expect((await readdir(join(film.g3,film.g2Frozen,'16x9'))).sort()).toEqual([...stills].sort());
  expect(cliOk(['validate',film.g3])).toContain('valid');
  expect(cliOk(['status',film.g3])).toContain('G3 approved');
});

test(`${runtime}: check.mjs board fails a beat map or storyboard that breaks one board rule`, async () => {
  const film = await build();
  const cases:[string,(dir:string)=>Promise<void>,string[]][] = [
    ['no thread', dir => editStoryboard(dir,s => {delete s.shots[1].thread;}),['storyboard.json: seam remotion -> hyperframes: shot hyperframes has no thread']],
    ['no end pose', dir => editStoryboard(dir,s => {s.shots[0].stillFrames = [0];}),['storyboard.json: shot remotion stillFrames lack 5, the end pose of beat 1']],
    ['3D without the board', dir => editStoryboard(dir,s => {s.shots[0].threeD = {reason:'depth sells the counter'};}),['beatmap.md: shot remotion declares threeD in storyboard.json; its 3D cell must start with "yes"']],
    ['thread placeholder', dir => editBeatMap(dir,'`shared-element-thread`: the shared color patch','none'),['beatmap.md: beat 2: "Thread" is a placeholder (none)']],
    ['beat gap', dir => editBeatMap(dir,'| 6-12 (0.2-0.4 s)','| 7-12'),['beatmap.md: beat 2 starts at frame 7, but the beat before it ends at frame 6']],
    ['no live content column', dir => editBeatMap(dir,'| Live content ',''),['beatmap.md: beat contract lacks column "Live content"']],
    ['engine mismatch', dir => editBeatMap(dir,'| `hyperframes` | hyperframes |','| `hyperframes` | remotion |'),['beatmap.md: engines table: shot hyperframes engine "remotion" differs from storyboard.json engine "hyperframes"']],
    ['no engine reason', dir => editBeatMap(dir,'kinetic type over an HTML patch',''),['beatmap.md: engines table: shot hyperframes has no engine reason']],
    ['no hero shot', dir => editBeatMap(dir,'Hero shot: `remotion`',''),['beatmap.md: no "Hero shot: <shot-id>" line']],
    ['unknown asset', dir => editBeatMap(dir,'`music-bed`','`music-bad`'),['beatmap.md: sourced asset "music-bad" is not in ledger.json']],
    ['unpadded still', async dir => {await rm(join(dir,'stills/G2/16x9/remotion-f005.png')); await write(dir,'stills/G2/16x9/remotion-f5.png','still');},['missing stills/G2/16x9/remotion-f005.png; run motion-studio stills']],
    ['no beat map', dir => rm(join(dir,'beatmap.md')),['beatmap.md missing; the board writes the beat map there']],
  ];
  for (const [name,change,messages] of cases) {
    const dir = await copyOf(film.board);
    await change(dir);
    fails(name,'board',dir,messages);
  }
});

test(`${runtime}: check.mjs g2 and g3 fail a changed frozen copy, a changed beat time, a missing gate and a fourth round`, async () => {
  const film = await build();
  const cases:[string,string,(dir:string)=>Promise<void>,string[]][] = [
    ['changed frozen still','g3',async dir => {const path = join(dir,film.g2Frozen,'16x9/remotion-f005.png'); await chmod(path,0o644); await writeFile(path,'edited');},
      [`G2: stills/G2/16x9/remotion-f005.png: frozen copy ${film.g2Frozen}/16x9/remotion-f005.png does not match the approved hash`,
       `G3: stills/G2/16x9/remotion-f005.png: frozen copy ${film.g2Frozen}/16x9/remotion-f005.png does not match the approved hash`]],
    ['missing frozen animatic','g3',dir => rm(join(dir,film.g3Frozen,'animatic.mp4')),[`G3: animatic.mp4: frozen copy ${film.g3Frozen}/animatic.mp4 missing`]],
    ['changed beat time','g2',dir => editStoryboard(dir,s => {s.meta.fps = 24;}),['G2: storyboard.json#/meta{fps,durationFrames} changed since the approval']],
    ['changed brief','g2',async dir => {await writeFile(join(dir,'BRIEF.md'),'# Brief, rewritten\n');},['G1: BRIEF.md: file BRIEF.md does not match the approved hash']],
    ['fourth round','g2',dir => editStoryboard(dir,s => {s.gates[1].rounds = 4;}),['G2 used 4 note rounds; the cap is 3']],
    ['G3 not presented','g3',async () => {},['G3 is pending, not approved']],
  ];
  for (const [name,stage,change,messages] of cases) {
    const dir = await copyOf(name === 'G3 not presented' ? film.g2 : stage === 'g3' ? film.g3 : film.g2);
    await change(dir);
    fails(name,stage,dir,messages);
  }
  // The CLI agrees that a changed beat time stales G2.
  const dir = await copyOf(film.g2);
  await editStoryboard(dir,s => {s.meta.fps = 24;});
  expect(run(cli,['status',dir]).stdout).toContain('G2 stale');
});

test(`${runtime}: remove the board eval films`, async () => {
  await build();
  // Frozen copies are read-only; make them writable so the folder can be removed.
  for (const entry of await readdir(root,{recursive:true})) await chmod(join(root,entry),0o755).catch(() => {});
  await rm(root,{recursive:true,force:true});
});

// The checker copies the G1-G3 freeze inputs from cli/schema/gate-inputs.json because the installed skill has no cli/;
// this keeps the copy equal to the schema.
test(`${runtime}: check.mjs freeze inputs equal the G1-G3 freeze inputs in gate-inputs.json`, async () => {
  const {FROZEN} = await import(join(skill,'evals/board.mjs'));
  const schema = JSON.parse(await readFile(resolve(here,'../schema/gate-inputs.json'),'utf8'));
  type Input = {freeze?:boolean; sources:{file?:string}[]};
  const frozen = ['G1','G2','G3'].flatMap(id => (schema[id] as Input[]).filter(i => i.freeze)
    .flatMap(i => i.sources.map(src => [src.file!.replace(/\*\*$/,''), id])));
  expect(FROZEN).toEqual(frozen);
});
