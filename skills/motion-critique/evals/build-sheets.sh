#!/bin/sh
# Regenerates the eval contact sheets (sheets/) and the calibration sheets (../calibration/) with ffmpeg only (no text
# rendering). Calibration sheets are separate films from the eval sheets, so calibrating never shows an eval answer. Each sheet is a
# 12-second, 10 fps, 320x180 film sampled at 1 frame per second into one 5x5 page, the `sheet` layout.
# Shots are 3 seconds each: s01 0-29, s02 30-59, s03 60-89, s04 90-119 (global frames at 10 fps).
# Visual kinds (by construction):
#   default   : the same centered box on the same flat field every second (template look, no motion design)
#   slideshow : four unrelated flat slides, each held still for its whole 3-second shot
#   stack     : the varied film, but s02 stacks six flashing boxes and a full-frame strobe over its subject
#   varied    : asymmetric layouts that move each second; one accent color; clear focal subject per shot
#   bars      : a data story: four bars grow in s01-s02, one bar highlighted in s03 with a value callout that grows each
#               second (a living hold, D67), an end card in s04 whose accent line grows each second
#   moving    : the varied film plus a living layer: a 12x12 accent marker travels 20 px/s along the top edge
#   case-2 (calibration) : four flat slides, each held still 3 s; the s03 value bar runs off the right frame edge
#   case-1 (calibration) : a horizontal bar story: bars grow (s01), sort by value (s02), the top bar is highlighted with
#               a growing callout (s03), an end card whose accent line grows (s04); a teal month marker travels along
#               the top edge through the whole film, so no span freezes
# Liveness reports: with CLI set to a motion-studio command (for example CLI="node ../../../cli/dist/cli.js"), the
# script also renders each film named in LIVE below at full rate and writes its `liveness <video>` report: the
# slideshow-pace pair's reports in liveness/ and the calibration cases' reports in ../calibration/.
set -eu
cd "$(dirname "$0")"
FILMS=$(mktemp -d)
trap 'rm -rf "$FILMS"' EXIT
# graph <filtergraph> [marker-color]: the film's filter graph on the color source; a marker color adds the living layer.
graph() {
  if [ -n "${2:-}" ]; then
    printf "[0:v]%s[b];color=c=%s:s=12x12:r=10:d=12[m];[b][m]overlay=x='40+20*t':y=8:eval=frame" "$1" "$2"
  else printf "[0:v]%s" "$1"; fi
}
sheet() { # name.png filtergraph [marker-color]; also keeps the full-rate film as $FILMS/<name>.mkv
  ffmpeg -hide_banner -loglevel error -y -f lavfi -i "color=c=0x1d1f24:s=320x180:r=10:d=12" \
    -filter_complex "$(graph "$2" "${3:-}")" -c:v ffv1 "$FILMS/$(basename "$1" .png).mkv"
  ffmpeg -hide_banner -loglevel error -y -i "$FILMS/$(basename "$1" .png).mkv" \
    -vf "select='not(mod(n\,10))',tile=5x5:margin=4:padding=4" -fps_mode passthrough -frames:v 1 "$1"
}
B="drawbox"
sheet sheets/default.png   "$B=x=110:y=60:w=100:h=60:c=0x8a8fb0:t=fill"
sheet sheets/slideshow.png "$B=x=0:y=0:w=320:h=180:c=0x5a3d6b:t=fill:enable='between(t,3,6)',$B=x=0:y=0:w=320:h=180:c=0x2f6b4f:t=fill:enable='between(t,6,9)',$B=x=0:y=0:w=320:h=180:c=0x6b4f2f:t=fill:enable='gte(t,9)',$B=x=110:y=60:w=100:h=60:c=white:t=fill"
VARIED="$B=x=20:y=30:w=130:h=18:c=0xf2f2f2:t=fill:enable='between(t,0,0.99)',$B=x=20:y=58:w=30:h=6:c=0xff5a36:t=fill:enable='between(t,0,0.99)',$B=x=28:y=30:w=130:h=18:c=0xf2f2f2:t=fill:enable='between(t,1,1.99)',$B=x=28:y=58:w=45:h=6:c=0xff5a36:t=fill:enable='between(t,1,1.99)',$B=x=36:y=30:w=130:h=18:c=0xf2f2f2:t=fill:enable='between(t,2,2.99)',$B=x=36:y=58:w=60:h=6:c=0xff5a36:t=fill:enable='between(t,2,2.99)',$B=x=170:y=40:w=130:h=18:c=0xf2f2f2:t=fill:enable='between(t,3,3.99)',$B=x=170:y=68:w=30:h=6:c=0xff5a36:t=fill:enable='between(t,3,3.99)',$B=x=178:y=40:w=130:h=18:c=0xf2f2f2:t=fill:enable='between(t,4,4.99)',$B=x=178:y=68:w=45:h=6:c=0xff5a36:t=fill:enable='between(t,4,4.99)',$B=x=186:y=40:w=130:h=18:c=0xf2f2f2:t=fill:enable='between(t,5,5.99)',$B=x=186:y=68:w=60:h=6:c=0xff5a36:t=fill:enable='between(t,5,5.99)',$B=x=40:y=120:w=130:h=18:c=0xf2f2f2:t=fill:enable='between(t,6,6.99)',$B=x=40:y=148:w=30:h=6:c=0xff5a36:t=fill:enable='between(t,6,6.99)',$B=x=48:y=120:w=130:h=18:c=0xf2f2f2:t=fill:enable='between(t,7,7.99)',$B=x=48:y=148:w=45:h=6:c=0xff5a36:t=fill:enable='between(t,7,7.99)',$B=x=56:y=120:w=130:h=18:c=0xf2f2f2:t=fill:enable='between(t,8,8.99)',$B=x=56:y=148:w=60:h=6:c=0xff5a36:t=fill:enable='between(t,8,8.99)',$B=x=120:y=70:w=130:h=18:c=0xf2f2f2:t=fill:enable='between(t,9,9.99)',$B=x=120:y=98:w=30:h=6:c=0xff5a36:t=fill:enable='between(t,9,9.99)',$B=x=128:y=70:w=130:h=18:c=0xf2f2f2:t=fill:enable='between(t,10,10.99)',$B=x=128:y=98:w=45:h=6:c=0xff5a36:t=fill:enable='between(t,10,10.99)',$B=x=136:y=70:w=130:h=18:c=0xf2f2f2:t=fill:enable='between(t,11,11.99)',$B=x=136:y=98:w=60:h=6:c=0xff5a36:t=fill:enable='between(t,11,11.99)'"
sheet sheets/varied.png    "$VARIED"
sheet sheets/moving.png    "$VARIED" 0xff5a36
sheet sheets/stack.png     "$VARIED,$B=x=0:y=0:w=320:h=180:c=white@0.6:t=fill:enable='between(t,3,6)*lt(mod(t,1),0.5)',$B=x=30:y=20:w=80:h=80:c=0xff00ff:t=fill:enable='between(t,3,6)',$B=x=120:y=40:w=90:h=90:c=0x00ffff:t=fill:enable='between(t,3,6)',$B=x=200:y=10:w=100:h=60:c=0xffff00:t=fill:enable='between(t,3,6)',$B=x=60:y=110:w=200:h=50:c=0xff8800@0.7:t=fill:enable='between(t,3,6)'"
sheet sheets/bars.png      "$B=x=40:y=150:w=240:h=2:c=0x9aa0ad:t=fill:enable='lt(t,9)',$B=x=50:y=134:w=40:h=16:c=0x4a5060:t=fill:enable='between(t,0,0.99)',$B=x=110:y=137:w=40:h=13:c=0x4a5060:t=fill:enable='between(t,0,0.99)',$B=x=170:y=130:w=40:h=20:c=0x4a5060:t=fill:enable='between(t,0,0.99)',$B=x=230:y=140:w=40:h=10:c=0x4a5060:t=fill:enable='between(t,0,0.99)',$B=x=50:y=117:w=40:h=33:c=0x4a5060:t=fill:enable='between(t,1,1.99)',$B=x=110:y=124:w=40:h=26:c=0x4a5060:t=fill:enable='between(t,1,1.99)',$B=x=170:y=110:w=40:h=40:c=0x4a5060:t=fill:enable='between(t,1,1.99)',$B=x=230:y=130:w=40:h=20:c=0x4a5060:t=fill:enable='between(t,1,1.99)',$B=x=50:y=100:w=40:h=50:c=0x4a5060:t=fill:enable='between(t,2,2.99)',$B=x=110:y=110:w=40:h=40:c=0x4a5060:t=fill:enable='between(t,2,2.99)',$B=x=170:y=90:w=40:h=60:c=0x4a5060:t=fill:enable='between(t,2,2.99)',$B=x=230:y=120:w=40:h=30:c=0x4a5060:t=fill:enable='between(t,2,2.99)',$B=x=50:y=84:w=40:h=66:c=0x4a5060:t=fill:enable='between(t,3,3.99)',$B=x=110:y=97:w=40:h=53:c=0x4a5060:t=fill:enable='between(t,3,3.99)',$B=x=170:y=70:w=40:h=80:c=0x4a5060:t=fill:enable='between(t,3,3.99)',$B=x=230:y=110:w=40:h=40:c=0x4a5060:t=fill:enable='between(t,3,3.99)',$B=x=50:y=67:w=40:h=83:c=0x4a5060:t=fill:enable='between(t,4,4.99)',$B=x=110:y=84:w=40:h=66:c=0x4a5060:t=fill:enable='between(t,4,4.99)',$B=x=170:y=50:w=40:h=100:c=0x4a5060:t=fill:enable='between(t,4,4.99)',$B=x=230:y=100:w=40:h=50:c=0x4a5060:t=fill:enable='between(t,4,4.99)',$B=x=50:y=50:w=40:h=100:c=0x4a5060:t=fill:enable='between(t,5,5.99)',$B=x=110:y=70:w=40:h=80:c=0x4a5060:t=fill:enable='between(t,5,5.99)',$B=x=170:y=30:w=40:h=120:c=0x4a5060:t=fill:enable='between(t,5,5.99)',$B=x=230:y=90:w=40:h=60:c=0x4a5060:t=fill:enable='between(t,5,5.99)',$B=x=50:y=50:w=40:h=100:c=0x4a5060:t=fill:enable='between(t,6,6.99)',$B=x=110:y=70:w=40:h=80:c=0x4a5060:t=fill:enable='between(t,6,6.99)',$B=x=170:y=30:w=40:h=120:c=0xff5a36:t=fill:enable='between(t,6,6.99)',$B=x=230:y=90:w=40:h=60:c=0x4a5060:t=fill:enable='between(t,6,6.99)',$B=x=50:y=50:w=40:h=100:c=0x4a5060:t=fill:enable='between(t,7,7.99)',$B=x=110:y=70:w=40:h=80:c=0x4a5060:t=fill:enable='between(t,7,7.99)',$B=x=170:y=30:w=40:h=120:c=0xff5a36:t=fill:enable='between(t,7,7.99)',$B=x=230:y=90:w=40:h=60:c=0x4a5060:t=fill:enable='between(t,7,7.99)',$B=x=50:y=50:w=40:h=100:c=0x4a5060:t=fill:enable='between(t,8,8.99)',$B=x=110:y=70:w=40:h=80:c=0x4a5060:t=fill:enable='between(t,8,8.99)',$B=x=170:y=30:w=40:h=120:c=0xff5a36:t=fill:enable='between(t,8,8.99)',$B=x=230:y=90:w=40:h=60:c=0x4a5060:t=fill:enable='between(t,8,8.99)',$B=x=172:y=12:w=16:h=10:c=0xff5a36:t=fill:enable='between(t,6,6.99)',$B=x=162:y=12:w=36:h=10:c=0xff5a36:t=fill:enable='between(t,7,7.99)',$B=x=152:y=12:w=56:h=10:c=0xff5a36:t=fill:enable='between(t,8,8.99)',$B=x=30:y=70:w=200:h=16:c=0xf2f2f2:t=fill:enable='gte(t,9)',$B=x=30:y=94:w=60:h=6:c=0xff5a36:t=fill:enable='between(t,9,9.99)',$B=x=30:y=94:w=90:h=6:c=0xff5a36:t=fill:enable='between(t,10,10.99)',$B=x=30:y=94:w=120:h=6:c=0xff5a36:t=fill:enable='gte(t,11)'"
KB="$B=x=0:y=0:w=320:h=180:c=0x3b3b52:t=fill:enable='lt(t,3)',$B=x=0:y=0:w=320:h=180:c=0x52423b:t=fill:enable='between(t,3,5.99)',$B=x=0:y=0:w=320:h=180:c=0x2d4a52:t=fill:enable='between(t,6,8.99)',$B=x=0:y=0:w=320:h=180:c=0x3b3b52:t=fill:enable='gte(t,9)'"
sheet ../calibration/case-2.png "$KB,$B=x=110:y=60:w=100:h=60:c=0x9a9a9a:t=fill:enable='lt(t,6)',$B=x=180:y=80:w=200:h=20:c=white:t=fill:enable='between(t,6,8.99)',$B=x=140:y=80:w=40:h=20:c=0x9a9a9a:t=fill:enable='gte(t,9)'"
# hbar <second> <row y> <width> [color]: one horizontal bar from the zero baseline at x=60, shown for that second.
hbar() { printf "%s" "$B=x=60:y=$2:w=$3:h=18:c=${4:-0x4a5060}:t=fill:enable='between(t,$1,$1.99)',"; }
KG="$B=x=58:y=34:w=2:h=120:c=0x9aa0ad:t=fill:enable='lt(t,9)',"
KG="$KG$(hbar 0 40 30)$(hbar 0 70 20)$(hbar 0 100 40)$(hbar 0 130 25)"
KG="$KG$(hbar 1 40 80)$(hbar 1 70 55)$(hbar 1 100 100)$(hbar 1 130 60)"
KG="$KG$(hbar 2 40 130)$(hbar 2 70 90)$(hbar 2 100 170)$(hbar 2 130 100)"
KG="$KG$(hbar 3 40 150)$(hbar 3 70 100)$(hbar 3 100 200)$(hbar 3 130 110)"
KG="$KG$(hbar 4 40 150)$(hbar 4 100 100)$(hbar 4 70 200)$(hbar 4 130 110)"
KG="$KG$(hbar 5 70 150)$(hbar 5 130 100)$(hbar 5 40 200)$(hbar 5 100 110)"
for t in 6 7 8; do KG="$KG$(hbar $t 70 150)$(hbar $t 130 100)$(hbar $t 40 200 0x2f9e8f)$(hbar $t 100 110)"; done
KG="$KG$B=x=266:y=44:w=16:h=10:c=0x2f9e8f:t=fill:enable='between(t,6,6.99)',$B=x=266:y=44:w=32:h=10:c=0x2f9e8f:t=fill:enable='between(t,7,7.99)',$B=x=266:y=44:w=48:h=10:c=0x2f9e8f:t=fill:enable='between(t,8,8.99)',"
KG="$KG$B=x=30:y=70:w=220:h=16:c=0xf2f2f2:t=fill:enable='gte(t,9)',$B=x=30:y=94:w=60:h=6:c=0x2f9e8f:t=fill:enable='between(t,9,9.99)',$B=x=30:y=94:w=90:h=6:c=0x2f9e8f:t=fill:enable='between(t,10,10.99)',$B=x=30:y=94:w=120:h=6:c=0x2f9e8f:t=fill:enable='gte(t,11)'"
sheet ../calibration/case-1.png "$KG" 0x2f9e8f
if [ -n "${CLI:-}" ]; then
  mkdir -p liveness
  # liveness exits 1 when a limit fails; the report is still written.
  live() { (cd "$FILMS" && $CLI liveness "$1.mkv" --report "$2") || true; }
  live slideshow "$PWD/liveness/slideshow.json"
  live moving "$PWD/liveness/moving.json"
  live case-1 "$PWD/../calibration/case-1-liveness.json"
  live case-2 "$PWD/../calibration/case-2-liveness.json"
fi
