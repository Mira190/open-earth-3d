"""Street furniture out of the carriageways, as web/streets.js moves it in the browser.

The game draws each road line as a band of its class's width and parks cars with their
kerb-side wheels on the band's edge. OpenStreetMap maps many street lamps as nodes of the
road's own line, and benches and trees in kerb build-outs and between a dual carriageway's
two lines, which the game draws over each other. Each such thing is moved to the nearest
place clear of every band at its level, grown to the outer side of a car parked at the kerb,
or left out where there is none within a few metres (in the middle of a junction, on a
median). web/streets.js does the same to data built before this existed, and its numbers
must stay the same as these.
"""
import math

ROADW = {"motorway": 14, "trunk": 12, "primary": 12, "secondary": 10, "tertiary": 9, "residential": 7,
         "unclassified": 6, "living_street": 5}
LEVEL = 3.0   # a road and a thing this far apart in height are on different levels
CAR_HW = 1.0  # the half width of the widest car that parks
GC = 16.0     # grid cell (m)


def kerb(c):
    """Where a car pulled in at the kerb has its centre, off the road's line (web/game/cars.js kerbOf)."""
    return min(6.5, max(3.3, ROADW.get(c, 7) / 2 - 0.1))


def setback(c):
    """How far from the road's line the furniture keeps."""
    return max(ROADW.get(c, 7) / 2, kerb(c) + CAR_HW)


def _hash(x, y):
    s = math.sin(x * 12.9898 + y * 78.233) * 43758.5453
    return s - math.floor(s)


class Carriageways:
    """roads: [{"c": class, "p": [x, y, z, ...] in decimetres}] (game.json paths.road)."""

    def __init__(self, roads):
        self.segs, self.grid = [], {}
        for r in roads:
            p, hw = r["p"], setback(r["c"])
            for k in range(3, len(p) - 2, 3):
                ax, ay, az, bx, by, bz = (v / 10 for v in p[k - 3:k + 3])
                if ax == bx and ay == by:
                    continue
                i = len(self.segs)
                self.segs.append((ax, ay, az, bx, by, bz, hw))
                for cx in range(math.floor((min(ax, bx) - hw) / GC), math.floor((max(ax, bx) + hw) / GC) + 1):
                    for cy in range(math.floor((min(ay, by) - hw) / GC), math.floor((max(ay, by) + hw) / GC) + 1):
                        self.grid.setdefault((cx, cy), []).append(i)

    def deepest(self, x, y, z, r):
        """(depth, nx, ny): how far a circle of radius r at height z reaches into the deepest band at its
        level (<= 0: clear of all), and the way out of it."""
        best = (-math.inf, 0.0, 0.0)
        for i in self.grid.get((math.floor(x / GC), math.floor(y / GC)), ()):
            ax, ay, az, bx, by, bz, hw = self.segs[i]
            ex, ey = bx - ax, by - ay
            L2 = ex * ex + ey * ey
            t = max(0.0, min(1.0, ((x - ax) * ex + (y - ay) * ey) / L2))
            if z is not None and abs(az + (bz - az) * t - z) >= LEVEL:
                continue
            qx, qy = ax + ex * t, ay + ey * t
            d = math.hypot(x - qx, y - qy)
            deep = hw + r - d
            if deep <= best[0]:
                continue
            if d > 1e-3:
                best = (deep, (x - qx) / d, (y - qy) / d)
            else:  # on the line: either kerb
                L, side = math.sqrt(L2), 1 if _hash(x, y) < 0.5 else -1
                best = (deep, -ey / L * side, ex / L * side)
        return best

    def kerbside(self, x, y, z, r=0.0, reach=6.0):
        """The nearest place within reach where a circle of radius r is clear of every band: (x, y) or None."""
        px, py = x, y
        for _ in range(8):
            deep, nx, ny = self.deepest(px, py, z, r)
            if deep <= 0:
                return (px, py) if math.hypot(px - x, py - y) <= reach else None
            px, py = px + nx * (deep + 0.06), py + ny * (deep + 0.06)  # (past the edge by more than a decimetre rounds)
        return None


# the room each kind keeps from a band: a lamp post's base, a bench's half length
RADIUS = {"street_lamp": 0.25, "bench": 0.95, "tree": 0.7}


def tidy(props, roads):
    """props: {"bench": [x, y, z, ...], "street_lamp": [...]} in decimetres, moved out of the roads'
    carriageways in place; returns {kind: (moved, dropped)}."""
    cw, out = Carriageways(roads), {}
    for kind, flat in props.items():
        keep, moved, dropped = [], 0, 0
        for i in range(0, len(flat) - 2, 3):
            x, y, z = flat[i] / 10, flat[i + 1] / 10, flat[i + 2] / 10
            q = cw.kerbside(x, y, z, RADIUS.get(kind, 0.25))
            if q is None:
                dropped += 1
                continue
            if q != (x, y):
                moved += 1
                keep += [round(q[0] * 10), round(q[1] * 10), flat[i + 2]]
            else:
                keep += flat[i:i + 3]
        props[kind] = keep
        out[kind] = (moved, dropped)
    return out
