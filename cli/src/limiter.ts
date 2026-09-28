/**
 * True-peak limiter for the master mix (D53). It works on the whole interleaved bus at once, so it can look ahead
 * without latency: every sample frame whose true peak exceeds the ceiling gets exactly the gain that brings it to the
 * ceiling, and the gain ramps linearly down to that value over ATTACK before it and back up over RELEASE after it.
 * Both channels share one gain, so the stereo image does not shift.
 */

// Estimated true peak: the sample and three points between it and the next sample (4x oversampling, as in
// ITU-R BS.1770 true-peak metering), interpolated with a Hann-windowed sinc of TAPS samples on each side.
const OVERSAMPLE = 4;
const TAPS = 8;
const phases = Array.from({length:OVERSAMPLE-1},(_,p) => {
  const at = (p+1)/OVERSAMPLE;
  const taps = Array.from({length:2*TAPS},(_,k) => {
    const x = k-TAPS+1-at; // distance from the interpolated point to sample n+k-TAPS+1
    const sinc = x === 0 ? 1 : Math.sin(Math.PI*x)/(Math.PI*x);
    return sinc*(0.5+0.5*Math.cos(Math.PI*x/TAPS));
  });
  const sum = taps.reduce((a,b) => a+b,0);
  return taps.map(t => t/sum);
});

/** Per sample frame: the largest absolute value of any channel at the sample or between it and the next one. */
function truePeaks(bus:Float32Array, channels:number):Float32Array {
  const frames = bus.length/channels;
  const peaks = new Float32Array(frames);
  const at = (i:number, c:number) => i < 0 || i >= frames ? 0 : bus[i*channels+c];
  for (let n=0;n<frames;n++) {
    let top = 0;
    for (let c=0;c<channels;c++) {
      top = Math.max(top,Math.abs(bus[n*channels+c]));
      for (const taps of phases) {
        let v = 0;
        for (let k=0;k<taps.length;k++) v += taps[k]*at(n+k-TAPS+1,c);
        top = Math.max(top,Math.abs(v));
      }
    }
    peaks[n] = top;
  }
  return peaks;
}

/**
 * Limits the bus in place so no estimated true peak exceeds `ceiling` (linear). Returns the largest gain reduction in
 * dB (0 when nothing was over the ceiling). `attack` and `release` are ramp lengths in sample frames.
 */
export function limitTruePeaks(bus:Float32Array, channels:number, ceiling:number, attack:number, release:number):number {
  const peaks = truePeaks(bus,channels);
  const frames = peaks.length;
  const gain = new Float32Array(frames).fill(1);
  let lowest = 1;
  for (let m=0;m<frames;m++) {
    if (peaks[m] <= ceiling) continue;
    const need = ceiling/peaks[m];
    lowest = Math.min(lowest,need);
    for (let d=0;d<=attack && m-d>=0;d++) gain[m-d] = Math.min(gain[m-d],need+(1-need)*d/attack);
    for (let d=1;d<=release && m+d<frames;d++) gain[m+d] = Math.min(gain[m+d],need+(1-need)*d/release);
  }
  if (lowest === 1) return 0;
  for (let i=0;i<bus.length;i++) bus[i] *= gain[Math.floor(i/channels)];
  return -20*Math.log10(lowest);
}
