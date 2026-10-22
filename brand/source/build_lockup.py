"""
BOGA CAFÉ — header lockup for the website (owner 2026-10-22): the monogram, then "BOGA CAFÉ" with
"CAFÉ" in copper, then the approved tagline "TORRÉFACTION & VENTE · OUJDA" under the name.

Nothing is drawn here: the paths are copied from the official files written by build_logo.py, moved and
scaled uniformly (no stretching). The wordmark is split into its two words by letter position so CSS can
colour them apart (classes lk-mark, lk-boga, lk-cafe, lk-tag).

- src/assets/brand/lockup.svg          monogram + name + tagline (header from 64 px: 240 px wide, the
                                       tagline version's minimum width in brand/README.md)
- src/assets/brand/lockup-compact.svg  small monogram + name, no tagline (phones: under 48 px tall the
                                       guide asks for the small monogram, and the tagline would be unreadable)

Run from the repository root (standard library only):
    python3 brand/source/build_lockup.py
"""
import os, re

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
SVG = os.path.join(ROOT, 'brand', 'logo', 'svg')
WEB = os.path.join(ROOT, 'src', 'assets', 'brand')

def paths(name):
    with open(os.path.join(SVG, name), encoding='utf-8') as f:
        return re.findall(r'<path[^>]* d="([^"]*)"', f.read())

_, wordmark, tagline = paths('boga-cafe-logo-tagline.svg')   # emblem, wordmark, tagline
(mark,) = paths('boga-cafe-monogram-currentcolor.svg')         # 520 x 816, from 0,0
(mark_small,) = paths('boga-cafe-monogram-small.svg')          # same box

# In the tagline logo the wordmark spans x 36..878, y 916..1039.2 and the tagline ends at y 1100.2
# (bounding boxes measured in a browser). BOGA ends at x 461.2 and CAFÉ starts at x 510.3: every letter
# outline starts inside its letter, so its first point says which word it belongs to.
WORD_X0, WORD_X1, WORD_Y0, WORD_Y1, TAG_Y1, SPLIT = 36, 878, 916, 1039.2, 1100.2, 485
subs = [s for s in re.split(r'(?=M)', wordmark) if s.strip()]
first_x = lambda s: float(re.match(r'M\s*([-\d.]+)', s).group(1))
boga = ''.join(s for s in subs if first_x(s) < SPLIT)
cafe = ''.join(s for s in subs if first_x(s) >= SPLIT)
assert boga.count('M') == 7 and cafe.count('M') == 6, 'the wordmark changed: check the split between BOGA and CAFÉ'

MARK_W, MARK_H = 520, 816
SCALE, GAP = 2.82, 170   # name about a third of the mark's height, as in the owner's reference

def lockup(mark_d, tag):
    y1 = TAG_Y1 if tag else WORD_Y1
    block_h = (y1 - WORD_Y0) * SCALE
    tx = MARK_W + GAP - WORD_X0 * SCALE
    ty = MARK_H / 2 - block_h / 2 - WORD_Y0 * SCALE
    width = MARK_W + GAP + (WORD_X1 - WORD_X0) * SCALE
    parts = [
        f'<path class="lk-mark" fill="currentColor" fill-rule="evenodd" d="{mark_d}"/>',
        f'<g transform="translate({tx:.1f} {ty:.1f}) scale({SCALE})">',
        f'<path class="lk-boga" fill="currentColor" fill-rule="evenodd" d="{boga}"/>',
        f'<path class="lk-cafe" fill="#C99A66" fill-rule="evenodd" d="{cafe}"/>',
    ]
    if tag:
        parts.append(f'<path class="lk-tag" fill="currentColor" fill-rule="evenodd" d="{tagline}"/>')
    parts.append('</g>')
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width:.0f} {MARK_H}" class="lockup">'
            + ''.join(parts) + '</svg>\n')

for name, d, tag in (('lockup.svg', mark, True), ('lockup-compact.svg', mark_small, False)):
    out = lockup(d, tag)
    with open(os.path.join(WEB, name), 'w', encoding='utf-8') as f:
        f.write(out)
    print(f'src/assets/brand/{name:20} {len(out) / 1024:5.1f} KB')
