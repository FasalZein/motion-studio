import {test as nodeTest} from 'node:test';
const {expect} = await import('bun' in process.versions ? 'bun:test' : 'expect');
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {mkdtemp, cp, rm, readFile, writeFile, readdir, lstat, mkdir, appendFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';

// Black-box gate fixtures (spec seam 1): each case builds its film folder, runs the packed CLI's dist build as a
// process and reads storyboard.json and the frozen still copies back from disk. Expected hashes are SHA-256 of the
// bytes the test wrote.
const test = (name:string, fn:()=>Promise<void>, timeout=120000) => nodeTest(name,{timeout},fn);
const here = dirname(fileURLToPath(import.meta.url));
const cli = resolve(here,'../dist/cli.js');
const fixture = resolve(here,'../fixtures/two-engine');
const runtimes = ['node','bun'];
let turn = 0;
// Alternate runtimes so every gate scenario runs steps under both Node and Bun.
const run = (args:string[]) => spawnSync(runtimes[turn++ % 2],[cli,...args],{encoding:'utf8',timeout:60000});
const sha = (data:string) => createHash('sha256').update(data).digest('hex');
type Json = Record<string,any>;

async function withFilm(fn:(dir:string)=>Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(),'motion-studio-gates-'));
  try {
    await cp(fixture,dir,{recursive:true,filter:src => !src.endsWith('/output')});
    await write(dir,'stills/G1/look-a.png','look A v1');
    await write(dir,'stills/G2/b01.png','beat 1 v1');
    await fn(dir);
  } finally {await rm(dir,{recursive:true,force:true});}
}
async function write(dir:string, path:string, text:string) {
  await mkdir(dirname(join(dir,path)),{recursive:true});
  await writeFile(join(dir,path),text);
}
const storyboard = async (dir:string):Promise<Json> => JSON.parse(await readFile(join(dir,'storyboard.json'),'utf8'));
async function edit(dir:string, change:(s:Json)=>void) {
  const s = await storyboard(dir);
  change(s);
  await writeFile(join(dir,'storyboard.json'),JSON.stringify(s,null,2));
}
function ok(args:string[]) {
  const result = run(args);
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
  return result.stdout;
}
/** Runs a refused gate command and checks that it changed nothing. */
async function refused(dir:string, args:string[], message:string) {
  const before = await readFile(join(dir,'storyboard.json'),'utf8');
  const result = run(['gate',dir,...args]);
  expect(result.stdout).toBe('');
  expect(result.stderr).toBe(`error: ${message}\n`);
  expect(result.status).toBe(1);
  expect(await readFile(join(dir,'storyboard.json'),'utf8')).toBe(before);
}
const status = (dir:string) => ok(['status',dir]);
const lines = (...l:string[]) => l.join('\n')+'\n';

test('approve binds the gate to its input hashes and freezes the approved stills', async () => {
  await withFilm(async dir => {
    await write(dir,'style-bible.md','take: hard cuts\ndo not take: lens flares\n');
    await edit(dir,s => {s.look.styleBible = 'style-bible.md';});
    const out = ok(['gate',dir,'G1','approve','--note','keynote minimal']);
    const g1 = (await storyboard(dir)).gates[0];
    expect(g1.state).toBe('approved');
    expect(g1.decision).toBe('approve');
    expect(g1.notes).toEqual(['keynote minimal']);
    expect(g1.rounds).toBe(0);
    // G1 hashes the brief, the look-test stills, the style bible file and the storyboard look record.
    expect(Object.keys(g1.inputHashes).sort()).toEqual(['BRIEF.md','stills/G1/look-a.png','storyboard.json#/look','style-bible.md']);
    expect(g1.inputHashes['BRIEF.md']).toBe(sha(await readFile(join(fixture,'BRIEF.md'),'utf8')));
    expect(g1.inputHashes['stills/G1/look-a.png']).toBe(sha('look A v1'));
    expect(g1.inputHashes['style-bible.md']).toBe(sha('take: hard cuts\ndo not take: lens flares\n'));
    expect(g1.inputHashes['storyboard.json#/look']).toMatch(/^[0-9a-f]{64}$/);

    // The frozen copy is a separate read-only file, not a link to the live still.
    const frozenDirs = await readdir(join(dir,'stills/approved'));
    expect(frozenDirs).toHaveLength(1);
    expect(frozenDirs[0]).toMatch(/^G1-[0-9a-f]{8}$/);
    expect(out).toContain(`frozen stills: stills/approved/${frozenDirs[0]}\n`);
    const frozen = join(dir,'stills/approved',frozenDirs[0],'look-a.png');
    const info = await lstat(frozen);
    expect(info.isSymbolicLink()).toBe(false);
    expect(info.mode & 0o222).toBe(0);
    await write(dir,'stills/G1/look-a.png','look A v2');
    expect(await readFile(frozen,'utf8')).toBe('look A v1');
    expect(status(dir)).toBe(lines('G1 stale (changed: stills/G1/look-a.png)','G2 pending','G3 pending','G4 pending','G5 pending',
      'next: G1 is stale: rerun brief, hero assets and look test, then present G1 again'));
  });
});

test('resume after an upstream edit: the edited gate and every later approval are stale', async () => {
  await withFilm(async dir => {
    ok(['gate',dir,'G1','approve']);
    ok(['gate',dir,'G2','approve']);
    await appendFile(join(dir,'BRIEF.md'),'Direction: warmer.\n');
    expect(status(dir)).toBe(lines('G1 stale (changed: BRIEF.md)','G2 stale (G1 not approved)','G3 pending','G4 pending','G5 pending',
      'next: G1 is stale: rerun brief, hero assets and look test, then present G1 again'));
    // validate reports the stale approvals as warnings; a stale gate is a resumable state, not an invalid project.
    const validate = run(['validate',dir]);
    expect(validate.status).toBe(0);
    expect(validate.stderr).toBe('warning: gate G1 approved is stale: changed: BRIEF.md; present G1 again\nwarning: gate G2 approved is stale: G1 not approved; present G2 again\n');
    await refused(dir,['G2','approve'],'cannot record G2: G1 is not approved (stale: changed: BRIEF.md); approve G1 first');
    // Approving G1 again does not restore G2: G2 was approved against the old brief.
    ok(['gate',dir,'G1','approve']);
    expect((await storyboard(dir)).gates[0].inputHashes['BRIEF.md']).toBe(sha(await readFile(join(dir,'BRIEF.md'),'utf8')));
    expect(status(dir)).toBe(lines('G1 approved','G2 stale','G3 pending','G4 pending','G5 pending',
      'next: G2 is stale: rerun board: beat map, keyframe builds and stills, then present G2 again'));
    ok(['gate',dir,'G2','approve']);
    expect(status(dir)).toBe(lines('G1 approved','G2 approved','G3 pending','G4 pending','G5 pending',
      'next: animatic with the entry and exit frame of each shot, then present G3'));
  });
});

test('resume after a rejection: notes count a round and reset later gates', async () => {
  await withFilm(async dir => {
    ok(['gate',dir,'G1','approve']);
    ok(['gate',dir,'G2','approve']);
    await refused(dir,['G1','changes'],'changes needs at least one --note');
    ok(['gate',dir,'G1','changes','--note','warmer palette','--note','bigger logo']);
    const g1 = (await storyboard(dir)).gates[0];
    expect([g1.state,g1.decision,g1.rounds]).toEqual(['changes','changes',1]);
    expect(g1.notes).toEqual(['warmer palette','bigger logo']);
    expect(status(dir)).toBe(lines('G1 changes (rounds 1/3)','G2 stale','G3 pending','G4 pending','G5 pending',
      'next: apply the G1 notes (round 1 of 3), then present G1 again'));
    await refused(dir,['G2','approve'],'cannot record G2: G1 is not approved (changes); approve G1 first');
    await write(dir,'stills/G1/look-a.png','look A warmer');
    ok(['gate',dir,'G1','approve']);
    expect(status(dir)).toBe(lines('G1 approved (rounds 1/3)','G2 stale','G3 pending','G4 pending','G5 pending',
      'next: G2 is stale: rerun board: beat map, keyframe builds and stills, then present G2 again'));
  });
});

test('resume after an exhausted note budget: accept or rescope, no fourth round', async () => {
  await withFilm(async dir => {
    for (const note of ['n1','n2','n3']) ok(['gate',dir,'G1','changes','--note',note]);
    expect(status(dir)).toBe(lines('G1 changes (rounds 3/3)','G2 pending','G3 pending','G4 pending','G5 pending',
      'next: G1 used 3 of 3 note rounds: ask the user to accept, rescope or stop'));
    await refused(dir,['G1','changes','--note','n4'],'G1 used 3 of 3 note rounds; approve to accept, rescope or stop');
    // Accept at the current state.
    ok(['gate',dir,'G1','approve','--note','accept as is']);
    expect(status(dir).split('\n')[0]).toBe('G1 approved (rounds 3/3)');
    // Rescope starts a new round budget and reopens the gate.
    ok(['gate',dir,'G1','rescope','--note','drop the product demo']);
    const g1 = (await storyboard(dir)).gates[0];
    expect([g1.state,g1.decision,g1.rounds]).toEqual(['pending','rescope',0]);
    expect(g1.notes).toEqual(['n1','n2','n3','accept as is','drop the product demo']);
    ok(['gate',dir,'G1','changes','--note','n5']);
    expect((await storyboard(dir)).gates[0].rounds).toBe(1);
  });
});

test('a change made after approval makes only the gates that hash it stale', async () => {
  await withFilm(async dir => {
    await write(dir,'animatic.mp4','animatic v1');
    for (const id of ['G1','G2','G3','G4']) ok(['gate',dir,id,'approve']);
    const gates = (await storyboard(dir)).gates;
    // G3 binds to the frozen G2 copy, not the live still.
    const frozenG2 = (await readdir(join(dir,'stills/approved'))).filter(d => d.startsWith('G2-'));
    expect(frozenG2).toHaveLength(1);
    expect(gates[2].inputHashes[`stills/approved/${frozenG2[0]}/b01.png`]).toBe(sha('beat 1 v1'));
    expect(gates[2].inputHashes['animatic.mp4']).toBe(sha('animatic v1'));
    expect(gates[3].inputHashes['ledger.json']).toBe(sha(await readFile(join(dir,'ledger.json'),'utf8')));
    expect(gates[3].inputHashes['shots/hyperframes/index.html']).toBe(sha(await readFile(join(dir,'shots/hyperframes/index.html'),'utf8')));
    expect(Object.keys(gates[2].inputHashes).some(k => k.startsWith('shots/'))).toBe(false);

    // A shot source edit after G4: G1 to G3 stay approved.
    await appendFile(join(dir,'shots/hyperframes/index.html'),'<!-- tweak -->\n');
    expect(status(dir)).toBe(lines('G1 approved','G2 approved','G3 approved','G4 stale (changed: shots/hyperframes/index.html)','G5 pending',
      'next: G4 is stale: rerun fill assets, full build and critique loop A, then present G4 again'));
    await refused(dir,['G5','approve'],'cannot record G5: G4 is not approved (stale: changed: shots/hyperframes/index.html); approve G4 first');

    // A beat time change stales G2 and everything after it; G1 does not hash the grid.
    await edit(dir,s => {s.audio.beatFrames = [3,6,9];});
    expect(status(dir)).toBe(lines('G1 approved','G2 stale (changed: storyboard.json#/audio)','G3 stale (G2 not approved)','G4 stale (G2 not approved)','G5 pending',
      'next: G2 is stale: rerun board: beat map, keyframe builds and stills, then present G2 again'));

    // Editing the live still leaves the frozen copy intact.
    await write(dir,'stills/G2/b01.png','beat 1 v2');
    expect(await readFile(join(dir,'stills/approved',frozenG2[0],'b01.png'),'utf8')).toBe('beat 1 v1');
  });
});

test('gate rejects an unknown gate or decision and an approval out of order', async () => {
  await withFilm(async dir => {
    const usage = run(['gate',dir,'G6','approve']);
    expect(usage.status).toBe(1);
    expect(usage.stderr).toMatch(/^error: usage: motion-studio .*gate <film-dir> <G1-G5> <approve\|changes\|rescope> \[--note <text>\]/);
    expect(run(['gate',dir,'G1','maybe']).status).toBe(1);
    expect(run(['gate',dir,'G1','approve','--note']).status).toBe(1);
    await refused(dir,['G3','approve'],'cannot record G3: G1 is not approved (pending); approve G1 first');
  });
});
