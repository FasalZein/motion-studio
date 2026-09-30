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
/**
 * Writes what `packet` and a fresh motion-critique reviewer write for the master bytes `master` (D80): the packet with
 * its render.masterSha256 and a report whose header names the packet and that hash (reviewer.md format).
 */
async function critique(dir:string, master:string, {loop = 1, independence = 'independent', packetMaster = master} = {}) {
  await write(dir,'critique/packet-16x9/packet.json',JSON.stringify({mode:'in-studio', render:{master:'renders/16x9/master.mkv', masterSha256:sha(packetMaster)}}));
  await write(dir,`critique/loop-${loop}.md`,`# Critique loop ${loop}\nMode: in-studio; independence: ${independence}\nRender: renders/16x9/master.mkv; format: 16:9; fps: 30; revision hashes: unavailable\nPacket: critique/packet-16x9/packet.json; master sha256: ${sha(master)}\n`);
}
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
    // G1 hashes the brief, the look-test stills, the style bible file and the storyboard look record without its taste
    // snapshot, which `taste g1` writes after the decision.
    expect(Object.keys(g1.inputHashes).sort()).toEqual(['BRIEF.md','stills/G1/look-a.png','storyboard.json#/look{id,styleBible,axes}','style-bible.md']);
    expect(g1.inputHashes['BRIEF.md']).toBe(sha(await readFile(join(fixture,'BRIEF.md'),'utf8')));
    expect(g1.inputHashes['stills/G1/look-a.png']).toBe(sha('look A v1'));
    expect(g1.inputHashes['style-bible.md']).toBe(sha('take: hard cuts\ndo not take: lens flares\n'));
    // Canonical JSON: keys sorted, no spaces; the fixture's look has id null and no axes.
    expect(g1.inputHashes['storyboard.json#/look{id,styleBible,axes}']).toBe(sha('{"axes":{},"id":null,"styleBible":"style-bible.md"}'));

    // The frozen copy is a separate read-only file, not a link to the live still.
    const frozenDirs = await readdir(join(dir,'stills/approved'));
    expect(frozenDirs).toHaveLength(1);
    expect(frozenDirs[0]).toMatch(/^G1-[0-9a-f]{8}$/);
    expect(out).toContain(`frozen stills: stills/approved/${frozenDirs[0]}\n`);
    const frozen = join(dir,'stills/approved',frozenDirs[0],'look-a.png');
    const info = await lstat(frozen);
    expect(info.isSymbolicLink()).toBe(false);
    expect(info.mode & 0o222).toBe(0);
    // D43: the approval binds the frozen copy, so a later edit of the live still leaves G1 approved.
    await write(dir,'stills/G1/look-a.png','look A v2');
    expect(await readFile(frozen,'utf8')).toBe('look A v1');
    expect(status(dir)).toBe(lines('G1 approved','G2 pending','G3 pending','G4 pending','G5 pending',
      'next: board: beat map, keyframe builds and stills, then present G2'));
    // A lost frozen copy is a lost approval.
    await rm(join(dir,'stills/approved'),{recursive:true,force:true});
    expect(status(dir)).toBe(lines('G1 stale (changed: stills/G1/look-a.png)','G2 pending','G3 pending','G4 pending','G5 pending',
      'next: G1 is stale: rerun brief, hero assets and look test, then present G1 again'));
  });
});

test('G1 approve needs a passing look-test report with the SHA-256 of each look-test clip (D77)', async () => {
  await withFilm(async dir => {
    // A clip copied in by hand, with no report beside it.
    await write(dir,'stills/G1/look-b.mkv','clip B');
    const hint = `; run motion-studio looktest ${dir} <look-id> for each look test`;
    await refused(dir,['G1','approve'],`cannot approve G1: stills/G1/look-b.mkv has no readable look-test report stills/G1/look-b.liveness.json${hint}`);
    // A passing report of another render.
    await write(dir,'stills/G1/look-b.liveness.json',JSON.stringify({sha256:sha('clip B v0'), pass:true}));
    await refused(dir,['G1','approve'],`cannot approve G1: stills/G1/look-b.liveness.json describes another clip than stills/G1/look-b.mkv${hint}`);
    // A failing report of this clip; a second hand-copied clip in a subfolder is named too.
    await write(dir,'stills/G1/look-b.liveness.json',JSON.stringify({sha256:sha('clip B'), pass:false}));
    await write(dir,'stills/G1/extra/look-c.mkv','clip C');
    await refused(dir,['G1','approve'],`cannot approve G1: stills/G1/extra/look-c.mkv has no readable look-test report stills/G1/extra/look-c.liveness.json; stills/G1/look-b.liveness.json does not pass${hint}`);
    // Each clip with a passing report of its own bytes: G1 approves.
    await write(dir,'stills/G1/look-b.liveness.json',JSON.stringify({sha256:sha('clip B'), pass:true}));
    await write(dir,'stills/G1/extra/look-c.liveness.json',JSON.stringify({sha256:sha('clip C'), pass:true}));
    ok(['gate',dir,'G1','approve']);
    expect(status(dir).split('\n')[0]).toBe('G1 approved');
    // The check guards approval only: changes and rescope need no report.
    await write(dir,'stills/G1/look-b.mkv','clip B v2');
    ok(['gate',dir,'G1','changes','--note','warmer']);
  });
});

test('G1 binds the look id and axes, not the taste snapshot written after the decision', async () => {
  await withFilm(async dir => {
    ok(['gate',dir,'G1','approve','--note','keynote minimal']);
    await edit(dir,s => {s.look.tasteSnapshot = 'taste-snapshot.json';});
    expect(status(dir).split('\n')[0]).toBe('G1 approved');
    await edit(dir,s => {s.look.axes = {density:'wide'};});
    expect(status(dir).split('\n')[0]).toBe('G1 stale (changed: storyboard.json#/look{id,styleBible,axes})');
  });
});

test('resume after an upstream edit: the edited gate and every later approval are stale', async () => {
  await withFilm(async dir => {
    ok(['gate',dir,'G1','approve']);
    ok(['gate',dir,'G2','approve']);
    await appendFile(join(dir,'BRIEF.md'),'Direction: warmer.\n');
    expect(status(dir)).toBe(lines('G1 stale (changed: BRIEF.md)','G2 stale (G1 not approved)','G3 pending','G4 pending','G5 pending',
      'next: G1 is stale: rerun brief, hero assets and look test, then present G1 again'));
    // D44: validate rejects stale approvals; render commands skip the gate check, so stitch gets past the project
    // checks and stops only on its own precondition.
    const validate = run(['validate',dir]);
    expect(validate.status).toBe(1);
    expect(validate.stderr).toBe('error: gate G1 is stale (changed: BRIEF.md); present G1 again\nerror: gate G2 is stale (G1 not approved); present G2 again\n');
    const stitch = run(['stitch',dir]);
    expect(stitch.stderr).toBe('error: successful render required before stitch: 16:9\n');
    expect(stitch.status).toBe(1);
    await refused(dir,['G2','approve'],'cannot record G2: G1 is not approved (stale: changed: BRIEF.md); approve G1 first');
    // Approving G1 again does not restore G2: G2 was approved against the old brief.
    ok(['gate',dir,'G1','approve']);
    expect((await storyboard(dir)).gates[0].inputHashes['BRIEF.md']).toBe(sha(await readFile(join(dir,'BRIEF.md'),'utf8')));
    expect(status(dir)).toBe(lines('G1 approved','G2 stale','G3 pending','G4 pending','G5 pending',
      'next: G2 is stale: rerun board: beat map, keyframe builds and stills, then present G2 again'));
    // A gate recorded as stale stays an error for validate until it is presented again.
    const recorded = run(['validate',dir]);
    expect(recorded.status).toBe(1);
    expect(recorded.stderr).toBe('error: gate G2 is stale; present G2 again\n');
    ok(['gate',dir,'G2','approve']);
    expect(status(dir)).toBe(lines('G1 approved','G2 approved','G3 pending','G4 pending','G5 pending',
      'next: blocking builds, render and stitch of the primary format, and the moving animatic, then present G3'));
    expect(ok(['validate',dir])).toBe(`valid ${dir}\n`);
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

const g2Grid = 'storyboard.json#/audio{bpm,beatFrames,downbeatFrames,dropFrames}';
const g2Map = 'storyboard.json#/shots{id,startFrame,endFrame}';

test('G2 binds the beat grid and beat map, not shot descriptions or fill-mode assets', async () => {
  await withFilm(async dir => {
    await write(dir,'animatic.mp4','animatic v1');
    for (const id of ['G1','G2','G3']) ok(['gate',dir,id,'approve']);
    const built = await storyboard(dir);
    const g2 = built.gates[1];
    expect(g2.inputHashes[g2Grid]).toBe(sha('{"beatFrames":[3,6],"bpm":null,"downbeatFrames":[],"dropFrames":[]}'));
    expect(g2.inputHashes[g2Map]).toBe(sha('[{"endFrame":6,"id":"remotion","startFrame":0},{"endFrame":12,"id":"hyperframes","startFrame":6}]'));
    expect(g2.inputHashes['storyboard.json#/meta{fps,durationFrames}']).toBe(sha('{"durationFrames":12,"fps":30}'));
    const approved = lines('G1 approved','G2 approved','G3 approved','G4 pending','G5 pending',"next: fill assets, full build, polish (D81), liveness and a fresh reviewer's critique loop A, then present G4");

    // Fill mode, description and seam-thread edits, grid labels, formats and layouts leave G2 and G3 approved (D43, D64).
    await edit(dir,s => {
      s.shots[1].description = 'HYPERFRAMES label, warmer';
      s.shots[1].thread = {kind:'light-thread', shared:'the warm glow'};
      s.shots[1].assets.push('sfx-hit');
      s.shots[1].soundCues.push({asset:'sfx-hit', eventFrame:9, peakOffsetFrames:0});
      s.audio.grid = 'corrected'; s.audio.confidence = 'low';
      s.meta.formats.extra = ['9:16'];
      s.meta.layouts['9:16'] = {canvas:{width:180, height:320}, safe:{x:9, y:16, width:162, height:288}, overlay:null};
    });
    expect(status(dir)).toBe(approved);

    // A beat frame change stales G2 and every later approval; restoring it restores the approvals.
    await edit(dir,s => {s.audio.beatFrames = [3,6,9];});
    expect(status(dir)).toBe(lines('G1 approved',`G2 stale (changed: ${g2Grid})`,'G3 stale (G2 not approved)','G4 pending','G5 pending',
      'next: G2 is stale: rerun board: beat map, keyframe builds and stills, then present G2 again'));
    await edit(dir,s => {s.audio.beatFrames = [3,6];});
    expect(status(dir)).toBe(approved);

    // So does a cut moved to another frame (which also leaves a still frame outside the shorter shot).
    await edit(dir,s => {s.shots[0].endFrame = 3; s.shots[1].startFrame = 3;});
    expect(status(dir)).toBe(lines('G1 approved',`G2 stale (changed: ${g2Map})`,'G3 stale (G2 not approved)','G4 pending','G5 pending',
      'next: G2 is stale: rerun board: beat map, keyframe builds and stills, then present G2 again',`validation: 1 error; run motion-studio validate ${dir}`));
  });
});

test('G2 binds the narration script and word timings by content', async () => {
  await withFilm(async dir => {
    await write(dir,'audio/script.txt','Why now?');
    await write(dir,'audio/words.json','[{"text":"Why","start":0.05,"end":0.1}]');
    await edit(dir,s => {s.voice = {script:'audio/script.txt', tts:null, wordTimings:'audio/words.json'};});
    for (const id of ['G1','G2']) ok(['gate',dir,id,'approve']);
    const g2 = (await storyboard(dir)).gates[1];
    expect(g2.inputHashes['audio/script.txt']).toBe(sha('Why now?'));
    expect(g2.inputHashes['audio/words.json']).toBe(sha('[{"text":"Why","start":0.05,"end":0.1}]'));
    // A new take with other word times keeps the storyboard unchanged but stales G2.
    await write(dir,'audio/words.json','[{"text":"Why","start":0.1,"end":0.2}]');
    expect(status(dir)).toBe(lines('G1 approved','G2 stale (changed: audio/words.json)','G3 pending','G4 pending','G5 pending',
      'next: G2 is stale: rerun board: beat map, keyframe builds and stills, then present G2 again'));
  });
});

test('polish after G4 keeps G4; a shot edit after G5 stales only G5', async () => {
  await withFilm(async dir => {
    await write(dir,'animatic.mp4','animatic v1');
    await write(dir,'renders/16x9/master.mkv','master v1');
    await write(dir,'renders/16x9/draft.mp4','full pass mp4');
    for (const id of ['G1','G2','G3']) ok(['gate',dir,id,'approve']);
    await critique(dir,'master v1');
    // The fake master cannot be measured, so G4 is approved with a liveness waiver (D60).
    ok(['gate',dir,'G4','approve','--waive','liveness','--note','fake master']);
    const gates = (await storyboard(dir)).gates;
    // G3 and G4 bind the frozen copies of what they showed, recorded under the live paths.
    expect(gates[2].inputHashes['stills/G2/b01.png']).toBe(sha('beat 1 v1'));
    expect(gates[2].inputHashes['animatic.mp4']).toBe(sha('animatic v1'));
    expect(gates[3].inputHashes['renders/16x9/master.mkv']).toBe(sha('master v1'));
    expect(gates[3].inputHashes['renders/16x9/draft.mp4']).toBe(sha('full pass mp4'));
    expect(Object.keys(gates[3].inputHashes).filter(k => k.startsWith('shots/') || k === 'ledger.json')).toEqual([]);
    const frozenG4 = (await readdir(join(dir,'stills/approved'))).filter(d => d.startsWith('G4-'));
    expect(frozenG4).toHaveLength(1);
    expect(await readFile(join(dir,'stills/approved',frozenG4[0],'16x9/master.mkv'),'utf8')).toBe('master v1');
    // G4 also binds the frozen critique report it showed, so a later loop B report does not stale G4.
    expect(gates[3].inputHashes['critique/loop-1.md']).toBe(sha(await readFile(join(dir,'critique/loop-1.md'),'utf8')));
    await critique(dir,'master v1 remuxed',{loop:2});

    // Step 7: polish shot sources and the ledger, re-stitch with the same and with other bytes, add a second format.
    const before = status(dir);
    await appendFile(join(dir,'shots/hyperframes/index.html'),'<!-- polish -->\n');
    await appendFile(join(dir,'ledger.json'),'\n');
    await write(dir,'renders/16x9/master.mkv','master v1');
    expect(status(dir)).toBe(before);
    await write(dir,'renders/16x9/master.mkv','master v1 remuxed');
    await write(dir,'renders/9x16/master.mkv','master 9x16');
    await write(dir,'animatic.mp4','animatic v2');
    await write(dir,'stills/G2/b01.png','beat 1 v2');
    expect(status(dir)).toBe(lines('G1 approved','G2 approved','G3 approved','G4 approved','G5 pending',
      'next: mix, draft renders per format, critique loop B and license check, then present G5','liveness 16:9 missing (no readable renders/16x9/liveness.json)'));

    await write(dir,'renders/16x9/safezone.json','{"ok":true}');
    await write(dir,'renders/16x9/scan.json','{"counts":{"blocking":0}}');
    await write(dir,'renders/16x9/sync.json','{"sync":1}');
    await write(dir,'renders/16x9/handoff-remotion-hyperframes.json','{"status":"match"}');
    await write(dir,'renders/16x9/mix.wav','mix v1');
    // sheet writes numbered contact pages; G5 shows them, but not the transition strips or the index map.
    await write(dir,'renders/16x9/contact-sheet-001.png','contact page 1');
    await write(dir,'renders/16x9/transition-remotion-hyperframes.png','strip');
    await write(dir,'renders/16x9/sheet.json','{"index":1}');
    await write(dir,'renders/16x9/.staging/scratch.mkv','scratch');
    await write(dir,'shots/hyperframes/.cache','cache v1');
    await edit(dir,s => {s.meta.layouts['16:9'].overlay = 'youtube';});
    expect(ok(['gate',dir,'G5','approve'])).toContain('warning: G5 critique[] is empty');
    const g5 = (await storyboard(dir)).gates[4];
    expect(g5.inputHashes['shots/hyperframes/index.html']).toBe(sha(await readFile(join(dir,'shots/hyperframes/index.html'),'utf8')));
    expect(g5.inputHashes['ledger.json']).toBe(sha(await readFile(join(dir,'ledger.json'),'utf8')));
    expect(g5.inputHashes['storyboard.json#/meta/layouts']).toBe(sha('{"16:9":{"canvas":{"height":180,"width":320},"overlay":"youtube","safe":{"height":162,"width":288,"x":16,"y":9}}}'));
    expect(g5.inputHashes['renders/16x9/safezone.json']).toBe(sha('{"ok":true}'));
    expect(g5.inputHashes['renders/16x9/scan.json']).toBe(sha('{"counts":{"blocking":0}}'));
    expect(g5.inputHashes['renders/16x9/handoff-remotion-hyperframes.json']).toBe(sha('{"status":"match"}'));
    expect(g5.inputHashes['renders/16x9/contact-sheet-001.png']).toBe(sha('contact page 1'));
    expect(Object.keys(g5.inputHashes).filter(k => k.includes('transition-') || k.endsWith('sheet.json'))).toEqual([]);
    // G5 inherits G4's frozen master, not the re-stitched one, and not a master G4 never showed.
    expect(g5.inputHashes['renders/16x9/master.mkv']).toBe(sha('master v1'));
    expect(Object.keys(g5.inputHashes).filter(k => k.startsWith('renders/9x16/') || k.includes('/.'))).toEqual([]);

    // Re-running a delivery check after G5 keeps G5; a shot source edit stales G5 only.
    await write(dir,'renders/16x9/safezone.json','{"ok":true,"rerun":1}');
    await write(dir,'renders/16x9/scan.json','{"counts":{"blocking":0},"rerun":1}');
    await write(dir,'shots/hyperframes/.cache','cache v2');
    // Engine output inside a shot folder after G5 (HyperFrames check --snapshots, render without --output, beats;
    // Remotion out/ and build/) and look-test edits are not shot sources.
    for (const out of ['snapshots/frame-0.png','renders/preview_1.mp4','beats/track.json','out/still.png','build/index.html'])
      await write(dir,`shots/hyperframes/${out}`,'engine output');
    await write(dir,'shots/_look/keynote/index.html','look test v2');
    const allApproved = lines('G1 approved','G2 approved','G3 approved','G4 approved','G5 approved','next: final render, then user acceptance of the files','liveness 16:9 missing (no readable renders/16x9/liveness.json)');
    expect(status(dir)).toBe(allApproved);
    expect(ok(['validate',dir])).toBe(`valid ${dir}\n`);

    // The final render and mix read the whole shot and audio records, so G5 binds them: removing a sound cue or the
    // music bed stales G5 only.
    const approvedStoryboard = await readFile(join(dir,'storyboard.json'),'utf8');
    const g5Only = (key:string) => lines('G1 approved','G2 approved','G3 approved','G4 approved',`G5 stale (changed: ${key})`,
      'next: G5 is stale: rerun mix, draft renders per format, critique loop B and license check, then present G5 again','liveness 16:9 missing (no readable renders/16x9/liveness.json)');
    await edit(dir,s => {s.shots[1].soundCues = [];});
    expect(status(dir)).toBe(g5Only('storyboard.json#/shots'));
    await writeFile(join(dir,'storyboard.json'),approvedStoryboard);
    await edit(dir,s => {s.audio.track = null;});
    expect(status(dir)).toBe(g5Only('storyboard.json#/audio'));
    await writeFile(join(dir,'storyboard.json'),approvedStoryboard);
    expect(status(dir)).toBe(allApproved);
    await appendFile(join(dir,'shots/hyperframes/index.html'),'<!-- late -->\n');
    expect(status(dir)).toBe(lines('G1 approved','G2 approved','G3 approved','G4 approved','G5 stale (changed: shots/hyperframes/index.html)',
      'next: G5 is stale: rerun mix, draft renders per format, critique loop B and license check, then present G5 again','liveness 16:9 missing (no readable renders/16x9/liveness.json)'));
  });
});

test('G4 approve refuses without a current independent critique report and accepts one of the current master', async () => {
  await withFilm(async dir => {
    await write(dir,'renders/16x9/master.mkv','master v2');
    for (const id of ['G1','G2','G3']) ok(['gate',dir,id,'approve']);
    const approve = ['G4','approve','--waive','liveness','--note','fake master'];
    const hint = `; run motion-studio packet ${dir} and dispatch a fresh motion-critique reviewer (its report header names the packet and master sha256), or, with no subagent available, approve a non-independent report with --waive critique --note <reason>`;
    await refused(dir,approve,`cannot approve G4: critique 16:9 missing (no readable critique/packet-16x9/packet.json)${hint}`);
    // A malformed packet is refused with an error line, not a stack trace.
    await write(dir,'critique/packet-16x9/packet.json','{bad');
    await refused(dir,approve,`cannot approve G4: critique 16:9 missing (no readable critique/packet-16x9/packet.json)${hint}`);
    // A packet of an earlier master is not current evidence, even when a report names the current master.
    await critique(dir,'master v2',{packetMaster:'master v1'});
    await refused(dir,approve,`cannot approve G4: critique 16:9 stale (critique/packet-16x9/packet.json describes another master)${hint}`);
    // A current packet with only a report of an earlier master.
    await critique(dir,'master v1',{packetMaster:'master v2'});
    await refused(dir,approve,`cannot approve G4: critique 16:9 missing (no critique/loop-*.md names critique/packet-16x9/packet.json with the current master sha256)${hint}`);
    // The builder's inline review is not the fresh reviewer the gate needs.
    await critique(dir,'master v2',{independence:'non-independent'});
    await refused(dir,approve,`cannot approve G4: critique 16:9 non-independent (critique/loop-1.md; dispatch a fresh reviewer)${hint}`);
    // Only the header counts: a body line after the first `## ` heading does not make the report independent.
    await appendFile(join(dir,'critique/loop-1.md'),'\n## Film scores\nMode: in-studio; independence: independent\n');
    await refused(dir,approve,`cannot approve G4: critique 16:9 non-independent (critique/loop-1.md; dispatch a fresh reviewer)${hint}`);
    // The liveness waiver does not lift the critique check; notes and rescope need no report.
    ok(['gate',dir,'G4','changes','--note','tighten the hold']);
    await critique(dir,'master v2',{loop:2});
    const out = ok(['gate',dir,...approve]);
    expect(out).toContain('recorded G4 approve');
    expect(out).toContain('warning: G4 critique[] is empty');
    expect((await storyboard(dir)).gates[3].inputHashes['critique/loop-2.md']).toBe(sha(await readFile(join(dir,'critique/loop-2.md'),'utf8')));
  });
});

test('G4 approve with --waive critique accepts a current non-independent report and keeps each waiver with its reason', async () => {
  await withFilm(async dir => {
    await write(dir,'renders/16x9/master.mkv','master v2');
    for (const id of ['G1','G2','G3']) ok(['gate',dir,id,'approve']);
    const both = ['G4','approve','--waive','liveness','--note','fake master','--waive','critique','--note','no subagent tool in this harness'];
    const hint = `; run motion-studio packet ${dir} and dispatch a fresh motion-critique reviewer (its report header names the packet and master sha256), or, with no subagent available, approve a non-independent report with --waive critique --note <reason>`;
    // The critique waiver lifts only independence: a current packet and a report of the current master are still needed.
    await refused(dir,both,`cannot approve G4: critique 16:9 missing (no readable critique/packet-16x9/packet.json)${hint}`);
    await critique(dir,'master v1',{packetMaster:'master v2', independence:'non-independent'});
    await refused(dir,both,`cannot approve G4: critique 16:9 missing (no critique/loop-*.md names critique/packet-16x9/packet.json with the current master sha256)${hint}`);
    await critique(dir,'master v2',{packetMaster:'master v1', independence:'non-independent'});
    await refused(dir,both,`cannot approve G4: critique 16:9 stale (critique/packet-16x9/packet.json describes another master)${hint}`);
    // A current non-independent report: refused without the critique waiver, approved with it.
    await critique(dir,'master v2',{independence:'non-independent'});
    await refused(dir,both.slice(0,6),`cannot approve G4: critique 16:9 non-independent (critique/loop-1.md; dispatch a fresh reviewer)${hint}`);
    expect(run(['gate',dir,'G4','approve','--waive','critique','--note','a','--waive','critique','--note','b']).stderr).toBe('error: --waive critique given twice\n');
    expect(run(['gate',dir,'G3','approve','--waive','critique','--note','a']).stderr).toBe('error: --waive critique applies only to G4 approve\n');
    const out = ok(['gate',dir,...both]);
    expect(out).toContain('waived: liveness\nwaived: critique\n');
    const g4 = (await storyboard(dir)).gates[3];
    expect(g4.state).toBe('approved');
    expect(g4.waivers).toEqual([{check:'liveness', reason:'fake master'}, {check:'critique', reason:'no subagent tool in this harness'}]);
    expect(g4.notes).toEqual(['fake master','no subagent tool in this harness']);
    ok(['validate',dir]);
    // A film recorded before the list shape keeps its single `waiver` and still loads and validates.
    await edit(dir,s => {const {waivers:_, ...rest} = s.gates[3]; s.gates[3] = {...rest, waiver:{check:'liveness', reason:'fake master'}};});
    ok(['validate',dir]);
    expect(status(dir).split('\n')[3]).toBe('G4 approved');
  });
});

test('G5 binds each liveness report live, so a changed report after G5 stales G5', async () => {
  await withFilm(async dir => {
    await write(dir,'renders/16x9/master.mkv','master v1');
    for (const id of ['G1','G2','G3']) ok(['gate',dir,id,'approve']);
    await critique(dir,'master v1');
    ok(['gate',dir,'G4','approve','--waive','liveness','--note','fake master']);
    await write(dir,'renders/16x9/liveness.json','{"pass":false}');
    ok(['gate',dir,'G5','approve']);
    expect((await storyboard(dir)).gates[4].inputHashes['renders/16x9/liveness.json']).toBe(sha('{"pass":false}'));
    await write(dir,'renders/16x9/liveness.json','{"pass":true}');
    expect(status(dir).split('\n')[4]).toBe('G5 stale (changed: renders/16x9/liveness.json)');
  });
});

test('gate selects the gate record by id when storyboard.json lists the gates in another order', async () => {
  await withFilm(async dir => {
    await edit(dir,s => {s.gates = [s.gates[1],s.gates[0],...s.gates.slice(2)];});
    ok(['gate',dir,'G1','approve']);
    let gates = (await storyboard(dir)).gates;
    expect(gates.map((g:Json) => `${g.id}:${g.state}`)).toEqual(['G2:pending','G1:approved','G3:pending','G4:pending','G5:pending']);
    expect(gates[1].inputHashes['BRIEF.md']).toBe(sha(await readFile(join(fixture,'BRIEF.md'),'utf8')));
    expect(gates[0].inputHashes).toEqual({});
    ok(['gate',dir,'G2','approve']);
    ok(['gate',dir,'G1','changes','--note','warmer']);
    gates = (await storyboard(dir)).gates;
    expect(gates.map((g:Json) => `${g.id}:${g.state}`)).toEqual(['G2:stale','G1:changes','G3:pending','G4:pending','G5:pending']);
  });
});

test('gate refuses a decision while a gate record is missing', async () => {
  await withFilm(async dir => {
    await edit(dir,s => {s.gates = s.gates.slice(1);});
    await refused(dir,['G2','approve'],'cannot record G2: storyboard.json must list gates G1, G2, G3, G4, G5 once each; found G2, G3, G4, G5');
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
