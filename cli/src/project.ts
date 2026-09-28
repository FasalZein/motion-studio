import {readFile, mkdir, writeFile, readdir} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import AjvModule, {type ErrorObject} from 'ajv';

// The JSON Schema files in ../schema are the authoritative field contract.
// These types mirror them; parseProject only returns them after schema validation passes.
export type Format = '16:9'|'9:16'|'1:1';
export type Fps = 24|25|30|60;
export type Engine = 'hyperframes'|'remotion';
export type GateId = 'G1'|'G2'|'G3'|'G4'|'G5';
export type GateState = 'pending'|'approved'|'changes'|'stale';
export type Shot = {
  id:string; startFrame:number; endFrame:number; engine:Engine; entrypoint:string; description:string; camera:string;
  entry:'cut'|'handoff'; exit:'cut'|'handoff'; assets:string[];
  soundCues:{asset:string; eventFrame:number; peakOffsetFrames:number}[];
  stillFrames:number[]; protected:{id:string; bounds:string; heldFrames:number[]}[];
};
export type Gate = {id:GateId; state:GateState; inputHashes:Record<string,string>; decision:string|null; notes:string[]; rounds:number};
export type Storyboard = {
  version:'0';
  meta:{title:string; logline:string; genre:string|null; formats:{primary:Format; extra:Format[]}; fps:Fps; durationFrames:number; canvas:{width:number; height:number}};
  look:{id:string|null; styleBible:string|null; axes:Record<string,string>; tasteSnapshot:string|null};
  audio:{track:string|null; grid:'detected'|'corrected'|'imported'|null; bpm:number|null; beatFrames:number[]; downbeatFrames:number[]; dropFrames:number[]; confidence:'high'|'low'|null};
  voice:{script:string; tts:string|null; wordTimings:string}|null;
  shots:Shot[]; gates:Gate[]; critique:unknown[];
};
export type LedgerAsset = {
  id:string; type:string; sourceKind:string; sourceUrlOrGenerator:string; providerAssetId:string|null;
  license:{status:'known'|'unknown'|'restricted'; name:string|null; evidence:string};
  localPath:string; sha256:string; shots:string[];
};
export type Ledger = {version:'0'; assets:LedgerAsset[]};
export type Project = {root:string; storyboard:Storyboard; ledger:Ledger};
/** Result of reading a film folder: either both files passed the schema, or a list of problems. */
export type ParseResult = {ok:true; project:Project}|{ok:false; errors:string[]};

export const gateIds:GateId[] = ['G1','G2','G3','G4','G5'];
export const briefSections = ['inputs','direction','structure','build','gotchas','start'];
const projectDirs = ['assets','shots','stills','renders','audio','critique'];

const schemaDir = resolve(dirname(fileURLToPath(import.meta.url)),'../schema');
// ajv is CommonJS; under NodeNext the default import is the module namespace.
const Ajv = AjvModule.default;
const ajv = new Ajv({allErrors:true});
const compiled = new Map<string,ReturnType<typeof ajv.compile>>();
async function schema(name:'storyboard'|'ledger') {
  let validate = compiled.get(name);
  if (!validate) {
    validate = ajv.compile(JSON.parse(await readFile(join(schemaDir,`${name}.schema.json`),'utf8')));
    compiled.set(name,validate);
  }
  return validate;
}
function describe(file:string, e:ErrorObject):string {
  const where = `${file} ${e.instancePath || '/'}`;
  if (e.keyword === 'required') return `${where}: missing required field "${(e.params as {missingProperty:string}).missingProperty}"`;
  if (e.keyword === 'enum') return `${where}: must be one of ${(e.params as {allowedValues:unknown[]}).allowedValues.map(v => JSON.stringify(v)).join(', ')}`;
  return `${where}: ${e.message}`;
}
async function readJson(root:string, file:string, errors:string[]):Promise<unknown> {
  let text:string;
  try {text = await readFile(join(root,file),'utf8');}
  catch {errors.push(`${file}: file not found in ${root}`); return undefined;}
  try {return JSON.parse(text);}
  catch (e) {errors.push(`${file}: invalid JSON (${(e as Error).message})`); return undefined;}
}

/** Reads storyboard.json and ledger.json from a film root and checks both against their JSON Schemas. */
export async function parseProject(filmRoot:string):Promise<ParseResult> {
  const root = resolve(filmRoot);
  const errors:string[] = [];
  const storyboard = await readJson(root,'storyboard.json',errors);
  const ledger = await readJson(root,'ledger.json',errors);
  for (const [file,value,name] of [['storyboard.json',storyboard,'storyboard'],['ledger.json',ledger,'ledger']] as const) {
    if (value === undefined) continue;
    const validate = await schema(name);
    // anyOf branches produce one error per branch; keep each message once.
    if (!validate(value)) errors.push(...new Set((validate.errors ?? []).filter(e => e.keyword !== 'anyOf' && e.keyword !== 'if').map(e => describe(file,e))));
  }
  if (errors.length) return {ok:false, errors};
  // Both values passed their schemas above, which define exactly these types.
  return {ok:true, project:{root, storyboard:storyboard as Storyboard, ledger:ledger as Ledger}};
}

export function emptyStoryboard():Storyboard {
  return {
    version:'0',
    meta:{title:'', logline:'', genre:null, formats:{primary:'16:9', extra:[]}, fps:30, durationFrames:0, canvas:{width:1920, height:1080}},
    look:{id:null, styleBible:null, axes:{}, tasteSnapshot:null},
    audio:{track:null, grid:null, bpm:null, beatFrames:[], downbeatFrames:[], dropFrames:[], confidence:null},
    voice:null,
    shots:[],
    gates:gateIds.map(id => ({id, state:'pending', inputHashes:{}, decision:null, notes:[], rounds:0})),
    critique:[],
  };
}

/** Creates films/<slug>/ under `cwd` with the fixed layout and an empty valid project. */
export async function initProject(cwd:string, slug:string):Promise<string> {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) throw Error(`invalid slug "${slug}": use lowercase letters, digits and hyphens`);
  const root = join(resolve(cwd),'films',slug);
  const existing = await readdir(root).catch(() => null);
  if (existing !== null) throw Error(`${root} already exists; init never overwrites a project`);
  for (const dir of projectDirs) await mkdir(join(root,dir),{recursive:true});
  await writeFile(join(root,'storyboard.json'),JSON.stringify(emptyStoryboard(),null,2)+'\n');
  await writeFile(join(root,'ledger.json'),JSON.stringify({version:'0', assets:[]} satisfies Ledger,null,2)+'\n');
  await writeFile(join(root,'BRIEF.md'),`# Brief\n\n${briefSections.map(s => `<${s}>\n</${s}>`).join('\n\n')}\n`);
  return root;
}
