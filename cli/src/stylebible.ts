import {readFile} from 'node:fs/promises';
import {CliError} from './project.js';

export const styleBibleUsage = 'usage: motion-studio style-bible <style-bible.md> [--reference <source>]...';

// A reference section of the motion-look style-bible template: `### <source>` under `## References`, with the lines
// `- Evidence:`, `- Take:` and `- Do not take:`. Each line needs its own text, not the template's `<placeholder>`.
const fields = ['Evidence','Take','Do not take'];
const placeholder = /<[a-z][^<>]*>/;

/**
 * Checks a style bible made from references: every reference section records evidence, what to take and what not to
 * take. Each `--reference` must be named by a section heading, so a supplied source cannot be left out.
 */
export async function styleBible(args:string[]):Promise<string[]> {
  const [file,...rest] = args;
  if (!file) throw new CliError(styleBibleUsage);
  const required:string[] = [];
  for (let i=0;i<rest.length;i+=2) {
    if (rest[i] !== '--reference' || !rest[i+1]?.trim()) throw new CliError(styleBibleUsage);
    required.push(rest[i+1]);
  }
  let text:string;
  try {text = await readFile(file,'utf8');}
  catch {throw new CliError(`${file}: cannot read the style bible`);}
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex(l => /^## References\s*$/.test(l));
  if (start < 0) throw new CliError(`${file}: no "## References" section`);
  const end = lines.findIndex((l,i) => i > start && /^## /.test(l));
  const sections:{heading:string; body:string[]}[] = [];
  for (const line of lines.slice(start+1,end < 0 ? undefined : end)) {
    if (line.startsWith('### ')) sections.push({heading:line.slice(4).trim(), body:[]});
    else sections.at(-1)?.body.push(line);
  }
  const errors:string[] = [];
  if (!sections.length) errors.push(`${file}: "## References" has no "### <source>" section`);
  for (const {heading,body} of sections) {
    if (!heading || placeholder.test(heading)) errors.push(`${file}: reference "${heading}" needs a source id, URL or path, and its rights status`);
    for (const field of fields) {
      const values = body.flatMap(l => l.startsWith(`- ${field}:`) ? [l.slice(field.length+3).trim()] : []);
      if (!values.length) errors.push(`${file}: reference "${heading}" has no "- ${field}:" line`);
      else if (values.some(v => !v || placeholder.test(v))) errors.push(`${file}: reference "${heading}" has an empty or template "- ${field}:" line`);
    }
  }
  for (const source of required) if (!sections.some(s => s.heading.includes(source))) errors.push(`${file}: no reference section names ${source}`);
  if (errors.length) throw new CliError(errors.join('\nerror: '));
  return [...sections.map(s => `ok ${s.heading}: evidence, take and do not take recorded`), `style bible ok: ${sections.length} reference${sections.length === 1 ? '' : 's'}`];
}
