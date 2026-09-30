"""Cue-driven sections and palettes. All times derive from the storyboard grid."""
import re
import numpy as np
import instruments as synth


PALETTES = {
    'warm': {'third': 4, 'pad_register': -12, 'bass_style': 'saw', 'hat_division': 2, 'lead_division': 1, 'bell': True, 'cutoff': (600, 2400), 'pad_gain': .65, 'lead_gain': .10},
    'bright': {'third': 4, 'pad_register': 0, 'bass_style': 'saw', 'hat_division': 4, 'lead_division': 4, 'bell': False, 'cutoff': (1200, 5200), 'pad_gain': .38, 'lead_gain': .18},
    'dark': {'third': 3, 'pad_register': -12, 'bass_style': 'sub', 'hat_division': 1, 'lead_division': 0, 'bell': False, 'cutoff': (350, 1400), 'pad_gain': .75, 'lead_gain': 0},
}
DENSITIES = {'sparse': .5, 'normal': 1, 'busy': 2}


def place(bus, sound, sample, gain=1, pan=0):
    if sound.ndim == 1:
        sound = synth.pan(sound, pan)
    start, offset = max(0, sample), max(0, -sample)
    length = min(sound.shape[1] - offset, bus.shape[1] - start)
    if length > 0:
        bus[:, start:start + length] += gain * sound[:, offset:offset + length]


def cue_kind(shot, cue, reveal, logo):
    if cue['eventFrame'] == logo:
        return 'logo'
    if cue['eventFrame'] == reveal:
        return 'reveal'
    # Existing asset ids, description and seam/camera vocabulary carry semantics; no second cue format.
    words = set(re.findall(r'[a-z]+', cue['asset'].lower()))
    context = set(re.findall(r'[a-z]+', shot.get('description', '').lower()))
    if words & {'type', 'typing', 'keypress'} or re.search(r'(?:^|[^a-z])key[-_ ]press(?:$|[^a-z])', cue['asset'].lower()):
        return 'type'
    if words & {'ui', 'click', 'cursor'}:
        return 'click'
    if words & {'arrival', 'arrive', 'lock', 'land', 'impact', 'bass', 'hit', 'boom', 'pop'}:
        return 'arrival'
    if words & {'motion', 'whip', 'whoosh', 'camera', 'zoom', 'orbit', 'sweep'}:
        return 'motion'
    seam = cue['eventFrame'] == shot['startFrame']
    terms = [move['term'] for move in shot.get('moves', []) if move['start'] <= cue['eventFrame'] - shot['startFrame'] < move['start'] + move['frames']]
    movement = set(re.findall(r'[a-z]+', (' '.join(terms) + ' ' + shot.get('transition', '') + ' ' + shot.get('camera', '')).lower()))
    if (seam or terms) and movement & {'whip', 'swipe', 'push', 'pull', 'zoom', 'orbit'}:
        return 'motion'
    if context & {'ui', 'interface', 'typing', 'cursor'}:
        return 'type' if context & {'typing'} else 'click'
    return 'arrival'


def cadence(frame, logo, step, tonic, third):
    # Count backward from the actual logo, so the last full bar is always a major dominant.
    bar = max(0, (logo - frame - 1) // (4 * step))
    root = ((7, 8, 5, 0) if third == 3 else (7, 9, 5, 0))[bar % 4]
    quality = 4 if root in (7, 8) else (3 if root == 9 else third)
    return tonic + root, quality


def arrange(board, args, step, beats, rng):
    fps, frames = board['meta']['fps'], board['meta']['durationFrames']
    length = frames * synth.RATE // fps
    buses = {name: np.zeros((2, length)) for name in ('drums', 'bass', 'harmony', 'texture')}
    palette = PALETTES[args.palette]
    density = DENSITIES[args.density]
    reveal, logo, tonic = args.reveal_frame, args.logo_frame, args.tonic_midi
    gap_start = max(0, reveal - args.dropout_beats * step)
    beat_seconds = step / fps
    kick_samples = []
    rhythm = {'kicks': 0, 'hats': 0, 'claps': 0, 'bassNotes': 0, 'leadNotes': 0}
    chord_plan = []
    # Chord boundaries follow the logo-aligned bars, not a fixed reference film's cue times.
    boundaries = sorted({beats[0], reveal, max(beats[0], logo - 4 * step), *[f for f in beats if f < logo and (logo - f) % (4 * step) == 0], logo})
    lead = np.zeros((2, length))
    for start, end in zip(boundaries, boundaries[1:]):
        if start >= logo:
            continue
        root, third = cadence(start, logo, step, tonic, palette['third'])
        ninth = 13 if palette['third'] == 3 and root == tonic + 7 else 14
        notes = [root + palette['pad_register'] + offset for offset in (0, third, 7, ninth)]
        chord_plan.append({'startFrame': start, 'endFrame': end, 'rootMidi': root, 'notes': notes, 'function': 'V' if start >= logo - 4 * step else 'progression'})
        seconds = (end - start) / fps + .3
        gain = palette['pad_gain'] * (.7 if start < reveal else 1)
        place(buses['harmony'], synth.pad(notes, seconds, rng, palette['cutoff']), start * synth.RATE // fps, gain)
    for i, frame in enumerate(beats):
        if frame >= logo or gap_start <= frame < reveal:
            continue
        sample = frame * synth.RATE // fps
        root, third = cadence(frame, logo, step, tonic, palette['third'])
        energy = .42 if frame < reveal else 1
        # A calmer opening and reduced closing groove give the reveal and cadence their own sections.
        kick_stride = 2 if frame < reveal or args.palette == 'dark' else 1
        if args.density == 'sparse':
            kick_stride *= 2
        if i % kick_stride == 0:
            place(buses['drums'], synth.kick(rng), sample, .48 * energy)
            kick_samples.append(sample)
            rhythm['kicks'] += 1
        if frame >= reveal and i % (4 if args.palette == 'dark' else 2) == 1:
            rhythm['claps'] += 1
            place(buses['drums'], synth.clap(rng), sample, .15 * energy)
        divisions = max(1, round(palette['hat_division'] * density))
        for sub in range(divisions):
            # Intro uses only offbeat closed hats. Bright adds sixteenths/open-hat accents.
            if frame < reveal and sub != divisions - 1:
                continue
            rhythm['hats'] += 1
            place(buses['drums'], synth.hat(rng, args.palette == 'bright' and sub == divisions - 1), sample + round(sub * beat_seconds * synth.RATE / divisions), .065 * energy, .25 if sub % 2 else -.2)
        bass_divisions = 2 if args.palette == 'bright' and density >= 1 and frame >= reveal else 1
        for sub in range(bass_divisions):
            rhythm['bassNotes'] += 1
            place(buses['bass'], synth.bass(root - 24, beat_seconds / bass_divisions * .88, palette['bass_style']), sample + round(sub * beat_seconds * synth.RATE / bass_divisions), .32 * energy)
        divisions = round(palette['lead_division'] * density)
        for sub in range(divisions):
            if frame < reveal and (i % 2 or sub > 0):
                continue
            ninth = 13 if palette['third'] == 3 and root == tonic + 7 else 14
            offset = (0, third, 7, ninth)[(i * max(1, divisions) + sub) % 4]
            register = 12 if args.palette == 'bright' else 0
            rhythm['leadNotes'] += 1
            place(lead, synth.pluck(root + register + offset, bell=palette['bell']), sample + round(sub * beat_seconds * synth.RATE / divisions), palette['lead_gain'] * energy, .4 if sub % 2 else -.4)
    sidechain = np.ones(length)
    for sample in kick_samples:
        n = min(round(.3 * synth.RATE), length - sample)
        sidechain[sample:sample + n] = np.minimum(sidechain[sample:sample + n], 1 - .45 * np.exp(-np.arange(n) / synth.RATE / .09))
    buses['bass'] *= sidechain
    buses['harmony'] *= sidechain
    buses['texture'] = lead * (.6 + .4 * sidechain)
    buses['texture'] += .32 * synth.pingpong(lead, beat_seconds * .75)
    buses['harmony'] += .24 * synth.convolution_reverb(buses['harmony'] + lead * .25, rng)
    # Fade ringing voices into the musical dropout; anticipation is a separate bus below.
    a, b = gap_start * synth.RATE // fps, reveal * synth.RATE // fps
    fade = min(a, round(.01 * synth.RATE))
    for bus in buses.values():
        bus[:, a - fade:a] *= np.linspace(1, 0, fade)
        bus[:, a:b] = 0
        tail = logo * synth.RATE // fps
        bus[:, tail:] *= np.linspace(1, 0, length - tail)
        bus[:, -round(.02 * synth.RATE):] *= np.linspace(1, 0, round(.02 * synth.RATE))
    anticipation = np.zeros((2, length))
    rise_frames = min(args.riser_beats * step, reveal)
    rise = synth.riser(rng, rise_frames / fps)
    # Final riser RMS is 0.12, not a squared 0.01 peak multiplier.
    place(anticipation, rise, (reveal - rise_frames) * synth.RATE // fps, .17)
    buses['anticipation'] = anticipation
    end = reveal * synth.RATE // fps
    last_riser = anticipation[:, max(0, end - round(.1 * synth.RATE)):end]
    reference = sum(bus[:, end:min(length, end + synth.RATE // 2)] for name, bus in buses.items() if name != 'anticipation')
    riser_db = 20 * np.log10(max(np.sqrt(np.mean(last_riser ** 2)), 1e-12))
    bed_db = 20 * np.log10(max(np.sqrt(np.mean(reference ** 2)), 1e-12))
    gap_peak = max(float(np.max(np.abs(bus[:, a:b]))) for name, bus in buses.items() if name != 'anticipation')
    return buses, {'rhythm': rhythm, 'palette': args.palette, 'density': args.density, 'chords': chord_plan,
                   'cadence': {'dominantStartFrame': max(beats[0], logo - 4 * step), 'dominantRootMidi': tonic + 7, 'tonicFrame': logo, 'tonicMidi': tonic},
                   'dropout': {'startFrame': gap_start, 'endFrame': reveal, 'musicalPeak': gap_peak},
                   'riser': {'startFrame': reveal - rise_frames, 'endFrame': reveal, 'finalRmsDbfs': float(riser_db), 'postRevealBedRmsDbfs': float(bed_db), 'relativeDb': float(riser_db - bed_db)}}


def hit(kind, tonic, palette, rng):
    if kind == 'logo':
        chord = synth.pad([tonic - 12, tonic, tonic + palette['third'], tonic + 7, tonic + 14], 2.4, rng, (2800, 700)) * .65
        low = synth.bass(tonic - 24, 2, palette['bass_style']) * .4
        place(chord, low, 0)
        place(chord, synth.pluck(tonic + 12, .8, bell=True), 0, .22)
        return chord
    if kind == 'reveal':
        body = synth.sub_drop() * .65
        place_body = np.zeros((2, len(body)))
        place(place_body, body, 0)
        place(place_body, synth.crack(rng), 0, .22)
        return place_body
    if kind == 'motion':
        return synth.whoosh(rng) * .28
    if kind == 'arrival':
        body = synth.sub_drop(.45, 80, 48, .12) * .3
        body[:round(.09 * synth.RATE)] += synth.pluck(tonic + 7, .09, bell=True) * .12
        return body
    if kind == 'type':
        sound = np.zeros(round(.09 * synth.RATE))
        for delay, note in ((0, tonic + 12), (.03, tonic + 12 + palette['third']), (.06, tonic + 19)):
            short = synth.pluck(note, .03, bell=True) * .2
            start = round(delay * synth.RATE)
            sound[start:start + len(short)] += short
        return sound
    return synth.pluck(tonic + 12, .09, bell=True) * .25
