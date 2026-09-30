#!/usr/bin/env python3
"""Seeded, storyboard-driven synthesis. Audio rights are separate from tool licenses."""
import argparse
import hashlib
import json
from importlib.metadata import version
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

import librosa
import numpy as np
from scipy import signal
from pedalboard import Pedalboard, HighpassFilter, LowpassFilter, Compressor, Limiter
sys.dont_write_bytecode = True
from arranger import PALETTES, arrange, cue_kind, hit as synth_hit, place

RATE = 48000
LICENSE = 'https://pixabay.com/service/license-summary/'


def command(args):
    return subprocess.run(args, check=True, capture_output=True, timeout=120)


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def write_json(path, value):
    Path(path).write_text(json.dumps(value, indent=2, allow_nan=False) + '\n')


def wav(path, audio):
    # ffmpeg writes deterministic 24-bit PCM. Fix the encoder metadata across runs.
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'f32le', '-ar', str(RATE), '-ac', '2',
                    '-i', '-', '-c:a', 'pcm_s24le', '-fflags', '+bitexact', '-flags:a', '+bitexact', str(path)],
                   input=np.asarray(audio.T, dtype='<f4').tobytes(), check=True, capture_output=True, timeout=120)


def decode(path):
    raw = command(['ffmpeg', '-v', 'error', '-i', str(path), '-f', 'f32le', '-ac', '2', '-ar', str(RATE), '-']).stdout
    return np.frombuffer(raw, dtype='<f4').reshape(-1, 2).T.copy()


def meter(path):
    import re
    text = command(['ffmpeg', '-hide_banner', '-nostats', '-i', str(path), '-af', 'ebur128=peak=true', '-f', 'null', '-']).stderr.decode()
    loud = re.search(r'Integrated loudness:\s*I:\s*(-?[\d.]+) LUFS', text)
    peak = re.search(r'True peak:\s*Peak:\s*(-?[\d.]+) dBFS', text)
    if not loud or not peak:
        raise ValueError('ffmpeg did not measure loudness and true peak')
    return {'integratedLufs': float(loud[1]), 'truePeakDbtp': float(peak[1])}


def finish(audio, path):
    # Pedalboard shapes transients. ffmpeg loudnorm supplies the oversampled true-peak ceiling.
    processed = Pedalboard([Limiter(threshold_db=-3, release_ms=50)])(np.asarray(audio, dtype=np.float32), RATE)
    with tempfile.TemporaryDirectory(prefix='.master-', dir=path.parent) as tmp:
        raw = Path(tmp) / 'premix.wav'
        wav(raw, processed)
        target = -14
        for _ in range(3):
            command(['ffmpeg', '-v', 'error', '-y', '-i', str(raw), '-af',
                     f'loudnorm=I={target}:TP=-1.3:LRA=11', '-ar', str(RATE), '-c:a', 'pcm_s24le',
                     '-fflags', '+bitexact', '-flags:a', '+bitexact', str(path)])
            level = meter(path)
            if abs(level['integratedLufs'] + 14) <= .5 and level['truePeakDbtp'] <= -1:
                return level
            target += -14 - level['integratedLufs']
        raise ValueError(f'cannot reach -14 +/- 0.5 LUFS / -1 dBTP: {level}')


def derive(board, reveal, logo):
    fps, frames = board['meta']['fps'], board['meta']['durationFrames']
    if fps not in (24, 25, 30, 60) or not isinstance(frames, int) or frames <= fps:
        raise ValueError('need supported fps and duration longer than one second')
    shots = board['shots']
    if not shots or shots[-1]['endFrame'] != frames:
        raise ValueError('duration must equal the last shot endFrame')
    cues = [(shot['id'], cue) for shot in shots for cue in shot['soundCues']]
    if not cues or any(not shot['startFrame'] <= cue['eventFrame'] < shot['endFrame'] for shot in shots for cue in shot['soundCues']):
        raise ValueError('sound cues must be inside their shots')
    events = [cue['eventFrame'] for _, cue in cues]
    if reveal not in events or logo not in events or not 0 < reveal < logo < frames:
        raise ValueError('reveal and logo must select existing sound cues in that order')
    if events.count(logo) != 1:
        raise ValueError('logo needs exactly one cue')
    supplied = board['audio']['beatFrames']
    if not supplied:
        raise ValueError('audio.beatFrames is empty; set a planned whole-frame grid before G2: see motion-studio/agents/board.md step 1 and run motion-studio beats <film-dir> --imported <file>')
    step = supplied[1] - supplied[0] if len(supplied) > 1 else 0
    if step <= 0 or any(b - a != step for a, b in zip(supplied, supplied[1:])):
        raise ValueError('score needs a constant, whole-frame beat grid; correct the board first')
    bpm = 60 * fps / step
    if board['audio']['bpm'] is None or abs(board['audio']['bpm'] - bpm) > .1:
        raise ValueError('audio.bpm does not match beatFrames')
    beats = supplied
    if any(f not in beats for f in events):
        raise ValueError('sound cues are off the beat grid; snap the board or choose another tempo before scoring')
    return fps, frames, cues, step, bpm, beats


def render(board, args, directory):
    fps, frames, cues, step, bpm, beats = derive(board, args.reveal_frame, args.logo_frame)
    length = frames * RATE // fps
    rng = np.random.default_rng(args.seed)
    buses, arrangement = arrange(board, args, step, beats, rng)
    for name, bus in buses.items():
        # Dry shaping is already instrument-specific; keep one overall low/high boundary.
        bus[:] = Pedalboard([HighpassFilter(cutoff_frequency_hz=25), LowpassFilter(cutoff_frequency_hz=args.eq_hz)])(np.asarray(bus, dtype=np.float32), RATE)
        # Filter state must not ring into the planned musical silence.
        if name != 'anticipation':
            a = arrangement['dropout']['startFrame'] * RATE // fps
            b = arrangement['dropout']['endFrame'] * RATE // fps
            bus[:, a:b] = 0
        wav(directory / f'{name}.wav', bus)
    music = sum(buses.values())
    wav(directory / 'music.wav', music)
    total = music.copy()
    hits, files = [], []
    stock_root = Path.home() / '.agents/skills/media-use/audio/assets/sfx'
    for i, (shot, cue) in enumerate(cues):
        frame = cue['eventFrame']
        hit = np.zeros_like(music)
        shot_data = next(s for s in board['shots'] if s['id'] == shot)
        kind = cue_kind(shot_data, cue, args.reveal_frame, args.logo_frame)
        sound = synth_hit(kind, args.tonic_midi, PALETTES[args.palette], rng)
        stock = []
        if args.sfx_density and kind != 'logo' and i % args.sfx_density == 0:
            # Only impacts and UI clicks use bundled material. Movement and logo have their own original voices.
            stock = ['impact-bass-1'] if kind == 'reveal' else ['click-soft'] if kind in ('click', 'type') else []
        place(hit, sound, frame * RATE // fps)
        for name in stock:
            source = stock_root / (name + '.mp3')
            if not source.is_file():
                raise ValueError(f'missing Pixabay bundle file: {source}; install media-use or use --sfx-density 0 explicitly')
            sample = decode(source)
            # Trim silence, pitch stock clicks to avoid an out-of-key sustained tone, and layer original material.
            active = np.flatnonzero(np.max(np.abs(sample), axis=0) > .002)
            if not len(active):
                raise ValueError(f'silent SFX: {source}')
            sample = sample[:, active[0]:active[0] + round((.4 if frame == args.reveal_frame else .06) * RATE)]
            sample *= np.linspace(1, 0, sample.shape[1])
            place(hit, sample, frame * RATE // fps, .12)
            stock[stock.index(name)] = {'source': str(source), 'sha256': digest(source), 'license': 'Pixabay Content License', 'url': LICENSE}
        hit = Pedalboard([HighpassFilter(cutoff_frequency_hz=25), Compressor(threshold_db=-12, ratio=2)])(np.asarray(hit, dtype=np.float32), RATE)
        filename = f'hit-{i:02d}-{kind}.wav'
        wav(directory / filename, hit)
        delivered = decode(directory / filename)
        mono = np.mean(delivered, axis=0)
        # librosa runs on each stem. RMS finds the first audible frame; onset_detect adds attack evidence.
        rms = librosa.feature.rms(y=mono, frame_length=256, hop_length=128, center=False)[0]
        audible = np.flatnonzero(rms > .001)
        detected = librosa.onset.onset_detect(y=mono, sr=RATE, hop_length=128, units='samples', backtrack=True)
        onset = float(audible[0] * 128 * fps / RATE) if len(audible) else None
        onset_candidates = [float(sample * fps / RATE) for sample in detected]
        nearest = min(onset_candidates, key=lambda value: abs(value - frame)) if onset_candidates else None
        peak_frame = np.argmax(np.max(np.abs(delivered), axis=0)) * fps / RATE
        hits.append({'file': filename, 'kind': kind, 'shot': shot, 'eventFrame': frame, 'onsetFrame': onset,
                     'librosaOnsetFrame': nearest, 'errorFrames': None if onset is None else onset - frame,
                     'peakOffsetFrames': round(peak_frame - frame), 'sources': stock})
        files.append({'file': filename, 'sourceKind': 'code', 'license': 'synthesized original' if not stock else 'synthesized original + Pixabay Content License', 'sources': stock})
        total += hit
    level = finish(total, directory / 'score.wav')
    for name in (*buses.keys(), 'music', 'score'):
        files.append({'file': name + '.wav', 'sourceKind': 'code', 'license': 'synthesized original', 'sources': []})
    # The preview includes the same stock composites as the individual hit stems.
    files[-1]['sources'] = [source for hit in hits for source in hit['sources']]
    if files[-1]['sources']:
        files[-1]['license'] = 'synthesized original + Pixabay Content License'
    for record in files:
        record['sha256'] = digest(directory / record['file'])
    timing_ok = all(hit['onsetFrame'] is not None and abs(hit['errorFrames']) <= 1 and hit['librosaOnsetFrame'] is not None and abs(hit['librosaOnsetFrame'] - hit['eventFrame']) <= 1 for hit in hits)
    return {'version': 1, 'seed': args.seed, 'fps': fps, 'durationFrames': frames, 'bpm': bpm, 'beatFrames': beats,
            'downbeatFrames': board['audio']['downbeatFrames'] or beats[::4], 'dropFrames': board['audio']['dropFrames'] or [args.reveal_frame],
            'hits': hits, 'files': files, 'arrangement': arrangement, 'loudness': level, 'timingPassed': timing_ok,
            'audibleJudgment': 'unverified: human listening required',
            'diagnostics': {'preLimiterPeak': float(np.max(np.abs(total))), 'lrCorrelation': float(np.corrcoef(total)[0, 1]),
                            'bandEnergy': {str(hz): float(np.mean(signal.sosfilt(signal.butter(2, [hz, min(hz * 4, 20000)], 'bandpass', fs=RATE, output='sos'), total) ** 2)) for hz in (40, 250, 1000, 4000)}},
            'parameters': {key: value for key, value in vars(args).items() if key not in ('film', 'out')}}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('film', type=Path)
    parser.add_argument('--out', type=Path, required=True, help='new output directory; existing outputs are refused')
    parser.add_argument('--seed', type=int, required=True)
    parser.add_argument('--reveal-frame', type=int, required=True)
    parser.add_argument('--logo-frame', type=int, required=True)
    parser.add_argument('--tonic-midi', type=int, default=62)
    parser.add_argument('--palette', choices=('warm', 'bright', 'dark'), default='warm')
    parser.add_argument('--density', choices=('sparse', 'normal', 'busy'), default='normal')
    parser.add_argument('--eq-hz', type=float, default=10000)
    parser.add_argument('--dropout-beats', type=int, choices=range(1, 5), default=2)
    parser.add_argument('--riser-beats', type=int, choices=range(1, 5), default=2)
    parser.add_argument('--sfx-density', type=int, choices=range(0, 5), default=1, help='0 = synthesized only; N = stock layer every Nth non-logo cue')
    args = parser.parse_args()
    if args.out.exists():
        raise ValueError('output already exists; use a new revision directory')
    if not 24 <= args.tonic_midi <= 96 or not 1000 <= args.eq_hz <= 20000:
        raise ValueError('tonic MIDI must be 24..96; EQ cutoff must be 1000..20000 Hz')
    board_path = args.film / 'storyboard.json'
    beatmap = args.film / 'beatmap.md'
    if not beatmap.read_text().strip():
        raise ValueError('read and complete the beat contract before scoring')
    board = json.loads(board_path.read_text())
    derive(board, args.reveal_frame, args.logo_frame)
    args.out.mkdir(parents=True)
    report = render(board, args, args.out)
    # Verify the real output with another full render, not just RNG repeatability.
    with tempfile.TemporaryDirectory(prefix='.repeat-', dir=args.out) as tmp:
        second = render(board, args, Path(tmp))
        report['determinismPassed'] = all(a['sha256'] == b['sha256'] for a, b in zip(report['files'], second['files']))
    report['inputHashes'] = {'storyboard.json': digest(board_path), 'beatmap.md': digest(beatmap)}
    report['environment'] = {'python': sys.version.split()[0],
                             **{name: version(name) for name in ('numpy', 'scipy', 'pedalboard', 'librosa')},
                             'ffmpeg': command(['ffmpeg', '-version']).stdout.decode().splitlines()[0]}
    report['scriptSha256'] = digest(__file__)
    report['passed'] = report['timingPassed'] and report['determinismPassed']
    for source in ('score.py', 'instruments.py', 'arranger.py', 'requirements.txt'):
        shutil.copyfile(Path(__file__).parent / source, args.out / source)
    report['libraryHashes'] = {name: digest(args.out / name) for name in ('instruments.py', 'arranger.py', 'requirements.txt')}
    write_json(args.out / 'license.json', report['files'])
    write_json(args.out / 'audio-report.json', report)
    print(json.dumps({'passed': report['passed'], 'out': str(args.out), 'loudness': report['loudness']}))
    if not report['passed']:
        raise ValueError('audio checks failed; inspect audio-report.json before import')


if __name__ == '__main__':
    try:
        main()
    except (ValueError, KeyError, OSError, subprocess.SubprocessError) as error:
        print(f'error: {error}', file=sys.stderr)
        sys.exit(1)
