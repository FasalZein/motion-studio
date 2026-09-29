// Build step: reads the motion-look pattern lists (skills/motion-look/patterns.md, the shared table, and the
// "Look-specific pattern addition" line of each looks/*.md, the single sources of truth) and writes
// dist/patterns.json, which `packet` copies into the critique evidence packet. The npm package ships dist, so the CLI
// never reads the skill folder at run time. A malformed table row or look line fails the build.
import {readdir, readFile, writeFile} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const cliRoot = resolve(dirname(fileURLToPath(import.meta.url)),'..');
const lookDir = resolve(cliRoot,'../skills/motion-look');
const out = join(cliRoot,'dist','patterns.json');

const problems = [];
// Shared table rows: `| Template pattern | Replacement |`, after the header and its `| --- | --- |` rule.
const shared = [];
const rows = (await readFile(join(lookDir,'patterns.md'),'utf8')).split('\n').filter(l => l.startsWith('|'));
for (const row of rows.slice(2)) {
  const cells = row.split('|').slice(1,-1).map(c => c.trim());
  if (cells.length !== 2 || !cells[0] || !cells[1]) problems.push(`patterns.md: row must have a pattern and a replacement: ${row}`);
  else shared.push({pattern:cells[0], replacement:cells[1]});
}
if (!shared.length) problems.push('patterns.md: no shared pattern rows');

// Look lines: `- Look-specific pattern addition: <pattern> → <replacement>.`
const lookLine = /^- Look-specific pattern addition: (.+?) → (.+)$/;
const looks = {};
for (const file of (await readdir(join(lookDir,'looks'))).filter(f => f.endsWith('.md')).sort()) {
  const id = file.replace(/\.md$/,'');
  const pairs = (await readFile(join(lookDir,'looks',file),'utf8')).split('\n').flatMap(l => {
    const m = lookLine.exec(l);
    return m ? [{pattern:m[1].trim(), replacement:m[2].trim().replace(/\.$/,'')}] : [];
  });
  if (!pairs.length) problems.push(`looks/${file}: no "- Look-specific pattern addition: <pattern> → <replacement>" line`);
  looks[id] = pairs;
}
if (problems.length) {
  for (const p of problems) console.error(`patterns: ${p}`);
  process.exit(1);
}
await writeFile(out,JSON.stringify({shared, looks},null,1) + '\n');
console.log(`patterns: ${shared.length} shared, ${Object.keys(looks).length} looks -> ${out}`);
