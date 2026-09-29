import {readdir, readFile} from 'node:fs/promises';
import {extname, join, relative} from 'node:path';
import type {Project, Shot} from './project.js';

/**
 * Determinism guard (D66). Every frame must be a pure function of time, so shot sources may not read a wall clock,
 * a frame loop or unseeded randomness, and may not load a script or asset from the network. Sources that import
 * three.js need the board's 3D declaration `shots[].threeD` (D65).
 *
 * This is a text check on the author's sources, not a parser: a banned name inside a comment also counts.
 */

/** The folder, inside a HyperFrames shot, where the CLI provides the pinned GSAP and three files (see engines.ts). */
export const vendorDir = 'vendor';
/** Author source files; media, fonts and the CLI-provided vendor files are not sources. */
const sourceExtensions = new Set(['.ts','.tsx','.js','.jsx','.mjs','.cjs','.html','.htm','.css']);
/** Folders inside a shot that hold dependencies or engine output, not author sources. */
const skippedDirs = new Set([vendorDir,'node_modules','snapshots','renders','beats','out','outputs','build','dist','coverage']);

const banned:{name:string; pattern:RegExp}[] = [
  {name:'useFrame', pattern:/\buseFrame\b/},
  {name:'requestAnimationFrame', pattern:/\brequestAnimationFrame\b/},
  {name:'Date.now', pattern:/\bDate\s*\.\s*now\b/},
  {name:'performance.now', pattern:/\bperformance\s*\.\s*now\b/},
  {name:'three Clock', pattern:/\bnew\s+(?:THREE\s*\.\s*)?Clock\b|\bimport\s*\{[^}]*\bClock\b[^}]*\}\s*from\s*["']three["']/},
  {name:'Math.random', pattern:/\bMath\s*\.\s*random\b/},
];
/** A URL with a scheme-relative or http(s) origin used as a script, style, asset, import or fetch source. */
const network:RegExp[] = [
  /\b(?:src|href|srcset|poster|data)\s*=\s*["']\s*(?:https?:)?\/\//i,
  /\bfrom\s*["'](?:https?:)?\/\//,
  /\bimport\s*\(?\s*["'](?:https?:)?\/\//,
  /\burl\(\s*["']?\s*(?:https?:)?\/\//i,
  /@import\s+["'](?:https?:)?\/\//i,
  /\b(?:fetch|loadAsync|load)\s*\(\s*["'`](?:https?:)?\/\//,
  /"imports"\s*:\s*\{[^}]*["'](?:https?:)?\/\//,
];
/** An import of three.js, React Three Fiber or @remotion/three, in a module import or a HyperFrames importmap or script. */
const threeImport:RegExp[] = [
  /\b(?:from|import|require\s*\()\s*\(?\s*["'](?:three(?:\/[^"']*)?|@react-three\/[^"']+|@remotion\/three(?:\/[^"']*)?)["']/,
  /["'][^"'\s]*\bthree(?:\.module|\.core|\.webgpu)?(?:\.min)?\.js["']/,
];

async function sourceFiles(dir:string):Promise<string[]> {
  const entries = await readdir(dir,{withFileTypes:true}).catch(() => []);
  const files:string[] = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const full = join(dir,entry.name);
    if (entry.isDirectory()) { if (!skippedDirs.has(entry.name)) files.push(...await sourceFiles(full)); }
    else if (entry.isFile() && sourceExtensions.has(extname(entry.name).toLowerCase())) files.push(full);
  }
  return files.sort();
}

/** One error line per banned use, network load and undeclared 3D import in one shot's sources. */
export async function shotDeterminismErrors(root:string, shot:Shot):Promise<string[]> {
  const errors:string[] = [];
  let usesThree:string|undefined;
  for (const file of await sourceFiles(join(root,'shots',shot.id))) {
    const text = await readFile(file,'utf8');
    const rel = relative(root,file);
    text.split('\n').forEach((line,i) => {
      const at = `${rel}:${i+1}`;
      for (const {name,pattern} of banned) if (pattern.test(line)) errors.push(`shot ${shot.id}: ${at} uses ${name}; drive every frame from time (useCurrentFrame or the timeline) and seeded randomness (D66)`);
      if (network.some(p => p.test(line))) errors.push(`shot ${shot.id}: ${at} loads a script or asset from the network; keep every file local in the shot (D66)`);
      if (!usesThree && threeImport.some(p => p.test(line))) usesThree = at;
    });
  }
  if (usesThree && !shot.threeD) errors.push(`shot ${shot.id}: ${usesThree} imports three.js but the storyboard does not declare 3D for this shot; the board adds "threeD": {"reason": ...} (D65)`);
  return errors;
}

/** The determinism guard over every shot, or only the named shots. A shot folder that does not exist yet has no sources. */
export async function determinismErrors({root,storyboard}:Project, only?:readonly string[]):Promise<string[]> {
  const shots = storyboard.shots.filter(s => !only || only.includes(s.id));
  return (await Promise.all(shots.map(s => shotDeterminismErrors(root,s)))).flat();
}
