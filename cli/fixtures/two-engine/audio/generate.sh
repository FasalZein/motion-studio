#!/bin/sh
# Regenerates the deterministic audio fixtures. Values are known by construction:
# - track.wav: 44.1 kHz mono 220 Hz sine, amplitude 0.25, 0.6 s (the mix converts it to 48 kHz stereo and trims it to the film).
# - hit.wav: 48 kHz mono 0.15 s pulse whose single peak (0.6) is at exactly 0.05 s (sample 2400).
set -e
cd "$(dirname "$0")"
ffmpeg -hide_banner -loglevel error -y -f lavfi -i "aevalsrc=0.25*sin(2*PI*220*t):s=44100:d=0.6" -c:a pcm_s16le track.wav
ffmpeg -hide_banner -loglevel error -y -f lavfi -i "aevalsrc=0.6*exp(-abs(t-0.05)*3000):s=48000:d=0.15" -c:a pcm_s16le hit.wav
