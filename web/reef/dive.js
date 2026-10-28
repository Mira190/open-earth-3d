// The physiology of the player in the water: air supply, no-decompression time, ascent rate,
// safety stop, breath-hold and ear pressure. No graphics, so autotest can drive it headlessly.
// Gas laws are real (ambient pressure = 1 + depth/10 atm); the tables are a simplified PADI-style
// recreational table. Nothing here kills the player: limits only warn, or trigger a gentle rescue.

export const ambient = depth => 1 + Math.max(depth, 0) / 10;

// depth (m) -> no-decompression limit (min), after the metric recreational tables
export const NDL_TABLE = [[10, 219], [12, 147], [15, 80], [18, 56], [21, 37], [24, 29], [27, 25], [30, 20], [35, 14], [40, 9]];
export function ndlAt(depth) {
  const T = NDL_TABLE;
  if (depth <= T[0][0]) return T[0][1];
  for (let i = 1; i < T.length; i++) if (depth <= T[i][0]) {
    const [d0, n0] = T[i - 1], [d1, n1] = T[i];
    return Math.exp(Math.log(n0) + (Math.log(n1) - Math.log(n0)) * (depth - d0) / (d1 - d0));   // straight in log space: the table falls geometrically
  }
  return T[T.length - 1][1];
}

// sea temperature by date: 27 C from October to March, 24 C in July and August, ramps between
const MONTH_T = [28, 28, 28, 27, 26, 25, 24, 24, 25, 26.5, 27, 27.5];
export function waterTemp(date = new Date(), depth = 0) {
  const m = date.getUTCMonth(), d = (date.getUTCDate() - 1) / 30;
  const a = MONTH_T[m], b = MONTH_T[(m + 1) % 12];
  const base = Math.abs(m) >= 0 && (m >= 9 || m <= 2) ? 27 : a + (b - a) * d;
  // a gentle thermocline: a tenth of a degree per metre below the mixed layer
  return Math.max(base - Math.max(depth - 6, 0) * 0.1, 20);
}

export class Diver {
  constructor({ tankBar = 300, tankL = 12, sac = 18, onEvent = () => {} } = {}) {
    this.tankBar = tankBar; this.tankL = tankL; this.sac = sac; this.onEvent = onEvent;
    this.reset();
  }
  reset(full = true) {
    if (full) this.air = this.tankBar;
    this.depth = 0; this.maxDepth = 0; this.diveTime = 0; this.load = 0;   // load: fraction of the no-deco limit used
    this.rate = 0;                                                         // ascent rate, m/min, up positive
    this.stopDue = false; this.stopTime = 0; this.decoDue = false; this.diving = false;
    this._prev = 0; this._rt = 0; this._warnAt = {}; this.airWarn = 0; this.outOfAir = false;
    this.regulator = false;
  }
  say(key, text, every = 9999, kind = 'info') {
    const now = this.diveTime;
    if (this._warnAt[key] !== undefined && now - this._warnAt[key] < every) return;
    this._warnAt[key] = now; this.onEvent(kind, text, key);
  }
  get ndl() { return Math.max(0, (1 - this.load) * ndlAt(Math.max(this.depth, 10))); }   // min left at the current depth
  get pressure() { return ambient(this.depth); }
  // breathing from the regulator at depth d, dt seconds; effort 0..1 (finning hard raises the rate)
  update(dt, depth, effort = 0.3, regulator = true) {
    this.regulator = regulator && depth > 0.3;
    const prev = this.depth; this.depth = Math.max(depth, 0);
    if (this.depth > 0.5) { this.diving = true; this.diveTime += dt; }
    this.maxDepth = Math.max(this.maxDepth, this.depth);
    // air: surface consumption times ambient pressure, in bar per minute from the cylinder volume
    if (this.regulator && !this.outOfAir) {
      const bpm = this.sac * (0.8 + 0.9 * effort) * ambient(depth) / this.tankL;
      this.air = Math.max(0, this.air - bpm * dt / 60);
      if (this.air <= 0) { this.outOfAir = true; this.say('oos', 'Out of air: emergency ascent, exhale as you rise', 30, 'bad'); }
      else if (this.air < 50) this.say('air50', `Reserve: ${this.air.toFixed(0)} bar. End the dive`, 40, 'warn');
      else if (this.air < 100) this.say('air100', '100 bar: start heading back', 9999, 'warn');
    }
    // nitrogen: use up the no-deco limit at this depth; shed it slowly when shallow
    if (this.depth > 9) this.load += dt / 60 / ndlAt(this.depth);
    else if (this.depth > 0.5) this.load += dt / 60 / 400 - dt / 60 / 160 * Math.max(0, 1 - this.depth / 6) * this.load * 0.4;
    else this.load = Math.max(0, this.load - this.load * dt / 60 / 140);
    if (this.load >= 1 && !this.decoDue && this.depth > 3) {
      this.decoDue = true;
      this.say('deco', 'No-decompression limit passed: ascend slowly to 5 m and hold a 3 minute stop', 60, 'bad');
    }
    // ascent rate over a 2 s window
    this._rt += dt;
    if (this._rt >= 0.5) { const inst = (this.depth - this._prev) / this._rt * -60; this.rate += (inst - this.rate) * 0.35; this._prev = this.depth; this._rt = 0; }
    if (this.rate > 18 && this.depth > 1.5) this.say('rate', `Slow down: ${this.rate.toFixed(0)} m/min, keep it under 18`, 8, 'warn');
    if (this.depth > 30) this.say('deep', `Depth limit: 30 m for recreational diving (${this.depth.toFixed(0)} m)`, 20, 'warn');
    else if (this.depth > 24) this.say('narc', 'Below 24 m: nitrogen narcosis can start, watch your air and time', 9999, 'info');
    // safety stop: 3 minutes at 5 m (4 to 6 m) after anything deeper than 10 m
    if (this.maxDepth >= 10 && !this._stopArmed) { this._stopArmed = true; this.stopDue = true; this.stopTime = 0; }
    if ((this.stopDue || this.decoDue) && this.depth >= 4 && this.depth <= 6) {
      this.stopTime += dt;
      if (this.stopTime >= 180) {
        if (this.decoDue) { this.decoDue = false; this.load = 0.85; this.say('decoOk', 'Decompression stop done: you are clear to surface slowly', 0, 'good'); }
        this.stopDue = false;
        this.say('stopOk', 'Safety stop complete: you can surface now', 0, 'good');
      }
    } else if ((this.stopDue || this.decoDue) && this.rate > 1 && this.depth < 8 && this.depth > 6) this.say('stop', 'Safety stop due: hold at 5 m for 3 minutes', 30, 'info');
    if (this.diving && this.depth < 0.3 && prev < 0.3 && this.diveTime > 20) this.surfaced();
  }
  get stopLeft() { return Math.max(0, 180 - this.stopTime); }
  surfaced() {
    if (!this.diving) return;
    if (this.decoDue) this.onEvent('bad', `You surfaced without the decompression stop (max ${this.maxDepth.toFixed(0)} m). Take a long surface interval`, 'surf');
    else if (this.stopDue && this.maxDepth >= 10) this.onEvent('warn', 'You skipped the safety stop. Rest at the surface before the next dive', 'surf');
    else if (this.maxDepth >= 3) this.onEvent('good', `Surfaced: max ${this.maxDepth.toFixed(1)} m, ${(this.diveTime / 60).toFixed(0)} min, ${this.air.toFixed(0)} bar left`, 'surf');
    this.diving = false; this.diveTime = 0; this.maxDepth = 0; this._stopArmed = false; this.stopDue = false; this.stopTime = 0; this._warnAt = {};
    this.decoDue = false; this.outOfAir = this.air <= 0;
  }
}

// A held breath: tolerable for about a minute, sooner when working or deep.
export class BreathHold {
  constructor({ capacity = 75, onEvent = () => {} } = {}) { this.capacity = capacity; this.t = 0; this.onEvent = onEvent; this._lvl = 0; this.depthMax = 0; }
  get fraction() { return Math.min(1, this.t / this.capacity); }
  get left() { return Math.max(0, this.capacity - this.t); }
  update(dt, depth, effort = 0.3, holding = true) {
    if (holding) {
      this.t += dt * (0.8 + effort * 0.9 + Math.max(depth, 0) * 0.025);
      this.depthMax = Math.max(this.depthMax, depth);
      const f = this.fraction, lvl = f > 1 ? 3 : f > 0.8 ? 2 : f > 0.5 ? 1 : 0;
      if (lvl > this._lvl) {
        this._lvl = lvl;
        if (lvl === 1) this.onEvent('info', 'Your diaphragm contracts: normal, but you are halfway', 'breath1');
        if (lvl === 2) this.onEvent('warn', 'Breath running out: head up now', 'breath2');
        if (lvl === 3) this.onEvent('bad', 'Out of breath: surfacing', 'breath3');
      }
    } else { this.t = Math.max(0, this.t - dt * 3); if (this.t < 2) { this._lvl = 0; this.depthMax = 0; } }
  }
}

// Ears: pressure rises 0.1 atm per metre; equalising (pinch and blow) resets the difference.
export class Ears {
  constructor({ onEvent = () => {} } = {}) { this.eq = 0; this.onEvent = onEvent; this.level = 0; }
  get diff() { return ambient(this._d || 0) - ambient(this.eq); }
  update(depth) {
    this._d = Math.max(depth, 0);
    if (this._d < this.eq) this.eq = this._d;                // rising: the Eustachian tube vents by itself
    const diff = this.diff, lvl = diff > 0.5 ? 2 : diff > 0.25 ? 1 : 0;
    if (lvl > this.level && lvl === 1) this.onEvent('info', 'Ears: pinch your nose and blow gently (Q to equalise)', 'ear1');
    if (lvl > this.level && lvl === 2) this.onEvent('warn', 'Ear pain: stop descending and equalise (Q)', 'ear2');
    this.level = lvl;
    return lvl;
  }
  equalise() {
    if (this.diff > 0.7) { this.onEvent('warn', 'Too much pressure: rise a metre or two, then try again', 'ear3'); this.eq += (this._d - this.eq) * 0.3; return false; }
    this.eq = this._d; this.level = 0; return true;
  }
}
