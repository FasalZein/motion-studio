/**
 * Dimension 7 (sound and sync) from the measured `mix` sync report, by the rule in motion-critique rubric.md.
 * The derived score never goes above 8: 9 and 10 need a reviewer that heard the audio.
 */

/** The fields of `sync.json` (written by `mix`) that the rule reads. */
export type SyncReport = {
  targetLufs:number; integratedLufs:number; truePeakDbtp:number;
  sfx:{asset:string; eventFrame:number; plannedOffsetFrames:number; offsetFrames:number}[];
  cuts:{shot:string; frame:number; beatFrame:number|null; offsetFrames:number|null; offBeatCut?:string}[];
};
export type SoundScore = {
  score:number|'unverified';
  /** The worst timing error in frames over every tested hit and beat-targeted cut, or null when none was tested. */
  worstOffsetFrames:number|null;
  reasons:string[];
  /** Checks the report cannot settle; the reviewer marks them unverified. */
  unverified:string[];
};

// Rubric anchors: 8 = every hit and beat-targeted cut within 1 frame and loudness on target; 5 = noticeable offsets
// or inconsistent level; lower = widely misaligned or unusable.
const ON_TIME_FRAMES = 1, NOTICEABLE_FRAMES = 3;
// mix normalizes to -14 LUFS within 0.5 LU and limits true peaks to -1 dBTP (D53).
const LUFS_TOLERANCE = 0.5, TRUE_PEAK_CEILING_DBTP = -1, NEAR_LUFS = 2, NEAR_TRUE_PEAK_DBTP = 0;
const SCORE = {onTarget:8, noticeable:5, wide:2} as const;
const LISTENING = 'audible sound quality (timbre, masking, intent): needs a reviewer that heard the audio';

const timingPoints = (worst:number) => worst <= ON_TIME_FRAMES ? SCORE.onTarget : worst <= NOTICEABLE_FRAMES ? SCORE.noticeable : SCORE.wide;
function levelPoints(lufsError:number, truePeak:number) {
  if (lufsError <= LUFS_TOLERANCE && truePeak <= TRUE_PEAK_CEILING_DBTP) return SCORE.onTarget;
  return lufsError <= NEAR_LUFS && truePeak <= NEAR_TRUE_PEAK_DBTP ? SCORE.noticeable : SCORE.wide;
}
const fmt = (n:number) => String(Math.round(n*1000)/1000);

/** Scores dimension 7 from a sync report, or marks it unverified when there is none. */
export function soundScore(sync:SyncReport|null, missing = 'no mix sync report'):SoundScore {
  if (sync === null) return {score:'unverified', worstOffsetFrames:null, reasons:[missing], unverified:['SFX hit offsets','cut-to-beat offsets','loudness',LISTENING]};
  const reasons:string[] = [], unverified:string[] = [LISTENING];
  // A hit is judged against its declared timing: the planned peak offset is intent, like an off-beat cut.
  const hits = sync.sfx.map(c => ({what:`SFX ${c.asset} at frame ${c.eventFrame}`, error:Math.abs(c.offsetFrames-c.plannedOffsetFrames)}));
  const cuts = sync.cuts.filter(c => c.offBeatCut === undefined && c.offsetFrames !== null).map(c => ({what:`cut into ${c.shot} at frame ${c.frame}`, error:Math.abs(c.offsetFrames!)}));
  for (const c of sync.cuts.filter(c => c.offBeatCut !== undefined)) reasons.push(`cut into ${c.shot} is declared off-beat (${c.offBeatCut}); judged against its declared timing, not a beat`);
  if (sync.cuts.some(c => c.offBeatCut === undefined && c.offsetFrames === null)) unverified.push('cut-to-beat offsets: no beat grid');
  if (!hits.length) reasons.push('no SFX hit tested');
  if (!cuts.length) reasons.push('no beat-targeted cut tested');
  const timed = [...hits,...cuts];
  const worst = timed.length ? Math.max(...timed.map(t => t.error)) : null;
  for (const t of timed) if (t.error > ON_TIME_FRAMES) reasons.push(`${t.what} is ${fmt(t.error)} frames off`);
  const lufsError = Math.abs(sync.integratedLufs-sync.targetLufs);
  const level = levelPoints(lufsError,sync.truePeakDbtp);
  reasons.push(`integrated ${fmt(sync.integratedLufs)} LUFS against ${fmt(sync.targetLufs)} (${fmt(lufsError)} LU off), true peak ${fmt(sync.truePeakDbtp)} dBTP`);
  const score = Math.min(level,worst === null ? SCORE.onTarget : timingPoints(worst));
  return {score, worstOffsetFrames:worst, reasons, unverified};
}
