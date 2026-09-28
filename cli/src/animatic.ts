import {access, mkdtemp, readdir, rename, rm, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';

import {CliError, formatDir, layoutOf, type Project} from './project.js';
import {frozenDir, gateViews} from './gates.js';
import {boardStillName, parseBoardStill} from './stills.js';
import type {Tools} from './seam.js';

/**
 * `animatic <film-dir>`: assembles the frozen G2 stills of the primary format on the real track into `animatic.mp4`
 * (G3 shows it). Each frame shows the nearest still of its shot, switching at the midpoint between two consecutive
 * stills. Every shot needs a still at its entry (0) and exit (last) frame.
 * Audio is `audio.track`, cut or padded with silence to the film length; without a track the animatic is silent.
 */
export async function animatic(project:Project, tools:Tools):Promise<string[]> {
  const {root,ledger,storyboard:{shots,audio,meta}} = project;
  const g2 = (await gateViews(project)).find(v => v.gate.id === 'G2')!;
  if (g2.state !== 'approved') throw new CliError(`animatic uses the frozen G2 stills: approve G2 first (G2 is ${g2.state}${g2.reason ? `: ${g2.reason}` : ''})`);
  const format = meta.formats.primary;
  // Frozen copies keep their path below stills/G2/ (the glob base), so the primary format keeps its folder.
  const frozen = join(root,frozenDir('G2',g2.gate.inputHashes),formatDir(format));
  const files = await readdir(frozen).catch(() => [] as string[]);
  const byShot = new Map<string,number[]>();
  for (const file of files) {
    const still = parseBoardStill(file);
    if (still) byShot.set(still.shotId,[...byShot.get(still.shotId) ?? [],still.frame]);
  }
  const missing:string[] = [];
  for (const shot of shots) {
    const frames = byShot.get(shot.id) ?? [];
    for (const [edge,frame] of [['entry',0],['exit',shot.endFrame-shot.startFrame-1]] as const) if (!frames.includes(frame)) missing.push(`${shot.id} ${edge} frame ${frame}`);
  }
  if (missing.length) throw new CliError(`frozen G2 stills (${frozen}) miss ${missing.join(', ')}; render them with stills and approve G2 again`);

  // One concat entry per film frame: the nearest still of the shot. It switches at the midpoint between two
  // consecutive stills (an exact midpoint frame shows the later still), so the entry still starts on the shot's
  // first frame and the exit still holds the second half of the last interval up to the shot's last frame.
  const entries:string[] = [];
  for (const shot of shots) {
    const frames = byShot.get(shot.id)!.sort((a,b) => a-b).filter(f => f < shot.endFrame-shot.startFrame);
    for (let local=0, i=0; local<shot.endFrame-shot.startFrame; local++) {
      while (i+1 < frames.length && 2*local >= frames[i]+frames[i+1]) i++;
      entries.push(`file '${join(frozen,boardStillName(shot.id,frames[i])).replaceAll("'", "'\\''")}'`);
    }
  }
  const {width,height} = layoutOf(project.storyboard,format).canvas;
  const target = join(root,'animatic.mp4');
  const temp = await mkdtemp(join(root,'.motion-animatic-'));
  try {
    const list = join(temp,'frames.txt');
    await writeFile(list,entries.join('\n')+'\n');
    const staged = join(temp,'animatic.mp4');
    const track = audio.track === null ? null : resolve(root,ledger.assets.find(a => a.id === audio.track)!.localPath);
    if (track) await access(track);
    const seconds = String(meta.durationFrames/meta.fps);
    await tools.command('ffmpeg',['-hide_banner','-loglevel','error','-y','-r',String(meta.fps),'-f','concat','-safe','0','-i',list,
      ...(track ? ['-i',track,'-map','0:v:0','-map','1:a:0','-af','apad','-c:a','aac','-ar','48000','-ac','2','-t',seconds] : ['-map','0:v:0','-an']),
      '-r',String(meta.fps),'-c:v','libx264','-crf','12','-pix_fmt','yuv420p','-colorspace','bt709','-color_trc','bt709','-color_primaries','bt709','-movflags','+faststart',staged]);
    const probe = JSON.parse(await tools.command('ffprobe',['-v','error','-count_frames','-select_streams','v:0','-show_entries','stream=nb_read_frames,width,height','-of','json',staged])).streams?.[0];
    if (Number(probe?.nb_read_frames) !== meta.durationFrames || probe.width !== width || probe.height !== height) throw new CliError(`animatic media check failed: ${probe?.nb_read_frames} frames ${probe?.width}x${probe?.height}, expected ${meta.durationFrames} frames ${width}x${height}`);
    await rename(staged,target);
  } finally {await rm(temp,{recursive:true,force:true});}
  return [`animatic ${format}: ${meta.durationFrames} frames from ${entries.length ? shots.length : 0} shots, stills ${frozen.slice(root.length+1)}, audio ${audio.track ?? 'none'} -> animatic.mp4`];
}
