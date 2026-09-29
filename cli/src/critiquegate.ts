import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {readdir, readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {chosenFormats, formatDir, type GateId, type Project} from './project.js';
import {outputsOf} from './outputs.js';

/**
 * The critique approval check (D78), configured by the `critique` entry of schema/gate-inputs.json. A gate approval
 * needs a current critique report per chosen format: the packet `packet` describes the current master, and a report
 * matching `reports` names that packet and master hash and comes from a fresh (independent) reviewer.
 */
export type CritiqueRule = {gate:GateId; packet:string; reports:string};

const sha256 = async (file:string) => {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
};
const escape = (s:string) => s.replace(/[.+?^${}()|[\]\\]/g,'\\$&');

/** Reports matching the rule's glob; only `*` inside the file name is supported, as in `critique/loop-*.md`. */
async function reports(root:string, glob:string):Promise<{path:string; text:string}[]> {
  const slash = glob.lastIndexOf('/');
  const dir = slash < 0 ? '' : glob.slice(0,slash);
  const name = new RegExp(`^${escape(glob.slice(slash+1)).replaceAll('*','[^/]*')}$`);
  const files = (await readdir(join(root,dir)).catch(() => [] as string[])).filter(f => name.test(f)).sort();
  return Promise.all(files.map(async f => ({path:dir ? `${dir}/${f}` : f, text:await readFile(join(root,dir,f),'utf8').catch(() => '')})));
}

/** One refusal per chosen format that has no current critique report; empty when every format has one. */
export async function critiqueRefusals(project:Project, rule:CritiqueRule):Promise<string[]> {
  const {root} = project;
  const found = await reports(root,rule.reports);
  const refusals:string[] = [];
  for (const format of chosenFormats(project.storyboard.meta)) {
    const master = outputsOf(root,format).master;
    const masterRel = `renders/${formatDir(format)}/master.mkv`;
    const hash = await sha256(master).catch(() => null);
    if (hash === null) { refusals.push(`critique ${format} missing (no ${masterRel})`); continue; }
    const packetRel = rule.packet.replaceAll('{format}',formatDir(format));
    const packet = await readFile(join(root,packetRel),'utf8').then(t => JSON.parse(t),() => null);
    if (packet === null) { refusals.push(`critique ${format} missing (no readable ${packetRel})`); continue; }
    if (packet?.render?.masterSha256 !== hash) { refusals.push(`critique ${format} stale (${packetRel} describes another master)`); continue; }
    const line = new RegExp(`^Packet: ${escape(packetRel)}; master sha256: ${hash}\\s*$`,'m');
    const matching = found.filter(r => line.test(r.text));
    if (!matching.length) { refusals.push(`critique ${format} missing (no ${rule.reports} names ${packetRel} with the current master sha256)`); continue; }
    if (!matching.some(r => /^Mode: in-studio; independence: independent\s*$/m.test(r.text)))
      refusals.push(`critique ${format} non-independent (${matching.map(r => r.path).join(', ')}; dispatch a fresh reviewer)`);
  }
  return refusals;
}
