import React from 'react';
import {AbsoluteFill, Composition, registerRoot, useCurrentFrame} from 'remotion';
import {ThreeCanvas} from '@remotion/three';

type Rect = {x:number; y:number; width:number; height:number};
type Props = {layout:{format:string; canvas:{width:number; height:number}; safe:Rect; overlay:string|null}};
const defaultLayout:Props['layout'] = {format:'16:9', canvas:{width:160, height:90}, safe:{x:16, y:9, width:128, height:72}, overlay:null};

// Every pose comes from the frame; the canvas has no frame loop of its own.
const Shot = ({layout:{canvas}}:Props) => {
  const frame = useCurrentFrame();
  return <AbsoluteFill style={{backgroundColor: '#101820'}}>
    <ThreeCanvas width={canvas.width} height={canvas.height} camera={{position: [0, 0, 4], fov: 50}}>
      <ambientLight intensity={0.4} />
      <directionalLight position={[2, 2, 3]} intensity={2} />
      <mesh rotation={[frame * 0.2, frame * 0.14, 0]}>
        <icosahedronGeometry args={[1, 0]} />
        <meshStandardMaterial color="#e05b45" flatShading />
      </mesh>
    </ThreeCanvas>
  </AbsoluteFill>;
};
const Root = () => <Composition id="Shot" component={Shot} durationInFrames={6} fps={30} width={160} height={90} defaultProps={{layout: defaultLayout}}
  calculateMetadata={({props}) => ({width: props.layout.canvas.width, height: props.layout.canvas.height})} />;
registerRoot(Root);
