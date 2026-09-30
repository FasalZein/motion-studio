#!/usr/bin/env node
import {readFile, mkdir, mkdtemp, rename, rm, stat, writeFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';

import {chosenFormats, CliError, gateIds, initProject, layoutOf, parseProject, waivable, type Format, type Project, type Shot, type Waivable} from './project.js';
import {checkProject, validateProject} from './validate.js';
import {repro} from './repro.js';
import {framePngs, glBackend, hyperframesGpu, remotionBundle, renderHyperframesFrames, renderRemotionFrames} from './engines.js';
import {safezone, safezoneArgs} from './safezone.js';
import {statusLines} from './status.js';
import {decisions, gateViews, recordGate} from './gates.js';
import {handoffFilm} from './handoff.js';
import {mix, prepareMix} from './mix.js';
import {beats} from './beats.js';
import {clearSeamOutputs} from './seam.js';
import {assets} from './assets.js';
import {doctor} from './doctor.js';
import {configuredProviders} from './providers.js';
import {boardStills, captureStills, stillsArgs} from './stills.js';
import {animatic} from './animatic.js';
import {renderSources} from './sources.js';
import {clearSheetOutputs, sheet} from './sheet.js';
import {outputsOf, type Outputs} from './outputs.js';
import {scanFile, scanFilm} from './scan.js';
import {livenessFilm, livenessLines, livenessVideo} from './liveness.js';
import {taste} from './taste.js';
import {styleBible} from './stylebible.js';
import {requireOpaque} from './opaque.js';
import {beatMap} from './voice.js';
import {filmPacket, videoPacket} from './packet.js';
import {calibrate} from './bands.js';
import {looktest} from './looktest.js';
import {acceptDelivery, deliver, deliveryStatus} from './delivery.js';

const configuredTimeout = process.env.MOTION_STUDIO_CHILD_TIMEOUT_MS;
const timeoutMs = configuredTimeout === undefined ? 120_000 : Number(configuredTimeout);
if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw Error('invalid child timeout');

/** Prints findings as `error:` and `warning:` lines on stderr. */
function report(errors:string[], warnings:string[]) {
  for (const w of warnings) console.error(`warning: ${w}`);
  for (const e of errors) console.error(`error: ${e}`);
}
/**
 * Loads a film folder for a render command; any structural error stops the command before it writes anything.
 * Gate staleness is not checked here (D44); `validate` reports it.
 */
async function loadProject(filmRoot:string, shots?:string[]):Promise<Project> {
  const {errors,warnings,project} = await validateProject(filmRoot,{gates:false, shots});
  report(errors,warnings);
  if (errors.length || !project) throw new CliError(`invalid project ${resolve(filmRoot)}: ${errors.length} error${errors.length === 1 ? '' : 's'}`);
  return project;
}
async function command(bin:string,args:string[],cwd?:string):Promise<string> {
  return new Promise((ok,fail) => {
    const child = spawn(bin,args,{cwd,detached:process.platform !== 'win32',stdio:['ignore','pipe','pipe']});
    let output = '';
    child.stdout.on('data',d => { output += d; });
    child.stderr.on('data',d => { output += d; });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      if (child.pid && process.platform !== 'win32') { try {process.kill(-child.pid, 'SIGKILL');} catch {} }
      else child.kill('SIGKILL');
    },timeoutMs);
    child.on('error',err => {clearTimeout(timer); fail(err);});
    child.on('close',code => {clearTimeout(timer); code === 0 && !timedOut ? ok(output) : fail(Error(timedOut ? `${bin} timed out after ${timeoutMs} ms` : `${bin} exited ${code}: ${output.slice(-3500)}`));});
  });
}
async function verify(path:string, expected:number, fps:number, width:number, height:number) {
  const audio = JSON.parse(await command('ffprobe',['-v','error','-select_streams','a','-show_entries','stream=index','-of','json',path]));
  if (audio.streams?.length) throw new CliError(`audio stream in video-only clip: ${path}`);
  const data = JSON.parse(await command('ffprobe',['-v','error','-select_streams','v:0','-count_frames','-show_entries','stream=nb_read_frames,width,height,codec_name,pix_fmt,color_space,color_transfer,color_primaries:frame=best_effort_timestamp_time','-show_frames','-of','json',path]));
  const video = data.streams?.[0];
  if (Number(video?.nb_read_frames) !== expected || data.frames?.length !== expected || video.width !== width || video.height !== height || video.codec_name !== 'ffv1' || video.pix_fmt !== 'yuv444p' || video.color_space !== 'bt709' || video.color_transfer !== 'bt709' || video.color_primaries !== 'bt709') throw new CliError(`media contract failed: ${path}`);
  for (let i=0;i<expected;i++) {
    const timestamp = data.frames[i].best_effort_timestamp_time;
    if (timestamp === undefined || timestamp === null || timestamp === '' || !Number.isFinite(Number(timestamp)) || Math.abs(Number(timestamp) - i/fps) > .0006) throw new CliError(`timestamp mismatch: ${path} frame ${i}`);
  }
}
async function renderShot(shot:Shot, project:Project, format:Format, output:string) {
  const {storyboard} = project;
  const {fps} = storyboard.meta;
  const {width,height} = layoutOf(storyboard,format).canvas;
  const frameCount = shot.endFrame-shot.startFrame;
  const temp = await mkdtemp(join(tmpdir(),'motion-shot-'));
  try {
    const frames = join(temp,'frames');
    await mkdir(frames);
    if (shot.engine === 'remotion') {
      const {serveUrl,dispose} = await remotionBundle(project,shot,false);
      try {await renderRemotionFrames(project,shot,serveUrl,{format,framesDir:frames});}
      finally {await dispose();}
    } else await renderHyperframesFrames(project,shot,{command,verify},{format,framesDir:frames});
    const pngs = await framePngs(shot,frames);
    await requireOpaque({command,verify},shot,format,pngs.map((png,frame) => ({frame, png})),temp);
    // Both renderers write numbered PNGs. Concat demuxer accepts their different numbering schemes.
    const list = join(temp,'frames.txt');
    await writeFile(list,pngs.map(p => `file '${p.replaceAll("'", "'\\''")}'`).join('\n')+'\n');
    await command('ffmpeg',['-hide_banner','-loglevel','error','-y','-r',String(fps),'-f','concat','-safe','0','-i',list,'-an','-vf','setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709','-c:v','ffv1','-level','3','-pix_fmt','yuv444p','-colorspace','bt709','-color_trc','bt709','-color_primaries','bt709',output]);
    await verify(output,frameCount,fps,width,height);
  } finally {await rm(temp,{recursive:true,force:true});}
}
const usage = 'usage: motion-studio doctor | init <slug> | validate <film-dir> | status <film-dir> | gate <film-dir> <G1-G5> <approve|changes|rescope> [--note <text>]... [--waive <liveness|critique> --note <reason>]... | deliver <film-dir> --quality <draft|final> [--cost-note <text>] [--ack-license <id> <reason>]... | accept <film-dir> --note <text> | render <film-dir> [format] | stitch <film-dir> [format] | still <film-dir> <shot-id> [local-frame] [format] | stills <film-dir> [<shot-id>...] [--frames <n,...>] [--format <format>] | animatic <film-dir> | sheet <film-dir> [format] | handoff <film-dir> [<shot-a> <shot-b>] [format] | mix <film-dir> [format] | safezone <film-dir> [format] [--shots <id,...>] | beats <film-dir> [--corrected <grid.json> | --imported <grid.json>] | beatmap <film-dir> | assets <film-dir> <list|add|resolve> ... | scan <film-dir> [format] | scan <video-file> [--report <file.json>] | liveness <film-dir> [format] | liveness <video-file> [--report <file.json>] | looktest <film-dir> <look-id> | packet <film-dir> [format] | packet <video-file> --out <dir> | calibrate <scores.json> <bands.json> | repro <film-dir> <shot-id> [format] | taste <show|g1|notes|accept> ... | style-bible <style-bible.md> [--reference <source>]...';
/** The formats a command works on: one named chosen format, or every chosen format when none is named. */
function selectFormats(project:Project, named:string|undefined):Format[] {
  const formats = chosenFormats(project.storyboard.meta);
  if (named === undefined) return formats;
  if (!(formats as string[]).includes(named)) throw new CliError(`format ${named} is not a chosen format (${formats.join(', ')})`);
  return [named as Format];
}
/** Renders every shot clip of one format into renders/<format>/shots/. */
async function renderFormat(project:Project, out:Outputs) {
  const {format} = out;
  const {root:base, storyboard:{shots}} = project;
  // The success marker must be absent throughout a rerender, even if old clips remain.
  await rm(out.marker,{force:true});
  await rm(out.master,{force:true});
  // Hashed before rendering, so a source edit during the render leaves the render stale.
  const sources = await renderSources(project,format);
  const staging = await mkdtemp(join(base,'.motion-render-'));
  try {
    for (const shot of shots) await renderShot(shot,project,format,join(staging,`${shot.id}.mkv`));
    await mkdir(out.shots,{recursive:true});
    for (const shot of shots) await rename(join(staging,`${shot.id}.mkv`),out.clip(shot.id));
    await writeFile(out.marker, JSON.stringify({format, renderer:{remotionGl:glBackend, hyperframesGpu}, shots:shots.map(s => ({id:s.id, startFrame:s.startFrame, endFrame:s.endFrame})), sources}));
  } finally {await rm(staging,{recursive:true,force:true});}
}
/** Captures one shot-local frame of one shot (default 0) into renders/<format>/shots/<shot-id>.png. */
async function stillFormat(project:Project, out:Outputs) {
  const shot = project.storyboard.shots.find(s => s.id === process.argv[4]);
  if (!shot) throw new CliError('unknown shot');
  const frame = Number(process.argv[5] ?? '0');
  if (!Number.isInteger(frame) || frame < 0 || frame >= shot.endFrame-shot.startFrame) throw new CliError('still frame outside shot');
  await captureStills(project,shot,out.format,[{frame, output:out.still(shot.id)}],{command,verify});
}
async function stitchFormat(project:Project, out:Outputs) {
  const {storyboard:{shots, meta:{fps}}} = project;
  const {format} = out;
  const {width,height} = layoutOf(project.storyboard,format).canvas;
  try {await readFile(out.marker,'utf8');}
  catch {throw new CliError(`successful render required before stitch: ${format}`);}
  for (const shot of shots) await verify(out.clip(shot.id),shot.endFrame-shot.startFrame,fps,width,height);
  const list = join(out.dir,'clips.txt');
  await writeFile(list,shots.map(s=>`file '${out.clip(s.id).replaceAll("'", "'\\''")}'`).join('\n')+'\n');
  try {
    // Matroska stores millisecond timestamps. Concat adds each clip's rounded duration, so errors add up across
    // clips whose length is not a whole number of milliseconds. setts sets every packet's time from its one global
    // frame index N at the master fps (TB is the stream time base), so each frame is at most half a millisecond off.
    // It only rewrites timestamps: every packet is copied, none dropped or duplicated.
    await command('ffmpeg',['-hide_banner','-loglevel','error','-y','-f','concat','-safe','0','-i',list,'-map','0:v:0','-an','-c','copy','-bsf:v',`setts=ts=N/(${fps}*TB):duration=1/(${fps}*TB)`,out.master]);
    await verify(out.master,shots.at(-1)!.endFrame,fps,width,height);
  } finally {await rm(list,{force:true});}
}
async function main() {
  const [action,target] = process.argv.slice(2);
  if (action === 'doctor' && target === undefined) {
    const {lines,missingRequired} = await doctor(configuredProviders(process.env,timeoutMs));
    for (const line of lines) console.log(line);
    if (missingRequired) throw new CliError(`doctor: ${missingRequired} required tool${missingRequired === 1 ? '' : 's'} missing`);
    return;
  }
  // Neither needs a film: taste show reads the global profile, style-bible checks a standalone file.
  if (action === 'taste' || action === 'style-bible') {
    for (const line of await (action === 'taste' ? taste : styleBible)(process.argv.slice(3))) console.log(line);
    return;
  }
  if (!['init','validate','status','gate','render','stitch','still','stills','animatic','sheet','handoff','mix','safezone','beats','beatmap','assets','scan','packet','calibrate','repro','liveness','looktest','deliver','accept'].includes(action) || !target) throw new CliError(usage);
  if (action === 'init') {
    console.log(`created ${await initProject(process.cwd(),target)}`);
    return;
  }
  if (action === 'validate') {
    const {errors,warnings} = await validateProject(target);
    report(errors,warnings);
    if (errors.length) {process.exitCode = 1; return;}
    console.log(`valid ${resolve(target)}`);
    return;
  }
  if (action === 'status') {
    // Status must work on an unfinished film: only a schema failure stops it.
    const parsed = await parseProject(target);
    if (!parsed.ok) {report(parsed.errors,[]); process.exitCode = 1; return;}
    // Stale gates show in the gate lines, so the error count covers only the structural checks.
    const {errors} = await checkProject(parsed.project,{gates:false});
    const delivery = await deliveryStatus(parsed.project);
    for (const line of statusLines(await gateViews(parsed.project),delivery.next)) console.log(line);
    for (const line of delivery.lines) console.log(line);
    for (const line of await livenessLines(parsed.project)) console.log(line);
    if (errors.length) console.log(`validation: ${errors.length} error${errors.length === 1 ? '' : 's'}; run motion-studio validate ${target}`);
    return;
  }
  if (action === 'gate') {
    // A gate records state on an unfinished film, so only the schema must pass; validate and render check the rest.
    const [id,decision,...rest] = process.argv.slice(4);
    // A --note after a --waive gives that waiver's reason; with one waiver, every note is its reason (the older form).
    const notes:string[] = [];
    const waives:{check:Waivable; notes:string[]}[] = [];
    for (let i=0;i<rest.length;i+=2) {
      const check = waivable.find(c => c === rest[i+1]);
      if (rest[i] === '--waive' && check) {
        if (waives.some(w => w.check === check)) throw new CliError(`--waive ${check} given twice`);
        waives.push({check, notes:[]}); continue;
      }
      if (rest[i] !== '--note' || !rest[i+1]) throw new CliError(usage);
      notes.push(rest[i+1]);
      waives.at(-1)?.notes.push(rest[i+1]);
    }
    const waivers = waives.map(w => ({check:w.check, reason:(waives.length === 1 ? notes : w.notes).join('\n')}));
    const gate = gateIds.find(g => g === id);
    const choice = decisions.find(d => d === decision);
    if (!gate || !choice) throw new CliError(usage);
    const parsed = await parseProject(target);
    if (!parsed.ok) {report(parsed.errors,[]); process.exitCode = 1; return;}
    for (const line of await recordGate(parsed.project,gate,choice,notes,{command,verify},waivers)) console.log(line);
    const updated = await parseProject(target);
    if (updated.ok) for (const line of statusLines(await gateViews(updated.project))) console.log(line);
    return;
  }
  if (action === 'beats') {
    // The grid comes before the shots, and a grid change can put existing cuts off the grid,
    // so beats needs only a schema-valid project, not a fully valid one.
    const parsed = await parseProject(target);
    if (!parsed.ok) {report(parsed.errors,[]); process.exitCode = 1; return;}
    for (const line of await beats(parsed.project,process.argv.slice(4),{command,verify})) console.log(line);
    return;
  }
  if (action === 'beatmap') {
    // The beat map is drawn before any shot is built, so it needs only a schema-valid project and readable word timings.
    if (process.argv.length > 4) throw new CliError(usage);
    const parsed = await parseProject(target);
    if (!parsed.ok) {report(parsed.errors,[]); process.exitCode = 1; return;}
    for (const line of await beatMap(parsed.project)) console.log(line);
    return;
  }
  if (action === 'looktest') {
    // A look test comes before the board (G1), so the film needs only a schema-valid storyboard with its primary layout.
    const parsed = await parseProject(target);
    if (!parsed.ok) {report(parsed.errors,[]); process.exitCode = 1; return;}
    if (!await looktest(parsed.project,process.argv.slice(4),{command,verify},renderShot)) process.exitCode = 1;
    return;
  }
  // scan also reads a lone video file for standalone critique, with no project context.
  if (action === 'scan' && await stat(target).then(s => s.isFile(),() => false)) {
    if (await scanFile(target,process.argv.slice(4),{command,verify})) process.exitCode = 1;
    return;
  }
  // packet also reads a lone video file for standalone critique.
  if (action === 'packet' && await stat(target).then(s => s.isFile(),() => false)) {
    console.log(await videoPacket(target,process.argv.slice(4),{command,verify}));
    return;
  }
  if (action === 'calibrate') {
    if (process.argv.length !== 5) throw new CliError(usage);
    const {lines,misses} = await calibrate(target,process.argv[4]);
    for (const line of lines) console.log(line);
    if (misses.length) throw new CliError(`run void: ${misses.length} band${misses.length === 1 ? '' : 's'} missed\nerror: ${misses.join('\nerror: ')}`);
    console.log('calibration within bands');
    return;
  }
  // liveness also measures a lone video file for standalone critique.
  if (action === 'liveness' && await stat(target).then(s => s.isFile(),() => false)) {
    if (await livenessVideo(target,process.argv.slice(4),{command,verify})) process.exitCode = 1;
    return;
  }
  if (action === 'assets') {
    // Assets come before shots, so assets needs only a schema-valid project.
    const parsed = await parseProject(target);
    if (!parsed.ok) {report(parsed.errors,[]); process.exitCode = 1; return;}
    for (const line of await assets(parsed.project,process.argv.slice(4),configuredProviders(process.env,timeoutMs))) console.log(line);
    return;
  }
  // stills and safezone named to some shots check only those shots' entrypoints: an engine builder checks its own
  // shots while the other engine's shots do not exist yet.
  const zone = action === 'safezone' ? safezoneArgs(process.argv.slice(4)) : undefined;
  const named = action === 'stills' ? stillsArgs(process.argv.slice(4)).ids : action === 'repro' ? process.argv.slice(4,5) : zone?.shots;
  const project = await loadProject(target,named?.length ? named : undefined);
  const {root:base, storyboard:{shots, meta}} = project;
  if (!shots.length) throw new CliError('project has no shots');
  const outputs = (format:Format) => outputsOf(base,format);
  if (action === 'deliver' || action === 'accept') {
    for (const line of await (action === 'deliver' ? deliver(project,process.argv.slice(4),{command,verify}) : acceptDelivery(project,process.argv.slice(4)))) console.log(line);
    return;
  }
  if (action === 'handoff') {
    // A trailing argument that is not a shot id names the format: handoff <dir> [<a> <b>] [format].
    const args = process.argv.slice(4);
    const named = args.length % 2 === 1 && !shots.some(s => s.id === args.at(-1)) ? args.pop() : undefined;
    for (const line of await handoffFilm(project,selectFormats(project,named).map(outputs),args,{command,verify})) console.log(line);
    return;
  }
  if (action === 'mix') {
    const outs = selectFormats(project,process.argv[4]).map(outputs);
    await prepareMix(project,outs);
    for (const out of outs) console.log(await mix(project,out,{command,verify}));
    return;
  }
  if (action === 'stills') {
    for (const line of await boardStills(project,process.argv.slice(4),{command,verify})) console.log(line);
    return;
  }
  if (action === 'animatic') {
    if (process.argv.length > 4) throw new CliError(usage);
    for (const line of await animatic(project,{command,verify})) console.log(line);
    return;
  }
  if (action === 'sheet') {
    for (const format of selectFormats(project,process.argv[4])) console.log(await sheet(project,outputs(format),{command,verify}));
    return;
  }
  if (action === 'packet') {
    for (const format of selectFormats(project,process.argv[4])) console.log(await filmPacket(project,outputs(format),{command,verify}));
    return;
  }
  if (action === 'scan') {
    if (await scanFilm(project,selectFormats(project,process.argv[4]),outputs,{command,verify})) process.exitCode = 1;
    return;
  }
  if (action === 'repro') {
    const [shotId,format,...extra] = process.argv.slice(4);
    if (!shotId || extra.length) throw new CliError(usage);
    for (const f of selectFormats(project,format)) console.log(await repro(project,shotId,outputs(f),{command,verify}));
    return;
  }
  if (action === 'liveness') {
    if (process.argv.length > 5) throw new CliError(usage);
    if (await livenessFilm(project,selectFormats(project,process.argv[4]),{command,verify})) process.exitCode = 1;
    return;
  }
  if (action === 'safezone') {
    const failures = await safezone(project,selectFormats(project,zone!.format),f => outputs(f).dir,{command,verify},zone!.shots);
    if (failures) process.exitCode = 1;
    return;
  }
  const formats = selectFormats(project,action === 'still' ? process.argv[6] ?? meta.formats.primary : process.argv[4]);
  for (const format of formats) {
    const out = outputs(format);
    // Handoff and mix evidence describes one master; a new render or stitch makes it stale.
    // Sheets show one master too.
    if (action === 'render' || action === 'stitch') {await clearSeamOutputs(out.dir); await clearSheetOutputs(out.dir);}
    if (action === 'render') await renderFormat(project,out);
    else if (action === 'still') {await stillFormat(project,out); console.log(`still ${format} ${process.argv[4]} frame ${process.argv[5] ?? '0'} -> ${out.still(process.argv[4])}`); continue;}
    else await stitchFormat(project,out);
    console.log(`${action} ${format} verified ${action === 'stitch' ? shots.at(-1)!.endFrame : shots.map(s=>s.endFrame-s.startFrame).join('+')} frames`);
  }
}
main().catch(e => {console.error(e instanceof CliError ? `error: ${e.message}` : e);process.exitCode=1;});
