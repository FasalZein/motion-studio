import {readFile, mkdir, writeFile, readdir, rename} from 'node:fs/promises';
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
  entry:'cut'|'handoff'; exit:'cut'|'handoff'; transition?:string; offBeatCut?:string; assets:string[];
  thread?:Thread; // required on every shot after the first; validate checks it (D64)
  threeD?:{reason:string}; // the board's 3D declaration (D65); validate requires it for three.js imports (D66)
  reveals?:Reveal[]; // spoken reveals, checked against the word timings
  soundCues:{asset:string; eventFrame:number; peakOffsetFrames:number; gainDb?:number}[];
  stillFrames:number[]; protected:{id:string; bounds:string; heldFrames:number[]}[]; // bounds: 'measured' or a declared-geometry file
  holds?:FrameSpan[]; effects?:(FrameSpan & {term:string})[]; // declared context for scan
};
/** What the seam into a shot carries: a motion-vocabulary thread id or custom:<description>, and the carried thing in words. */
export type Thread = {kind:string; shared:string};
/** A visual event timed to one narration word: its index in the word-timing file, its text and the film frame. */
export type Reveal = {word:number; text:string; frame:number};
/** Optional narration. startFrame is the film frame where the audio starts (default 0). */
export type Voice = {script:string; tts:string|null; wordTimings:string; startFrame?:number};
/** A run of shot-local frames: the first frame and the number of frames, so the run can never end before it starts. */
export type FrameSpan = {start:number; frames:number};
export type Rect = {x:number; y:number; width:number; height:number};
/** Layout inputs of one format. Both engines receive the same values (Remotion as props, HyperFrames as variables). */
export type Layout = {canvas:{width:number; height:number}; safe:Rect; overlay:string|null};
export type Gate = {id:GateId; state:GateState; inputHashes:Record<string,string>; decision:string|null; notes:string[]; rounds:number};
export type Storyboard = {
  version:'0';
  meta:{title:string; logline:string; genre:string|null; formats:{primary:Format; extra:Format[]}; fps:Fps; durationFrames:number; layouts:Partial<Record<Format,Layout>>};
  look:{id:string|null; styleBible:string|null; axes:Record<string,string>; tasteSnapshot:string|null};
  audio:{track:string|null; grid:'detected'|'corrected'|'imported'|null; bpm:number|null; beatFrames:number[]; downbeatFrames:number[]; dropFrames:number[]; confidence:'high'|'low'|null};
  voice:Voice|null;
  shots:Shot[]; gates:Gate[]; critique:Critique[];
};
export type Critique = {
  loop:number; revisionHash:string; filmScores:Record<string,number>; shotScores:Record<string,Record<string,number>>;
  worstIssues:{shot:string; frame:number; term:string; issue:string; repair:string}[];
  stillMatches:{shot:string; frame:number; status:'match'|'drift'|'departure'; reason:string}[];
};
export const sourceKinds = ['heygen','website','stock','code','ai-image','data','video-model'] as const;
export type SourceKind = typeof sourceKinds[number];
export const licenseStatuses = ['known','unknown','restricted'] as const;
export type LedgerAsset = {
  id:string; type:string; sourceKind:SourceKind; sourceUrlOrGenerator:string; providerAssetId:string|null;
  license:{status:typeof licenseStatuses[number]; name:string|null; evidence:string};
  localPath:string; sha256:string; shots:string[];
  speech?:{voiceId:string; text:string}; // generated narration: the provider voice id and the spoken text
};
export type Ledger = {version:'0'; assets:LedgerAsset[]};
export type Project = {root:string; storyboard:Storyboard; ledger:Ledger};
/** Result of reading a film folder: either both files passed the schema, or a list of problems. */
export type ParseResult = {ok:true; project:Project}|{ok:false; errors:string[]};

/** An expected failure caused by user input or project state. The CLI prints its message without a stack trace. */
export class CliError extends Error {}

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
  // The ledger schema's only if/then rule: a known license must name the license.
  if (e.schemaPath.includes('/license/then/')) return `${file} ${e.instancePath.replace(/\/name$/,'')}: a known license needs a non-empty name`;
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

/** Schema errors of one project file's parsed value, in the wording `validate` prints. */
export async function schemaErrors(file:'storyboard.json'|'ledger.json', value:unknown):Promise<string[]> {
  const validate = await schema(file === 'storyboard.json' ? 'storyboard' : 'ledger');
  if (validate(value)) return [];
  // anyOf branches produce one error per branch; keep each message once.
  return [...new Set((validate.errors ?? []).filter(e => e.keyword !== 'anyOf' && e.keyword !== 'if').map(e => describe(file,e)))];
}

/** Reads storyboard.json and ledger.json from a film root and checks both against their JSON Schemas. */
export async function parseProject(filmRoot:string):Promise<ParseResult> {
  const root = resolve(filmRoot);
  const errors:string[] = [];
  const storyboard = await readJson(root,'storyboard.json',errors);
  const ledger = await readJson(root,'ledger.json',errors);
  for (const [file,value] of [['storyboard.json',storyboard],['ledger.json',ledger]] as const) {
    if (value !== undefined) errors.push(...await schemaErrors(file,value));
  }
  if (errors.length) return {ok:false, errors};
  // Both values passed their schemas above, which define exactly these types.
  return {ok:true, project:{root, storyboard:storyboard as Storyboard, ledger:ledger as Ledger}};
}

export function emptyStoryboard():Storyboard {
  return {
    version:'0',
    meta:{title:'', logline:'', genre:null, formats:{primary:'16:9', extra:[]}, fps:30, durationFrames:0, layouts:{'16:9':{canvas:{width:1920, height:1080}, safe:{x:96, y:54, width:1728, height:972}, overlay:null}}},
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
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) throw new CliError(`invalid slug "${slug}": use lowercase letters, digits and hyphens`);
  const root = join(resolve(cwd),'films',slug);
  const existing = await readdir(root).catch(() => null);
  if (existing !== null) throw new CliError(`${root} already exists; init never overwrites a project`);
  for (const dir of projectDirs) await mkdir(join(root,dir),{recursive:true});
  await writeFile(join(root,'storyboard.json'),JSON.stringify(emptyStoryboard(),null,2)+'\n');
  await writeFile(join(root,'ledger.json'),JSON.stringify({version:'0', assets:[]} satisfies Ledger,null,2)+'\n');
  await writeFile(join(root,'BRIEF.md'),`# Brief\n\n${briefSections.map(s => `<${s}>\n</${s}>`).join('\n\n')}\n`);
  return root;
}

/** Writes storyboard.json through a hidden temp file and a rename, so a failed write never leaves a partial file. */
export async function writeStoryboard(root:string, storyboard:Storyboard):Promise<void> {
  const temp = join(root,'.storyboard.json.tmp');
  await writeFile(temp,JSON.stringify(storyboard,null,2)+'\n');
  await rename(temp,join(root,'storyboard.json'));
}

/** Folder name of a format under renders/: `16x9`, `9x16` or `1x1`. A colon is not portable in file names. */
export const formatDir = (format:Format) => format.replace(':','x');
/** Primary format first, then the extra formats in their declared order. */
export const chosenFormats = ({formats}:Storyboard['meta']):Format[] => [formats.primary, ...formats.extra];
/** The layout of a chosen format. `validate` guarantees every chosen format has one. */
export function layoutOf(storyboard:Storyboard, format:Format):Layout {
  const layout = storyboard.meta.layouts[format];
  if (!layout) throw new CliError(`meta.layouts has no layout for format ${format}`);
  return layout;
}
