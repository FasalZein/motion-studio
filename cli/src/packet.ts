import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {access, mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile} from 'node:fs/promises';
import {basename, join, relative} from 'node:path';

import {CliError, formatDir, type Format, type Project} from './project.js';
import {frozenDir, revisionId} from './gates.js';
import type {Outputs} from './outputs.js';
import {scanVideo, type ScanReport} from './scan.js';
import {tile, tiling, SHEET_COLUMNS} from './sheet.js';
import {round3, type Tools} from './seam.js';
import {soundScore, type SyncReport} from './sound.js';

/**
 * `packet`: gathers the motion-critique evidence packet into one index, `packet.json`. Every item it cannot find is
 * listed under `missing` with the judgments it leaves unverified; the packet never fills a gap with a guess.
 */
type Missing = {item:string; unverified:string[]; action:string};

const exists = (path:string) => access(path).then(() => true,() => false);
async function sha256(file:string):Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
const readJson = async (file:string):Promise<any> => JSON.parse(await readFile(file,'utf8'));
/** Writes the exact frame `frame` (zero-based) of `video` as a full-size PNG. */
const extractFrame = (tools:Tools, video:string, frame:number, file:string) =>
  tools.command('ffmpeg',['-hide_banner','-loglevel','error','-nostdin','-y','-i',video,'-vf',`select='eq(n\\,${frame})'`,'-fps_mode','passthrough','-frames:v','1','-pix_fmt','rgb24',file]);

/** Replaces `dir` with what `build` writes into a staging folder, so a failed run leaves no half packet. */
async function replaceDir(dir:string, build:(staging:string) => Promise<void>) {
  await mkdir(join(dir,'..'),{recursive:true});
  const staging = await mkdtemp(join(dir,'..',`.motion-packet-`));
  try {
    await build(staging);
    await rm(dir,{recursive:true,force:true});
    await rename(staging,dir);
  } finally {await rm(staging,{recursive:true,force:true});}
}

/** Film mode: one packet per format in `critique/packet-<format>/`. */
export async function filmPacket(project:Project, out:Outputs, tools:Tools):Promise<string> {
  const {root, storyboard:s} = project;
  const format:Format = out.format;
  const dir = join(root,'critique',`packet-${formatDir(format)}`);
  const rel = (p:string) => relative(root,p).split('\\').join('/');
  const missing:Missing[] = [];
  const hasMaster = await exists(out.master);
  if (!hasMaster) throw new CliError(`stitched master required before packet: ${rel(out.master)} (run render and stitch)`);
  const masterHash = await sha256(out.master);
  const final = join(out.dir,'final.mkv');
  let written = '';
  await replaceDir(dir, async staging => {
    // Brief, look and patterns: the reviewer reads these files; the packet names them and what is absent.
    const brief = await exists(join(root,'BRIEF.md')) ? 'BRIEF.md' : null;
    if (!brief) missing.push({item:'brief (BRIEF.md)', unverified:['6 message truth against the brief'], action:'write BRIEF.md'});
    if (!s.meta.logline.trim()) missing.push({item:'logline', unverified:['6 message truth','2 continuity against the stated sequence'], action:'set meta.logline'});
    const styleBible = s.look.styleBible && await exists(join(root,s.look.styleBible)) ? s.look.styleBible : null;
    if (s.look.id === null && !styleBible) missing.push({item:'look or style bible', unverified:['1 distinctiveness against the chosen look'], action:'record the chosen look in storyboard look'});
    const tasteSnapshot = s.look.tasteSnapshot && await exists(join(root,s.look.tasteSnapshot)) ? s.look.tasteSnapshot : null;

    // Frozen approved stills beside the exact rendered frame (D43): the copies in stills/approved/G2-<hash8>/<format>/.
    const g2 = s.gates.find(g => g.id === 'G2');
    const stillPairs:{shot:string; localFrame:number; globalFrame:number; approved:string; rendered:string}[] = [];
    if (g2?.state === 'approved') {
      const frozen = join(frozenDir('G2',g2.inputHashes),formatDir(format));
      for (const file of (await readdir(join(root,frozen)).catch(() => [] as string[])).sort()) {
        const m = /^(.+)-f(\d+)\.png$/.exec(file);
        const shot = m && s.shots.find(x => x.id === m[1]);
        if (!m || !shot) continue;
        const localFrame = Number(m[2]), globalFrame = shot.startFrame+localFrame;
        const rendered = `pairs/${shot.id}-f${m[2]}-render.png`;
        await mkdir(join(staging,'pairs'),{recursive:true});
        await extractFrame(tools,out.master,globalFrame,join(staging,rendered));
        stillPairs.push({shot:shot.id, localFrame, globalFrame, approved:`${frozen}/${file}`, rendered:`${rel(dir)}/${rendered}`});
      }
    }
    if (!stillPairs.length) missing.push({item:'frozen approved stills', unverified:['still match, drift or departure'], action:g2?.state === 'approved' ? `no frozen stills for ${format} in the G2 approval` : 'approve G2 (stills) first'});

    // Sheets and strips: render and stitch delete them, so an existing sheet.json describes this master.
    const sheetFile = join(out.dir,'sheet.json');
    const sheet = await exists(sheetFile) ? await readJson(sheetFile) : null;
    if (!sheet) missing.push({item:'contact sheet and transition strips', unverified:['1 distinctiveness','2 continuity and pacing','3 motion quality at cuts','8 technical finish at cuts'], action:`motion-studio sheet <film-dir> ${format}`});

    // Scan: render and stitch keep an old report, so its master hash must match.
    const scanFile = join(out.dir,'scan.json');
    const scan = await exists(scanFile) ? await readJson(scanFile) as ScanReport : null;
    const scanCurrent = scan !== null && scan.sha256 === masterHash;
    if (!scanCurrent) missing.push({item:scan ? 'scan report (describes an earlier master)' : 'scan report', unverified:['8 technical finish'], action:`motion-studio scan <film-dir> ${format}`});
    const defects = scanCurrent ? scan.flags.filter(f => f.status === 'defect') : [];

    // Beat grid and sync report: mix outputs are deleted by render and stitch, so sync.json describes this master.
    const syncFile = join(out.dir,'sync.json');
    const sync = await exists(syncFile) ? await readJson(syncFile) as SyncReport : null;
    if (!sync) missing.push({item:'mix sync report', unverified:['7 sound and sync'], action:`motion-studio mix <film-dir> ${format}`});
    if (s.audio.grid === null) missing.push({item:'beat grid', unverified:['cut-to-beat offsets in 7'], action:'motion-studio beats <film-dir>'});
    const handoffs = (await readdir(out.dir)).filter(f => /^handoff-.+\.json$/.test(f)).sort().map(f => rel(join(out.dir,f)));
    const declared = s.shots.slice(1).filter(x => x.entry === 'handoff').length;
    if (declared && !handoffs.length) missing.push({item:'handoff reports', unverified:['8 technical finish at handoff seams'], action:`motion-studio handoff <film-dir> ${format}`});
    const ledger = await exists(join(root,'ledger.json')) ? 'ledger.json' : null;

    const draft = await exists(final) ? rel(final) : rel(out.master);
    const packet = {
      mode:'in-studio', format, fps:s.meta.fps, durationFrames:s.meta.durationFrames,
      render:{draft, master:rel(out.master), masterSha256:masterHash, readableVideo:'only when the harness can read video; otherwise continuous motion and listening are unverified'},
      revisionHashes:Object.fromEntries(s.gates.filter(g => g.state === 'approved').map(g => [g.id,revisionId(g.inputHashes)])),
      logline:s.meta.logline, genre:s.meta.genre, brief,
      shots:s.shots.map(x => ({id:x.id, startFrame:x.startFrame, endFrame:x.endFrame, description:x.description, entry:x.entry, ...(x.offBeatCut === undefined ? {} : {offBeatCut:x.offBeatCut})})),
      look:{id:s.look.id, axes:s.look.axes, styleBible, tasteSnapshot},
      patterns:'load motion-look: the shared template pattern -> replacement list plus the pairs of look ' + (s.look.id ?? '(none chosen)'),
      stillPairs,
      sheet:sheet ? {index:rel(sheetFile), pages:sheet.contact.pages.map((p:{file:string; frames:number[]}) => ({file:rel(join(out.dir,p.file)), frames:p.frames})), strips:sheet.strips.map((x:{file:string; shots:string[]; cut:number; frames:number[]}) => ({...x, file:rel(join(out.dir,x.file))}))} : null,
      scan:scanCurrent ? {report:rel(scanFile), counts:scan.counts, flags:defects.map(f => ({kind:f.kind, severity:f.severity, frame:f.frame, frames:f.frames, shot:f.shot, localFrame:f.localFrame}))} : null,
      beatGrid:{grid:s.audio.grid, bpm:s.audio.bpm, confidence:s.audio.confidence, beatFrames:s.audio.beatFrames, downbeatFrames:s.audio.downbeatFrames, dropFrames:s.audio.dropFrames},
      sync:sync ? {report:rel(syncFile), integratedLufs:sync.integratedLufs, truePeakDbtp:sync.truePeakDbtp, sfx:sync.sfx, cuts:sync.cuts} : null,
      dimension7:soundScore(sync),
      handoffs, ledger,
      missing,
    };
    await writeFile(join(staging,'packet.json'),JSON.stringify(packet,null,2)+'\n');
    const blocking = scanCurrent ? scan.counts.blocking : 0;
    written = `packet ${format}: ${stillPairs.length} still pair${stillPairs.length === 1 ? '' : 's'}, ${missing.length} missing item${missing.length === 1 ? '' : 's'}, dimension 7 ${packet.dimension7.score}${blocking ? `, ${blocking} blocking scan flag${blocking === 1 ? '' : 's'} (repair before review)` : ''} (${rel(dir)}/packet.json)`;
  });
  return written;
}

/** Checks standalone review cannot make without a brief, board, beat grid or ledger (SPEC: standalone mode). */
export const STANDALONE_IMPOSSIBLE:Missing[] = [
  {item:'brief and logline', unverified:['6 message truth: the intended message','2 continuity against the stated sequence'], action:'ask the creator for the brief'},
  {item:'look or style bible', unverified:['1 distinctiveness against a chosen look (judge against the shared pattern list only)'], action:'ask for the look or style bible'},
  {item:'board (approved stills)', unverified:['still match, drift or departure'], action:'none: a lone video has no approved board'},
  {item:'declared cuts, holds and effects', unverified:['transition strips at declared cuts (scan color jumps are candidate cuts)','scan context: every flag is a question'], action:'ask for the edit decision list'},
  {item:'beat grid', unverified:['cut-to-beat offsets in 7'], action:'ask for the beat grid'},
  {item:'SFX placement record', unverified:['SFX hit offsets in 7'], action:'ask for the mix session'},
  {item:'asset ledger', unverified:['6 claim provenance','SFX source'], action:'ask for the sources'},
];

/** Standalone mode: a packet for any video file, with contact pages, a context-free scan and measured loudness. */
export async function videoPacket(video:string, args:string[], tools:Tools):Promise<string> {
  if (args.length !== 2 || args[0] !== '--out' || !args[1]) throw new CliError('usage: motion-studio packet <video-file> --out <dir>');
  const dir = args[1];
  const probe = JSON.parse(await tools.command('ffprobe',['-v','error','-show_entries','stream=codec_type,r_frame_rate,width,height','-of','json',video]).catch(() => {throw new CliError(`cannot read video ${video}`);}));
  const streams:{codec_type:string; r_frame_rate?:string; width?:number; height?:number}[] = probe.streams ?? [];
  const v = streams.find(x => x.codec_type === 'video');
  if (!v) throw new CliError(`no video stream in ${video}`);
  const [num,den] = String(v.r_frame_rate).split('/').map(Number);
  const fps = round3(num/(den || 1));
  let written = '';
  await replaceDir(dir, async staging => {
    const scan = await scanVideo({video, label:basename(video), fps, expectedFrames:null, shots:[]}, tools);
    await writeFile(join(staging,'scan.json'),JSON.stringify(scan,null,2)+'\n');
    const frames = scan.frameCount.decoded;
    // One sample per whole second: the frame nearest each second, like `sheet`, paged 5 x 5.
    const samples = [...new Set(Array.from({length:Math.ceil(frames/fps)},(_,k) => Math.round(k*fps)))].filter(f => f < frames);
    const perPage = SHEET_COLUMNS*SHEET_COLUMNS;
    const {scale} = tiling(v.width!,v.height!);
    const select = samples.map(f => `eq(n\\,${f})`).join('+');
    await tools.command('ffmpeg',['-hide_banner','-loglevel','error','-nostdin','-y','-i',video,'-vf',`select='${select}',${scale},${tile(SHEET_COLUMNS,SHEET_COLUMNS)}`,'-fps_mode','passthrough','-pix_fmt','rgb24',join(staging,'contact-sheet-%03d.png')]);
    const pages = Array.from({length:Math.ceil(samples.length/perPage)},(_,p) => ({file:`contact-sheet-${String(p+1).padStart(3,'0')}.png`, frames:samples.slice(p*perPage,(p+1)*perPage)}));
    const audio = streams.some(x => x.codec_type === 'audio');
    let loudness:{integratedLufs:number; truePeakDbtp:number}|null = null;
    if (audio) {
      const log = await tools.command('ffmpeg',['-hide_banner','-nostats','-i',video,'-map','0:a:0','-af','ebur128=peak=true','-f','null','-']);
      const lufs = Number(/Integrated loudness:\s*I:\s*(-?[\d.]+) LUFS/.exec(log)?.[1]);
      const peak = /True peak:\s*Peak:\s*(-?[\d.]+|-inf) dBFS/.exec(log)?.[1];
      if (Number.isFinite(lufs) && peak !== undefined) loudness = {integratedLufs:lufs, truePeakDbtp:peak === '-inf' ? -Infinity : Number(peak)};
    }
    const missing = [...STANDALONE_IMPOSSIBLE, ...(audio ? [] : [{item:'audio stream', unverified:['7 sound and sync','loudness'], action:'none: the video has no audio'}])];
    const packet = {
      mode:'standalone', video, sha256:scan.sha256, fps, frames,
      contactSheets:pages,
      scan:{report:'scan.json', counts:scan.counts, flags:scan.flags.map(f => ({kind:f.kind, severity:f.severity, frame:f.frame, frames:f.frames}))},
      loudness,
      dimension7:soundScore(null,'standalone: no mix sync report, so hit and cut offsets are unverified'),
      impossible:missing,
      missing,
    };
    await writeFile(join(staging,'packet.json'),JSON.stringify(packet,null,2)+'\n');
    written = `packet standalone: ${pages.length} contact page${pages.length === 1 ? '' : 's'}, scan ${scan.counts.blocking} blocking and ${scan.counts.advisory} advisory, ${missing.length} impossible checks (${join(dir,'packet.json')})`;
  });
  return written;
}
