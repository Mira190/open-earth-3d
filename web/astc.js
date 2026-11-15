// Open Earth 3D: pictures block-compressed on the device (issue 443). An RGBA8 texture is four bytes a texel on the
// GPU, and on an iPhone the GPU's memory is charged to the tab. ASTC 4x4 is one byte a texel, and every iPhone
// decodes it (so do most Android phones). The pictures stay the files they are (WebP, AVIF, JPEG: the download does
// not grow, which shipping them as KTX2 would cost, docs/PERFORMANCE.md); a Worker (astc-worker.js) encodes each one
// after it is decoded, with its mipmaps, and the page hands the GPU the blocks instead of the pixels.
//
// The encoder writes two of ASTC's block layouts, both one partition and a 4x4 grid of weights:
//   opaque   endpoints RGB, 8 bits a channel (CEM 8), one 3-bit weight a texel (8 steps between the endpoints):
//            17 header bits + 48 of endpoints + 48 of weights
//   alpha    endpoints RGBA (CEM 12), two planes of 2-bit weights, the second for alpha alone, so that a cut-out's
//            edge does not have to follow its colour: 17 + 45 of endpoints + 2 (which channel has the second plane)
//            + 64 of weights. 45 bits hold eight endpoint values of 48 levels each, packed as ASTC packs them: four
//            bits and a trit a value, five trits to eight bits (TRITS, built from the decoding rule).
// A block of a picture with alpha that has none in it takes the opaque layout: each block names its own. A block's
// endpoints are the ends of its texels' principal axis, refined once by least squares against the weights chosen,
// as in BC1 and BC7 single-subset encoders; the quality is between BC1's and BC7's (36 to 48 dB on this project's
// pictures, tools/astc_check.js, which decodes them on a real decoder). No code was taken: the layout is the
// Khronos data format specification's (ASTC: block mode, integer sequence encoding, endpoint unquantization), the
// method the textbook one.
//
// OEAstc.encode(rgba, w, h, alpha) -> Uint8Array of ceil(w/4) * ceil(h/4) blocks of 16 bytes
// OEAstc.mips(rgba, w, h, alpha, srgb) -> [{ data, width, height }, ...] down to 1x1, each level box-filtered from
//   the one above (in linear light when srgb), as the GPU's own mipmaps of an sRGB texture are
// OEAstc.opaque(rgba) -> whether every alpha is 255
// OEAstc.stats: the error of what encode() and mips() wrote since stats.reset(): stats.db(), stats.alphaDb()
(function (root) {
  'use strict';
  // a 3-bit weight w stands for W3[w] / 64 of the way from the first endpoint to the second; a 2-bit one for W2[w]
  const W3 = [0, 9, 18, 27, 37, 46, 55, 64], W2 = [0, 21, 43, 64];
  const px = new Float32Array(64), wsel = new Uint8Array(16);

  // the block mode (bits 0-10): a 4x4 grid (A = 2 at bits 5-6, B = 0), one plane, the weights' range by R (bits
  // 4, 1, 0): 0..7 is R = 7, 0..3 is R = 4
  const MODE3 = 0x53, MODE2 = 0x42, DUAL = 1 << 10;
  // An endpoint value of 48 levels is four bits (dcba) and a trit D; it stands for U48[D * 16 + bits] of 255, by the
  // specification's rule (not in order: the levels interleave). Q48[v] is the level nearest v.
  const U48 = new Uint8Array(48), Q48 = new Uint8Array(256);
  for (let i = 0; i < 48; i++) {
    const m = i & 15, D = i >> 4, a = m & 1, b = (m >> 1) & 1, c = (m >> 2) & 1, d = (m >> 3) & 1;
    const A = a ? 0x1FF : 0, B = (d << 8) | (c << 7) | (b << 6) | (d << 2) | (c << 1) | b;
    const T = (D * 22 + B) ^ A;
    U48[i] = (A & 0x80) | (T >> 2);
  }
  for (let v = 0; v < 256; v++) { let best = 0; for (let i = 1; i < 48; i++) if (Math.abs(U48[i] - v) < Math.abs(U48[best] - v)) best = i; Q48[v] = best; }
  // five trits as eight bits: TRITS[t0 + 3 t1 + 9 t2 + 27 t3 + 81 t4], from the rule a decoder unpacks them by
  const TRITS = new Uint8Array(243).fill(255);
  for (let T = 255; T >= 0; T--) {
    let C, t0, t1, t2, t3, t4;
    if (((T >> 2) & 7) === 7) { C = ((T >> 5) << 2) | (T & 3); t4 = t3 = 2; }
    else { C = T & 31; if (((T >> 5) & 3) === 3) { t4 = 2; t3 = T >> 7; } else { t4 = T >> 7; t3 = (T >> 5) & 3; } }
    if ((C & 3) === 3) { t2 = 2; t1 = C >> 4; t0 = (((C >> 3) & 1) << 1) | (((C >> 2) & 1) & ~((C >> 3) & 1)); }
    else if (((C >> 2) & 3) === 3) { t2 = 2; t1 = 2; t0 = C & 3; }
    else { t2 = C >> 4; t1 = (C >> 2) & 3; t0 = (((C >> 1) & 1) << 1) | ((C & 1) & ~((C >> 1) & 1)); }
    TRITS[t0 + 3 * t1 + 9 * t2 + 27 * t3 + 81 * t4] = T;
  }
  const vq = new Uint8Array(8), wa = new Uint8Array(16), show = new Uint8Array(16);

  // the error of what was encoded since reset(): se, the colour's squared error (weighted by alpha where a block
  // has any), over n texels' worth; sa, the alpha's, over texels. db() is the colour's peak signal to noise, and
  // alphaDb() the alpha's (99 where there is no error)
  const stats = { se: 0, sa: 0, n: 0, texels: 0,
    reset() { this.se = this.sa = this.n = this.texels = 0; },
    db() { return this.se > 0 ? 10 * Math.log10(255 * 255 / (this.se / (3 * Math.max(1, this.n)))) : 99; },
    alphaDb() { return this.sa > 0 ? 10 * Math.log10(255 * 255 / (this.sa / Math.max(1, this.texels))) : 99; } };
  const m = new Float64Array(4), e0 = new Float64Array(4), e1 = new Float64Array(4), d = new Float64Array(4), sa = new Float64Array(4), sb = new Float64Array(4);
  function block(src, w, h, bx, by, alpha, out, o) {
    // the block's texels (the edge's repeated past it), their mean and covariance
    let n = 0, solid = true;
    m[0] = m[1] = m[2] = m[3] = 0;
    for (let y = 0; y < 4; y++) {
      const sy = Math.min(h - 1, by + y) * w;
      for (let x = 0; x < 4; x++) {
        const i = 4 * (sy + Math.min(w - 1, bx + x));
        px[n] = src[i]; px[n + 1] = src[i + 1]; px[n + 2] = src[i + 2]; px[n + 3] = src[i + 3];
        m[0] += px[n]; m[1] += px[n + 1]; m[2] += px[n + 2]; m[3] += px[n + 3];
        if (src[i + 3] !== 255) solid = false;
        n += 4;
      }
    }
    // (a block with no alpha in it takes the opaque layout, the finer one, in a picture that has alpha elsewhere:
    // each block names its own layout, so a cut-out's inside is as sharp as an opaque picture and only its edge is coarser)
    if (solid) alpha = false;
    const C = 3;
    if (alpha) {
      // what is cut away has no colour of its own (whatever the file holds there is never seen): it takes the mean
      // of the block's texels that show, by how much they show, so the endpoints are spent on those
      let wr = 0, wg = 0, wb = 0, ws = 0;
      for (let k = 0; k < 64; k += 4) { const a = px[k + 3]; wr += px[k] * a; wg += px[k + 1] * a; wb += px[k + 2] * a; ws += a; }
      if (ws > 0) { wr /= ws; wg /= ws; wb /= ws; }
      m[0] = m[1] = m[2] = 0;
      for (let k = 0; k < 64; k += 4) {
        if (px[k + 3] < 8) { px[k] = wr; px[k + 1] = wg; px[k + 2] = wb; show[k >> 2] = 0; } else show[k >> 2] = 1;
        m[0] += px[k]; m[1] += px[k + 1]; m[2] += px[k + 2];
      }
    }
    m[0] /= 16; m[1] /= 16; m[2] /= 16; m[3] /= 16;
    const dual = alpha;
    alpha = false; // (the colour's axis is found in red, green and blue either way: alpha, where there is any, has its own plane)
    let c00 = 0, c01 = 0, c02 = 0, c03 = 0, c11 = 0, c12 = 0, c13 = 0, c22 = 0, c23 = 0, c33 = 0;
    for (let k = 0; k < 64; k += 4) {
      const r = px[k] - m[0], g = px[k + 1] - m[1], b = px[k + 2] - m[2], a = alpha ? px[k + 3] - m[3] : 0;
      c00 += r * r; c01 += r * g; c02 += r * b; c03 += r * a; c11 += g * g; c12 += g * b; c13 += g * a; c22 += b * b; c23 += b * a; c33 += a * a;
    }
    // the principal axis by power iteration, from the diagonal
    let ax = c00 + c01 + c02 + c03, ay = c01 + c11 + c12 + c13, az = c02 + c12 + c22 + c23, aw = c03 + c13 + c23 + c33;
    if (ax * ax + ay * ay + az * az + aw * aw < 1e-6) { ax = 1; ay = 1; az = 1; aw = alpha ? 1 : 0; }
    for (let it = 0; it < 4; it++) {
      const x = c00 * ax + c01 * ay + c02 * az + c03 * aw, y = c01 * ax + c11 * ay + c12 * az + c13 * aw, z = c02 * ax + c12 * ay + c22 * az + c23 * aw, q = c03 * ax + c13 * ay + c23 * az + c33 * aw;
      const l = Math.sqrt(x * x + y * y + z * z + q * q);
      if (l < 1e-9) break;
      ax = x / l; ay = y / l; az = z / l; aw = q / l;
    }
    const al = Math.sqrt(ax * ax + ay * ay + az * az + aw * aw) || 1;
    ax /= al; ay /= al; az /= al; aw /= al;
    let lo = Infinity, hi = -Infinity;
    for (let k = 0; k < 64; k += 4) {
      const t = (px[k] - m[0]) * ax + (px[k + 1] - m[1]) * ay + (px[k + 2] - m[2]) * az + (alpha ? (px[k + 3] - m[3]) * aw : 0);
      if (t < lo) lo = t;
      if (t > hi) hi = t;
    }
    e0[0] = m[0] + ax * lo; e0[1] = m[1] + ay * lo; e0[2] = m[2] + az * lo; e0[3] = m[3] + aw * lo;
    e1[0] = m[0] + ax * hi; e1[1] = m[1] + ay * hi; e1[2] = m[2] + az * hi; e1[3] = m[3] + aw * hi;
    const WT = dual ? W2 : W3, L = WT.length;
    // weights against the endpoints as they will be stored, then the endpoints once more by least squares
    for (let pass = 0; pass < 2; pass++) {
      for (let c = 0; c < C; c++) {
        const u = e0[c], v = e1[c];
        e0[c] = u < 0 ? 0 : u > 255 ? 255 : Math.round(u); e1[c] = v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
        if (dual) { e0[c] = U48[Q48[e0[c]]]; e1[c] = U48[Q48[e1[c]]]; } // (as they will be stored: 48 levels)
      }
      let dd = 0;
      for (let c = 0; c < C; c++) { d[c] = e1[c] - e0[c]; dd += d[c] * d[c]; sa[c] = sb[c] = 0; }
      let saa = 0, sab = 0, sbb = 0;
      const k64 = dd > 0 ? 64 / dd : 0, top = L - 1;
      for (let k = 0, i = 0; k < 64; k += 4, i++) {
        let t = 0;
        for (let c = 0; c < C; c++) t += (px[k + c] - e0[c]) * d[c];
        t *= k64;
        // the nearest of the weight's steps (they are all but evenly spaced: the step by rounding, then its neighbours)
        let best = Math.round(t * top / 64);
        best = best < 0 ? 0 : best > top ? top : best;
        if (best > 0 && Math.abs(WT[best - 1] - t) < Math.abs(WT[best] - t)) best--;
        else if (best < top && Math.abs(WT[best + 1] - t) < Math.abs(WT[best] - t)) best++;
        wsel[i] = best;
        if (dual && !show[i]) continue; // (cut away: it takes whatever weight, and has no say in the endpoints)
        const b = WT[best] / 64, a = 1 - b;
        saa += a * a; sab += a * b; sbb += b * b;
        for (let c = 0; c < C; c++) { sa[c] += a * px[k + c]; sb[c] += b * px[k + c]; }
      }
      if (pass) break;
      const det = saa * sbb - sab * sab;
      if (det < 1e-4) break; // (every texel on one step: the endpoints stay)
      for (let c = 0; c < C; c++) { e0[c] = (sa[c] * sbb - sb[c] * sab) / det; e1[c] = (sb[c] * saa - sa[c] * sab) / det; }
    }
    // alpha on its own plane: its endpoints the least and the most in the block, a 2-bit weight a texel
    let a0 = 255, a1 = 255;
    if (dual) {
      let lo8 = 255, hi8 = 0;
      for (let k = 3; k < 64; k += 4) { if (px[k] < lo8) lo8 = px[k]; if (px[k] > hi8) hi8 = px[k]; }
      a0 = U48[Q48[lo8]]; a1 = U48[Q48[hi8]];
      const da = a1 - a0;
      for (let k = 3, i = 0; k < 64; k += 4, i++) {
        const t = da ? (px[k] - a0) / da * 64 : 0;
        let best = Math.round(t * 3 / 64);
        best = best < 0 ? 0 : best > 3 ? 3 : best;
        wa[i] = best;
      }
    }
    // what the block will decode to, against what it was given: summed for the caller (stats), colour by how much shows
    for (let k = 0, i = 0; k < 64; k += 4, i++) {
      const f = WT[wsel[i]] / 64, sh = dual ? px[k + 3] / 255 : 1;
      for (let c = 0; c < 3; c++) { const v = e0[c] + (e1[c] - e0[c]) * f - px[k + c]; stats.se += v * v * sh; }
      if (dual) { const v = a0 + (a1 - a0) * W2[wa[i]] / 64 - px[k + 3]; stats.sa += v * v; }
      stats.n += sh;
    }
    stats.texels += 16;
    // the second endpoint's red, green and blue must sum to no less than the first's: otherwise a decoder swaps
    // them and applies "blue contraction", another encoding
    if (e1[0] + e1[1] + e1[2] < e0[0] + e0[1] + e0[2]) {
      for (let c = 0; c < C; c++) { const t = e0[c]; e0[c] = e1[c]; e1[c] = t; }
      for (let i = 0; i < 16; i++) wsel[i] = L - 1 - wsel[i];
    }
    // ---- the 128 bits, least significant first: mode (11), partitions - 1 (2), endpoint mode (4), the endpoints
    // (red 0, red 1, green 0, green 1, blue 0, blue 1, and alpha 0, alpha 1); the weights from the top of the
    // block downwards, each weight's bits in turn, bit-reversed
    if (!dual) {
      // (the header's 17 bits are the low 17 of head; each endpoint byte then straddles two of the block's, a bit along)
      const head = MODE3 | (8 << 13);
      out[o] = head & 255; out[o + 1] = (head >> 8) & 255;
      let carry = (head >> 16) & 1, at = o + 2;
      for (let c = 0; c < 3; c++) {
        const a8 = e0[c], b8 = e1[c];
        out[at++] = carry | ((a8 << 1) & 255); carry = a8 >> 7;
        out[at++] = carry | ((b8 << 1) & 255); carry = b8 >> 7;
      }
      out[at++] = carry;
      while (at < o + 16) out[at++] = 0;
      for (let i = 0; i < 16; i++) for (let j = 0; j < 3; j++) if ((wsel[i] >> j) & 1) { const p = 127 - (i * 3 + j); out[o + (p >> 3)] |= 1 << (p & 7); }
      return;
    }
    for (let k = 0; k < 16; k++) out[o + k] = 0;
    let bit = 0;
    const put = (v, bits) => { for (let j = 0; j < bits; j++, bit++) if ((v >> j) & 1) out[o + (bit >> 3)] |= 1 << (bit & 7); };
    put(MODE2 | DUAL, 11); put(0, 2); put(12, 4);
    for (let c = 0; c < 3; c++) { vq[2 * c] = Q48[e0[c]]; vq[2 * c + 1] = Q48[e1[c]]; }
    vq[6] = Q48[a0]; vq[7] = Q48[a1];
    // eight values of 48 levels: four bits each and a trit, the trits of five values in eight bits spread between them
    const T1 = TRITS[(vq[0] >> 4) + 3 * (vq[1] >> 4) + 9 * (vq[2] >> 4) + 27 * (vq[3] >> 4) + 81 * (vq[4] >> 4)], T2 = TRITS[(vq[5] >> 4) + 3 * (vq[6] >> 4) + 9 * (vq[7] >> 4)];
    put(vq[0] & 15, 4); put(T1 & 3, 2); put(vq[1] & 15, 4); put((T1 >> 2) & 3, 2); put(vq[2] & 15, 4); put((T1 >> 4) & 1, 1); put(vq[3] & 15, 4); put((T1 >> 5) & 3, 2); put(vq[4] & 15, 4); put(T1 >> 7, 1);
    put(vq[5] & 15, 4); put(T2 & 3, 2); put(vq[6] & 15, 4); put((T2 >> 2) & 3, 2); put(vq[7] & 15, 4); put((T2 >> 4) & 1, 1);
    put(3, 2); // (bits 62 and 63, under the weights: the second plane is alpha's)
    for (let i = 0; i < 16; i++) {
      const v = wsel[i] | (wa[i] << 2); // (a texel's colour weight, then its alpha weight)
      for (let j = 0; j < 4; j++) if ((v >> j) & 1) { const p = 127 - (i * 4 + j); out[o + (p >> 3)] |= 1 << (p & 7); }
    }
  }

  function encode(rgba, w, h, alpha = false) {
    const bw = (w + 3) >> 2, bh = (h + 3) >> 2, out = new Uint8Array(bw * bh * 16);
    for (let j = 0, o = 0; j < bh; j++) for (let i = 0; i < bw; i++, o += 16) block(rgba, w, h, i * 4, j * 4, alpha, out, o);
    return out;
  }

  function opaque(rgba) {
    for (let i = 3; i < rgba.length; i += 4) if (rgba[i] !== 255) return false;
    return true;
  }

  // the next level down: each texel the mean of the two by two above it (the last row or column alone where the
  // size is odd), colour in linear light when srgb
  let TO = null, FROM = null;
  function half(src, w, h, srgb) {
    const nw = Math.max(1, w >> 1), nh = Math.max(1, h >> 1), out = new Uint8ClampedArray(nw * nh * 4);
    if (srgb && !TO) {
      TO = new Float32Array(256);
      for (let i = 0; i < 256; i++) { const c = i / 255; TO[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
      FROM = new Uint8Array(4097);
      for (let i = 0; i <= 4096; i++) { const c = i / 4096; FROM[i] = Math.round(255 * (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055)); }
    }
    for (let y = 0; y < nh; y++) {
      const y0 = Math.min(h - 1, 2 * y) * w, y1 = Math.min(h - 1, 2 * y + 1) * w;
      for (let x = 0; x < nw; x++) {
        const x0 = Math.min(w - 1, 2 * x), x1 = Math.min(w - 1, 2 * x + 1), a = 4 * (y0 + x0), b = 4 * (y0 + x1), c = 4 * (y1 + x0), d = 4 * (y1 + x1), o = 4 * (y * nw + x);
        if (srgb) for (let k = 0; k < 3; k++) out[o + k] = FROM[Math.round((TO[src[a + k]] + TO[src[b + k]] + TO[src[c + k]] + TO[src[d + k]]) * 1024)];
        else for (let k = 0; k < 3; k++) out[o + k] = (src[a + k] + src[b + k] + src[c + k] + src[d + k] + 2) >> 2;
        out[o + 3] = (src[a + 3] + src[b + 3] + src[c + 3] + src[d + 3] + 2) >> 2;
      }
    }
    return { data: out, width: nw, height: nh };
  }

  function mips(rgba, w, h, alpha = false, srgb = true, levels = true) {
    const out = [];
    let cur = { data: rgba, width: w, height: h };
    for (;;) {
      out.push({ data: encode(cur.data, cur.width, cur.height, alpha), width: cur.width, height: cur.height });
      if (!levels || (cur.width === 1 && cur.height === 1)) break;
      cur = half(cur.data, cur.width, cur.height, srgb);
    }
    return out;
  }

  const api = { encode, mips, opaque, half, stats, W3, W2 };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.OEAstc = api;
})(typeof self !== 'undefined' ? self : globalThis);
