import {access, mkdtemp, rename, rm} from 'node:fs/promises';
import {join, relative, resolve} from 'node:path';

import {CliError, layoutOf, type Project} from './project.js';
import {gateViews} from './gates.js';
import {adviceLines, measureLiveness} from './liveness.js';
import {outputsOf} from './outputs.js';
import {requireMaster} from './seam.js';
import {requireCurrentRenders} from './sources.js';
import type {Tools} from './seam.js';

const RATE = 48000;

/**
 * `animatic <film-dir>`: the moving animatic G3 shows (D62). It takes the current stitched master of the primary
 * format (the blocking renders), refuses when a shot render is older than its source, and encodes it frame for frame
 * into `animatic.mp4` with the real audio: `audio.track` and, when the film has a voice, the narration from
 * `voice.startFrame`, summed without ducking or loudness changes (`mix` owns those) and cut or padded to the film
 * length. A film without either is silent. Then it measures the animatic's liveness and prints the verdict as advice;
 * the verdict never changes the exit status.
 */
export async function animatic(project:Project, tools:Tools):Promise<string[]> {
  const {root,ledger,storyboard:{audio,voice,meta}} = project;
  const g2 = (await gateViews(project)).find(v => v.gate.id === 'G2')!;
  if (g2.state !== 'approved') throw new CliError(`animatic follows the approved board: approve G2 first (G2 is ${g2.state}${g2.reason ? `: ${g2.reason}` : ''})`);
  const format = meta.formats.primary;
  const out = outputsOf(root,format);
  await requireCurrentRenders(project,out);
  const master = await requireMaster(project,out,tools);
  // An animatic without the narration would show an incomplete film at G3, as mix refuses to deliver one.
  if (voice?.tts === null) throw new CliError('voice.tts is null: the film has a narration script but no narration audio; record it in the ledger and set voice.tts');

  // validate has already checked that every asset id is in the ledger and every file matches its hash.
  const file = (id:string) => resolve(root,ledger.assets.find(a => a.id === id)!.localPath);
  const track = audio.track === null ? null : file(audio.track);
  const narration = voice === null ? null : {path:file(voice.tts!), startFrame:voice.startFrame ?? 0};
  const inputs:string[] = [], labels:string[] = [], filters:string[] = [];
  const stereo = `aresample=${RATE},aformat=sample_fmts=fltp:channel_layouts=stereo`;
  if (track) {await access(track); inputs.push('-i',track); filters.push(`[${labels.length+1}:a:0]${stereo},apad[a${labels.length}]`); labels.push(`[a${labels.length}]`);}
  if (narration) {
    await access(narration.path);
    inputs.push('-i',narration.path);
    // Every supported fps divides 48000, so the start frame is a whole number of samples.
    filters.push(`[${labels.length+1}:a:0]${stereo},adelay=delays=${narration.startFrame*RATE/meta.fps}S:all=1,apad[a${labels.length}]`);
    labels.push(`[a${labels.length}]`);
  }
  if (labels.length === 2) filters.push(`${labels.join('')}amix=inputs=2:normalize=0:duration=longest[mixed]`);
  const audioOut = labels.length === 2 ? '[mixed]' : labels[0];

  const {width,height} = layoutOf(project.storyboard,format).canvas;
  const target = join(root,'animatic.mp4');
  const temp = await mkdtemp(join(root,'.motion-animatic-'));
  try {
    const staged = join(temp,'animatic.mp4');
    const seconds = String(meta.durationFrames/meta.fps);
    await tools.command('ffmpeg',['-hide_banner','-loglevel','error','-y','-i',master,...inputs,
      ...(audioOut ? ['-filter_complex',filters.join(';'),'-map','0:v:0','-map',audioOut,'-c:a','aac','-ar',String(RATE),'-ac','2','-t',seconds] : ['-map','0:v:0','-an']),
      '-fps_mode','passthrough','-c:v','libx264','-crf','12','-pix_fmt','yuv420p','-colorspace','bt709','-color_trc','bt709','-color_primaries','bt709','-movflags','+faststart',staged]);
    const probe = JSON.parse(await tools.command('ffprobe',['-v','error','-count_frames','-show_entries','stream=codec_type,nb_read_frames,width,height','-of','json',staged])).streams ?? [];
    const video = probe.find((s:{codec_type:string}) => s.codec_type === 'video');
    const audioStreams = probe.filter((s:{codec_type:string}) => s.codec_type === 'audio').length;
    if (Number(video?.nb_read_frames) !== meta.durationFrames || video.width !== width || video.height !== height || audioStreams !== (audioOut ? 1 : 0)) throw new CliError(`animatic media check failed: ${video?.nb_read_frames} frames ${video?.width}x${video?.height}, ${audioStreams} audio streams; expected ${meta.durationFrames} frames ${width}x${height}, ${audioOut ? 1 : 0} audio stream`);
    await rename(staged,target);
  } finally {await rm(temp,{recursive:true,force:true});}
  const lines = [`animatic ${format}: ${meta.durationFrames} frames from ${relative(root,master)}, audio ${audio.track ?? 'none'}, narration ${voice?.tts ?? 'none'} -> animatic.mp4`];
  // Advice only (D62): G3 shows stillness while changes are cheap; G4 enforces the limits (D60).
  try {lines.push(...adviceLines(`animatic ${format} (advice)`,'no report file',await measureLiveness(tools,target,'animatic.mp4',{fps:meta.fps, shots:project.storyboard.shots},meta.durationFrames/meta.fps)));}
  catch (e) {lines.push(`liveness animatic ${format} (advice): not measured: ${(e as Error).message}`);}
  return lines;
}
