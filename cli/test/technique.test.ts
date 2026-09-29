import {test as nodeTest} from 'node:test';
const {expect} = await import('bun' in process.versions ? 'bun:test' : 'expect');
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';

const test = (name:string, fn:()=>Promise<void>, timeout=900000) => nodeTest(name,{timeout},fn);
const here = dirname(fileURLToPath(import.meta.url));
const cli = resolve(here,'../dist/cli.js');
const fixture = resolve(here,'../fixtures/technique');
const hfBin = resolve(here,'../node_modules/hyperframes/bin/hyperframes.mjs');
// Each test runner checks the CLI under its own runtime; npm test runs both runners.
const runtime = 'bun' in process.versions ? 'bun' : 'node';
const run = (...args:string[]) => spawnSync(runtime,[cli,...args],{encoding:'utf8',timeout:600000,input:''});
const json = async (file:string) => JSON.parse(await readFile(file,'utf8'));
async function withFilm(fn:(dir:string)=>Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(),'motion-studio-technique-'));
  try {
    await cp(fixture,dir,{recursive:true,filter:src => !src.endsWith('/renders')});
    await fn(dir);
  } finally {await rm(dir,{recursive:true,force:true});}
}

// fixtures/technique: one 16:9 160x90 format at 30 fps. hf3d (HyperFrames, frames 0-5) turns a lit three.js solid
// from a paused GSAP timeline, splits its title with SplitText and swaps two blocks with Flip; it loads GSAP and three
// from vendor/. r3d (Remotion, frames 6-11) turns the solid in a ThreeCanvas from useCurrentFrame. rnoise (Remotion,
// frames 12-17) drifts dots with @remotion/noise. hf3d and r3d declare threeD; rnoise does not.
const hfEntry = 'shots/hf3d/index.html';
const r3dEntry = 'shots/r3d/src/index.tsx';
const noiseEntry = 'shots/rnoise/src/index.tsx';

test(`${runtime}: validate accepts the declared 3D fixture and rejects each banned call, a network script and an undeclared three.js import`, async () => withFilm(async dir => {
  const valid = run('validate',dir);
  expect(valid.stderr).toBe('');
  expect(valid.status).toBe(0);

  // The CLI-provided vendor/ folder is not an author source: pinned GSAP itself reads clocks, and that must not count.
  await mkdir(join(dir,'shots/hf3d/vendor'));
  await cp(resolve(here,'../node_modules/gsap/dist/gsap.min.js'),join(dir,'shots/hf3d/vendor/gsap.min.js'));
  expect(await readFile(join(dir,'shots/hf3d/vendor/gsap.min.js'),'utf8')).toContain('requestAnimationFrame');
  expect(run('validate',dir).status).toBe(0);
  // Any other file in vendor/ is author code and is scanned.
  await writeFile(join(dir,'shots/hf3d/vendor/helper.js'),'export const t = () => Date.now();\n');
  const hidden = run('validate',dir);
  expect(hidden.status).toBe(1);
  expect(hidden.stderr).toContain('shot hf3d: shots/hf3d/vendor/helper.js:1 uses Date.now;');
  await rm(join(dir,'shots/hf3d/vendor/helper.js'));

  const noise = await readFile(join(dir,noiseEntry),'utf8');
  const html = await readFile(join(dir,hfEntry),'utf8');
  const bans:[string,string,string][] = [
    ['useFrame',noiseEntry,noise.replace('// Seeded noise','import {useFrame} from \'@react-three/fiber\';\n// Seeded noise')],
    ['requestAnimationFrame',hfEntry,html.replace('document.fonts.ready','requestAnimationFrame(draw);\ndocument.fonts.ready')],
    ['Date.now',noiseEntry,noise.replace('frame * 0.2) * 12}}','Date.now() * 0.2) * 12}}')],
    ['performance.now',hfEntry,html.replace('tl.time(0);','tl.time(performance.now() / 1000);')],
    ['three Clock',hfEntry,html.replace('const state =','const clock = new THREE.Clock();\nconst state =')],
    ['Math.random',noiseEntry,noise.replace("noise2D('drift-x', i, frame * 0.2)","Math.random()")],
  ];
  for (const [name,file,text] of bans) {
    const original = await readFile(join(dir,file),'utf8');
    await writeFile(join(dir,file),text);
    const result = run('validate',dir);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`uses ${name};`);
    expect(result.stderr.split('\n').filter(l => l.startsWith('error:')).length).toBe(name === 'useFrame' ? 2 : 1);
    await writeFile(join(dir,file),original);
  }

  await writeFile(join(dir,hfEntry),html.replace('<script src="vendor/gsap.min.js"></script>','<script src="https://cdn.jsdelivr.net/npm/gsap@3.15.0/dist/gsap.min.js"></script>'));
  const cdn = run('validate',dir);
  expect(cdn.status).toBe(1);
  expect(cdn.stderr).toContain('error: shot hf3d: shots/hf3d/index.html:3 loads a script or asset from the network');
  await writeFile(join(dir,hfEntry),html);

  // Removing r3d's declaration leaves its @remotion/three import undeclared.
  const storyboard = await json(join(dir,'storyboard.json'));
  delete storyboard.shots[1].threeD;
  await writeFile(join(dir,'storyboard.json'),JSON.stringify(storyboard));
  const undeclared = run('validate',dir);
  expect(undeclared.status).toBe(1);
  expect(undeclared.stderr).toContain(`error: shot r3d: ${r3dEntry}:3 imports three.js but the storyboard does not declare 3D for this shot`);
  expect(undeclared.stderr.split('\n').filter(l => l.startsWith('error:')).length).toBe(1);
}));

test(`${runtime}: the HyperFrames fixture passes hyperframes lint and references no network URL`, async () => {
  const html = await readFile(join(fixture,hfEntry),'utf8');
  expect(html).not.toMatch(/(?:https?:)?\/\/[a-z0-9.-]+\.[a-z]{2,}/i);
  for (const lib of ['vendor/gsap.min.js','vendor/SplitText.min.js','vendor/Flip.min.js','./vendor/three.module.min.js']) expect(html).toContain(lib);
  const lint = spawnSync('node',[hfBin,'lint',join(fixture,'shots/hf3d'),'--json'],{encoding:'utf8',timeout:120000,input:''});
  expect(lint.status).toBe(0);
  const findings = JSON.parse(lint.stdout.slice(lint.stdout.indexOf('{')));
  expect(findings.errorCount).toBe(0);
  expect(findings.warningCount).toBe(0);
});

/** One MD5 per decoded frame of a clip. */
function frameMd5s(clip:string):string[] {
  const out = spawnSync('ffmpeg',['-loglevel','error','-i',clip,'-f','framemd5','-'],{encoding:'utf8'}).stdout;
  return out.split('\n').filter(l => l && !l.startsWith('#')).map(l => l.split(',').at(-1)!.trim());
}

test(`${runtime}: render draws 3D, GSAP plugins and noise in both engines and records the GL backend; repro matches 3D shots and fails a nondeterministic one`, async () => withFilm(async dir => {
  const render = run('render',dir);
  expect(render.stderr).not.toContain('error:');
  expect(render.status).toBe(0);
  const marker = await json(join(dir,'renders/16x9/render.json'));
  expect(marker.renderer).toEqual({remotionGl:process.platform === 'darwin' ? 'angle' : 'swangle', hyperframesGpu:'auto'});
  // Every shot moves: its first and last frames differ (a blank or failed canvas would give identical frames).
  for (const shot of ['hf3d','r3d','rnoise']) {
    const md5 = frameMd5s(join(dir,'renders/16x9/shots',`${shot}.mkv`));
    expect(md5.length).toBe(6);
    expect(md5[0]).not.toBe(md5[5]);
  }
  // The CLI adds vendor/ to the staged copy only; the author's shot folder stays as written.
  expect((await readdir(join(dir,'shots/hf3d'))).sort()).toEqual(['index.html']);

  for (const shot of ['hf3d','r3d']) {
    const repro = run('repro',dir,shot);
    expect(repro.stderr).toBe('');
    expect(repro.status).toBe(0);
    const report = await json(join(dir,'renders/16x9',`repro-${shot}.json`));
    expect(report.status).toBe('match');
    expect(report.runs[0].length).toBe(6);
    expect(report.runs[1]).toEqual(report.runs[0]);
  }

  // random(null) is Remotion's unseeded randomness: it passes the text guard but differs on every render.
  const noise = await readFile(join(dir,noiseEntry),'utf8');
  await writeFile(join(dir,noiseEntry),noise.replace("import {noise2D} from '@remotion/noise';","import {noise2D} from '@remotion/noise';\nimport {random} from 'remotion';").replace("noise2D('drift-x', i, frame * 0.2) * 12","random(null) * 100"));
  expect(run('validate',dir).status).toBe(0);
  const drift = run('repro',dir,'rnoise','16:9');
  expect(drift.status).toBe(1);
  expect(drift.stderr).toContain('error: repro rnoise 16:9: 6 of 6 frames differ between two renders');
  const report = await json(join(dir,'renders/16x9/repro-rnoise.json'));
  expect(report.status).toBe('mismatch');
  expect(report.mismatchedFrames).toEqual([0,1,2,3,4,5]);
}));
