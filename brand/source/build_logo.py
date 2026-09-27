"""
BOGA CAFÉ — vector logo system, built geometrically (no auto-tracing).

- Hexagon: exact 30° hexagon stretched vertically, double rule (thick + thin).
- Letter B: Cinzel Bold outline (SIL Open Font License), with an engraved inline.
- Beans: ellipses with a tapered S-shaped crease, fitted inside the B counters.
- Zellige: lattice of 8-point stars (two squares) + a central rosette,
  clipped to the top of the hexagon and kept clear of the B.
- Wordmark: "BOGA CAFÉ" in Cinzel Bold outlines; tagline in Montserrat SemiBold.
All shapes are merged into filled paths (no strokes, masks or fonts needed),
then written as Bézier curves (curvefit.py).

Run from the repository root after `npm install`:
    pip install -r brand/source/requirements.txt
    python3 brand/source/build_logo.py
"""
import math, os, sys
from functools import reduce
from fontTools.ttLib import TTFont
from fontTools.pens.basePen import BasePen
from shapely.geometry import Polygon, MultiPolygon, LineString, Point, box
from shapely.ops import unary_union
from shapely import affinity
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from curvefit import ring_d  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
OUT = os.path.join(ROOT, 'brand', 'logo', 'svg'); os.makedirs(OUT, exist_ok=True)
WEB = os.path.join(ROOT, 'src', 'assets', 'brand')   # copies used by the website
FONTS = os.path.join(ROOT, 'node_modules', '@fontsource')   # run `npm install` first
CINZEL = os.path.join(FONTS, 'cinzel/files/cinzel-latin-700-normal.woff')
MONT = os.path.join(FONTS, 'montserrat/files/montserrat-latin-600-normal.woff')
MITRE, ROUND = 2, 1

# ---------------------------------------------------------------- glyphs
class FlattenPen(BasePen):
    def __init__(self, glyphset, steps=14):
        super().__init__(glyphset); self.rings = []; self.cur = []; self.steps = steps
    def _moveTo(self, p): self.cur = [p]
    def _lineTo(self, p): self.cur.append(p)
    def _curveToOne(self, p1, p2, p3):
        p0 = self.cur[-1]
        for i in range(1, self.steps + 1):
            t = i / self.steps; mt = 1 - t
            self.cur.append((mt**3*p0[0] + 3*mt*mt*t*p1[0] + 3*mt*t*t*p2[0] + t**3*p3[0],
                             mt**3*p0[1] + 3*mt*mt*t*p1[1] + 3*mt*t*t*p2[1] + t**3*p3[1]))
    def _qCurveToOne(self, p1, p2):
        p0 = self.cur[-1]
        for i in range(1, self.steps + 1):
            t = i / self.steps; mt = 1 - t
            self.cur.append((mt*mt*p0[0] + 2*mt*t*p1[0] + t*t*p2[0], mt*mt*p0[1] + 2*mt*t*p1[1] + t*t*p2[1]))
    def _closePath(self):
        if len(self.cur) > 2: self.rings.append(self.cur)
        self.cur = []
    _endPath = _closePath

class Font:
    def __init__(self, path):
        self.f = TTFont(path); self.gs = self.f.getGlyphSet(); self.cmap = self.f.getBestCmap()
        self.upm = self.f['head'].unitsPerEm; self.hmtx = self.f['hmtx']
        os2 = self.f['OS/2']; self.cap = getattr(os2, 'sCapHeight', 0) or self.upm * 0.7
    def glyph(self, ch):
        name = self.cmap[ord(ch)]; pen = FlattenPen(self.gs); self.gs[name].draw(pen)
        polys = [Polygon(r).buffer(0) for r in pen.rings]
        geom = reduce(lambda a, b: a.symmetric_difference(b), polys) if polys else Polygon()
        # font units are y-up: flip
        return affinity.scale(geom, 1, -1, origin=(0, 0)), self.hmtx[name][0]
    def text(self, s, tracking=0.0):
        x = 0; parts = []
        for ch in s:
            if ch == ' ':
                x += self.hmtx[self.cmap[32]][0] + tracking * self.upm; continue
            g, adv = self.glyph(ch)
            parts.append(affinity.translate(g, x, 0)); x += adv + tracking * self.upm
        return unary_union(parts)

def fit(geom, x0, y0, x1, y1, align='center'):
    """Scale geom uniformly to fit the box and centre it."""
    gx0, gy0, gx1, gy1 = geom.bounds
    s = min((x1 - x0) / (gx1 - gx0), (y1 - y0) / (gy1 - gy0))
    g = affinity.scale(geom, s, s, origin=(gx0, gy0))
    gx0, gy0, gx1, gy1 = g.bounds
    return affinity.translate(g, (x0 + x1) / 2 - (gx0 + gx1) / 2, (y0 + y1) / 2 - (gy0 + gy1) / 2)

# ---------------------------------------------------------------- pieces
W = 520.0
H1 = (W / 2) * math.tan(math.radians(30))   # exact 30° slopes
H = 816.0

def hexagon(w=W, h=H):
    h1 = (w / 2) * math.tan(math.radians(30))
    return Polygon([(w/2, 0), (w, h1), (w, h-h1), (w/2, h), (0, h-h1), (0, h1)])

def frame(hexa, t_outer=17, gap=11, t_inner=6.5):
    ring1 = hexa.difference(hexa.buffer(-t_outer, join_style=MITRE))
    a = hexa.buffer(-(t_outer + gap), join_style=MITRE)
    ring2 = a.difference(a.buffer(-t_inner, join_style=MITRE))
    inner = a.buffer(-t_inner, join_style=MITRE)
    return unary_union([ring1, ring2]), inner

def bean(cx, cy, ry, rx, angle, crease_w):
    """Coffee bean: ellipse minus a tapered S-shaped crease."""
    ell = affinity.scale(Point(0, 0).buffer(1, quad_segs=48), rx, ry)
    n = 60; left = []; right = []
    for i in range(n + 1):
        t = i / n; y = -ry * 1.1 + 2.2 * ry * t
        x = rx * 0.16 * math.sin(math.pi * 2 * t - math.pi / 2) * (1 if t < 1 else 1)   # gentle S
        w = crease_w * math.sin(math.pi * min(max((t - 0.04) / 0.92, 0), 1)) ** 0.8
        left.append((x - w / 2, y)); right.append((x + w / 2, y))
    crease = Polygon(left + right[::-1]).buffer(0)
    b = ell.difference(crease)
    return affinity.translate(affinity.rotate(b, angle, origin=(0, 0)), cx, cy)

def fit_bean_in(counter, gap, angles=range(-70, 71, 5)):
    """Largest bean (any tilt) that fits inside the counter with a margin."""
    safe = counter.buffer(-gap)
    cx, cy = safe.centroid.x, safe.centroid.y
    x0, y0, x1, y1 = safe.bounds
    best = None
    for angle in angles:
        ry = max(x1 - x0, y1 - y0) * 0.5; rx = ry * 0.7
        for _ in range(120):
            b = bean(cx, cy, ry, rx, angle, crease_w=rx * 0.2)
            if safe.contains(b):
                if best is None or b.area > best.area: best = b
                break
            ry *= 0.98; rx *= 0.98
    return best

def split_counter(hole):
    """Cinzel's B has one counter with a narrow neck at the middle bar: cut it there."""
    x0, y0, x1, y1 = hole.bounds
    h = y1 - y0; best = None
    for k in range(300, 701, 5):
        y = y0 + h * k / 1000
        w = hole.intersection(LineString([(x0 - 1, y), (x1 + 1, y)])).length
        if best is None or w < best[0]: best = (w, y)
    y = best[1]
    top = hole.intersection(box(x0 - 1, y0 - 1, x1 + 1, y - 1))
    bot = hole.intersection(box(x0 - 1, y + 1, x1 + 1, y1 + 1))
    biggest = lambda g: max(g.geoms, key=lambda q: q.area) if hasattr(g, 'geoms') else g
    return [biggest(top), biggest(bot)]

def zellige(region, s=52, lw=2.6, keep_out=None, rosette=None, center=(0, 0)):
    """8-point star lattice (two squares per star), outlines only."""
    x0, y0, x1, y1 = region.bounds
    stars = []
    a = s / math.sqrt(2)          # tips touch: classic star-and-cross tiling
    j = 0; y = center[1] - s * math.ceil((center[1] - y0) / s + 1)
    while y < y1 + s:
        x = center[0] - s * math.ceil((center[0] - x0) / s + 1)
        while x < x1 + s:
            sq = box(x - a/2, y - a/2, x + a/2, y + a/2)
            star = unary_union([sq, affinity.rotate(sq, 45, origin=(x, y))])
            outline = star.exterior.buffer(lw / 2, join_style=MITRE)
            if region.contains(outline):          # complete stars only, never clipped
                stars.append(outline)
            x += s
        y += s; j += 1
    lines = unary_union(stars)
    if rosette is not None:
        rx, ry, r = rosette
        big = box(rx - r, ry - r, rx + r, ry + r)
        big = unary_union([big, affinity.rotate(big, 45, origin=(rx, ry))])
        inner = big.buffer(-r * 0.28, join_style=MITRE)
        ros = unary_union([big.exterior.buffer(lw * 0.7, join_style=MITRE), inner.exterior.buffer(lw / 2, join_style=MITRE),
                           Point(rx, ry).buffer(r * 0.12)])
        lines = unary_union([lines.difference(big.buffer(lw * 2.5)), ros])
    out = lines.intersection(region)
    if keep_out is not None: out = out.difference(keep_out)
    return out

# ---------------------------------------------------------------- build
cinzel = Font(CINZEL); mont = Font(MONT)
hexa = hexagon()
frm, inner = frame(hexa)

Bg, _ = cinzel.glyph('B')

def make_B(x0, y0, x1, y1):
    """B fitted in a box, with engraved inline and a bean in each counter."""
    B = fit(Bg, x0, y0, x1, y1)
    Bh = B.bounds[3] - B.bounds[1]
    d, t = Bh * 0.030, Bh * 0.0085
    ring = B.buffer(-d, join_style=ROUND).difference(B.buffer(-(d + t), join_style=ROUND))
    hole = Polygon(max(B.interiors, key=lambda r: Polygon(r).area))
    beans = [fit_bean_in(c, Bh * 0.016) for c in split_counter(hole)]
    return B, B.difference(ring), beans

# monogram: the B fills the hexagon
B, B_inline, beans = make_B(W * 0.13, H * 0.175, W * 0.87, H * 0.825)
mono_small = unary_union([frm, B, *beans])                 # favicon / small sizes: no inline
mono = unary_union([frm, B_inline, *beans])                # standard monogram

# emblem: the B sits lower and the zellige star band crowns it under the apex
Be, Be_inline, beans_e = make_B(W * 0.16, H * 0.265, W * 0.84, H * 0.845)
be_top = Be.bounds[1]
band = inner.buffer(-9, join_style=MITRE).intersection(box(0, 0, W, be_top - 14))
ix0, iy0, ix1, iy1 = band.bounds
pattern = zellige(band, s=58, lw=3.4, center=(W / 2, iy1 - 58 * 0.5 - 4))
emblem = unary_union([frm, Be_inline, *beans_e, pattern])

word = cinzel.text('BOGA CAFÉ', tracking=0.055)
tag = mont.text('TORRÉFACTION & VENTE · OUJDA', tracking=0.26)

# ---------------------------------------------------------------- svg
def path_d(geom, prec=1):
    polys = geom.geoms if hasattr(geom, 'geoms') else [geom]
    out = []
    for p in polys:
        if p.is_empty or not isinstance(p, Polygon): continue
        for ring in [p.exterior, *p.interiors]:
            out.append(ring_d(list(ring.coords)[:-1], err=0.16, prec=prec))
    return ''.join(out)

def svg(parts, w, h, title, bg=None, color='currentColor'):
    body = ''.join(f'<path fill-rule="evenodd" d="{path_d(g)}"/>' for g in parts)
    rect = f'<rect width="{w:.0f}" height="{h:.0f}" fill="{bg}"/>' if bg else ''
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w:.0f} {h:.0f}" role="img" aria-label="{title}">'
            f'<title>{title}</title>{rect}<g fill="{color}">{body}</g></svg>\n')

def place(geom, dx, dy): return affinity.translate(geom, dx, dy)

INK, SILVER, BLACK = '#141312', '#D6D6D3', '#0E0D0C'
M = 36  # clear space around artwork in exports

# 1) monogram
mw, mh = W + 2*M, H + 2*M
files = {}
files['boga-cafe-monogram.svg'] = svg([place(mono, M, M)], mw, mh, 'BOGA CAFÉ', color=INK)
files['boga-cafe-monogram-silver-on-black.svg'] = svg([place(mono, M, M)], mw, mh, 'BOGA CAFÉ', bg=BLACK, color=SILVER)
files['boga-cafe-monogram-currentcolor.svg'] = svg([mono], W, H, 'BOGA CAFÉ')
files['boga-cafe-monogram-small.svg'] = svg([mono_small], W, H, 'BOGA CAFÉ')

# 2) primary logo: emblem with zellige + wordmark (+ tagline variant)
ww = W * 1.62
wm = fit(word, 0, 0, ww, 1000)
wx0, wy0, wx1, wy1 = wm.bounds
gap = 64
total_w = max(W, wx1 - wx0)
em = place(emblem, (total_w - W) / 2, 0)
wm = place(wm, (total_w - (wx1 - wx0)) / 2 - wx0, H + gap - wy0)
ph = H + gap + (wy1 - wy0)
files['boga-cafe-logo.svg'] = svg([place(em, M, M), place(wm, M, M)], total_w + 2*M, ph + 2*M, 'BOGA CAFÉ', color=INK)
files['boga-cafe-logo-silver-on-black.svg'] = svg([place(em, M, M), place(wm, M, M)], total_w + 2*M, ph + 2*M, 'BOGA CAFÉ', bg=BLACK, color=SILVER)
tg = fit(tag, 0, 0, total_w * 0.98, 1000)
tx0, ty0, tx1, ty1 = tg.bounds
tg = place(tg, (total_w - (tx1 - tx0)) / 2 - tx0, ph + 30 - ty0)
ph2 = ph + 30 + (ty1 - ty0)
files['boga-cafe-logo-tagline.svg'] = svg([place(em, M, M), place(wm, M, M), place(tg, M, M)], total_w + 2*M, ph2 + 2*M, 'BOGA CAFÉ — Torréfaction & vente, Oujda', color=INK)

# 3) horizontal lockup: monogram + wordmark
mh2 = 300.0
m2 = fit(mono, 0, 0, 1000, mh2)
mx1 = m2.bounds[2]
w2 = fit(word, 0, 0, 5000, mh2 * 0.3)
w2 = place(w2, mx1 + mh2 * 0.16 - w2.bounds[0], mh2 / 2 - (w2.bounds[1] + w2.bounds[3]) / 2)
hw = w2.bounds[2]
files['boga-cafe-horizontal.svg'] = svg([place(m2, M, M), place(w2, M, M)], hw + 2*M, mh2 + 2*M, 'BOGA CAFÉ', color=INK)
files['boga-cafe-horizontal-silver-on-black.svg'] = svg([place(m2, M, M), place(w2, M, M)], hw + 2*M, mh2 + 2*M, 'BOGA CAFÉ', bg=BLACK, color=SILVER)
files['boga-cafe-horizontal-currentcolor.svg'] = svg([m2, w2], hw, mh2, 'BOGA CAFÉ')
files['boga-cafe-logo-currentcolor.svg'] = svg([em, wm], total_w, ph, 'BOGA CAFÉ')

# website copies (take the text colour of their container)
web = {
    'monogram.svg': files['boga-cafe-monogram-currentcolor.svg'],
    'monogram-small.svg': files['boga-cafe-monogram-small.svg'],
    'logo.svg': files['boga-cafe-logo-currentcolor.svg'],
}

# ---------------------------------------------------------------- icons & social
PUBLIC = os.path.join(ROOT, 'public')
SOCIAL = os.path.join(ROOT, 'brand', 'social'); os.makedirs(SOCIAL, exist_ok=True)
FOIL = ('<defs><linearGradient id="foil" x1="0" y1="0" x2="1" y2="1">'
        '<stop offset="0" stop-color="#F4F4F1"/><stop offset=".45" stop-color="#C9C9C5"/>'
        '<stop offset=".55" stop-color="#E9E9E5"/><stop offset="1" stop-color="#9C9C98"/></linearGradient>'
        '<radialGradient id="bg" cx=".5" cy=".42" r=".75"><stop offset="0" stop-color="#1C1916"/>'
        '<stop offset="1" stop-color="#0A0908"/></radialGradient></defs>')

def paths(parts, prec=1):
    return ''.join(f'<path fill-rule="evenodd" d="{path_d(g, prec)}"/>' for g in parts)

# favicon: small monogram on a dark rounded tile (reads on light and dark tabs)
fav = fit(mono_small, 0, 5, 64, 59)
open(os.path.join(PUBLIC, 'favicon.svg'), 'w').write(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#12100E"/>'
    f'<g fill="#DEDDD9">{paths([fav], 2)}</g></svg>\n')

# app icon (apple-touch-icon source): full bleed, iOS rounds the corners itself
app = fit(mono_small, 0, 26, 180, 154)
open(os.path.join(SOCIAL, 'app-icon.svg'), 'w').write(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 180">' + FOIL + '<rect width="180" height="180" fill="url(#bg)"/>'
    f'<g fill="url(#foil)">{paths([app], 2)}</g></svg>\n')

# profile picture for Instagram / TikTok / WhatsApp Business (circle-safe)
prof = fit(mono, 0, 220, 1080, 860)
open(os.path.join(SOCIAL, 'profile.svg'), 'w').write(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1080 1080">' + FOIL + '<rect width="1080" height="1080" fill="url(#bg)"/>'
    f'<g fill="url(#foil)">{paths([prof])}</g></svg>\n')

# link preview (Open Graph): emblem + wordmark + tagline
og_em = fit(emblem, 150, 70, 1000, 560)
ex1 = og_em.bounds[2]
og_w = fit(word, 0, 0, 560, 90)
og_w = place(og_w, ex1 + 70 - og_w.bounds[0], 250 - og_w.bounds[1])
og_t = fit(tag, 0, 0, og_w.bounds[2] - og_w.bounds[0], 40)
og_t = place(og_t, og_w.bounds[0] - og_t.bounds[0], og_w.bounds[3] + 34 - og_t.bounds[1])
dx = (1200 - (og_w.bounds[2] - og_em.bounds[0])) / 2 - og_em.bounds[0]
og_em, og_w, og_t = (place(g, dx, 0) for g in (og_em, og_w, og_t))
rule_y = (og_w.bounds[3] + og_t.bounds[1]) / 2
rule = box(og_w.bounds[0], rule_y - 1, og_w.bounds[0] + 120, rule_y + 1)
open(os.path.join(SOCIAL, 'og-image.svg'), 'w').write(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630">' + FOIL + '<rect width="1200" height="630" fill="url(#bg)"/>'
    f'<g fill="url(#foil)">{paths([og_em, og_w])}</g><g fill="#C99A66">{paths([og_t, rule])}</g></svg>\n')

for name, s in files.items():
    open(os.path.join(OUT, name), 'w').write(s)
    print(f'{name:44} {len(s) / 1024:5.1f} KB')
for name, s in web.items():
    open(os.path.join(WEB, name), 'w').write(s)
    print(f'src/assets/brand/{name:27} {len(s) / 1024:5.1f} KB')
