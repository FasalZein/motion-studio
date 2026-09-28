import {copyFile, realpath, stat} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {basename, dirname, isAbsolute, join, relative, resolve} from 'node:path';
import {CliError} from './project.js';
import {run, type AssetProvider, type Readiness, type RunResult} from './providers.js';

const require = createRequire(import.meta.url);
/** HyperFrames' own CLI; `hyperframes media-use resolve` does the catalog search and download. */
export const hyperframesBin = resolve(dirname(require.resolve('hyperframes/package.json')),'bin/hyperframes.mjs');
/**
 * Environment variable that replaces `hyperframes media-use` with another command that takes the same arguments.
 * Tests use it for an offline fake; nothing else needs it.
 */
export const MEDIA_USE_ENV = 'MOTION_STUDIO_MEDIA_USE';

/** media-use needs heygen 0.3.0 or later (its OAuth free-usage path). */
export const HEYGEN_MIN = [0,3,0];
/** heygen's documented exit code for "not authenticated, or not permitted". */
const HEYGEN_AUTH_EXIT = 3;
/** Version and sign-in checks are short API or local calls; a slower one counts as not ready. */
const STATUS_TIMEOUT_MS = 20_000;
/** heygen never prompts with this set; a missing credential then fails instead of waiting for input. */
const heygenEnv = () => ({...process.env, HEYGEN_NONINTERACTIVE:'1'});

/**
 * The media-use provider that serves each type from HeyGen, and the provenance key that holds its catalog id.
 * Catalog search is free. `voice` is HeyGen text to speech, which media-use marks as paid.
 * Forcing the provider stops media-use from reusing caches, adopting files or falling back to other sources.
 */
const heygenTypes = {
  bgm:{provider:'heygen.audio.sounds', idKey:'track_id', paid:false},
  sfx:{provider:'heygen.audio.sounds', idKey:'track_id', paid:false},
  image:{provider:'heygen.asset.search', idKey:'asset_id', paid:false},
  icon:{provider:'heygen.asset.search', idKey:'asset_id', paid:false},
  voice:{provider:'heygen.tts', idKey:null, paid:true},
} as const;
type HeygenType = keyof typeof heygenTypes;
const isHeygenType = (t:string):t is HeygenType => Object.hasOwn(heygenTypes,t);

const outcome = (r:RunResult) => r.kind === 'failed' ? r.reason : `exited ${r.code}`;
const version = (text:string) => text.match(/(\d+)\.(\d+)\.(\d+)/)?.slice(1).map(Number);
function atLeast(actual:number[], min:number[]):boolean {
  for (let i=0;i<min.length;i++) if (actual[i] !== min[i]) return actual[i] > min[i];
  return true;
}
const isObject = (v:unknown):v is Record<string,unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
/** A short machine word from heygen output (a credential type or error code); anything else is never printed. */
const word = (v:unknown) => typeof v === 'string' && /^[a-z_]{1,40}$/.test(v) ? v : null;

/**
 * heygen version and sign-in, from `heygen --version` and `heygen auth status`. `auth status` calls the HeyGen API:
 * it exits 0 with the credential, or exits 3 with a JSON error when no credential is stored or HeyGen refuses it.
 * A credential that reports itself expired also counts as not signed in. Only the credential type, its expiry and
 * heygen's error code are printed, never tokens or account data.
 */
export async function heygenStatus():Promise<Readiness> {
  const v = await run('heygen',['--version'],{timeoutMs:STATUS_TIMEOUT_MS, env:heygenEnv()});
  if (v.kind === 'failed' || v.code !== 0) return {ready:false, detail:`${outcome(v)}; HeyGen catalog assets are unavailable`};
  const found = version(v.stdout);
  if (!found || !atLeast(found,HEYGEN_MIN)) return {ready:false, detail:`version ${found?.join('.') ?? 'unknown'} is older than ${HEYGEN_MIN.join('.')}; run heygen update`};
  const at = `v${found.join('.')}`;
  const auth = await run('heygen',['auth','status'],{timeoutMs:STATUS_TIMEOUT_MS, env:heygenEnv()});
  let reply:unknown;
  try {reply = auth.kind === 'exited' ? JSON.parse(auth.stdout) : undefined;} catch {reply = undefined;}
  if (auth.kind === 'exited' && auth.code === HEYGEN_AUTH_EXIT) {
    const code = isObject(reply) && isObject(reply.error) ? word(reply.error.code) : null;
    return {ready:false, detail:`${at}, not signed in, or the sign-in expired or was refused ("heygen auth status" exited 3${code ? `: ${code}` : ''}); run heygen auth login`};
  }
  if (auth.kind === 'failed' || auth.code !== 0) return {ready:false, detail:`${at}, sign-in could not be checked ("heygen auth status" ${outcome(auth)})`};
  const credential = isObject(reply) && isObject(reply.credential) ? reply.credential : {};
  const type = word(credential.type);
  const seconds = typeof credential.expires_in_seconds === 'number' ? credential.expires_in_seconds : null;
  if (credential.expired === true || (seconds !== null && seconds <= 0)) return {ready:false, detail:`${at}, sign-in expired${type ? ` (${type})` : ''}; run heygen auth login`};
  const days = seconds === null ? '' : `, expires in ${Math.floor(seconds/86_400)} days`;
  return {ready:true, detail:`${at}, signed in${type ? ` (${type}${days})` : ''}`};
}

/** A path inside `root` after following links, or null. */
async function realChild(root:string, path:string):Promise<string|null> {
  const full = await realpath(resolve(root,path)).catch(() => null);
  if (full === null) return null;
  const rel = relative(await realpath(root),full);
  return rel === '' || rel.startsWith('..') || isAbsolute(rel) ? null : full;
}

/**
 * HeyGen catalog assets through `hyperframes media-use resolve`. It checks the sign-in first, so a missing or expired
 * login fails clearly before any search. media-use runs with the staging folder as its project and the HeyGen
 * provider forced; the provider then copies the frozen file out of media-use's `.media/` folder into the staging
 * folder. A record from any other provider is refused, so a fallback asset is never recorded as HeyGen.
 */
export function heygenProvider(timeoutMs:number, env:NodeJS.ProcessEnv):AssetProvider {
  const [bin,prefix] = env[MEDIA_USE_ENV] ? [env[MEDIA_USE_ENV],[]] : [process.execPath,[hyperframesBin,'media-use']];
  return {
    name:'heygen', sourceKind:'heygen',
    ready:heygenStatus,
    paid:type => isHeygenType(type) && heygenTypes[type].paid,
    async resolve({type,intent,outDir}) {
      if (!isHeygenType(type)) throw new CliError(`heygen provider: --type must be one of ${Object.keys(heygenTypes).join(', ')}`);
      const status = await heygenStatus();
      if (!status.ready) throw new CliError(`heygen provider: ${status.detail}`);
      const {provider,idKey} = heygenTypes[type];
      const r = await run(bin,[...prefix,'resolve','--type',type,'--intent',intent,'--project',outDir,'--provider',provider,'--json'],
        {timeoutMs, env:{...heygenEnv(), HYPERFRAMES_NO_UPDATE_CHECK:'1'}});
      if (r.kind === 'failed') throw new CliError(`heygen provider: media-use ${r.reason}`);
      let record:unknown;
      try {record = JSON.parse(r.stdout.trim().split('\n').at(-1) ?? '');} catch {record = undefined;}
      if (!isObject(record)) throw new CliError(`heygen provider: media-use ${outcome(r)} without a JSON record`);
      if (record.ok !== true || r.code !== 0) throw new CliError(`heygen provider: media-use could not resolve ${type}: ${typeof record.error === 'string' ? record.error : outcome(r)}`);
      const provenance = isObject(record.provenance) ? record.provenance : {};
      if (provenance.provider !== provider) throw new CliError(`heygen provider: media-use resolved ${type} from ${String(provenance.provider)}, not ${provider}; nothing recorded`);
      const assetId = idKey === null ? null : provenance[idKey];
      if (idKey !== null && (typeof assetId !== 'string' || !assetId)) throw new CliError(`heygen provider: media-use record has no ${idKey}`);
      const frozen = typeof record.path === 'string' ? await realChild(join(outDir,'.media'),resolve(outDir,record.path)) : null;
      if (frozen === null || !(await stat(frozen)).isFile()) throw new CliError(`heygen provider: media-use record path ${String(record.path)} is not a file in its .media folder`);
      // A copy, not a link: the staging folder, and with it .media, is deleted after the file is frozen.
      const file = basename(frozen);
      await copyFile(frozen,join(outDir,file));
      const from = `HeyGen ${provider}${assetId ? ` ${idKey} ${assetId}` : ''}`;
      return {
        file, providerAssetId:assetId as string|null,
        sourceUrlOrGenerator:`${from} via hyperframes media-use`,
        // The catalog reply names no license. The user checks HeyGen's terms before the final render (D37).
        license:{status:'unknown', name:null, evidence:`${from}; the HeyGen reply states no license, so HeyGen's terms apply`},
      };
    },
  };
}
