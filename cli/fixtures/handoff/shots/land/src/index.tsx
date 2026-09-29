import React from 'react';
import {Composition, registerRoot, staticFile, useCurrentFrame, delayRender, continueRender, cancelRender} from 'remotion';
import {useEffect, useState} from 'react';

// The mover travels right at a constant SPEED px per film frame: left = 12 + SPEED * (START + local frame).
// START is the shot's first film frame, so the frame one past the end is the next shot's first pose.
const START = 12;
const SPEED = 5;
type Layout = {layout: {canvas: {width: number; height: number}}};
const Mover = ({layout}: Layout) => {
  const frame = useCurrentFrame();
  const [handle] = useState(() => delayRender('local font'));
  useEffect(() => {document.fonts.load('24px StudioFont').then(() => continueRender(handle)).catch(error => cancelRender(error));}, [handle]);
  return <div style={{position: 'absolute', inset: 0, backgroundColor: '#172b46'}}>
    <style>{`@font-face {font-family: StudioFont; src: url('${staticFile('IBMPlexSans.ttf')}');}`}</style>
    <div style={{position: 'absolute', left: 8, top: 8, width: 24, height: 24, backgroundColor: '#e05b45'}} />
    <div style={{position: 'absolute', left: 12 + SPEED * (START + frame), top: layout.canvas.height / 2 - 12, height: 24, display: 'flex', alignItems: 'center', gap: 4, color: '#f2d064', font: '24px/24px StudioFont'}}>
      <div style={{width: 24, height: 24, backgroundColor: '#f2d064'}} />GO
    </div>
  </div>;
};
const primary = {layout: {canvas: {width: 320, height: 180}}};
export const Root = () => <Composition id="Mover" component={Mover} durationInFrames={6} fps={30} width={320} height={180} defaultProps={primary}
  calculateMetadata={({props}: {props: Layout}) => ({width: props.layout.canvas.width, height: props.layout.canvas.height})} />;
registerRoot(Root);
