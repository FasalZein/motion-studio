import {test as nodeTest} from 'node:test';
const {expect} = await import('bun' in process.versions ? 'bun:test' : 'expect');
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {cp, mkdir, mkdtemp, readFile, readdir, rm, utimes, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {spawn, spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';

// Black-box taste and style-bible checks: each case runs the built CLI as a process with HOME pointed at a scratch
// folder, so no run reads or writes the real ~/.motion-studio/taste.json. Expected profiles are built from the notes and
// flags the test passes, in the order the taste-profile reference defines.
const test = (name:string, fn:()=>Promise<void>, timeout=120000) => nodeTest(name,{timeout},fn);
const here = dirname(fileURLToPath(import.meta.url));

/** A stand-in master with what `packet` and a fresh reviewer write for it, which G4 approval needs (D78). */
async function fakeCritique(film:string) {
  const sha = createHash('sha256').update('master v1').digest('hex');
  await mkdir(join(film,'renders/16x9'),{recursive:true});
  await mkdir(join(film,'critique/packet-16x9'),{recursive:true});
  await writeFile(join(film,'renders/16x9/master.mkv'),'master v1');
  await writeFile(join(film,'critique/packet-16x9/packet.json'),JSON.stringify({render:{masterSha256:sha}}));
  await writeFile(join(film,'critique/loop-1.md'),`Mode: in-studio; independence: independent\nPacket: critique/packet-16x9/packet.json; master sha256: ${sha}\n`);
}
const cli = resolve(here,'../dist/cli.js');
const fixture = resolve(here,'../fixtures/two-engine');
const styleFixture = resolve(here,'../fixtures/style-bible/style-bible.md');
const runtimes = ['node','bun'];
let turn = 0;
type Json = Record<string,any>;

async function scratch(fn:(home:string, film:string)=>Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(),'motion-studio-taste-'));
  try {
    const home = join(dir,'home');
    const film = join(dir,'films','launch');
    await mkdir(home);
    await cp(fixture,film,{recursive:true,filter:src => !src.endsWith('/output')});
    await fn(home,film);
  } finally {await rm(dir,{recursive:true,force:true});}
}
// Alternate runtimes so every taste scenario runs steps under both Node and Bun.
const run = (home:string, args:string[]) => spawnSync(runtimes[turn++ % 2],[cli,...args],{encoding:'utf8',timeout:60000,env:{...process.env, HOME:home}});
function ok(home:string, args:string[]):string {
  const result = run(home,args);
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
  return result.stdout;
}
function fails(home:string, args:string[], message:string) {
  const result = run(home,args);
  expect(result.stdout).toBe('');
  expect(result.stderr).toBe(`error: ${message}\n`);
  expect(result.status).toBe(1);
}
const profilePath = (home:string) => join(home,'.motion-studio','taste.json');
const profile = async (home:string):Promise<Json> => JSON.parse(await readFile(profilePath(home),'utf8'));
const storyboard = async (film:string):Promise<Json> => JSON.parse(await readFile(join(film,'storyboard.json'),'utf8'));
async function edit(film:string, change:(s:Json)=>void) {
  const s = await storyboard(film);
  change(s);
  await writeFile(join(film,'storyboard.json'),JSON.stringify(s,null,2));
}
async function seed(home:string, value:unknown) {
  await mkdir(join(home,'.motion-studio'));
  await writeFile(profilePath(home),typeof value === 'string' ? value : JSON.stringify(value));
}
/** A G1 look-test still; the approved G1 hashes it, which marks the look as shown. */
async function writeLook(film:string, look:string) {
  await mkdir(join(film,'stills','G1'),{recursive:true});
  await writeFile(join(film,'stills','G1',`${look}.png`),`look test ${look}`);
}
/** Runs the CLI without waiting, so two commands overlap. */
const start = (runtime:string, home:string, args:string[]) => new Promise<{status:number|null; stderr:string}>(done => {
  const child = spawn(runtime,[cli,...args],{env:{...process.env, HOME:home}});
  let stderr = '';
  child.stderr.on('data',d => {stderr += d;});
  child.on('close',status => done({status, stderr}));
});
const day = () => new Date().toISOString().slice(0,10);
// A run near midnight UTC may date an entry either day; compare with the date the entry recorded.
const dated = (entry:Json) => {expect([day(),new Date(Date.now()-86400000).toISOString().slice(0,10)]).toContain(entry.date); return entry;};
const earlier = {kind:'look', value:'data-journalism', note:'old-film: G1 chosen: "numbers carry it"', date:'2026-01-02'};

test('taste g1 likes the chosen look, rejects or notes passed looks, and snapshots the profile into the film', async () => {
  await scratch(async (home,film) => {
    await seed(home,{version:1, liked:[earlier], rejected:[], notes:[]});
    await edit(film,s => {s.look.id = 'keynote-minimal'; s.look.axes = {density:'one object'};});
    for (const look of ['keynote-minimal','swiss-grid','editorial-serif']) await writeLook(film,look);
    ok(home,['gate',film,'G1','approve','--note','keynote: the flood makes the action obvious','--note','swiss grid feels cold']);
    const out = ok(home,['taste','g1',film,'--rejected','swiss-grid','--kept','editorial-serif:Uniform fade-in']);
    expect(out).toBe([
      'liked look keynote-minimal',
      'rejected look swiss-grid',
      'noted editorial-serif: execution kept "Uniform fade-in"',
      `taste profile: ${profilePath(home)}`,
      `snapshot: ${join(film,'taste-snapshot.json')}`,
    ].join('\n')+'\n');

    const words = '"keynote: the flood makes the action obvious" / "swiss grid feels cold"';
    const taste = await profile(home);
    expect(taste.version).toBe(1);
    // The earlier entry stays first and unchanged; the new entries follow.
    expect(taste.liked).toEqual([earlier,{kind:'look', value:'keynote-minimal', note:`launch: G1 chosen: ${words}`, date:dated(taste.liked[1]).date}]);
    expect(taste.rejected).toEqual([{kind:'look', value:'swiss-grid', note:`launch: G1 passed: ${words}`, date:dated(taste.rejected[0]).date}]);
    // The quoted decision names the term `flood`. A passed look whose still kept a template pattern is a note, not a rejection: the execution failed, not the look.
    expect(taste.notes).toEqual([{text:`launch: G1 passed on the execution of editorial-serif, not the look: its still kept "Uniform fade-in"; decision: ${words}`,
      terms:['flood'], date:dated(taste.notes[0]).date, film:'launch', gate:'G1'}]);

    // The snapshot is the profile byte for byte, and the film points at it.
    const global = await readFile(profilePath(home),'utf8');
    expect(await readFile(join(film,'taste-snapshot.json'),'utf8')).toBe(global);
    expect((await storyboard(film)).look).toEqual({id:'keynote-minimal', styleBible:null, axes:{density:'one object'}, tasteSnapshot:'taste-snapshot.json'});
    // Writing the snapshot pointer does not make the G1 approval stale.
    expect(ok(home,['status',film]).split('\n')[0]).toBe('G1 approved');
    // No temp file is left next to the profile or in the film.
    expect(await readdir(join(home,'.motion-studio'))).toEqual(['taste.json']);
    expect((await readdir(film)).filter(f => f.startsWith('.'))).toEqual([]);

    // A rerun adds nothing, and a later global write never changes the film's snapshot.
    ok(home,['taste','g1',film,'--rejected','swiss-grid','--kept','editorial-serif:Uniform fade-in']);
    expect(await readFile(profilePath(home),'utf8')).toBe(global);
    await edit(film,s => {s.gates[1].notes = ['tighter']; });
    ok(home,['taste','notes',film,'G2']);
    expect(await readFile(profilePath(home),'utf8')).not.toBe(global);
    expect(await readFile(join(film,'taste-snapshot.json'),'utf8')).toBe(global);
  });
});

test('taste g1 refuses without an approved G1, the director words or a chosen look, and never overwrites a bad profile', async () => {
  await scratch(async (home,film) => {
    await edit(film,s => {s.look.id = 'keynote-minimal';});
    await writeLook(film,'swiss-grid');
    fails(home,['taste','g1',film],'taste g1 needs G1 approved and not stale; G1 is pending');
    ok(home,['gate',film,'G1','approve']);
    fails(home,['taste','g1',film],'taste g1 quotes the director: record the decision words with motion-studio gate <film-dir> G1 approve --note <text>');
    ok(home,['gate',film,'G1','approve','--note','keynote']);
    fails(home,['taste','g1',film,'--rejected','keynote-minimal'],'taste g1: keynote-minimal is the chosen look (look.id), not a passed candidate');
    fails(home,['taste','g1',film,'--rejected','swiss-grid','--kept','swiss-grid:Crossfade'],'taste g1: swiss-grid is listed more than once');
    fails(home,['taste','g1',film,'--kept','swiss-grid'],'taste g1: --kept needs <look-id>:<pattern>, got "swiss-grid"');
    // An unshown candidate is never a rejection or a note: G1 showed only swiss-grid.
    fails(home,['taste','g1',film,'--rejected','paper-collage'],'taste g1: paper-collage has no look test at G1 (clip stills/G1/paper-collage.mkv or poster stills/G1/paper-collage.png); only a shown candidate can be passed');
    fails(home,['taste','g1',film,'--kept','swiss-gri:Crossfade'],'taste g1: swiss-gri has no look test at G1 (clip stills/G1/swiss-gri.mkv or poster stills/G1/swiss-gri.png); only a shown candidate can be passed');
    await edit(film,s => {s.look.id = null;});
    // Clearing look.id changes the G1 inputs, so re-approve before checking the look.id refusal.
    ok(home,['gate',film,'G1','approve','--note','keynote']);
    fails(home,['taste','g1',film],'taste g1 needs storyboard.json look.id: set the chosen look before the gate');
    // Bun keeps a cache under HOME, so check only for the profile folder.
    expect(await readdir(home)).not.toContain('.motion-studio');

    await edit(film,s => {s.look.id = 'keynote-minimal';});
    ok(home,['gate',film,'G1','approve','--note','keynote']);
    await seed(home,{version:1, liked:[{kind:'look', value:'x'}], rejected:[], notes:[]});
    const bad = await readFile(profilePath(home),'utf8');
    fails(home,['taste','g1',film],`${profilePath(home)}: not a taste profile (/liked/0: must have required property 'note'; /liked/0: must have required property 'date'); fix it, the CLI never overwrites it`);
    expect(await readFile(profilePath(home),'utf8')).toBe(bad);
    await writeFile(profilePath(home),'{"version":');
    const result = run(home,['taste','g1',film]);
    expect(result.stderr).toMatch(/^error: .*taste\.json: invalid JSON \(.*\); fix it, the CLI never overwrites it\n$/);
    expect(await readFile(profilePath(home),'utf8')).toBe('{"version":');
    expect((await storyboard(film)).look.tasteSnapshot).toBe(null);
  });
});

test('taste g1 accepts a look shown by its look-test clip or its poster, not by its liveness report alone', async () => {
  await scratch(async (home,film) => {
    await edit(film,s => {s.look.id = 'keynote-minimal';});
    await mkdir(join(film,'stills','G1'),{recursive:true});
    // The names motion-studio looktest writes: <look-id>.mkv (clip), <look-id>.png (poster), <look-id>.liveness.json.
    await writeFile(join(film,'stills','G1','swiss-grid.mkv'),'clip only');
    await writeFile(join(film,'stills','G1','paper-collage.png'),'poster only');
    await writeFile(join(film,'stills','G1','brutalist-mono.liveness.json'),'{}');
    ok(home,['gate',film,'G1','approve','--note','keynote']);
    fails(home,['taste','g1',film,'--rejected','brutalist-mono'],'taste g1: brutalist-mono has no look test at G1 (clip stills/G1/brutalist-mono.mkv or poster stills/G1/brutalist-mono.png); only a shown candidate can be passed');
    expect(ok(home,['taste','g1',film,'--rejected','swiss-grid','--rejected','paper-collage']).split('\n').slice(0,3)).toEqual(['liked look keynote-minimal','rejected look swiss-grid','rejected look paper-collage']);
  });
});

test('taste notes appends each gate note once with the vocabulary term ids it names', async () => {
  await scratch(async (home,film) => {
    await edit(film,s => {s.gates[1].notes = ['make the mask-line-reveal faster','drop the push-in; keep straight-cut','make the mask-line-reveal faster','unmask-line-reveals is not a term'];});
    const out = ok(home,['taste','notes',film,'G2']);
    expect(out).toBe([
      'noted G2: "make the mask-line-reveal faster" terms: mask-line-reveal',
      // `drop` is a term id too; a note names every id it contains as a whole word.
      'noted G2: "drop the push-in; keep straight-cut" terms: drop, push-in, straight-cut',
      'noted G2: "make the mask-line-reveal faster" terms: mask-line-reveal',
      'noted G2: "unmask-line-reveals is not a term"',
      `taste profile: ${profilePath(home)}`,
    ].join('\n')+'\n');
    const notes = (await profile(home)).notes;
    expect(notes.map((n:Json) => ({text:n.text, terms:n.terms, film:n.film, gate:n.gate}))).toEqual([
      {text:'make the mask-line-reveal faster', terms:['mask-line-reveal'], film:'launch', gate:'G2'},
      {text:'drop the push-in; keep straight-cut', terms:['drop','push-in','straight-cut'], film:'launch', gate:'G2'},
      {text:'make the mask-line-reveal faster', terms:['mask-line-reveal'], film:'launch', gate:'G2'},
      {text:'unmask-line-reveals is not a term', terms:[], film:'launch', gate:'G2'},
    ]);
    notes.forEach(dated);
    // A rerun after one more round adds only the new note.
    await edit(film,s => {s.gates[1].notes.push('hold the end card');});
    expect(ok(home,['taste','notes',film,'G2'])).toBe(`noted G2: "hold the end card" terms: hold\ntaste profile: ${profilePath(home)}\n`);
    expect(ok(home,['taste','notes',film,'G2'])).toBe('G2: no new notes (5 already in the profile)\n');
    expect((await profile(home)).notes).toHaveLength(5);
    fails(home,['taste','notes',film,'G9'],'usage: motion-studio taste show | taste g1 <film-dir> [--rejected <look-id>]... [--kept <look-id>:<pattern>]... | taste notes <film-dir> <G1-G5> | taste accept <film-dir> [--move <term>]... [--pacing <text>]');
  });
});

test('two taste commands at once keep both notes; a stale lock is removed', async () => {
  await scratch(async (home,film) => {
    const other = join(dirname(film),'other');
    await cp(film,other,{recursive:true});
    await edit(film,s => {s.gates[1].notes = ['note from launch'];});
    await edit(other,s => {s.gates[1].notes = ['note from other'];});
    // Both commands of a round use one runtime so their start-up times match and their reads and writes overlap.
    // Several rounds, because one overlap may not interleave them.
    for (let round = 0; round < 10; round++) {
      await rm(join(home,'.motion-studio'),{recursive:true,force:true});
      const runtime = runtimes[round % 2];
      const results = await Promise.all([start(runtime,home,['taste','notes',film,'G2']),start(runtime,home,['taste','notes',other,'G2'])]);
      for (const r of results) {expect(r.stderr).toBe(''); expect(r.status).toBe(0);}
      expect((await profile(home)).notes.map((n:Json) => n.text).sort()).toEqual(['note from launch','note from other']);
      expect(await readdir(join(home,'.motion-studio'))).toEqual(['taste.json']);
    }
    // A lock left by a process that died more than 30 s ago does not block a command.
    const lock = join(home,'.motion-studio','taste.json.lock');
    await writeFile(lock,'99999\n');
    const old = new Date(Date.now()-60_000);
    await utimes(lock,old,old);
    await edit(film,s => {s.gates[1].notes.push('after the crash');});
    ok(home,['taste','notes',film,'G2']);
    expect((await profile(home)).notes.map((n:Json) => n.text)).toContain('after the crash');
    expect(await readdir(join(home,'.motion-studio'))).toEqual(['taste.json']);
    // Two commands that both find the stale lock: only one may remove it, so the other never deletes the fresh lock.
    for (let round = 0; round < 10; round++) {
      await rm(join(home,'.motion-studio'),{recursive:true,force:true});
      await mkdir(join(home,'.motion-studio'),{recursive:true});
      await writeFile(lock,'99999\n');
      await utimes(lock,old,old);
      const runtime = runtimes[round % 2];
      const results = await Promise.all([start(runtime,home,['taste','notes',film,'G2']),start(runtime,home,['taste','notes',other,'G2'])]);
      for (const r of results) {expect(r.stderr).toBe(''); expect(r.status).toBe(0);}
      expect((await profile(home)).notes.map((n:Json) => n.text).sort()).toEqual(['after the crash','note from launch','note from other']);
      expect(await readdir(join(home,'.motion-studio'))).toEqual(['taste.json']);
    }
    // A stale lock with a guard left by a crash: the command waits the full 60 s bound, then fails and names both files.
    await rm(join(home,'.motion-studio'),{recursive:true,force:true});
    await mkdir(join(home,'.motion-studio'),{recursive:true});
    await writeFile(lock,'99999\n');
    await utimes(lock,old,old);
    await writeFile(`${lock}.break`,'');
    const began = Date.now();
    const stuck = await start('node',home,['taste','notes',film,'G2']);
    expect(Date.now()-began).toBeGreaterThanOrEqual(60_000);
    expect(stuck.status).toBe(1);
    expect(stuck.stderr).toBe(`error: ${lock}: another taste command holds the lock; wait for it, or remove the file (and ${lock}.break) if no taste command runs\n`);
    expect((await readdir(join(home,'.motion-studio'))).sort()).toEqual(['taste.json.lock','taste.json.lock.break']);
  });
});

test('taste accept records the accepted look, signature moves and pacing after G5 approval', async () => {
  await scratch(async (home,film) => {
    await edit(film,s => {s.look.id = 'keynote-minimal';});
    fails(home,['taste','accept',film],'taste accept needs G5 approved and not stale; G5 is pending');
    ok(home,['gate',film,'G1','approve','--note','keynote']);
    for (const gate of ['G2','G3']) ok(home,['gate',film,gate,'approve']);
    // The stand-in master cannot be measured, so G4 is approved with a liveness waiver (D60).
    await fakeCritique(film);
    ok(home,['gate',film,'G4','approve','--waive','liveness','--note','no master in this fixture']);
    ok(home,['gate',film,'G5','approve','--note','ship it']);
    fails(home,['taste','accept',film,'--move','whoosh-in'],'taste accept: move "whoosh-in" is not a motion-vocabulary term id or custom:<description>');
    fails(home,['taste','accept',film,'--move','custom: '],'taste accept: move "custom: " is not a motion-vocabulary term id or custom:<description>');
    expect(await readdir(home)).not.toContain('.motion-studio');
    const out = ok(home,['taste','accept',film,'--move','mask-line-reveal','--move','custom:paper tear wipe','--pacing','fast cuts, 2 s end hold']);
    expect(out).toBe(['liked look keynote-minimal','liked move mask-line-reveal','liked move custom:paper tear wipe','liked pacing fast cuts, 2 s end hold',`taste profile: ${profilePath(home)}`].join('\n')+'\n');
    const note = 'launch: G5 accepted: "ship it"';
    const liked = (await profile(home)).liked;
    expect(liked.map((e:Json) => ({...dated(e), date:undefined}))).toEqual([
      {kind:'look', value:'keynote-minimal', note, date:undefined},
      {kind:'move', value:'mask-line-reveal', note, date:undefined},
      {kind:'move', value:'custom:paper tear wipe', note, date:undefined},
      {kind:'pacing', value:'fast cuts, 2 s end hold', note, date:undefined},
    ]);
    // Pacing is recorded only when acceptance names it; a rerun without it adds nothing.
    expect(ok(home,['taste','accept',film])).toBe(`already liked look keynote-minimal\ntaste profile: ${profilePath(home)}\n`);
    expect((await profile(home)).liked).toHaveLength(4);
  });
});

test('taste show prints the empty profile when the file is absent, then the stored profile', async () => {
  await scratch(async home => {
    expect(JSON.parse(ok(home,['taste','show']))).toEqual({version:1, liked:[], rejected:[], notes:[]});
    expect(await readdir(home)).not.toContain('.motion-studio');
    await seed(home,{version:1, liked:[earlier], rejected:[], notes:[]});
    expect(JSON.parse(ok(home,['taste','show']))).toEqual({version:1, liked:[earlier], rejected:[], notes:[]});
  });
});

test('style-bible passes a reference extraction that records evidence, take and do not take for every source', async () => {
  await scratch(async home => {
    expect(ok(home,['style-bible',styleFixture,'--reference','reference/launch-film.mp4','--reference','reference/posters/'])).toBe([
      'ok ref-a: reference/launch-film.mp4 (creator upload, rights: direction only): evidence, take and do not take recorded',
      'ok ref-b: reference/posters/ (image folder, rights: unknown): evidence, take and do not take recorded',
      'style bible ok: 2 references',
    ].join('\n')+'\n');
  });
});

test('style-bible fails a reference without its own take or do-not-take line, a template line, or a missing source', async () => {
  await scratch(async home => {
    const text = await readFile(styleFixture,'utf8');
    const file = join(home,'style-bible.md');
    const check = async (content:string, args:string[], message:string) => {
      await writeFile(file,content);
      fails(home,['style-bible',file,...args],message);
    };
    const refB = 'ref-b: reference/posters/ (image folder, rights: unknown)';
    await check(text.replace('- Do not take: the poster photographs and the exhibition names; replace them with Ledger totals\n',''),[],
      `${file}: reference "${refB}" has no "- Do not take:" line`);
    await check(text.replace('- Take: captions anchored to a visible column line, numbers set in a mono face','- Take:'),[],
      `${file}: reference "${refB}" has an empty or template "- Take:" line`);
    await check(text.replace('- Take: captions anchored to a visible column line, numbers set in a mono face','- Take: <specific visual method to adapt to the product>'),[],
      `${file}: reference "${refB}" has an empty or template "- Take:" line`);
    await check(text,['--reference','reference/brand-deck.pdf'],`${file}: no reference section names reference/brand-deck.pdf`);
    await check(text.replace('## References','## Sources'),[],`${file}: no "## References" section`);
    // A take line outside the references section does not count for a reference.
    await check(text.replace(/### ref-b[\s\S]*?(?=## Build handoff)/,''),['--reference','reference/posters/'],`${file}: no reference section names reference/posters/`);
  });
});
