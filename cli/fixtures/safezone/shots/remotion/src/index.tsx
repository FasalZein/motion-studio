import React from 'react';
import {Composition, staticFile, useCurrentFrame, delayRender, continueRender, cancelRender} from 'remotion';
import {useEffect, useState} from 'react';

// Layout inputs arrive as props (see motion-studio engines/remotion.md). The defaults are the 16:9 layout.
type Rect = {x:number; y:number; width:number; height:number};
type Props = {layout:{format:string; canvas:{width:number; height:number}; safe:Rect; overlay:string|null}};
const defaultLayout:Props['layout'] = {format:'16:9', canvas:{width:320, height:180}, safe:{x:32, y:18, width:256, height:144}, overlay:null};

const Shot = ({layout:{canvas,safe}}:Props) => {
  const frame = useCurrentFrame();
  const [handle] = useState(() => delayRender('local font'));
  useEffect(() => {document.fonts.load('20px StudioFont').then(() => continueRender(handle)).catch(error => cancelRender(error));}, [handle]);
  // Entrance travel: the title slides in from off the left edge over frames 0-1 and holds from frame 2.
  const travel = frame < 2 ? -canvas.width * (2 - frame) / 2 : 0;
  return <div style={{position: 'relative', width: canvas.width, height: canvas.height, overflow: 'hidden', fontFamily: 'StudioFont'}}>
    <style>{`@font-face {font-family: StudioFont; src: url('${staticFile('IBMPlexSans.ttf')}');}`}</style>
    <div data-full-bleed style={{position: 'absolute', inset: 0, background: 'repeating-linear-gradient(45deg, #172b46 0 12px, #24406b 12px 24px)'}} />
    <div data-protected="title" style={{position: 'absolute', left: safe.x, top: safe.y, width: safe.width, fontSize: 20, lineHeight: '24px', color: '#f2d064', transform: `translateX(${travel}px)`}}>Every format from one timeline</div>
    <div data-protected="corner" style={{position: 'absolute', left: 2, top: 2, fontSize: 10, lineHeight: '12px', color: '#ffffff'}}>LIVE</div>
    <svg style={{position: 'absolute', left: 0, top: 0}} width={canvas.width} height={canvas.height}><rect x={safe.x + safe.width - 24} y={safe.y + safe.height - 24} width={16} height={16} fill="#e05b45" /></svg>
  </div>;
};
export const Root = () => <Composition id="Shot" component={Shot} durationInFrames={6} fps={30} width={320} height={180} defaultProps={{layout: defaultLayout}}
  calculateMetadata={({props}) => ({width: props.layout.canvas.width, height: props.layout.canvas.height})} />;
import {registerRoot} from 'remotion';
registerRoot(Root);
