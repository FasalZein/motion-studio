import {mkdir, open, readFile, rename, rm, stat, writeFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {basename, dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import AjvModule from 'ajv';
import {CliError, gateIds, parseProject, writeStoryboard, type GateId, type Project} from './project.js';
import {gateViews} from './gates.js';
import {termIds} from './vocabulary.js';

export const tasteUsage = 'usage: motion-studio taste show | taste g1 <film-dir> [--rejected <look-id>]... [--kept <look-id>:<pattern>]... | taste notes <film-dir> <G1-G5> | taste accept <film-dir> [--move <term>]... [--pacing <text>]';

type Kind = 'look'|'move'|'pacing';
type Entry = {kind:Kind; value:string; note:string; date:string};
type Note = {text:string; terms:string[]; date:string; film?:string; gate?:GateId};
type Taste = {version:1; liked:Entry[]; rejected:Entry[]; notes:Note[]};

/** The global profile. It follows HOME, so tests and probes point HOME at a scratch folder. */
const tasteFile = () => join(homedir(),'.motion-studio','taste.json');
/** Film-relative path of the per-project copy made at G1. */
const snapshotName = 'taste-snapshot.json';
const today = () => new Date().toISOString().slice(0,10);

let validator:Promise<ReturnType<InstanceType<typeof AjvModule.default>['compile']>>|undefined;
async function schemaErrors(value:unknown):Promise<string[]> {
  validator ??= readFile(resolve(dirname(fileURLToPath(import.meta.url)),'../schema/taste.schema.json'),'utf8')
    .then(text => new AjvModule.default({allErrors:true}).compile(JSON.parse(text)));
  const validate = await validator;
  return validate(value) ? [] : (validate.errors ?? []).map(e => `${e.instancePath || '/'}: ${e.message}`);
}

/** The current profile; an absent file is the empty profile. A file that is not a valid profile stops the command. */
async function readTaste():Promise<Taste> {
  const file = tasteFile();
  let text:string;
  try {text = await readFile(file,'utf8');}
  catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return {version:1, liked:[], rejected:[], notes:[]};
    throw e;
  }
  let value:unknown;
  try {value = JSON.parse(text);}
  catch (e) {throw new CliError(`${file}: invalid JSON (${(e as Error).message}); fix it, the CLI never overwrites it`);}
  const errors = await schemaErrors(value);
  if (errors.length) throw new CliError(`${file}: not a taste profile (${errors.join('; ')}); fix it, the CLI never overwrites it`);
  return value as Taste;
}
/** Writes JSON through a hidden temp file in the same folder and a rename, then reads it back. */
async function writeJson(file:string, text:string):Promise<void> {
  await mkdir(dirname(file),{recursive:true});
  const temp = join(dirname(file),`.${basename(file)}.${process.pid}.tmp`);
  await writeFile(temp,text);
  await rename(temp,file);
  if (await readFile(file,'utf8') !== text) throw new CliError(`${file}: read-back differs from the written profile`);
}
async function writeTaste(taste:Taste):Promise<string> {
  const errors = await schemaErrors(taste);
  if (errors.length) throw Error(`taste profile would be invalid: ${errors.join('; ')}`);
  const text = JSON.stringify(taste,null,2)+'\n';
  await writeJson(tasteFile(),text);
  return text;
}

/**
 * Lock bound: the locked section reads and writes a few small local JSON files (a taste profile, a snapshot and
 * storyboard.json), which takes well under 1 s; a lock file older than 30 s therefore belongs to a process that died
 * inside the section, and is removed. Waiting stops after 60 s, twice the bound, with an error that names the file.
 */
const lockStaleMs = 30_000;
const lockWaitMs = 60_000;
/**
 * Runs `fn` while holding `~/.motion-studio/taste.json.lock`, created exclusively (`wx`), so two taste commands never
 * read the same profile and overwrite each other's entries. The lock is removed in `finally`.
 */
async function locked<T>(fn:()=>Promise<T>):Promise<T> {
  const lock = `${tasteFile()}.lock`;
  await mkdir(dirname(lock),{recursive:true});
  const start = Date.now();
  for (let delay = 10;; delay = Math.min(delay*2,200)) {
    try {
      const handle = await open(lock,'wx');
      await handle.writeFile(`${process.pid}\n`);
      await handle.close();
      break;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      const age = await stat(lock).then(st => Date.now()-st.mtimeMs,() => 0);
      if (age > lockStaleMs) {await rm(lock,{force:true}); continue;}
      if (Date.now()-start > lockWaitMs) throw new CliError(`${lock}: another taste command holds the lock; wait for it, or remove the file if no taste command runs`);
      await new Promise(ok => setTimeout(ok,delay+Math.random()*delay));
    }
  }
  try {return await fn();}
  finally {await rm(lock,{force:true});}
}

/** Appends an entry unless the same kind, value and note are already in the list, so a rerun adds nothing. */
function add(list:Entry[], entry:Omit<Entry,'date'>):boolean {
  if (list.some(e => e.kind === entry.kind && e.value === entry.value && e.note === entry.note)) return false;
  list.push({...entry, date:today()});
  return true;
}
/** The director's words at a gate: every note of its record, quoted in order. */
const quote = (notes:string[]) => notes.map(n => `"${n}"`).join(' / ');

/** Term ids a text names: the exact id, not joined to another letter, digit or hyphen. */
async function termsIn(text:string):Promise<string[]> {
  return [...await termIds()].filter(id => new RegExp(`(?<![a-z0-9-])${id}(?![a-z0-9-])`).test(text)).sort();
}

type Flags = Map<string,string[]>;
/** Parses `--name value` pairs into lists; each flag must be in `allowed`, and `single` flags appear once. */
function parseFlags(args:string[], allowed:string[], single:string[] = []):Flags {
  const flags:Flags = new Map();
  for (let i=0;i<args.length;i+=2) {
    const name = args[i].startsWith('--') ? args[i].slice(2) : '';
    const value = args[i+1];
    if (!allowed.includes(name) || value === undefined || value.trim() === '') throw new CliError(tasteUsage);
    if (single.includes(name) && flags.has(name)) throw new CliError(tasteUsage);
    flags.set(name,[...flags.get(name) ?? [],value]);
  }
  return flags;
}
async function loadFilm(target:string|undefined):Promise<Project> {
  if (!target) throw new CliError(tasteUsage);
  const parsed = await parseProject(target);
  if (!parsed.ok) throw new CliError(parsed.errors.join('\nerror: '));
  return parsed.project;
}
/** The gate record, which must be approved and not stale, so taste records only a decision the film still holds. */
async function approved(project:Project, id:GateId, command:string) {
  const view = (await gateViews(project)).find(v => v.gate.id === id);
  if (view?.state !== 'approved') throw new CliError(`taste ${command} needs ${id} approved and not stale; ${id} is ${view ? view.state : 'missing'}${view?.reason ? ` (${view.reason})` : ''}`);
  return view.gate;
}
function chosenLook(project:Project, command:string):string {
  const id = project.storyboard.look.id;
  if (!id) throw new CliError(`taste ${command} needs storyboard.json look.id: set the chosen look before the gate`);
  return id;
}

/**
 * G1: the chosen look (`look.id`) is liked; each shown-and-passed look whose still honored its pattern replacements is
 * rejected; a passed look whose still kept a template pattern gets a note instead. Every entry quotes the G1 notes.
 * Then the whole profile is copied to the film and `look.tasteSnapshot` points at the copy. The G1 hashes leave out
 * `look.tasteSnapshot` (schema/gate-inputs.json), so the snapshot does not make the approval stale.
 */
async function g1(project:Project, args:string[]):Promise<string[]> {
  const flags = parseFlags(args,['rejected','kept']);
  const gate = await approved(project,'G1','g1');
  const chosen = chosenLook(project,'g1');
  if (!gate.notes.length) throw new CliError('taste g1 quotes the director: record the decision words with motion-studio gate <film-dir> G1 approve --note <text>');
  const rejected = flags.get('rejected') ?? [];
  const kept = (flags.get('kept') ?? []).map(k => {
    const at = k.indexOf(':');
    if (at < 1 || !k.slice(at+1).trim()) throw new CliError(`taste g1: --kept needs <look-id>:<pattern>, got "${k}"`);
    return {look:k.slice(0,at), pattern:k.slice(at+1).trim()};
  });
  const passed = [...rejected,...kept.map(k => k.look)];
  for (const look of passed) {
    if (look === chosen) throw new CliError(`taste g1: ${look} is the chosen look (look.id), not a passed candidate`);
    if (passed.filter(p => p === look).length > 1) throw new CliError(`taste g1: ${look} is listed more than once`);
    // Only a shown candidate can be passed: the approved G1 hashes list every look-test still it showed.
    if (!Object.keys(gate.inputHashes).some(k => k.startsWith('stills/G1/') && k.slice('stills/G1/'.length).replace(/\.[^./]*$/,'') === look))
      throw new CliError(`taste g1: ${look} has no look-test still at G1 (stills/G1/${look}.png); only a shown candidate can be passed`);
  }
  const slug = basename(project.root);
  const words = quote(gate.notes);
  return locked(async () => {
    const taste = await readTaste();
    const lines:string[] = [];
    lines.push(`${add(taste.liked,{kind:'look', value:chosen, note:`${slug}: G1 chosen: ${words}`}) ? 'liked' : 'already liked'} look ${chosen}`);
    for (const look of rejected) lines.push(`${add(taste.rejected,{kind:'look', value:look, note:`${slug}: G1 passed: ${words}`}) ? 'rejected' : 'already rejected'} look ${look}`);
    for (const {look,pattern} of kept) {
      const text = `${slug}: G1 passed on the execution of ${look}, not the look: its still kept "${pattern}"; decision: ${words}`;
      if (taste.notes.some(n => n.text === text && n.film === slug && n.gate === 'G1')) {lines.push(`already noted ${look}`); continue;}
      taste.notes.push({text, terms:await termsIn(text), date:today(), film:slug, gate:'G1'});
      lines.push(`noted ${look}: execution kept "${pattern}"`);
    }
    const text = await writeTaste(taste);
    // The snapshot is the profile as it stands after the G1 write, byte for byte.
    await writeJson(join(project.root,snapshotName),text);
    await writeStoryboard(project.root,{...project.storyboard, look:{...project.storyboard.look, tasteSnapshot:snapshotName}});
    lines.push(`taste profile: ${tasteFile()}`, `snapshot: ${join(project.root,snapshotName)}`);
    return lines;
  });
}

/** Every note of a gate record that the profile does not hold yet, tagged with the term ids it names. */
async function notes(project:Project, args:string[]):Promise<string[]> {
  const [id,...rest] = args;
  const gateId = gateIds.find(g => g === id);
  if (!gateId || rest.length) throw new CliError(tasteUsage);
  const gate = project.storyboard.gates.find(g => g.id === gateId);
  if (!gate) throw new CliError(`storyboard.json has no ${gateId} record`);
  const slug = basename(project.root);
  return locked(async () => {
    const taste = await readTaste();
    // A note repeated in a later round is a second observation; count copies instead of skipping equal text.
    const held = new Map<string,number>();
    for (const n of taste.notes) if (n.film === slug && n.gate === gateId) held.set(n.text,(held.get(n.text) ?? 0)+1);
    const lines:string[] = [];
    for (const text of gate.notes) {
      const count = held.get(text) ?? 0;
      if (count > 0) {held.set(text,count-1); continue;}
      const terms = await termsIn(text);
      taste.notes.push({text, terms, date:today(), film:slug, gate:gateId});
      lines.push(`noted ${gateId}: "${text}"${terms.length ? ` terms: ${terms.join(', ')}` : ''}`);
    }
    if (!lines.length) return [`${gateId}: no new notes (${gate.notes.length} already in the profile)`];
    await writeTaste(taste);
    return [...lines,`taste profile: ${tasteFile()}`];
  });
}

/** Final acceptance (G5 approved): the accepted look, the named signature moves and the pacing profile, when given. */
async function accept(project:Project, args:string[]):Promise<string[]> {
  const flags = parseFlags(args,['move','pacing'],['pacing']);
  const gate = await approved(project,'G5','accept');
  const look = chosenLook(project,'accept');
  const known = await termIds();
  const moves = flags.get('move') ?? [];
  for (const move of moves) {
    const custom = move.startsWith('custom:');
    if (custom ? !move.slice('custom:'.length).trim() : !known.has(move)) throw new CliError(`taste accept: move "${move}" is not a motion-vocabulary term id or custom:<description>`);
  }
  const slug = basename(project.root);
  const note = `${slug}: G5 accepted${gate.notes.length ? `: ${quote(gate.notes)}` : ''}`;
  return locked(async () => {
    const taste = await readTaste();
    const entries:Omit<Entry,'date'>[] = [
      {kind:'look', value:look, note},
      ...moves.map(value => ({kind:'move' as const, value, note})),
      ...(flags.get('pacing') ?? []).map(value => ({kind:'pacing' as const, value, note})),
    ];
    const lines = entries.map(e => `${add(taste.liked,e) ? 'liked' : 'already liked'} ${e.kind} ${e.value}`);
    await writeTaste(taste);
    return [...lines,`taste profile: ${tasteFile()}`];
  });
}

/** `taste <show|g1|notes|accept> ...`: the only reads and writes of the global taste profile. */
export async function taste(args:string[]):Promise<string[]> {
  const [sub,target,...rest] = args;
  if (sub === 'show' && target === undefined) return [JSON.stringify(await readTaste(),null,2)];
  if (sub === 'g1') return g1(await loadFilm(target),rest);
  if (sub === 'notes') return notes(await loadFilm(target),rest);
  if (sub === 'accept') return accept(await loadFilm(target),rest);
  throw new CliError(tasteUsage);
}
