import React from 'react';
import {AbsoluteFill, Composition, registerRoot, useCurrentFrame} from 'remotion';
import {noise2D} from '@remotion/noise';

type Rect = {x:number; y:number; width:number; height:number};
type Props = {layout:{format:string; canvas:{width:number; height:number}; safe:Rect; overlay:string|null}};
const defaultLayout:Props['layout'] = {format:'16:9', canvas:{width:160, height:90}, safe:{x:16, y:9, width:128, height:72}, overlay:null};
const dots = [0, 1, 2, 3, 4, 5, 6, 7];

// Seeded noise: the same seed, dot and frame give the same drift in every render.
const Shot = ({layout:{safe}}:Props) => {
  const frame = useCurrentFrame();
  return <AbsoluteFill style={{backgroundColor: '#101820'}}>
    {dots.map(i => <div key={i} style={{position: 'absolute', width: 8, height: 8, borderRadius: 4, backgroundColor: '#e05b45',
      left: safe.x + (i % 4) * 32 + noise2D('drift-x', i, frame * 0.2) * 12, top: safe.y + Math.floor(i / 4) * 36 + noise2D('drift-y', i, frame * 0.2) * 12}} />)}
  </AbsoluteFill>;
};
const Root = () => <Composition id="Shot" component={Shot} durationInFrames={6} fps={30} width={160} height={90} defaultProps={{layout: defaultLayout}}
  calculateMetadata={({props}) => ({width: props.layout.canvas.width, height: props.layout.canvas.height})} />;
registerRoot(Root);
