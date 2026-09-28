import {test as nodeTest} from 'node:test';
const {expect} = await import('bun' in process.versions ? 'bun:test' : 'expect');
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chmod, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';

const test = (name:string, fn:()=>Promise<void>, timeout=180000) => nodeTest(name,{timeout},fn);
const here = dirname(fileURLToPath(import.meta.url));
const cli = resolve(here,'../dist/cli.js');
const which = (bin:string) => spawnSync('which',[bin],{encoding:'utf8'}).stdout.trim();
// Absolute runtime paths, so a test PATH without them still starts the CLI.
const runtimes = [which('node'),which('bun')];
const run = (runtime:string, args:string[], env:NodeJS.ProcessEnv = process.env, cwd?:string) => spawnSync(runtime,[cli,...args],{encoding:'utf8',timeout:120000,env,cwd});
const sha = (data:string|Buffer) => createHash('sha256').update(data).digest('hex');
const PROVIDER_ENV = 'MOTION_STUDIO_IMAGE_PROVIDER';

async function withFilm(fn:(dir:string, film:string)=>Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(),'motion-studio-assets-'));
  try {
    const init = run(runtimes[0],['init','film'],process.env,dir);
    expect(init.status).toBe(0);
    await fn(dir,join(dir,'films','film'));
  } finally {await rm(dir,{recursive:true,force:true});}
}
async function script(path:string, body:string) {
  await writeFile(path,`#!/bin/sh\n${body}\n`);
  await chmod(path,0o755);
  return path;
}
/**
 * A local fake image provider. `resolve` writes `image.png` holding `PNG:<intent>` into --out, then acts on FAKE_MODE:
 * ok prints a valid reply; fail exits 1; badjson prints non-JSON; noname claims a known license without a name;
 * ghost names a file it did not write; escape names a path outside --out.
 */
const fakeProvider = (dir:string) => script(join(dir,'provider'),`
case "$1" in
  ready) echo "token=provider-secret-42"; exit "\${FAKE_READY:-0}";;
  resolve) shift;;
  *) exit 64;;
esac
while [ $# -gt 0 ]; do
  case "$1" in --type) type=$2;; --intent) intent=$2;; --out) out=$2;; esac
  shift 2
done
printf 'PNG:%s' "$intent" > "$out/image.png"
case "$FAKE_MODE" in
  ok) echo "{\\"file\\":\\"image.png\\",\\"sourceUrlOrGenerator\\":\\"fake-model v1: $intent\\",\\"providerAssetId\\":\\"gen-7\\",\\"license\\":{\\"status\\":\\"known\\",\\"name\\":\\"provider terms\\",\\"evidence\\":\\"fake terms page\\"}}";;
  fail) echo "quota exceeded" >&2; exit 1;;
  badjson) echo "not json";;
  noname) echo '{"file":"image.png","sourceUrlOrGenerator":"fake","providerAssetId":null,"license":{"status":"known","name":null,"evidence":"x"}}';;
  ghost) echo '{"file":"other.png","sourceUrlOrGenerator":"fake","providerAssetId":null,"license":{"status":"unknown","name":null,"evidence":"x"}}';;
  escape) echo '{"file":"../ledger.json","sourceUrlOrGenerator":"fake","providerAssetId":null,"license":{"status":"unknown","name":null,"evidence":"x"}}';;
esac`);

test('assets add records website, code and data files and lists them with rights and file state', async () => {
  for (const runtime of runtimes) await withFilm(async (dir,film) => {
    // A captured screenshot outside the film is copied to assets/<id><ext>.
    const outside = join(dir,'capture.png');
    await writeFile(outside,'screenshot-bytes');
    const added = run(runtime,['assets',film,'add','hero-shot','--file',outside,'--type','screenshot','--source-kind','website','--source','https://example.com/pricing','--license','unknown','--evidence','captured 2026-09-28; site terms not checked','--shot','intro','--shot','outro']);
    expect(added.stderr).toBe('');
    expect(added.status).toBe(0);
    expect(await readFile(join(film,'assets','hero-shot.png'),'utf8')).toBe('screenshot-bytes');
    expect(await readFile(outside,'utf8')).toBe('screenshot-bytes');
    // Files already inside the film are recorded in place.
    await writeFile(join(film,'assets','grain.svg'),'<svg/>');
    await mkdir(join(film,'data'));
    await writeFile(join(film,'data','users.csv'),'month,users\n2026-08,1200\n');
    expect(run(runtime,['assets',film,'add','grain','--file',join(film,'assets','grain.svg'),'--type','texture','--source-kind','code','--source','hand-written SVG','--license','known','--license-name','CC0-1.0','--evidence','made for this film']).status).toBe(0);
    expect(run(runtime,['assets',film,'add','users','--file',join(film,'data','users.csv'),'--type','data','--source-kind','data','--source','https://example.com/metrics.csv','--license','restricted','--evidence','retrieved 2026-09-28, field users','--provider-asset-id','metrics-v3','--shot','intro']).status).toBe(0);
    const ledger = JSON.parse(await readFile(join(film,'ledger.json'),'utf8'));
    expect(ledger).toEqual({version:'0', assets:[
      {id:'hero-shot', type:'screenshot', sourceKind:'website', sourceUrlOrGenerator:'https://example.com/pricing', providerAssetId:null, license:{status:'unknown', name:null, evidence:'captured 2026-09-28; site terms not checked'}, localPath:'assets/hero-shot.png', sha256:sha('screenshot-bytes'), shots:['intro','outro']},
      {id:'grain', type:'texture', sourceKind:'code', sourceUrlOrGenerator:'hand-written SVG', providerAssetId:null, license:{status:'known', name:'CC0-1.0', evidence:'made for this film'}, localPath:'assets/grain.svg', sha256:sha('<svg/>'), shots:[]},
      {id:'users', type:'data', sourceKind:'data', sourceUrlOrGenerator:'https://example.com/metrics.csv', providerAssetId:'metrics-v3', license:{status:'restricted', name:null, evidence:'retrieved 2026-09-28, field users'}, localPath:'data/users.csv', sha256:sha('month,users\n2026-08,1200\n'), shots:['intro']},
    ]});
    expect(run(runtime,['validate',film]).status).toBe(0);
    const listed = run(runtime,['assets',film,'list']);
    expect(listed.status).toBe(0);
    expect(listed.stdout.split('\n')).toEqual([
      `hero-shot: screenshot, website https://example.com/pricing, license unknown (evidence: captured 2026-09-28; site terms not checked), path assets/hero-shot.png, sha256 ${sha('screenshot-bytes')}, shots intro outro, file ok`,
      `grain: texture, code hand-written SVG, license known CC0-1.0 (evidence: made for this film), path assets/grain.svg, sha256 ${sha('<svg/>')}, shots none, file ok`,
      `users: data, data https://example.com/metrics.csv, provider id metrics-v3, license restricted (evidence: retrieved 2026-09-28, field users), path data/users.csv, sha256 ${sha('month,users\n2026-08,1200\n')}, shots intro, file ok`,
      'unresolved rights: hero-shot (unknown), users (restricted)',
      '',
    ]);

    // Altered and missing files: list shows the state, validate fails on path and hash.
    await writeFile(join(film,'assets','hero-shot.png'),'edited');
    await rm(join(film,'assets','grain.svg'));
    const after = run(runtime,['assets',film,'list']).stdout.split('\n');
    expect(after[0].endsWith(', file altered')).toBe(true);
    expect(after[1].endsWith(', file missing')).toBe(true);
    expect(after[2].endsWith(', file ok')).toBe(true);
    const invalid = run(runtime,['validate',film]);
    expect(invalid.status).toBe(1);
    expect(invalid.stderr).toContain(`error: ledger asset hero-shot: sha256 of assets/hero-shot.png is ${sha('edited')}, ledger records ${sha('screenshot-bytes')}`);
    expect(invalid.stderr).toContain('error: ledger asset grain: file assets/grain.svg not found');
  });
});

test('assets add refuses bad entries without changing the ledger or leaving a file', async () => {
  for (const runtime of runtimes) await withFilm(async (dir,film) => {
    const outside = join(dir,'logo.svg');
    await writeFile(outside,'<svg id="logo"/>');
    const base = ['--file',outside,'--type','logo','--source-kind','website','--source','https://example.com','--evidence','press kit page'];
    expect(run(runtime,['assets',film,'add','logo',...base,'--license','unknown']).status).toBe(0);
    const ledger = await readFile(join(film,'ledger.json'),'utf8');
    const refusals:[string[],string][] = [
      [['add','logo',...base,'--license','unknown'],'error: assets: id logo is already in ledger.json'],
      [['add','logo-2',...base,'--license','known'],'error: ledger.json /assets/1/license: a known license needs a non-empty name'],
      [['add','logo-3',...base,'--license','public'],'error: assets: --license must be one of known, unknown, restricted'],
      [['add','logo-4',...base.slice(0,4),'--source-kind','scraped','--source','x','--evidence','x','--license','unknown'],'error: assets: --source-kind must be one of heygen, website, stock, code, ai-image, data, video-model'],
      [['add','logo-5',...base.filter(a => a !== '--evidence' && a !== 'press kit page'),'--license','unknown'],'error: assets: --evidence is required'],
      [['add','bad id',...base,'--license','unknown'],'error: ledger.json /assets/1/id: must match pattern'],
      [['add','logo-6','--file',join(dir,'missing.svg'),...base.slice(2),'--license','unknown'],`error: assets: file ${join(dir,'missing.svg')} not found`],
      [['list','extra'],'error: usage: motion-studio assets <film-dir> list'],
    ];
    for (const [args,message] of refusals) {
      const result = run(runtime,['assets',film,...args]);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(message);
      expect(await readFile(join(film,'ledger.json'),'utf8')).toBe(ledger);
      expect((await readdir(join(film,'assets'))).sort()).toEqual(['logo.svg']);
    }
  });
});

test('assets resolve freezes a provider file and records its provenance', async () => {
  for (const runtime of runtimes) await withFilm(async (dir,film) => {
    const provider = await fakeProvider(dir);
    const env = {...process.env, [PROVIDER_ENV]:provider, FAKE_MODE:'ok'};
    const result = run(runtime,['assets',film,'resolve','texture-1','--provider','image','--type','texture','--intent','warm paper grain','--shot','intro'],env);
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(result.stdout).toBe(`added texture-1: texture, ai-image fake-model v1: warm paper grain, provider id gen-7, license known provider terms (evidence: fake terms page), path assets/texture-1.png, sha256 ${sha('PNG:warm paper grain')}, shots intro, file ok\n`);
    expect(JSON.parse(await readFile(join(film,'ledger.json'),'utf8')).assets).toEqual([
      {id:'texture-1', type:'texture', sourceKind:'ai-image', sourceUrlOrGenerator:'fake-model v1: warm paper grain', providerAssetId:'gen-7', license:{status:'known', name:'provider terms', evidence:'fake terms page'}, localPath:'assets/texture-1.png', sha256:sha('PNG:warm paper grain'), shots:['intro']},
    ]);
    expect(await readFile(join(film,'assets','texture-1.png'),'utf8')).toBe('PNG:warm paper grain');
    expect((await readdir(film)).filter(f => f.startsWith('.'))).toEqual([]);
    expect(run(runtime,['validate',film]).status).toBe(0);
  });
});

test('a provider failure leaves no ledger entry, no asset file and no staging folder', async () => {
  for (const runtime of runtimes) await withFilm(async (dir,film) => {
    const provider = await fakeProvider(dir);
    const ledger = await readFile(join(film,'ledger.json'),'utf8');
    const args = ['assets',film,'resolve','texture-1','--provider','image','--type','texture','--intent','grain'];
    const failures:[NodeJS.ProcessEnv,string][] = [
      [{[PROVIDER_ENV]:provider, FAKE_MODE:'fail'},'error: image provider failed: exited 1 (quota exceeded)'],
      [{[PROVIDER_ENV]:provider, FAKE_MODE:'badjson'},'error: image provider printed invalid JSON'],
      [{[PROVIDER_ENV]:provider, FAKE_MODE:'noname'},'error: ledger.json /assets/0/license: a known license needs a non-empty name'],
      [{[PROVIDER_ENV]:provider, FAKE_MODE:'ghost'},'error: image provider: file other.png was not written'],
      [{[PROVIDER_ENV]:provider, FAKE_MODE:'escape'},'error: image provider: "file" must be a file name inside the output folder, got ../ledger.json'],
      [{[PROVIDER_ENV]:join(dir,'no-such-provider')},'error: image provider failed: not found'],
      [{[PROVIDER_ENV]:''},'error: assets: provider image is not configured (configured: none); run motion-studio doctor'],
    ];
    for (const [extra,message] of failures) {
      const result = run(runtime,args,{...process.env, ...extra});
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(message);
      expect(await readFile(join(film,'ledger.json'),'utf8')).toBe(ledger);
      expect(await readdir(join(film,'assets'))).toEqual([]);
      expect((await readdir(film)).filter(f => f.startsWith('.'))).toEqual([]);
    }
  });
});

/** A bin folder with the real node, ffmpeg and ffprobe (unless left out) and an optional fake heygen. */
async function toolDir(dir:string, {ffmpeg = true, heygen}:{ffmpeg?:boolean; heygen?:{version:string; authCode:number}}) {
  const bin = join(dir,'bin');
  await mkdir(bin);
  for (const tool of ffmpeg ? ['node','ffmpeg','ffprobe'] : ['node','ffprobe']) await symlink(which(tool),join(bin,tool));
  if (heygen) await script(join(bin,'heygen'),`
case "$1" in
  --version) echo "heygen version v${heygen.version}";;
  auth) echo '{"credential":{"type":"oauth","expires_in_seconds":172805,"access_token":"heygen-secret-token"},"data":{"email":"someone@example.com"}}'; exit ${heygen.authCode};;
esac`);
  return bin;
}

test('doctor reports tools, heygen and the image provider without printing secrets', async () => {
  const dir = await mkdtemp(join(tmpdir(),'motion-studio-doctor-'));
  try {
    const provider = await fakeProvider(dir);
    const cases:{name:string; tools:Parameters<typeof toolDir>[1]; env:NodeJS.ProcessEnv; status:number; expected:string[]}[] = [
      {name:'ready', tools:{heygen:{version:'0.8.1', authCode:0}}, env:{[PROVIDER_ENV]:provider}, status:0,
        expected:['heygen: ok, v0.8.1, signed in (oauth, expires in 2 days)','image provider: ok, ready']},
      {name:'old heygen', tools:{heygen:{version:'0.2.9', authCode:0}}, env:{}, status:0,
        expected:['heygen: unavailable (optional), version 0.2.9 is older than 0.3.0',`image provider: unavailable (optional), not configured (set ${PROVIDER_ENV} to a provider command)`]},
      {name:'signed out', tools:{heygen:{version:'0.3.0', authCode:1}}, env:{[PROVIDER_ENV]:provider, FAKE_READY:'3'}, status:0,
        expected:['heygen: unavailable (optional), v0.3.0, not signed in ("heygen auth status" exited 1); run heygen auth login',`image provider: unavailable (optional), "${provider} ready" exited 3`]},
      {name:'missing tools', tools:{ffmpeg:false}, env:{}, status:1,
        expected:['ffmpeg: missing, not found','heygen: unavailable (optional), not found; HeyGen catalog assets are unavailable']},
    ];
    for (const [i,c] of cases.entries()) {
      const caseDir = join(dir,String(i));
      await mkdir(caseDir);
      const bin = await toolDir(caseDir,c.tools);
      const env = {HOME:process.env.HOME, ...(process.env.TMPDIR ? {TMPDIR:process.env.TMPDIR} : {}), PATH:bin, HEYGEN_API_KEY:'sk-secret-key-99', ...c.env};
      for (const runtime of runtimes) {
        const result = run(runtime,['doctor'],env,caseDir);
        expect([c.name,result.status]).toEqual([c.name,c.status]);
        const lines = result.stdout.trim().split('\n');
        expect(lines.map(l => l.split(':')[0])).toEqual(['node','ffmpeg','ffprobe','hyperframes','chromium','remotion','heygen','image provider']);
        expect(lines[0]).toMatch(/^node: ok, v\d+\.\d+\.\d+ \(need >= 22\)$/);
        expect(lines).toContain('remotion: ok, @remotion/renderer 4.0.529 (downloads its Chrome headless shell on the first render)');
        for (const line of c.expected) expect(lines).toContain(line);
        expect(result.stderr).toBe(c.status ? 'error: doctor: 1 required tool missing\n' : '');
        for (const secret of ['sk-secret-key-99','heygen-secret-token','someone@example.com','provider-secret-42']) expect(result.stdout + result.stderr).not.toContain(secret);
        // doctor installs nothing: the working folder stays as the test made it.
        expect((await readdir(caseDir)).sort()).toEqual(['bin']);
      }
    }
  } finally {await rm(dir,{recursive:true,force:true});}
});
