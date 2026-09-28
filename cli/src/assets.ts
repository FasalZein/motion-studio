import {constants, copyFile, mkdir, mkdtemp, readFile, rename, rm, stat, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {basename, extname, isAbsolute, join, relative, resolve, sep} from 'node:path';
import {CliError, schemaErrors, type Ledger, type LedgerAsset, type Project, type SourceKind} from './project.js';
import type {AssetProvider} from './providers.js';

export const assetsUsage = 'usage: motion-studio assets <film-dir> list | assets <film-dir> add <id> --file <path> --type <type> --source-kind <kind> --source <url-or-generator> --license <known|unknown|restricted> [--license-name <name>] --evidence <text> [--provider-asset-id <id>] [--shot <shot-id>]... | assets <film-dir> resolve <id> --provider <name> --type <type> --intent <text> [--shot <shot-id>]...';

const sourceKinds:SourceKind[] = ['heygen','website','stock','code','ai-image','data','video-model'];
const licenseStatuses = ['known','unknown','restricted'] as const;

const isFile = (path:string) => stat(path).then(s => s.isFile(),() => false);
const sha256 = async (path:string) => createHash('sha256').update(await readFile(path)).digest('hex');
/** The film-relative path with `/` separators, or null when `full` is not inside the film folder. */
function filmPath(root:string, full:string):string|null {
  const rel = relative(root,full);
  return rel === '' || rel.startsWith('..') || isAbsolute(rel) ? null : rel.split(sep).join('/');
}

/** Writes ledger.json through a hidden temp file and a rename, so a failed write never leaves a partial file. */
async function writeLedger(root:string, ledger:Ledger):Promise<void> {
  const temp = join(root,'.ledger.json.tmp');
  await writeFile(temp,JSON.stringify(ledger,null,2)+'\n');
  await rename(temp,join(root,'ledger.json'));
}

type Flags = {values:Map<string,string>; shots:string[]};
/** Parses `--name value` pairs. `--shot` repeats; every other flag appears once and must be in `allowed`. */
function parseFlags(args:string[], allowed:string[]):Flags {
  const values = new Map<string,string>();
  const shots:string[] = [];
  for (let i=0;i<args.length;i+=2) {
    const [flag,value] = [args[i],args[i+1]];
    const name = flag.startsWith('--') ? flag.slice(2) : '';
    if (value === undefined || (name !== 'shot' && (!allowed.includes(name) || values.has(name)))) throw new CliError(assetsUsage);
    if (name === 'shot') shots.push(value);
    else values.set(name,value);
  }
  return {values, shots};
}
function required(flags:Flags, name:string):string {
  const value = flags.values.get(name);
  if (value === undefined) throw new CliError(`assets: --${name} is required; ${assetsUsage}`);
  return value;
}

/** The entry fields a caller supplies; the CLI adds the local path and the content hash. */
type Draft = Omit<LedgerAsset,'localPath'|'sha256'>;

/**
 * Freezes one file and appends its ledger entry. A file outside the film folder is copied (or moved, for a
 * provider's staged file) to `assets/<id><ext>`; a file inside it is recorded in place. The new ledger is checked
 * against the schema before any file moves, and a failed ledger write removes the frozen copy, so a failure leaves
 * neither a partial entry nor a stray file.
 */
async function record(project:Project, draft:Draft, source:string, mode:'copy'|'move'):Promise<LedgerAsset> {
  const {root,ledger} = project;
  if (!await isFile(source)) throw new CliError(`assets: file ${source} not found`);
  const inPlace = mode === 'copy' ? filmPath(root,resolve(source)) : null;
  const target = inPlace === null ? join(root,'assets',`${draft.id}${extname(source)}`) : resolve(root,inPlace);
  const localPath = filmPath(root,target)!;
  const asset:LedgerAsset = {...draft, localPath, sha256:await sha256(source)};
  const next:Ledger = {...ledger, assets:[...ledger.assets, asset]};
  const errors = await schemaErrors('ledger.json',next);
  if (errors.length) {
    for (const e of errors) console.error(`error: ${e}`);
    throw new CliError(`assets: entry ${draft.id} not added: ${errors.length} schema error${errors.length === 1 ? '' : 's'}`);
  }
  if (inPlace !== null) {
    await writeLedger(root,next);
    return asset;
  }
  if (await stat(target).then(() => true,() => false)) throw new CliError(`assets: ${localPath} already exists; choose another id or record that file in place`);
  await mkdir(join(root,'assets'),{recursive:true});
  if (mode === 'copy') await copyFile(source,target,constants.COPYFILE_EXCL);
  else await rename(source,target);
  try {await writeLedger(root,next);}
  catch (e) {await rm(target,{force:true}); throw e;}
  return asset;
}

function requireNewId(project:Project, id:string|undefined):string {
  if (!id || id.startsWith('--')) throw new CliError(assetsUsage);
  if (project.ledger.assets.some(a => a.id === id)) throw new CliError(`assets: id ${id} is already in ledger.json`);
  return id;
}

async function add(project:Project, [idArg,...rest]:string[]):Promise<string[]> {
  const id = requireNewId(project,idArg);
  const flags = parseFlags(rest,['file','type','source-kind','source','license','license-name','evidence','provider-asset-id']);
  const kind = required(flags,'source-kind');
  const sourceKind = sourceKinds.find(k => k === kind);
  if (!sourceKind) throw new CliError(`assets: --source-kind must be one of ${sourceKinds.join(', ')}`);
  const status = licenseStatuses.find(s => s === required(flags,'license'));
  if (!status) throw new CliError(`assets: --license must be one of ${licenseStatuses.join(', ')}`);
  const asset = await record(project,{
    id, type:required(flags,'type'), sourceKind, sourceUrlOrGenerator:required(flags,'source'),
    providerAssetId:flags.values.get('provider-asset-id') ?? null,
    license:{status, name:flags.values.get('license-name') ?? null, evidence:required(flags,'evidence')},
    shots:flags.shots,
  },required(flags,'file'),'copy');
  return [`added ${describe(asset,'ok')}`];
}

async function resolveAsset(project:Project, [idArg,...rest]:string[], providers:Map<string,AssetProvider>):Promise<string[]> {
  const id = requireNewId(project,idArg);
  const flags = parseFlags(rest,['provider','type','intent']);
  const name = required(flags,'provider');
  const provider = providers.get(name);
  // A missing provider is reported, never replaced by another source (spec story 36).
  if (!provider) throw new CliError(`assets: provider ${name} is not configured (configured: ${[...providers.keys()].join(', ') || 'none'}); run motion-studio doctor`);
  const type = required(flags,'type');
  const intent = required(flags,'intent');
  // The provider writes into a hidden folder of the film, so the frozen file is a rename away and gates never hash it.
  const staging = await mkdtemp(join(project.root,'.motion-assets-'));
  try {
    const provided = await provider.resolve({type,intent,outDir:staging});
    if (basename(provided.file) !== provided.file || provided.file.startsWith('.')) throw new CliError(`${name} provider: "file" must be a file name inside the output folder, got ${provided.file}`);
    const staged = join(staging,provided.file);
    if (!await isFile(staged)) throw new CliError(`${name} provider: file ${provided.file} was not written`);
    const asset = await record(project,{
      id, type, sourceKind:provider.sourceKind, sourceUrlOrGenerator:provided.sourceUrlOrGenerator,
      providerAssetId:provided.providerAssetId, license:provided.license, shots:flags.shots,
    },staged,'move');
    return [`added ${describe(asset,'ok')}`];
  } finally {await rm(staging,{recursive:true,force:true});}
}

type FileState = 'ok'|'missing'|'altered'|'outside the film folder';
async function fileState(root:string, asset:LedgerAsset):Promise<FileState> {
  const full = resolve(root,asset.localPath);
  if (isAbsolute(asset.localPath) || filmPath(root,full) === null) return 'outside the film folder';
  if (!await isFile(full)) return 'missing';
  return await sha256(full) === asset.sha256 ? 'ok' : 'altered';
}
function describe(a:LedgerAsset, state:FileState):string {
  const license = `${a.license.status}${a.license.name ? ` ${a.license.name}` : ''} (evidence: ${a.license.evidence})`;
  return [`${a.id}: ${a.type}, ${a.sourceKind} ${a.sourceUrlOrGenerator}`,
    ...(a.providerAssetId === null ? [] : [`provider id ${a.providerAssetId}`]),
    `license ${license}`, `path ${a.localPath}`, `sha256 ${a.sha256}`,
    `shots ${a.shots.length ? a.shots.join(' ') : 'none'}`, `file ${state}`].join(', ');
}

async function list({root,ledger}:Project):Promise<string[]> {
  const lines = ledger.assets.length ? [] : ['ledger.json has no assets'];
  for (const asset of ledger.assets) lines.push(describe(asset,await fileState(root,asset)));
  // D37: the final render waits until the user accepts or swaps each of these.
  const unresolved = ledger.assets.filter(a => a.license.status !== 'known').map(a => `${a.id} (${a.license.status})`);
  lines.push(`unresolved rights: ${unresolved.join(', ') || 'none'}`);
  return lines;
}

/** `assets <film-dir> list|add|resolve`. It needs only a schema-valid project, because assets come before shots. */
export async function assets(project:Project, [action,...rest]:string[], providers:Map<string,AssetProvider>):Promise<string[]> {
  if (action === 'list' && !rest.length) return list(project);
  if (action === 'add') return add(project,rest);
  if (action === 'resolve') return resolveAsset(project,rest,providers);
  throw new CliError(assetsUsage);
}
