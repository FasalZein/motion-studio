import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {copyFile, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile} from 'node:fs/promises';
import {basename, dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import AjvModule from 'ajv';
import {chosenFormats, CliError, formatDir, layoutOf, type Project} from './project.js';
import {canonical, gateViews} from './gates.js';
import {outputsOf} from './outputs.js';
import {renderSources, requireCurrentRenders} from './sources.js';
import {requireMaster, type Tools} from './seam.js';
import {sheet} from './sheet.js';
import {loopCheck} from './loopcheck.js';

export type Quality = 'draft'|'final';
type Decision = {note:string; at:string};
type LicenseDecision = {asset:string; sha256:string; status:'unknown'|'restricted'; reason:string};
/** Delivery is separate from gate decisions: a rendered bundle still needs acceptance of its exact file hashes. */
export type DeliveryRecord = {
  version:1; quality:Quality; inputHash:string; files:Record<string,string>; createdAt:string;
} & ({quality:'draft'; state:'rendered'} | {quality:'final'; cost:Decision; licenses:LicenseDecision[]} &
  ({state:'rendered'} | {state:'accepted'; acceptance:Decision}));

const usage = 'usage: motion-studio deliver <film-dir> --quality <draft|final> [--cost-note <director words>] [--ack-license <asset-id> <director reason>]...';
const profiles = {draft:{crf:'23',preset:'veryfast'}, final:{crf:'16',preset:'slow'}};
const manifestPath = (root:string, quality:Quality) => join(root,'delivery',quality,'manifest.json');
async function sha256(file:string):Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
const textHash = (text:string) => createHash('sha256').update(text).digest('hex');

function argsOf(args:string[]):{quality:Quality; cost:string|null; acknowledgments:Map<string,string>} {
  let quality:Quality|undefined, cost:string|null = null;
  const acknowledgments = new Map<string,string>();
  for (let i=0;i<args.length;) {
    const flag = args[i++], value = args[i++];
    if (!value?.trim()) throw new CliError(usage);
    if (flag === '--quality' && (value === 'draft' || value === 'final') && quality === undefined) quality = value;
    else if (flag === '--cost-note' && cost === null) cost = value;
    else if (flag === '--ack-license' && !acknowledgments.has(value)) {
      const reason = args[i++];
      if (!reason?.trim()) throw new CliError('--ack-license needs an asset id and the director\'s written reason');
      acknowledgments.set(value,reason);
    } else throw new CliError(usage);
  }
  if (!quality || (quality === 'draft' && (cost !== null || acknowledgments.size))) throw new CliError(usage);
  return {quality,cost,acknowledgments};
}

/** Live masters and mixes plus source/ledger/board and G5 hashes: frozen G5 media alone cannot prove a final is current. */
async function inputHash(project:Project):Promise<string> {
  const {gates:_, critique:__, ...storyboard} = project.storyboard;
  const renders = [];
  for (const format of chosenFormats(project.storyboard.meta)) {
    const out = outputsOf(project.root,format);
    renders.push({format, sources:await renderSources(project,format), master:await sha256(out.master),
      mix:await sha256(join(out.dir,'mix.wav')), mux:await sha256(join(out.dir,'final.mkv'))});
  }
  return textHash(canonical({storyboard, ledger:project.ledger, renders,
    g5:project.storyboard.gates.find(g => g.id === 'G5')?.inputHashes ?? {}}));
}

async function requireApprovals(project:Project, quality:Quality) {
  const views = await gateViews(project);
  const through = quality === 'final' ? 'G5' : 'G3';
  const required = ['G1','G2','G3',...(quality === 'final' ? ['G4','G5'] : [])];
  for (const id of required) {
    const view = views.find(v => v.gate.id === id);
    if (view?.state !== 'approved') throw new CliError(`deliver ${quality} needs current approvals through ${through}: ${id} is ${view?.state ?? 'missing'}`);
  }
}

async function mediaCheck(project:Project, file:string, format:Parameters<typeof outputsOf>[1], tools:Tools) {
  const data = JSON.parse(await tools.command('ffprobe',['-v','error','-count_frames','-show_entries',
    'stream=codec_name,codec_type,pix_fmt,width,height,nb_read_frames,sample_rate,channels,r_frame_rate','-of','json',file]));
  const streams:Record<string,string|number>[] = data.streams ?? [];
  const video = streams.filter(s => s.codec_type === 'video'), audio = streams.filter(s => s.codec_type === 'audio');
  const {meta} = project.storyboard, {width,height} = layoutOf(project.storyboard,format).canvas;
  if (video.length !== 1 || audio.length !== 1 || video[0].codec_name !== 'h264' || video[0].pix_fmt !== 'yuv420p' ||
      video[0].width !== width || video[0].height !== height || Number(video[0].nb_read_frames) !== meta.durationFrames ||
      video[0].r_frame_rate !== `${meta.fps}/1` || audio[0].codec_name !== 'aac' || Number(audio[0].sample_rate) !== 48000 || audio[0].channels !== 2)
    throw new CliError(`delivery media check failed: ${file}`);
}

/** Refuse stale manually retained muxes: mix stream-copies the master picture and PCM master audio. */
async function requireCurrentMux(out:ReturnType<typeof outputsOf>, tools:Tools) {
  const hash = async (file:string, stream:string) => (await tools.command('ffmpeg',['-hide_banner','-loglevel','error','-nostdin','-i',file,
    '-map',stream,'-f','hash','-hash','sha256','-'])).trim();
  const mux = join(out.dir,'final.mkv');
  if (await hash(out.master,'0:v:0') !== await hash(mux,'0:v:0')) throw new CliError(`mix picture is stale: ${out.format}; run mix again`);
  if (await hash(join(out.dir,'mix.wav'),'0:a:0') !== await hash(mux,'0:a:0')) throw new CliError(`mix audio is stale: ${out.format}; run mix again`);
}

export async function deliver(project:Project, args:string[], tools:Tools):Promise<string[]> {
  const {quality,cost,acknowledgments} = argsOf(args);
  await requireApprovals(project,quality);
  const unresolved = project.ledger.assets.filter(a => a.license.status !== 'known');
  const licenses:LicenseDecision[] = [];
  if (quality === 'final') {
    if (!cost?.trim()) throw new CliError('final delivery needs --cost-note with the director\'s approval of the shown render cost');
    for (const id of acknowledgments.keys()) if (!unresolved.some(a => a.id === id)) throw new CliError(`--ack-license ${id}: not an unresolved ledger asset`);
    for (const asset of unresolved) {
      const reason = acknowledgments.get(asset.id);
      if (!reason) throw new CliError(`final delivery blocked: ${asset.id} license is ${asset.license.status}; replace it or use --ack-license ${asset.id} <director reason>`);
      if (asset.license.status !== 'known') licenses.push({asset:asset.id, sha256:asset.sha256, status:asset.license.status, reason});
    }
  }
  const formats = chosenFormats(project.storyboard.meta);
  // Preflight every format before deleting an old receipt or producing any new bundle.
  for (const format of formats) {
    const out = outputsOf(project.root,format);
    if (quality === 'final') {
      const shown = project.storyboard.gates.find(g => g.id === 'G5')!.inputHashes[`renders/${formatDir(format)}/final.mkv`];
      if (!shown || await sha256(join(out.dir,'final.mkv')) !== shown)
        throw new CliError(`final mux differs from G5 approval: ${format}; present G5 again`);
    }
    await requireCurrentRenders(project,out);
    await requireMaster(project,out,tools);
    await requireCurrentMux(out,tools);
  }
  const before = await inputHash(project);
  const base = join(project.root,'delivery');
  await mkdir(base,{recursive:true});
  await rm(manifestPath(project.root,quality),{force:true});
  const staging = await mkdtemp(join(base,'.motion-delivery-'));
  const lines:string[] = [];
  try {
    const files:Record<string,string> = {};
    const add = async (rel:string) => {files[`delivery/${quality}/${rel}`] = await sha256(join(staging,rel));};
    for (const format of formats) {
      const out = outputsOf(project.root,format), folder = formatDir(format), dir = join(staging,folder);
      await mkdir(dir);
      const mp4 = join(dir,'film.mp4'), profile = profiles[quality];
      await tools.command('ffmpeg',['-hide_banner','-loglevel','error','-nostdin','-y','-i',join(out.dir,'final.mkv'),
        '-map','0:v:0','-map','0:a:0','-fps_mode','passthrough','-c:v','libx264','-crf',profile.crf,'-preset',profile.preset,
        '-pix_fmt','yuv420p','-colorspace','bt709','-color_trc','bt709','-color_primaries','bt709','-c:a','aac','-b:a','192k','-ar','48000','-ac','2',
        '-movflags','+faststart',mp4]);
      await mediaCheck(project,mp4,format,tools);
      await tools.command('ffmpeg',['-hide_banner','-loglevel','error','-nostdin','-y','-i',mp4,'-frames:v','1',join(dir,'poster.png')]);
      lines.push(await sheet(project,out,tools));
      for (const file of await readdir(out.dir)) if (/^(contact-sheet-\d{3}\.png|transition-.+\.png|sheet\.json)$/.test(file)) await copyFile(join(out.dir,file),join(dir,file));
      if (project.storyboard.meta.genre === 'ui-morph-loop') {
        await loopCheck(project,format,join(dir,'loop.json'),tools);
        lines.push(`loop ${format}: measured picture and audio seam; inspect loop.json and listen to repeated playback`);
      }
      for (const file of await readdir(dir)) await add(`${folder}/${file}`);
      if (quality === 'draft') {
        await copyFile(mp4,join(out.dir,'draft.mp4'));
        await copyFile(join(dir,'poster.png'),join(out.dir,'poster.png'));
      }
      lines.push(`deliver ${quality} ${format}: H.264/AAC ${project.storyboard.meta.durationFrames} frames, CRF ${profile.crf} -> delivery/${quality}/${folder}/film.mp4`);
    }
    await copyFile(join(project.root,'ledger.json'),join(staging,'ledger.json'));
    await writeFile(join(staging,'SOURCE-README.md'),`# ${project.storyboard.meta.title}\n\nQuality: ${quality} (H.264 CRF ${profiles[quality].crf}, AAC 192 kbps, 48 kHz stereo).\n\nSource film: ${basename(project.root)}\nResolve these paths from the original film folder, not this bundle:\n${project.storyboard.shots.map(s => `- shots/${s.id}: ${s.engine}, entrypoint ${s.entrypoint}`).join('\n')}\n- storyboard.json: timeline, layouts, audio and gate decisions\n- ledger.json and its localPath entries: asset provenance and license evidence\n- BRIEF.md; beatmap.md; style-bible.md when used\n\nRebuild: motion-studio render <film-dir>; stitch <film-dir>; handoff <film-dir>; mix <film-dir>; deliver <film-dir> --quality draft.\nFinal encoding needs current G5 approval, explicit cost consent and each unresolved-license acknowledgment.\nPinned engine versions and install commands: motion-studio CLI README. Source files remain in the original film folder.\nRemotion needs a paid company license for companies with more than three people.\nLoop reports are measurements, not proof of a seamless loop: inspect repeated picture and audio playback.\n`);
    await add('ledger.json'); await add('SOURCE-README.md');
    if (await inputHash(project) !== before) throw new CliError('film changed during delivery; rerun the checks and deliver again');
    const common = {version:1 as const, inputHash:before, files, createdAt:new Date().toISOString()};
    const record:DeliveryRecord = quality === 'draft' ? {...common, quality, state:'rendered'} :
      {...common, quality, state:'rendered', cost:{note:cost!, at:new Date().toISOString()}, licenses};
    await writeFile(join(staging,'manifest.json'),JSON.stringify(record,null,2)+'\n');
    await rm(join(base,quality),{recursive:true,force:true});
    await rename(staging,join(base,quality));
  } finally {await rm(staging,{recursive:true,force:true});}
  return [...lines, ...(quality === 'final' ? ['final bundle rendered; show the files and run accept only after the director accepts them'] : [])];
}

async function readRecord(root:string):Promise<DeliveryRecord|null> {
  let text:string;
  try {text = await readFile(manifestPath(root,'final'),'utf8');}
  catch (e) {if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null; throw e;}
  let raw:unknown;
  try {raw = JSON.parse(text);} catch {throw new CliError('invalid delivery/final/manifest.json: invalid JSON');}
  const schemaFile = resolve(dirname(fileURLToPath(import.meta.url)),'../schema/delivery.schema.json');
  const validate = new AjvModule.default({allErrors:true}).compile<DeliveryRecord>(JSON.parse(await readFile(schemaFile,'utf8')));
  if (!validate(raw) || raw.quality !== 'final') throw new CliError('invalid delivery/final/manifest.json: schema mismatch');
  return raw;
}

async function currentRecord(project:Project, record:DeliveryRecord):Promise<boolean> {
  const views = await gateViews(project);
  if (views.length !== 5 || views.some(v => v.state !== 'approved')) return false;
  if (await inputHash(project).catch(() => null) !== record.inputHash) return false;
  for (const [file,hash] of Object.entries(record.files)) if (await sha256(join(project.root,file)).catch(() => null) !== hash) return false;
  return true;
}

/** Status recomputes real file hashes; an altered bundle or master never retains accepted status. */
export async function deliveryStatus(project:Project):Promise<{lines:string[]; next?:string}> {
  const record = await readRecord(project.root);
  if (!record) return {lines:[]};
  if (!await currentRecord(project,record)) return {lines:['delivery final stale (film inputs or bundle files changed)'], next:'rerun final delivery, then request user acceptance of the files'};
  if (record.state === 'accepted') return {lines:[`delivery final accepted (${record.acceptance.note})`], next:'delivery complete; accepted files match the final bundle'};
  return {lines:['delivery final rendered; acceptance pending'], next:'show the final bundle, then record user acceptance with motion-studio accept'};
}

export async function acceptDelivery(project:Project, args:string[]):Promise<string[]> {
  if (args.length !== 2 || args[0] !== '--note' || !args[1]?.trim()) throw new CliError('usage: motion-studio accept <film-dir> --note <director words>');
  await requireApprovals(project,'final');
  const record = await readRecord(project.root);
  if (!record || record.quality !== 'final') throw new CliError('accept needs a successful final delivery; run deliver --quality final first');
  if (!await currentRecord(project,record)) throw new CliError('final delivery is stale: film inputs or bundle files changed; deliver again before acceptance');
  const accepted:DeliveryRecord = {...record, state:'accepted', acceptance:{note:args[1], at:new Date().toISOString()}};
  const target = manifestPath(project.root,'final'), temp = `${target}.tmp`;
  await writeFile(temp,JSON.stringify(accepted,null,2)+'\n');
  await rename(temp,target);
  return ['recorded final file acceptance: exact bundle hashes verified'];
}
