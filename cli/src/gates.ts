import {chmod, copyFile, mkdir, readFile, readdir} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {dirname, isAbsolute, join, relative, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import AjvModule from 'ajv';
import {CliError, gateIds, writeStoryboard, type Gate, type GateId, type GateState, type Project, type Waivable} from './project.js';
import {livenessRefusals} from './liveness.js';
import {critiqueRefusals, type CritiqueRule} from './critiquegate.js';

/** Note rounds allowed per gate before the user must accept, rescope or stop. */
export const noteRounds = 3;

// schema/gate-inputs.json lists what each gate hashes. It is data so later tickets add inputs without code changes.
type Source = {file:string; exclude?:string[]}|{storyboard:string; fields?:string[]}|{storyboardPath:string};
type GateInput = {name:string; freeze?:boolean; sources:Source[]};
type GateInputs = Record<GateId,GateInput[]> & {critique:CritiqueRule};

const pointer = {type:'string', pattern:'^(/[^/]*)+$'};
const inputsSchema = {
  type:'object', required:[...gateIds,'critique'], additionalProperties:false,
  properties:{$comment:{type:'string'}, critique:{type:'object', required:['gate','packet','reports'], additionalProperties:false, properties:{
    $comment:{type:'string'}, gate:{enum:gateIds}, packet:{type:'string', pattern:'\\{format\\}'}, reports:{type:'string', minLength:1}}}, ...Object.fromEntries(gateIds.map(id => [id,{type:'array', items:{
    type:'object', required:['name','sources'], additionalProperties:false,
    properties:{name:{type:'string', minLength:1}, freeze:{type:'boolean'}, sources:{type:'array', items:{oneOf:[
      {type:'object', required:['file'], additionalProperties:false, properties:{file:{type:'string', minLength:1}, exclude:{type:'array', minItems:1, items:{type:'string', minLength:1}}}},
      {type:'object', required:['storyboard'], additionalProperties:false, properties:{storyboard:pointer, fields:{type:'array', minItems:1, items:{type:'string', minLength:1}}}},
      {type:'object', required:['storyboardPath'], additionalProperties:false, properties:{storyboardPath:pointer}},
    ]}}},
  }}]))},
};
let inputsCache:GateInputs|undefined;
async function gateInputs():Promise<GateInputs> {
  if (inputsCache) return inputsCache;
  const path = resolve(dirname(fileURLToPath(import.meta.url)),'../schema/gate-inputs.json');
  const data:unknown = JSON.parse(await readFile(path,'utf8'));
  const validate = new AjvModule.default({allErrors:true}).compile<GateInputs>(inputsSchema);
  if (!validate(data)) throw Error(`invalid ${path}: ${JSON.stringify(validate.errors)}`);
  return inputsCache = data;
}

// Never hashed: dependency installs and hidden files and folders, such as render staging and the storyboard temp file.
const skipDir = (name:string) => name === 'node_modules' || name.startsWith('.');
async function filmFiles(root:string, dir = ''):Promise<string[]> {
  const entries = await readdir(join(root,dir),{withFileTypes:true}).catch(() => []);
  const files:string[] = [];
  for (const e of entries) {
    const path = dir ? `${dir}/${e.name}` : e.name;
    if (e.isDirectory()) { if (!skipDir(e.name)) files.push(...await filmFiles(root,path)); }
    else if (e.isFile() && !e.name.startsWith('.')) files.push(path);
  }
  return files;
}
/** `*` matches within one path segment; `**` matches any number of segments. */
function globRegex(glob:string):RegExp {
  const body = glob.split('/').map(seg => seg === '**' ? '\u0000' : seg.replace(/[.+?^${}()|[\]\\]/g,'\\$&').replaceAll('*','[^/]*')).join('/');
  return new RegExp(`^${body.replaceAll('\u0000/','(?:[^/]+/)*').replaceAll('/\u0000','(?:/[^/]+)+').replaceAll('\u0000','.*')}$`);
}
/** The part of a glob before its first wildcard segment; frozen copies keep paths relative to it. */
const globBase = (glob:string) => glob.split('/').slice(0,-1).filter((_,i,a) => !a.slice(0,i+1).some(s => s.includes('*'))).join('/');

function readPointer(value:unknown, path:string):unknown {
  for (const raw of path.split('/').slice(1)) {
    const key = raw.replaceAll('~1','/').replaceAll('~0','~');
    if (value === null || typeof value !== 'object' || !Object.hasOwn(value,key)) return undefined;
    value = (value as Record<string,unknown>)[key];
  }
  return value;
}
/** Only the named fields of an object, or of each item of an array; other values stay as they are. */
function pick(value:unknown, fields:string[]):unknown {
  if (Array.isArray(value)) return value.map(item => pick(item,fields));
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(fields.filter(f => Object.hasOwn(value,f)).map(f => [f,(value as Record<string,unknown>)[f]]));
}
export function canonical(value:unknown):string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical((value as Record<string,unknown>)[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
const sha256 = (data:string|Buffer) => createHash('sha256').update(data).digest('hex');
async function fileHash(path:string):Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}
/** A film-relative path that stays inside the film root, in `/` form; null otherwise. */
function filmPath(root:string, path:string):string|null {
  const rel = relative(root,resolve(root,path));
  return isAbsolute(path) || rel === '' || rel.startsWith('..') || isAbsolute(rel) ? null : rel.split(sep).join('/');
}

/** Short id of an approved revision: the first 8 hex of the hash of its sorted input hashes. */
export const revisionId = (hashes:Record<string,string>) => sha256(canonical(hashes)).slice(0,8);
export const frozenDir = (id:GateId, hashes:Record<string,string>) => `stills/approved/${id}-${revisionId(hashes)}`;

/** An input keyed by film-relative path or storyboard pointer; `file` is the file hashed for it (a frozen copy or the live file). */
type Resolved = {key:string; file:string|null; value?:unknown; freezeBase?:string};
function resolveSource(project:Project, files:string[], source:Source, freeze:boolean):Resolved[] {
  const {root,storyboard} = project;
  if ('file' in source) {
    const re = globRegex(source.file);
    const excluded = (source.exclude ?? []).map(globRegex);
    const base = globBase(source.file);
    return files.filter(f => re.test(f) && !excluded.some(x => x.test(f))).map(f => ({key:f, file:f, ...(freeze ? {freezeBase:base} : {})}));
  }
  if ('storyboard' in source) {
    const value = readPointer(storyboard,source.storyboard);
    if (value === undefined) return [];
    return source.fields
      ? [{key:`storyboard.json#${source.storyboard}{${source.fields.join(',')}}`, file:null, value:pick(value,source.fields)}]
      : [{key:`storyboard.json#${source.storyboard}`, file:null, value}];
  }
  const value = readPointer(storyboard,source.storyboardPath);
  const path = typeof value === 'string' ? filmPath(root,value) : null;
  return path && files.includes(path) ? [{key:path, file:path}] : [];
}
/**
 * The frozen copies of one freeze source of an approved gate, keyed by their live paths so the keys match the ones
 * recorded at approval. A missing copy drops out, which makes the approval stale.
 */
function frozenCopies(project:Project, files:string[], id:GateId, source:Source):Resolved[] {
  const gate = project.storyboard.gates.find(g => g.id === id);
  if (!gate || !('file' in source)) return [];
  const re = globRegex(source.file);
  const base = globBase(source.file);
  const dir = frozenDir(id,gate.inputHashes);
  return Object.keys(gate.inputHashes).filter(k => re.test(k))
    .map(key => ({key, file:`${dir}/${base ? key.slice(base.length+1) : key}`}))
    .filter(r => files.includes(r.file));
}
/**
 * Current inputs of a gate: its own sources plus every earlier gate's. Freeze inputs of the gate being recorded are
 * read live; every other freeze input is read from its gate's frozen copy (D43).
 */
async function gateSources(project:Project, id:GateId, files:string[], recording?:GateId):Promise<{all:Resolved[]; freeze:Resolved[]}> {
  const inputs = await gateInputs();
  const all = new Map<string,Resolved>();
  const freeze:Resolved[] = [];
  for (const gid of gateIds.slice(0,gateIds.indexOf(id)+1)) for (const input of inputs[gid]) for (const source of input.sources) {
    const live = input.freeze !== true || gid === recording;
    for (const r of live ? resolveSource(project,files,source,input.freeze === true) : frozenCopies(project,files,gid,source)) {
      all.set(r.key,r);
      if (r.freezeBase !== undefined) freeze.push(r);
    }
  }
  return {all:[...all.values()], freeze};
}
async function hashAll(root:string, sources:Resolved[]):Promise<Record<string,string>> {
  const hashes:Record<string,string> = {};
  for (const r of [...sources].sort((a,b) => a.key < b.key ? -1 : 1)) hashes[r.key] = r.file === null ? sha256(canonical(r.value)) : await fileHash(join(root,r.file));
  return hashes;
}
/** Hashes of a gate's inputs as they stand now, with every freeze input read from its frozen copy. */
async function currentHashes(project:Project, id:GateId, files:string[]):Promise<Record<string,string>> {
  return hashAll(project.root,(await gateSources(project,id,files)).all);
}
function changedKeys(recorded:Record<string,string>, current:Record<string,string>):string[] {
  return [...new Set([...Object.keys(recorded),...Object.keys(current)])].filter(k => recorded[k] !== current[k]).sort();
}

/** A gate as it stands now: its stored record, its effective state after the hash check, and why it is stale. */
export type GateView = {gate:Gate; state:GateState; reason:string|null};
const listed = (keys:string[]) => keys.length > 5 ? `${keys.slice(0,5).join(', ')} and ${keys.length-5} more` : keys.join(', ');

/**
 * Effective gate states. An approval is stale when its inputs changed or it has no recorded hashes.
 * Once a gate is not approved, every later gate that is not pending is stale too.
 */
export async function gateViews(project:Project):Promise<GateView[]> {
  const files = await filmFiles(project.root);
  const views:GateView[] = [];
  let blocker:GateView|undefined;
  // Gates are taken in G1-G5 order by id, whatever their order in storyboard.json; validate reports a wrong order.
  for (const gate of gateIds.flatMap(id => project.storyboard.gates.find(g => g.id === id) ?? [])) {
    let view:GateView = {gate, state:gate.state, reason:null};
    if (blocker && gate.state !== 'pending' && gate.state !== 'stale') view = {gate, state:'stale', reason:`${blocker.gate.id} not approved`};
    else if (!blocker && gate.state === 'approved') {
      const changed = changedKeys(gate.inputHashes,await currentHashes(project,gate.id,files));
      if (!Object.keys(gate.inputHashes).length) view = {gate, state:'stale', reason:'approval has no input hashes'};
      else if (changed.length) view = {gate, state:'stale', reason:`changed: ${listed(changed)}`};
    }
    views.push(view);
    blocker ??= view.state === 'approved' ? undefined : view;
  }
  return views;
}

export type Decision = 'approve'|'changes'|'rescope';
export const decisions:Decision[] = ['approve','changes','rescope'];

/** Copies the gate's freeze inputs into stills/approved/<gate>-<hash8>/ as read-only files. */
async function freeze(project:Project, id:GateId, hashes:Record<string,string>, sources:Resolved[]):Promise<string|null> {
  if (!sources.length) return null;
  const dir = frozenDir(id,hashes);
  for (const r of sources) {
    const rel = r.freezeBase ? r.key.slice(r.freezeBase.length+1) : r.key;
    const target = join(project.root,dir,rel);
    // The same revision may be approved again; its frozen copy must still hold the approved bytes.
    const existing = await fileHash(target).catch(() => null);
    if (existing === hashes[r.key]) continue;
    if (existing !== null) throw new CliError(`frozen copy ${dir}/${rel} differs from the approved still ${r.key}`);
    await mkdir(dirname(target),{recursive:true});
    await copyFile(join(project.root,r.key),target);
    await chmod(target,0o444);
  }
  return dir;
}

/**
 * Records one decision on a gate, bound to the hashes of its current inputs.
 * Every earlier gate must be approved and not stale. A note or rescope resets every later gate that is not pending.
 * G4 approval needs a current passing liveness report for every chosen format, unless `waive` names the check and a
 * note gives the reason (D60); the gate record keeps the waiver. The critique gate (G4) also needs a current critique
 * report per chosen format (D78, the `critique` entry of schema/gate-inputs.json); no waiver lifts that check.
 */
export async function recordGate(project:Project, id:GateId, decision:Decision, notes:string[], waive?:Waivable):Promise<string[]> {
  const views = await gateViews(project);
  const order = (g:GateId) => gateIds.indexOf(g);
  // Every gate needs exactly one record; a missing earlier record would let a later gate skip it.
  const ids = project.storyboard.gates.map(g => g.id);
  if (gateIds.some(g => ids.filter(i => i === g).length !== 1)) throw new CliError(`cannot record ${id}: storyboard.json must list gates ${gateIds.join(', ')} once each; found ${ids.join(', ') || 'none'}`);
  const view = views.find(v => v.gate.id === id)!;
  const earlier = views.find(v => order(v.gate.id) < order(id) && v.state !== 'approved');
  if (earlier) throw new CliError(`cannot record ${id}: ${earlier.gate.id} is not approved (${earlier.state}${earlier.reason ? `: ${earlier.reason}` : ''}); approve ${earlier.gate.id} first`);
  if (decision !== 'approve' && !notes.length) throw new CliError(`${decision} needs at least one --note`);
  if (waive && (id !== 'G4' || decision !== 'approve')) throw new CliError(`--waive ${waive} applies only to G4 approve`);
  if (waive && !notes.length) throw new CliError(`--waive ${waive} needs a --note with the reason`);
  if (id === 'G4' && decision === 'approve' && !waive) {
    const refusals = await livenessRefusals(project);
    if (refusals.length) throw new CliError(`cannot approve G4: ${refusals.join('; ')}; run motion-studio liveness ${project.root}, or approve with --waive liveness --note <reason>`);
  }
  // The critique check has no waiver: the approval shows the user a fresh reviewer's report of this master (D78).
  const {critique} = await gateInputs();
  if (id === critique.gate && decision === 'approve') {
    const refusals = await critiqueRefusals(project,critique);
    if (refusals.length) throw new CliError(`cannot approve ${id}: ${refusals.join('; ')}; run motion-studio packet ${project.root} and dispatch a fresh motion-critique reviewer (its report header names the packet and master sha256)`);
  }
  const gate = view.gate;
  if (decision === 'changes' && gate.rounds >= noteRounds) throw new CliError(`${id} used ${gate.rounds} of ${noteRounds} note rounds; approve to accept, rescope or stop`);
  const files = await filmFiles(project.root);
  const sources = await gateSources(project,id,files,id);
  const hashes = await hashAll(project.root,sources.all);
  const frozen = decision === 'approve' ? await freeze(project,id,hashes,sources.freeze) : null;

  // Gate records are selected by id and keep their order in storyboard.json.
  const effective = new Map(views.map(v => [v.gate,v.state]));
  const state:Record<Decision,GateState> = {approve:'approved', changes:'changes', rescope:'pending'};
  const gates:Gate[] = project.storyboard.gates.map(g => {
    // A waiver belongs to the one approval that records it; any later decision drops it.
    if (g === gate) {
      const {waiver:_, ...rest} = g;
      return {...rest, state:state[decision], inputHashes:hashes, decision, notes:[...g.notes,...notes],
        rounds:decision === 'changes' ? g.rounds+1 : decision === 'rescope' ? 0 : g.rounds, ...(waive ? {waiver:{check:waive, reason:notes.join('\n')}} : {})};
    }
    const current = effective.get(g) ?? g.state;
    return {...g, state:decision !== 'approve' && order(g.id) > order(id) && current !== 'pending' ? 'stale' : current};
  });

  await writeStoryboard(project.root,{...project.storyboard, gates});
  return [`recorded ${id} ${decision}: ${Object.keys(hashes).length} inputs, revision ${revisionId(hashes)}`, ...(waive ? [`waived: ${waive}`] : []), ...(frozen ? [`frozen stills: ${frozen}`] : [])];
}
