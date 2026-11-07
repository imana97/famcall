#!/usr/bin/env bash
set -euo pipefail
project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_dir"
mkdir -p store/assets/icons store/assets/google-play

# The transparent SVG is the single source for the mark. Derived SVGs are checked
# in so the website, designers and contributors can use them without build tools.
python3 - <<'PY'
from copy import deepcopy
from pathlib import Path
import xml.etree.ElementTree as ET

ET.register_namespace('', 'http://www.w3.org/2000/svg')
svg = '{http://www.w3.org/2000/svg}'
master = ET.parse('brand/famcall-glyph.svg').getroot()
icon = deepcopy(master)
icon.insert(0, ET.Element(svg + 'rect', {
    'width': '1024', 'height': '1024', 'fill': '#183D34',
}))
mono = deepcopy(master)
for element in mono.iter():
    for attribute in ('fill', 'stroke'):
        if attribute in element.attrib and element.attrib[attribute] != 'none':
            element.set(attribute, '#FFFFFF')
for path, artwork in [('brand/famcall-icon.svg', icon),
                      ('website/assets/icon.svg', icon),
                      ('website/assets/glyph.svg', master),
                      ('brand/famcall-monochrome.svg', mono)]:
    ET.indent(artwork, space='  ')
    Path(path).write_text(ET.tostring(artwork, encoding='unicode') + '\n')

# Keep the in-app mark on the same geometry as the launcher and store assets.
def jsx(element, depth=3):
    tag = element.tag.removeprefix(svg).capitalize()
    names = {'stroke-width': 'strokeWidth', 'stroke-linecap': 'strokeLinecap'}
    attributes = ' '.join(f'{names.get(key, key)}="{value}"' for key, value in element.attrib.items())
    indent = '  ' * depth
    if not list(element):
        return f'{indent}<{tag} {attributes} />'
    children = '\n'.join(jsx(child, depth + 1) for child in element)
    return f'{indent}<{tag} {attributes}>\n{children}\n{indent}</{tag}>'

mark = '\n'.join(jsx(element) for element in master)
component = '\n'.join([
    '// Generated from brand/famcall-glyph.svg by scripts/render-icons.sh.',
    'import Svg, { G, Path, Rect } from "react-native-svg";',
    '',
    'type BrandMarkProps = {',
    '  size?: number;',
    '  tile?: boolean;',
    '};',
    '',
    '/** Decorative brand mark; pair it with the accessible FamCall name. */',
    'export function BrandMark({ size = 48, tile = true }: BrandMarkProps) {',
    '  return (',
    '    <Svg width={size} height={size} viewBox="0 0 1024 1024" accessible={false}>',
    '      {tile ? <Rect width="1024" height="1024" rx="224" fill="#183D34" /> : null}',
    mark,
    '    </Svg>',
    '  );',
    '}',
    '',
])
Path('apps/mobile/src/components/BrandMark.tsx').write_text(component)
PY

rsvg-convert -w 1024 -h 1024 brand/famcall-icon.svg -o store/assets/icons/apple-icon-1024.png
# Apple raster icon: opaque, full square, sRGB. The OS applies its own mask.
magick store/assets/icons/apple-icon-1024.png -alpha off -strip PNG24:store/assets/icons/apple-icon-1024.png
cp store/assets/icons/apple-icon-1024.png apps/mobile/assets/icon.png

rsvg-convert -w 512 -h 512 brand/famcall-icon.svg -o store/assets/icons/google-play-icon-512.png
# Google Play requires 32-bit PNG, even with a fully opaque background.
magick store/assets/icons/google-play-icon-512.png -alpha on -strip PNG32:store/assets/icons/google-play-icon-512.png

# Foreground content stays inside Android's central 66/108 safe area.
rsvg-convert -w 1024 -h 1024 brand/famcall-glyph.svg -o apps/mobile/assets/android-icon-foreground.png
rsvg-convert -w 1024 -h 1024 brand/famcall-monochrome.svg -o apps/mobile/assets/android-icon-monochrome.png
magick -size 1024x1024 xc:'#183D34' -strip PNG24:apps/mobile/assets/android-icon-background.png

# Template icons need a transparent background and one opaque color. Their
# content uses 2/3 of each canvas (matching a 16dp glyph in a 24dp notification).
rsvg-convert -w 1024 -h 1024 brand/famcall-monochrome.svg | magick - -trim +repage -resize 64x64 -gravity center -background none -extent 96x96 -strip PNG32:apps/mobile/assets/notification-icon.png
rsvg-convert -w 1024 -h 1024 brand/famcall-monochrome.svg | magick - -trim +repage -resize 80x80 -gravity center -background none -extent 120x120 -strip PNG32:apps/mobile/assets/callkit-icon.png

rsvg-convert -w 1024 -h 1024 brand/famcall-glyph.svg -o apps/mobile/assets/splash-icon.png
rsvg-convert -w 48 -h 48 brand/famcall-icon.svg -o apps/mobile/assets/favicon.png
magick apps/mobile/assets/favicon.png -alpha off -strip PNG24:apps/mobile/assets/favicon.png
rsvg-convert -w 1024 -h 500 brand/feature-graphic.svg -o store/assets/google-play/feature-graphic-1024x500.png
magick store/assets/google-play/feature-graphic-1024x500.png -alpha off -strip PNG24:store/assets/google-play/feature-graphic-1024x500.png
