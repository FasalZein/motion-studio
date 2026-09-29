// Board, G2 and G3 artifact checks for check.mjs. Standalone: the installed skill has no cli/, so this file repeats the
// few CLI rules it needs (still names, frozen-copy folders, canonical JSON hashes) and reads everything else from the film.
import {createHash} from 'node:crypto';
import {existsSync, readFileSync} from 'node:fs';
import {join, resolve} from 'node:path';

const GATES = ['G1', 'G2', 'G3'];
const MAX_ROUNDS = 3;
// motion-vocabulary terms/threads.md (D70). Read from the sibling skill when it is installed beside this one.
const THREAD_KINDS = ['shared-element-thread', 'shape-match-thread', 'movement-match-thread', 'camera-direction-thread', 'light-thread', 'sound-thread', 'beat-cut-thread'];
const BEAT_COLUMNS = ['Beat', 'Shot', 'Frames', 'Idea line', 'Motion event', 'Camera', 'Thread', 'In-between plan', 'Sound cue', 'Live content', 'Spoken line'];
// Free-text columns: "none" is a real answer there (a film without narration has no spoken line).
const FREE_COLUMNS = ['Spoken line', 'Sound cue'];
const ENGINE_COLUMNS = ['Shot', 'Engine', 'Reason', 'UI source', '3D'];
const PLACEHOLDER = /^(none|-|n\/a|tbd|todo|\.\.\.)$/i;
// Freeze inputs of G1-G3 in cli/schema/gate-inputs.json: the live path prefix and the gate whose frozen folder holds
// the copy (stills/approved/<gate>-<hash8>/<path after the prefix>).
export const FROZEN = [['stills/G1/', 'G1'], ['stills/G2/', 'G2'], ['animatic.mp4', 'G3']];

const sha256 = data => createHash('sha256').update(data).digest('hex');
// Same as canonical() in cli/src/gates.ts: sorted keys, no spaces.
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
function pick(value, fields) {
  if (Array.isArray(value)) return value.map(item => pick(item, fields));
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(fields.filter(f => Object.hasOwn(value, f)).map(f => [f, value[f]]));
}
function readPointer(value, path) {
  for (const raw of path.split('/').slice(1)) {
    const key = raw.replaceAll('~1', '/').replaceAll('~0', '~');
    if (value === null || typeof value !== 'object' || !Object.hasOwn(value, key)) return undefined;
    value = value[key];
  }
  return value;
}
const revision = hashes => sha256(canonical(hashes)).slice(0, 8);
export const formatDir = format => format.replace(':', 'x');
// cli/src/stills.ts boardStillName: the shot-local frame is zero-padded to 3 digits (e2e defect 7 on #16).
export const stillName = (shotId, frame) => `${shotId}-f${String(frame).padStart(3, '0')}.png`;

function threadKinds(here) {
  const file = resolve(here, '../../motion-vocabulary/terms/threads.md');
  if (!existsSync(file)) return new Set(THREAD_KINDS);
  return new Set([...readFileSync(file, 'utf8').matchAll(/\(`([a-z-]+-thread)`\)/g)].map(m => m[1]));
}

/** The body of a "## <title>" section, up to the next "## " heading. */
function section(text, title) {
  const m = new RegExp(`^## ${title}\\s*$([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, 'mi').exec(text);
  return m ? m[1] : null;
}
/** The first Markdown table of a section: header cells and one object per row. */
function table(body) {
  const lines = (body ?? '').split('\n').filter(l => l.trim().startsWith('|'));
  if (lines.length < 2) return null;
  const cells = l => l.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map(c => c.trim());
  const header = cells(lines[0]);
  const rows = lines.slice(2).map(l => Object.fromEntries(cells(l).map((c, i) => [header[i], c])));
  return {header, rows};
}

function checkBeatMap(root, storyboard, problems) {
  const path = join(root, 'beatmap.md');
  if (!existsSync(path)) { problems.push('beatmap.md missing; the board writes the beat map there'); return []; }
  const text = readFileSync(path, 'utf8');
  const {shots, meta} = storyboard;
  const byId = new Map(shots.map((s, i) => [s.id, {shot: s, index: i}]));

  const sourced = table(section(text, 'Sourced assets'));
  if (sourced?.rows.length) {
    const ledgerFile = join(root, 'ledger.json');
    const ids = new Set(existsSync(ledgerFile) ? JSON.parse(readFileSync(ledgerFile, 'utf8')).assets.map(a => a.id) : []);
    for (const row of sourced.rows) {
      const id = (row['Ledger id'] ?? '').replace(/`/g, '');
      if (!ids.has(id)) problems.push(`beatmap.md: sourced asset "${id}" is not in ledger.json`);
    }
  } else if (!/^No brand material:\s*\S/m.test(text)) problems.push('beatmap.md: no "## Sourced assets" table and no "No brand material: <reason>" line');

  const contract = table(section(text, 'Beat contract'));
  const beats = [];
  if (!contract) problems.push('beatmap.md: no "## Beat contract" table');
  else {
    const missing = BEAT_COLUMNS.filter(c => !contract.header.includes(c));
    for (const c of missing) problems.push(`beatmap.md: beat contract lacks column "${c}"`);
    if (!contract.rows.length) problems.push('beatmap.md: the beat contract has no rows');
    let end = 0;
    for (const row of missing.length ? [] : contract.rows) {
      const beat = row.Beat || '?';
      for (const c of BEAT_COLUMNS) {
        if (!row[c]) problems.push(`beatmap.md: beat ${beat}: empty "${c}"`);
        else if (!FREE_COLUMNS.includes(c) && PLACEHOLDER.test(row[c]) && !(c === 'Thread' && beats.length === 0)) problems.push(`beatmap.md: beat ${beat}: "${c}" is a placeholder (${row[c]})`);
      }
      const shotId = row.Shot.replace(/`/g, '');
      const frames = /^(\d+)\s*-\s*(\d+)/.exec(row.Frames);
      const entry = byId.get(shotId);
      if (!entry) { problems.push(`beatmap.md: beat ${beat}: shot "${shotId}" is not in storyboard.json`); continue; }
      if (!frames) { problems.push(`beatmap.md: beat ${beat}: Frames "${row.Frames}" must start with <start>-<end> (film frames, end exclusive)`); continue; }
      const [start, stop] = [Number(frames[1]), Number(frames[2])];
      if (start !== end) problems.push(`beatmap.md: beat ${beat} starts at frame ${start}, but the beat before it ends at frame ${end}`);
      end = Math.max(end, stop);
      const {shot, index} = entry;
      if (stop <= start || start < shot.startFrame || stop > shot.endFrame) { problems.push(`beatmap.md: beat ${beat} frames [${start}, ${stop}) are not inside shot ${shot.id} [${shot.startFrame}, ${shot.endFrame})`); continue; }
      if (index > 0 && start === shot.startFrame && shot.thread && !row.Thread.includes(shot.thread.kind)) problems.push(`beatmap.md: beat ${beat} opens seam ${shots[index - 1].id} -> ${shot.id}; its Thread cell must name the thread kind ${shot.thread.kind}`);
      beats.push({beat, shot, start, stop});
    }
    if (!missing.length && end !== meta.durationFrames) problems.push(`beatmap.md: the beats end at frame ${end}, but meta.durationFrames is ${meta.durationFrames}`);
  }

  const engines = table(section(text, 'Engines'));
  if (!engines) problems.push('beatmap.md: no "## Engines" table');
  else {
    const missing = ENGINE_COLUMNS.filter(c => !engines.header.includes(c));
    for (const c of missing) problems.push(`beatmap.md: engines table lacks column "${c}"`);
    for (const shot of missing.length ? [] : shots) {
      const row = engines.rows.find(r => r.Shot.replace(/`/g, '') === shot.id);
      if (!row) { problems.push(`beatmap.md: shot ${shot.id} has no row in the engines table`); continue; }
      if (row.Engine.replace(/`/g, '') !== shot.engine) problems.push(`beatmap.md: engines table: shot ${shot.id} engine "${row.Engine}" differs from storyboard.json engine "${shot.engine}"`);
      for (const c of ['Reason', 'UI source']) if (!row[c] || PLACEHOLDER.test(row[c]) && c === 'Reason') problems.push(`beatmap.md: engines table: shot ${shot.id} has no ${c === 'Reason' ? 'engine reason' : 'UI source'}`);
      const says3d = /^yes\b/i.test(row['3D'] ?? '');
      if (shot.threeD && !says3d) problems.push(`beatmap.md: shot ${shot.id} declares threeD in storyboard.json; its 3D cell must start with "yes"`);
      if (!shot.threeD && says3d) problems.push(`beatmap.md: shot ${shot.id} says 3D, but storyboard.json has no threeD with a reason for it`);
    }
  }

  const hero = /^Hero shot:\s*`?([^`\s]+)`?/m.exec(text)?.[1];
  if (!hero) problems.push('beatmap.md: no "Hero shot: <shot-id>" line');
  else if (!byId.has(hero)) problems.push(`beatmap.md: hero shot "${hero}" is not in storyboard.json`);
  return beats;
}

function checkStoryboard(storyboard, beats, kinds, problems) {
  const {shots, meta} = storyboard;
  let end = 0;
  for (const shot of shots) {
    if (shot.startFrame !== end || shot.endFrame <= shot.startFrame) problems.push(`storyboard.json: shot ${shot.id} [${shot.startFrame}, ${shot.endFrame}) does not continue the timeline at frame ${end}`);
    end = shot.endFrame;
  }
  if (end !== meta.durationFrames) problems.push(`storyboard.json: shots cover [0, ${end}) but meta.durationFrames is ${meta.durationFrames}`);
  for (const [i, shot] of shots.entries()) {
    if (i > 0) {
      const seam = `storyboard.json: seam ${shots[i - 1].id} -> ${shot.id}`;
      const {thread} = shot;
      if (!thread) problems.push(`${seam}: shot ${shot.id} has no thread`);
      else {
        const custom = thread.kind?.startsWith('custom:');
        if (custom ? !thread.kind.slice(7).trim() : !kinds.has(thread.kind)) problems.push(`${seam}: thread kind "${thread.kind}" is not a thread kind`);
        if (!thread.shared?.trim()) problems.push(`${seam}: thread has no shared text`);
      }
    }
    if (shot.threeD && !shot.threeD.reason?.trim()) problems.push(`storyboard.json: shot ${shot.id} declares threeD without a reason`);
  }
  // D74: the G2 still request is the start and end pose of each beat, in shot-local frames.
  for (const {beat, shot, start, stop} of beats) {
    for (const [frame, pose] of [[start - shot.startFrame, 'start'], [stop - 1 - shot.startFrame, 'end']]) {
      if (!(shot.stillFrames ?? []).includes(frame)) problems.push(`storyboard.json: shot ${shot.id} stillFrames lack ${frame}, the ${pose} pose of beat ${beat}`);
    }
  }
}

/** The G2 still paths the board requests: every still frame of every shot in every chosen format, plus each sheet. */
function requestedStills({shots, meta}) {
  const paths = [];
  for (const format of [meta.formats.primary, ...meta.formats.extra]) {
    const dir = `stills/G2/${formatDir(format)}`;
    for (const shot of shots) for (const frame of shot.stillFrames ?? []) paths.push(`${dir}/${stillName(shot.id, frame)}`);
    paths.push(`${dir}/sheet.png`);
  }
  return paths;
}

/**
 * Recomputes every recorded input hash of gates G1 to `last`, as `motion-studio status` does for those gates: a freeze
 * input from its gate's frozen copy, a storyboard input from storyboard.json, any other file live.
 */
function checkGates(root, storyboard, last, problems) {
  const gates = new Map(storyboard.gates.map(g => [g.id, g]));
  const frozenDirs = {};
  for (const id of GATES.slice(0, GATES.indexOf(last) + 1)) {
    const gate = gates.get(id);
    if (!gate) { problems.push(`${id}: no gate record in storyboard.json`); return null; }
    if (gate.rounds > MAX_ROUNDS) problems.push(`${id} used ${gate.rounds} note rounds; the cap is ${MAX_ROUNDS}`);
    if (gate.state !== 'approved') { problems.push(`${id} is ${gate.state}, not approved`); return null; }
    frozenDirs[id] = `stills/approved/${id}-${revision(gate.inputHashes)}`;
  }
  for (const id of GATES.slice(0, GATES.indexOf(last) + 1)) {
    const {inputHashes} = gates.get(id);
    for (const [key, hash] of Object.entries(inputHashes)) {
      const pointer = /^storyboard\.json#(\/[^{]*)(?:\{(.*)\})?$/.exec(key);
      if (pointer) {
        const value = readPointer(storyboard, pointer[1]);
        const current = value === undefined ? null : sha256(canonical(pointer[2] ? pick(value, pointer[2].split(',')) : value));
        if (current !== hash) problems.push(`${id}: ${key} changed since the approval`);
        continue;
      }
      const frozen = FROZEN.find(([prefix]) => key.startsWith(prefix));
      const file = frozen ? `${frozenDirs[frozen[1]] ?? `stills/approved/${frozen[1]}-?`}/${key.slice(frozen[0].endsWith('/') ? frozen[0].length : 0)}` : key;
      if (!existsSync(join(root, file))) problems.push(`${id}: ${key}: ${frozen ? 'frozen copy' : 'file'} ${file} missing`);
      else if (sha256(readFileSync(join(root, file))) !== hash) problems.push(`${id}: ${key}: ${frozen ? 'frozen copy' : 'file'} ${file} does not match the approved hash`);
    }
  }
  return frozenDirs;
}

/**
 * `board`: the beat map, storyboard and live G2 stills are ready to present at G2.
 * `g2`: G1 and G2 are approved, the approval holds every requested still, and every recorded hash still matches.
 * `g3`: as g2, plus G3 is approved with its frozen animatic.
 */
export function checkFilm(root, stage, here, problems) {
  const file = join(root, 'storyboard.json');
  if (!existsSync(file)) { problems.push('storyboard.json missing'); return; }
  const storyboard = JSON.parse(readFileSync(file, 'utf8'));
  const beats = checkBeatMap(root, storyboard, problems);
  checkStoryboard(storyboard, beats, threadKinds(here), problems);
  const stills = requestedStills(storyboard);
  const seams = storyboard.shots.length - 1;
  const summary = `${beats.length} beats, ${storyboard.shots.length} shots, ${seams} seam(s) threaded, ${stills.length} G2 stills and sheets`;
  if (stage === 'board') {
    for (const path of stills) if (!existsSync(join(root, path))) problems.push(`missing ${path}; run motion-studio stills`);
    return `board ok: ${summary}`;
  }
  const frozen = checkGates(root, storyboard, stage === 'g2' ? 'G2' : 'G3', problems);
  if (!frozen) return '';
  const g2 = storyboard.gates.find(g => g.id === 'G2').inputHashes;
  for (const path of stills) if (!(path in g2)) problems.push(`G2: ${path} is not in the approval; run motion-studio stills, then present G2 again`);
  if (stage === 'g2') return `g2 ok: ${summary}, G2 frozen in ${frozen.G2}`;
  if (!('animatic.mp4' in storyboard.gates.find(g => g.id === 'G3').inputHashes)) problems.push('G3: animatic.mp4 is not in the approval; run motion-studio animatic, then present G3 again');
  return `g3 ok: ${summary}, G2 frozen in ${frozen.G2}, animatic frozen in ${frozen.G3}`;
}
