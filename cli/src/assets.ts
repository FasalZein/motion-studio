import {copyFile, lstat, mkdir, mkdtemp, readFile, rename, rm, stat, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {basename, extname, isAbsolute, join, relative, resolve, sep} from 'node:path';
import {CliError, licenseStatuses, schemaErrors, sourceKinds, type Ledger, type LedgerAsset, type Project} from './project.js';
import type {AssetProvider} from './providers.js';
import {ledgerFileState, realInside, type LedgerFileState} from './validate.js';

export const assetsUsage = 'usage: motion-studio assets <film-dir> list | assets <film-dir> add <id> --file <path> --type <type> --source-kind <kind> --source <url-or-generator> --license <known|unknown|restricted> [--license-name <name>] --evidence <text> [--provider-asset-id <id>] [--shot <shot-id>]... | assets <film-dir> resolve <id> --provider <name> --type <type> --intent <text> [--shot <shot-id>]... [--paid-ok]';

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
/** The file to freeze, with the prefix and name its error messages use and the wording for a missing file. */
type Source = {path:string; label:string; shown:string; missing:string};

/**
 * Accepts only a regular file. A symbolic link is refused: moving a link freezes nothing, and a link can point
 * outside the film or into a staging folder that is deleted afterwards.
 */
async function requireRegularFile({path,label,shown,missing}:Source):Promise<void> {
  const info = await lstat(path).catch(() => null);
  if (info === null) throw new CliError(`${label}: file ${shown} ${missing}`);
  if (info.isSymbolicLink()) throw new CliError(`${label}: file ${shown} is a symbolic link, not a regular file`);
  if (!info.isFile()) throw new CliError(`${label}: file ${shown} is not a regular file`);
}

/**
 * Freezes one regular file and appends its ledger entry. A file outside the film folder is copied (or moved, for a
 * provider's staged file) to `assets/<id><ext>`; a file inside it is recorded in place. The new ledger is checked
 * against the schema before any file moves, and a failed ledger write removes the frozen copy, so a failure leaves
 * neither a partial entry nor a stray file.
 */
async function record(project:Project, draft:Draft, src:Source, mode:'copy'|'move'):Promise<LedgerAsset> {
  const {root,ledger} = project;
  const source = src.path;
  await requireRegularFile(src);
  const inPlace = mode === 'copy' ? filmPath(root,resolve(source)) : null;
  // A folder link inside the film can still lead outside it; such a file is not frozen in the film.
  if (inPlace !== null && !await realInside(root,source)) throw new CliError(`${src.label}: file ${src.shown} is inside the film folder by name, but its real path is outside it`);
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
  if (await stat(target).then(() => true,() => false)) throw new CliError(`assets: ${localPath} already exists; choose another id`);
  await mkdir(join(root,'assets'),{recursive:true});
  if (mode === 'copy') {
    // Copy to a hidden name beside the target, then rename, so a crash never leaves a truncated asset file.
    // Gates never hash hidden files; a retry overwrites a leftover temp file.
    const temp = join(root,'assets',`.${basename(target)}.tmp`);
    try {await copyFile(source,temp); await rename(temp,target);}
    catch (e) {await rm(temp,{force:true}); throw e;}
  }
  // The staging folder is inside the film, so this rename is atomic.
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
  const file = required(flags,'file');
  const asset = await record(project,{
    id, type:required(flags,'type'), sourceKind, sourceUrlOrGenerator:required(flags,'source'),
    providerAssetId:flags.values.get('provider-asset-id') ?? null,
    license:{status, name:flags.values.get('license-name') ?? null, evidence:required(flags,'evidence')},
    shots:flags.shots,
  },{path:file, label:'assets', shown:file, missing:'not found'},'copy');
  return [`added ${describe(asset,'ok')}`];
}

async function resolveAsset(project:Project, [idArg,...rest]:string[], providers:Map<string,AssetProvider>):Promise<string[]> {
  const id = requireNewId(project,idArg);
  // --paid-ok is the user's consent to paid generation; the agent passes it only after the user agrees to the cost.
  const paidOk = rest.includes('--paid-ok');
  const flags = parseFlags(rest.filter(a => a !== '--paid-ok'),['provider','type','intent']);
  const name = required(flags,'provider');
  const provider = providers.get(name);
  // A missing provider is reported, never replaced by another source (spec story 36).
  if (!provider) throw new CliError(`assets: provider ${name} is not configured (configured: ${[...providers.keys()].join(', ') || 'none'}); run motion-studio doctor`);
  const type = required(flags,'type');
  const intent = required(flags,'intent');
  // Spec story 36: paid generation never starts without consent. This check runs before the provider is called.
  if (provider.paid(type) && !paidOk) throw new CliError(`assets: provider ${name} may start paid generation for type ${type}; ask the user to agree to the cost, then add --paid-ok`);
  // The provider writes into a hidden folder of the film, so the frozen file is a rename away and gates never hash it.
  const staging = await mkdtemp(join(project.root,'.motion-assets-'));
  try {
    const provided = await provider.resolve({type,intent,outDir:staging});
    if (basename(provided.file) !== provided.file || provided.file.startsWith('.')) throw new CliError(`${name} provider: "file" must be a file name inside the output folder, got ${provided.file}`);
    const asset = await record(project,{
      id, type, sourceKind:provider.sourceKind, sourceUrlOrGenerator:provided.sourceUrlOrGenerator,
      providerAssetId:provided.providerAssetId, license:provided.license, shots:flags.shots,
    },{path:join(staging,provided.file), label:`${name} provider`, shown:provided.file, missing:'was not written'},'move');
    return [`added ${describe(asset,'ok')}`];
  } finally {await rm(staging,{recursive:true,force:true});}
}

/** The file state word `list` prints; `validate` reports the same states as errors. */
const stateWords = {ok:'ok', missing:'missing', altered:'altered', outside:'outside the film folder', 'links outside':'links outside the film folder'} satisfies Record<LedgerFileState['state'],string>;
function describe(a:LedgerAsset, state:string):string {
  const license = `${a.license.status}${a.license.name ? ` ${a.license.name}` : ''} (evidence: ${a.license.evidence})`;
  return [`${a.id}: ${a.type}, ${a.sourceKind} ${a.sourceUrlOrGenerator}`,
    ...(a.providerAssetId === null ? [] : [`provider id ${a.providerAssetId}`]),
    `license ${license}`, `path ${a.localPath}`, `sha256 ${a.sha256}`,
    `shots ${a.shots.length ? a.shots.join(' ') : 'none'}`, `file ${state}`].join(', ');
}

async function list({root,ledger}:Project):Promise<string[]> {
  const lines = ledger.assets.length ? [] : ['ledger.json has no assets'];
  for (const asset of ledger.assets) lines.push(describe(asset,stateWords[(await ledgerFileState(root,asset)).state]));
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
