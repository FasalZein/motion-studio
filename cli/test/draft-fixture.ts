import {createHash} from 'node:crypto';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';

/** Faithful fake encoder for gate-only fixtures whose lossless master is a byte/hash stand-in.
 * Other suites exercise the real deliver encoder. This fixture still writes a real playable MP4. */
export async function draftFixture(root:string):Promise<void> {
  const s = JSON.parse(await readFile(join(root,'storyboard.json'),'utf8'));
  for (const format of [s.meta.formats.primary,...s.meta.formats.extra]) {
    const folder = format.replace(':','x'), out = join(root,'renders',folder), {width,height} = s.meta.layouts[format].canvas;
    await mkdir(out,{recursive:true});
    const master = await readFile(join(out,'master.mkv'));
    const file = join(out,'draft.mp4');
    const result = spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-nostdin','-y','-f','lavfi','-i',`color=black:s=${width}x${height}:r=${s.meta.fps}`,
      '-f','lavfi','-i','anullsrc=r=48000:cl=stereo','-t',String(s.meta.durationFrames/s.meta.fps),'-frames:v',String(s.meta.durationFrames),
      '-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac',file],{encoding:'utf8',timeout:30000});
    if (result.status !== 0) throw Error(result.stderr);
    const sha = (b:Buffer) => createHash('sha256').update(b).digest('hex');
    await writeFile(join(out,'draft.json'),JSON.stringify({masterSha256:sha(master),draftSha256:sha(await readFile(file))})+'\n');
  }
}
