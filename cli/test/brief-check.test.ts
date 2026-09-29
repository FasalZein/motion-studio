import {test as nodeTest} from 'node:test';
const {expect} = await import('bun' in process.versions ? 'bun:test' : 'expect');
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const test = (name:string, fn:()=>void, timeout=60000) => nodeTest(name,{timeout},fn);
const here = dirname(fileURLToPath(import.meta.url));
const skill = resolve(here,'../../skills/motion-studio');
const check = join(skill,'evals/check.mjs');
const fixtures = join(skill,'evals/fixtures');
// The skill eval checker is a standalone script; each test runner runs it under its own runtime.
const runtime = 'bun' in process.versions ? 'bun' : 'node';
const run = (...args:string[]) => spawnSync(runtime,[check,...args],{encoding:'utf8',timeout:30000,input:''});

test(`${runtime}: check.mjs passes the shipped playbooks and a complete brief`, () => {
  const playbooks = run('playbooks');
  expect(playbooks.stderr).toBe('');
  expect(playbooks.status).toBe(0);
  expect(playbooks.stdout).toContain('playbooks ok: 5 genres, untested: showreel, social-kinetic-type, ui-morph-loop');

  const brief = run('brief',join(fixtures,'briefs/ok.md'));
  expect(brief.stderr).toBe('');
  expect(brief.status).toBe(0);
  expect(brief.stdout).toContain('brief ok: 3 directions, 2 intake round(s), genre product-launch');
});

// Each broken brief is fixtures/briefs/ok.md with one change (template.md and skeleton.md are the unfilled starting
// points). Line numbers count from the top of the fixture file.
const brokenBriefs:[string,string[]][] = [
  ['unfilled-tokens.md',['line 6: unfilled template token <brand material seen on the site, user files, rights status>','line 14: unfilled template token <who>']],
  ['tbd.md',['line 8: unfilled template token TBD']],
  ['template-section.md',['<build> still holds the template text']],
  ['template.md',['unfilled template token <url>','unfilled template token <who>','<gotchas> still holds the template text']],
  ['skeleton.md',['<inputs> missing or empty','<start> missing or empty']],
  ['rounds-zero.md',['0 intake rounds; must be 1 to 3']],
  ['rounds-four.md',['4 intake rounds; must be 1 to 3']],
  ['logline-and.md',['the logline contains "and"']],
];

test(`${runtime}: check.mjs fails each broken brief with its rule's message`, () => {
  for (const [file,messages] of brokenBriefs) {
    const result = run('brief',join(fixtures,'briefs',file));
    expect({file,status:result.status,stdout:result.stdout}).toEqual({file,status:1,stdout:''});
    for (const message of messages) expect({file,stderr:result.stderr}).toEqual({file,stderr:expect.stringContaining(message)});
  }
});

test(`${runtime}: check.mjs flags each hold offered as an alternative to motion and passes a living hold (D67)`, () => {
  // Fixture lines 16-19 each offer a hold as an alternative; line 20 is a living hold, the D67 rule itself.
  const holds = run('playbook',join(fixtures,'playbooks/hold-alternatives/product-launch.md'));
  expect(holds.status).toBe(1);
  const flagged = [...holds.stderr.matchAll(/product-launch\.md:(\d+): offers a hold as an alternative to a motion event \(D67\)/g)].map(m => Number(m[1]));
  expect(flagged).toEqual([16,17,18,19]);

  const status = run('playbook',join(fixtures,'playbooks/status-mismatch/showreel.md'));
  expect(status.status).toBe(1);
  expect(status.stderr).toContain('showreel.md: heading must end "| worked" to match status worked');
});
