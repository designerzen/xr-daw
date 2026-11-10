// Turntable physics engine: state, parameters and commands. The integration loop is in engine-core.js.
// Runs inside an AudioWorklet (and in node for tests). SI units.
import { TAU, makePolyphase, makeLowpass, bilinear, riaaPlayback, rng } from './dsp.js';
import { W33, ALPHA_REST, ALPHA_MIN, grooveRadius } from './geometry.js';
import { GrooveReader } from './groove.js';
import { process, DT, PH, WLEN } from './engine-core.js';

const G = 9.80665;
const E_VINYL = 3.4e9;            // reduced modulus E/(1-nu^2) of PVC against diamond (Pa)

// scan = tip radius along the groove, bear = radius along the wall, seat = radius seen from the front
export const STYLI = {
  conical:    { name: 'Conical 0.7 mil',          scan: 18e-6,  bear: 18e-6, seat: 18e-6, mt: 0.6e-6 },
  elliptical: { name: 'Elliptical 0.3 x 0.7 mil', scan: 7.6e-6, bear: 18e-6, seat: 18e-6, mt: 0.35e-6 },
  microline:  { name: 'Micro-line 0.1 x 3 mil',   scan: 2.5e-6, bear: 75e-6, seat: 18e-6, mt: 0.25e-6 },
};

const NT_PER = 32;

export class Engine {
  constructor(fs) {
    this.s = new Float64Array(32);                          // hot state (see FIELDS below)
    this.fs = fs;
    this.OS = Math.max(2, Math.min(8, Math.ceil(340000 / fs)));
    this.fsF = fs * this.OS;
    this.reader = new GrooveReader();
    this.rec = null;
    this.C = makePolyphase(DT, PH, 1, 7.5);                 // wall interpolation bank
    this.NT = NT_PER * this.OS;
    this.H = makeLowpass(this.NT, 0.96 / this.OS, 7);       // decimation filter
    this.ringL = new Float32Array(2 * this.NT); this.ringR = new Float32Array(2 * this.NT); this.rp = 0;
    this.wIn = new Float32Array(WLEN); this.wOut = new Float32Array(WLEN); this.wj0 = -1e9;
    this.rand = rng(12345);
    this.p = {
      vtf: 1.8e-3 * G, antiskate: 0, mEff: 0.0185,
      kc: 50, k1: 420, c1: 0.2, c0: 0.004,                  // cantilever suspension (Zener + dashpot)
      mu: 0.3, hc: 2.0,                                     // friction, contact damping (s/m)
      azimuth: 1.2 * Math.PI / 180,
      Lc: 0.45, Rc: 600, Cl: 200e-12, Rl: 47000,            // cartridge coil + cable + preamp load
      volume: 1, hum: 0, rumble: 1, flutter: 1, preNoise: 1e-5,
    };
    this.setAntiskate(1.8);
    this.vtfS = this.p.vtf;
    this.setStylus('elliptical');
    this.riaaF = riaaPlayback(this.fsF);
    this.riaaS = riaaPlayback(fs);
    this.fz = new Float64Array(12);                         // biquad states
    // platter
    this.thp = 0; this.wp = 0; this.motor = false; this.wSet = W33; this.t = 0; this.drift = 0;
    this.hpOn = false; this.hpT = 0; this.dragTq = 0;
    // arm body
    this.al = ALPHA_REST; this.ald = 0; this.zb = 5e-3; this.zbd = 0;
    this.cueUp = true; this.zcue = 5e-3; this.hOn = false; this.hAl = ALPHA_REST; this.auto = 0; this.autoAl = 0;
    // stylus tip (relative to the cartridge body) + suspension memory
    this.xi = 0; this.xid = 0; this.ze = 0; this.zed = 0; this.mwx = 0; this.mwz = 0;
    this.gn = 0; this.xgP = 0; this.hcP = 1; this.dpIn = -1; this.dpOut = -1;
    this.zs = 0; this.ru = new Float64Array(12); this.kick = 0;
    this.tel = { nIn: 0, nOut: 0, loss: 0, cnt: 0, peak: 0, theta: 0, r: 0, err: 0, vg: 0, hc: 1, xg: 0 };
  }

  setStylus(key) {
    const s = STYLI[key] || STYLI.elliptical;
    this.stylus = key;
    this.p.mt = s.mt; this.p.R = s.seat;
    this.p.kH = (4 / 3) * E_VINYL * Math.sqrt(Math.sqrt(s.scan * s.bear));   // Hertz: F = kH * delta^1.5
    this.reader.setScan(s.scan);
    this.wj0 = -1e9;
    this.updateElectrical();
  }
  setVtf(grams) { this.p.vtf = grams * 1e-3 * G; }
  // dial is calibrated like a real one: the setting that matches the tracking force cancels skating
  setAntiskate(grams) { this.p.antiskate = 0.115 * grams * 1e-3 * G; }
  updateElectrical() {
    const { Lc, Rc, Cl, Rl } = this.p;
    const k = 1 + Rc / Rl;
    this.lcr = bilinear([1, 0, 0], [1, (Lc / Rl + Rc * Cl) / k, Lc * Cl / k], this.fsF);
  }
  setRecord(rec) {
    this.rec = rec; this.reader.setRecord(rec); this.wj0 = -1e9; this.gn = 0;
  }
  set(o) {
    if (o.stylus) this.setStylus(o.stylus);
    if (o.vtf != null) this.setVtf(o.vtf);
    if (o.antiskate != null) this.setAntiskate(o.antiskate);
    for (const k of ['volume', 'hum', 'rumble', 'flutter']) if (o[k] != null) this.p[k] = o[k];
    if (o.capacitance != null) { this.p.Cl = o.capacitance * 1e-12; this.updateElectrical(); }
  }

  // --- controls ---
  setMotor(on) { this.motor = !!on; }
  setSpeed(rpm) { this.wSet = TAU * rpm / 60; }
  setCue(up) { this.cueUp = !!up; this.auto = 0; this.hOn = false; }
  hand(on, al) {                       // the user's fingers on the headshell
    this.auto = 0;
    if (on) { this.hOn = true; this.cueUp = true; this.hAl = Math.max(ALPHA_MIN, Math.min(ALPHA_REST, al)); }
    else { this.hOn = false; this.cueUp = false; }
  }
  cueTo(al) { this.auto = 1; this.autoAl = Math.max(ALPHA_MIN, Math.min(ALPHA_REST, al)); this.cueUp = true; this.hOn = true; this.hAl = this.al; }
  platterHand(on) { this.hpOn = !!on; this.hpT = this.thp; }
  platterMove(dTheta) { this.hpT += dTheta; }
  bump(strength = 1) { this.kick += strength; }   // knock on the plinth

  process(outL, outR, n) { process(this, outL, outR, n); }

  telemetry() {
    const t = this.tel, c = Math.max(1, t.cnt);
    const out = {
      thp: this.thp, wp: this.wp, al: this.al, zb: this.zb, ze: this.ze, xi: this.xi,
      cueUp: this.cueUp, motor: this.motor, hand: this.hOn, auto: this.auto,
      theta: t.theta, r: t.r, err: t.err, vg: t.vg, hc: t.hc, xg: t.xg,
      nIn: t.nIn / c, nOut: t.nOut / c, loss: t.loss / c, peak: t.peak,
      blocks: this.reader.computed,
    };
    t.nIn = t.nOut = t.loss = t.cnt = t.peak = 0;
    return out;
  }

  // Raw wall geometry around the stylus for the microscope view: for `rows` neighbouring grooves,
  // `cols` points spanning +-span cut samples. Returns edge positions (metres, relative to the
  // current groove centreline) of the inner and outer wall tops.
  grooveView(rows = 5, cols = 160, span = 400) {
    const rec = this.rec, out = new Float32Array(rows * cols * 2 + 2);
    if (!rec) return out;
    const th = this.tel.theta, s0 = th * rec.spr / TAU, rg0 = grooveRadius(rec.rTab, th), SQ2 = Math.SQRT2;
    const half = (rows - 1) / 2;
    for (let g = 0; g < rows; g++) {
      for (let c = 0; c < cols; c++) {
        const ds = (c / (cols - 1) * 2 - 1) * span;
        const thg = th + (g - half) * TAU + ds * TAU / rec.spr;
        const i = Math.round(s0 + (g - half) * rec.spr + ds), o = (g * cols + c) * 2;
        if (thg < 0 || thg > rec.thetaEnd || i < 0 || i >= rec.n) { out[o] = NaN; out[o + 1] = NaN; continue; }
        const rc = grooveRadius(rec.rTab, thg) - rg0;
        out[o] = rc - rec.W + SQ2 * rec.wallIn[i];
        out[o + 1] = rc + rec.W - SQ2 * rec.wallOut[i];
      }
    }
    out[rows * cols * 2] = this.tel.xg; out[rows * cols * 2 + 1] = this.tel.hc;
    return out;
  }
}

// Hot state lives in one Float64Array (no GC, no hidden-class churn); these are named views onto it.
export const FIELDS = ['thp', 'wp', 'al', 'ald', 'zb', 'zbd', 'xi', 'xid', 'ze', 'zed', 'mwx', 'mwz', 'gn', 'xgP', 'hcP',
  'dpIn', 'dpOut', 'zs', 'zcue', 'rp', 'wj0', 't', 'drift', 'dragTq', 'bs', 'vtfS'];
FIELDS.forEach((k, i) => Object.defineProperty(Engine.prototype, k, {
  get() { return this.s[i]; }, set(v) { this.s[i] = v; },
}));
