"""Reusable seeded electronic instruments, adapted from the Bayland synthesis reference.

No film times live here. Durations, notes, envelopes and gains come from the arranger.
"""
import numpy as np
from scipy import signal

RATE = 48000


def hz(midi):
    return 440 * 2 ** ((midi - 69) / 12)


def sine(frequency, n):
    return np.sin(2 * np.pi * np.cumsum(np.broadcast_to(frequency, n)) / RATE)


def saw(frequency, n, phase=0):
    # PolyBLEP corrects the discontinuity instead of aliasing a naive saw.
    dt = np.broadcast_to(np.asarray(frequency) / RATE, n)
    p = (phase + np.cumsum(dt)) % 1
    y = 2 * p - 1
    first, last = p < dt, p > 1 - dt
    x = p[first] / dt[first]
    y[first] -= 2 * x - x * x - 1
    x = (p[last] - 1) / dt[last]
    y[last] -= x * x + 2 * x + 1
    return y


def envelope(n, attack=.004, release=.05, tau=None):
    t = np.arange(n) / RATE
    e = np.ones(n) if tau is None else np.exp(-t / tau)
    a, r = min(n, round(attack * RATE)), min(n, round(release * RATE))
    if a:
        e[:a] *= np.linspace(0, 1, a)
    if r:
        e[-r:] *= np.linspace(1, 0, r) ** 1.5
    return e


def filter_audio(x, cutoff, kind='lowpass', order=2):
    return signal.sosfilt(signal.butter(order, cutoff, kind, fs=RATE, output='sos'), x, axis=-1)


def sweep(x, curve, band=False, block=128):
    """Block-updated filters preserve state across cutoff changes."""
    y = np.zeros_like(x)
    state = np.zeros(2) if band else np.zeros((1, 2))
    for start in range(0, len(x), block):
        cutoff = float(np.clip(curve[min(start, len(curve) - 1)], 40, RATE * .45))
        if band:
            b, a = signal.iirpeak(cutoff, .9, fs=RATE)
            y[start:start + block], state = signal.lfilter(b, a, x[start:start + block], zi=state)
        else:
            sos = signal.butter(2, cutoff, fs=RATE, output='sos')
            y[start:start + block], state = signal.sosfilt(sos, x[start:start + block], zi=state)
    return y


def pan(x, position=0):
    angle = (position + 1) * np.pi / 4
    return np.vstack([x * np.cos(angle), x * np.sin(angle)])


def pad(notes, seconds, rng, cutoff=(600, 2400), detune=.11):
    n = round(seconds * RATE)
    voices = np.zeros((2, n))
    for midi in notes:
        for cents in (-detune, -detune / 3, detune / 3, detune):
            voice = saw(hz(midi) * 2 ** (cents / 12), n, rng.random())
            voices += pan(voice, .65 * np.sign(cents))
    curve = np.linspace(*cutoff, n)
    voices = np.vstack([sweep(channel, curve) for channel in voices])
    return voices * envelope(n, .08, .35) / (len(notes) * 4)


def bass(midi, seconds, style='saw'):
    n = round(seconds * RATE)
    frequency = hz(midi)
    wave = saw(frequency, n) + .35 * sine(frequency / 2, n) if style == 'saw' else sine(frequency, n)
    return np.tanh(1.5 * filter_audio(wave, 650)) * envelope(n, .004, .08)


def pluck(midi, seconds=.22, bell=False):
    n = round(seconds * RATE)
    t = np.arange(n) / RATE
    frequency = hz(midi)
    if bell:
        wave = np.sin(2 * np.pi * frequency * t + sine(frequency * 3.5, n) * 2.2 * np.exp(-t / .12))
    else:
        wave = sweep(.6 * saw(frequency, n) + .4 * sine(frequency, n), 600 + 5200 * np.exp(-t / .04))
    return wave * envelope(n, .002, .03, .12 if bell else .07)


def kick(rng):
    n = round(.42 * RATE)
    t = np.arange(n) / RATE
    body = sine(44 + 120 * np.exp(-t / .035), n) * envelope(n, .001, .05, .19)
    click = filter_audio(rng.normal(size=round(.006 * RATE)), 3000, 'highpass')
    body[:len(click)] += .4 * click
    return np.tanh(1.4 * body)


def hat(rng, open_hat=False):
    n = round((.16 if open_hat else .045) * RATE)
    return filter_audio(rng.normal(size=n), 7500, 'highpass', 4) * envelope(n, .001, .01, .05 if open_hat else .012)


def clap(rng):
    n = round(.25 * RATE)
    noise = filter_audio(rng.normal(size=n), [900, 3200], 'bandpass')
    e = np.zeros(n)
    for i, delay in enumerate((0, .011, .022)):
        start = round(delay * RATE)
        e[start:] += envelope(n - start, .001, .02, .012 if i < 2 else .07)
    return noise * e


def sub_drop(seconds=1.4, start=95, end=36, tau=.45):
    n = round(seconds * RATE)
    t = np.arange(n) / RATE
    return np.tanh(1.6 * sine(end + (start - end) * np.exp(-t / .09), n)) * envelope(n, .001, .08, tau)


def crack(rng, seconds=.18):
    n = round(seconds * RATE)
    return filter_audio(rng.normal(size=n), 1800, 'highpass') * envelope(n, .001, .02, .035)


def whoosh(rng, seconds=.5):
    n = round(seconds * RATE)
    position = np.linspace(0, 1, n)
    curve = 250 * (4800 / 250) ** np.sin(np.pi * position) ** 1.5
    noise = sweep(rng.normal(size=n), curve, band=True)
    # Small onset crack makes the movement cue measurable without disguising its moving-noise body.
    noise *= np.sin(np.pi * position) ** 1.7
    noise[:round(.025 * RATE)] += .08 * crack(rng, .025)
    return pan(noise, np.linspace(.7, -.7, n))


def riser(rng, seconds):
    n = round(seconds * RATE)
    t = np.linspace(0, 1, n)
    noise = sweep(rng.normal(size=n), np.geomspace(400, 9000, n))
    noise *= t ** 1.3
    # Normalize the final 100 ms, then set the audible level in the arranger.
    rms = np.sqrt(np.mean(noise[-min(n, round(.1 * RATE)):] ** 2))
    return noise / max(rms, 1e-9)


def convolution_reverb(x, rng, seconds=1.8):
    n = round(seconds * RATE)
    decay = np.exp(-6.9 * np.arange(n) / RATE / seconds)
    ir = filter_audio(rng.normal(size=(2, n)) * decay, 5200)
    ir = np.pad(ir, ((0, 0), (round(.018 * RATE), 0)))
    ir /= np.sqrt(np.sum(ir ** 2, axis=1, keepdims=True))
    return np.vstack([signal.fftconvolve(x[c], ir[c])[:x.shape[1]] for c in range(2)])


def pingpong(x, seconds, feedback=.38, taps=6):
    wet = np.zeros_like(x)
    delay = round(seconds * RATE)
    for k in range(1, taps + 1):
        offset = delay * k
        if offset >= x.shape[1]:
            break
        wet[k % 2, offset:] += feedback ** k * (x[0, :-offset] + x[1, :-offset]) * .5
    return wet
