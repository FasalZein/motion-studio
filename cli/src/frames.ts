import {CliError, type Fps} from './project.js';

/**
 * The one shared seconds-to-frame rule (SPEC: one master timeline in frames): the nearest frame,
 * round(seconds * fps), with halves rounded up. Beat grids and narration word timings (voice.ts) use it.
 */
export function secondsToFrame(seconds:number, fps:Fps):number {
  if (!Number.isFinite(seconds) || seconds < 0) throw new CliError(`time ${seconds} s must be a non-negative number of seconds`);
  // Decimal seconds times fps carries float error (0.58 * 25 is 14.499999999999998). Snap the product to
  // FRAME_RESOLUTION first, so an intended half frame rounds up and not down.
  return Math.round(Math.round(seconds * fps * FRAME_RESOLUTION) / FRAME_RESOLUTION);
}

// One millionth of a frame: far below any real timing difference, far above float error at film lengths.
const FRAME_RESOLUTION = 1e6;
