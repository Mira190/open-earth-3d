// Open Earth 3D clouds: the sky's cloud layers, the Milky Way and shooting stars, drawn in the sky
// dome's own shader (world.js patches them into three.js's Sky): no pass, no target and no draw of
// their own, and the light from the sky (PMREM) is taken from the same dome, so the city is lit by
// the sky it stands under.
//
// What is drawn, far to near (docs/LOOK.md, "The sky and its clouds"):
//   cirrus      streaks on a shell at 9 km
//   towers      cumulus congestus standing on the horizon all round, shaped in azimuth and elevation
//               (a painted backdrop's layer: they are 40 km off and do not shift as you walk), lit on
//               the side the sun is on, rim-lit when the sun is behind them
//   altocumulus a dappled sheet at 5 km
//   cumulus     the deck at 1.5 km, on a sphere's shell so that it closes on the horizon instead of
//               running to infinity; lit from the sun's side (a second sample of the density towards
//               the sun), a shaded base in the sky's colour, a silver lining towards the sun
// All of it reads one small tileable noise texture (256 x 256: R billows, G cells, B streaks, A the
// regions of clear and cloudy sky), made here once on the CPU: 9 bilinear taps a sky pixel, against
// the 20 lattice hashes of the stock Sky's procedural layer it replaces.
// The colours are not worked out per pixel: light() sets a lit colour, a shade colour and a rim
// colour for the hour from the sky's own zenith and horizon, the way a background painter keys a
// cloud to its sky, so they hold their look through the tone curve at every hour and never go grey.
'use strict';
window.OEClouds = (function () {
  const N = 256;
  let data = null, tex = null;

  // the noise, tileable: lattices of gradients and of feature points, each of period P
  function build() {
    if (data) return data;
    const rnd = (x, y, s) => { let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(s + 1, 0x9e3779b1); h = Math.imul(h ^ (h >>> 13), 0x85ebca6b); h = Math.imul(h ^ (h >>> 15), 0xc2b2ae35); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
    const lattice = (P, s) => { const gx = new Float32Array(P * P), gy = new Float32Array(P * P), px = new Float32Array(P * P), py = new Float32Array(P * P);
      for (let j = 0; j < P; j++) for (let i = 0; i < P; i++) { const a = rnd(i, j, s) * 6.2831853, k = j * P + i; gx[k] = Math.cos(a); gy[k] = Math.sin(a); px[k] = rnd(i, j, s + 101); py[k] = rnd(i, j, s + 202); }
      return { P, gx, gy, px, py }; };
    const perlin = (L, x, y) => {
      const P = L.P, ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy, x0 = ((ix % P) + P) % P, y0 = ((iy % P) + P) % P, x1 = (x0 + 1) % P, y1 = (y0 + 1) % P;
      const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10), v = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
      const a = L.gx[y0 * P + x0] * fx + L.gy[y0 * P + x0] * fy, b = L.gx[y0 * P + x1] * (fx - 1) + L.gy[y0 * P + x1] * fy;
      const c = L.gx[y1 * P + x0] * fx + L.gy[y1 * P + x0] * (fy - 1), d = L.gx[y1 * P + x1] * (fx - 1) + L.gy[y1 * P + x1] * (fy - 1);
      return (a + (b - a) * u) + ((c + (d - c) * u) - (a + (b - a) * u)) * v;
    };
    // 1 at a feature point, falling to 0 a cell away: the rounded heads of a cumulus
    const worley = (L, x, y) => {
      const P = L.P, ix = Math.floor(x), iy = Math.floor(y); let m = 9;
      for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
        const cx = (((ix + i) % P) + P) % P, cy = (((iy + j) % P) + P) % P, k = cy * P + cx, dx = ix + i + L.px[k] - x, dy = iy + j + L.py[k] - y, d = dx * dx + dy * dy;
        if (d < m) m = d;
      }
      return Math.max(0, 1 - Math.sqrt(m));
    };
    const Lp = [4, 8, 16, 32].map((P, i) => lattice(P, 11 + i)), Lw = [4, 8, 16, 32, 64].map((P, i) => lattice(P, 31 + i)), Ls = [[3, 12], [6, 24], [12, 48]].map(([a, b], i) => ({ a, b, L: lattice(b, 51 + i) })), Lr = [2, 4, 8].map((P, i) => lattice(P, 71 + i));
    const ch = [0, 1, 2, 3].map(() => new Float32Array(N * N));
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const x = i / N, y = j / N, k = j * N + i;
      let p = 0, w = 0, a = 1;
      for (const L of Lp) { p += a * perlin(L, x * L.P, y * L.P); a *= 0.5; }
      a = 1; let wn = 0;
      for (let o = 0; o < 3; o++) { w += a * worley(Lw[o], x * Lw[o].P, y * Lw[o].P); wn += a; a *= 0.5; }
      w /= wn;
      ch[0][k] = (p * 0.9 + 0.5) * 0.55 + w * 0.75;                      // billows: a soft field with rounded heads on it
      a = 1; wn = 0; let g = 0;
      for (let o = 2; o < 5; o++) { g += a * worley(Lw[o], x * Lw[o].P, y * Lw[o].P); wn += a; a *= 0.55; }
      ch[1][k] = g / wn;                                                 // cells: the small heads, and a dappled sheet
      a = 1; let s = 0;
      for (const S of Ls) { s += a * (1 - Math.abs(perlin(S.L, x * S.a * (S.b / S.a) / (S.b / S.a), y * S.b) * 1.8)); a *= 0.5; } // ridges, four times longer one way
      ch[2][k] = s;
      a = 1; let r = 0;
      for (const L of Lr) { r += a * perlin(L, x * L.P, y * L.P); a *= 0.5; }
      ch[3][k] = r;
    }
    // each channel spread evenly over 0..1 (by rank), so a cover of c hides the fraction c of the sky
    data = new Uint8Array(N * N * 4);
    const order = new Uint32Array(N * N);
    for (let c = 0; c < 4; c++) {
      for (let k = 0; k < N * N; k++) order[k] = k;
      const v = ch[c];
      order.sort((p, q) => v[p] - v[q]);
      for (let r = 0; r < N * N; r++) data[order[r] * 4 + c] = Math.round(r / (N * N - 1) * 255);
    }
    return data;
  }
  function texture() {
    if (tex) return tex;
    tex = new THREE.DataTexture(build(), N, N, THREE.RGBAFormat, THREE.UnsignedByteType);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.generateMipmaps = true;
    tex.colorSpace = THREE.NoColorSpace;
    tex.needsUpdate = true;
    return tex;
  }

  const DECL = `
uniform sampler2D uCloudTex;
uniform vec3 uCloudLit, uCloudShade, uCloudRim;
uniform vec4 uCloudK;      // towers on the horizon, the high layers (altocumulus and cirrus), how hard the edges are, the sun's glow through thin cloud
uniform float uCloudFair;  // the fair-weather cover's share after dark, when cumulus thins out (a heavy cover stays)
uniform vec4 uCloudDrift;  // xy the deck's drift with the wind (in its tiles), z the slow change of shape, w the towers' drift
uniform float uMilky; uniform vec3 uGalPole, uGalCentre;
uniform vec3 uMeteorA, uMeteorB; uniform float uMeteorT;
`;
  // (d: the view direction, s: the sun's, cosT their cosine, bg the sky behind)
  const COVER = `
// how much of the sky the deck and the towers hide in a direction: for the stars and the moon (a vertex's lookup)
float oeCover() { return cloudCoverage * mix( uCloudFair, 1.0, smoothstep( 0.4, 0.8, cloudCoverage ) ); }
float oeCloudCover( vec3 d ) {
  float cover = oeCover();
  float y = max( d.y, 0.0 ), t = 3000.0 / ( sqrt( y * y + 0.000471 ) + y );
  vec2 uv = d.xz * t / 9000.0 + uCloudDrift.xy;
  float reg = textureLod( uCloudTex, uv * 0.17 + 0.41, 0.0 ).a;
  float cov = clamp( cover + ( reg - 0.5 ) * 2.4 * min( cover, 1.0 - cover ), 0.0, 1.0 );
  float m = smoothstep( 1.0 - cov, 1.0 - cov + 0.2, textureLod( uCloudTex, uv, 1.0 ).r ) * exp( -t / 45000.0 );
  float az = atan( d.z, d.x ) * 0.15915494;
  vec4 sk = textureLod( uCloudTex, vec2( az * 2.0 + uCloudDrift.w, 0.137 ), 0.0 );
  float H = uCloudK.x * smoothstep( 0.2, 0.6, sk.a ) * ( 0.06 + 0.3 * sk.r * sk.r ) * ( 0.7 + 0.6 * cover );
  return max( m, smoothstep( 0.0, 0.03, H - d.y ) );
}
`;
  const GLSL = COVER + `
// a lookup with a smooth step between texels: magnified, a bilinear lookup draws its texels as diamonds along a hard edge
vec4 oeTex( vec2 uv ) {
  uv = uv * 256.0 + 0.5;
  vec2 i = floor( uv ), f = uv - i;
  return texture2D( uCloudTex, ( i + f * f * ( 3.0 - 2.0 * f ) - 0.5 ) / 256.0 );
}
vec4 oeTexLod( vec2 uv ) {
  uv = uv * 256.0 + 0.5;
  vec2 i = floor( uv ), f = uv - i;
  return textureLod( uCloudTex, ( i + f * f * ( 3.0 - 2.0 * f ) - 0.5 ) / 256.0, 0.0 );
}
vec3 oeClouds( vec3 d, vec3 s, float cosT, vec3 bg ) {
  vec3 col = bg;
  float y = max( d.y, 0.0 ), cover = oeCover();
  float fwd = min( 0.36 / pow( 1.64 - 1.6 * cosT, 1.5 ), 6.0 ) / 6.0;         // the forward lobe (Henyey-Greenstein, g 0.8): 1 within 15 degrees of the sun
  float up = smoothstep( -0.01, 0.02, d.y );
  if ( uCloudK.y > 0.0 ) {                                                      // cirrus, 9 km
    float t = 18000.0 / ( sqrt( y * y + 0.002825 ) + y );
    vec2 uv = d.xz * t / 42000.0 + uCloudDrift.xy * 0.35;
    // the streaks bent by a slow field (a domain warp from the regions channel) so that they sweep and hook rather than
    // run straight, and broken along their length into strokes by a second, crosswise lookup of the same channel
    // (a coarse mip of the streaks: the finest ridges, bent, read as contour lines rather than wisps)
    vec4 w = texture2D( uCloudTex, uv * 0.11 + 0.61 );
    uv += ( w.ag - 0.5 ) * vec2( 0.18, 0.32 );
    vec4 n = textureLod( uCloudTex, uv * vec2( 0.8, 1.25 ) + 0.17, 2.2 );
    float strokes = smoothstep( 0.25, 0.7, texture2D( uCloudTex, uv.yx * vec2( 1.4, 0.45 ) + 0.43 ).a );
    float a = smoothstep( 0.5, 0.9, n.b * ( 0.45 + 0.8 * n.a ) ) * smoothstep( 0.45, 0.8, n.a ) * strokes * uCloudK.y * ( 1.0 - 0.6 * cover ) * exp( -t / 170000.0 ) * up;
    col = mix( col, mix( uCloudShade, uCloudLit, 0.8 ) + uCloudRim * fwd * 0.5, a * 0.42 );
  }
  if ( uCloudK.x > 0.0 ) {                                                      // towers on the horizon
    float az = atan( d.z, d.x ) * 0.15915494;
    vec4 sk = textureLod( uCloudTex, vec2( az * 2.0 + uCloudDrift.w, 0.137 ), 0.0 );
    float H = uCloudK.x * smoothstep( 0.2, 0.6, sk.a ) * ( 0.06 + 0.3 * sk.r * sk.r ) * ( 0.7 + 0.6 * cover );
    vec2 buv = vec2( az * 4.0 + uCloudDrift.w * 2.0, d.y * 0.637 - uCloudDrift.z * 0.12 );
    vec4 n = oeTexLod( buv ), nd = textureLod( uCloudTex, buv * 4.0 + 0.37, 0.0 );
    float bump = ( nd.r - 0.5 ) * 0.05 + ( nd.g - 0.5 ) * 0.02;                  // the heads on the mass
    float shape = H * ( 0.45 + 0.8 * n.r ) + bump * smoothstep( 0.0, 0.05, H ) - d.y - 0.004;
    float saz = atan( s.z, s.x ) * 0.15915494;
    vec2 to = normalize( vec2( ( fract( saz - az + 0.5 ) - 0.5 ) * 6.2832, s.y - d.y ) + 1e-4 );
    vec4 n2 = oeTexLod( buv + to * 0.016 );
    float shape2 = H * ( 0.45 + 0.8 * n2.r ) - d.y - to.y * 0.025 - 0.004;
    float m = smoothstep( 0.0, mix( 0.03, 0.008, uCloudK.z ), shape );
    float face = clamp( 0.5 + ( shape - bump - shape2 ) * 22.0 + bump * 9.0, 0.0, 1.0 ); // leaving the cloud towards the sun: this side faces it
    float front = smoothstep( 0.8, -0.5, cosT );                               // the sun behind you: the whole tower lit
    float top = clamp( d.y / max( H, 0.02 ), 0.0, 1.0 );
    float lit = clamp( face * ( 0.3 + 0.7 * front ) + 0.35 * top * front, 0.0, 1.0 );
    float rim = ( 1.0 - smoothstep( 0.0, 0.03, shape ) ) * fwd;
    vec3 c = mix( uCloudShade, uCloudLit, lit ) + uCloudRim * rim * 1.6;
    c = mix( bg, c, 0.3 + 0.7 * smoothstep( -0.01, 0.1, d.y ) );                // its foot in the horizon's air
    col = mix( col, c, m * 0.97 );
  }
  if ( uCloudK.y > 0.0 ) {                                                      // altocumulus, 5 km
    float t = 10000.0 / ( sqrt( y * y + 0.00157 ) + y );
    vec4 n = texture2D( uCloudTex, d.xz * t / 15000.0 + uCloudDrift.xy * 0.5 + 0.3 );
    float a = smoothstep( 0.62, 0.9, n.g * 0.55 + n.a * 0.6 ) * smoothstep( 0.62, 0.92, n.a ) * uCloudK.y * exp( -t / 90000.0 ) * up;
    col = mix( col, mix( uCloudShade, uCloudLit, 0.45 + 0.5 * n.g ) + uCloudRim * fwd * 0.6, a * 0.8 );
  }
  if ( cover > 0.003 ) {                                                        // the cumulus deck, 1.5 km
    float t = 3000.0 / ( sqrt( y * y + 0.000471 ) + y );
    vec2 uv = d.xz * t / 9000.0 + uCloudDrift.xy;
    vec4 n = oeTex( uv );
    float reg = texture2D( uCloudTex, uv * 0.17 + 0.41 ).a;                    // clear gaps beside banks of cloud
    vec4 dt = texture2D( uCloudTex, uv * 4.3 + uCloudDrift.z );
    float cov = clamp( cover + ( reg - 0.5 ) * 2.4 * min( cover, 1.0 - cover ), 0.0, 1.0 );
    float th = 1.0 - cov * 1.14, dens = n.r + ( dt.g - 0.5 ) * 0.13 + ( dt.r - 0.5 ) * 0.13 + ( n.g - 0.5 ) * 0.05; // (a full cover closes the last gaps)
    float m = smoothstep( th, th + mix( 0.2, 0.05, uCloudK.z ), dens );
    vec2 sd = s.xz / max( length( s.xz ), 1e-3 ) * 0.035 * ( 1.0 - 0.6 * abs( s.y ) );
    float occ = smoothstep( th - 0.05, th + 0.45, texture2D( uCloudTex, uv + sd ).r ); // cloud between here and the sun
    float depth = max( dens - th, 0.0 ), body = smoothstep( 0.0, 0.5, depth );       // its thick middle, seen from below: the shaded base
    float lit = clamp( ( 1.0 - 0.75 * occ ) * ( 1.0 - 0.62 * body ) + ( dt.r - 0.5 ) * 0.16, 0.0, 1.0 );
    float rim = m * ( 1.0 - m ) * 4.0;
    vec3 c = mix( uCloudShade, uCloudLit, lit ) + uCloudRim * fwd * ( rim * 1.6 + ( 1.0 - body ) * uCloudK.w );
    col = mix( col, c, m * min( 1.0, 0.7 + 0.4 * cloudDensity ) * exp( -t / 45000.0 ) * up );
  }
  return col;
}
// the Milky Way: a band along the galactic plane, brightest towards its centre in Sagittarius, with the dark rift down its middle
vec3 oeMilky( vec3 d ) {
  float b = dot( d, uGalPole ), c = dot( d, uGalCentre );
  float lon = atan( dot( d, cross( uGalPole, uGalCentre ) ), c ) * 0.15915494;
  vec2 uv = vec2( lon * 4.0, b * 0.637 + 0.3 );
  vec4 n = oeTexLod( uv ), n2 = oeTexLod( uv * 3.0 + 0.19 );
  float core = exp( -( 1.0 - c ) * 2.2 ), wide = 0.13 + 0.1 * core;
  float band = exp( -b * b / ( 2.0 * wide * wide ) ) * ( 0.4 + 0.6 * core );
  float rb = b - ( n.a - 0.5 ) * 0.07;                                         // the rift wanders about the plane
  float rift = 1.0 - 0.7 * smoothstep( 0.35, 0.75, n2.r * 0.6 + n.r * 0.4 ) * exp( -rb * rb / 0.0035 ) * ( 0.5 + 0.5 * core );
  float clouds = 0.35 + 0.9 * n.r * ( 0.5 + 0.5 * n2.a );                      // its star clouds
  return mix( vec3( 0.6, 0.72, 1.0 ), vec3( 1.0, 0.88, 0.74 ), core * 0.8 ) * band * rift * clouds * smoothstep( 0.0, 0.25, d.y );
}
// a shooting star: a streak from A towards B, its head at uMeteorT along the way and a short tail behind it
float oeMeteor( vec3 d ) {
  vec3 ab = uMeteorB - uMeteorA;
  float h = clamp( dot( d - uMeteorA, ab ) / dot( ab, ab ), 0.0, 1.0 ), r = length( d - ( uMeteorA + ab * h ) );
  float tail = h < uMeteorT ? exp( -( uMeteorT - h ) * 7.0 ) : 0.0;
  return ( 1.0 - smoothstep( 0.0, 0.0022, r ) ) * tail * sin( min( uMeteorT, 1.0 ) * 3.14159 );
}
`;
  // after the sky's own colour is final (the hour's hue, the night) and before the horizon's haze
  const CALL = `
 if ( uMilky > 0.0 && uNightSky > 0.0 && direction.y > 0.0 ) gl_FragColor.rgb += oeMilky( direction ) * uMilky * uNightSky;
 if ( uMeteorT > 0.0 ) gl_FragColor.rgb += vec3( 0.9, 0.95, 1.0 ) * oeMeteor( direction ) * uNightSky;
 if ( cloudCoverage > 0.0 || uCloudK.x + uCloudK.y > 0.0 ) gl_FragColor.rgb = oeClouds( direction, vSunDirection, cosTheta, gl_FragColor.rgb );`;

  function uniforms() {
    return { uCloudTex: { value: null }, // (made when the game turns the clouds on: texture())
       uCloudLit: { value: new THREE.Color(1, 1, 1) }, uCloudShade: { value: new THREE.Color(0.4, 0.5, 0.7) }, uCloudRim: { value: new THREE.Color(1, 1, 1) },
      uCloudK: { value: new THREE.Vector4(0, 0, 0.4, 0.5) }, uCloudFair: { value: 1 }, uCloudDrift: { value: new THREE.Vector4(0, 0, 0, 0) },
      uMilky: { value: 0 }, uGalPole: { value: new THREE.Vector3(0, 1, 0) }, uGalCentre: { value: new THREE.Vector3(1, 0, 0) },
      uMeteorA: { value: new THREE.Vector3(0, 1, 0) }, uMeteorB: { value: new THREE.Vector3(1, 0, 0) }, uMeteorT: { value: 0 } };
  }

  // The clouds' colours for the hour, keyed on the sun's height (degrees): [lit tint, lit gain, shade tint, shade gain, how far
  // the shade goes from the zenith's colour to the horizon's, rim tint, rim gain]. The gains are on the sky's own brightness
  // (its horizon across from the sun), so the clouds keep their place over the sky whatever the exposure.
  const PALETTE = {
    film: [
      [-14, [1.0, 0.92, 0.86], 1.7, [0.8, 0.8, 0.95], 1.4, 0.8, [0.6, 0.7, 1.0], 0],
      [-6, [0.85, 0.62, 0.72], 0.95, [0.42, 0.46, 0.75], 0.62, 0.35, [1.0, 0.5, 0.4], 0.4],
      [-1, [1.0, 0.6, 0.48], 1.2, [0.62, 0.5, 0.74], 0.6, 0.4, [1.0, 0.55, 0.3], 1.3],
      [4, [1.0, 0.76, 0.56], 1.3, [0.72, 0.62, 0.8], 0.62, 0.45, [1.0, 0.7, 0.42], 1.5],
      [14, [1.0, 0.93, 0.84], 1.3, [0.8, 0.84, 0.98], 0.62, 0.55, [1.0, 0.92, 0.8], 1.1],
      [35, [1.0, 0.98, 0.95], 1.3, [0.84, 0.9, 1.0], 0.64, 0.6, [1.0, 0.98, 0.94], 0.9],
    ],
    // the animated film's sky: the lit side cream by day and peach to rose at dusk, the shade a clear blue going to violet
    // as the sun gets low (never grey), a strong rim towards the sun
    shinkai: [
      [-14, [0.95, 0.9, 1.0], 1.75, [0.66, 0.72, 1.05], 1.45, 0.75, [0.6, 0.7, 1.0], 0],
      [-6, [0.95, 0.56, 0.74], 1.05, [0.4, 0.42, 0.86], 0.66, 0.3, [1.0, 0.45, 0.5], 0.6],
      [-1, [1.0, 0.56, 0.5], 1.3, [0.62, 0.44, 0.84], 0.62, 0.35, [1.0, 0.5, 0.32], 1.7],
      [4, [1.0, 0.74, 0.56], 1.4, [0.7, 0.56, 0.9], 0.62, 0.4, [1.0, 0.68, 0.4], 1.9],
      [14, [1.0, 0.93, 0.83], 1.42, [0.72, 0.8, 1.06], 0.6, 0.5, [1.0, 0.93, 0.8], 1.3],
      [35, [1.0, 0.985, 0.96], 1.45, [0.74, 0.86, 1.1], 0.62, 0.55, [1.0, 0.98, 0.95], 1.1],
    ],
  };
  const lum = c => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  // su: the sky's uniforms; alt: the sun's height in degrees; zen, hor: the sky's colour overhead and on the horizon across from
  // the sun, as the dome draws them ([r, g, b]); look: {palette, overcast 0..1 (a grey sheet rather than a painted cloud)}
  function light(su, alt, zen, hor, look = {}) {
    const P = PALETTE[look.palette] || PALETTE.film;
    let i = 0;
    while (i < P.length - 2 && alt > P[i + 1][0]) i++;
    const A = P[i], B = P[i + 1], t = Math.max(0, Math.min(1, (alt - A[0]) / (B[0] - A[0]))), k = t * t * (3 - 2 * t);
    const mixv = (a, b) => [0, 1, 2].map(c => a[c] + (b[c] - a[c]) * k), mixs = (a, b) => a + (b - a) * k;
    const ref = Math.max(lum(hor), lum(zen)), ov = look.overcast || 0, rain = look.rain || 0;
    const litT = mixv(A[1], B[1]), shT = mixv(A[3], B[3]), rimT = mixv(A[6], B[6]), toHor = mixs(A[5], B[5]);
    const sky = [0, 1, 2].map(c => zen[c] + (hor[c] - zen[c]) * toHor), sl = Math.max(lum(sky), 1e-6);
    // the shade: the sky's own colour, held to a share of its brightness and tinted; under an overcast a luminous grey
    const shG = mixs(A[4], B[4]), litG = mixs(A[2], B[2]) * (1 - (0.5 + 0.22 * rain) * ov);
    const shade = [0, 1, 2].map(c => { const v = sky[c] / sl * ref * shG * shT[c]; return v + (ref * (0.5 - 0.2 * rain) * (0.95 + 0.05 * c) - v) * 0.85 * ov; });
    su.uCloudLit.value.setRGB(litT[0] * ref * litG, litT[1] * ref * litG, litT[2] * ref * litG);
    su.uCloudShade.value.setRGB(shade[0], shade[1], shade[2]);
    const rg = mixs(A[7], B[7]) * ref * (1 - 0.8 * ov);
    su.uCloudRim.value.setRGB(rimT[0] * rg, rimT[1] * rg, rimT[2] * rg);
  }

  // into three.js's Sky material, in place of its own cloud layer; returns false where the shader is not the one known
  function patch(material) {
    const f = material.fragmentShader, own = 'if ( direction.y > 0.0 && cloudCoverage > 0.0 )', haze = '\n gl_FragColor.rgb = mix( gl_FragColor.rgb, uHaze,';
    if (!f.includes(own) || !f.includes(haze) || !f.includes('void main() {')) return false;
    material.fragmentShader = f.replace(own, 'if ( false )').replace('void main() {', GLSL + '\nvoid main() {').replace('uniform float cloudCoverage;', 'uniform float cloudCoverage;' + DECL).replace(haze, CALL + haze);
    Object.assign(material.uniforms, uniforms());
    return true;
  }

  return { patch, light, texture, build, GLSL, COVER, DECL, PALETTE, N };
})();
