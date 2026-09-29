import {test as nodeTest} from 'node:test';
const {expect} = await import('bun' in process.versions ? 'bun:test' : 'expect');
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {cp, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';

// UI kit fixture (#46, D78): a Remotion component themed only from brand tokens renders through the CLI as stills and
// as a short behavior clip. Expected colors come from the fixture's tokens.json; expected behavior (typing, then the
// selection sweep) from the component's written schedule, not from the rendered output.
const test = (name:string, fn:()=>Promise<void>, timeout=600000) => nodeTest(name,{timeout},fn);
const here = dirname(fileURLToPath(import.meta.url));
const cli = resolve(here,'../dist/cli.js');
const fixture = resolve(here,'../fixtures/ui-kit');
const runtime = 'bun' in process.versions ? 'bun' : 'node';
const run = (...args:string[]) => spawnSync(runtime,[cli,...args],{encoding:'utf8',timeout:300000,input:''});
function ok(...args:string[]) {
  const result = run(...args);
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
}
const WIDTH = 320;
/** RGB bytes of frame n of an image or video, decoded by ffmpeg. */
const rgb = (file:string, n = 0) => new Uint8Array(spawnSync('ffmpeg',['-v','error','-i',file,'-map','0:v:0','-vf',`select=eq(n\\,${n})`,'-fps_mode','passthrough','-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','-'],{encoding:null,timeout:30000,maxBuffer:1e8}).stdout);
const at = (px:Uint8Array, x:number, y:number) => [...px.subarray((y*WIDTH+x)*3,(y*WIDTH+x)*3+3)];
const hex = (h:string) => [1,3,5].map(i => parseInt(h.slice(i,i+2),16));
/** Every channel within `tolerance` of the token color; a lossless PNG matches exactly, the YUV clip within rounding. */
const near = (actual:number[], token:string, tolerance:number) => actual.every((v,i) => Math.abs(v-hex(token)[i]) <= tolerance);
/** Pixels in the typed-text span of the field (right of the caret's start position) close to the text color. */
function textPixels(px:Uint8Array, text:string) {
  let n = 0;
  for (let y = 32; y < 60; y++) for (let x = 44; x < 200; x++) if (near(at(px,x,y),text,60)) n++;
  return n;
}

test(`${runtime}: the UI kit renders a token-themed still and a behavior clip through the CLI`, async () => {
  const dir = await mkdtemp(join(tmpdir(),'motion-studio-uikit-'));
  try {
    await cp(fixture,dir,{recursive:true,filter:src => !src.endsWith('/renders')});
    const {color} = JSON.parse(await readFile(join(dir,'shots/kit/tokens.json'),'utf8'));
    ok('validate',dir);
    const still = join(dir,'renders/16x9/shots/kit.png');
    // Frame 0: empty field, row not selected. Canvas, field surface and row surface are the token colors.
    ok('still',dir,'kit','0');
    const first = rgb(still);
    expect(near(at(first,4,4),color.canvas,0)).toBe(true);
    expect(near(at(first,200,46),color.surface,0)).toBe(true);
    expect(near(at(first,280,104),color.surface,0)).toBe(true);
    const emptyText = textPixels(first,color.text);
    // Frame 11: the query is typed and the selection highlight has swept the whole row in the accent token.
    ok('still',dir,'kit','11');
    const last = rgb(still);
    expect(near(at(last,280,104),color.accent,0)).toBe(true);
    expect(textPixels(last,color.text)).toBeGreaterThan(emptyText+20);

    // The behavior clip: the whole 12-frame shot through `render`, with the same token colors and the same change.
    ok('render',dir);
    const clip = join(dir,'renders/16x9/shots/kit.mkv');
    const frames = spawnSync('ffprobe',['-v','error','-count_frames','-select_streams','v:0','-show_entries','stream=nb_read_frames','-of','csv=p=0',clip],{encoding:'utf8'}).stdout.trim();
    expect(frames).toBe('12');
    const c0 = rgb(clip,0), c11 = rgb(clip,11);
    expect(near(at(c0,4,4),color.canvas,3)).toBe(true);
    expect(near(at(c0,280,104),color.surface,3)).toBe(true);
    expect(near(at(c11,280,104),color.accent,3)).toBe(true);
    // Typing is visible frame by frame: 'c' at frame 2, 'cli' at 6, 'clip' at 10 (the caret is off on all three).
    const counts = [2,6,10].map(n => textPixels(rgb(clip,n),color.text));
    for (let i = 1; i < counts.length; i++) expect(counts[i]).toBeGreaterThan(counts[i-1]);

    // The tokens drive the render: a new accent token in tokens.json gives the new accent color, with no component edit.
    const tokensFile = join(dir,'shots/kit/tokens.json');
    const tokens = JSON.parse(await readFile(tokensFile,'utf8'));
    const accent = '#36c2ff';
    await writeFile(tokensFile,JSON.stringify({...tokens, color:{...tokens.color, accent}},null,2));
    ok('still',dir,'kit','11');
    const swapped = rgb(still);
    expect(near(at(swapped,280,104),accent,0)).toBe(true);
    expect(near(at(swapped,4,4),color.canvas,0)).toBe(true);
  } finally {await rm(dir,{recursive:true,force:true});}
});
