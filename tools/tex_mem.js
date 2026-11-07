// What the page's textures hold in GPU memory: every 2D texture upload (texImage2D, texStorage2D and the
// compressed calls) is hooked, sized from its format and mip chain, and summed per texture object, so a
// texture uploaded again (or deleted) counts once. Prints the total, the share in block-compressed formats,
// and the largest textures with the image each came from.
//   python3 -m http.server 8800 --directory web &
//   xvfb-run -a node tools/tex_mem.js [title|play-<city>|<city>] [WxH] [settle seconds]
// TIER=low|medium|high (default high). STACK=1 names the script line that made each texture;
// OWNERS=1 (the game) lists which mesh and material holds a texture of each size. JSON=1 prints the result as JSON (tools/check.sh reads none of it).
const { chromium } = require('playwright');
const [,, where = 'title', size = '1440x900', settle = '8'] = process.argv;
const [w, h] = size.split('x').map(Number);
(async () => {
  const b = await chromium.launch(process.env.DISPLAY
    ? { headless: false, args: ['--ignore-gpu-blocklist', '--use-gl=angle', '--use-angle=gl', '--disable-gpu-sandbox'] }
    : { args: ['--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const phone = w < 600;
  const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, hasTouch: phone, isMobile: phone });
  await ctx.addInitScript(t => { try { localStorage.setItem('oe3d-quality', t); } catch (e) { /* storage blocked */ } }, process.env.TIER || 'high');
  await ctx.addInitScript(st => { window.__TEX_STACK = st; }, !!process.env.STACK);
  await ctx.addInitScript(() => {
    // bytes per texel of the uncompressed internal formats WebGL 2 and three.js use; compressed ones by block
    const BPP = { 0x8058: 4, 0x8C43: 4, 0x1908: 4, 0x8051: 3, 0x8C41: 3, 0x1907: 3, 0x8229: 1, 0x1909: 1, 0x1903: 1, 0x822B: 2,
      0x881A: 8, 0x8814: 16, 0x822F: 4, 0x822E: 4, 0x8230: 8, 0x822D: 2, 0x8D62: 2, 0x8056: 2, 0x8057: 2, 0x8C3A: 4, 0x8C3D: 4,
      0x81A5: 2, 0x81A6: 3, 0x88F0: 4, 0x8CAC: 4, 0x8CAD: 8, 0x1902: 4, 0x8D9F: 4, 0x8F94: 4, 0x8059: 4, 0x8236: 4, 0x8235: 4, 0x8234: 2, 0x8233: 1,
      0x8232: 1, 0x8231: 1, 0x823C: 8, 0x823B: 4, 0x823A: 4, 0x8239: 2, 0x8238: 2, 0x8237: 2, 0x8D70: 16, 0x8D76: 16, 0x8D7C: 4, 0x8D82: 16, 0x8D88: 16, 0x8D8E: 4 };
    const HALF = new Set([0x83F0, 0x83F1, 0x8C4C, 0x8C4D, 0x9274, 0x9275, 0x8D64, 0x9270, 0x9271]);
    const live = new Map(); // texture object -> {bytes per level, compressed, label}
    let unit = 0;
    const patch = proto => {
      const active = proto.activeTexture, bind = proto.bindTexture, del = proto.deleteTexture;
      const units = new Map();
      proto.activeTexture = function (u) { unit = u; return active.call(this, u); };
      proto.bindTexture = function (target, tex) { if (target === this.TEXTURE_2D) units.set(unit, tex); return bind.call(this, target, tex); };
      proto.deleteTexture = function (tex) { live.delete(tex); return del.call(this, tex); };
      const cur = () => units.get(unit);
      // where in the page's own scripts a texture was made (the first frame outside three.js)
      const caller = () => {
        if (!window.__TEX_STACK) return '';
        const f = (new Error().stack || '').split('\n').find(l => /\.js/.test(l) && !/vendor\/three|three\.(core|module)/.test(l) && !/__puppeteer|addInitScript|tex_mem/.test(l) && /localhost/.test(l));
        return f ? f.trim().replace(/^at /, '').replace(/https?:\/\/localhost:\d+\//, '') : '';
      };
      const rec = (tex, level, bytes, comp, src, dim) => {
        if (!tex) return;
        let e = live.get(tex);
        if (!e) live.set(tex, e = { levels: {}, comp: false, src: '', at: caller() });
        if (dim) e.dim = dim;
        e.levels[level] = bytes; e.comp = comp;
        if (src) e.src = src;
      };
      const srcOf = a => { for (const x of a) if (x && (x.src || x.currentSrc)) return String(window.__texName(x.src || x.currentSrc)).split('/').slice(-2).join('/'); return ''; };
      const ti = proto.texImage2D;
      proto.texImage2D = function (target, level, ifmt, ...rest) {
        if (target === this.TEXTURE_2D) {
          let wd, ht;
          if (rest.length >= 6) { wd = rest[0]; ht = rest[1]; } else { const s = rest[rest.length - 1]; wd = s.naturalWidth || s.videoWidth || s.width; ht = s.naturalHeight || s.videoHeight || s.height; }
          rec(cur(), level, wd * ht * (BPP[ifmt] || 4), false, srcOf(rest), level ? null : `${wd}x${ht} 0x${ifmt.toString(16)}`);
        }
        return ti.call(this, target, level, ifmt, ...rest);
      };
      const ts = proto.texStorage2D;
      if (ts) proto.texStorage2D = function (target, levels, ifmt, wd, ht) {
        if (target === this.TEXTURE_2D) {
          const comp = !(ifmt in BPP);
          for (let l = 0; l < levels; l++) {
            const lw = Math.max(1, wd >> l), lh = Math.max(1, ht >> l);
            // compressed: 4x4 blocks of 8 bytes (BC1, ETC1, ETC2 RGB) or 16 (BC3, BC7, ASTC 4x4, ETC2 RGBA)
            rec(cur(), l, comp ? Math.ceil(lw / 4) * Math.ceil(lh / 4) * (HALF.has(ifmt) ? 8 : 16) : lw * lh * BPP[ifmt], comp, '', l ? null : `${wd}x${ht}x${levels} 0x${ifmt.toString(16)}`);
          }
        }
        return ts.call(this, target, levels, ifmt, wd, ht);
      };
      const tc = proto.compressedTexImage2D;
      proto.compressedTexImage2D = function (target, level, ifmt, wd, ht, border, data, ...rest) {
        if (target === this.TEXTURE_2D) rec(cur(), level, data && data.byteLength != null ? data.byteLength : Math.ceil(wd / 4) * Math.ceil(ht / 4) * 16, true);
        return tc.call(this, target, level, ifmt, wd, ht, border, data, ...rest);
      };
      const tsi = proto.texSubImage2D;
      proto.texSubImage2D = function (...a) { const e = live.get(cur()); const s = srcOf(a.slice(6)); if (e && s && !e.src) e.src = s; return tsi.apply(this, a); };
      const csi = proto.compressedTexSubImage2D;
      if (csi) proto.compressedTexSubImage2D = function (...a) { const e = live.get(cur()); if (e) { e.comp = true; } return csi.apply(this, a); };
    };
    // blob: URLs (a fetched image handed to an <img>) named after the file they were fetched from
    const named = new Map(), blobUrl = new WeakMap();
    const rb = Response.prototype.blob;
    Response.prototype.blob = function () { const u = this.url; return rb.call(this).then(x => { blobUrl.set(x, u); return x; }); };
    const co = URL.createObjectURL;
    URL.createObjectURL = function (o) { const u = co.call(URL, o); if (blobUrl.has(o)) named.set(u, blobUrl.get(o)); return u; };
    window.__texName = u => named.get(u) || u;
    if (window.WebGL2RenderingContext) patch(WebGL2RenderingContext.prototype);
    patch(WebGLRenderingContext.prototype);
    window.__texMem = () => {
      const rows = [...live.values()].map(e => ({ bytes: Object.values(e.levels).reduce((s, x) => s + x, 0), comp: e.comp, src: e.src, dim: e.dim || '', at: e.at || '' }));
      rows.sort((a, b) => b.bytes - a.bytes);
      const total = rows.reduce((s, r) => s + r.bytes, 0), comp = rows.filter(r => r.comp).reduce((s, r) => s + r.bytes, 0);
      return { total, comp, count: rows.length, top: rows.slice(0, 25) };
    };
  });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', e => errors.push(String(e).slice(0, 300)));
  const port = process.env.PORT || 8800;
  const hash = where === 'title' ? '' : '#' + where;
  await p.goto(`http://localhost:${port}/${hash}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  if (where.startsWith('play-')) await p.waitForFunction('window.__game', null, { timeout: 300000 });
  else await p.waitForFunction('window.__ready', null, { timeout: 300000 }).catch(() => {});
  await p.waitForTimeout(+settle * 1000);
  const r = await p.evaluate(() => window.__texMem());
  // the game's scene: which mesh and material (or uniform) holds a texture of each size, to name the generated ones
  if (process.env.OWNERS && where.startsWith('play-')) {
    const own = await p.evaluate(() => {
      const out = {}, seen = new Set();
      const add = (t, who) => {
        if (!t || !t.isTexture || seen.has(t.uuid + who)) return; seen.add(t.uuid + who);
        const im = t.image || {}, w = im.width || (im.data && im.width), h = im.height;
        const k = `${w}x${h}`; (out[k] = out[k] || []).push(`${who}${t.name ? ' "' + t.name + '"' : ''}${t.isRenderTargetTexture ? ' [target]' : ''}`);
      };
      const g = window.__game, sc = [g.Wd && g.Wd.scene, g.Wd && g.Wd.world, g.scene].find(x => x && x.traverse);
      sc.traverse(o => {
        const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
        for (const m of ms) {
          for (const [key, v] of Object.entries(m)) if (v && v.isTexture) add(v, `${o.name || o.type}.${m.name || m.type}.${key}`);
          if (m.uniforms) for (const [key, u] of Object.entries(m.uniforms)) if (u && u.value && u.value.isTexture) add(u.value, `${o.name || o.type}.${m.name || m.type}.${key}`);
        }
        if (o.shadow && o.shadow.map) add(o.shadow.map.texture, `${o.name || o.type}.shadow`);
      });
      return out;
    });
    for (const [k, v] of Object.entries(own)) console.log('owner', k.padEnd(11), [...new Set(v)].slice(0, 4).join(' | '));
  }
  if (process.env.JSON) console.log(JSON.stringify(r));
  else {
    const mb = x => (x / 1048576).toFixed(1).padStart(7) + ' MB';
    console.log(`${where} ${size} ${process.env.TIER || 'high'}: ${r.count} textures, ${mb(r.total)} in GPU memory, ${mb(r.comp)} of it block-compressed`);
    for (const t of r.top) console.log(`${mb(t.bytes)}  ${t.comp ? 'compressed' : '          '}  ${(t.src || '(generated)').padEnd(28)} ${t.dim.padEnd(22)} ${t.at}`);
  }
  if (errors.length) console.log('page errors:', errors.slice(0, 5).join(' | '));
  await b.close();
})();
