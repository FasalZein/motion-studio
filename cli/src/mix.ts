import {mkdtemp, readFile, rename, rm, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {CliError, type Project} from './project.js';
import {clearMixOutputs, requireMaster, round3, type Tools} from './seam.js';
import type {Outputs} from './outputs.js';

const RATE = 48_000;
const CHANNELS = 2;
export const TARGET_LUFS = -14;
// Maximum allowed distance between the measured result and the target.
export const LUFS_TOLERANCE = 0.5;
// The sync report searches the final mix this many frames on each side of a cue's target for its peak.
const SYNC_WINDOW_FRAMES = 3;

/** Decodes any audio file to 48 kHz stereo float samples, interleaved. */
async function decode(tools:Tools, file:string, out:string, seconds?:number):Promise<Float32Array> {
  await tools.command('ffmpeg',['-hide_banner','-loglevel','error','-y','-i',file,...(seconds === undefined ? [] : ['-t',String(seconds)]),'-vn','-ar',String(RATE),'-ac',String(CHANNELS),'-f','f32le','-c:a','pcm_f32le',out]);
  const bytes = await readFile(out);
  return new Float32Array(new Uint8Array(bytes).buffer);
}
/** Sample frame (one sample per channel) with the largest absolute value within [from, to) sample frames. */
function peak(samples:Float32Array, from = 0, to = samples.length/CHANNELS):{at:number; level:number} {
  let level = 0, at = -1;
  for (let i=Math.max(0,from)*CHANNELS;i<Math.min(to,samples.length/CHANNELS)*CHANNELS;i++) if (Math.abs(samples[i]) > level) {level = Math.abs(samples[i]); at = Math.floor(i/CHANNELS);}
  return {at,level};
}
async function integratedLufs(tools:Tools, raw:string):Promise<number> {
  const log = await tools.command('ffmpeg',['-hide_banner','-nostats','-f','f32le','-ar',String(RATE),'-ac',String(CHANNELS),'-i',raw,'-af','ebur128','-f','null','-']);
  const value = Number(/Integrated loudness:\s*I:\s*(-?[\d.]+) LUFS/.exec(log)?.[1]);
  // ebur128 reports -70 LUFS for silence and for audio shorter than one 400 ms block.
  if (!Number.isFinite(value) || value <= -70) throw new CliError('mix has no measurable loudness (silent or shorter than 400 ms)');
  return value;
}

/**
 * Mixes audio.track and every shot sound cue at 48 kHz stereo, normalizes to -14 LUFS,
 * and writes mix.wav, sync.json and final.mkv (master video plus the mix) for one format.
 */
export async function mix(project:Project, out:Outputs, tools:Tools):Promise<string> {
  const {root,ledger,storyboard:{shots,audio,voice,meta:{fps}}} = project;
  const output = out.dir;
  // Earlier mix outputs describe an earlier request, so every run, even a refused one, removes them.
  await clearMixOutputs(output);
  // Narration is not mixed yet. A mix that silently drops it would report success for an incomplete film.
  if (voice !== null) throw new CliError('mix does not support narration yet (voice is set); narration mixing arrives with #19. Mix narration manually for now (motion-studio skill, agents/render.md)');
  const frames = shots.at(-1)!.endFrame;
  const cues = shots.flatMap(shot => shot.soundCues);
  if (audio.track === null && !cues.length) throw new CliError('nothing to mix: audio.track is null and no shot has sound cues');
  // validate has already checked that every asset id is in the ledger and every file matches its hash.
  const file = (id:string) => resolve(root,ledger.assets.find(a => a.id === id)!.localPath);
  const master = await requireMaster(project,out,tools);
  // Every supported fps (24, 25, 30, 60) divides 48000, so frame starts are whole samples.
  const perFrame = RATE/fps;
  const length = frames*perFrame;
  const temp = await mkdtemp(join(output,'.motion-mix-'));
  try {
    const bus = new Float32Array(length*CHANNELS);
    if (audio.track !== null) bus.set((await decode(tools,file(audio.track),join(temp,'track.f32'),frames/fps)).subarray(0,bus.length));
    const placed = [];
    for (const [n,cue] of cues.entries()) {
      const samples = await decode(tools,file(cue.asset),join(temp,`sfx-${n}.f32`));
      const source = peak(samples);
      if (source.level === 0) throw new CliError(`sound cue ${cue.asset} at frame ${cue.eventFrame} is silent and has no peak`);
      const gain = 10**((cue.gainDb ?? 0)/20);
      // peakOffsetFrames is the planned distance from the event to the peak (negative = before the event).
      const target = (cue.eventFrame+cue.peakOffsetFrames)*perFrame;
      // Align the measured peak with the target; samples before 0 or after the end are dropped.
      const shift = target-source.at;
      for (let i=Math.max(0,-shift)*CHANNELS;i<samples.length && i+shift*CHANNELS<bus.length;i++) bus[i+shift*CHANNELS] += samples[i]*gain;
      placed.push({cue,sourcePeakSeconds:round3(source.at/RATE),target});
    }
    const premix = join(temp,'premix.f32');
    await writeFile(premix,new Uint8Array(bus.buffer));
    const gainDb = TARGET_LUFS - await integratedLufs(tools,premix);
    const gain = 10**(gainDb/20);
    let loudest = 0;
    for (let i=0;i<bus.length;i++) {bus[i] *= gain; loudest = Math.max(loudest,Math.abs(bus[i]));}
    if (loudest >= 1) throw new CliError(`mix would clip at ${TARGET_LUFS} LUFS: peak ${round3(20*Math.log10(loudest))} dBFS; lower a sound cue with gainDb`);
    const normalized = join(temp,'normalized.f32');
    await writeFile(normalized,new Uint8Array(bus.buffer));
    const wav = join(temp,'mix.wav');
    await tools.command('ffmpeg',['-hide_banner','-loglevel','error','-y','-f','f32le','-ar',String(RATE),'-ac',String(CHANNELS),'-i',normalized,'-c:a','pcm_s24le',wav]);
    const final = join(temp,'final.mkv');
    await tools.command('ffmpeg',['-hide_banner','-loglevel','error','-y','-i',master,'-i',wav,'-map','0:v:0','-map','1:a:0','-c:v','copy','-c:a','pcm_s24le',final]);
    const probe = JSON.parse(await tools.command('ffprobe',['-v','error','-count_frames','-show_entries','stream=codec_type,sample_rate,channels,nb_read_frames','-of','json',final]));
    const video = probe.streams?.filter((s:{codec_type:string}) => s.codec_type === 'video');
    const audioStream = probe.streams?.filter((s:{codec_type:string}) => s.codec_type === 'audio');
    if (video?.length !== 1 || Number(video[0].nb_read_frames) !== frames || audioStream?.length !== 1 || Number(audioStream[0].sample_rate) !== RATE || audioStream[0].channels !== CHANNELS) throw new CliError('final mux failed the media contract');
    // Measure the delivered audio, not the bus: decode final.mkv again for loudness and peaks.
    const delivered = join(temp,'delivered.f32');
    const heard = await decode(tools,final,delivered);
    const measured = await integratedLufs(tools,delivered);
    if (Math.abs(measured-TARGET_LUFS) > LUFS_TOLERANCE) throw new CliError(`mix loudness ${measured} LUFS outside ${TARGET_LUFS} +/- ${LUFS_TOLERANCE}`);
    const window = SYNC_WINDOW_FRAMES*perFrame;
    const sfx = placed.map(({cue,sourcePeakSeconds,target}) => {
      const peakFrame = round3(peak(heard,target-window,target+window+1).at/perFrame);
      return {asset:cue.asset,eventFrame:cue.eventFrame,plannedOffsetFrames:cue.peakOffsetFrames,gainDb:cue.gainDb ?? 0,sourcePeakSeconds,peakFrame,offsetFrames:round3(peakFrame-cue.eventFrame)};
    });
    // Cut-to-beat offsets for every cut seam; handoff seams are not cuts (D41).
    const cuts = shots.slice(1).filter(shot => shot.entry === 'cut').map(shot => {
      const beat = audio.beatFrames.reduce<number|null>((best,b) => best === null || Math.abs(b-shot.startFrame) < Math.abs(best-shot.startFrame) ? b : best,null);
      return {shot:shot.id,frame:shot.startFrame,beatFrame:beat,offsetFrames:beat === null ? null : shot.startFrame-beat,...(shot.offBeatCut === undefined ? {} : {offBeatCut:shot.offBeatCut})};
    });
    await writeFile(join(temp,'sync.json'),JSON.stringify({fps,sampleRate:RATE,channels:CHANNELS,targetLufs:TARGET_LUFS,integratedLufs:measured,gainDb:round3(gainDb),syncWindowFrames:SYNC_WINDOW_FRAMES,sfx,cuts},null,2)+'\n');
    for (const name of ['mix.wav','final.mkv','sync.json']) await rename(join(temp,name),join(output,name));
    return `mix ${out.format} verified ${frames} frames at ${measured} LUFS`;
  } finally {await rm(temp,{recursive:true,force:true});}
}
