"""Listen to a bounced show (tools/show_bounce.js) with numbers: what an ear would judge, measured.

  python tools/show_listen.py [bounce-dir] [score.json]   (default: data/raw/show, cities/sydney/opera_score.json)

For each sung note of the score it tracks the voice's pitch (YIN, on the voice stem) over the note's middle and
reports how far it sits from the written pitch, and over the long notes the vibrato's rate and extent. Over the
whole it reports the voice's level against the orchestra's while she sings (the balance against the pit), each
vowel's first two formants (LPC on the voice stem, against the alto table show.js sings from), the mix's peak and
loudness, and the brightness (the share of energy over 4 kHz). Exits 1 when a measure is out of its range.
"""
import json
import os
import sys

import numpy as np
from scipy.io import wavfile
from scipy.signal import lfilter

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
VOWELS = {"a": (800, 1150), "e": (400, 1600), "i": (350, 1700), "o": (450, 800), "u": (325, 700)}  # show.js FORMANTS, F1 F2


def load(path):
    rate, x = wavfile.read(path)
    x = x.astype(np.float64) / 32768.0
    return rate, x.mean(axis=1) if x.ndim == 2 else x


def yin(frame, rate, fmin=150.0, fmax=1000.0, thresh=0.12):
    """The fundamental of one frame, Hz, or 0 if unvoiced (de Cheveigné and Kawahara, 2002)."""
    n = len(frame) // 2
    tmax, tmin = min(n - 1, int(rate / fmin)), int(rate / fmax)
    d = np.array([np.sum((frame[:n] - frame[t:t + n]) ** 2) for t in range(tmax + 1)])
    cm = np.ones_like(d)
    cm[1:] = d[1:] * np.arange(1, tmax + 1) / np.maximum(np.cumsum(d[1:]), 1e-12)
    cand = np.where(cm[tmin:] < thresh)[0]
    if not len(cand):
        return 0.0
    t = cand[0] + tmin
    while t + 1 <= tmax and cm[t + 1] < cm[t]:
        t += 1
    if 1 <= t < tmax:  # parabolic interpolation
        a, b, c = cm[t - 1], cm[t], cm[t + 1]
        t = t + 0.5 * (a - c) / max(a - 2 * b + c, 1e-12)
    return rate / t


def track(x, rate, t0, t1, hop=0.01, win=0.04):
    out = []
    w = int(win * rate)
    t = t0
    while t + win < t1:
        i = int(t * rate)
        fr = x[i:i + w]
        out.append((t, yin(fr - fr.mean(), rate) if np.sqrt(np.mean(fr ** 2)) > 1e-3 else 0.0))
        t += hop
    return out


def lpc_formants(seg, rate, order=12):
    """F1 and F2 of a voiced stretch (autocorrelation LPC on a 10 kHz copy)."""
    step = max(1, rate // 10000)
    y = seg[::step]
    sr = rate / step
    y = lfilter([1, -0.63], 1, y) * np.hamming(len(y))
    r = np.correlate(y, y, "full")[len(y) - 1:len(y) + order]
    a, e = np.array([1.0]), r[0]
    for k in range(1, order + 1):  # Levinson-Durbin
        acc = r[k] + np.dot(a[1:], r[k - 1:0:-1])
        g = -acc / e
        a = np.concatenate([a, [0.0]])
        a = a + g * a[::-1]
        e *= 1 - g * g
    roots = [z for z in np.roots(a) if np.imag(z) > 0.01]
    fr = sorted((np.angle(z) * sr / (2 * np.pi), -sr / np.pi * np.log(abs(z))) for z in roots)
    fr = [f for f, bw in fr if f > 200 and bw < 500]
    return fr[:2] if len(fr) >= 2 else None


def main():
    d = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "data", "raw", "show")
    score = json.load(open(sys.argv[2] if len(sys.argv) > 2 else os.path.join(ROOT, "cities", "sydney", "opera_score.json"), encoding="utf8"))
    meta = json.load(open(os.path.join(d, "bounce.json")))
    pre, spb, A4 = meta["pre"], 60 / score.get("bpm", 72), score.get("a_hz", 441)
    rate, voice = load(os.path.join(d, "voice.wav"))
    _, orch = load(os.path.join(d, "orchestra.wav"))
    _, mix = load(os.path.join(d, "mix.wav"))
    sys.path.insert(0, HERE)
    notes = score["melody"]
    bad = []

    # ---- pitch: each note's middle third, against the written pitch
    errs, vib = [], []
    for k, (m, b, beats, syl) in enumerate(notes):
        t0, dur = pre + b * spb, beats * spb
        tr = [f for t, f in track(voice, rate, t0 + dur * 0.33, t0 + dur * 0.67 + 0.04) if f > 0]
        want = A4 * 2 ** ((m - 69) / 12)
        if len(tr) >= 2:
            cents = 1200 * np.log2(np.median(tr) / want)
            errs.append((k, m, syl, cents))
        if dur > 0.6:  # vibrato over the held part of a long note
            tr = track(voice, rate, t0 + 0.3, t0 + dur - 0.08, hop=0.005)
            f = np.array([q for _, q in tr])
            if len(f) > 40 and (f > 0).all():
                c = 1200 * np.log2(f / np.median(f))
                core = c - np.polyval(np.polyfit(np.arange(len(c)), c, 1), np.arange(len(c)))  # (less the note's slow drift)
                zc = np.sum(np.diff(np.sign(core)) != 0) / 2 / (len(core) * 0.005)
                vib.append((syl, float(np.percentile(core, 95) - np.percentile(core, 5)) / 2, float(zc)))
    e = np.array([c for *_, c in errs])
    worst = sorted(errs, key=lambda q: -abs(q[3]))[:5]
    print(f"pitch: {len(errs)}/{len(notes)} notes tracked, median error {np.median(np.abs(e)):.1f} cents, worst " +
          ", ".join(f"{s} ({m}) {c:+.0f}" for _, m, s, c in worst))
    if np.median(np.abs(e)) > 15 or max(abs(e)) > 60:
        bad.append("pitch")
    if vib:
        ext, rt = np.median([v[1] for v in vib]), np.median([v[2] for v in vib])
        print(f"vibrato: {len(vib)} long notes, extent ±{ext:.0f} cents at {rt:.1f} Hz (a trained voice: ±50 to 100 cents at 5 to 7 Hz)")
        if not (35 <= ext <= 110 and 4.5 <= rt <= 7.5):
            bad.append("vibrato")

    # ---- the balance: the voice's level over the orchestra's while she sings
    first, last = pre + notes[0][1] * spb, pre + (notes[-1][1] + notes[-1][2]) * spb
    i0, i1 = int(first * rate), int(last * rate)
    rms = lambda y: np.sqrt(np.mean(y ** 2)) + 1e-12
    bal = 20 * np.log10(rms(voice[i0:i1]) / rms(orch[i0:i1]))
    print(f"balance: the voice {bal:+.1f} dB over the orchestra while she sings (opera in the stalls: about +4 to +10)")
    if not (3 <= bal <= 12):
        bad.append("balance")

    # ---- the chorus, where there is one: over the pit while it sings (pp, but it carries the tune), under her
    if score.get("chorus") and os.path.exists(os.path.join(d, "chorus.wav")):
        _, cho = load(os.path.join(d, "chorus.wav"))
        ch = score["chorus"]
        spans = [(int((pre + n[1] * spb) * rate), int((pre + (n[1] + n[2]) * spb) * rate)) for n in ch]
        cat = lambda y: np.concatenate([y[a:b] for a, b in spans])
        cb = 20 * np.log10(rms(cat(cho)) / rms(cat(orch)))
        cv = 20 * np.log10(rms(cat(cho)) / rms(voice[i0:i1]))
        print(f"chorus: {cb:+.1f} dB over the orchestra while it sings, {cv:+.1f} dB against her voice (want about 0 to +6, and under her)")
        if not (-1 <= cb <= 8 and cv < 0):
            bad.append("chorus")

    # ---- vowels: F1 and F2 over the middle of each long enough note, by the vowel show.js sings it on
    try:
        from subprocess import run
        vow = run(["node", "-e", "global.window={};require(process.argv[1]);process.stdout.write(JSON.stringify(process.argv.slice(2).map(s=>window.OEShow.vowelOf(s))))",
                   os.path.join(ROOT, "web", "game", "show.js")] + [n[3] for n in notes], capture_output=True, text=True).stdout
        vow = json.loads(vow)
    except Exception:
        vow = None
    if vow:
        got = {}
        for (m, b, beats, syl), v in zip(notes, vow):
            if syl == "-" or beats * spb < 0.3:
                continue
            t0, dur = pre + b * spb, beats * spb
            seg = voice[int((t0 + dur * 0.3) * rate):int((t0 + dur * 0.7) * rate)]
            f = lpc_formants(seg, rate)
            if f:
                got.setdefault(v, []).append(f)
        print("vowels (F1, F2 measured / the table's): " + ", ".join(
            f"{v} {np.median([q[0] for q in fs]):.0f}, {np.median([q[1] for q in fs]):.0f} / {VOWELS[v][0]}, {VOWELS[v][1]} (n={len(fs)})" for v, fs in sorted(got.items())))

    # ---- the mix
    peak = 20 * np.log10(np.max(np.abs(mix)) + 1e-12)
    loud = 20 * np.log10(rms(mix[i0:i1]))
    spec = np.abs(np.fft.rfft(mix[i0:i0 + rate * 20])) ** 2
    fq = np.fft.rfftfreq(rate * 20, 1 / rate)
    hi = spec[fq > 4000].sum() / spec.sum()
    print(f"mix: peak {peak:.1f} dBFS, {loud:.1f} dB RMS while she sings, {100 * hi:.1f}% of the energy over 4 kHz")
    if peak > -3 or loud < -30 or hi > 0.08:
        bad.append("mix")
    print("OK" if not bad else "OUT OF RANGE: " + ", ".join(bad))
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
