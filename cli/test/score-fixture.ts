import {createHash} from 'node:crypto';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {parseProject} from '../src/project.ts';
import {scoreStateHash} from '../src/scoregate.ts';
const hash = (data:string|Uint8Array) => createHash('sha256').update(data).digest('hex');

/** Faithful imported-score evidence for gate-only fixtures; these tests do not exercise synthesis or audio decoding. */
export async function scoreFixture(root:string) {
  const parsed = await parseProject(root);
  if (!parsed.ok) throw Error(parsed.errors.join('; '));
  const {project} = parsed;
  if (!(await readFile(join(root,'beatmap.md'),'utf8').catch(()=>'')).trim()) await writeFile(join(root,'beatmap.md'),'# Gate fixture beat contract\n');
  const dir = join(root,'audio/scores/r1');
  await mkdir(dir,{recursive:true});
  project.storyboard.audio.track = 'score-r1-music';
  const files = [];
  for (const file of ['music.wav','score.wav']) {
    const bytes = `gate fixture ${file}`;
    await writeFile(join(dir,file),bytes);
    const id = `score-r1-${file.slice(0,-4)}`;
    const entry = {id,type:'audio',sourceKind:'code' as const,sourceUrlOrGenerator:'gate fixture',providerAssetId:null,license:{status:'known' as const,name:'synthesized original',evidence:'gate-only fixture'},localPath:`audio/scores/r1/${file}`,sha256:hash(bytes),shots:[]};
    project.ledger.assets = [...project.ledger.assets.filter(a=>a.id!==id),entry];
    files.push({file,sha256:hash(bytes)});
  }
  const report = {version:1,passed:true,timingPassed:true,determinismPassed:true,fps:project.storyboard.meta.fps,durationFrames:project.storyboard.meta.durationFrames,loudness:{integratedLufs:-14,truePeakDbtp:-1.3},inputHashes:{'beatmap.md':hash(await readFile(join(root,'beatmap.md')).catch(()=>''))},files};
  const reportBytes = JSON.stringify(report);
  await writeFile(join(dir,'audio-report.json'),reportBytes);
  await writeFile(join(dir,'import.json'),JSON.stringify({track:project.storyboard.audio.track,reportSha256:hash(reportBytes),scoreStateSha256:scoreStateHash(project.storyboard)}));
  await writeFile(join(dir,'listening.md'),'User: hits align; mood fits; no harshness; logo resolves; SFX density fits.');
  await writeFile(join(root,'storyboard.json'),JSON.stringify(project.storyboard,null,2));
  await writeFile(join(root,'ledger.json'),JSON.stringify(project.ledger,null,2));
}
