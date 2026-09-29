import type {Project, Shot} from './project.js';
import {customPrefix, threadKindIds} from './vocabulary.js';

/**
 * Seam threads (D64): every shot after the first names what the seam into it carries, as `thread.kind` (a
 * motion-vocabulary thread id or `custom:<description>`) and `thread.shared` (the carried thing in words). A missing
 * or malformed thread is an error, so a disconnected cut is a visible decision. The first shot has no seam before it.
 * Thread fields are board content: G2 binds only shot ids and frames, so a thread edit does not stale G2 (D43).
 */
export async function threadErrors({storyboard:{shots}}:Project):Promise<string[]> {
  const kinds = await threadKindIds();
  const errors:string[] = [];
  for (const [i,shot] of shots.slice(1).entries()) {
    const where = `seam ${shots[i].id} -> ${shot.id}: shot ${shot.id}`;
    const {thread} = shot;
    if (thread === undefined) {errors.push(`${where} has no thread; set "thread": {"kind", "shared"} to what the seam carries`); continue;}
    if (thread.kind.startsWith(customPrefix)) {
      if (!thread.kind.slice(customPrefix.length).trim()) errors.push(`${where} thread kind "${thread.kind}" has no description after custom:`);
    } else if (!kinds.has(thread.kind)) errors.push(`${where} thread kind "${thread.kind}" is not a motion-vocabulary thread kind; use a thread id or custom:<description>`);
    if (!thread.shared.trim()) errors.push(`${where} thread has no shared text; name the thing the seam carries`);
  }
  return errors;
}

/** The beat-map cell of a shot's seam thread: `kind: shared`, blank for the first shot, `missing` when absent. */
export function threadCell(shot:Shot, index:number):string {
  if (index === 0) return '';
  return shot.thread === undefined ? 'missing' : `${shot.thread.kind}: ${shot.thread.shared}`;
}
