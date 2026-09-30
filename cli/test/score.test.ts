import {test, before} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp, mkdir, readFile, writeFile, stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {createHash} from 'node:crypto';

const script = resolve('../skills/motion-score/scripts/score.py');
const venv = join(tmpdir(),'motion-score-test-venv');
const python = process.env.SCORE_PYTHON ?? join(venv,'bin/python');
before(async () => {
  if (process.env.SCORE_PYTHON) return;
  if (!await stat(python).then(()=>true,()=>false)) {
    run('python3',['-m','venv',venv]);
    run(python,['-m','pip','install','-r',resolve('../skills/motion-score/scripts/requirements.txt')]);
  }
}, {timeout:300000});
function run(command:string, args:string[]) {
  const result = spawnSync(command,args,{encoding:'utf8',timeout:240000});
  assert.equal(result.status,0,result.stderr + result.stdout);
  return result.stdout + result.stderr;
}
const hash = (bytes:Buffer) => createHash('sha256').update(bytes).digest('hex');

test('a storyboard score delivers frame-aligned hits, measured loudness, and repeatable WAV bytes', {timeout:240000}, async () => {
  const root = await mkdtemp(join(tmpdir(),'motion-score-'));
  const film = join(root,'film');
  // Extend the authoritative empty board without touching a user's HOME.
  const {emptyStoryboard} = await import('../src/project.ts');
  await mkdir(film);
  // A 6-second film at 30 fps. Reveal at 2 s, UI at 3 s, logo at 4 s, all on a 120 BPM grid.
  const board = {...emptyStoryboard(),meta:{...emptyStoryboard().meta,fps:30,durationFrames:180},audio:{...emptyStoryboard().audio,bpm:120,beatFrames:Array.from({length:12},(_,i)=>i*15),downbeatFrames:[0,60,120],dropFrames:[60]},shots:[{id:'s01',startFrame:0,endFrame:180,engine:'hyperframes',entrypoint:'shots/s01/index.html',description:'fixture',camera:'push',entry:'cut',exit:'cut',assets:[],stillFrames:[],protected:[],soundCues:[{asset:'impact',eventFrame:60,peakOffsetFrames:0},{asset:'click',eventFrame:90,peakOffsetFrames:0},{asset:'logo',eventFrame:120,peakOffsetFrames:0}]}]};
  await writeFile(join(film,'ledger.json'),JSON.stringify({version:'0',assets:[]}));
  await writeFile(join(film,'storyboard.json'),JSON.stringify(board));
  await writeFile(join(film,'beatmap.md'),'# Beat contract\nReveal: frame 60. UI: frame 90. Logo: frame 120.\n');
  const args = [script,film,'--seed','51','--reveal-frame','60','--logo-frame','120','--sfx-density','0'];
  run(python,[...args,'--out',join(film,'audio/scores/a')]);
  run(python,[...args,'--out',join(film,'audio/scores/b')]);
  const report = JSON.parse(await readFile(join(film,'audio/scores/a/audio-report.json'),'utf8'));
  assert.equal(report.passed,true);
  assert.deepEqual(report.hits.map((hit:{eventFrame:number})=>hit.eventFrame),[60,90,120]);
  for (const hit of report.hits) {
    // Independently decode each delivered stem, not the reported onset or a mix peak.
    const decoded = spawnSync('ffmpeg',['-v','error','-i',join(film,'audio/scores/a',hit.file),'-f','f32le','-ac','1','-ar','48000','-'],{maxBuffer:10_000_000});
    assert.equal(decoded.status,0);
    const samples = new Float32Array(new Uint8Array(decoded.stdout).buffer);
    const first = samples.findIndex(sample=>Math.abs(sample)>0.001);
    assert.ok(Math.abs(first/1600-hit.eventFrame)<=1,`onset ${first/1600} vs ${hit.eventFrame}`);
  }
  const meter = run('ffmpeg',['-hide_banner','-nostats','-i',join(film,'audio/scores/a/score.wav'),'-af','ebur128=peak=true','-f','null','-']);
  const lufs = Number(/Integrated loudness:\s*I:\s*(-?[\d.]+)/.exec(meter)?.[1]);
  const peak = Number(/True peak:\s*Peak:\s*(-?[\d.]+)/.exec(meter)?.[1]);
  assert.ok(Math.abs(lufs+14)<=0.5,`${lufs} LUFS`);
  assert.ok(peak<=-1,`${peak} dBTP`);
  for (const file of report.files) assert.equal(hash(await readFile(join(film,'audio/scores/a',file.file))),hash(await readFile(join(film,'audio/scores/b',file.file))));
  // The CLI imports every WAV into the real ledger, uses music as bed, and keeps SFX separate for mix.
  for (const runtime of ['node','bun']) {
    run(runtime,[resolve('dist/cli.js'),'score-import',film,join(film,'audio/scores/a/audio-report.json'),'--id',runtime]);
    const imported = JSON.parse(await readFile(join(film,'storyboard.json'),'utf8'));
    const ledger = JSON.parse(await readFile(join(film,'ledger.json'),'utf8'));
    assert.equal(imported.audio.track,`${runtime}-music`);
    assert.equal(imported.shots[0].soundCues.length,3);
    assert.equal(imported.shots[0].soundCues[2].asset,`${runtime}-hit-02`);
    assert.equal(ledger.assets.filter((asset:{id:string})=>asset.id.startsWith(runtime+'-')).length,report.files.length);
    // Restore the exact input bytes for the second runtime. Import changes the board, not the score's source record.
    await writeFile(join(film,'storyboard.json'),JSON.stringify(board));
  }
  // Cleanup uses trash, including on the same Node/Bun test boundary.
  run('trash',[root]);
});
