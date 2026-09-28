import {createRequire} from 'node:module';
import {heygenStatus, hyperframesBin as hfBin} from './heygen.js';
import {IMAGE_PROVIDER_ENV, run, type AssetProvider, type RunResult} from './providers.js';

const require = createRequire(import.meta.url);
const packageVersion = (name:string) => (require(`${name}/package.json`) as {version:string}).version;

/** Each probe is a local, read-only command; one that takes longer counts as failed. */
const PROBE_TIMEOUT_MS = 20_000;
const NODE_MAJOR = 22;

/** One doctor line. Required tools stop the pipeline when missing; optional ones only narrow the asset sources. */
type Check = {name:string; required:boolean; ok:boolean; detail:string};
const probe = (bin:string, args:string[], env?:NodeJS.ProcessEnv) => run(bin,args,{timeoutMs:PROBE_TIMEOUT_MS, env});
const failure = (r:RunResult) => r.kind === 'failed' ? r.reason : `exited ${r.code}`;
const version = (text:string) => text.match(/(\d+)\.(\d+)\.(\d+)/)?.slice(1).map(Number);

async function nodeCheck():Promise<Check> {
  const r = await probe('node',['--version']);
  if (r.kind === 'failed' || r.code !== 0) return {name:'node', required:true, ok:false, detail:failure(r)};
  const v = version(r.stdout);
  return {name:'node', required:true, ok:Boolean(v && v[0] >= NODE_MAJOR), detail:`${r.stdout.trim()} (need >= ${NODE_MAJOR})`};
}
async function ffCheck(bin:'ffmpeg'|'ffprobe'):Promise<Check> {
  const r = await probe(bin,['-version']);
  if (r.kind === 'failed' || r.code !== 0) return {name:bin, required:true, ok:false, detail:failure(r)};
  return {name:bin, required:true, ok:true, detail:version(r.stdout)?.join('.') ?? r.stdout.split('\n')[0].trim()};
}
/**
 * HyperFrames and Chromium come from `hyperframes doctor --json`, which finds the Chrome HyperFrames renders with.
 * Its update check is turned off, so the probe stays local.
 */
async function hyperframesChecks():Promise<Check[]> {
  const hf = `hyperframes ${packageVersion('hyperframes')}`;
  const r = await probe('node',[hfBin,'doctor','--json'],{...process.env, HYPERFRAMES_NO_UPDATE_CHECK:'1'});
  type HfCheck = {name?:unknown; ok?:unknown; detail?:unknown};
  let chrome:HfCheck|undefined;
  if (r.kind === 'exited') {
    try {chrome = (JSON.parse(r.stdout) as {checks?:HfCheck[]}).checks?.find(c => c.name === 'Chrome');}
    catch {chrome = undefined;}
  }
  if (!chrome) return [
    {name:'hyperframes', required:true, ok:false, detail:`${hf}: doctor ${r.kind === 'exited' ? 'gave no Chrome check' : failure(r)}`},
    {name:'chromium', required:true, ok:false, detail:'unknown (hyperframes doctor failed)'},
  ];
  return [
    {name:'hyperframes', required:true, ok:true, detail:hf},
    {name:'chromium', required:true, ok:chrome.ok === true, detail:String(chrome.detail ?? '')},
  ];
}
function remotionCheck():Check {
  // Remotion fetches its own Chrome headless shell on the first render; doctor reports that and fetches nothing.
  return {name:'remotion', required:true, ok:true, detail:`@remotion/renderer ${packageVersion('@remotion/renderer')} (downloads its Chrome headless shell on the first render)`};
}
/** heygen CLI version and sign-in; the check prints only the credential type, its expiry and heygen's error code. */
async function heygenCheck():Promise<Check> {
  const {ready,detail} = await heygenStatus();
  return {name:'heygen', required:false, ok:ready, detail};
}
async function imageCheck(provider:AssetProvider|undefined):Promise<Check> {
  const name = 'image provider';
  if (!provider) return {name, required:false, ok:false, detail:`not configured (set ${IMAGE_PROVIDER_ENV} to a provider command)`};
  const r = await provider.ready();
  return {name, required:false, ok:r.ready, detail:r.detail};
}

/** Reports what this machine can do. It installs, downloads and signs in nothing. */
export async function doctor(providers:Map<string,AssetProvider>):Promise<{lines:string[]; missingRequired:number}> {
  const checks = [await nodeCheck(), await ffCheck('ffmpeg'), await ffCheck('ffprobe'), ...await hyperframesChecks(), remotionCheck(), await heygenCheck(), await imageCheck(providers.get('image'))];
  const lines = checks.map(c => `${c.name}: ${c.ok ? 'ok' : c.required ? 'missing' : 'unavailable (optional)'}, ${c.detail}`);
  return {lines, missingRequired:checks.filter(c => c.required && !c.ok).length};
}
