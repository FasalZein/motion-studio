import {test, before} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp, mkdir, readFile, writeFile, stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {createHash} from 'node:crypto';

const script = resolve('../skills/motion-score/scripts/score.py');
const requirements = resolve('../skills/motion-score/scripts/requirements.txt');
const requirementsHash = createHash('sha256').update(await readFile(requirements)).digest('hex');
const venv = join(tmpdir(),`motion-score-test-venv-${requirementsHash.slice(0,16)}`);
const marker = join(venv,'requirements.sha256');
const python = process.env.SCORE_PYTHON ?? join(venv,'bin/python');
before(async () => {
  if (process.env.SCORE_PYTHON) return;
  if (!await stat(python).then(()=>true,()=>false)) {
    run('python3',['-m','venv',venv]);
  }
  if (await readFile(marker,'utf8').catch(()=>'') !== requirementsHash) {
    run(python,['-m','pip','install','-r',requirements]);
    await writeFile(marker,requirementsHash);
  }
}, {timeout:300000});
function run(command:string, args:string[], env = process.env) {
  const result = spawnSync(command,args,{encoding:'utf8',timeout:240000,env});
  assert.equal(result.status,0,result.stderr + result.stdout);
  return result.stdout + result.stderr;
}
const hash = (bytes:Buffer) => createHash('sha256').update(bytes).digest('hex');

test('a storyboard score delivers frame-aligned hits, measured loudness, and repeatable WAV bytes', {timeout:240000}, async () => {
  const root = await mkdtemp(join(tmpdir(),'motion-score-'));
  try {
    const film = join(root,'film');
    // Extend the authoritative empty board without touching a user's HOME.
    const {emptyStoryboard} = await import('../src/project.ts');
    await mkdir(film);
    // A 6-second film at 30 fps. Reveal at 2 s, UI at 3 s, logo at 4 s, all on a 120 BPM grid.
    const board = {...emptyStoryboard(),meta:{...emptyStoryboard().meta,fps:30,durationFrames:180},audio:{...emptyStoryboard().audio,bpm:120,beatFrames:Array.from({length:12},(_,i)=>i*15),downbeatFrames:[0,60,120],dropFrames:[60]},shots:[{id:'s01',startFrame:0,endFrame:180,engine:'hyperframes',entrypoint:'shots/s01/index.html',description:'fixture',camera:'custom:push',entry:'cut',exit:'cut',assets:[],stillFrames:[],protected:[],soundCues:[{asset:'impact',eventFrame:60,peakOffsetFrames:0},{asset:'click',eventFrame:90,peakOffsetFrames:0},{asset:'logo',eventFrame:120,peakOffsetFrames:0}]}]};
    await writeFile(join(film,'ledger.json'),JSON.stringify({version:'0',assets:[]}));
    await writeFile(join(film,'storyboard.json'),JSON.stringify(board));
    await writeFile(join(film,'beatmap.md'),'# Beat contract\nReveal: frame 60. UI: frame 90. Logo: frame 120.\n');
    const args = [script,film,'--seed','51','--reveal-frame','60','--logo-frame','120','--sfx-density','0'];
    run(python,[...args,'--out',join(film,'audio/scores/a')]);
    run(python,[...args,'--out',join(film,'audio/scores/b')]);
    const report = JSON.parse(await readFile(join(film,'audio/scores/a/audio-report.json'),'utf8'));
    assert.equal(report.passed,true);
    const decode = (file:string) => {
      const result = spawnSync('ffmpeg',['-v','error','-i',join(film,'audio/scores/a',file),'-f','f32le','-ac','2','-ar','48000','-'],{maxBuffer:10_000_000});
      assert.equal(result.status,0);
      return new Float32Array(new Uint8Array(result.stdout).buffer);
    };
    const dry = new Float64Array(decode('drums.wav'));
    for (const file of ['bass.wav','harmony.wav','texture.wav']) {
      const stem = decode(file);
      for (let i=0;i<dry.length;i++) dry[i] += stem[i];
    }
    const stereoSamples = (seconds:number) => Math.round(seconds*48000*2);
    const rms = (samples:Float32Array|Float64Array) => Math.sqrt(samples.reduce((sum,v)=>sum+v*v,0)/samples.length);
    // Fixture: a two-beat musical dropout at 120 BPM before the reveal at 2 s.
    assert.ok(dry.slice(stereoSamples(1),stereoSamples(2)).every(v=>Math.abs(v)<1e-6));
    const rise = decode('anticipation.wav').slice(stereoSamples(1.9),stereoSamples(2));
    const bed = dry.slice(stereoSamples(2),stereoSamples(2.5));
    const relativeDb = 20*Math.log10(rms(rise)/rms(bed));
    assert.ok(relativeDb>=-6,`delivered riser ${relativeDb} dB below bed`);
    assert.equal(report.arrangement.cadence.dominantRootMidi,69);
    assert.equal(report.arrangement.cadence.tonicMidi,62);
    assert.deepEqual(report.hits.map((hit:{kind:string})=>hit.kind),['reveal','click','logo']);
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
    // Exercise bundled-stock layering in a scratch HOME. These are generated test doubles, not distributed Pixabay files.
    const home = join(root,'home');
    const bundle = join(home,'.agents/skills/media-use/audio/assets/sfx');
    await mkdir(bundle,{recursive:true});
    for (const name of ['impact-bass-1','click-soft']) run('ffmpeg',['-v','error','-f','lavfi','-i','sine=frequency=440:duration=0.2','-y',join(bundle,name+'.mp3')]);
    run(python,[...args.slice(0,-2),'--out',join(film,'audio/scores/stock')],{...process.env,HOME:home});
    const stock = JSON.parse(await readFile(join(film,'audio/scores/stock/audio-report.json'),'utf8'));
    assert.equal(stock.passed,true);
    assert.equal(stock.hits[0].sources.length,1);
    assert.equal(stock.hits[1].sources.length,1);
    assert.deepEqual(stock.hits[2].sources,[]);
    assert.equal(stock.files.find((file:{file:string})=>file.file==='hit-02-logo.wav').license,'synthesized original');
    assert.equal(stock.files.find((file:{file:string})=>file.file==='score.wav').license,'synthesized original + Pixabay Content License');
    const sourceFiles = await import('node:fs/promises').then(fs=>fs.readdir(join(film,'audio/scores/stock')));
    assert.ok(!sourceFiles.some(file=>file.endsWith('.mp3')));

    // Rejected imports leave both state files unchanged.
    const reportPath = join(film,'audio/scores/a/audio-report.json');
    const ledgerBefore = await readFile(join(film,'ledger.json'));
    const boardBefore = await readFile(join(film,'storyboard.json'));
    const hitPath = join(film,'audio/scores/a',report.hits[0].file);
    const hitBefore = await readFile(hitPath);
    await writeFile(hitPath,Buffer.from('changed audio'));
    const refused = spawnSync('node',[resolve('dist/cli.js'),'score-import',film,reportPath,'--id','bad'],{encoding:'utf8',timeout:60000});
    assert.equal(refused.status,1);
    assert.ok(refused.stderr.includes(`score file changed: ${report.hits[0].file}`));
    assert.deepEqual(await readFile(join(film,'ledger.json')),ledgerBefore);
    assert.deepEqual(await readFile(join(film,'storyboard.json')),boardBefore);
    await writeFile(hitPath,hitBefore);
    const contractBefore = await readFile(join(film,'beatmap.md'));
    await writeFile(join(film,'beatmap.md'),'changed contract');
    const stale = spawnSync('bun',[resolve('dist/cli.js'),'score-import',film,reportPath,'--id','stale'],{encoding:'utf8',timeout:60000});
    assert.equal(stale.status,1);
    assert.match(stale.stderr,/score report is stale: beatmap.md changed/);
    assert.deepEqual(await readFile(join(film,'ledger.json')),ledgerBefore);
    await writeFile(join(film,'beatmap.md'),contractBefore);
    // The CLI imports every WAV into the real ledger, uses music as bed, and keeps SFX separate for mix.
    for (const runtime of ['node','bun']) {
      run(runtime,[resolve('dist/cli.js'),'score-import',film,join(film,'audio/scores/a/audio-report.json'),'--id',runtime]);
      const imported = JSON.parse(await readFile(join(film,'storyboard.json'),'utf8'));
      const ledger = JSON.parse(await readFile(join(film,'ledger.json'),'utf8'));
      assert.equal(imported.audio.track,`${runtime}-music`);
      assert.equal(imported.shots[0].soundCues.length,3);
      assert.equal(imported.shots[0].soundCues[2].asset,`${runtime}-hit-02-logo`);
      assert.equal(ledger.assets.filter((asset:{id:string})=>asset.id.startsWith(runtime+'-')).length,report.files.length);
      // A synthetic picture exercises the real CLI mix without running a browser engine.
      const output = join(film,'renders/16x9');
      await mkdir(output,{recursive:true});
      await mkdir(join(film,'shots/s01'),{recursive:true});
      await writeFile(join(film,'shots/s01/index.html'),'<!doctype html>');
      run('ffmpeg',['-v','error','-y','-f','lavfi','-i','color=c=black:s=1920x1080:r=30:d=6','-vf','setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709','-c:v','ffv1','-pix_fmt','yuv444p',join(output,'master.mkv')]);
      await writeFile(join(output,'render.json'),'{}');
      run(runtime,[resolve('dist/cli.js'),'mix',film]);
      const sync = JSON.parse(await readFile(join(output,'sync.json'),'utf8'));
      assert.ok(Math.abs(sync.integratedLufs+14)<=.5);
      assert.ok(sync.truePeakDbtp<=-1);
      assert.equal(sync.sfx.length,3);
      // Restore the exact input bytes for the second runtime. Import changes the board, not the score's source record.
      await writeFile(join(film,'storyboard.json'),JSON.stringify(board));
    }
  } finally {
    run('trash',[root]);
  }
});


test('cue vocabulary selects distinct voices; palettes and density change decoded stems', {timeout:180000}, async () => {
  const root = await mkdtemp(join(tmpdir(),'motion-score-palettes-'));
  try {
  const output = run(python,['-B','-c',`
import sys, json, hashlib
from types import SimpleNamespace
import numpy as np
sys.path.insert(0, ${JSON.stringify(resolve('../skills/motion-score/scripts'))})
from arranger import cue_kind, arrange, hit, PALETTES
import instruments as synth
from pathlib import Path
from score import render, decode
shot = {'id':'a', 'startFrame':0, 'endFrame':180, 'description':'', 'entry':'handoff', 'transition':'whip-pan', 'camera':'push'}
assert cue_kind({**shot, 'description':'key UI events'}, {'asset':'ui-click','eventFrame':45},60,120) == 'click'
ui_kinds = [cue_kind({**shot, 'description':'Product UI dashboard typing'}, {'asset':asset, 'eventFrame':30},60,120) for asset in ('whoosh-fast','whip','arrival','ui-click','ui-type')]
kinds = [cue_kind(shot, {'asset':asset, 'eventFrame':frame},60,120) for asset,frame in [('planned-camera',0),('planned-arrival',30),('ui-click',45),('ui-type',75),('reveal',60),('logo',120)]]
voices = [hit(kind,62,PALETTES['warm'],np.random.default_rng(51)) for kind in kinds]
board = {'meta':{'fps':30,'durationFrames':180},'audio':{'bpm':120,'beatFrames':list(range(0,180,15)),'downbeatFrames':[],'dropFrames':[]},'shots':[{**shot,'soundCues':[{'asset':'planned','eventFrame':f,'peakOffsetFrames':0} for f in (60,90,120)]}]}
measurements = {}
for palette, density in [('warm','normal'),('bright','normal'),('dark','normal'),('bright','sparse')]:
    args = SimpleNamespace(palette=palette,density=density,reveal_frame=60,logo_frame=120,tonic_midi=62,dropout_beats=2,riser_beats=2)
    args.seed=51; args.eq_hz=10000; args.sfx_density=0
    out = Path(sys.argv[1]) / (palette+'-'+density)
    out.mkdir()
    render(board,args,out)
    texture = decode(out/'texture.wav')
    harmony = decode(out/'harmony.wav')[:,2*48000:3*48000].mean(axis=0)
    spectrum = np.abs(np.fft.rfft(harmony))**2
    frequencies = np.fft.rfftfreq(len(harmony),1/48000)
    measurements[palette+'-'+density] = {'leadRms':float(np.sqrt(np.mean(texture**2))), 'leadPeak':float(np.max(np.abs(texture))), 'harmonyCentroid':float(np.sum(frequencies*spectrum)/np.sum(spectrum))}
# D minor fixture: i(add9), iv(add9), bVI(add9), V(b9), then i at the logo.
dark_args = SimpleNamespace(palette='dark',density='normal',reveal_frame=120,logo_frame=240,tonic_midi=62,dropout_beats=2,riser_beats=2)
_, dark_plan = arrange({'meta':{'fps':30,'durationFrames':300}},dark_args,15,list(range(0,300,15)),np.random.default_rng(51))
expected_chime = np.concatenate([synth.pluck(note,.03,bell=True)*.2 for note in (74,77,81)])
chime_matches = np.allclose(hit('type',62,PALETTES['dark'],np.random.default_rng(51)),expected_chime)
print(json.dumps({'darkChords':[c['notes'] for c in dark_plan['chords']], 'darkChimeMatches':bool(chime_matches), 'uiKinds':ui_kinds,'kinds':kinds,'lengths':[v.shape[-1] for v in voices],'hashes':[hashlib.sha256(v.tobytes()).hexdigest() for v in voices], 'measurements':measurements}))
`,root]);
  const result = JSON.parse(output);
  assert.deepEqual(result.darkChords,[[50,53,57,64],[55,58,62,69],[58,62,65,72],[57,61,64,70]]);
  assert.equal(result.darkChimeMatches,true);
  assert.deepEqual(result.uiKinds,['motion','motion','arrival','click','type']);
  assert.deepEqual(result.kinds,['motion','arrival','click','type','reveal','logo']);
  assert.equal(new Set(result.hashes).size,6);
  assert.ok(result.lengths[0]>result.lengths[2]);
  assert.equal(result.lengths[2],4320); // Requirement: 90 ms UI click at 48 kHz.
  const audio = result.measurements;
  assert.notEqual(audio['bright-normal'].leadRms,audio['warm-normal'].leadRms);
  assert.ok(audio['bright-normal'].leadRms>audio['bright-sparse'].leadRms);
  assert.equal(audio['dark-normal'].leadPeak,0);
  assert.ok(audio['bright-normal'].harmonyCentroid>audio['warm-normal'].harmonyCentroid);
  } finally {run('trash',[root]);}
});

test('score import preserves the approved G2 grid, including rounded BPM and empty annotations', {timeout:180000}, async () => {
  const root = await mkdtemp(join(tmpdir(),'motion-score-g2-'));
  try {
    const {emptyStoryboard} = await import('../src/project.ts');
    const board = emptyStoryboard();
    board.meta.durationFrames = 204;
    board.audio = {...board.audio,grid:'corrected',bpm:105.9,beatFrames:Array.from({length:12},(_,i)=>i*17),downbeatFrames:[],dropFrames:[],confidence:'low'};
    board.shots = [{id:'s01',startFrame:0,endFrame:204,engine:'hyperframes',entrypoint:'shots/s01/index.html',description:'fixture',camera:'locked',entry:'cut',exit:'cut',assets:[],stillFrames:[],protected:[],soundCues:[68,102,136].map(eventFrame=>({asset:'planned',eventFrame,peakOffsetFrames:0}))}];
    await writeFile(join(root,'storyboard.json'),JSON.stringify(board));
    await writeFile(join(root,'ledger.json'),JSON.stringify({version:'0',assets:[]}));
    await writeFile(join(root,'BRIEF.md'),'# G2 grid fixture');
    await writeFile(join(root,'beatmap.md'),'# Fixture: 17 frames per beat; no downbeats or drops declared.');
    run('node',[resolve('dist/cli.js'),'gate',root,'G1','approve']);
    run('node',[resolve('dist/cli.js'),'gate',root,'G2','approve']);
    const before = JSON.parse(await readFile(join(root,'storyboard.json'),'utf8'));
    const out = join(root,'audio/scores/g2');
    run(python,[script,root,'--out',out,'--seed','51','--reveal-frame','68','--logo-frame','136','--sfx-density','0']);
    run('node',[resolve('dist/cli.js'),'score-import',root,join(out,'audio-report.json'),'--id','g2']);
    const after = JSON.parse(await readFile(join(root,'storyboard.json'),'utf8'));
    assert.deepEqual(after.audio,{...before.audio,track:'g2-music'});
    assert.deepEqual(after.gates[1],before.gates[1]);
    assert.match(run('node',[resolve('dist/cli.js'),'status',root]),/^G2 approved$/m);
  } finally {run('trash',[root]);}
});
