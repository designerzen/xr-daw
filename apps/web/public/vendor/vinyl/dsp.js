// Shared DSP helpers (used by the mastering lathe, the physics engine, and node tests).

export const TAU = Math.PI * 2;

// RIAA time constants (seconds)
export const T1 = 3180e-6, T2 = 318e-6, T3 = 75e-6;

// |H_rec(f)| of the RIAA *recording* curve (1+sT1)(1+sT3)/(1+sT2)
export function riaaRecGain(f) {
  const w = TAU * f;
  return Math.hypot(1, w * T1) * Math.hypot(1, w * T3) / Math.hypot(1, w * T2);
}
export const G1K = riaaRecGain(1000);

function besselI0(x) {
  let s = 1, t = 1;
  for (let k = 1; k < 40; k++) { t *= (x / (2 * k)) ** 2; s += t; if (t < 1e-12 * s) break; }
  return s;
}

// Kaiser-windowed sinc lowpass prototype, value at (possibly fractional) tap offset t.
function ksinc(t, half, cutoff, beta) {
  const a = t / half;
  if (Math.abs(a) >= 1) return 0;
  const x = Math.PI * cutoff * t;
  const s = Math.abs(x) < 1e-9 ? 1 : Math.sin(x) / x;
  return cutoff * s * besselI0(beta * Math.sqrt(1 - a * a)) / besselI0(beta);
}

// Polyphase fractional-delay bank. Row p (0..phases) holds `taps` coefficients such that
//   y(i + p/phases) = sum_t c[p*taps + t] * x[i - taps/2 + 1 + t]
// Row `phases` equals row 0 shifted by one sample (lets callers lerp between rows).
export function makePolyphase(taps, phases, cutoff = 1, beta = 8) {
  const c = new Float32Array((phases + 1) * taps);
  const half = taps / 2;
  for (let p = 0; p <= phases; p++) {
    const f = p / phases;
    let sum = 0;
    const row = new Float64Array(taps);
    for (let t = 0; t < taps; t++) { row[t] = ksinc(t - half + 1 - f, half, cutoff, beta); sum += row[t]; }
    for (let t = 0; t < taps; t++) c[p * taps + t] = row[t] / sum;
  }
  return c;
}

// Plain lowpass FIR (for decimation), unity DC gain.
export function makeLowpass(taps, cutoff, beta = 9) {
  const h = new Float32Array(taps);
  const mid = (taps - 1) / 2;
  let sum = 0;
  for (let t = 0; t < taps; t++) { h[t] = ksinc(t - mid, mid + 1, cutoff, beta); sum += h[t]; }
  for (let t = 0; t < taps; t++) h[t] /= sum;
  return h;
}

// Bilinear transform of an analog biquad (b0 + b1 s + b2 s^2)/(a0 + a1 s + a2 s^2).
// Returns [b0, b1, b2, a1, a2] with a0 normalised to 1.
export function bilinear(b, a, fs) {
  const K = 2 * fs, K2 = K * K;
  const A0 = a[0] + a[1] * K + a[2] * K2;
  return [
    (b[0] + b[1] * K + b[2] * K2) / A0,
    (2 * b[0] - 2 * b[2] * K2) / A0,
    (b[0] - b[1] * K + b[2] * K2) / A0,
    (2 * a[0] - 2 * a[2] * K2) / A0,
    (a[0] - a[1] * K + a[2] * K2) / A0,
  ];
}

// RIAA playback (de-emphasis) biquad, unity gain at 1 kHz.
export function riaaPlayback(fs) {
  return bilinear([G1K, G1K * T2, 0], [1, T1 + T3, T1 * T3], fs);
}

// One-pole coefficient for a lowpass with corner f: y += k * (x - y)
export const onePole = (f, fs) => 1 - Math.exp(-TAU * f / fs);

// Deterministic RNG (mulberry32) + gaussian.
export function rng(seed) {
  let a = seed >>> 0;
  const u = () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  u.gauss = () => {
    const r = Math.sqrt(-2 * Math.log(1 - u()));
    return r * Math.cos(TAU * u());
  };
  return u;
}
