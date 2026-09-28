"""
Turn dense polygon rings into clean SVG paths: straight runs become lines,
curved runs become cubic Béziers (Schneider's least-squares fit), corners stay sharp.
"""
import math
import numpy as np

CORNER_DEG = 32.0


def _unit(v):
    n = np.linalg.norm(v)
    return v / n if n > 1e-12 else v


def _bez(ctrl, t):
    t = np.asarray(t)[:, None]
    mt = 1 - t
    return mt**3 * ctrl[0] + 3 * mt * mt * t * ctrl[1] + 3 * mt * t * t * ctrl[2] + t**3 * ctrl[3]


def _bez_d1(ctrl, t):
    t = np.asarray(t)[:, None]
    mt = 1 - t
    return 3 * mt * mt * (ctrl[1] - ctrl[0]) + 6 * mt * t * (ctrl[2] - ctrl[1]) + 3 * t * t * (ctrl[3] - ctrl[2])


def _bez_d2(ctrl, t):
    t = np.asarray(t)[:, None]
    return 6 * (1 - t) * (ctrl[2] - 2 * ctrl[1] + ctrl[0]) + 6 * t * (ctrl[3] - 2 * ctrl[2] + ctrl[1])


def _chord_params(pts):
    d = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(pts, axis=0), axis=1))])
    return d / d[-1] if d[-1] > 0 else d


def _generate(pts, u, t1, t2):
    p0, p3 = pts[0], pts[-1]
    a1 = t1[None, :] * (3 * (1 - u) ** 2 * u)[:, None]
    a2 = t2[None, :] * (3 * (1 - u) * u**2)[:, None]
    c00 = np.sum(a1 * a1); c01 = np.sum(a1 * a2); c11 = np.sum(a2 * a2)
    base = _bez(np.array([p0, p0, p3, p3]), u)
    tmp = pts - base
    x0 = np.sum(a1 * tmp); x1 = np.sum(a2 * tmp)
    det = c00 * c11 - c01 * c01
    seg = np.linalg.norm(p3 - p0)
    if abs(det) > 1e-12:
        al = (x0 * c11 - x1 * c01) / det
        ar = (c00 * x1 - c01 * x0) / det
    else:
        al = ar = 0
    eps = 1e-6 * seg
    if al < eps or ar < eps:
        al = ar = seg / 3
    return np.array([p0, p0 + t1 * al, p3 + t2 * ar, p3])


def _reparam(ctrl, pts, u):
    d = _bez(ctrl, u) - pts
    d1 = _bez_d1(ctrl, u)
    d2 = _bez_d2(ctrl, u)
    num = np.sum(d * d1, axis=1)
    den = np.sum(d1 * d1 + d * d2, axis=1)
    nu = u - np.where(np.abs(den) > 1e-12, num / np.where(den == 0, 1, den), 0)
    return np.clip(nu, 0, 1)


def _max_err(ctrl, pts, u):
    d = np.linalg.norm(_bez(ctrl, u) - pts, axis=1)
    i = int(np.argmax(d))
    return d[i], i


def fit_cubic(pts, t1, t2, err, depth=0):
    if len(pts) == 2:
        s = np.linalg.norm(pts[1] - pts[0]) / 3
        return [np.array([pts[0], pts[0] + t1 * s, pts[1] + t2 * s, pts[1]])]
    u = _chord_params(pts)
    ctrl = _generate(pts, u, t1, t2)
    e, split = _max_err(ctrl, pts, u)
    if e < err:
        return [ctrl]
    if e < err * 6:
        for _ in range(24):
            u = _reparam(ctrl, pts, u)
            ctrl = _generate(pts, u, t1, t2)
            e, split = _max_err(ctrl, pts, u)
            if e < err:
                return [ctrl]
    split = min(max(split, 1), len(pts) - 2)
    c = _unit(pts[split - 1] - pts[split + 1])
    return fit_cubic(pts[: split + 1], t1, c, err, depth + 1) + fit_cubic(pts[split:], -c, t2, err, depth + 1)


def _is_straight(pts, tol):
    a, b = pts[0], pts[-1]
    ab = b - a
    n = np.linalg.norm(ab)
    if n < 1e-9:
        return True
    dist = np.abs(np.cross(ab, pts - a)) / n
    return dist.max() < tol


def _end_tangent(run):
    """Tangent at run[0] pointing into the run, extrapolated from the first two chords."""
    d01 = run[1] - run[0]
    if len(run) < 3:
        return _unit(d01)
    d12 = run[2] - run[1]
    l01, l12 = np.linalg.norm(d01), np.linalg.norm(d12)
    if l01 < 1e-9 or l12 < 1e-9:
        return _unit(d01)
    t = 1.5 * d01 / l01 - 0.5 * d12 / l12
    # keep the extrapolation only if the two chords are close in direction
    return _unit(t) if np.dot(d01 / l01, d12 / l12) > 0.9 else _unit(d01)


def _turn(prev, cur, nxt):
    a = _unit(cur - prev); b = _unit(nxt - cur)
    return math.degrees(math.acos(max(-1.0, min(1.0, float(np.dot(a, b))))))


def ring_segments(coords, err=0.18, corner_deg=CORNER_DEG):
    """coords: closed ring without the repeated last point -> list of ('L', p1) / ('C', c1, c2, p) and start point."""
    P = np.asarray(coords, dtype=float)
    # drop duplicate consecutive points
    keep = [0]
    for i in range(1, len(P)):
        if np.linalg.norm(P[i] - P[keep[-1]]) > 1e-6:
            keep.append(i)
    P = P[keep]
    if np.linalg.norm(P[0] - P[-1]) < 1e-6:
        P = P[:-1]
    n = len(P)
    if n < 3:
        return P[0], [('L', p) for p in P[1:]]
    corners = [i for i in range(n) if _turn(P[i - 1], P[i], P[(i + 1) % n]) > corner_deg]
    # break points without a corner (smooth joins, tangent from both neighbours)
    smooth = set()
    if not corners:
        # circles, ellipses: split into 4 arcs
        corners = [0, n // 4, n // 2, 3 * n // 4]
        smooth = set(corners)
    elif len(corners) == 1:
        # a single corner: also break opposite it, or the run would be closed
        extra = (corners[0] + n // 2) % n
        corners = sorted(corners + [extra])
        smooth = {extra}
    start = corners[0]
    smooth = {(c - start) % n for c in smooth}
    order = np.roll(np.arange(n), -start)
    Q = P[order]
    idx = sorted((c - start) % n for c in corners) + [n]
    Q = np.vstack([Q, Q[:1]])
    segs = []
    for a, b in zip(idx[:-1], idx[1:]):
        run = Q[a : b + 1]
        if len(run) == 2 or _is_straight(run, err * 0.5):
            segs.append(('L', run[-1]))
            continue
        t1 = _unit(Q[(a + 1) % n] - Q[(a - 1) % n]) if a in smooth else _end_tangent(run)
        t2 = _unit(Q[(b - 1) % n] - Q[(b + 1) % n]) if b % n in smooth else _end_tangent(run[::-1])
        for c in fit_cubic(run, t1, t2, err):
            if np.linalg.norm(c[1] - c[0]) < 1e-3 and np.linalg.norm(c[2] - c[3]) < 1e-3:
                segs.append(('L', c[3]))
            else:
                segs.append(('C', c[1], c[2], c[3]))
    return Q[0], segs


def fmt(v, prec=1):
    s = f'{v:.{prec}f}'.rstrip('0').rstrip('.')
    return '0' if s in ('-0', '') else s


def ring_d(coords, err=0.18, prec=1):
    p0, segs = ring_segments(coords, err)
    out = [f'M{fmt(p0[0], prec)} {fmt(p0[1], prec)}']
    for s in segs[:-1] if segs and segs[-1][0] == 'L' else segs:
        if s[0] == 'L':
            out.append(f'L{fmt(s[1][0], prec)} {fmt(s[1][1], prec)}')
        else:
            out.append('C' + ' '.join(f'{fmt(p[0], prec)} {fmt(p[1], prec)}' for p in s[1:]))
    return ''.join(out) + 'Z'
