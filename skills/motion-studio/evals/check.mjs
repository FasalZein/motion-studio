#!/usr/bin/env node
// Artifact checks for the motion-studio skill eval (SPEC seam 2) and the brief phase completion check.
//   node check.mjs brief <BRIEF.md>   a complete brief within 3 intake rounds
//   node check.mjs playbooks          the five genre playbooks as data
// Exit 0 and print "ok" lines when every check passes; otherwise print each problem and exit 1.
import {readFileSync, readdirSync, existsSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const playbookDir = resolve(here, '../playbooks');
// Genre ids: the storyboard schema enum (cli/schema/storyboard.schema.json). The installed skill has no cli/, so the
// list is repeated here and cross-checked against the schema when the repository is present.
const GENRES = ['product-launch', 'ui-morph-loop', 'explainer', 'showreel', 'social-kinetic-type'];
const FORMATS = ['16:9', '9:16', '1:1'];
const SECTIONS = ['inputs', 'direction', 'structure', 'build', 'gotchas', 'start'];
const MAX_ROUNDS = 3;
// D67: a hold is never offered as an equal alternative to a motion event.
const HOLD_ALTERNATIVE = /\b(event|move|motion)\b[^.]{0,30}\bor\b[^.]{0,30}\bholds?\b|\bholds?\b[^.]{0,30}\bor\b[^.]{0,30}\b(event|move|motion)\b/i;

const problems = [];
const [mode, arg] = process.argv.slice(2);

function frontMatter(text, file) {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!m) { problems.push(`${file}: no front matter`); return {}; }
  return Object.fromEntries(m[1].split('\n').map(l => {
    const i = l.indexOf(':');
    return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
  }));
}

function checkPlaybooks() {
  const schema = resolve(here, '../../../cli/schema/storyboard.schema.json');
  if (existsSync(schema)) {
    const e = JSON.parse(readFileSync(schema, 'utf8')).properties.meta.properties.genre.enum.filter(Boolean);
    if (e.slice().sort().join() !== GENRES.slice().sort().join()) problems.push(`GENRES differ from the schema enum: ${e.join(', ')}`);
  }
  const files = readdirSync(playbookDir).filter(f => f.endsWith('.md')).sort();
  const seen = [];
  for (const file of files) {
    const text = readFileSync(join(playbookDir, file), 'utf8');
    const d = frontMatter(text, file);
    if (d.genre !== file.replace(/\.md$/, '')) problems.push(`${file}: genre "${d.genre}" does not match the file name`);
    if (!GENRES.includes(d.genre)) problems.push(`${file}: genre "${d.genre}" is not a schema genre`);
    seen.push(d.genre);
    if (!['worked', 'untested'].includes(d.status)) problems.push(`${file}: status must be worked or untested`);
    const heading = /^# .*\| (.+)$/m.exec(text)?.[1];
    const wanted = d.status === 'untested' ? 'untested until used' : 'worked';
    if (heading !== wanted) problems.push(`${file}: heading must end "| ${wanted}" to match status ${d.status}`);
    if (!(Number(d['duration-seconds']) > 0)) problems.push(`${file}: duration-seconds must be a positive number`);
    if (!['24', '25', '30', '60'].includes(d.fps)) problems.push(`${file}: fps must be 24, 25, 30 or 60`);
    if (!FORMATS.includes(d['primary-format'])) problems.push(`${file}: primary-format must be one of ${FORMATS.join(', ')}`);
    const extra = d['extra-formats'] === 'none' ? [] : String(d['extra-formats']).split(',').map(s => s.trim());
    for (const f of extra) if (!FORMATS.includes(f) || f === d['primary-format']) problems.push(`${file}: bad extra format "${f}"`);
    if (!['track', 'voice'].includes(d.audio)) problems.push(`${file}: audio must be track or voice`);
    for (const s of SECTIONS) if (!new RegExp(`<${s}>[^<]+</${s}>`).test(text)) problems.push(`${file}: <${s}> missing or empty`);
    text.split('\n').forEach((l, i) => { if (HOLD_ALTERNATIVE.test(l)) problems.push(`${file}:${i + 1}: offers a hold as an alternative to a motion event (D67)`); });
  }
  for (const g of GENRES) if (!seen.includes(g)) problems.push(`no playbook for genre ${g}`);
  const untested = files.filter((f, i) => frontMatter(readFileSync(join(playbookDir, f), 'utf8'), f).status === 'untested');
  if (untested.length !== 3) problems.push(`expected 3 untested playbooks, found ${untested.length}`);
  if (!problems.length) console.log(`playbooks ok: ${files.length} genres, untested: ${untested.map(f => f.replace(/\.md$/, '')).join(', ')}`);
}

// A field line inside a section: "Name: value".
function field(body, name) {
  return new RegExp(`^${name}:\\s*(.+)$`, 'mi').exec(body)?.[1].trim();
}

function checkBrief(path) {
  const text = readFileSync(path, 'utf8');
  const sec = {};
  for (const s of SECTIONS) {
    const m = new RegExp(`<${s}>([\\s\\S]*?)</${s}>`).exec(text);
    if (!m || !m[1].trim()) problems.push(`<${s}> missing or empty`);
    sec[s] = m ? m[1] : '';
  }
  if (/<placeholder>|\bTODO\b|\bTBD\b/.test(text)) problems.push('brief has an unfilled placeholder');

  const source = field(sec.inputs, 'Source URL');
  if (!source || !(/^https?:\/\/\S+/.test(source) || /^none\b/.test(source))) problems.push('inputs: "Source URL:" must be a URL or none');
  else if (!/^none\b/.test(source) && !/\b\d{4}-\d{2}-\d{2}\b/.test(source)) problems.push('inputs: "Source URL:" needs its retrieval date (YYYY-MM-DD)');
  const rounds = Number(/^(\d+)/.exec(field(sec.inputs, 'Intake rounds') ?? '')?.[1]);
  if (!Number.isInteger(rounds)) problems.push('inputs: "Intake rounds: <n>" missing');
  else if (rounds > MAX_ROUNDS) problems.push(`inputs: ${rounds} intake rounds; the cap is ${MAX_ROUNDS}`);
  if (!field(sec.inputs, 'Sources')) problems.push('inputs: "Sources:" missing');
  if (!field(sec.inputs, 'Track') && !field(sec.inputs, 'Voice')) problems.push('inputs: "Track:" or "Voice:" missing');

  const logline = field(sec.direction, 'Logline');
  if (!logline) problems.push('direction: "Logline:" missing');
  else {
    if (/\band\b/i.test(logline)) problems.push('direction: the logline contains "and"; an idea line is one idea');
    if (/[.!?]\s+\S/.test(logline)) problems.push('direction: the logline has more than one sentence');
  }
  const genre = field(sec.direction, 'Genre');
  if (!GENRES.includes(genre)) problems.push(`direction: "Genre:" must be one of ${GENRES.join(', ')}`);
  const directions = sec.direction.split('\n').filter(l => /^Direction \d+:/.test(l.trim()));
  if (directions.length < 2 || directions.length > 3) problems.push(`direction: ${directions.length} "Direction <n>:" lines; G1 needs 2 or 3`);
  for (const d of directions) {
    for (const part of ['idea device', 'world and camera', 'look']) {
      if (!new RegExp(`\\b${part}:`, 'i').test(d)) problems.push(`direction: "${d.trim().slice(0, 14)}" lacks "${part}:"`);
    }
  }

  const formats = field(sec.structure, 'Formats');
  const primary = /primary\s+(\S+?)[;,]?(\s|$)/.exec(formats ?? '')?.[1];
  if (!FORMATS.includes(primary)) problems.push('structure: "Formats: primary <16:9|9:16|1:1>; extra <...|none>" missing or invalid');
  if (!field(sec.structure, 'Duration')) problems.push('structure: "Duration:" missing');

  if (!problems.length) console.log(`brief ok: ${directions.length} directions, ${rounds} intake round(s), genre ${genre}, primary ${primary}`);
}

if (mode === 'playbooks') checkPlaybooks();
else if (mode === 'brief' && arg) checkBrief(arg);
else { console.error('usage: node check.mjs brief <BRIEF.md> | playbooks'); process.exit(2); }
if (problems.length) {
  for (const p of problems) console.error(`check: ${p}`);
  process.exit(1);
}
