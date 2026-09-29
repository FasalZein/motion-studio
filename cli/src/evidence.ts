import {mkdir, readFile} from 'node:fs/promises';
import {join} from 'node:path';

import {gateWaivers, type Gate, type Shot} from './project.js';
import {METHOD, type LivenessReport, type Place} from './liveness.js';
import type {Tools} from './seam.js';
import {tile, tiling} from './sheet.js';

/**
 * Motion evidence for the critique packet (#41): the liveness report, the seam threads and frame strips around each
 * seam and inside each still span over 0.5 s. The packet and the rubric read the content-basis `movingShare`, the value
 * the G4 gate checks (D72); `movingShareWholeFilm` is copied beside it for comparison with the study.
 */

/** Frames on each side of a seam in a seam strip: the strip shows cut-5 through cut+5, like `sheet`. */
export const SEAM_SIDE = 5;
/** Tiles in a hold strip, spread evenly from the first to the last frame of the still span. */
export const HOLD_TILES = 8;

/** Seam strip frames: the cut frame and SEAM_SIDE frames on each side, clamped to the video. */
export const seamFrames = (cut:number, frames:number) =>
  Array.from({length:2*SEAM_SIDE+1},(_,i) => cut-SEAM_SIDE+i).filter(f => f >= 0 && f < frames);
/** Hold strip frames: HOLD_TILES frames from `first` to `last` inclusive, without repeats, clamped to the video. */
export function holdFrames(first:number, last:number, frames:number):number[] {
  const a = Math.max(0,first), b = Math.min(frames-1,last);
  if (b < a) return [];
  return [...new Set(Array.from({length:HOLD_TILES},(_,i) => Math.round(a+(b-a)*i/(HOLD_TILES-1))))];
}

/** Writes one strip: the exact frames `frames` of `video`, tiled left to right in one row. */
export async function writeStrip(tools:Tools, video:string, size:{width:number; height:number}, frames:number[], file:string) {
  await mkdir(join(file,'..'),{recursive:true});
  const {scale} = tiling(size.width,size.height);
  const select = frames.map(f => `eq(n\\,${f})`).join('+');
  await tools.command('ffmpeg',['-hide_banner','-loglevel','error','-nostdin','-y','-i',video,'-vf',`select='${select}',${scale},${tile(frames.length,1)}`,'-fps_mode','passthrough','-frames:v','1','-pix_fmt','rgb24',file]);
}

/**
 * The frames of a still span in the video's own frame numbers, both inside the freeze. The span holds samples `start`
 * through `end` at 12 fps. ffmpeg's `fps` filter (rounding `near`) gives input frame n the output time round(n x 12 / fps)
 * and keeps the last frame of each time, so sample k decodes the last frame with n x 12 / fps < k + 0.5. That frame is
 * later than the rounded `firstFrame` of the report (by 1 frame at 30 fps and 2 at 60 fps for an even k), so a strip
 * from `firstFrame` can show a frame before the freeze. Frame timestamps stored in milliseconds can move a frame that
 * falls exactly on k + 0.5 to either side, so the first frame includes that tie (it lies between two frozen samples) and
 * the last frame excludes it.
 */
export function spanFrames(span:Place, fps:number) {
  const rate = METHOD.sampleFps;
  const start = Math.round(span.startSecond*rate), end = start+Math.round(span.seconds*rate);
  return {first:Math.floor((start+0.5)*fps/rate), last:Math.ceil((end+0.5)*fps/rate)-1};
}

export type HoldStrip = Place & {file:string; frames:number[]};
/** Writes one hold strip per still span over 0.5 s into `<dir>/strips/hold-NN.png`; `name` maps a file to its packet path. */
export async function holdStrips(tools:Tools, video:string, size:{width:number; height:number}, fps:number, frames:number, spans:Place[], dir:string, name:(file:string) => string):Promise<HoldStrip[]> {
  const out:HoldStrip[] = [];
  for (const [i,span] of spans.entries()) {
    const {first,last} = spanFrames(span,fps);
    const picked = holdFrames(first,last,frames);
    if (!picked.length) continue;
    const file = `strips/hold-${String(i+1).padStart(2,'0')}.png`;
    await writeStrip(tools,video,size,picked,join(dir,file));
    out.push({...span, file:name(file), frames:picked});
  }
  return out;
}

export type SeamEvidence = {from:string; to:string; frame:number; entry:Shot['entry']; thread:Shot['thread']|null; bothMove:boolean|null; strip:string; frames:number[]};
/** Writes one seam strip per seam into `<dir>/strips/seam-<a>-<b>.png` and pairs it with the seam's thread (D70) and the liveness cut check. */
export async function seamStrips(tools:Tools, video:string, size:{width:number; height:number}, frames:number, shots:Shot[], report:LivenessReport|null, dir:string, name:(file:string) => string):Promise<SeamEvidence[]> {
  const out:SeamEvidence[] = [];
  for (const [i,shot] of shots.slice(1).entries()) {
    const from = shots[i].id, picked = seamFrames(shot.startFrame,frames);
    const file = `strips/seam-${from}-${shot.id}.png`;
    await writeStrip(tools,video,size,picked,join(dir,file));
    const cut = report?.advisory.cuts.find(c => c.shot === shot.id);
    out.push({from, to:shot.id, frame:shot.startFrame, entry:shot.entry, thread:shot.thread ?? null, bothMove:cut ? cut.bothMove : null, strip:name(file), frames:picked});
  }
  return out;
}

/** Rubric cap on dimension 2 (anchor 8 needs living holds inside the D59 limits): 7 while the report fails without a current waiver. */
export const DIMENSION2_MAX_ON_FAILURE = 7;

/** The liveness part of a packet: the report's numbers, the named moving-share basis, the waiver and the dimension 2 cap. */
export function livenessEvidence(report:LivenessReport, file:string, holds:HoldStrip[], g4:{gate:Gate; state:string}|undefined) {
  // A waiver counts only on the current (effective) G4 approval that recorded it (D60, D72).
  // Only a liveness waiver lifts the cap; a critique waiver (D79) does not (D75).
  const live = g4?.state === 'approved' ? gateWaivers(g4.gate).find(w => w.check === 'liveness') : undefined;
  const waiver = live ? {reason:live.reason} : null;
  return {
    report:file, pass:report.pass,
    movingShareBasis:'content' as const, movingShare:report.movingShare, movingShareWholeFilm:report.movingShareWholeFilm,
    stillShare:report.stillShare, longestStillSeconds:report.longestStillSeconds, contentSeconds:report.contentSeconds,
    excluded:report.excluded, limits:report.limits, failures:report.failures, advisory:report.advisory,
    stillSpans:holds,
    waiver,
    dimension2Max:report.pass || waiver ? null : DIMENSION2_MAX_ON_FAILURE,
  };
}

export const readReport = async (file:string):Promise<LivenessReport|null> => {
  try {return JSON.parse(await readFile(file,'utf8')) as LivenessReport;}
  catch {return null;}
};
