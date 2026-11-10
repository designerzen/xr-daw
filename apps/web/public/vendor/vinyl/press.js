// The pressing plant (and a life of use): adds physical imperfections to the groove geometry itself.
// Nothing here is an audio effect: every defect is a change to wall shape or disc shape that the
// stylus later has to ride over.
import { TAU, onePole, rng } from './dsp.js';
import { grooveRadius, thetaForRadius, R_DISC, R_LOCK } from './geometry.js';

export const DEFAULT_CONDITION = {
  noise: 1,        // wall roughness (1 = good pressing)
  dust: 0.25,      // particles sitting in the groove
  scratches: 0.2,  // gouges across the grooves
  warp: 0.3,       // mm, peak height at the rim
  offCenter: 0.15, // mm, spindle hole eccentricity
  echo: 1,         // lacquer spring-back print-through from the neighbouring groove
};

// Wall roughness in metres. White part: vinyl grain. Red part: slow waviness from plating/pressing.
const ROUGH_WHITE = 0.7e-9, ROUGH_RED = 1.3e-9, ECHO = 0.006;   // calibrated: silent groove ~ -60 dB re 5 cm/s

export function press(rec, cond = DEFAULT_CONDITION, seed = 7) {
  const { wallIn: A, wallOut: B, n, spr, rTab, thetaEnd } = rec;
  const R = rng(seed);
  const S = Math.round(spr);
  const dsAt = (i) => TAU * grooveRadius(rTab, i * TAU / spr) / spr;   // metres of groove per sample

  // 1. groove echo: cutting groove n+1 pushes the land into groove n (pre-echo), and a little back.
  const e = ECHO * (cond.echo ?? 1);
  if (e > 0) {
    const k = onePole(2500, rec.fs);
    let lp = 0, lq = 0;
    for (let i = 0; i + S < n; i++) {
      lp += k * (B[i + S] - lp); A[i] -= e * lp;
      lq += k * (A[i] - lq); B[i + S] -= 0.35 * e * lq;
    }
  }

  // 2. wall roughness, independent per wall
  const q = cond.noise ?? 1;
  if (q > 0) {
    // xorshift32; each draw gives a unit-variance triangular value from its two 16-bit halves
    let s = (seed * 2654435761) >>> 0 || 1;
    const K = Math.sqrt(6) / 65536, leak = Math.exp(-TAU * 12 / rec.fs), w = ROUGH_WHITE * q * K, r = ROUGH_RED * q * K;
    let ra = 0, rb = 0;
    for (let i = 0; i < n; i++) {
      s ^= s << 13; s ^= s >>> 17; s ^= s << 5; ra = ra * leak + r * ((s & 65535) + (s >>> 16) - 65535);
      s ^= s << 13; s ^= s >>> 17; s ^= s << 5; rb = rb * leak + r * ((s & 65535) + (s >>> 16) - 65535);
      s ^= s << 13; s ^= s >>> 17; s ^= s << 5; A[i] += ra + w * ((s & 65535) + (s >>> 16) - 65535);
      s ^= s << 13; s ^= s >>> 17; s ^= s << 5; B[i] += rb + w * ((s & 65535) + (s >>> 16) - 65535);
    }
  }

  // 3. dust: bumps on a wall
  const bump = (arr, i, h, hl) => {
    for (let j = -hl; j <= hl; j++) { const k = i + j; if (k >= 0 && k < n) arr[k] += h * 0.5 * (1 + Math.cos(Math.PI * j / hl)); }
  };
  const nDust = Math.round((cond.dust ?? 0) * 6 * n / spr);
  for (let d = 0; d < nDust; d++) {
    const i = (R() * n) | 0;
    const size = Math.min(40e-6, 5e-6 * Math.exp(0.7 * R.gauss()));
    const hl = Math.max(2, Math.round(size / dsAt(i)));
    const h = size * (0.2 + 0.3 * R()), w = R();
    if (w < 0.8) bump(w < 0.4 ? A : B, i, h, hl); else { bump(A, i, h, hl); bump(B, i, h, hl); }
  }

  // 4. scratches: a line across the disc; where it crosses a groove it leaves a dent with raised lips
  const nScr = Math.round((cond.scratches ?? 0) * 12);
  const scratches = [];
  for (let sIdx = 0; sIdx < nScr; sIdx++) {
    const r0 = 0.062 + R() * 0.07, len = 0.003 + R() * 0.022, phi0 = R() * TAU, slant = (R() - 0.5) * 0.3;
    const depth = (1.5 + 4.5 * R()) * 1e-6, sig = (15 + 25 * R()) * 1e-6;
    scratches.push({ r0, r1: r0 + len, phi0, phi1: phi0 + slant });
    let fPrev = null, rPrev = r0;
    for (let rr = r0; rr <= r0 + len; rr += 20e-6) {
      const phi = phi0 + slant * (rr - r0) / len;
      const f = (thetaForRadius(rTab, rr) - phi) / TAU;
      if (fPrev !== null && Math.floor(f) !== Math.floor(fPrev)) {
        const m = Math.max(Math.floor(f), Math.floor(fPrev));
        const t = (m - fPrev) / (f - fPrev), rc = rPrev + t * (rr - rPrev);
        const theta = TAU * m + phi0 + slant * (rc - r0) / len;
        const i = Math.round(theta * spr / TAU);
        if (theta > 0 && theta < thetaEnd) {
          const ds = dsAt(i), hl = Math.ceil(4 * sig / ds);
          for (let j = -hl; j <= hl; j++) {
            const k = i + j; if (k < 0 || k >= n) continue;
            const x = j * ds, lip = (Math.abs(x) - 2.2 * sig) / (0.6 * sig);
            const p = depth * (-Math.exp(-x * x / (2 * sig * sig)) + 0.6 * Math.exp(-0.5 * lip * lip));
            A[k] += p; B[k] += p;
          }
        }
      }
      fPrev = f; rPrev = rr;
    }
  }

  // 5. disc shape: off-centre hole and warp (height harmonics growing towards the rim)
  const ecc = (cond.offCenter ?? 0) * 1e-3, ea = R() * TAU;
  rec.ecc = [ecc * Math.cos(ea), ecc * Math.sin(ea)];
  const wp = (cond.warp ?? 0) * 1e-3;
  rec.warp = wp > 0 ? [
    { k: 1, amp: wp * 0.7, ph: R() * TAU }, { k: 2, amp: wp * 0.35, ph: R() * TAU }, { k: 3, amp: wp * 0.12, ph: R() * TAU },
  ] : [];
  rec.scratches = scratches;
  rec.condition = { ...cond };
  return rec;
}

// Height of the disc surface (warp) at record-frame radius r, angle phi.
export function warpHeight(warp, r, phi) {
  let z = 0;
  const t = Math.max(0, (r - R_LOCK) / (R_DISC - R_LOCK));
  for (let i = 0; i < warp.length; i++) z += warp[i].amp * t * t * Math.cos(warp[i].k * phi + warp[i].ph);
  return z;
}

// What the eye sees: per revolution x angle, how hard the groove is modulated (RMS lateral slope).
// Rendered as light scatter on the disc, which is why loud passages look different on real vinyl.
export function makeVis(rec, cols = 512) {
  const { wallIn: A, wallOut: B, n, spr, rTab, thetaEnd } = rec;
  const rows = Math.ceil(thetaEnd / TAU) + 1;
  const acc = new Float32Array(rows * cols), data = new Uint8Array(rows * cols);
  const per = spr / cols;
  for (let i = 0; i + 1 < n; i++) {
    const d = (A[i + 1] - A[i]) - (B[i + 1] - B[i]);
    const rev = (i / spr) | 0, c = ((i - rev * spr) / per) | 0;
    acc[rev * cols + c] += d * d;
  }
  for (let rw = 0; rw < rows; rw++) {
    const ds = TAU * grooveRadius(rTab, (rw + 0.5) * TAU) / spr;
    for (let c = 0; c < cols; c++) {
      const slope = Math.sqrt(acc[rw * cols + c] / per) / ds;      // dimensionless wall slope
      data[rw * cols + c] = Math.min(255, Math.round(255 * Math.sqrt(slope / 0.6)));
    }
  }
  return { data, cols, rows };
}
