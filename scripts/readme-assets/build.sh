#!/bin/zsh
# Regenerates every image in docs/readme/ from the real app.
#
#   zsh scripts/readme-assets/build.sh
#
# Needs `npm install` in app/ and ffmpeg (brew install ffmpeg). Takes a few minutes:
# each locale records ~230 GIF frames and frames them one by one.
set -euo pipefail

ROOT=${0:A:h:h:h}
APP=$ROOT/app
OUT=$ROOT/docs/readme
HERE=${0:A:h}
WORK=$(mktemp -d -t clay-readme-assets)
E=$APP/node_modules/.bin/electron
trap 'rm -rf $WORK' EXIT

command -v ffmpeg >/dev/null || { echo "ffmpeg is required: brew install ffmpeg" >&2; exit 1; }
[[ -x $E ]] || { echo "Run npm install in app/ first" >&2; exit 1; }

cd $APP
mkdir -p $OUT
for pair in en:en-US zh:zh-CN; do
  l=${pair%%:*}; loc=${pair##*:}
  echo "→ $l: screenshots"
  $E $HERE/shoot.js $WORK/raw/$l $loc stills >/dev/null
  echo "→ $l: demo frames"
  $E $HERE/shoot.js $WORK/frames/$l $loc gif >/dev/null
  echo "→ $l: compose"
  $E $HERE/compose.js $WORK/raw/$l $WORK/art $l stills >/dev/null
  $E $HERE/compose.js $WORK/raw/$l $WORK/art $l gif $WORK/frames/$l $WORK/gif/$l >/dev/null
  ffmpeg -loglevel error -y -framerate 12 -i $WORK/gif/$l/f%04d.png -filter_complex \
    "[0]scale=1200:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=200:stats_mode=diff[p];[b][p]paletteuse=dither=sierra2_4a:diff_mode=rectangle" \
    $OUT/demo-$l.gif
done

for f in $WORK/art/*.png; do
  ffmpeg -loglevel error -y -i $f -vf "scale=2000:-1:flags=lanczos" $OUT/${f:t}
done
# The device mockup shows only page content, so one copy serves both READMEs.
mv $OUT/responsive-en.png $OUT/responsive.png
rm -f $OUT/responsive-zh.png

ls -la $OUT
