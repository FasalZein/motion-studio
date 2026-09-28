import React from 'react';
import {Composition, staticFile, useCurrentFrame, delayRender, continueRender, cancelRender} from 'remotion';
import {useEffect, useState} from 'react';

const Shot = () => {
  const frame = useCurrentFrame();
  const [handle] = useState(() => delayRender('local font'));
  useEffect(() => {document.fonts.load('34px StudioFont').then(() => continueRender(handle)).catch(error => cancelRender(error));}, [handle]);
  return <div style={{width: 320, height: 180, backgroundColor: '#172b46', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#f2d064', fontSize: 34, fontFamily: 'StudioFont'}}>
    <style>{`@font-face {font-family: StudioFont; src: url('${staticFile('IBMPlexSans.ttf')}');}`}</style>
    <span>FRAME {frame}</span><div style={{position: 'absolute', left: 8, top: 8, width: 24, height: 24, backgroundColor: '#e05b45'}} />
  </div>;
};
// Handoff: the text slides in and lands, on the last frame, where the HyperFrames shot starts.
const Handoff = () => {
  const frame = useCurrentFrame();
  const [handle] = useState(() => delayRender('local font'));
  useEffect(() => {document.fonts.load('34px StudioFont').then(() => continueRender(handle)).catch(error => cancelRender(error));}, [handle]);
  return <div style={{width: 320, height: 180, backgroundColor: '#172b46', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#f2d064', fontSize: 34, fontFamily: 'StudioFont'}}>
    <style>{`@font-face {font-family: StudioFont; src: url('${staticFile('IBMPlexSans.ttf')}');}`}</style>
    <span style={{transform: `translateX(${(5 - frame) * 12}px)`}}>HYPERFRAMES</span><div style={{position: 'absolute', left: 8, top: 8, width: 24, height: 24, backgroundColor: '#e05b45'}} />
  </div>;
};
export const Root = () => <>
  <Composition id="Shot" component={Shot} durationInFrames={6} fps={30} width={320} height={180} />
  <Composition id="Handoff" component={Handoff} durationInFrames={6} fps={30} width={320} height={180} />
</>;
import {registerRoot} from 'remotion';
registerRoot(Root);
