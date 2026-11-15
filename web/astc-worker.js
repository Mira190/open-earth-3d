// Open Earth 3D: a picture into ASTC blocks, off the main thread (astc.js, tex.js; issue 443). The page hands over
// a decoded picture (an ImageBitmap) and says how large it may be, whether it is stored upside down for the GPU,
// and whether its colour is sRGB; this draws it at that size, reads its pixels, encodes each mipmap level and hands
// the blocks back. Where the encoder's own count says the picture would lose too much (floor, dB), or there is no
// canvas to read it with, the picture goes back as it came and the page keeps it uncompressed.
'use strict';
importScripts('astc.js');
self.onmessage = e => {
  const { id, bitmap, max, flipY, srgb, mips, floor, alphaFloor } = e.data;
  try {
    const k = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.floor(bitmap.width * k)), h = Math.max(1, Math.floor(bitmap.height * k));
    const cv = new OffscreenCanvas(w, h), g = cv.getContext('2d', { willReadFrequently: true });
    if (flipY) { g.translate(0, h); g.scale(1, -1); } // (blocks cannot be flipped as they are sent: the rows are, here)
    g.drawImage(bitmap, 0, 0, w, h);
    const px = g.getImageData(0, 0, w, h).data, alpha = !self.OEAstc.opaque(px), S = self.OEAstc.stats;
    cv.width = cv.height = 0;
    S.reset();
    const top = self.OEAstc.encode(px, w, h, alpha), db = S.db(), adb = S.alphaDb();
    if (db < floor || (alpha && adb < alphaFloor)) { self.postMessage({ id, keep: true, bitmap, db, adb }, [bitmap]); return; }
    const levels = [{ data: top, width: w, height: h }];
    if (mips) for (let cur = { data: px, width: w, height: h }; cur.width > 1 || cur.height > 1;) {
      cur = self.OEAstc.half(cur.data, cur.width, cur.height, srgb);
      levels.push({ data: self.OEAstc.encode(cur.data, cur.width, cur.height, alpha), width: cur.width, height: cur.height });
    }
    bitmap.close();
    self.postMessage({ id, levels, alpha, db, adb, width: w, height: h }, levels.map(l => l.data.buffer));
  } catch (err) {
    try { self.postMessage({ id, keep: true, bitmap, error: String(err && err.message || err) }, [bitmap]); } catch (e2) { self.postMessage({ id, keep: true, error: String(err && err.message || err) }); }
  }
};
