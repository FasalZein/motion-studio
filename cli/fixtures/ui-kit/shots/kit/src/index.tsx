import React, {useEffect, useState} from 'react';
import {AbsoluteFill, Composition, continueRender, cancelRender, delayRender, registerRoot, staticFile, useCurrentFrame, interpolate, Easing} from 'remotion';
import tokens from '../tokens.json';

// A UI kit component themed only from the brand tokens: a search field that types a query, then a result row whose
// selection highlight expands. The kit renders as a still and as a short behavior clip before any shot uses it.
type Rect = {x:number; y:number; width:number; height:number};
type Props = {layout:{format:string; canvas:{width:number; height:number}; safe:Rect; overlay:string|null}};
const defaultLayout:Props['layout'] = {format:'16:9', canvas:{width:320, height:180}, safe:{x:16, y:9, width:288, height:162}, overlay:null};
const QUERY = 'clip';
const {color, radius, type, shadow} = tokens;

export const SearchField = ({typed, caret}:{typed:string; caret:boolean}) =>
  <div style={{position: 'absolute', left: 24, top: 24, width: 272, height: 44, boxSizing: 'border-box', backgroundColor: color.surface,
    border: `2px solid ${color.border}`, borderRadius: radius.field, boxShadow: shadow.field, display: 'flex', alignItems: 'center', paddingLeft: 14,
    color: color.text, fontFamily: 'KitFont', fontSize: type.field}}>
    <span>{typed}</span><span style={{width: 2, height: 22, marginLeft: 2, backgroundColor: caret ? color.text : 'transparent'}} />
  </div>;

export const ResultRow = ({selected}:{selected:number}) =>
  <div style={{position: 'absolute', left: 24, top: 88, width: 272, height: 32, borderRadius: radius.row, overflow: 'hidden', backgroundColor: color.surface}}>
    <div style={{position: 'absolute', left: 0, top: 0, bottom: 0, width: `${selected * 100}%`, backgroundColor: color.accent}} />
    <span style={{position: 'relative', left: 12, top: 7, color: color.text, fontFamily: 'KitFont', fontSize: type.row}}>Clipboard History</span>
  </div>;

const Kit = (_:Props) => {
  const frame = useCurrentFrame();
  const [handle] = useState(() => delayRender('kit font'));
  useEffect(() => {document.fonts.load(`${type.field}px KitFont`).then(() => continueRender(handle)).catch(error => cancelRender(error));}, [handle]);
  // Typing: one character every 2 frames from frame 1; selection: the highlight sweeps in over frames 8-11.
  const typed = QUERY.slice(0, Math.max(0, Math.min(QUERY.length, Math.floor((frame + 1) / 2))));
  const selected = interpolate(frame, [8, 11], [0, 1], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.out(Easing.cubic)});
  return <AbsoluteFill style={{backgroundColor: color.canvas}}>
    <style>{`@font-face {font-family: KitFont; src: url('${staticFile('IBMPlexSans.ttf')}');}`}</style>
    <SearchField typed={typed} caret={frame % 4 < 2} />
    <ResultRow selected={selected} />
  </AbsoluteFill>;
};
const Root = () => <Composition id="Kit" component={Kit} durationInFrames={12} fps={30} width={320} height={180} defaultProps={{layout: defaultLayout}}
  calculateMetadata={({props}) => ({width: props.layout.canvas.width, height: props.layout.canvas.height})} />;
registerRoot(Root);
