import {CliError, type Fps} from './project.js';

/**
 * The one shared seconds-to-frame rule (SPEC: one master timeline in frames): the nearest frame,
 * round(seconds * fps), with halves rounded up. Beat grids use it now; word timings (#19) reuse it.
 */
export function secondsToFrame(seconds:number, fps:Fps):number {
  if (!Number.isFinite(seconds) || seconds < 0) throw new CliError(`time ${seconds} s must be a non-negative number of seconds`);
  return Math.round(seconds * fps);
}
