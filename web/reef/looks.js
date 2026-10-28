// Who is on the reef, and what they wear. A look is plain data: which Quaternius character to start
// from, the recolour of its palette classes (skin, hair, top, legs), how far a suit or sleeve
// covers the skin, and the accessories to build. Clothing follows Queensland sun-smart habit:
// long-sleeve rash vests and full-body stinger suits (marine stinger season is October to May),
// wide-brim hats, caps and polarised sunnies, board shorts, thongs, and crew and ranger uniforms.
// Skin tones span what a Queensland crowd really is: Aboriginal and Torres Strait Islander,
// Pacific Islander, Asian-Australian, European and visiting backpackers.

// sRGB swatches, light to deep
export const SKIN_TONES = { fair: '#f1d3c0', light: '#e7bd9b', olive: '#d6a47a', tan: '#c08760', brown: '#99633f', deep: '#704529', darkest: '#503120' };
const SKIN_LIST = Object.values(SKIN_TONES);
export const HAIR_TONES = { black: '#17110e', darkBrown: '#2c1d14', brown: '#4a3220', auburn: '#6e3a22', chestnut: '#7a5230', blond: '#c9a96a', sunBleached: '#dcc189', grey: '#9a958f', white: '#d8d4cd' };
const HAIR_COMMON = ['#17110e', '#17110e', '#2c1d14', '#2c1d14', '#4a3220', '#6e3a22', '#7a5230', '#c9a96a', '#dcc189'];

// marine stingers (box jellyfish, Irukandji) are a hazard from October to May on this coast
export const stingerSeason = (d = new Date()) => { const m = d.getUTCMonth(); return m >= 9 || m <= 4; };

// which character templates suit which role (men, women)
export const ROLES = {
  player: { desc: 'you: choose gender, skin and hair' },
  skipper: { desc: 'boat skipper: cap, crew polo, shorts, sunnies' },
  guide: { desc: 'reef guide: crew polo and shorts, lanyard, hat' },
  ranger: { desc: 'marine park ranger: khaki shirt, wide-brim hat, radio' },
  traditionalOwner: { desc: 'Ngaro / Gia / Juru Elder in everyday clothes' },
  diveInstructor: { desc: 'dive instructor in a wetsuit with kit' },
  tourist: { desc: 'visitor: stinger suit, rash vest or board shorts' }
};

function rngFor(seed) { let s = (seed ?? Math.floor(Math.random() * 1e9)) >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const pick = (r, a) => a[Math.floor(r() * a.length)];
const shade = (hex, k) => { const n = parseInt(hex.slice(1), 16); const f = c => Math.max(0, Math.min(255, Math.round(c * k))); return '#' + [f(n >> 16), f((n >> 8) & 255), f(n & 255)].map(v => v.toString(16).padStart(2, '0')).join(''); };

const MEN = ['M_Casual2', 'M_Beach', 'M_Hoodie'], WOMEN = ['W_Casual', 'W_Adventurer'];
const isW = g => g === 'W' || g === 'F' || g === 'female';

// the look of a role. opts: gender 'M'|'W', skin (a tone name or hex), hair, seed, character, season (bool), outfit
export function makeLook(role, opts = {}) {
  const r = rngFor(opts.seed ?? (role + (opts.gender || '')).split('').reduce((a, c) => a * 31 + c.charCodeAt(0), 7));
  const w = opts.gender !== undefined ? isW(opts.gender) : r() < 0.5;
  const season = opts.season ?? true;
  const skinOf = (def) => SKIN_TONES[opts.skin] || opts.skin || def;
  const L = { role, gender: w ? 'W' : 'M', character: opts.character || (w ? 'W_Casual' : 'M_Casual2'), skin: skinOf(pick(r, SKIN_LIST)), hair: HAIR_TONES[opts.hair] || opts.hair || pick(r, HAIR_COMMON),
    top: '#e9e6df', legs: '#2b3440', scale: (w ? 0.9 : 0.95) + r() * 0.05, accessories: [], suit: null, sleeve: null, shorts: false, barefoot: false };
  const A = (type, o = {}) => L.accessories.push(Object.assign({ type }, o));
  switch (role) {
    case 'player': {
      L.character = opts.character || (w ? 'W_Casual' : 'M_Beach');
      L.skin = skinOf(SKIN_TONES.olive);
      L.hair = HAIR_TONES[opts.hair] || opts.hair || HAIR_TONES.darkBrown;
      L.top = '#f4f1ea'; L.legs = '#1d3557'; L.shorts = true; L.barefoot = true;
      L.scale = w ? 0.93 : 0.97;
      const outfit = opts.outfit || (season ? 'stinger' : 'rash');
      if (outfit === 'stinger') L.suit = { color: '#16324f', top: '#16324f', legs: '#16324f', legN: 2, arms: 2, torso: true };   // full-body lycra, hands/feet/face bare
      else if (outfit === 'rash') { L.suit = { color: '#e4572e', top: '#e4572e', arms: 2, legN: 0, torso: true }; L.legs = '#1d3557'; }
      else { L.sleeve = { n: 2 }; }
      if (opts.hat !== false) A('hat', { color: '#e1d4b0', band: '#244a63' });
      A('sunnies', { show: false });
      break;
    }
    case 'skipper': {
      L.character = w ? 'W_Casual' : 'M_Beach';
      L.skin = skinOf(SKIN_TONES.tan); L.hair = opts.hair || HAIR_TONES.grey;
      L.top = '#f1f1ec'; L.legs = '#26394d'; L.shorts = true; L.barefoot = true;
      L.sleeve = { n: 1, color: '#f1f1ec' };
      A('cap', { color: '#16324f' }); A('sunnies'); A('thongs', { color: '#c94f3d' });
      break;
    }
    case 'guide': {
      L.character = w ? 'W_Casual' : 'M_Casual2';
      L.skin = skinOf(w ? SKIN_TONES.brown : SKIN_TONES.light);
      L.top = '#0f7c8a'; L.legs = '#1d2b3a'; L.shorts = true; L.barefoot = true; L.sleeve = { n: 1, color: '#0f7c8a' };
      A('hat', { color: '#f1ede0', band: '#0f7c8a', brim: 0.22 }); A('lanyard', { color: '#0f7c8a' }); A('sunnies'); A('thongs', { color: '#e8e4d8' });
      break;
    }
    case 'ranger': {
      L.character = w ? 'W_Adventurer' : 'M_Adventurer';   // khaki field gear, not recoloured
      L.skin = skinOf(SKIN_TONES.light); L.hair = opts.hair || HAIR_TONES.chestnut;
      A('hat', { color: '#6d6040', band: '#2d3326', brim: 0.25 }); A('badge'); A('radio'); A('sunnies');
      break;
    }
    case 'traditionalOwner': {
      // an Elder in everyday modern clothes: a collared shirt, long trousers, a plain soft hat in the sun. Nothing ceremonial.
      L.character = w ? 'W_Casual' : 'M_Casual2';
      L.skin = skinOf(SKIN_TONES.deep); L.hair = opts.hair || HAIR_TONES.white; L.scale = w ? 0.89 : 0.93;
      L.top = w ? '#5b7f99' : '#4a6a86'; L.legs = '#34373f'; L.sleeve = { n: 1, color: L.top };
      if (opts.hat !== false) A('hat', { color: '#cdbf9a', band: '#4a4338', brim: 0.18 });
      break;
    }
    case 'diveInstructor': {
      L.character = w ? 'W_Casual' : 'M_Beach';
      L.skin = skinOf(SKIN_TONES.tan); L.hair = opts.hair || HAIR_TONES.sunBleached; L.barefoot = true;
      L.suit = { color: '#15181d', top: '#15181d', legs: '#15181d', legN: 2, arms: 2, torso: true };
      A('bcd', { color: '#1c4f7a', trim: '#f2a413' }); A('tank'); A('regulator'); A('mask', { show: true });
      break;
    }
    default: {   // tourist
      L.character = opts.character || (w ? pick(r, WOMEN) : pick(r, MEN));
      L.skin = skinOf(pick(r, SKIN_LIST)); L.hair = opts.hair || pick(r, HAIR_COMMON);
      const bright = ['#e4572e', '#1789a8', '#f2a413', '#2a9d8f', '#d1495b', '#3b5bdb', '#e9e6df', '#7b9e3f'];
      const mode = r();
      if (season && mode < 0.4) { const c = pick(r, ['#16324f', '#14181c', '#0f6f7c']); L.suit = { color: c, top: pick(r, bright), legs: c, legN: 2, arms: 2, torso: true }; L.barefoot = true; }
      else if (mode < 0.65) { L.suit = { color: pick(r, bright), top: pick(r, bright), arms: 2, legN: 0, torso: true }; L.legs = pick(r, ['#1d3557', '#2f4858', '#8d3b4a']); L.shorts = true; L.barefoot = true; }
      else { L.top = pick(r, bright); L.legs = pick(r, ['#1d3557', '#c7b89a', '#2b3440', '#e8d8b9']); L.shorts = r() < 0.7; L.barefoot = L.shorts; if (r() < 0.4) L.sleeve = { n: 2, color: L.top }; }
      const h = r();
      if (h < 0.4) A('hat', { color: pick(r, ['#d9c9a0', '#f1ede0', '#4a6a86', '#e4572e', '#caa54a']), band: shade('#4a6a86', 0.5) });
      else if (h < 0.65) A('cap', { color: pick(r, bright) });
      if (r() < 0.6) A('sunnies');
      if (L.barefoot && r() < 0.5) A('thongs', { color: pick(r, bright) });
    }
  }
  return L;
}
