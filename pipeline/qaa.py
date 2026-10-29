"""The water's own optics from optically deep water, independent of the sea floor: Lee's
quasi-analytical algorithm (QAA) and Lee's model of the diffuse attenuation coefficient.

build_marine.py fits Kd from how the brightest floor darkens with depth. That reads a change of
floor type with depth as attenuation (a dark reef flat over a pale sand apron, white cay sand over
darker lagoon floors), and came out higher offshore than in the inner Whitsundays. This derives Kd
from the colour of water too deep to show its floor, so no floor enters it:

1. Rrs: the median Sentinel-2 L2A reflectance of water deeper than 40 m, less the median of the
   near infrared over the same water (water absorbs the near infrared, so what is left there is a
   residual offset of the atmospheric correction or sky glint, taken as spectrally flat), over pi.
   Bands B1 443, B2 492, B3 560, B4 665 nm.
2. QAA_v6: Lee, Z.P., Carder, K.L., Arnone, R.A. (2002), Deriving inherent optical properties from
   water color: a multiband quasi-analytical algorithm for optically deep waters, Applied Optics 41,
   5755-5772; updated as QAA_v6 (Lee et al. 2014), steps and constants as published by the IOCCG,
   https://ioccg.org/wp-content/uploads/2020/11/qaa_v6_202011.pdf :
     rrs = Rrs / (0.52 + 1.7 Rrs)                                 (below the surface)
     u = (-g0 + sqrt(g0^2 + 4 g1 rrs)) / (2 g1),  g0 = 0.089, g1 = 0.1245
     Rrs(670) kept within 0.9 Rrs(555)^1.7 .. 20 Rrs(555)^1.5, else replaced by
       1.27 Rrs(555)^1.47 + 0.00018 (Rrs(490) / Rrs(555))^-3.19
     if Rrs(670) < 0.0015 sr-1 (lambda0 = 560 nm for a MERIS/OLCI-like band, as Sentinel-2 B3):
       chi = log10((rrs443 + rrs490) / (rrs560 + 5 rrs670 / rrs490 * rrs670))
       a(lambda0) = aw(lambda0) + 10^(h0 + h1 chi + h2 chi^2),  h0 = -1.146, h1 = -1.366, h2 = -0.469
     else (lambda0 = 670): a(670) = aw(670) + 0.39 (Rrs670 / (Rrs443 + Rrs490))^1.14
     bbp(lambda0) = u a / (1 - u) - bbw(lambda0)
     eta = 2.0 (1 - 1.2 exp(-0.9 rrs443 / rrs560)),  bbp(l) = bbp(lambda0) (lambda0 / l)^eta
     a(l) = (1 - u(l)) (bbw(l) + bbp(l)) / u(l)
3. Kd: Lee, Z.P., Du, K.P., Arnone, R. (2005), A model for the diffuse attenuation coefficient of
   downwelling irradiance, J. Geophys. Res. 110, C02016, equation 11:
     Kd = (1 + 0.005 theta_s) a + 4.18 (1 - 0.52 exp(-10.8 a)) bb,
   theta_s the solar zenith angle above the surface in degrees (the mean of the imagery's scenes).

Pure water: aw from Pope, R.M., Fry, E.S. (1997), Applied Optics 36, 8710-8723, at 442.5, 492.5, 560
and 665 nm; bbw = 0.0038 (400 / l)^4.32 (Morel 1974, the form Lee uses, as in NASA OBPG's qaa.c).

    python pipeline/qaa.py --city whitsundays      # prints the result, writes cities/<id>/analysis/qaa.json

build_marine.py calls `deep_water_kd()` for every site it builds.
"""
import json
import math
import os

import numpy as np

WAVE = {"coastal": 443, "blue": 492, "green": 560, "red": 665}   # Sentinel-2 B1, B2, B3, B4 (nm)
AW = {443: 0.00696, 492: 0.0162, 560: 0.0619, 665: 0.429}       # Pope & Fry 1997, 1/m
G0, G1 = 0.089, 0.1245
H0, H1, H2 = -1.146, -1.366, -0.469


def bbw(l):
    return 0.0038 * (400.0 / l) ** 4.32


def qaa(Rrs, sun_zenith):
    """Rrs: {443, 492, 560, 665: above-water remote-sensing reflectance, 1/sr}. Returns a, bb and
    Kd per wavelength, plus the reference wavelength, eta and any Rrs(665) replacement."""
    R = dict(Rrs)
    note = []
    lo, hi = 0.9 * R[560] ** 1.7, 20.0 * R[560] ** 1.5
    if not lo <= R[665] <= hi:
        est = 1.27 * R[560] ** 1.47 + 0.00018 * (R[492] / R[560]) ** -3.19
        note.append(f"Rrs(665) {R[665]:.5f} outside {lo:.5f}..{hi:.5f}, replaced by the QAA_v6 estimate {est:.5f}")
        R[665] = est
    rrs = {l: v / (0.52 + 1.7 * v) for l, v in R.items()}
    u = {l: (-G0 + math.sqrt(G0 * G0 + 4 * G1 * r)) / (2 * G1) for l, r in rrs.items()}
    if R[665] < 0.0015:
        l0 = 560
        chi = math.log10((rrs[443] + rrs[492]) / (rrs[560] + 5 * rrs[665] / rrs[492] * rrs[665]))
        a0 = AW[560] + 10 ** (H0 + H1 * chi + H2 * chi * chi)
    else:
        l0 = 665
        a0 = AW[665] + 0.39 * (R[665] / (R[443] + R[492])) ** 1.14
    bbp0 = u[l0] * a0 / (1 - u[l0]) - bbw(l0)
    eta = 2.0 * (1 - 1.2 * math.exp(-0.9 * rrs[443] / rrs[560]))
    out = {"lambda0": l0, "eta": eta, "bbp0": bbp0, "sun_zenith": sun_zenith, "note": note, "band": {}}
    for l in R:
        bb = bbw(l) + bbp0 * (l0 / l) ** eta
        a = (1 - u[l]) * bb / u[l]
        kd = (1 + 0.005 * sun_zenith) * a + 4.18 * (1 - 0.52 * math.exp(-10.8 * a)) * bb
        out["band"][l] = {"Rrs": R[l], "a": a, "bb": bb, "Kd": kd}
    return out


def deep_water_kd(s2, depth, deep_m=40.0):
    """QAA on the median reflectance of water deeper than `deep_m`. s2: the arrays of s2.npz
    (reflectance x 10000), depth: metres on the same grid. Returns the qaa() result with the
    inputs, or None where there is too little deep water or no coastal band."""
    if "coastal" not in s2:
        return None
    ok = (depth > deep_m) & (s2["blue"] > 0) & (s2["coastal"] > 0)
    if ok.sum() < 2000:
        return None
    med = {k: float(np.median(s2[k][ok])) * 1e-4 for k in ("coastal", "blue", "green", "red", "nir")}
    offset = med["nir"]
    Rrs = {WAVE[k]: (med[k] - offset) / math.pi for k in WAVE}
    if min(Rrs.values()) <= 0:
        return None
    sz = float(s2["sun_zenith"]) if "sun_zenith" in s2 and np.isfinite(s2["sun_zenith"]) else 30.0
    r = qaa(Rrs, sz)
    r.update(deep_px=int(ok.sum()), deep_m=deep_m, R_median=med, nir_offset=offset)
    return r


def main():
    from cityctx import city_args
    from rasterio.transform import from_origin
    from rasterio.warp import Resampling
    from build_marine import reproj
    city, _ = city_args("QAA water optics for a marine city, from its raw data")
    s2 = dict(np.load(os.path.join(city.raw, "s2.npz")))
    H, W = s2["blue"].shape
    px = float(s2["pixel_m"])
    z = reproj(os.path.join(city.raw, "bathy.tif"), from_origin(city.x0, city.y1, px, px), (H, W), city.proj,
               Resampling.bilinear, nodata=-9999)
    r = deep_water_kd(s2, np.where(z < -9000, 0, -z))
    if r is None:
        raise SystemExit("not enough deep water, or no coastal band in s2.npz")
    for l, b in r["band"].items():
        print(f"{l} nm  Rrs {b['Rrs']:.5f}  a {b['a']:.4f}  bb {b['bb']:.5f}  Kd {b['Kd']:.4f} /m")
    print("lambda0", r["lambda0"], "eta %.2f" % r["eta"], "sun zenith %.1f" % r["sun_zenith"], "deep px", r["deep_px"],
          "NIR offset %.4f" % r["nir_offset"], *r["note"])
    os.makedirs(city.analysis, exist_ok=True)
    json.dump(r, open(os.path.join(city.analysis, "qaa.json"), "w"), indent=1)


if __name__ == "__main__":
    main()
