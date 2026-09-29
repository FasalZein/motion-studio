import {readFile} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import type {Storyboard} from './project.js';

// dist/vocabulary.json is generated at build time from skills/motion-vocabulary/terms/*.md (scripts/vocabulary.mjs)
// and ships in the npm package next to this module.
const glossaryFile = join(dirname(fileURLToPath(import.meta.url)),'vocabulary.json');
export const customPrefix = 'custom:';
/** The glossary category of the seam thread kinds: skills/motion-vocabulary/terms/threads.md (D64). */
const threadCategory = 'threads';

type Term = {id:string; name:string; category:string};
let glossary:Promise<Term[]>|undefined;
const terms = ():Promise<Term[]> => glossary ??= readFile(glossaryFile,'utf8').then(text => (JSON.parse(text) as {terms:Term[]}).terms);
/** Every motion-vocabulary term id. */
export async function termIds():Promise<Set<string>> {
  return new Set((await terms()).map(t => t.id));
}
/** The motion-vocabulary thread kind ids, the only glossary ids a seam thread may name. */
export async function threadKindIds():Promise<Set<string>> {
  return new Set((await terms()).filter(t => t.category === threadCategory).map(t => t.id));
}

/**
 * Warnings for vocabulary-controlled fields (D42): `shots[].camera`, `shots[].transition`, `shots[].effects[].term`, `shots[].moves[].term`
 * and `critique[].worstIssues[].term`. A value must be a glossary term id or `custom:<description>`.
 * `entry` and `exit` are schema enums (`cut` or `handoff`), so the schema checks them, not this glossary.
 */
export async function vocabularyWarnings({shots,critique}:Storyboard):Promise<string[]> {
  const known = await termIds();
  const warnings:string[] = [];
  const use = (value:string, where:string) => {
    if (value.startsWith(customPrefix)) {
      if (!value.slice(customPrefix.length).trim()) warnings.push(`${where} "${value}" has no description after custom:`);
    } else if (!known.has(value)) warnings.push(`${where} "${value}" is not a motion-vocabulary term; use a term id or custom:<description>`);
  };
  for (const shot of shots) {
    use(shot.camera,`shot ${shot.id}: camera`);
    if (shot.transition !== undefined) use(shot.transition,`shot ${shot.id}: transition`);
    for (const effect of shot.effects ?? []) use(effect.term,`shot ${shot.id}: effect at frame ${effect.start} term`);
    for (const move of shot.moves ?? []) use(move.term,`shot ${shot.id}: move at frame ${move.start} term`);
  }
  for (const round of critique) for (const issue of round.worstIssues) use(issue.term,`critique loop ${round.loop}: worst issue at shot ${issue.shot} frame ${issue.frame} term`);
  return warnings;
}
