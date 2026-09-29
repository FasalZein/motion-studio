import React from 'react';
import {Composition, useCurrentFrame} from 'remotion';

// Layout inputs arrive as props. The box crosses the safe area for the whole test; at frame 12 the background changes
// (the seam) while the box keeps moving, and the label slides in (the type beat).
type Rect = {x:number; y:number; width:number; height:number};
type Props = {layout:{format:string; canvas:{width:number; height:number}; safe:Rect; overlay:string|null}};
const defaultLayout:Props['layout'] = {format:'16:9', canvas:{width:320, height:180}, safe:{x:32, y:18, width:256, height:144}, overlay:null};

const Look = ({layout:{canvas,safe}}:Props) => {
  const frame = useCurrentFrame();
  return <div style={{position: 'relative', width: canvas.width, height: canvas.height, overflow: 'hidden', background: frame < 12 ? '#172b46' : '#2d4a2f'}}>
    <div style={{position: 'absolute', left: safe.x + (safe.width - 40) * frame / 23, top: safe.y + safe.height / 2 - 20, width: 40, height: 40, background: '#e05b45'}} />
    <div style={{position: 'absolute', left: safe.x + 4 * frame, top: safe.y, font: '20px sans-serif', color: '#f2d064'}}>LOOK</div>
  </div>;
};
export const Root = () => <Composition id="Look" component={Look} durationInFrames={24} fps={30} width={320} height={180} defaultProps={{layout: defaultLayout}}
  calculateMetadata={({props}) => ({width: props.layout.canvas.width, height: props.layout.canvas.height})} />;
import {registerRoot} from 'remotion';
registerRoot(Root);
