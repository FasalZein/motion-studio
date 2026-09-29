import {cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile} from 'node:fs/promises';
import {dirname, join, relative, resolve} from 'node:path';
import {createRequire} from 'node:module';
import {bundle} from '@remotion/bundler';
import {renderFrames, renderStill, selectComposition} from '@remotion/renderer';

import {CliError, layoutOf, type Format, type Layout, type Project, type Shot} from './project.js';
import {remotionEntry} from './validate.js';
import type {Tools} from './seam.js';
import {vendorDir} from './determinism.js';

const require = createRequire(import.meta.url);
const hfBin = resolve(dirname(require.resolve('hyperframes/package.json')), 'bin/hyperframes.mjs');
/**
 * The node_modules folder that holds the CLI's `@remotion/transitions`. A film lives outside the CLI, so its shots
 * cannot find the package by walking up their own folders; the bundler searches this folder after theirs (D54).
 */
const transitionsModules = resolve(dirname(require.resolve('@remotion/transitions/package.json')),'..','..');

/**
 * The Chromium GL backend of every Remotion render (D65). three.js does not render with the default OpenGL renderer.
 * `angle` is the macOS route; `swangle` (SwiftShader through ANGLE) is the Linux and CI route. Pixels differ between
 * backends, so the render report records the backend and a film is compared only within one backend.
 */
export const glBackend = process.platform === 'darwin' ? 'angle' : 'swangle';
const chromiumOptions = {gl:glBackend} as const;
/** HyperFrames picks the Chrome GPU mode itself (`--browser-gpu` default: probe the host GPU, fall back to software). */
export const hyperframesGpu = 'auto';

/**
 * The pinned GSAP (core and the SplitText, Flip, MorphSVG, DrawSVG and MotionPath plugins) and three.js files that
 * the CLI provides in every staged HyperFrames shot as `vendor/<file>` (D65). Shots load them with relative paths,
 * so a render never fetches a library from a CDN.
 */
const vendorSources:{file:string; from:string}[] = [
  ...['gsap.min.js','SplitText.min.js','Flip.min.js','MorphSVGPlugin.min.js','DrawSVGPlugin.min.js','MotionPathPlugin.min.js']
    .map(file => ({file, from:join(dirname(require.resolve('gsap/package.json')),'dist',file)})),
  // three's package exports hide package.json; its main entry sits in build/ beside the module files.
  ...['three.module.min.js','three.core.min.js'].map(file => ({file, from:join(dirname(require.resolve('three')),file)})),
];
export const vendorFiles = vendorSources.map(v => v.file);
/** Copies the pinned library files into `<shotDir>/vendor/`, replacing any copy the author made. */
export async function provideVendor(shotDir:string) {
  await mkdir(join(shotDir,vendorDir),{recursive:true});
  for (const {file,from} of vendorSources) await cp(from,join(shotDir,vendorDir,file));
}

/** Remotion input props: the format's layout inputs under `layout`. */
export const remotionProps = (format:Format, {canvas,safe,overlay}:Layout) => ({layout:{format, canvas, safe, overlay}});
/**
 * HyperFrames variables: the same layout inputs, flattened, because HyperFrames variables are scalars.
 * Each scalar also reaches CSS as `--<id>` on the composition root.
 */
export const hyperframesVariables = (format:Format, {canvas,safe,overlay}:Layout) => ({
  format, canvasWidth:canvas.width, canvasHeight:canvas.height,
  safeX:safe.x, safeY:safe.y, safeWidth:safe.width, safeHeight:safe.height, overlay:overlay ?? '',
});
/**
 * CSS that hides one protected element; safezone renders a frame with and without it to measure its painted bounds (D45).
 * It uses opacity, not visibility: a descendant can set visibility:visible and stay painted, but cannot undo an ancestor's opacity.
 */
const hideCss = (id:string) => `[data-protected="${id}"]{opacity:0 !important}`;

/** Options for one engine render into a folder of numbered PNGs, one per shot-local frame. */
export type FrameRender = {format:Format; framesDir:string; hide?:string};

/**
 * A Remotion bundle for one shot. `withHide` wraps the author's entry so that the input prop
 * `motionStudioHide` hides one protected element; normal renders use the author's entry unchanged.
 */
export async function remotionBundle(project:Project, shot:Shot, withHide:boolean):Promise<{serveUrl:string; dispose:() => Promise<void>}> {
  const entry = await remotionEntry(project.root,shot);
  if (!entry) throw new CliError(`Remotion project entry missing: ${shot.id}`);
  let wrapperDir:string|undefined;
  let wrapper:string|undefined;
  try {
    if (withHide) {
      // The wrapper sits in a hidden folder of the shot, not in the author's src/, so author files stay untouched.
      // The folder is at the same depth as src/, so the bundler resolves imports the same way.
      wrapperDir = join(project.root,'shots',shot.id,`.motion-measure-${process.pid}`);
      wrapper = join(wrapperDir,'entry.tsx');
      await mkdir(wrapperDir,{recursive:true});
      await writeFile(wrapper,`import {getInputProps} from 'remotion';\nimport '${relative(wrapperDir,entry).replace(/\.tsx?$/,'')}';\nconst hide = (getInputProps() as {motionStudioHide?:string}).motionStudioHide;\nif (hide) {const style = document.createElement('style'); style.textContent = ${JSON.stringify(hideCss('__ID__'))}.replace('__ID__', hide); document.head.appendChild(style);}\n`);
    }
    // enableCaching:false: webpack's persistent cache keys on the entry path, so every film folder and every measure
    // wrapper (named by pid) adds a new ~160 MB entry under node_modules/.cache/webpack that nothing removes.
    const serveUrl = await bundle({entryPoint:wrapper ?? entry, ignoreRegisterRootWarning:Boolean(wrapper), publicDir:join(project.root,'shots',shot.id,'public'), enableCaching:false,
      webpackOverride:config => ({...config, resolve:{...config.resolve, modules:[...(config.resolve?.modules ?? ['node_modules']), transitionsModules]}})});
    return {serveUrl, dispose:() => rm(serveUrl,{recursive:true,force:true})};
  } finally {if (wrapperDir) await rm(wrapperDir,{recursive:true,force:true});}
}

/** Selects the shot's composition for one format and checks its size, fps and length against the storyboard. */
async function shotComposition(project:Project, shot:Shot, serveUrl:string, format:Format, hide?:string) {
  const {fps} = project.storyboard.meta;
  const layout = layoutOf(project.storyboard,format);
  const inputProps = {...remotionProps(format,layout), ...(hide ? {motionStudioHide:hide} : {})};
  const composition = await selectComposition({serveUrl,id:shot.entrypoint,inputProps,chromiumOptions});
  if (composition.durationInFrames !== shot.endFrame-shot.startFrame || composition.fps !== fps || composition.width !== layout.canvas.width || composition.height !== layout.canvas.height) {
    throw new CliError(`composition metadata mismatch: ${shot.id} ${format} is ${composition.width}x${composition.height} ${composition.fps} fps ${composition.durationInFrames} frames`);
  }
  return {composition,inputProps};
}

export async function renderRemotionFrames(project:Project, shot:Shot, serveUrl:string, {format,framesDir,hide}:FrameRender) {
  const {composition,inputProps} = await shotComposition(project,shot,serveUrl,format,hide);
  await renderFrames({serveUrl,composition,inputProps,chromiumOptions,outputDir:framesDir,imageFormat:'png',muted:true,onStart:()=>{},onFrameUpdate:()=>{},concurrency:1});
}

/** Renders single shot-local frames of a Remotion shot as PNG files, without rendering the rest of the shot. */
export async function renderRemotionStills(project:Project, shot:Shot, serveUrl:string, format:Format, frames:{frame:number; output:string}[]) {
  const {composition,inputProps} = await shotComposition(project,shot,serveUrl,format);
  for (const {frame,output} of frames) await renderStill({serveUrl,composition,inputProps,chromiumOptions,frame,output,imageFormat:'png'});
}

/**
 * Renders a HyperFrames shot for one format. The CLI stages a copy of `shots/<id>/` beside it,
 * sets the root's data-width and data-height to the format canvas, and passes the layout as variables.
 * The copy keeps the folder depth, so relative paths such as ../../assets still resolve. The CLI adds the pinned
 * GSAP and three files to the copy's `vendor/` folder.
 */
export async function renderHyperframesFrames(project:Project, shot:Shot, tools:Tools, {format,framesDir,hide}:FrameRender) {
  const {root,storyboard} = project;
  const layout = layoutOf(storyboard,format);
  const shotDir = join(root,'shots',shot.id);
  const stage = await mkdtemp(join(root,'shots',`.motion-${shot.id}-`));
  try {
    await cp(shotDir,stage,{recursive:true});
    await provideVendor(stage);
    const rel = relative(shotDir,resolve(root,shot.entrypoint));
    const entry = join(stage,rel);
    let html = await readFile(entry,'utf8');
    const rootTag = /<[a-zA-Z][^>]*\bdata-composition-id\s*=[^>]*>/.exec(html);
    if (!rootTag || !/\bdata-width\s*=\s*"\d+"/.test(rootTag[0]) || !/\bdata-height\s*=\s*"\d+"/.test(rootTag[0])) throw new CliError(`HyperFrames root needs data-composition-id, data-width and data-height: ${shot.entrypoint}`);
    const sized = rootTag[0].replace(/\bdata-width\s*=\s*"\d+"/,`data-width="${layout.canvas.width}"`).replace(/\bdata-height\s*=\s*"\d+"/,`data-height="${layout.canvas.height}"`);
    html = html.slice(0,rootTag.index) + sized + html.slice(rootTag.index + rootTag[0].length);
    if (hide) html = html.includes('</head>') ? html.replace('</head>',`<style>${hideCss(hide)}</style></head>`) : `<style>${hideCss(hide)}</style>` + html;
    await writeFile(entry,html);
    await tools.command('node',[hfBin,'render',dirname(entry),'--composition',rel.split('/').at(-1)!,'--output',framesDir,'--format','png-sequence','--fps',String(storyboard.meta.fps),'--workers','1','--sdr','--quiet','--variables',JSON.stringify(hyperframesVariables(format,layout))],root);
  } finally {await rm(stage,{recursive:true,force:true});}
}

/** The rendered PNG files of a frame folder in frame order; checks that there is one per shot frame. */
export async function framePngs(shot:Shot, framesDir:string):Promise<string[]> {
  const pngs = (await readdir(framesDir)).filter(f => f.endsWith('.png')).sort();
  if (pngs.length !== shot.endFrame-shot.startFrame) throw new CliError(`rendered frame count mismatch: ${shot.id} got ${pngs.length}`);
  return pngs.map(p => join(framesDir,p));
}
