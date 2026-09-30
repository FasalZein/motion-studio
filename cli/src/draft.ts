import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {chosenFormats, layoutOf, type Project} from './project.js';
import {outputsOf, type Outputs} from './outputs.js';
import type {Tools} from './seam.js';

async function sha256(file:string):Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

/** Receipt written only after the encoder verifies the playable draft against this master. */
export async function writeDraftProof(out:Outputs):Promise<void> {
  await writeFile(join(out.dir,'draft.json'),JSON.stringify({masterSha256:await sha256(out.master),draftSha256:await sha256(join(out.dir,'draft.mp4'))},null,2)+'\n');
}

/** G4 must show a playable copy of the same master its current critic reviewed, in every chosen format. */
export async function draftRefusals(project:Project, tools:Tools):Promise<string[]> {
  const refusals:string[] = [];
  for (const format of chosenFormats(project.storyboard.meta)) {
    const out = outputsOf(project.root,format);
    try {
      const proof:unknown = JSON.parse(await readFile(join(out.dir,'draft.json'),'utf8'));
      if (typeof proof !== 'object' || proof === null || !('masterSha256' in proof) || !('draftSha256' in proof) ||
          proof.masterSha256 !== await sha256(out.master) || proof.draftSha256 !== await sha256(join(out.dir,'draft.mp4'))) {
        refusals.push(`draft ${format} does not match its reviewed master`); continue;
      }
      const {canvas} = layoutOf(project.storyboard,format), {meta} = project.storyboard;
      const probe = JSON.parse(await tools.command('ffprobe',['-v','error','-count_frames','-show_entries',
        'stream=codec_type,codec_name,width,height,nb_read_frames,r_frame_rate','-of','json',join(out.dir,'draft.mp4')]));
      const video = probe.streams?.find((s:{codec_type:string}) => s.codec_type === 'video');
      const audio = probe.streams?.find((s:{codec_type:string}) => s.codec_type === 'audio');
      if (video?.codec_name !== 'h264' || audio?.codec_name !== 'aac' || video.width !== canvas.width || video.height !== canvas.height ||
          Number(video.nb_read_frames) !== meta.durationFrames || video.r_frame_rate !== `${meta.fps}/1`)
        refusals.push(`draft ${format} is not a playable full-pass H.264/AAC MP4`);
    } catch {refusals.push(`draft ${format} is missing or unreadable`);}
  }
  return refusals;
}
