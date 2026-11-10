#!/usr/bin/env python3
"""Build the hand-tuned GG family sources. Requires fonttools + brotli.
Run from any folder: python design/brand/build-sources.py
Then: node design/brand/render-assets.cjs
"""
from pathlib import Path
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
# Verbatim Meet geometry: apps/desktop/app/icon.svg and packages/ui-tokens.
LOOPS = ['M21 15c0-12-17-12-17 0s17 12 17 0v18c0 12-17 12-17 3 0-10 18-7 28-7',
         'M46 12c0-12-17-12-17 0s17 12 17 0v20c0 12-17 12-17 3']
PALETTES = {'games': ('#FFB020', '#2B1220', 'giggle games'),
            'after-dark': ('#120D0A', '#D8B26E', 'giggle after dark')}
font = TTFont(ROOT / 'apps/games/public/fonts/nunito-latin.woff2')
font = instantiateVariableFont(font, {'wght': 800})
glyphs, cmap = font.getGlyphSet(), font.getBestCmap()
units = font['head'].unitsPerEm

def lettering(text, size, x, baseline, fill, tracking=-.055):
    paths = []
    for char in text:
        name = cmap[ord(char)]
        pen = SVGPathPen(glyphs, ntos=lambda n: format(n, ".3f").rstrip("0").rstrip("."))
        glyphs[name].draw(TransformPen(pen, (size/units, 0, 0, -size/units, x, baseline)))
        d = pen.getCommands()
        if d: paths.append(f'<path d="{d}"/>')
        x += glyphs[name].width * size/units + size*tracking
    return f'<g fill="{fill}">{"".join(paths)}</g>', x

def svg(body, w, h, title):
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}" role="img" aria-label="{title}">\n  <title>{title}</title>\n{body}\n</svg>\n'

def mark(kind, small=False, square=False):
    bg, ink, label = PALETTES[kind]
    body = f'<rect width="64" height="64" rx="{0 if square else 16}" fill="{bg}"/>'
    # Same paths, same 3.5 stroke, moved up by two units for the expression.
    paths = ''.join(f'<path d="{p}"/>' for p in LOOPS)
    if kind == 'after-dark' and not small:
        body += '<defs><filter id="glow" x="-20%" y="-20%" width="140%" height="140%" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation=".65"/></filter></defs>'
        body += f'<g transform="translate(6 6)" fill="none" stroke="{ink}" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" opacity=".48" filter="url(#glow)">{paths}</g>'
    body += f'<g transform="translate(6 6)" fill="none" stroke="{ink}" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round">{paths}</g>'
    if kind == 'games':
        # Wink and pupil stay inside the bowls; the open smile clears the tails.
        if not small: body += f'<ellipse cx="18.5" cy="21" rx="1.8" ry="2.3" fill="{ink}"/>'
        body += f'<path d="M45.5 15.5 40.5 18l5 2.5" fill="none" stroke="{ink}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'
        body += '<path d="M26 49.5 39 48c-.9 5.7-3.3 9-6.7 9-3.1 0-5.3-2.5-6.3-7.5Z" fill="#DE1E6A"/>'
        if not small: body += '<path d="m56 17 2-2m-1 8h3m-4 6 2 2" fill="none" stroke="#DE1E6A" stroke-width="2" stroke-linecap="round"/>'
    else:
        if small:
            body += '<path d="M38 54q5-8 9-5 4-3 11 0-5 12-20 5Z" fill="#E52249"/><path d="m40 54 16-4" stroke="#120D0A" stroke-width="1.8" stroke-linecap="round"/>'
        else:
            body += '<path d="M37.5 54c4-3 5-9 10-6.5 3-3 6.5 1.5 12 1-3 8-11 14-22 5.5Z" fill="#E52249"/><path d="M39.5 54c6-4 8 .5 17.5-4" fill="none" stroke="#120D0A" stroke-width="1.65" stroke-linecap="round"/>'
            body += '<path d="m56 42 1.5-3m1.5 7 2-1.5" fill="none" stroke="#E52249" stroke-width="1.8" stroke-linecap="round"/>'
    return body

(HERE / 'meet/icon.svg').write_text((ROOT / 'apps/desktop/app/icon.svg').read_text())
for kind, (bg, ink, label) in PALETTES.items():
    dest = HERE / kind
    for name, small, square in [('icon', False, False), ('favicon', True, False), ('maskable', False, True)]:
        body = mark(kind, small, square)
        # All meaningful art is within the central 80% / safe circle at 512.
        # A .76 inset puts even the furthest corner inside radius 25.6/64.
        if square: body = f'<rect width="64" height="64" fill="{bg}"/><g transform="translate(7.68 7.68) scale(.76)">{mark(kind).split("/>", 1)[1]}</g>'
        (dest / f'{name}.svg').write_text(svg(body, 64, 64, label))
    for mode, color in [('light', '#2B1220'), ('dark', '#FAF7F2')]:
        letters, end = lettering(label, 36, 82, 44, ink if kind == 'after-dark' and mode == 'dark' else color)
        body = mark(kind) + letters
        (dest / f'wordmark{"-dark" if mode == "dark" else ""}.svg').write_text(svg(body, round(end+4), 64, label))
    # Editable outlined OG source. The only raster deliverable is the PNG export.
    og_bg = '#FAF7F2' if kind == 'games' else bg
    og_ink = ink
    words = [('giggle', 610, 254), ('games' if kind == 'games' else 'after dark', 610, 337)]
    body = f'<rect width="1200" height="630" fill="{og_bg}"/>'
    body += f'<g transform="translate(110 135) scale(5.625)">{mark(kind).split("/>", 1)[1]}</g>'
    for text, x, y in words:
        letters, _ = lettering(text, 76, x, y, og_ink)
        body += letters
    caption, _ = lettering('Play together.' if kind == 'games' else 'Stay up. Play on.', 28, 612, 418, og_ink, -.025)
    body += caption
    (dest / 'og.svg').write_text(svg(body, 1200, 630, label))
print('Built SVG sources from the Meet paths and Nunito 800 outlines.')
