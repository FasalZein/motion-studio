// Checks that every file the engine contracts allow-list exists under each installed skill root (D58).
// Usage: node scripts/allowlist.mjs [<skills-root>...]; the default roots are ~/.agents/skills and ~/.claude/skills.
import {readFileSync, statSync} from 'node:fs';
import {homedir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const engines = resolve(dirname(fileURLToPath(import.meta.url)),'../../skills/motion-studio/engines');
const roots = process.argv.length > 2 ? process.argv.slice(2) : [join(homedir(),'.agents/skills'), join(homedir(),'.claude/skills')];
const isFile = path => { try {return statSync(path).isFile();} catch {return false;} };
let missing = 0, checked = 0;
for (const contract of ['hyperframes.md','remotion.md']) {
  const text = readFileSync(join(engines,contract),'utf8');
  const list = text.slice(text.indexOf('## API depth allow-list'));
  const paths = [...new Set([...list.matchAll(/`<skills>\/([^`]+)`/g)].map(m => m[1]))];
  if (!paths.length) {console.error(`error: ${contract}: no allow-listed paths found`); missing++;}
  for (const rel of paths) for (const root of roots) {
    checked++;
    if (!isFile(join(root,rel))) {console.error(`error: ${contract}: ${join(root,rel)} not found`); missing++;}
  }
}
console.log(`${checked - missing} of ${checked} allow-listed paths found under ${roots.join(', ')}`);
process.exitCode = missing ? 1 : 0;
