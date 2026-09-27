"""Render original PokeNav tile data as a seamless, code-native SVG (requires Pillow)."""
from pathlib import Path
from collections import defaultdict
from PIL import Image

root = Path(__file__).resolve().parents[1]
assets = root / 'apps/web/public/maps'
tileset = Image.open(assets / 'hoenn-map.png').convert('RGB')
tilemap = (assets / 'hoenn-map.bin').read_bytes()
paths = defaultdict(list)
for y in range(160):
    row = []
    for x in range(240):
        tile = tilemap[(y // 8) * 64 + x // 8]
        row.append(tileset.getpixel(((tile % (tileset.width // 8)) * 8 + x % 8,
                                     (tile // (tileset.width // 8)) * 8 + y % 8)))
    x = 0
    while x < 240:
        end = x + 1
        while end < 240 and row[end] == row[x]:
            end += 1
        paths[row[x]].append(f'M{x} {y}h{end-x}v1h{x-end}z')
        x = end
svg = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 160" shape-rendering="crispEdges">']
for color, pieces in paths.items():
    svg.append(f'<path fill="#{color[0]:02x}{color[1]:02x}{color[2]:02x}" d="{"".join(pieces)}"/>')
svg.append('</svg>')
(assets / 'hoenn-emerald.svg').write_text(''.join(svg), encoding='utf-8')
