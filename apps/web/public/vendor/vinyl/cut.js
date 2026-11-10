// The lathe: turns audio into groove geometry.
// Output is the normal displacement (metres) of the inner wall (left channel) and the outer wall
// (right channel) of a 45/45 stereo groove, sampled uniformly in groove angle, plus the spiral
// radius table. Sample index i <-> groove angle theta = 2*pi*i/spr <-> time i/fs at 33 1/3 rpm.
import { TAU, T1, T2, T3, G1K, onePole } from './dsp.js';
import {
  REV_SECONDS, R_LEADIN, R_PROGRAM, R_PROGRAM_MIN, R_LOCK, GROOVE_W, LAND_MIN, TAB_PER_REV,
} from './geometry.js';

const SQ2 = Math.SQRT2;

// Acceleration limiter (de-esser): scales only the band above ~3 kHz so that the cut wall
// acceleration stays below aMax. Look-ahead via a backward then forward pass.
function deEss(x, fs, accelScale, aMax) {
  const n = x.length, hi = new Float32Array(n), g = new Float32Array(n);
  const k = onePole(3000, fs), fs2 = fs * fs;
  let lo = 0, h1 = 0, h2 = 0, any = false;
  for (let i = 0; i < n; i++) {
    lo += k * (x[i] - lo);
    const h = x[i] - lo; hi[i] = h;
    const a = Math.abs(h - 2 * h1 + h2) * fs2 * accelScale;
    h2 = h1; h1 = h;
    g[i] = a > aMax ? aMax / a : 1;
    if (a > aMax) any = true;
  }
  if (!any) return 0;
  const ka = onePole(1 / 0.0008, fs) , kr = onePole(1 / 0.03, fs);
  let s = 1;
  for (let i = n - 1; i >= 0; i--) { s = Math.min(g[i], s + (1 - s) * ka); g[i] = s; }
  s = 1; let minG = 1;
  for (let i = 0; i < n; i++) {
    s = Math.min(g[i], s + (1 - s) * kr);
    x[i] -= hi[i] * (1 - s);
    if (s < minG) minG = s;
  }
  return -20 * Math.log10(minG);
}

// RIAA pre-emphasis + velocity->displacement, in place.
// d = (Vfs/G1K) * shelf(x) * (T3 + 1/s): the 75us term is exact, the integral uses a 4-point rule.
function emphasiseAndIntegrate(x, fs, scale) {
  const n = x.length, K = 2 * fs;
  const b0 = (1 + T1 * K) / (1 + T2 * K), b1 = (1 - T1 * K) / (1 + T2 * K), a1 = (1 - T2 * K) / (1 + T2 * K);
  const leak = Math.exp(-TAU * 5 / fs), kdc = onePole(5, fs), c = 1 / (24 * fs);
  let xp = 0, up = 0;             // shelf state (previous in/out)
  let um2 = 0, um1 = 0, u0 = 0, I = 0, lpI = 0;
  const shelf = (v) => { const u = b0 * v + b1 * xp - a1 * up; xp = v; up = u; return u; };
  u0 = shelf(x[0]);
  for (let i = 0; i < n; i++) {
    const u1 = shelf(i + 1 < n ? x[i + 1] : 0);
    I = leak * I + (-um2 + 13 * um1 + 13 * u0 - u1) * c;
    lpI += kdc * (I - lpI);
    x[i] = scale * (T3 * u0 + I - lpI);
    um2 = um1; um1 = u0; u0 = u1;
  }
}

// Automatic depth control: when vertical modulation would lift the cutter out of the lacquer,
// cut deeper (slowly), exactly like a lathe's depth preview.
function depthControl(win, wout, fs, zMax) {
  const n = win.length, need = new Float32Array(n);
  let any = false;
  for (let i = 0; i < n; i++) {
    const z = (win[i] + wout[i]) / SQ2 - zMax;
    if (z > 0) { need[i] = z; any = true; }
  }
  if (!any) return false;
  const Wm = Math.round(0.12 * fs), dq = new Int32Array(2 * Wm + 2), mx = new Float32Array(n);
  let head = 0, tail = 0; const cap = dq.length;
  for (let i = 0; i < n + Wm; i++) {            // sliding max over [i-2Wm, i] -> centred at i-Wm
    if (i < n) {
      while (head !== tail && need[dq[(tail + cap - 1) % cap]] <= need[i]) tail = (tail + cap - 1) % cap;
      dq[tail] = i; tail = (tail + 1) % cap;
    }
    while (head !== tail && dq[head] < i - 2 * Wm) head = (head + 1) % cap;
    if (i >= Wm) mx[i - Wm] = head !== tail ? need[dq[head]] : 0;
  }
  const h = Wm >> 1;
  for (let pass = 0; pass < 2; pass++) {        // two box blurs (total span <= Wm)
    const src = pass ? need : mx, dst = pass ? mx : need;
    let acc = 0;
    for (let i = -h; i < n + h; i++) {
      if (i + h < n) acc += src[i + h];
      if (i - h - 1 >= 0) acc -= src[i - h - 1];
      if (i >= 0 && i < n) dst[i] = acc / (2 * h + 1);
    }
  }
  for (let i = 0; i < n; i++) { const d = mx[i] / SQ2 * 1.02; win[i] -= d; wout[i] -= d; }
  return true;
}

// tracks: [{ L: Float32Array, R: Float32Array, title? }], all at sample rate fs.
export function cut(tracks, fs, o = {}) {
  const spr = fs * REV_SECONDS;
  const cutPeak = o.cutPeak ?? 0.14;           // wall velocity (m/s) of a full-scale 1 kHz tone
  const aMax = o.aMax ?? 12000;                // wall acceleration limit (m/s^2)
  const leadIn = Math.round(3 * spr), gap = Math.round(2 * spr), tail = Math.round(1 * spr);
  let P = leadIn + tail;
  for (const t of tracks) P += t.L.length;
  P += gap * Math.max(0, tracks.length - 1);
  const alloc = P + Math.ceil(19 * spr);
  const A = new Float32Array(alloc), B = new Float32Array(alloc);
  const marks = [];
  let pos = leadIn, peak = 1e-3;
  for (const t of tracks) {
    A.set(t.L, pos); B.set(t.R || t.L, pos);
    for (let i = 0; i < t.L.length; i++) peak = Math.max(peak, Math.abs(t.L[i]), Math.abs((t.R || t.L)[i]));
    marks.push({ title: t.title || '', i0: pos, i1: pos + t.L.length });
    pos += t.L.length + gap;
  }
  const Vfs = cutPeak / peak, scale = Vfs / G1K;
  const xa = A.subarray(0, P), xb = B.subarray(0, P);

  // subsonic filter + elliptical EQ (mono the bass so it cuts laterally)
  const k7 = onePole(7, fs), ke = onePole(o.ellipticalHz ?? 150, fs);
  let la = 0, lb = 0, ls = 0;
  for (let i = 0; i < P; i++) {
    la += k7 * (xa[i] - la); lb += k7 * (xb[i] - lb);
    const l = xa[i] - la, r = xb[i] - lb, m = (l + r) * 0.5;
    let s = (l - r) * 0.5; ls += ke * (s - ls); s -= ls;
    xa[i] = m + s; xb[i] = m - s;
  }
  const deEssDb = Math.max(deEss(xa, fs, scale * (T1 / T2) * T3, aMax), deEss(xb, fs, scale * (T1 / T2) * T3, aMax));
  emphasiseAndIntegrate(xa, fs, scale);
  emphasiseAndIntegrate(xb, fs, scale);
  for (let i = 0; i < P; i++) xb[i] = -xb[i];   // outer wall moves opposite so L=R cuts laterally
  depthControl(xa, xb, fs, o.zMax ?? 9e-6);

  // --- variable pitch: pack the spiral using one revolution of preview ---
  const revsP = Math.ceil(P / spr);
  const eIn = new Float64Array(revsP + 2), eOut = new Float64Array(revsP + 2);
  for (let i = 0; i < P; i++) {
    const n = (i / spr) | 0;
    if (-xa[i] * SQ2 > eIn[n]) eIn[n] = -xa[i] * SQ2;
    if (-xb[i] * SQ2 > eOut[n]) eOut[n] = -xb[i] * SQ2;
  }
  const pitch = new Float64Array(revsP);
  const gapRevs = new Uint8Array(revsP);
  for (let m = 0; m + 1 < marks.length; m++) gapRevs[Math.floor((marks[m].i1 + gap * 0.25) / spr)] = 1;
  let need = 0;
  for (let n = 0; n < revsP; n++) {
    pitch[n] = 2 * GROOVE_W + LAND_MIN + Math.max(eIn[n], eIn[n + 1]) + Math.max(eOut[n], eOut[n + 1]);
    if (n < 2) pitch[n] = (R_LEADIN - R_PROGRAM) / 2;
    else { if (gapRevs[n]) pitch[n] += 0.6e-3; need += pitch[n]; }
  }
  const room = R_PROGRAM - R_PROGRAM_MIN;
  const extra = Math.max(0, Math.min(o.maxExtra ?? 70e-6, (room - need) / Math.max(1, revsP - 2)));
  let revsUsed = revsP, acc = 0, truncated = false;
  for (let n = 2; n < revsP; n++) {
    pitch[n] += extra; acc += pitch[n];
    if (acc > room) { revsUsed = n; truncated = true; break; }
  }
  if (truncated) P = Math.floor(revsUsed * spr);

  // radius table: programme, lead-out spiral, locked groove (last revolution is a closed circle)
  const rEndProg = R_LEADIN - pitch.subarray(0, revsUsed).reduce((a, b) => a + b, 0);
  const loRevs = Math.max(2, Math.ceil((rEndProg - R_LOCK) / 6.4e-3));
  const progKnots = Math.ceil(P / spr * TAB_PER_REV);
  const loKnots = loRevs * TAB_PER_REV, lockKnots = Math.round(1.5 * TAB_PER_REV);
  const nK = progKnots + loKnots + lockKnots + 1;
  const pk = new Float64Array(nK), tmp = new Float64Array(nK), rTab = new Float64Array(nK);
  let loPitch = (rEndProg - R_LOCK) / loRevs;
  for (let iter = 0; iter < 3; iter++) {
    for (let k = 0; k < nK; k++) {
      pk[k] = k < progKnots ? pitch[Math.min(revsUsed - 1, (k / TAB_PER_REV) | 0)] : k < progKnots + loKnots ? loPitch : 0;
    }
    const h = 8;
    for (let pass = 0; pass < 2; pass++) {
      const s = pass ? tmp : pk, d = pass ? pk : tmp;
      for (let k = 0; k < nK; k++) {
        let a = 0;
        for (let j = -h; j <= h; j++) { const q = k + j; a += q < 0 ? s[0] : q >= nK ? 0 : s[q]; }
        d[k] = a / (2 * h + 1);
      }
    }
    let r = R_LEADIN;
    for (let k = 0; k < nK; k++) { rTab[k] = r; r -= pk[k] / TAB_PER_REV; }
    loPitch += (rTab[nK - 1] - R_LOCK) / loRevs;
  }
  const thetaEnd = (nK - 1) * TAU / TAB_PER_REV;
  const n = Math.min(alloc, Math.ceil(thetaEnd * spr / TAU));
  if (truncated) { A.fill(0, P, n); B.fill(0, P, n); }
  return {
    fs, spr, n, wallIn: A.subarray(0, n), wallOut: B.subarray(0, n),
    rTab, thetaEnd, thetaLock: thetaEnd - TAU, W: GROOVE_W, Vfs, deEssDb, truncated,
    tracks: marks.filter((m) => m.i0 < P).map((m) => ({
      title: m.title, theta0: m.i0 * TAU / spr, theta1: Math.min(m.i1, P) * TAU / spr,
    })),
  };
}
