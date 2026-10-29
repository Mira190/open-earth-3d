"""The tide for a marine city, from the official predictions of Maritime Safety Queensland.

Maritime Safety Queensland publishes predicted water levels at its tide gauges every 10 minutes,
a year at a time, on the Queensland Government open data portal (CC BY 4.0). This reads them
through the portal's datastore API, then fits the tidal harmonic constituents to each year, so
the viewer can compute the tide for any moment from a few numbers instead of a year of samples:

    h(t) = Z0 + sum_i A_i cos(w_i t - g_i)        (t in hours from the start of the year, AEST)

The fit is checked against the predictions it came from (RMS and largest error, in the output),
so the tide in the viewer is MSQ's tide to within those centimetres. Heights are converted from
the gauge datum to mean sea level by subtracting the year's mean (Z0), because the terrain is in
m MSL. A year outside the fitted ones uses the nearest fitted year: the 18.6-year nodal cycle then
adds an error of roughly a centimetre per year of distance.

city.json:  "tide": {"gauge": "Shute Harbour", "years": {"2026": "<resource id>", ...}, "note": "..."}

    python pipeline/fetch_tide.py --city whitsundays

writes web/data/<id>/tide.json.
"""
import json
import os
from datetime import datetime, timedelta, timezone

import numpy as np
import requests

from cityctx import city_args

API = "https://www.data.qld.gov.au/api/3/action/datastore_search"
AEST = timezone(timedelta(hours=10))   # Queensland keeps standard time all year
# constituent speeds in degrees per mean solar hour, from the Doodson arguments
# (tau 14.4920521, s 0.5490165, h 0.0410686, p 0.0046418): the 37 NOAA uses at its stations
SPEEDS = {
    "M2": 28.9841042, "S2": 30.0, "N2": 28.4397295, "K1": 15.0410686, "M4": 57.9682084, "O1": 13.9430356,
    "M6": 86.9523127, "MK3": 44.0251729, "S4": 60.0, "MN4": 57.4238337, "NU2": 28.5125831, "S6": 90.0,
    "MU2": 27.9682084, "2N2": 27.8953548, "OO1": 16.1391017, "LAM2": 29.4556253, "S1": 15.0, "M1": 14.4966939,
    "J1": 15.5854433, "MM": 0.5443747, "SSA": 0.0821373, "SA": 0.0410686, "MSF": 1.0158958, "MF": 1.0980331,
    "RHO": 13.4715145, "Q1": 13.3986609, "T2": 29.9589333, "R2": 30.0410667, "2Q1": 12.8542862, "P1": 14.9589314,
    "2SM2": 31.0158958, "M3": 43.4761563, "L2": 29.5284789, "2MK3": 42.9271398, "K2": 30.0821373, "M8": 115.9364166,
    "MS4": 58.9841042,
    # and the shallow-water and minor diurnal ones a year of 10-minute data still separates
    "EPS2": 27.4238337, "MKS2": 29.0662415, "MSN2": 30.5443747, "ETA2": 30.6265120, "SO3": 43.9430356, "SK3": 45.0410686,
    "MK4": 59.0662415, "SN4": 58.4397295, "SK4": 60.0821373, "2MN6": 86.4079380, "2MS6": 87.9682084, "2SM6": 88.9841042,
    "MSK6": 89.0662415, "3MK7": 101.9112728, "SIG1": 12.9271398, "THE1": 15.5125897, "CHI1": 14.5695476, "PI1": 14.9178647,
    "PHI1": 15.1232059, "PSI1": 15.0821353, "SO1": 16.0569644, "MSM": 0.4715211, "2MK5": 73.0092753,
}


def fetch(resource):
    """All rows of one year's resource: (datetime AEST, height m above the gauge datum)."""
    rows, off = [], 0
    while True:
        r = requests.get(API, params={"resource_id": resource, "limit": 32000, "offset": off}, timeout=120)
        r.raise_for_status()
        rec = r.json()["result"]["records"]
        if not rec:
            break
        rows += rec
        off += len(rec)
    out = []
    for x in rows:
        try:
            t = datetime.strptime(f"{x['Date'].strip()} {x['Time'].strip()}", "%d/%m/%Y %H:%M").replace(tzinfo=AEST)
            out.append((t, float(x["Reading"])))
        except (KeyError, ValueError):
            continue
    out.sort()
    return out


def fit(samples, year):
    t0 = datetime(int(year), 1, 1, tzinfo=AEST)
    t = np.array([(s[0] - t0).total_seconds() / 3600 for s in samples])
    h = np.array([s[1] for s in samples])
    names = list(SPEEDS)
    w = np.radians([SPEEDS[n] for n in names])
    A = np.column_stack([np.ones_like(t)] + [f(wi * t) for wi in w for f in (np.cos, np.sin)])
    coef, *_ = np.linalg.lstsq(A, h, rcond=None)
    res = h - A @ coef
    z0, ab = coef[0], coef[1:].reshape(-1, 2)
    amp, ph = np.hypot(ab[:, 0], ab[:, 1]), np.degrees(np.arctan2(ab[:, 1], ab[:, 0])) % 360
    cons = sorted(([n, SPEEDS[n], round(float(a), 4), round(float(g), 2)] for n, a, g in zip(names, amp, ph) if a >= 0.002),
                  key=lambda c: -c[2])
    return {"t0": t0.isoformat(), "z0": round(float(z0), 4), "n": len(h),
            "check": {"rms_m": round(float(np.sqrt(np.mean(res ** 2))), 4), "max_m": round(float(np.abs(res).max()), 4),
                      "low_m": round(float(h.min() - z0), 3), "high_m": round(float(h.max() - z0), 3)},
            "constituents": cons}


def main():
    city, _ = city_args("Fit the tide from MSQ predictions for a marine city")
    cfg = city.cfg.get("tide")
    if not cfg:
        raise SystemExit(f"{city.id}: no 'tide' block in city.json")
    out = {"gauge": cfg["gauge"], "note": cfg.get("note", ""), "datum": "m above mean sea level (the year's mean of the predictions)",
           "time": "hours from the start of the year in AEST (UTC+10)",
           "source": f"Maritime Safety Queensland, {cfg['gauge']} tide gauge predicted interval data (CC BY 4.0), "
                     "Queensland Government open data portal, read through the datastore API", "years": {}}
    for year, res in sorted(cfg["years"].items()):
        s = fetch(res)
        f = fit(s, year)
        out["years"][year] = f
        print(f"{city.id} {year}: {f['n']} samples, Z0 {f['z0']:.3f} m above the gauge datum, range {f['check']['low_m']:+.2f} to "
              f"{f['check']['high_m']:+.2f} m about MSL, fit RMS {100 * f['check']['rms_m']:.1f} cm, max {100 * f['check']['max_m']:.1f} cm")
        print("   ", ", ".join(f"{c[0]} {c[2]:.3f} m {c[3]:.0f}°" for c in f["constituents"][:8]))
    os.makedirs(city.out, exist_ok=True)
    json.dump(out, open(os.path.join(city.out, "tide.json"), "w"), indent=1)


if __name__ == "__main__":
    main()
