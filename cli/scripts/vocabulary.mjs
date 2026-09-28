// Build step: reads the motion-vocabulary glossary (the skill's terms/*.md, the single source of truth) and writes
// dist/vocabulary.json, the term list that `validate` checks storyboard terms against. The npm package ships dist,
// so the CLI never reads the skill folder at run time. A malformed term entry fails the build.
import {readdir, readFile, writeFile} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const cliRoot = resolve(dirname(fileURLToPath(import.meta.url)),'..');
const termsDir = resolve(cliRoot,'../skills/motion-vocabulary/terms');
const out = join(cliRoot,'dist','vocabulary.json');

// A term entry: `- **Name** (`kebab-id`) - One-line definition.` then `  - HF: ...` and `  - Remotion: ...` lines.
const termLine = /^- \*\*(.+?)\*\* \(`([a-z0-9]+(?:-[a-z0-9]+)*)`\) - (\S.*)$/;
const recipeLine = /^ {2}- (HF|Remotion): \S/;

const problems = [];
const terms = [];
for (const file of (await readdir(termsDir)).filter(f => f.endsWith('.md')).sort()) {
  const category = file.replace(/\.md$/,'');
  const lines = (await readFile(join(termsDir,file),'utf8')).split('\n');
  let current = null;
  const close = () => { if (current && !current.recipes) problems.push(`${file}: term ${current.id} has no HF rule or Remotion recipe`); };
  for (const [i,line] of lines.entries()) {
    if (line.startsWith('- ')) {
      close();
      const m = termLine.exec(line);
      if (!m) {problems.push(`${file}:${i + 1}: term entry must be "- **Name** (\`kebab-id\`) - definition"`); current = null; continue;}
      current = {id:m[2], name:m[1], category, recipes:0};
      terms.push(current);
    } else if (line.startsWith('  - ')) {
      if (!current || !recipeLine.test(line)) problems.push(`${file}:${i + 1}: recipe line must be "  - HF: ..." or "  - Remotion: ..." under a term`);
      else current.recipes++;
    }
  }
  close();
}
const ids = terms.map(t => t.id);
for (const id of new Set(ids.filter((id,i) => ids.indexOf(id) !== i))) problems.push(`term id ${id} is defined more than once`);
if (!terms.length) problems.push(`no terms found in ${termsDir}`);
if (problems.length) {
  for (const p of problems) console.error(`vocabulary: ${p}`);
  process.exit(1);
}
await writeFile(out,JSON.stringify({terms:terms.map(({id,name,category}) => ({id,name,category}))},null,1) + '\n');
console.log(`vocabulary: ${terms.length} terms -> ${out}`);
