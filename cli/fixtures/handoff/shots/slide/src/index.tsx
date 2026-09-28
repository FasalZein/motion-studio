import React from 'react';
import {Composition, registerRoot, staticFile, useCurrentFrame, delayRender, continueRender, cancelRender} from 'remotion';
import {useEffect, useState} from 'react';

// Handoff into the HyperFrames title shot: the title slides in and lands, on the last frame, on the
// title shot's first-frame pose. It holds still there, as a handoff requires.
const Handoff = () => {
  const frame = useCurrentFrame();
  const [handle] = useState(() => delayRender('local font'));
  useEffect(() => {document.fonts.load('34px StudioFont').then(() => continueRender(handle)).catch(error => cancelRender(error));}, [handle]);
  return <div style={{width: 320, height: 180, backgroundColor: '#172b46', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#f2d064', fontSize: 34, fontFamily: 'StudioFont'}}>
    <style>{`@font-face {font-family: StudioFont; src: url('${staticFile('IBMPlexSans.ttf')}');}`}</style>
    <span style={{transform: `translateX(${Math.max(0, 4 - frame) * 12}px)`}}>HYPERFRAMES</span><div style={{position: 'absolute', left: 8, top: 8, width: 24, height: 24, backgroundColor: '#e05b45'}} />
  </div>;
};
export const Root = () => <Composition id="Handoff" component={Handoff} durationInFrames={6} fps={30} width={320} height={180} />;
registerRoot(Root);
