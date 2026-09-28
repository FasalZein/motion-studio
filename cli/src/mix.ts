import {mkdtemp, readFile, rename, rm, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {requireMaster, round3, type Timeline, type Tools} from './seam.js';

const RATE = 48_000;
const CHANNELS = 2;
export const TARGET_LUFS = -14;
// Maximum allowed distance between the measured result and the target.
export const LUFS_TOLERANCE = 0.5;

type Sfx = {id:string; file:string; frame:number};
type MixConfig = {track:string; sfx:Sfx[]};

function parseMix(value:unknown, frames:number):MixConfig {
  if (typeof value !== 'object' || value === null) throw Error('project has no mix section');
  const mix = value as Record<string,unknown>;
  if (typeof mix.track !== 'string' || !mix.track || !Array.isArray(mix.sfx)) throw Error('mix needs a track path and an sfx list');
  const ids = new Set<string>();
  for (const s of mix.sfx) {
    if (!s || typeof s.id !== 'string' || !s.id || ids.has(s.id) || typeof s.file !== 'string' || !s.file) throw Error('invalid sfx');
    if (!Number.isInteger(s.frame) || s.frame < 0 || s.frame >= frames) throw Error(`sfx ${s.id} event frame outside the timeline`);
    ids.add(s.id);
  }
  return mix as MixConfig;
}
/** Decodes any audio file to 48 kHz stereo float samples, interleaved. */
async function decode(tools:Tools, file:string, out:string, seconds?:number):Promise<Float32Array> {
  await tools.command('ffmpeg',['-hide_banner','-loglevel','error','-y','-i',file,...(seconds === undefined ? [] : ['-t',String(seconds)]),'-vn','-ar',String(RATE),'-ac',String(CHANNELS),'-f','f32le','-c:a','pcm_f32le',out]);
  const bytes = await readFile(out);
  return new Float32Array(new Uint8Array(bytes).buffer);
}
/** Index of the sample frame (one sample per channel) with the largest absolute value. */
function peak(samples:Float32Array):number {
  let best = 0, at = 0;
  for (let i=0;i<samples.length;i++) if (Math.abs(samples[i]) > best) {best = Math.abs(samples[i]); at = i;}
  if (best === 0) throw Error('silent sfx has no peak');
  return Math.floor(at/CHANNELS);
}
async function integratedLufs(tools:Tools, raw:string):Promise<number> {
  const log = await tools.command('ffmpeg',['-hide_banner','-nostats','-f','f32le','-ar',String(RATE),'-ac',String(CHANNELS),'-i',raw,'-af','ebur128','-f','null','-']);
  const value = Number(/Integrated loudness:\s*I:\s*(-?[\d.]+) LUFS/.exec(log)?.[1]);
  // ebur128 reports -70 LUFS for silence and for audio shorter than one 400 ms block.
  if (!Number.isFinite(value) || value <= -70) throw Error('mix has no measurable loudness (silent or shorter than 400 ms)');
  return value;
}

/** Mixes the track and SFX at 48 kHz stereo, normalizes to -14 LUFS, writes mix.wav, sync.json and final.mkv. */
export async function mix(timeline:Timeline, config:unknown, base:string, output:string, tools:Tools):Promise<string> {
  const frames = timeline.shots.at(-1)!.end;
  const settings = parseMix(config,frames);
  for (const name of ['final.mkv','mix.wav','sync.json']) await rm(join(output,name),{force:true});
  const master = await requireMaster(timeline,output,tools);
  // Every supported fps (24, 25, 30, 60) divides 48000, so frame starts are whole samples.
  const perFrame = RATE/timeline.fps;
  const length = frames*perFrame;
  const temp = await mkdtemp(join(output,'.motion-mix-'));
  try {
    const track = await decode(tools,resolve(base,settings.track),join(temp,'track.f32'),frames/timeline.fps);
    const bus = new Float32Array(length*CHANNELS);
    bus.set(track.subarray(0,bus.length));
    const hits = [];
    for (const sfx of settings.sfx) {
      const samples = await decode(tools,resolve(base,sfx.file),join(temp,`sfx-${hits.length}.f32`));
      const sourcePeak = peak(samples);
      // Align the measured peak with the event frame; samples before 0 or after the end are dropped.
      const shift = sfx.frame*perFrame - sourcePeak;
      const stem = new Float32Array(bus.length);
      for (let i=Math.max(0,-shift);i<samples.length/CHANNELS && i+shift<length;i++) for (let c=0;c<CHANNELS;c++) stem[(i+shift)*CHANNELS+c] = samples[i*CHANNELS+c];
      for (let i=0;i<bus.length;i++) bus[i] += stem[i];
      const placed = peak(stem)/perFrame;
      hits.push({id:sfx.id,eventFrame:sfx.frame,sourcePeakSeconds:round3(sourcePeak/RATE),peakFrame:round3(placed),offsetFrames:round3(placed-sfx.frame)});
    }
    const premix = join(temp,'premix.f32');
    await writeFile(premix,new Uint8Array(bus.buffer));
    const gainDb = TARGET_LUFS - await integratedLufs(tools,premix);
    const gain = 10**(gainDb/20);
    let loudest = 0;
    for (let i=0;i<bus.length;i++) {bus[i] *= gain; loudest = Math.max(loudest,Math.abs(bus[i]));}
    if (loudest >= 1) throw Error(`mix would clip at ${TARGET_LUFS} LUFS: peak ${round3(20*Math.log10(loudest))} dBFS; lower the sfx or track level`);
    const normalized = join(temp,'normalized.f32');
    await writeFile(normalized,new Uint8Array(bus.buffer));
    const measured = await integratedLufs(tools,normalized);
    if (Math.abs(measured-TARGET_LUFS) > LUFS_TOLERANCE) throw Error(`mix loudness ${measured} LUFS outside ${TARGET_LUFS} +/- ${LUFS_TOLERANCE}`);
    const wav = join(temp,'mix.wav');
    await tools.command('ffmpeg',['-hide_banner','-loglevel','error','-y','-f','f32le','-ar',String(RATE),'-ac',String(CHANNELS),'-i',normalized,'-c:a','pcm_s24le',wav]);
    const final = join(temp,'final.mkv');
    await tools.command('ffmpeg',['-hide_banner','-loglevel','error','-y','-i',master,'-i',wav,'-map','0:v:0','-map','1:a:0','-c:v','copy','-c:a','pcm_s24le',final]);
    const probe = JSON.parse(await tools.command('ffprobe',['-v','error','-count_frames','-show_entries','stream=codec_type,sample_rate,channels,nb_read_frames','-of','json',final]));
    const video = probe.streams?.filter((s:{codec_type:string}) => s.codec_type === 'video');
    const audio = probe.streams?.filter((s:{codec_type:string}) => s.codec_type === 'audio');
    if (video?.length !== 1 || Number(video[0].nb_read_frames) !== frames || audio?.length !== 1 || Number(audio[0].sample_rate) !== RATE || audio[0].channels !== CHANNELS) throw Error('final mux failed the media contract');
    const cuts = timeline.shots.slice(1).map(shot => {
      const beats = timeline.beatsSeconds.map(t => t*timeline.fps);
      const nearest = beats.reduce<number|null>((best,beat) => best === null || Math.abs(beat-shot.start) < Math.abs(best-shot.start) ? beat : best,null);
      return {frame:shot.start,beatFrame:nearest === null ? null : round3(nearest),offsetFrames:nearest === null ? null : round3(shot.start-nearest)};
    });
    await writeFile(join(temp,'sync.json'),JSON.stringify({fps:timeline.fps,sampleRate:RATE,channels:CHANNELS,targetLufs:TARGET_LUFS,integratedLufs:measured,gainDb:round3(gainDb),sfx:hits,cuts},null,2)+'\n');
    for (const name of ['mix.wav','final.mkv','sync.json']) await rename(join(temp,name),join(output,name));
    return `mix verified ${frames} frames at ${measured} LUFS`;
  } finally {await rm(temp,{recursive:true,force:true});}
}
