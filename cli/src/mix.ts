import {mkdtemp, readFile, rename, rm, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {CliError, type Project} from './project.js';
import {clearMixOutputs, requireMaster, round3, type Tools} from './seam.js';
import type {Outputs} from './outputs.js';
import {requireWords, wordFrame, type Word} from './voice.js';
import {limitTruePeaks} from './limiter.js';

const RATE = 48_000;
const CHANNELS = 2;
export const TARGET_LUFS = -14;
// Maximum allowed distance between the measured result and the target.
export const LUFS_TOLERANCE = 0.5;
// D53: after normalization a true-peak limiter holds every peak at or below this ceiling, so speech and SFX
// transients never clip or refuse the mix. It aims LIMITER_MARGIN_DB below the ceiling, because its own true-peak
// estimate and ffmpeg's meter differ slightly; the delivered file is measured against the ceiling itself.
export const TRUE_PEAK_CEILING_DBTP = -1;
const LIMITER_MARGIN_DB = 0.3;
const LIMITER_ATTACK_SECONDS = 0.002;
const LIMITER_RELEASE_SECONDS = 0.05;
// Limiting lowers the loudness a little; the gain is corrected and the limiter rerun until the loudness is within
// LOUDNESS_STEP of the target, at most LIMITER_PASSES times.
const LOUDNESS_STEP = 0.1;
const LIMITER_PASSES = 6;
// The sync report searches the final mix this many frames on each side of a cue's target for its peak.
const SYNC_WINDOW_FRAMES = 3;
// Ducking: under narration the bed (audio.track) drops by DUCK_DB. Words closer than PHRASE_GAP_SECONDS share one
// ducked span, so the bed does not pump between words; the level ramps linearly over DUCK_RAMP_SECONDS before each
// span and after it. The spans come from the word timings, not from the voice's loudness, so they are exact.
export const DUCK_DB = -12;
const PHRASE_GAP_SECONDS = 0.5;
const DUCK_RAMP_SECONDS = 0.1;

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
/** Integrated loudness (LUFS) and true peak (dBTP) of raw 48 kHz stereo float samples, measured by ffmpeg ebur128. */
async function loudness(tools:Tools, raw:string):Promise<{lufs:number; truePeak:number}> {
  const log = await tools.command('ffmpeg',['-hide_banner','-nostats','-f','f32le','-ar',String(RATE),'-ac',String(CHANNELS),'-i',raw,'-af','ebur128=peak=true','-f','null','-']);
  const lufs = Number(/Integrated loudness:\s*I:\s*(-?[\d.]+) LUFS/.exec(log)?.[1]);
  // ebur128 reports -70 LUFS for silence and for audio shorter than one 400 ms block.
  if (!Number.isFinite(lufs) || lufs <= -70) throw new CliError('mix has no measurable loudness (silent or shorter than 400 ms)');
  const peak = /True peak:\s*Peak:\s*(-?[\d.]+|-inf) dBFS/.exec(log)?.[1];
  if (peak === undefined) throw new CliError('ffmpeg ebur128 reported no true peak');
  return {lufs, truePeak:peak === '-inf' ? -Infinity : Number(peak)};
}

/**
 * Runs once before the formats are mixed. Earlier mix outputs describe an earlier request, so every run,
 * even a refused or failed one, removes them from every selected format; no format keeps a stale delivery file.
 */
export async function prepareMix(project:Project, outs:Outputs[]) {
  for (const out of outs) await clearMixOutputs(out.dir);
  // A mix without the narration would report success for an incomplete film.
  if (project.storyboard.voice?.tts === null) throw new CliError('voice.tts is null: the film has a narration script but no narration audio; record it in the ledger and set voice.tts');
}

/** Sample-frame spans [from, to) of the film where narration is spoken: the words merged into phrases. */
function duckSpans(words:Word[], startSample:number):{from:number; to:number}[] {
  const spans:{from:number; to:number}[] = [];
  for (const w of words) {
    const from = startSample+Math.round(w.start*RATE), to = startSample+Math.round(w.end*RATE);
    const last = spans.at(-1);
    if (last && from-last.to < PHRASE_GAP_SECONDS*RATE) last.to = Math.max(last.to,to);
    else spans.push({from,to});
  }
  return spans;
}
/** Multiplies the bed by the duck gain: DUCK_DB inside each span, a linear ramp on each side, 1 elsewhere. */
function duck(bed:Float32Array, spans:{from:number; to:number}[]) {
  const low = 10**(DUCK_DB/20), ramp = Math.round(DUCK_RAMP_SECONDS*RATE), length = bed.length/CHANNELS;
  const gain = new Float32Array(length).fill(1);
  for (const {from,to} of spans) for (let i=Math.max(0,from-ramp);i<Math.min(length,to+ramp);i++) {
    const outside = i < from ? (from-i)/ramp : i >= to ? (i-to+1)/ramp : 0;
    gain[i] = Math.min(gain[i],low+(1-low)*Math.min(1,outside));
  }
  for (let i=0;i<bed.length;i++) bed[i] *= gain[Math.floor(i/CHANNELS)];
}

/**
 * Mixes audio.track (ducked under the narration), the narration from voice.startFrame and every shot sound cue
 * at 48 kHz stereo, normalizes to -14 LUFS,
 * and writes mix.wav, sync.json and final.mkv (master video plus the mix) for one format.
 * Call prepareMix for all selected formats first.
 */
export async function mix(project:Project, out:Outputs, tools:Tools):Promise<string> {
  const {root,ledger,storyboard:{shots,audio,voice,meta:{fps}}} = project;
  const output = out.dir;
  const frames = shots.at(-1)!.endFrame;
  const cues = shots.flatMap(shot => shot.soundCues);
  if (audio.track === null && !cues.length && voice === null) throw new CliError('nothing to mix: audio.track and voice are null and no shot has sound cues');
  const words = await requireWords(project);
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
    // prepareMix refused a voice without audio, so voice.tts is set here.
    const narration = voice === null ? null : {asset:voice.tts!, startFrame:voice.startFrame ?? 0, spans:duckSpans(words,(voice.startFrame ?? 0)*perFrame)};
    if (narration !== null) {
      // The bed ducks under the spoken phrases; then the voice is added from its start frame, cut at the film end.
      duck(bus,narration.spans);
      const speech = await decode(tools,file(narration.asset),join(temp,'voice.f32'));
      const offset = narration.startFrame*perFrame*CHANNELS;
      for (let i=0;i<speech.length && offset+i<bus.length;i++) bus[offset+i] += speech[i];
    }
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
    // One gain to -14 LUFS, then the true-peak limiter (D53). Limiting can lower the loudness and the limiter's
    // estimate can read below ffmpeg's meter, so both are measured after each pass and corrected.
    let gainDb = TARGET_LUFS - (await loudness(tools,premix)).lufs;
    let aimDb = TRUE_PEAK_CEILING_DBTP - LIMITER_MARGIN_DB;
    const normalized = join(temp,'normalized.f32');
    let limited:{mixed:Float32Array; reductionDb:number; lufs:number; truePeak:number}|null = null;
    for (let pass=0;pass<LIMITER_PASSES;pass++) {
      const mixed = bus.map(v => v*10**(gainDb/20));
      const reductionDb = limitTruePeaks(mixed,CHANNELS,10**(aimDb/20),Math.round(LIMITER_ATTACK_SECONDS*RATE),Math.round(LIMITER_RELEASE_SECONDS*RATE));
      await writeFile(normalized,new Uint8Array(mixed.buffer));
      const measured = await loudness(tools,normalized);
      limited = {mixed,reductionDb,...measured};
      const loud = Math.abs(measured.lufs-TARGET_LUFS) <= LOUDNESS_STEP, peakOk = measured.truePeak <= TRUE_PEAK_CEILING_DBTP;
      if (loud && peakOk) break;
      if (!peakOk) aimDb -= measured.truePeak-TRUE_PEAK_CEILING_DBTP+LOUDNESS_STEP;
      if (!loud) gainDb += TARGET_LUFS-measured.lufs;
    }
    if (limited === null || limited.truePeak > TRUE_PEAK_CEILING_DBTP || Math.abs(limited.lufs-TARGET_LUFS) > LUFS_TOLERANCE) throw new CliError(`mix could not reach ${TARGET_LUFS} LUFS with true peaks at or below ${TRUE_PEAK_CEILING_DBTP} dBTP (last pass: ${limited?.lufs} LUFS, ${limited?.truePeak} dBTP); the sum is mostly peaks: lower the loudest sound cue with gainDb or re-level the narration file`);
    const limiter = {ceilingDbtp:TRUE_PEAK_CEILING_DBTP, maxGainReductionDb:round3(limited.reductionDb)};
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
    const {lufs:measured,truePeak} = await loudness(tools,delivered);
    if (Math.abs(measured-TARGET_LUFS) > LUFS_TOLERANCE) throw new CliError(`mix loudness ${measured} LUFS outside ${TARGET_LUFS} +/- ${LUFS_TOLERANCE}`);
    if (truePeak > TRUE_PEAK_CEILING_DBTP) throw new CliError(`delivered true peak ${truePeak} dBTP is above the ${TRUE_PEAK_CEILING_DBTP} dBTP ceiling`);
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
    // Spoken reveals against their words; validate has already required each reveal on its word's nearest frame.
    const reveals = voice === null ? [] : shots.flatMap(shot => (shot.reveals ?? []).map(r => {
      const wordAt = wordFrame(voice,words[r.word],fps);
      return {shot:shot.id,word:r.word,text:r.text,wordStartSeconds:words[r.word].start,wordFrame:wordAt,frame:r.frame,offsetFrames:r.frame-wordAt};
    }));
    const narrationReport = narration === null ? null : {asset:narration.asset,startFrame:narration.startFrame,duckDb:DUCK_DB,
      duckSpans:narration.spans.map(({from,to}) => ({startSeconds:round3(from/RATE),endSeconds:round3(to/RATE)}))};
    await writeFile(join(temp,'sync.json'),JSON.stringify({fps,sampleRate:RATE,channels:CHANNELS,targetLufs:TARGET_LUFS,integratedLufs:measured,truePeakDbtp:truePeak,gainDb:round3(gainDb),limiter,syncWindowFrames:SYNC_WINDOW_FRAMES,voice:narrationReport,sfx,cuts,reveals},null,2)+'\n');
    for (const name of ['mix.wav','final.mkv','sync.json']) await rename(join(temp,name),join(output,name));
    return `mix ${out.format} verified ${frames} frames at ${measured} LUFS, true peak ${truePeak} dBTP${limiter.maxGainReductionDb > 0 ? `; limiter reduced peaks by up to ${limiter.maxGainReductionDb} dB` : ''}`;
  } finally {await rm(temp,{recursive:true,force:true});}
}
