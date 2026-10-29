"""LOD2 roofs on footprint polygons: a straight skeleton, and on it the roof shapes
of OpenStreetMap's Simple 3D Buildings (roof:shape) that Overture carries as
roof_shape.

The straight skeleton is the event-driven wavefront of Felkel and Obdrzalek
(1998): every edge moves inwards at unit speed, vertices move along their
bisectors, and edge events (an edge shrinks to nothing) and split events (a
reflex vertex hits an edge, or a hole) change the wavefront until it vanishes.
A node's arrival time is its distance from its edges, so a hipped roof is the
skeleton lifted by tan(pitch) * time. Other shapes are built from it:

  hipped, pyramidal      the skeleton (pyramidal: every face meets at one apex)
  gabled, half-hipped    hip ends turned into vertical gables (half: part way)
  mansard, gambrel       a two-pitch profile on the hipped / gabled skeleton
  round                  a barrel profile on the gabled skeleton
  skillion               one plane, rising against roof_direction
  dome, onion            the footprint revolved about its centre
  gabled "across"        two planes meeting on a ridge at right angles to the long side

Every roof is checked: its faces must cover the footprint's area and nothing
may stick out of it. A roof that fails falls back (gabled to the two-plane
build, anything else to flat), and the build reports how often that happens.
"""
import heapq
import math

import numpy as np
from shapely.geometry import Polygon
from shapely.ops import polylabel

PITCHED = {"gabled", "hipped", "half-hipped", "pyramidal", "mansard", "gambrel", "round", "skillion", "saltbox",
           "dome", "onion", "spherical", "gabled_across"}
# shape codes shipped in buildings.json
CODES = {"flat": 0, "gabled": 1, "hipped": 2, "half-hipped": 3, "pyramidal": 4, "skillion": 5, "mansard": 6,
         "gambrel": 7, "round": 8, "dome": 9, "onion": 10, "saltbox": 11, "gabled_across": 12}
CURVED = {"round", "dome", "onion"}


class _V:
    """A wavefront vertex: position p at time t0, velocity v (None between two
    antiparallel edges), the edges before (eL) and after (eR) it, and its node."""
    __slots__ = ("p", "t0", "v", "eL", "eR", "prev", "next", "active", "node")


FAILS = {}


def _fail(why):
    FAILS[why] = FAILS.get(why, 0) + 1


def skeleton(rings, max_vertices=400):
    """Straight skeleton of a polygon. rings: (n, 2) arrays, the outer ring
    anticlockwise first, then holes clockwise, without a closing point.
    Returns (nodes, faces): nodes an (m, 3) array of x, y and arrival time;
    faces a list, per edge (in ring order), of node indices anticlockwise,
    starting with the edge's own two corners. None when it fails."""
    pts, E0, E1 = [], [], []
    for r in rings:
        k0, m = len(pts), len(r)
        for i in range(m):
            pts.append((float(r[i][0]), float(r[i][1])))
            E0.append(k0 + i)
            E1.append(k0 + (i + 1) % m)
    if len(pts) > max_vertices or len(pts) < 3:
        return _fail("size")
    P = np.array(pts)
    D = P[E1] - P[E0]
    L = np.hypot(D[:, 0], D[:, 1])
    if (L < 1e-4).any():
        return _fail("short")
    D /= L[:, None]
    N = np.c_[-D[:, 1], D[:, 0]]  # inward (left) normals
    C = (N * P[E0]).sum(1)
    nE = len(E0)
    scale = max(np.ptp(P[:, 0]), np.ptp(P[:, 1]), 1.0)
    tol = 1e-7 * scale

    nodes = [[x, y, 0.0] for x, y in pts]
    arcs = []  # (from node, to node, eL, eR): a vertex's path; face eL on its left
    lavs_v = []

    def velocity(a, b):
        den = 1.0 + float(N[a] @ N[b])
        return None if den < 1e-9 else (N[a] + N[b]) / den

    def make(p, t, eL, eR, node):
        V = _V()
        V.p, V.t0, V.eL, V.eR, V.node, V.active = np.asarray(p, float), t, eL, eR, node, True
        V.v = velocity(eL, eR)
        lavs_v.append(V)
        return V

    def pos(V, t):
        return V.p if V.v is None else V.p + V.v * (t - V.t0)

    def reflex(V):
        return float(D[V.eL][0] * D[V.eR][1] - D[V.eL][1] * D[V.eR][0]) < -1e-10

    k = 0
    for r in rings:
        m = len(r)
        vs = [make(P[k + i], 0.0, k + (i - 1) % m, k + i, k + i) for i in range(m)]
        if any(v.v is None for v in vs):
            return _fail("spike")
        for i in range(m):
            vs[i].prev, vs[i].next = vs[i - 1], vs[(i + 1) % m]
        k += m

    heap, seq = [], [0]

    def push(t, kind, a, b):
        heapq.heappush(heap, (t, seq[0], kind, a, b))
        seq[0] += 1

    def edge_event(A, now):
        B = A.next
        if not (A.active and B.active) or A is B:
            return
        d = D[A.eR]
        va = 0.0 if A.v is None else float(d @ A.v)
        vb = 0.0 if B.v is None else float(d @ B.v)
        den = va - vb
        gap = float(d @ pos(B, now)) - float(d @ pos(A, now))
        if den <= 1e-12:
            if abs(gap) < tol and den > -1e-9:  # a zero-length edge that is not growing
                push(now, 0, A, B)
            return
        t = now + gap / den
        if t >= now - tol:
            push(max(t, now), 0, A, B)

    def split_candidate(R, now):
        if R.v is None or not reflex(R):
            return
        best = None
        pr = pos(R, now)
        seen = set()
        for X in lavs_v:
            if not X.active or X is R or X.next is R:
                continue
            e = X.eR
            if e in (R.eL, R.eR) or (id(X), e) in seen:
                continue
            seen.add((id(X), e))
            closing = 1.0 - float(N[e] @ R.v)
            if closing <= 1e-12:
                continue
            gap = float(N[e] @ pr) - (C[e] + now)
            if gap < -tol:
                continue
            t = now + max(gap, 0.0) / closing
            if best is not None and t >= best[0]:
                continue
            Pt = pos(R, t)
            Y = X.next
            s, sx, sy = float(D[e] @ Pt), float(D[e] @ pos(X, t)), float(D[e] @ pos(Y, t))
            if sx - tol <= s <= sy + tol:
                best = (t, e)
        if best:
            push(best[0], 1, R, best[1])

    def lav(V):
        out, W = [V], V.next
        while W is not V:
            out.append(W)
            W = W.next
            if len(out) > 100000:
                break
        return out

    def node_at(V, t):
        """the node where V is at time t (its own node if it has not moved)"""
        if t - V.t0 <= tol or V.v is None:
            return V.node
        p = pos(V, t)
        nodes.append([p[0], p[1], t])
        arcs.append((V.node, len(nodes) - 1, V.eL, V.eR))
        return len(nodes) - 1

    def close_small(V, t):
        """a wavefront of two vertices has no area left: join them with a ridge"""
        ring = lav(V)
        if len(ring) > 2:
            return False
        if len(ring) == 2:
            A, B = ring
            a, b = node_at(A, t), node_at(B, t)
            arcs.append((a, b, A.eL, A.eR))
        for W in ring:
            W.active = False
        return True

    def schedule(V, now):
        if close_small(V, now):
            return
        edge_event(V.prev, now)
        edge_event(V, now)
        split_candidate(V, now)

    for V in list(lavs_v):
        edge_event(V, 0.0)
        split_candidate(V, 0.0)

    steps = 0
    while heap:
        steps += 1
        if steps > 50 * nE + 1000:
            return _fail("steps")
        t, _, kind, A, b = heapq.heappop(heap)
        if kind == 0:
            B = b
            if not (A.active and B.active) or A.next is not B:
                continue
            if t > 1e5:
                return _fail("time")
            if A.prev is B.next:  # the last three vertices meet: a peak
                Cv = A.prev
                p = pos(A, t)
                nodes.append([p[0], p[1], t])
                n = len(nodes) - 1
                for W in (A, B, Cv):
                    arcs.append((W.node, n, W.eL, W.eR))
                    W.active = False
                continue
            p = 0.5 * (pos(A, t) + pos(B, t))
            nodes.append([p[0], p[1], t])
            n = len(nodes) - 1
            arcs.append((A.node, n, A.eL, A.eR))
            arcs.append((B.node, n, B.eL, B.eR))
            A.active = B.active = False
            V = make(p, t, A.eL, B.eR, n)
            V.prev, V.next = A.prev, B.next
            A.prev.next = V
            B.next.prev = V
            schedule(V, t)
        else:
            R, e = A, b
            if not R.active:
                continue
            if t > 1e5:
                return _fail("time")
            Pt = pos(R, t)
            frag = None
            for X in lavs_v:
                if X.active and X.eR == e and X is not R and X.next is not R:
                    s, sx, sy = float(D[e] @ Pt), float(D[e] @ pos(X, t)), float(D[e] @ pos(X.next, t))
                    if sx - 10 * tol <= s <= sy + 10 * tol:
                        frag = X
                        break
            if frag is None:
                split_candidate(R, t)
                continue
            X, Y = frag, frag.next
            nodes.append([Pt[0], Pt[1], t])
            n = len(nodes) - 1
            arcs.append((R.node, n, R.eL, R.eR))
            R.active = False
            V1 = make(Pt, t, R.eL, e, n)
            V2 = make(Pt, t, e, R.eR, n)
            V1.prev, V1.next = R.prev, Y
            R.prev.next = V1
            Y.prev = V1
            V2.prev, V2.next = X, R.next
            X.next = V2
            R.next.prev = V2
            schedule(V1, t)
            if V2.active:
                schedule(V2, t)
    if any(V.active for V in lavs_v):
        return _fail("active")

    nodes = np.array(nodes)
    faces = []
    for e in range(nE):
        nxt = {E0[e]: E1[e]}
        for a, b2, eL, eR in arcs:
            if a == b2:
                continue
            if eL == e:
                nxt.setdefault(a, b2)
            if eR == e:
                nxt.setdefault(b2, a)
        face, cur = [E0[e]], E1[e]
        while cur != E0[e]:
            face.append(cur)
            if cur not in nxt or len(face) > 4 * nE + 8:
                return _fail("walk")
            cur = nxt[cur]
        faces.append(face)
    # every face lies on its own side of its edge, and the faces tile the polygon
    poly_area = sum(_area(np.asarray(r, float)) for r in rings)
    face_area = 0.0
    for e, f in enumerate(faces):
        q = nodes[f, :2]
        a = _area(q)
        if a < -tol * scale:
            return _fail("facearea_neg")
        if (q @ N[e] - C[e] < -1e-4 * scale).any():
            return _fail("face_side")
        face_area += a
    if abs(face_area - poly_area) > 1e-3 * max(poly_area, 1.0):
        return _fail("area")
    return nodes, faces


def _area(q):
    """signed area, anticlockwise positive"""
    x, y = q[:, 0], q[:, 1]
    return 0.5 * float(np.dot(x, np.roll(y, -1)) - np.dot(np.roll(x, -1), y))


# ---------------------------------------------------------------- triangulation

def earcut(q):
    """Ear clipping of a simple polygon (k, 2), either orientation; returns
    triangles as index triples, anticlockwise in the given 2D frame."""
    n = len(q)
    if n < 3:
        return []
    idx = list(range(n))
    if _area(q) < 0:
        idx.reverse()
    tris, guard = [], 0

    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

    scale = max(np.ptp(q[:, 0]), np.ptp(q[:, 1]), 1e-9)
    eps = 1e-12 * scale * scale
    while len(idx) > 3 and guard < 4 * n * n:
        guard += 1
        m = len(idx)
        cut = False
        for k in range(m):
            i0, i1, i2 = idx[k - 1], idx[k], idx[(k + 1) % m]
            a, b, c = q[i0], q[i1], q[i2]
            cr = cross(a, b, c)
            if cr <= eps:
                if abs(cr) <= eps and len(idx) > 3:  # collinear: drop the middle point
                    idx.pop(k)
                    cut = True
                    break
                continue
            inside = False
            for j in idx:
                if j in (i0, i1, i2):
                    continue
                p = q[j]
                if cross(a, b, p) >= -eps and cross(b, c, p) >= -eps and cross(c, a, p) >= -eps:
                    if not (np.allclose(p, a) or np.allclose(p, b) or np.allclose(p, c)):
                        inside = True
                        break
            if inside:
                continue
            tris.append((i0, i1, i2))
            idx.pop(k)
            cut = True
            break
        if not cut:
            break
    if len(idx) == 3:
        i0, i1, i2 = idx
        if cross(q[i0], q[i1], q[i2]) > eps:
            tris.append((i0, i1, i2))
    return tris


def _frame(pts3):
    """2D coordinates for a planar 3D polygon: its plan when it is not vertical,
    else positions along the wall and heights"""
    p = np.asarray(pts3, float)
    nrm = _newell(p)
    ln = np.linalg.norm(nrm)
    if ln < 1e-12:
        return None
    if abs(nrm[2]) > 1e-6 * ln:
        return p[:, :2]
    h = nrm[:2] / np.linalg.norm(nrm[:2])
    return np.c_[p[:, :2] @ np.array([-h[1], h[0]]), p[:, 2]]


class RoofMesh:
    """Vertices (x, y, z above the eave base) and triangles, roof faces first,
    then the vertical faces that belong to the walls (gable ends, skillion sides)."""

    def __init__(self):
        self.v, self.roof, self.wall, self.polys = [], [], [], []
        self.footprint = None  # the outline the roof covers, when it overhangs the walls

    def add(self, p):
        self.v.append((float(p[0]), float(p[1]), float(p[2])))
        return len(self.v) - 1

    def polygon(self, pts3, wall=False, up=True):
        """triangulate a planar polygon (3D points, anticlockwise seen from outside)"""
        pts3 = np.asarray(pts3, float)
        keep = [0]
        for i in range(1, len(pts3)):
            if np.linalg.norm(pts3[i] - pts3[keep[-1]]) > 1e-6:
                keep.append(i)
        if len(keep) > 1 and np.linalg.norm(pts3[keep[-1]] - pts3[keep[0]]) <= 1e-6:
            keep.pop()
        pts3 = pts3[keep]
        if len(pts3) < 3:
            return
        q = _frame(pts3)
        if q is None:
            return
        self.polys.append((pts3.copy(), wall))
        ids = [self.add(p) for p in pts3]
        nrm = _newell(pts3)
        for a, b, c in earcut(q):
            tri = (ids[a], ids[b], ids[c])
            # keep each triangle facing the polygon's own normal
            pa, pb, pc = pts3[a], pts3[b], pts3[c]
            if np.dot(np.cross(pb - pa, pc - pa), nrm) < 0:
                tri = (tri[0], tri[2], tri[1])
            (self.wall if wall else self.roof).append(tri)

    def empty(self):
        return not self.roof


def _newell(p):
    nrm = np.zeros(3)
    for i in range(len(p)):
        a, b = p[i], p[(i + 1) % len(p)]
        nrm += [(a[1] - b[1]) * (a[2] + b[2]), (a[2] - b[2]) * (a[0] + b[0]), (a[0] - b[0]) * (a[1] + b[1])]
    return nrm


# ---------------------------------------------------------------- profiles

def _profile(shape):
    """height fraction as a function of the fraction of the way to the ridge, and the breaks"""
    if shape in ("mansard", "gambrel"):
        u1, h1 = 0.3, 0.72  # a steep lower slope rising 72% of the roof in the outer 30%
        return (lambda u: h1 * u / u1 if u <= u1 else h1 + (1 - h1) * (u - u1) / (1 - u1)), [u1]
    if shape == "round":
        ks = [k / 6 for k in range(1, 6)]
        return (lambda u: math.sqrt(max(0.0, 1 - (1 - u) ** 2))), ks
    return (lambda u: u), []


def _clip(poly, ts, lo, hi):
    """Sutherland-Hodgman clip of a polygon against lo <= t <= hi, t linear on the polygon"""
    def one(P, T, keep):
        outP, outT = [], []
        n = len(P)
        for i in range(n):
            a, b, ta, tb = P[i], P[(i + 1) % n], T[i], T[(i + 1) % n]
            ia, ib = keep(ta), keep(tb)
            if ia:
                outP.append(a)
                outT.append(ta)
            if ia != ib:
                lim = lo if (ta < lo) != (tb < lo) else hi
                f = (lim - ta) / (tb - ta)
                outP.append(a + f * (b - a))
                outT.append(lim)
        return outP, outT
    P, T = list(poly), list(ts)
    if lo > -math.inf:
        P, T = one(P, T, lambda t: t >= lo - 1e-12)
    if P and hi < math.inf:
        P, T = one(P, T, lambda t: t <= hi + 1e-12)
    return P, T


def _subdivide(poly, ts, levels):
    """insert the points where t crosses each level along the polygon's edges"""
    outP, outT = [], []
    n = len(poly)
    for i in range(n):
        a, b, ta, tb = poly[i], poly[(i + 1) % n], ts[i], ts[(i + 1) % n]
        outP.append(a)
        outT.append(ta)
        cr = [lv for lv in levels if min(ta, tb) + 1e-9 < lv < max(ta, tb) - 1e-9]
        for lv in sorted(cr, reverse=ta > tb):
            f = (lv - ta) / (tb - ta)
            outP.append(a + f * (b - a))
            outT.append(lv)
    return outP, outT


# ---------------------------------------------------------------- shapes

def _fit(need, cap, mapped):
    """(roof height, truncation): a mapped height as it is; else the height the
    pitch needs, with a lower pitch up to twice the cap and, beyond that, the
    pitch kept and the roof cut off flat at the cap (a hip roof with a deck)"""
    if mapped:
        return mapped, 1.0
    if need <= cap:
        return need, 1.0
    if need <= 2 * cap:
        return cap, 1.0
    return cap, cap / need


def _skeleton_roof(rings, shape, slope, cap, mapped):
    """hipped / gabled / half-hipped / mansard / gambrel / round on the skeleton"""
    sk = skeleton(rings)
    if sk is None:
        return None
    nodes, faces = sk
    nodes = nodes.copy()
    tmax = float(nodes[:, 2].max())
    if tmax <= 1e-6:
        return None
    height, trunc = _fit(slope * tmax, cap, mapped)
    n_orig = sum(len(r) for r in rings)
    gables = set()
    if shape in ("gabled", "half-hipped", "gambrel", "round", "saltbox") and len(rings) == 1:
        # hip ends: triangular faces whose apex is shared with exactly two other faces
        uses = {}
        for f in faces:
            for v in f:
                uses[v] = uses.get(v, 0) + 1
        ring = np.asarray(rings[0], float)
        moved = set()
        for e, f in enumerate(faces):
            if len(f) != 3 or f[2] < n_orig or uses.get(f[2], 0) != 3 or f[2] in moved:
                continue
            a, b = ring[f[0]], ring[f[1]]
            L = np.linalg.norm(b - a)
            if L < 2.0:
                continue
            ap = nodes[f[2], :2]
            d = (b - a) / L
            proj = a + d * np.clip((ap - a) @ d, 0, L)
            frac = 0.55 if shape == "half-hipped" else 1.0
            nodes[f[2], :2] = ap + frac * (proj - ap)
            moved.add(f[2])
            if frac == 1.0:
                gables.add(e)
        if shape != "half-hipped" and not gables:
            return None  # no hip end to turn into a gable (a square, say): the caller builds it another way
    prof, breaks = _profile(shape)
    if trunc < 1.0 and not breaks:
        prof, breaks = (lambda u: min(u / trunc, 1.0)), [trunc]
    levels = [b * tmax for b in breaks]
    z = lambda t: height * prof(min(max(t / tmax, 0.0), 1.0))
    m = RoofMesh()
    for e, f in enumerate(faces):
        P = [nodes[i, :2] for i in f]
        T = [nodes[i, 2] for i in f]
        if e in gables:
            P2, T2 = _subdivide(P, T, levels)
            m.polygon([(p[0], p[1], z(t)) for p, t in zip(P2, T2)], wall=True)
            continue
        bounds = [-math.inf] + levels + [math.inf]
        for lo, hi in zip(bounds[:-1], bounds[1:]):
            P2, T2 = _clip(P, T, lo, hi) if levels else (P, T)
            if len(P2) >= 3:
                m.polygon([(p[0], p[1], z(t)) for p, t in zip(P2, T2)])
    m.height = height
    return m


def _pyramid(ring, height):
    ring = np.asarray(ring, float)
    c = ring.mean(0)
    m = RoofMesh()
    for i in range(len(ring)):
        a, b = ring[i], ring[(i + 1) % len(ring)]
        m.polygon([(a[0], a[1], 0), (b[0], b[1], 0), (c[0], c[1], height)])
    return m


def _plane_walls(m, ring, zf):
    """vertical faces from the eave up to a roof surface z = zf(x, y) along each edge"""
    n = len(ring)
    for i in range(n):
        a, b = ring[i], ring[(i + 1) % n]
        za, zb = zf(*a), zf(*b)
        # an edge crossing the ridge of a two-plane roof gets a point on it
        mids = []
        if hasattr(zf, "ridge"):
            s0, s1 = zf.s(*a), zf.s(*b)
            if (s0 - zf.ridge) * (s1 - zf.ridge) < 0:
                f = (zf.ridge - s0) / (s1 - s0)
                q = a + f * (b - a)
                mids.append((q, zf(*q)))
        poly = [(a[0], a[1], 0.0), (b[0], b[1], 0.0), (b[0], b[1], zb)]
        for q, zq in reversed(mids):
            poly.append((q[0], q[1], zq))
        poly.append((a[0], a[1], za))
        if max(za, zb, *[zq for _, zq in mids] or [0]) > 1e-3:
            m.polygon(poly, wall=True)


def _clip_halfplane(ring, s, keep_low):
    """the part of a polygon with s <= 0 (keep_low) or s >= 0, as a list of points"""
    out = []
    n = len(ring)
    for i in range(n):
        a, b = ring[i], ring[(i + 1) % n]
        sa, sb = s(a), s(b)
        ia, ib = (sa <= 0) if keep_low else (sa >= 0), (sb <= 0) if keep_low else (sb >= 0)
        if ia:
            out.append(a)
        if ia != ib:
            f = sa / (sa - sb)
            out.append(a + f * (b - a))
    return out


def _two_plane(ring, height, axis):
    """a gabled roof whose ridge runs along unit vector axis through the footprint's middle"""
    ring = np.asarray(ring, float)
    perp = np.array([-axis[1], axis[0]])
    s = ring @ perp
    s0, s1 = float(s.min()), float(s.max())
    half, mid = (s1 - s0) / 2, (s0 + s1) / 2
    if half < 0.5:
        return None

    def zf(x, y):
        return height * (1 - abs((x * perp[0] + y * perp[1]) - mid) / half)
    zf.ridge, zf.s = mid, lambda x, y: x * perp[0] + y * perp[1]
    m = RoofMesh()
    for low in (True, False):
        part = _clip_halfplane(ring, lambda p: float(p @ perp) - mid, low)
        if len(part) >= 3:
            m.polygon([(p[0], p[1], zf(*p)) for p in part])
    _plane_walls(m, ring, zf)
    return m


def _skillion(ring, height, downhill):
    """one plane falling towards the unit vector downhill"""
    ring = np.asarray(ring, float)
    s = ring @ downhill
    s0, s1 = float(s.min()), float(s.max())
    if s1 - s0 < 0.5:
        return None

    def zf(x, y):
        return height * (s1 - (x * downhill[0] + y * downhill[1])) / (s1 - s0)
    m = RoofMesh()
    m.polygon([(p[0], p[1], zf(*p)) for p in ring])
    _plane_walls(m, ring, zf)
    return m


def _revolve(ring, height, shape):
    """dome or onion: the footprint scaled about its centre on a profile"""
    ring = np.asarray(ring, float)
    c = ring.mean(0)
    if shape == "onion":
        prof = [(1.0, 0.0), (1.12, 0.12), (1.16, 0.25), (1.08, 0.4), (0.82, 0.55), (0.5, 0.68), (0.25, 0.8), (0.1, 0.9), (0.0, 1.0)]
    else:
        k = 7 if shape == "dome" else 8
        prof = [(math.cos(a), math.sin(a)) for a in np.linspace(0, math.pi / 2, k)]
        if shape == "spherical":
            prof = [(1.0 + 0.12 * math.sin(2 * a), math.sin(a)) for a in np.linspace(0, math.pi / 2, k)]
            prof[-1] = (0.0, 1.0)
    m = RoofMesh()
    rows = [[m.add((c[0] + (p[0] - c[0]) * r, c[1] + (p[1] - c[1]) * r, height * h)) for p in ring] for r, h in prof]
    n = len(ring)
    for k in range(len(rows) - 1):
        for i in range(n):
            j = (i + 1) % n
            a, b, cc, d = rows[k][i], rows[k][j], rows[k + 1][j], rows[k + 1][i]
            if prof[k + 1][0] < 1e-6:
                m.roof.append((a, b, cc))
            else:
                m.roof.append((a, b, cc))
                m.roof.append((a, cc, d))
    return m


def long_axis(ring):
    """unit vector along the long side of the minimum rotated rectangle"""
    ring = np.asarray(ring, float)
    best = None
    for i in range(len(ring)):
        d = ring[(i + 1) % len(ring)] - ring[i]
        L = np.hypot(*d)
        if L < 1e-6:
            continue
        d /= L
        p = np.array([-d[1], d[0]])
        u, v = ring @ d, ring @ p
        w, h = np.ptp(u), np.ptp(v)
        if best is None or w * h < best[0]:
            best = (w * h, d if w >= h else p, max(w, h), min(w, h))
    return best[1], best[2], best[3]


def _offset(ring, d):
    """the ring moved outwards by d with mitred corners, vertex for vertex; None if it folds"""
    ring = np.asarray(ring, float)
    n = len(ring)
    out = np.zeros_like(ring)
    for k in range(n):
        a, b = ring[k] - ring[k - 1], ring[(k + 1) % n] - ring[k]
        la, lb = np.hypot(*a), np.hypot(*b)
        if la < 1e-6 or lb < 1e-6:
            return None
        n1, n2 = np.array([a[1], -a[0]]) / la, np.array([b[1], -b[0]]) / lb  # outward (right) normals
        mm = n1 + n2
        ml = np.hypot(*mm)
        if ml < 1e-6:
            return None
        mm /= ml
        c = mm @ n1
        if c < 0.5:  # sharp corners would spike
            return None
        out[k] = ring[k] + mm * d / c
    poly = Polygon(out)
    if not poly.is_valid or not poly.exterior.is_ccw:
        return None
    for k in range(n):
        if (ring[(k + 1) % n] - ring[k]) @ (out[(k + 1) % n] - out[k]) <= 0:
            return None
    return out


def _height_at(m, p):
    """the roof's height above point p, from its roof triangles"""
    v = np.asarray(m.v)
    for a, b, c in m.roof:
        A, B, C = v[a], v[b], v[c]
        det = (B[1] - C[1]) * (A[0] - C[0]) + (C[0] - B[0]) * (A[1] - C[1])
        if abs(det) < 1e-12:
            continue
        l1 = ((B[1] - C[1]) * (p[0] - C[0]) + (C[0] - B[0]) * (p[1] - C[1])) / det
        l2 = ((C[1] - A[1]) * (p[0] - C[0]) + (A[0] - C[0]) * (p[1] - C[1])) / det
        l3 = 1 - l1 - l2
        if min(l1, l2, l3) >= -1e-6:
            return l1 * A[2] + l2 * B[2] + l3 * C[2]
    return None


def _down(pts):
    """a polygon's points in the order that makes it face downwards"""
    pts = [np.asarray(p, float) for p in pts]
    return pts[::-1] if _newell(np.array(pts))[2] > 0 else pts


def _with_overhang(m, ring, buf, d):
    """A roof built over the footprint offset outwards by d (buf) made to overhang
    the walls: lowered so it meets them at the eave, gable walls moved back onto the
    footprint, and soffits under the eaves and the rakes."""
    zs = [z for z in (_height_at(m, a) for a in ring) if z is not None]
    if len(zs) < max(3, len(ring) // 2):
        return None
    drop = float(np.median(zs))
    if drop <= 0:
        return None
    out = RoofMesh()
    n = len(ring)
    gable = set()
    for pts, wall in m.polys:
        p = np.array(pts, float)
        p[:, 2] -= drop
        if not wall:
            out.polygon(p)
            continue
        # the buffered edge this wall stands on
        mid = p[:, :2].mean(0)
        best, k = 1e9, -1
        for j in range(n):
            e = buf[(j + 1) % n] - buf[j]
            L = np.hypot(*e)
            dist = abs((mid - buf[j]) @ np.array([-e[1], e[0]]) / L)
            if dist < best:
                best, k = dist, j
        gable.add(k)
        e = buf[(k + 1) % n] - buf[k]
        nin = np.array([-e[1], e[0]]) / np.hypot(*e)
        moved = p.copy()
        moved[:, :2] += nin * d
        P2, _ = _clip(list(moved), list(moved[:, 2]), 0.0, math.inf)
        if len(P2) >= 3:
            out.polygon(P2, wall=True)
        sh = np.array([nin[0] * d, nin[1] * d, 0.0])
        for i in range(len(p)):
            a, b = p[i], p[(i + 1) % len(p)]
            if a[2] <= -drop + 1e-6 and b[2] <= -drop + 1e-6:
                continue  # the wall's foot
            out.polygon(_down([a, b, b + sh, a + sh]), wall=True)
    for i in range(n):  # eave soffits
        if i in gable:
            continue
        a, b = ring[i], ring[(i + 1) % n]
        e = (b - a) / np.hypot(*(b - a))
        nout = np.array([e[1], -e[0]])
        pa = buf[i] if (i - 1) % n not in gable else a + nout * d
        pb = buf[(i + 1) % n] if (i + 1) % n not in gable else b + nout * d
        out.polygon(_down([(a[0], a[1], 0.0), (b[0], b[1], 0.0), (pb[0], pb[1], -drop), (pa[0], pa[1], -drop)]), wall=True)
    out.footprint = buf
    out.height = float(max(p[2] for p in out.v))
    out.drop = drop
    return out


def roof_mesh(rings, shape, pitch=30.0, cap=6.0, height=None, direction=None, across=False, axis=None, overhang=0.0):
    """Roof over a footprint, with an optional overhang (m) past the walls; see _roof_mesh."""
    if overhang > 0 and len(rings) == 1 and shape not in ("dome", "onion", "spherical", "pyramidal", "skillion"):
        buf = _offset(rings[0], overhang)
        if buf is not None:
            m, built, h = _roof_mesh([buf], shape, pitch, cap, height, direction, across, axis)
            if m is not None:
                mo = _with_overhang(m, np.asarray(rings[0], float), buf, overhang)
                if mo is not None and not mo.empty():
                    return mo, built, mo.height
    return _roof_mesh(rings, shape, pitch, cap, height, direction, across, axis)


def _roof_mesh(rings, shape, pitch=30.0, cap=6.0, height=None, direction=None, across=False, axis=None):
    """A roof over a footprint (outer ring anticlockwise, holes clockwise; local
    metres): its shape, and either a mapped height or a pitch in degrees with a
    cap on the height. axis, a unit vector, puts a gable's ridge along it (a
    terrace's ridge along its street). Returns (RoofMesh, built shape, roof
    height); (None, "flat", 0) when nothing else can be built."""
    outer = np.asarray(rings[0], float)
    c = outer.mean(0)
    rs = [np.asarray(r, float) - c for r in rings]
    slope = math.tan(math.radians(pitch))
    m, built, h = None, shape, 0.0
    try:
        if axis is not None and shape in ("gabled", "half-hipped", "gambrel", "round", "saltbox") and len(rs) == 1:
            ax = np.asarray(axis, float) / np.linalg.norm(axis)
            h, _ = _fit(slope * _half_width(rs[0], ax), cap, height)
            m = _two_plane(rs[0], h, ax)
        elif shape in ("hipped", "mansard", "gabled", "half-hipped", "gambrel", "round", "saltbox") and not across:
            m = _skeleton_roof(rs, shape, slope, cap, height)
            if m is not None:
                h = m.height
        if m is None and shape in ("gabled", "half-hipped", "gambrel", "round", "saltbox", "hipped", "mansard") and len(rs) == 1:
            # no skeleton (or a ridge across the long side): two planes on one ridge
            ax, _, _ = long_axis(rs[0])
            if across:
                ax = np.array([-ax[1], ax[0]])
            built = "gabled_across" if across else "gabled"
            h, _ = _fit(slope * _half_width(rs[0], ax), cap, height)
            m = _two_plane(rs[0], h, ax)
        elif shape == "pyramidal":
            h, _ = _fit(slope * _inradius(rs[0]), cap, height)
            m = _pyramid(rs[0], h)
        elif shape == "skillion":
            if direction is None:
                ax, _, _ = long_axis(rs[0])
                down = np.array([-ax[1], ax[0]])
            else:  # roof:direction, degrees clockwise from north, is the way the slope faces
                down = np.array([math.sin(math.radians(direction)), math.cos(math.radians(direction))])
            ext = float(np.ptp(rs[0] @ down))
            h, _ = _fit(slope * ext, cap, height)
            m = _skillion(rs[0], h, down)
        elif shape in ("dome", "onion", "spherical"):
            r = float(np.mean(np.hypot(rs[0][:, 0], rs[0][:, 1])))
            h = height or r * (1.15 if shape == "onion" else 1.0)
            m = _revolve(rs[0], h, shape)
    except (ValueError, IndexError, ZeroDivisionError, FloatingPointError):
        m = None
    if m is None or m.empty() or h < 0.3:
        return None, "flat", 0.0
    v = np.asarray(m.v)
    v[:, :2] += c
    m.v = [tuple(p) for p in v]
    m.polys = [(np.c_[p[:, :2] + c, p[:, 2]], w) for p, w in m.polys]
    return m, built, h


def _half_width(ring, axis):
    perp = np.array([-axis[1], axis[0]])
    return float(np.ptp(ring @ perp)) / 2


def _inradius(ring):
    poly = Polygon(ring)
    if not poly.is_valid or poly.area <= 0:
        return float(np.min(np.ptp(ring, axis=0))) / 2
    p = polylabel(poly, 0.1)
    return float(poly.exterior.distance(p))


def check(m, rings, height, shape=""):
    """roof faces cover the footprint, stay inside it (an onion may bulge) and under the given height"""
    v = np.asarray(m.v)
    if m.footprint is not None:
        rings = [m.footprint]
    outer = np.asarray(rings[0], float)
    poly_area = sum(_area(np.asarray(r, float)) for r in rings)
    area = 0.0
    for a, b, c in m.roof:
        area += 0.5 * ((v[b, 0] - v[a, 0]) * (v[c, 1] - v[a, 1]) - (v[b, 1] - v[a, 1]) * (v[c, 0] - v[a, 0]))
    if abs(area - poly_area) > 0.02 * poly_area + 0.5:
        return False
    if v[:, 2].max() > height * 1.001 + 1e-6 or v[:, 2].min() < -getattr(m, "drop", 0.0) - 1e-6:
        return False
    grow = 0.2 * np.ptp(outer, axis=0) if shape in ("onion", "spherical") else 0.0
    lo, hi = outer.min(0) - 0.05 - grow, outer.max(0) + 0.05 + grow
    return bool((v[:, :2] >= lo).all() and (v[:, :2] <= hi).all())
