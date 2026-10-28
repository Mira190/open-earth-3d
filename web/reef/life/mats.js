// Materials for the living things. All are node materials: the scene's fogNode (env.medium) dims,
// absorbs and veils them like everything else, so albedos here are the animals' and corals' own
// colours in air. Red goes first with depth (Kd ~0.4 /m at 665 nm), so a red-brown coral turns olive
// at 5 m and a blue clam mantle still glows at 10 m: that is the water, not the palette.
import * as THREE from 'three/webgpu';
import { Fn, float, vec2, vec3, vec4, mix, max, min, abs, sin, cos, exp, pow, length, smoothstep, clamp, select, fract, floor, atan,
  positionGeometry, positionWorld, mx_noise_float, mx_worley_noise_float, uniform, dot, normalize } from 'three/tsl';
import { I, pose } from './kit.js';

export function createMats(env, torch) {
  const u = env.u, T = u.time, { A, B, C, D, aux } = I;
  const pg = positionGeometry;
  const n3 = (p, f) => mx_noise_float(p.mul(f));
  // the swell's orbital surge reaches the floor: soft things lean back and forth along the waves' path
  const sw = env.waves.filter(w => w.disp).sort((a, b) => b.lam - a.lam)[0];
  const surge = (w, amp, k = 1) => {
    const depthF = exp(max(u.tide.sub(w.y), 0).div(-7));
    const ph = T.mul(0.9 * k).add(B.w).add(w.x.mul(sw.dx * 0.12)).add(w.z.mul(sw.dz * 0.12));
    const s = sin(ph).mul(0.8).add(sin(ph.mul(2.3).add(1.7)).mul(0.25));
    return vec3(s.mul(sw.dx), 0, s.mul(sw.dz)).mul(amp).mul(depthF).mul(u.wind.mul(0.6).add(0.4));
  };
  const finish = (m, col, o = {}) => {
    m.colorNode = col;
    m.emissiveNode = o.glow ? torch.light(col).add(o.glow) : torch.light(col);
    if (o.rough) m.roughnessNode = o.rough;
    return m;
  };
  const std = (o = {}) => new THREE.MeshStandardNodeMaterial({ roughness: o.rough ?? 0.85, metalness: 0, side: o.side ?? THREE.FrontSide });

  // ---------------------------------------------------------------- corals and the reef floor
  const coral = {};
  // Acropora: base colour to a paler or brighter tip (iC -> iD by aux.x), polyp speckle
  coral.branching = (() => {
    const m = pose(std({ rough: 0.8 }), { squash: vec3(1, C.w, 1) });
    const c = Fn(() => {
      const t = smoothstep(0.45, 1.0, aux.x);
      const sp = n3(pg, 70).mul(0.5).add(0.5);
      return mix(C.rgb, D.rgb, t).mul(sp.mul(0.35).add(0.8));
    })();
    return finish(m, c);
  })();
  // table: radial growth lines, a pale growing rim, a darker underside and stalk
  coral.table = (() => {
    const m = pose(std({ rough: 0.8, side: THREE.DoubleSide }), { squash: vec3(1, C.w, 1) });
    const c = Fn(() => {
      // the plate is a lattice of radiating branchlets ending in upturned corallites: radial ribs, dots, a pale growing edge
      const ang = atan(pg.z, pg.x), rad = length(vec2(pg.x, pg.z));
      const lines = smoothstep(0.2, 0.8, sin(ang.mul(rad.mul(260).add(40)).add(n3(pg, 9).mul(4))).mul(0.5).add(0.5));
      const dots = smoothstep(0.12, 0.04, mx_worley_noise_float(vec3(pg.x, 0, pg.z).mul(70)));
      let col = mix(C.rgb, D.rgb, smoothstep(0.75, 1.0, aux.x).max(dots.mul(0.5))).mul(lines.mul(0.35).add(0.7)).mul(n3(pg, 6).mul(0.2).add(1));
      col = col.mul(select(aux.w.greaterThan(0.5), float(0.55), float(1)));
      return col.mul(smoothstep(0.0, 0.2, rad).mul(0.25).add(0.75));
    })();
    return finish(m, c);
  })();
  // massive Porites: lumpy, finely pored, mottled
  coral.boulder = (() => {
    const m = pose(std({ rough: 0.9 }), { squash: vec3(1, C.w, 1) });
    const c = Fn(() => {
      const mot = n3(pg, 5).mul(0.5).add(0.5), pore = n3(pg, 90).mul(0.5).add(0.5);
      return mix(C.rgb, D.rgb, smoothstep(0.3, 0.8, mot)).mul(pore.mul(0.3).add(0.78)).mul(aux.x.mul(0.3).add(0.75));
    })();
    return finish(m, c);
  })();
  // brain coral: meandering valleys (where a noise field crosses zero) between pale ridges
  coral.brain = (() => {
    const m = pose(std({ rough: 0.85 }), { squash: vec3(1, C.w, 1) });
    const c = Fn(() => {
      const nn = n3(pg, 11).add(n3(pg, 23).mul(0.3));
      const valley = float(1).sub(smoothstep(0.03, 0.16, abs(nn)));
      return mix(C.rgb, D.rgb, valley).mul(n3(pg, 60).mul(0.08).add(1)).mul(aux.x.mul(0.25).add(0.8));
    })();
    return finish(m, c);
  })();
  // leather coral: a velvety cap (polyps out), the stalk paler
  coral.leather = (() => {
    const m = pose(std({ rough: 0.95, side: THREE.DoubleSide }), { squash: vec3(1, C.w, 1), twoSided: true, flatten: 0.3, post: (w, p) => w.add(surge(w, 0.05, 0.8).mul(aux.z).mul(A.w)) });
    const c = Fn(() => {
      const fuzz = n3(pg, 120).mul(0.5).add(0.5);
      return mix(C.rgb, D.rgb, select(aux.w.greaterThan(0.5), float(1), smoothstep(0.7, 1.0, aux.x).mul(0.6))).mul(fuzz.mul(0.25).add(0.85));
    })();
    return finish(m, c);
  })();
  // giant clam: grey-white fluted shell; the mantle mottled and spotted in iridescent blue, green or gold
  coral.clam = (() => {
    const m = pose(std({ rough: 0.7 }), { squash: vec3(1, 1, 1) });
    const c = Fn(() => {
      const mantle = aux.w.greaterThan(0.5);
      const shell = vec3(0.55, 0.52, 0.45).mul(n3(pg, 14).mul(0.15).add(0.85)).mul(aux.x.mul(0.3).add(0.6));
      const mot = n3(pg, 18).mul(0.5).add(0.5), spots = smoothstep(0.08, 0.02, mx_worley_noise_float(pg.mul(45)));
      const mc = mix(C.rgb, D.rgb, smoothstep(0.35, 0.7, mot)).add(vec3(0.25, 0.45, 0.5).mul(spots)).mul(smoothstep(1.0, 0.75, aux.x).mul(0.5).add(0.6));
      return select(mantle, mc, shell);
    })();
    const g = Fn(() => select(aux.w.greaterThan(0.5), C.rgb.mul(0.04), vec3(0)))();   // the mantle's pigments fluoresce a little
    return finish(m, c, { glow: g, rough: Fn(() => select(aux.w.greaterThan(0.5), float(0.45), float(0.8)))() });
  })();
  // magnificent anemone: a coloured column, pale disc, tentacles with brighter tips, all swaying
  coral.anemone = (() => {
    const m = pose(std({ rough: 0.7 }), { flatten: 0.2, post: (w, p) => w.add(surge(w, 0.09, 1.3).mul(aux.z).mul(A.w)) });
    const c = Fn(() => {
      const tent = aux.w.greaterThan(1.5), col = aux.w.greaterThan(0.5).and(aux.w.lessThan(1.5));
      const t = mix(D.rgb, D.rgb.mul(1.6).add(0.08), smoothstep(0.6, 1.0, aux.x));
      return select(tent, t, select(col, C.rgb, vec3(0.62, 0.58, 0.5)));
    })();
    return finish(m, c);
  })();
  // dead rubble: bleached grey-beige, patched with turf algae
  coral.rubble = (() => {
    const m = pose(std({ rough: 0.95 }));
    const c = Fn(() => mix(C.rgb, D.rgb, smoothstep(0.4, 0.75, n3(positionWorld, 2.2).mul(0.5).add(0.5))).mul(n3(pg, 40).mul(0.15).add(0.9)))();
    return finish(m, c);
  })();
  // seagrass: blades cut out of crossed cards; green, browning toward the tips, swaying with the surge
  coral.seagrass = (() => {
    // (thin blades lit from above whichever side is seen: the normal is mostly the sky's)
    const m = pose(std({ rough: 0.7, side: THREE.DoubleSide }), { flatten: 2.5, post: (w, p) => w.add(surge(w, 0.05, 1.1).mul(aux.z)) });
    const N = 28, col = floor(aux.y.mul(N)), h1 = fract(sin(col.mul(12.9898)).mul(43758.5)), h2 = fract(sin(col.mul(78.233)).mul(24634.6));
    const tall = h1.mul(0.6).add(0.4), lean = h2.sub(0.5).mul(2.2);
    const across = fract(aux.y.mul(N).add(lean.mul(aux.x).mul(aux.x))).sub(h1.mul(0.5).add(0.25)).abs();
    const width = float(0.16).add(h2.mul(0.1)).mul(float(1).sub(aux.x.div(tall).mul(0.6)));
    m.opacityNode = select(across.lessThan(width).and(aux.x.lessThan(tall)).and(h2.greaterThan(0.12)), float(1), float(0));
    m.alphaTest = 0.5;
    const c = Fn(() => mix(C.rgb, D.rgb, smoothstep(0.4, 1.0, aux.x.div(tall))).mul(h2.mul(0.4).add(0.75)).mul(aux.x.mul(0.5).add(0.6)))();
    return finish(m, c);
  })();

  // ---------------------------------------------------------------- animals
  // a travelling wave down the body: amplitude iC.w (fraction of length at the tail), angular rate iD.w
  const beat = (p, a) => {
    const w = sin(T.mul(D.w).add(B.w).sub(a.x.mul(5.0)));
    const head = sin(T.mul(D.w).add(B.w)).mul(0.25).mul(smoothstep(0.3, 0.0, a.x));
    return vec3(p.x, p.y, p.z.add(w.mul(a.z.mul(a.z)).add(head.mul(0.15)).mul(C.w)));
  };
  const eye = (ex, ey, r) => {
    const d = length(vec2(pg.x.sub(ex), pg.y.sub(ey)));
    return [smoothstep(r, r * 0.8, d), smoothstep(r * 1.5, r * 1.2, d)];
  };
  // a bony fish: pattern(u, v, fin, base) -> colour; countershading, an eye
  const fishMat = (pattern, o = {}) => {
    const m = pose(std({ rough: o.rough ?? 0.5, side: THREE.DoubleSide }), { deform: beat, twoSided: true });
    const c = Fn(() => {
      const uu = aux.x, vv = aux.y, fin = aux.w.greaterThan(0.5);
      let col = pattern(uu, vv, fin).toVar();
      // countershading: a darker back, a paler belly
      col.assign(col.mul(mix(float(o.belly ?? 1.25), float(o.back ?? 0.8), smoothstep(-0.8, 0.9, vv))));
      const [pupil, ring] = eye(0.4 - (o.eyeU ?? 0.085), o.eyeY ?? 0.02, o.eyeR ?? 0.022);
      col.assign(mix(col, vec3(...(o.iris ?? [0.75, 0.7, 0.45])), ring.mul(select(fin, float(0), float(1)))));
      col.assign(mix(col, vec3(0.02, 0.02, 0.025), pupil.mul(select(fin, float(0), float(1)))));
      return col;
    })();
    return finish(m, c, { rough: o.shine ? Fn(() => mix(float(0.25), float(0.6), smoothstep(-0.5, 0.8, aux.y)))() : null });
  };
  const bar = (x, a, b, soft = 0.012) => smoothstep(a - soft, a + soft, x).mul(float(1).sub(smoothstep(b - soft, b + soft, x)));
  const fish = {};
  // blue-green chromis: pale green-blue, translucent-looking fins
  fish.chromis = fishMat((uu, vv, fin) => mix(C.rgb, D.rgb, smoothstep(-0.6, 0.8, vv)).mul(select(fin, float(0.8), float(1))), { shine: true, eyeR: 0.03 });
  // humbug: white with three black bars, the first through the eye; black pelvic and anal fins
  fish.humbug = fishMat((uu, vv, fin) => {
    const bars = max(max(bar(uu, 0.06, 0.2), bar(uu, 0.36, 0.5)), bar(uu, 0.64, 0.77));
    return mix(vec3(0.85, 0.86, 0.85), vec3(0.03), max(bars, select(fin.and(vv.lessThan(-0.5)), float(1), float(0))));
  }, { eyeR: 0.03, iris: [0.05, 0.05, 0.05] });
  // fusilier: blue-grey above, yellow from the back of the dorsal to the tail, pale pink belly
  fish.fusilier = fishMat((uu, vv, fin) => {
    const yellow = smoothstep(0.45, 0.7, uu).mul(smoothstep(-0.2, 0.3, vv)).max(smoothstep(0.8, 0.86, uu));
    return mix(mix(vec3(0.85, 0.62, 0.66), vec3(0.28, 0.4, 0.62), smoothstep(-0.7, 0.2, vv)), vec3(0.95, 0.8, 0.12), yellow);
  }, { shine: true });
  // bigeye trevally: silver with a dark back, a dark spot on the gill cover
  fish.trevally = fishMat((uu, vv, fin) => {
    const spot = smoothstep(0.03, 0.02, length(vec2(uu.sub(0.2), vv.sub(0.55)).mul(vec2(1, 0.1))));
    return mix(mix(vec3(0.82, 0.84, 0.86), vec3(0.3, 0.36, 0.4), smoothstep(0.1, 0.9, vv)), vec3(0.08), spot).mul(select(fin, float(0.6), float(1)));
  }, { shine: true, eyeR: 0.035 });
  // parrotfish (terminal male): green-blue scales edged pink, a pink-orange band on the head and fins
  fish.parrotfish = fishMat((uu, vv, fin) => {
    const sc = fract(uu.mul(26)).sub(0.5).abs().add(fract(vv.mul(7)).sub(0.5).abs());
    const edge = smoothstep(0.35, 0.5, sc);
    const body = mix(C.rgb, D.rgb, edge.mul(0.6));
    return select(fin, mix(D.rgb, C.rgb, 0.35), mix(body, D.rgb, smoothstep(0.12, 0.08, uu).mul(0.7)));
  }, { eyeR: 0.02 });
  // humphead (Maori) wrasse: green to purplish-blue, yellow wavy lines over the head, two dark lines behind the eye
  fish['maori-wrasse'] = fishMat((uu, vv, fin) => {
    const lines = smoothstep(0.6, 0.85, sin(uu.mul(90).add(vv.mul(14)).add(sin(vv.mul(20)).mul(2))).mul(0.5).add(0.5)).mul(smoothstep(0.35, 0.15, uu));
    const eyeLines = max(bar(vv, 0.05, 0.11, 0.02), bar(vv, 0.22, 0.28, 0.02)).mul(bar(uu, 0.1, 0.24, 0.02));
    const scales = smoothstep(0.3, 0.5, fract(uu.mul(30)).sub(0.5).abs().add(fract(vv.mul(6)).sub(0.5).abs())).mul(0.15).mul(smoothstep(0.2, 0.35, uu));
    return mix(mix(C.rgb, D.rgb, lines.mul(0.7)), vec3(0.03), eyeLines).mul(float(1).sub(scales));
  }, { eyeR: 0.016, back: 0.85 });
  // Barrier Reef anemonefish: orange-brown with two white bars (head and mid-body), a pale tail
  fish.clownfish = fishMat((uu, vv, fin) => {
    const bars = max(bar(uu, 0.14, 0.2, 0.008), bar(uu, 0.44, 0.52, 0.008)), edge = max(bar(uu, 0.12, 0.22, 0.006), bar(uu, 0.42, 0.54, 0.006));
    const tail = smoothstep(0.74, 0.8, uu);
    const body = mix(mix(C.rgb, D.rgb, smoothstep(-0.2, 0.9, vv)), vec3(0.04), edge.sub(bars).max(0));
    return mix(body, vec3(0.9, 0.9, 0.88), max(bars, tail));
  }, { eyeR: 0.03, iris: [0.9, 0.5, 0.1] });
  // harlequin sweetlips (adult): grey with large dark brown spots, the fins spotted too
  fish.sweetlips = fishMat((uu, vv, fin) => {
    const sp = smoothstep(0.2, 0.12, mx_worley_noise_float(vec3(uu.mul(16), vv.mul(3.5), 0)));
    return mix(C.rgb, D.rgb, sp);
  }, { eyeR: 0.02 });

  // sharks: grey-brown above, white below with a pale flank band; fin tips black (blacktip) or white (whitetip)
  const sharkMat = tip => {
    const m = pose(std({ rough: 0.55, side: THREE.DoubleSide }), { deform: beat, twoSided: true });
    const c = Fn(() => {
      const uu = aux.x, vv = aux.y, fin = aux.w.greaterThan(0.5);
      let col = mix(vec3(0.9, 0.88, 0.85), C.rgb, smoothstep(-0.35, 0.1, vv.add(sin(uu.mul(9)).mul(0.08)))).toVar();
      const dtip = fin.and(pg.y.greaterThan(0.15).and(uu.lessThan(0.5))), ctip = fin.and(uu.greaterThan(0.95)).and(abs(pg.y).greaterThan(0.12)),
        ptip = fin.and(abs(pg.z).greaterThan(0.16));
      col.assign(mix(col, vec3(...tip), select(dtip.or(ctip).or(ptip), float(1), float(0))));
      const [pupil] = eye(0.4 - 0.07, 0.01, 0.009);
      return mix(col, vec3(0.02), pupil);
    })();
    return finish(m, c);
  };
  // rays: a stroke of the wings (eagle, manta) or a ripple of the disc margin (ribbontail)
  const flap = (p, a) => {
    const w = sin(T.mul(D.w).add(B.w).sub(a.x.mul(2.2)));
    return vec3(p.x, p.y.add(w.mul(pow(a.z, 1.6)).mul(C.w)), p.z);
  };
  const rayMat = pattern => {
    const m = pose(std({ rough: 0.6, side: THREE.DoubleSide }), { deform: flap, twoSided: true });
    const c = Fn(() => select(aux.w.greaterThan(0.5).and(aux.w.lessThan(1.5)), vec3(0.88, 0.86, 0.84), pattern(aux.x, aux.y, aux.w)))();
    return finish(m, c);
  };
  const ray = {
    ribbontail: rayMat((uu, s, w) => {
      const spots = smoothstep(0.13, 0.07, mx_worley_noise_float(pg.mul(26)));
      const tailStripe = select(w.greaterThan(1.5), smoothstep(0.004, 0.0, abs(abs(pg.z).sub(0.006))), float(0));
      return mix(vec3(0.62, 0.5, 0.22), vec3(0.1, 0.45, 0.95), max(spots, tailStripe));
    }),
    eagle: rayMat((uu, s, w) => mix(vec3(0.05, 0.07, 0.1), vec3(0.85, 0.85, 0.82), smoothstep(0.14, 0.08, mx_worley_noise_float(pg.mul(14))))),
    manta: rayMat((uu, s, w) => {
      const shoulder = smoothstep(0.35, 0.15, length(vec2(uu.sub(0.3), abs(s).sub(0.45)).mul(vec2(2.2, 1.6))));
      return mix(vec3(0.03, 0.035, 0.04), vec3(0.75, 0.75, 0.72), shoulder);
    })
  };
  // turtles: flippers stroke about the shoulder; a scute pattern on the carapace
  const stroke = (p, a) => {
    const front = select(a.w.greaterThan(2.5).and(a.w.lessThan(3.5)), float(1), float(0)), rear = select(a.w.greaterThan(3.5), float(1), float(0));
    const ang = sin(T.mul(D.w).add(B.w)).mul(C.w);
    const lever = max(a.z, 0);
    return vec3(p.x.add(lever.mul(sin(ang)).mul(front).mul(0.35)), p.y.add(lever.mul(sin(ang)).mul(front)).add(lever.mul(sin(ang.mul(0.5).add(1))).mul(rear).mul(0.5)), p.z);
  };
  const turtleMat = (shellA, shellB, skin, mottle) => {
    const m = pose(std({ rough: 0.6 }), { deform: stroke });
    const c = Fn(() => {
      const part = aux.w;
      const cell = mx_worley_noise_float(vec3(pg.x.mul(6), pg.y.mul(2), pg.z.mul(6)));
      const seam = smoothstep(0.02, 0.08, cell);
      const streak = n3(vec3(pg.x.mul(3), pg.y, pg.z.mul(3)), 4).mul(0.5).add(0.5);
      const shell = mix(vec3(...shellA), vec3(...shellB), smoothstep(0.3, 0.8, streak).mul(mottle)).mul(seam.mul(0.4).add(0.6));
      const scales = smoothstep(0.05, 0.12, mx_worley_noise_float(pg.mul(38)));
      const sk = vec3(...skin).mul(scales.mul(0.5).add(0.6));
      return select(part.lessThan(0.5), shell, select(part.lessThan(1.5), vec3(0.75, 0.7, 0.55), sk));
    })();
    return finish(m, c);
  };
  const turtle = {
    green: turtleMat([0.3, 0.27, 0.15], [0.12, 0.1, 0.06], [0.38, 0.36, 0.3], 0.8),
    hawksbill: turtleMat([0.55, 0.36, 0.14], [0.1, 0.06, 0.03], [0.4, 0.33, 0.25], 1.0)
  };

  // ---------------------------------------------------------------- island trees
  // foliage colour per instance (iC), bark (iD); crowns shaded darker inside and below, swaying in the wind
  const treeSway = (w, p, a) => {
    const s = sin(T.mul(1.1).add(B.w).add(w.x.mul(0.03))).mul(0.6).add(sin(T.mul(2.3).add(B.w.mul(2))).mul(0.25));
    return w.add(vec3(s, 0, s.mul(0.6)).mul(a.z).mul(A.w).mul(u.wind.mul(0.03).add(0.006)));
  };
  const treeColour = Fn(() => {
    const leaf = aux.w.lessThan(0.5);
    const clump = mx_noise_float(positionWorld.mul(0.45)).mul(0.5).add(0.5), fine = mx_noise_float(positionWorld.mul(3.1)).mul(0.5).add(0.5);
    const f = C.rgb.mul(clump.mul(0.45).add(0.65)).mul(fine.mul(0.3).add(0.8)).mul(aux.x.mul(0.35).add(0.7));
    return select(leaf, f, D.rgb.mul(fine.mul(0.2).add(0.85)));
  });
  const tree = (() => {
    const m = pose(std({ rough: 0.9, side: THREE.DoubleSide }), { post: treeSway, flatten: 0.35, twoSided: true });
    return finish(m, treeColour());
  })();
  const farTree = (() => {
    const m = pose(std({ rough: 0.95 }), { squash: vec3(C.w, D.w, C.w), flatten: 0.6 });
    return finish(m, Fn(() => select(aux.w.lessThan(0.5), C.rgb.mul(mx_noise_float(positionWorld.mul(0.5)).mul(0.25).add(0.85)).mul(aux.x.mul(0.4).add(0.65)), D.rgb))());
  })();

  return { coral, fish, sharkMat, ray, turtle, tree, farTree, surge };
}
