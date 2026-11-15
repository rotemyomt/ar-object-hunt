#!/usr/bin/env bash
# Regenerates PWA icons from client/public/icons/favicon.svg.
# Requires librsvg (rsvg-convert) and ImageMagick (convert):
#   macOS: brew install librsvg imagemagick   ·   Debian/Ubuntu: apt install librsvg2-bin imagemagick
set -euo pipefail
cd "$(dirname "$0")/../client/public/icons"
rsvg-convert -w 192 -h 192 favicon.svg -o icon-192.png
rsvg-convert -w 512 -h 512 favicon.svg -o icon-512.png
rsvg-convert -w 180 -h 180 -b "#04060c" favicon.svg -o apple-touch-icon.png
tmp="$(mktemp -t aoh-icon-XXXX).png"
rsvg-convert -w 358 -h 358 favicon.svg -o "$tmp"   # 70% of 512 → inside the maskable safe zone
convert -size 512x512 xc:"#04060c" "$tmp" -gravity center -composite icon-maskable-512.png
rm -f "$tmp"
echo "Icons regenerated."
