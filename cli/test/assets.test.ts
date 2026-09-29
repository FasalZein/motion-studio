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
 * ghost names a file it did not write; escape names a path outside --out; link replies with image.png replaced by a
 * symbolic link to a file beside it.
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
  link) mv "$out/image.png" "$out/real.png"; ln -s "$out/real.png" "$out/image.png"
    echo '{"file":"image.png","sourceUrlOrGenerator":"fake","providerAssetId":null,"license":{"status":"unknown","name":null,"evidence":"x"}}';;
esac`);

type HeygenAuth = 'ok'|'expired'|'signedout'|'network';
/**
 * A local fake heygen CLI. `auth status` answers like the real CLI for FAKE_AUTH (default `auth`): ok prints a live
 * credential; expired prints one with a negative expiry; signedout exits 3 with an auth_error; network exits 1.
 * Every reply holds a token and an email that must never be printed. FAKE_HEYGEN_VERSION overrides the version.
 */
const fakeHeygen = (bin:string, version:string, auth:HeygenAuth) => script(join(bin,'heygen'),`
case "$1" in
  --version) echo "heygen version v\${FAKE_HEYGEN_VERSION:-${version}}";;
  auth) case "\${FAKE_AUTH:-${auth}}" in
    ok) echo '{"credential":{"type":"oauth","expires_in_seconds":172805,"access_token":"heygen-secret-token","user":{"email":"someone@example.com"}},"data":{"email":"someone@example.com"}}';;
    expired) echo '{"credential":{"type":"oauth","expires_in_seconds":-60,"access_token":"heygen-secret-token","user":{"email":"someone@example.com"}}}';;
    signedout) echo '{"error":{"code":"auth_error","message":"no API key found for someone@example.com"}}'; exit 3;;
    network) echo '{"error":{"code":"network_error","message":"lookup api.heygen.com for someone@example.com"}}'; exit 1;;
  esac;;
  *) exit 64;;
esac`);
/**
 * A local fake of `hyperframes media-use`. It appends its arguments to FAKE_CALLS, freezes `CATALOG:<type>:<intent>`
 * under <project>/.media/ like media-use, then acts on FAKE_MU: ok prints a record from the forced provider with
 * catalog id FAKE_ID; miss exits 1 with media-use's JSON error; fallback prints a record from bundled.sfx; noid
 * leaves out the catalog id; outside names a file beside .media; link replaces the frozen file with a link to FAKE_OUTSIDE.
 */
const fakeMediaUse = (dir:string) => script(join(dir,'media-use'),`
echo "$*" >> "\${FAKE_CALLS:-/dev/null}"
shift
while [ $# -gt 0 ]; do
  case "$1" in --type) type=$2; shift 2;; --intent) intent=$2; shift 2;; --project) project=$2; shift 2;; --provider) provider=$2; shift 2;; *) shift;; esac
done
case "$type" in bgm|sfx|voice) sub=audio/$type; ext=mp3;; *) sub=images; ext=jpg;; esac
case "$type" in bgm|sfx) key=track_id;; image|icon) key=asset_id;; *) key=prompt;; esac
mkdir -p "$project/.media/$sub"
rel=".media/$sub/\${type}_001.$ext"
printf 'CATALOG:%s:%s' "$type" "$intent" > "$project/$rel"
record() { echo "{\\"ok\\":true,\\"id\\":\\"\${type}_001\\",\\"type\\":\\"$type\\",\\"path\\":\\"$1\\",\\"source\\":\\"search\\",\\"provenance\\":{\\"provider\\":\\"$2\\"$3},\\"_source\\":\\"search\\"}"; }
case "\${FAKE_MU:-ok}" in
  ok) record "$rel" "$provider" ",\\"$key\\":\\"$FAKE_ID\\"";;
  miss) echo "{\\"ok\\":false,\\"error\\":\\"no provider could resolve $type\\"}"; exit 1;;
  fallback) record "$rel" bundled.sfx ",\\"library_key\\":\\"whoosh\\"";;
  noid) record "$rel" "$provider" "";;
  outside) printf 'stray' > "$project/stray.$ext"; record "stray.$ext" "$provider" ",\\"$key\\":\\"$FAKE_ID\\"";;
  link) rm "$project/$rel"; ln -s "$FAKE_OUTSIDE" "$project/$rel"; record "$rel" "$provider" ",\\"$key\\":\\"$FAKE_ID\\"";;
esac`);
/** Environment for a HeyGen import: fake heygen first on PATH, fake media-use, and a file that logs media-use calls. */
async function heygenEnv(dir:string, auth:HeygenAuth = 'ok'):Promise<{env:NodeJS.ProcessEnv; calls:string}> {
  const bin = join(dir,'heygen-bin');
  await mkdir(bin);
  await fakeHeygen(bin,'0.8.1',auth);
  const calls = join(dir,'media-use-calls.txt');
  return {calls, env:{...process.env, PATH:`${bin}:${process.env.PATH}`, MOTION_STUDIO_MEDIA_USE:await fakeMediaUse(dir), FAKE_CALLS:calls, FAKE_ID:'cat-42'}};
}
const callLog = (path:string) => readFile(path,'utf8').then(t => t.trim().split('\n'),() => []);

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

test('assets add records a site or screen capture and a file reused from another film', async () => {
  for (const runtime of runtimes) await withFilm(async (dir,film) => {
    const capture = join(dir,'panel.png');
    await writeFile(capture,'capture-bytes');
    const reused = join(dir,'logo.svg');
    await writeFile(reused,'<svg id="reused"/>');
    const common = ['--license','unknown','--shot','intro'];
    const addedCapture = run(runtime,['assets',film,'add','panel','--file',capture,'--type','screenshot','--source-kind','capture','--source','https://www.raycast.com/','--evidence','captured 2026-09-29 with hyperframes capture',...common]);
    expect(addedCapture.stderr).toBe('');
    expect(addedCapture.status).toBe(0);
    const addedReuse = run(runtime,['assets',film,'add','logo','--file',reused,'--type','logo','--source-kind','reuse','--source','films/earlier/ledger.json#logo','--evidence','copied from earlier film entry logo',...common]);
    expect(addedReuse.stderr).toBe('');
    expect(addedReuse.status).toBe(0);
    const ledger = JSON.parse(await readFile(join(film,'ledger.json'),'utf8'));
    expect(ledger.assets.map((a:{id:string,sourceKind:string,sourceUrlOrGenerator:string}) => [a.id,a.sourceKind,a.sourceUrlOrGenerator])).toEqual([
      ['panel','capture','https://www.raycast.com/'],
      ['logo','reuse','films/earlier/ledger.json#logo'],
    ]);
    expect(run(runtime,['validate',film]).status).toBe(0);
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
      [['add','logo-4',...base.slice(0,4),'--source-kind','scraped','--source','x','--evidence','x','--license','unknown'],'error: assets: --source-kind must be one of heygen, website, capture, reuse, stock, code, ai-image, data, video-model'],
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

test('a link inside the film to a file outside it is refused by add and by validate', async () => {
  for (const runtime of runtimes) await withFilm(async (dir,film) => {
    const outside = join(dir,'outside');
    await mkdir(outside);
    await writeFile(join(outside,'logo.svg'),'<svg id="outside"/>');
    await symlink(join(outside,'logo.svg'),join(film,'assets','logo.svg'));
    // A folder link: the file name is inside the film, its real path is not.
    await symlink(outside,join(film,'data'));
    const ledger = await readFile(join(film,'ledger.json'),'utf8');
    const base = ['--type','logo','--source-kind','website','--source','https://example.com','--license','unknown','--evidence','press kit page'];
    const fileLink = join(film,'assets','logo.svg');
    const folderLink = join(film,'data','logo.svg');
    for (const [file,message] of [
      [fileLink,`error: assets: file ${fileLink} is a symbolic link, not a regular file`],
      [folderLink,`error: assets: file ${folderLink} is inside the film folder by name, but its real path is outside it`],
    ]) {
      const result = run(runtime,['assets',film,'add','logo','--file',file,...base]);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain(message);
      expect(await readFile(join(film,'ledger.json'),'utf8')).toBe(ledger);
    }
    // A hand-written entry with such a path fails validate, and list shows why.
    const entry = (id:string, localPath:string) => ({id, type:'logo', sourceKind:'website', sourceUrlOrGenerator:'https://example.com', providerAssetId:null, license:{status:'unknown', name:null, evidence:'x'}, localPath, sha256:sha('<svg id="outside"/>'), shots:[]});
    await writeFile(join(film,'ledger.json'),JSON.stringify({version:'0', assets:[entry('file-link','assets/logo.svg'),entry('folder-link','data/logo.svg')]}));
    const invalid = run(runtime,['validate',film]);
    expect(invalid.status).toBe(1);
    expect(invalid.stderr).toContain('error: ledger asset file-link: path assets/logo.svg is a link to a file outside the film folder');
    expect(invalid.stderr).toContain('error: ledger asset folder-link: path data/logo.svg is a link to a file outside the film folder');
    const listed = run(runtime,['assets',film,'list']).stdout.split('\n');
    expect(listed[0].endsWith(', file links outside the film folder')).toBe(true);
    expect(listed[1].endsWith(', file links outside the film folder')).toBe(true);
  });
});

test('assets resolve freezes a provider file and records its provenance', async () => {
  for (const runtime of runtimes) await withFilm(async (dir,film) => {
    const provider = await fakeProvider(dir);
    const env = {...process.env, [PROVIDER_ENV]:provider, FAKE_MODE:'ok'};
    const args = ['assets',film,'resolve','texture-1','--provider','image','--type','texture','--intent','warm paper grain','--shot','intro'];
    // An external generator counts as paid: without the consent flag the provider is never called.
    const refused = run(runtime,args,{...env, FAKE_MODE:'fail'});
    expect(refused.status).toBe(1);
    expect(refused.stderr).toBe('error: assets: provider image may start paid generation for type texture; ask the user to agree to the cost, then add --paid-ok\n');
    expect(await readdir(join(film,'assets'))).toEqual([]);
    const result = run(runtime,[...args,'--paid-ok'],env);
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
    const args = ['assets',film,'resolve','texture-1','--provider','image','--type','texture','--intent','grain','--paid-ok'];
    const failures:[NodeJS.ProcessEnv,string][] = [
      [{[PROVIDER_ENV]:provider, FAKE_MODE:'fail'},'error: image provider failed: exited 1 (quota exceeded)'],
      [{[PROVIDER_ENV]:provider, FAKE_MODE:'badjson'},'error: image provider printed invalid JSON'],
      [{[PROVIDER_ENV]:provider, FAKE_MODE:'noname'},'error: ledger.json /assets/0/license: a known license needs a non-empty name'],
      [{[PROVIDER_ENV]:provider, FAKE_MODE:'ghost'},'error: image provider: file other.png was not written'],
      [{[PROVIDER_ENV]:provider, FAKE_MODE:'escape'},'error: image provider: "file" must be a file name inside the output folder, got ../ledger.json'],
      [{[PROVIDER_ENV]:provider, FAKE_MODE:'link'},'error: image provider: file image.png is a symbolic link, not a regular file'],
      [{[PROVIDER_ENV]:join(dir,'no-such-provider')},'error: image provider failed: not found'],
      [{[PROVIDER_ENV]:''},'error: assets: provider image is not configured (configured: heygen); run motion-studio doctor'],
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
async function toolDir(dir:string, {ffmpeg = true, heygen}:{ffmpeg?:boolean; heygen?:{version:string; auth:HeygenAuth}}) {
  const bin = join(dir,'bin');
  await mkdir(bin);
  for (const tool of ffmpeg ? ['node','ffmpeg','ffprobe'] : ['node','ffprobe']) await symlink(which(tool),join(bin,tool));
  if (heygen) await fakeHeygen(bin,heygen.version,heygen.auth);
  return bin;
}

test('doctor reports tools, heygen and the image provider without printing secrets', async () => {
  const dir = await mkdtemp(join(tmpdir(),'motion-studio-doctor-'));
  try {
    const provider = await fakeProvider(dir);
    const cases:{name:string; tools:Parameters<typeof toolDir>[1]; env:NodeJS.ProcessEnv; status:number; expected:string[]}[] = [
      {name:'ready', tools:{heygen:{version:'0.8.1', auth:'ok'}}, env:{[PROVIDER_ENV]:provider}, status:0,
        expected:['heygen: ok, v0.8.1, signed in (oauth, expires in 2 days)','image provider: ok, ready']},
      {name:'old heygen', tools:{heygen:{version:'0.2.9', auth:'ok'}}, env:{}, status:0,
        expected:['heygen: unavailable (optional), version 0.2.9 is older than 0.3.0; run heygen update',`image provider: unavailable (optional), not configured (set ${PROVIDER_ENV} to a provider command)`]},
      {name:'signed out', tools:{heygen:{version:'0.3.0', auth:'signedout'}}, env:{[PROVIDER_ENV]:provider, FAKE_READY:'3'}, status:0,
        expected:['heygen: unavailable (optional), v0.3.0, not signed in, or the sign-in expired or was refused ("heygen auth status" exited 3: auth_error); run heygen auth login',`image provider: unavailable (optional), "${provider} ready" exited 3`]},
      {name:'expired', tools:{heygen:{version:'0.8.1', auth:'expired'}}, env:{}, status:0,
        expected:['heygen: unavailable (optional), v0.8.1, sign-in expired (oauth); run heygen auth login']},
      {name:'no network', tools:{heygen:{version:'0.8.1', auth:'network'}}, env:{}, status:0,
        expected:['heygen: unavailable (optional), v0.8.1, sign-in could not be checked ("heygen auth status" exited 1)']},
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

test('assets resolve imports HeyGen catalog assets with catalog id, license evidence, hash and shot use', async () => {
  for (const runtime of runtimes) await withFilm(async (dir,film) => {
    const {env,calls} = await heygenEnv(dir);
    const music = run(runtime,['assets',film,'resolve','music','--provider','heygen','--type','bgm','--intent','upbeat launch','--shot','intro'],env);
    expect(music.stderr).toBe('');
    expect(music.status).toBe(0);
    const hero = run(runtime,['assets',film,'resolve','hero','--provider','heygen','--type','image','--intent','gradient sky','--shot','intro','--shot','outro'],env);
    expect(hero.status).toBe(0);
    const evidence = (provider:string, key:string) => `HeyGen ${provider} ${key} cat-42; the HeyGen reply states no license, so HeyGen's terms apply`;
    expect(JSON.parse(await readFile(join(film,'ledger.json'),'utf8')).assets).toEqual([
      {id:'music', type:'bgm', sourceKind:'heygen', sourceUrlOrGenerator:'HeyGen heygen.audio.sounds track_id cat-42 via hyperframes media-use', providerAssetId:'cat-42', license:{status:'unknown', name:null, evidence:evidence('heygen.audio.sounds','track_id')}, localPath:'assets/music.mp3', sha256:sha('CATALOG:bgm:upbeat launch'), shots:['intro']},
      {id:'hero', type:'image', sourceKind:'heygen', sourceUrlOrGenerator:'HeyGen heygen.asset.search asset_id cat-42 via hyperframes media-use', providerAssetId:'cat-42', license:{status:'unknown', name:null, evidence:evidence('heygen.asset.search','asset_id')}, localPath:'assets/hero.jpg', sha256:sha('CATALOG:image:gradient sky'), shots:['intro','outro']},
    ]);
    expect(await readFile(join(film,'assets','music.mp3'),'utf8')).toBe('CATALOG:bgm:upbeat launch');
    expect(await readFile(join(film,'assets','hero.jpg'),'utf8')).toBe('CATALOG:image:gradient sky');
    // media-use ran with the HeyGen provider forced, so no cache, adoption or fallback source could answer.
    const log = await callLog(calls);
    expect(log.length).toBe(2);
    expect(log[0]).toMatch(/^resolve --type bgm --intent upbeat launch --project \S+ --provider heygen\.audio\.sounds --json$/);
    expect(log[1]).toMatch(/^resolve --type image --intent gradient sky --project \S+ --provider heygen\.asset\.search --json$/);
    expect((await readdir(film)).filter(f => f.startsWith('.'))).toEqual([]);
    expect(run(runtime,['validate',film]).status).toBe(0);
    expect(run(runtime,['assets',film,'list']).stdout.split('\n').at(-2)).toBe('unresolved rights: music (unknown), hero (unknown)');
  });
});

test('missing or expired HeyGen sign-in and bad media-use records fail without a partial entry', async () => {
  for (const runtime of runtimes) await withFilm(async (dir,film) => {
    const {env,calls} = await heygenEnv(dir);
    const outsideFile = join(dir,'cache.mp3');
    await writeFile(outsideFile,'cached');
    const ledger = await readFile(join(film,'ledger.json'),'utf8');
    const args = ['assets',film,'resolve','music','--provider','heygen','--type','bgm','--intent','upbeat'];
    const login = 'run heygen auth login';
    // Sign-in failures stop before media-use runs; record failures stop after it.
    const failures:[NodeJS.ProcessEnv,string,boolean][] = [
      [{FAKE_AUTH:'signedout'},`error: heygen provider: v0.8.1, not signed in, or the sign-in expired or was refused ("heygen auth status" exited 3: auth_error); ${login}`,false],
      [{FAKE_AUTH:'expired'},`error: heygen provider: v0.8.1, sign-in expired (oauth); ${login}`,false],
      [{FAKE_AUTH:'network'},'error: heygen provider: v0.8.1, sign-in could not be checked ("heygen auth status" exited 1)',false],
      [{FAKE_HEYGEN_VERSION:'0.2.9'},'error: heygen provider: version 0.2.9 is older than 0.3.0; run heygen update',false],
      [{PATH:process.env.PATH?.split(':').filter(p => !which('heygen') || p !== dirname(which('heygen'))).join(':')},'error: heygen provider: not found; HeyGen catalog assets are unavailable',false],
      [{FAKE_MU:'miss'},'error: heygen provider: media-use could not resolve bgm: no provider could resolve bgm',true],
      [{FAKE_MU:'fallback'},'error: heygen provider: media-use resolved bgm from bundled.sfx, not heygen.audio.sounds; nothing recorded',true],
      [{FAKE_MU:'noid'},'error: heygen provider: media-use record has no track_id',true],
      [{FAKE_MU:'outside'},'error: heygen provider: media-use record path stray.mp3 is not a file in its .media folder',true],
      [{FAKE_MU:'link', FAKE_OUTSIDE:outsideFile},'error: heygen provider: media-use record path .media/audio/bgm/bgm_001.mp3 is not a file in its .media folder',true],
      [{},'error: heygen provider: --type must be one of bgm, sfx, image, icon, voice',false],
    ];
    for (const [i,[extra,message,called]] of failures.entries()) {
      await rm(calls,{force:true});
      const result = run(runtime,i === failures.length-1 ? [...args.slice(0,-3),'video','--intent','x'] : args,{...env, ...extra});
      expect([i,result.status]).toEqual([i,1]);
      expect(result.stderr).toBe(`${message}\n`);
      expect(result.stderr).not.toContain('heygen-secret-token');
      expect(result.stderr).not.toContain('someone@example.com');
      expect((await callLog(calls)).length).toBe(called ? 1 : 0);
      expect(await readFile(join(film,'ledger.json'),'utf8')).toBe(ledger);
      expect(await readdir(join(film,'assets'))).toEqual([]);
      expect((await readdir(film)).filter(f => f.startsWith('.'))).toEqual([]);
    }
  });
});

test('HeyGen voice is paid generation and runs only with the consent flag', async () => {
  for (const runtime of runtimes) await withFilm(async (dir,film) => {
    const {env,calls} = await heygenEnv(dir);
    const args = ['assets',film,'resolve','narration','--provider','heygen','--type','voice','--intent','Meet the new app.','--shot','intro'];
    const refused = run(runtime,[...args,'--voice-id','v-starfish-7'],env);
    expect(refused.status).toBe(1);
    expect(refused.stderr).toBe('error: assets: provider heygen may start paid generation for type voice; ask the user to agree to the cost, then add --paid-ok\n');
    // Without a chosen voice, media-use would speak with HeyGen's first listed voice, which the ledger could not name.
    const unnamed = run(runtime,[...args,'--paid-ok'],env);
    expect(unnamed.status).toBe(1);
    expect(unnamed.stderr).toBe('error: heygen provider: --type voice needs --voice-id <id>; list voices with heygen voice list --engine starfish\n');
    // A voice id means nothing for a catalog search.
    const catalog = run(runtime,['assets',film,'resolve','bed','--provider','heygen','--type','bgm','--intent','calm','--voice-id','v-starfish-7'],env);
    expect(catalog.status).toBe(1);
    expect(catalog.stderr).toBe('error: assets: --voice-id applies to --type voice only, not bgm\n');
    expect(await callLog(calls)).toEqual([]);
    expect(JSON.parse(await readFile(join(film,'ledger.json'),'utf8')).assets).toEqual([]);
    expect((await readdir(film)).filter(f => f.startsWith('.'))).toEqual([]);
    const agreed = run(runtime,[...args,'--voice-id','v-starfish-7','--paid-ok'],env);
    expect(agreed.stderr).toBe('');
    expect(agreed.status).toBe(0);
    expect(await callLog(calls)).toEqual([expect.stringMatching(/ --provider heygen\.tts --voice-id v-starfish-7 --json$/)]);
    // The entry names the chosen voice and the exact text spoken.
    expect(JSON.parse(await readFile(join(film,'ledger.json'),'utf8')).assets).toEqual([
      {id:'narration', type:'voice', sourceKind:'heygen', sourceUrlOrGenerator:'HeyGen heygen.tts voice v-starfish-7 via hyperframes media-use', providerAssetId:null, license:{status:'unknown', name:null, evidence:"HeyGen heygen.tts voice v-starfish-7; the HeyGen reply states no license, so HeyGen's terms apply"}, localPath:'assets/narration.mp3', sha256:sha('CATALOG:voice:Meet the new app.'), shots:['intro'], speech:{voiceId:'v-starfish-7', text:'Meet the new app.'}},
    ]);
    expect(run(runtime,['assets',film,'list'],env).stdout).toContain('narration: voice, heygen HeyGen heygen.tts voice v-starfish-7 via hyperframes media-use, voice v-starfish-7, license unknown');
  });
});
