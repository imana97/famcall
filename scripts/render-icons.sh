#!/usr/bin/env bash
set -euo pipefail
project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_dir"
mkdir -p store/assets/icons
rsvg-convert -w 1024 -h 1024 brand/famcall-icon.svg -o store/assets/icons/apple-icon-1024.png
magick store/assets/icons/apple-icon-1024.png -alpha off PNG24:store/assets/icons/apple-icon-1024.png
rsvg-convert -w 512 -h 512 brand/famcall-icon.svg -o store/assets/icons/google-play-icon-512.png
# Play requires an alpha channel even when the approved artwork is fully opaque.
magick store/assets/icons/google-play-icon-512.png -alpha on PNG32:store/assets/icons/google-play-icon-512.png
cp store/assets/icons/apple-icon-1024.png apps/mobile/assets/icon.png
rsvg-convert -w 1024 -h 1024 brand/famcall-glyph.svg -o apps/mobile/assets/android-icon-foreground.png
rsvg-convert -w 1024 -h 1024 brand/famcall-monochrome.svg -o apps/mobile/assets/android-icon-monochrome.png
rsvg-convert -w 96 -h 96 brand/famcall-monochrome.svg -o apps/mobile/assets/notification-icon.png
rsvg-convert -w 120 -h 120 brand/famcall-monochrome.svg -o apps/mobile/assets/callkit-icon.png
