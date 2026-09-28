import {readFile} from 'node:fs/promises';
import {CliError} from './project.js';

/**
 * `calibrate <scores.json> <bands.json>`: checks a reviewer's scores against expected bands. The dispatcher runs it on
 * the calibration cases before it trusts film scores (a miss voids the run) and the evals run it on each fixture.
 *
 * scores.json: {"cases": {"<case>": {"film": {"<dim>": score|"unverified"}, "shots": {"<shot>": {"<dim>": ...}},
 *   "worstIssues": [{"shot", "frame", "term", "repair"}]}}}
 * bands.json: {"cases": {"<case>": [rule, ...]}}; a rule is a score band {"dimension", "shot"?, "min"?, "max"?},
 * an unverified marker {"dimension", "shot"?, "unverified": true} or a finding {"issue": {"shot", "from", "to"}}.
 * "shot": "*" applies the rule to every scored shot.
 */
type Value = number|'unverified';
type CaseScores = {film:Record<string,Value>; shots:Record<string,Record<string,Value>>; worstIssues:{shot:string; frame:number; term:string; repair:string}[]};
type Rule =
  | {kind:'band'; dimension:string; shot:string|null; min:number; max:number}
  | {kind:'unverified'; dimension:string; shot:string|null}
  | {kind:'issue'; shot:string; from:number; to:number};

const isObject = (v:unknown):v is Record<string,unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isValue = (v:unknown):v is Value => v === 'unverified' || (typeof v === 'number' && v >= 1 && v <= 10);

function parseScores(file:string, raw:unknown):Record<string,CaseScores> {
  const bad = (why:string) => new CliError(`${file}: ${why}`);
  if (!isObject(raw) || !isObject(raw.cases)) throw bad('expected {"cases": {...}}');
  const out:Record<string,CaseScores> = {};
  for (const [name,c] of Object.entries(raw.cases)) {
    if (!isObject(c)) throw bad(`case ${name} is not an object`);
    const film = c.film ?? {}, shots = c.shots ?? {}, issues = c.worstIssues ?? [];
    if (!isObject(film) || !Object.values(film).every(isValue)) throw bad(`case ${name}: film scores must be 1 to 10 or "unverified"`);
    if (!isObject(shots) || !Object.values(shots).every(s => isObject(s) && Object.values(s).every(isValue))) throw bad(`case ${name}: shot scores must be 1 to 10 or "unverified"`);
    if (!Array.isArray(issues) || !issues.every(i => isObject(i) && typeof i.shot === 'string' && Number.isInteger(i.frame) && typeof i.term === 'string' && typeof i.repair === 'string')) throw bad(`case ${name}: each worst issue needs shot, frame, term and repair`);
    out[name] = {film:film as CaseScores['film'], shots:shots as CaseScores['shots'], worstIssues:issues as CaseScores['worstIssues']};
  }
  return out;
}
function parseBands(file:string, raw:unknown):Record<string,Rule[]> {
  const bad = (why:string) => new CliError(`${file}: ${why}`);
  if (!isObject(raw) || !isObject(raw.cases)) throw bad('expected {"cases": {...}}');
  const out:Record<string,Rule[]> = {};
  for (const [name,rules] of Object.entries(raw.cases)) {
    if (!Array.isArray(rules) || !rules.length) throw bad(`case ${name} needs a list of rules`);
    out[name] = rules.map((r,i):Rule => {
      if (!isObject(r)) throw bad(`case ${name} rule ${i+1} is not an object`);
      if (isObject(r.issue)) {
        const {shot,from,to} = r.issue;
        if (typeof shot !== 'string' || !Number.isInteger(from) || !Number.isInteger(to) || (to as number) < (from as number)) throw bad(`case ${name} rule ${i+1}: issue needs shot and a frame range from <= to`);
        return {kind:'issue', shot, from:from as number, to:to as number};
      }
      const shot = r.shot === undefined ? null : r.shot;
      if (typeof r.dimension !== 'string' || (shot !== null && typeof shot !== 'string')) throw bad(`case ${name} rule ${i+1}: needs a dimension and an optional shot`);
      if (r.unverified === true) return {kind:'unverified', dimension:r.dimension, shot};
      const min = r.min ?? 1, max = r.max ?? 10;
      if (typeof min !== 'number' || typeof max !== 'number' || min > max || (r.min === undefined && r.max === undefined)) throw bad(`case ${name} rule ${i+1}: needs min, max or "unverified": true`);
      return {kind:'band', dimension:r.dimension, shot, min, max};
    });
  }
  return out;
}

const describe = (r:Rule) => r.kind === 'issue' ? `a worst issue in ${r.shot} at frames ${r.from}-${r.to} with a term and a repair`
  : `${r.shot === null ? 'film' : `shot ${r.shot}`} dimension ${r.dimension} ${r.kind === 'unverified' ? 'unverified' : r.min === r.max ? `= ${r.min}` : r.max === 10 ? `>= ${r.min}` : r.min === 1 ? `<= ${r.max}` : `${r.min}-${r.max}`}`;
/** The values a rule reads, or a reason it cannot read any. */
function valuesOf(r:Exclude<Rule,{kind:'issue'}>, c:CaseScores):{values:(Value|undefined)[]}|{missing:string} {
  if (r.shot === null) return {values:[c.film[r.dimension]]};
  if (r.shot !== '*') return {values:[c.shots[r.shot]?.[r.dimension]]};
  const all = Object.values(c.shots);
  return all.length ? {values:all.map(s => s[r.dimension])} : {missing:'no shot scores'};
}
function check(r:Rule, c:CaseScores):string|null {
  if (r.kind === 'issue') return c.worstIssues.some(i => i.shot === r.shot && i.frame >= r.from && i.frame <= r.to && i.term.trim() && i.repair.trim()) ? null : 'no matching worst issue';
  const read = valuesOf(r,c);
  if ('missing' in read) return read.missing;
  for (const v of read.values) {
    if (v === undefined) return 'no score';
    if (r.kind === 'unverified' ? v !== 'unverified' : v === 'unverified' || v < r.min || v > r.max) return `got ${v}`;
  }
  return null;
}

/** Prints one line per rule; returns the misses as error lines (empty when every case lies inside its bands). */
export async function calibrate(scoresFile:string, bandsFile:string):Promise<{lines:string[]; misses:string[]}> {
  const read = async (file:string) => {
    try {return JSON.parse(await readFile(file,'utf8'));}
    catch (e) {throw new CliError(`cannot read ${file}: ${(e as Error).message}`);}
  };
  const scores = parseScores(scoresFile,await read(scoresFile));
  const bands = parseBands(bandsFile,await read(bandsFile));
  const lines:string[] = [], misses:string[] = [];
  for (const [name,rules] of Object.entries(bands)) {
    const c = scores[name];
    if (!c) {misses.push(`${name}: no scores for this case`); continue;}
    for (const r of rules) {
      const why = check(r,c);
      if (why === null) lines.push(`pass ${name}: ${describe(r)}`);
      else misses.push(`${name}: ${describe(r)}: ${why}`);
    }
  }
  return {lines, misses};
}
