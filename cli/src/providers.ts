import {spawn} from 'node:child_process';
import {heygenProvider} from './heygen.js';
import {CliError, licenseStatuses, type LedgerAsset, type SourceKind} from './project.js';

/** Result of one child process: it ran to an exit code, or it could not run or did not finish in time. */
export type RunResult = {kind:'exited'; code:number; stdout:string; stderr:string}|{kind:'failed'; reason:string};

/** Runs a command without a shell and captures its output. A timeout kills the process group. */
export function run(bin:string, args:string[], {timeoutMs, env}:{timeoutMs:number; env?:NodeJS.ProcessEnv}):Promise<RunResult> {
  return new Promise(done => {
    let child;
    try {child = spawn(bin,args,{env,detached:process.platform !== 'win32',stdio:['ignore','pipe','pipe']});}
    catch (e) {done({kind:'failed', reason:(e as Error).message}); return;}
    let stdout = '';
    let stderr = '';
    child.stdout.on('data',d => { stdout += d; });
    child.stderr.on('data',d => { stderr += d; });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      if (child.pid && process.platform !== 'win32') { try {process.kill(-child.pid,'SIGKILL');} catch {} }
      else child.kill('SIGKILL');
    },timeoutMs);
    child.on('error',e => {clearTimeout(timer); done({kind:'failed', reason:(e as NodeJS.ErrnoException).code === 'ENOENT' ? 'not found' : e.message});});
    child.on('close',code => {
      clearTimeout(timer);
      if (timedOut) done({kind:'failed', reason:`timed out after ${timeoutMs} ms`});
      else if (code === null) done({kind:'failed', reason:'killed by a signal'});
      else done({kind:'exited', code, stdout, stderr});
    });
  });
}

export type Readiness = {ready:true; detail:string}|{ready:false; detail:string};
/**
 * What a provider asks for. The provider writes exactly one file into `outDir`, a hidden folder in the film root.
 * `voiceId` is the chosen voice of a `voice` request (the CLI refuses it for other types), else null.
 */
export type ResolveRequest = {type:string; intent:string; outDir:string; voiceId:string|null};
/**
 * One resolved file and its provenance, before the CLI freezes it under assets/ and records it in the ledger.
 * Generated speech also names the voice and the spoken text.
 */
export type ProvidedAsset = {file:string; sourceUrlOrGenerator:string; providerAssetId:string|null; license:LedgerAsset['license']; speech?:LedgerAsset['speech']};
/**
 * A source that fetches or generates assets. `ready` must be free: `doctor` calls it, so it must not start paid work.
 * `paid(type)` is true when resolving that type can start paid generation; the CLI then refuses to call `resolve`
 * without the user's consent flag (spec story 36).
 * `resolve` throws a CliError on failure; the caller then adds no ledger entry and keeps no file.
 */
export type AssetProvider = {
  name:string; sourceKind:SourceKind;
  ready():Promise<Readiness>;
  paid(type:string):boolean;
  resolve(request:ResolveRequest):Promise<ProvidedAsset>;
};

/** Environment variable that names the image provider command. The CLI ships no built-in paid provider. */
export const IMAGE_PROVIDER_ENV = 'MOTION_STUDIO_IMAGE_PROVIDER';
/** Readiness checks are local probes; a provider that takes longer counts as not ready. */
const READY_TIMEOUT_MS = 20_000;

const isObject = (v:unknown):v is Record<string,unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
/** Parses the provider's JSON reply. The whole ledger entry is checked against the ledger schema later. */
function parseProvided(value:unknown):ProvidedAsset|string {
  if (!isObject(value)) return 'reply is not a JSON object';
  const {file,sourceUrlOrGenerator,providerAssetId,license} = value;
  if (typeof file !== 'string') return 'reply has no "file" string';
  if (typeof sourceUrlOrGenerator !== 'string') return 'reply has no "sourceUrlOrGenerator" string';
  if (providerAssetId !== null && typeof providerAssetId !== 'string') return '"providerAssetId" must be a string or null';
  if (!isObject(license)) return 'reply has no "license" object';
  const status = licenseStatuses.find(s => s === license.status);
  if (!status) return `"license.status" must be one of ${licenseStatuses.join(', ')}`;
  if (license.name !== null && typeof license.name !== 'string') return '"license.name" must be a string or null';
  if (typeof license.evidence !== 'string') return 'reply has no "license.evidence" string';
  return {file, sourceUrlOrGenerator, providerAssetId, license:{status, name:license.name, evidence:license.evidence}};
}
const outcome = (r:RunResult) => r.kind === 'failed' ? r.reason : `exited ${r.code}`;

/**
 * A provider backed by an external command:
 * `<bin> ready` exits 0 when the provider can work, without paid calls;
 * `<bin> resolve --type <type> --intent <text> --out <dir>` writes one file into <dir>, prints
 * `{"file","sourceUrlOrGenerator","providerAssetId","license":{"status","name","evidence"}}` and exits 0.
 * The output of `ready` is never printed, because it can hold account data.
 */
export function commandProvider(name:string, sourceKind:SourceKind, bin:string, timeoutMs:number):AssetProvider {
  return {
    name, sourceKind,
    // The CLI cannot see what an external command charges, so every call counts as paid.
    paid:() => true,
    async ready() {
      const r = await run(bin,['ready'],{timeoutMs:READY_TIMEOUT_MS});
      return r.kind === 'exited' && r.code === 0 ? {ready:true, detail:'ready'} : {ready:false, detail:`"${bin} ready" ${outcome(r)}`};
    },
    async resolve({type,intent,outDir,voiceId}) {
      // The command protocol has no voice argument; a chosen voice would be dropped silently.
      if (voiceId !== null) throw new CliError(`${name} provider does not take --voice-id`);
      const r = await run(bin,['resolve','--type',type,'--intent',intent,'--out',outDir],{timeoutMs});
      if (r.kind === 'failed' || r.code !== 0) {
        const last = r.kind === 'exited' ? r.stderr.trim().split('\n').at(-1) : undefined;
        throw new CliError(`${name} provider failed: ${outcome(r)}${last ? ` (${last})` : ''}`);
      }
      let value:unknown;
      try {value = JSON.parse(r.stdout);}
      catch {throw new CliError(`${name} provider printed invalid JSON`);}
      const provided = parseProvided(value);
      if (typeof provided === 'string') throw new CliError(`${name} provider: ${provided}`);
      return provided;
    },
  };
}

/** The providers this environment configures, by name. HeyGen is always present; its readiness is checked on use. */
export function configuredProviders(env:NodeJS.ProcessEnv, timeoutMs:number):Map<string,AssetProvider> {
  const providers = new Map<string,AssetProvider>([['heygen',heygenProvider(timeoutMs,env)]]);
  const image = env[IMAGE_PROVIDER_ENV];
  if (image) providers.set('image',commandProvider('image','ai-image',image,timeoutMs));
  return providers;
}
