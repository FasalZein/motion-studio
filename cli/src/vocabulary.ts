import {readFile} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import type {Storyboard} from './project.js';

// dist/vocabulary.json is generated at build time from skills/motion-vocabulary/terms/*.md (scripts/vocabulary.mjs)
// and ships in the npm package next to this module.
const glossaryFile = join(dirname(fileURLToPath(import.meta.url)),'vocabulary.json');
const customPrefix = 'custom:';

let glossary:Promise<Set<string>>|undefined;
function termIds():Promise<Set<string>> {
  glossary ??= readFile(glossaryFile,'utf8').then(text => new Set((JSON.parse(text) as {terms:{id:string}[]}).terms.map(t => t.id)));
  return glossary;
}

/**
 * Warnings for vocabulary-controlled fields (D42): `shots[].camera`, `shots[].transition`, `shots[].effects[].term`
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
  }
  for (const round of critique) for (const issue of round.worstIssues) use(issue.term,`critique loop ${round.loop}: worst issue at shot ${issue.shot} frame ${issue.frame} term`);
  return warnings;
}
