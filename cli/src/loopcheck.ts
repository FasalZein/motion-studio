import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {CliError, type Format, type Project} from './project.js';
import {outputsOf} from './outputs.js';
import {round3, type Tools} from './seam.js';

/** Loop genres need real image and sound seam evidence. These measurements are advisory, not calibrated quality limits. */
export async function loopCheck(project:Project, format:Format, report:string, tools:Tools):Promise<void> {
  const out = outputsOf(project.root,format);
  const samplesPerChannel = Math.round(project.storyboard.meta.durationFrames/project.storyboard.meta.fps*48000);
  const temp = await mkdtemp(join(dirname(report),'.motion-loop-'));
  try {
    const pictures:Buffer[] = [];
    for (const frame of [0,project.storyboard.meta.durationFrames-1]) {
      const file = join(temp,`frame-${frame}.rgb`);
      await tools.command('ffmpeg',['-hide_banner','-loglevel','error','-nostdin','-y','-i',out.master,'-vf',
        `select='eq(n\\,${frame})',scale=64:64:flags=area`,'-frames:v','1','-pix_fmt','rgb24','-f','rawvideo',file]);
      pictures.push(await readFile(file));
    }
    if (pictures.some(p => p.length !== 64*64*3)) throw new CliError(`loop check cannot read boundary pictures: ${format}`);
    let sum = 0;
    for (let i=0;i<pictures[0].length;i++) sum += Math.abs(pictures[0][i]-pictures[1][i]);
    const audioFile = join(temp,'audio.f32');
    await tools.command('ffmpeg',['-hide_banner','-loglevel','error','-nostdin','-y','-i',join(out.dir,'mix.wav'),'-vn','-ar','48000','-ac','2','-af',`atrim=end_sample=${samplesPerChannel}`,'-f','f32le',audioFile]);
    const bytes = await readFile(audioFile);
    const samples = new Float32Array(new Uint8Array(bytes).buffer);
    if (samples.length !== samplesPerChannel*2) throw new CliError(`loop check cannot read boundary audio: ${format}`);
    const jump = Math.max(Math.abs(samples[0]-samples.at(-2)!),Math.abs(samples[1]-samples.at(-1)!));
    await writeFile(report,JSON.stringify({format, picture:{source:'master.mkv',firstFrame:0, lastFrame:project.storyboard.meta.durationFrames-1,
      meanAbsoluteDifference:round3(sum/pictures[0].length/255), basis:'64x64 RGB, 0 to 1'},
      audio:{source:'mix.wav',sampleRate:48000, channels:2,samplesPerChannel, boundarySampleJump:round3(jump)},
      verdict:'review required', limitation:'No calibrated pass threshold. Boundary equality does not prove matching velocity or seamless sound; inspect repeated playback.'},null,2)+'\n');
  } finally {await rm(temp,{recursive:true,force:true});}
}
