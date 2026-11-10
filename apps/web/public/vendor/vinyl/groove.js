// Stylus-tip / groove-wall geometry.
// A tip of radius rs cannot follow the wall exactly: its centre rides on the wall profile dilated by
// the tip's circle,  D(s) = max_u [ d(s+u) + sqrt(rs^2 - u^2) ] - rs.  This is the true source of
// tracing distortion, pinch effect and inner-groove treble loss (same wavelengths get shorter near
// the label because the vinyl moves slower there). D is evaluated lazily, per block, on a grid twice
// as fine as the cut, from an 8x band-limited reconstruction of the wall.
import { TAU, makePolyphase } from './dsp.js';
import { grooveRadius } from './geometry.js';

const UP = 8, UT = 32, BS = 1024, SLOTS = 32, DB = 2 * BS;

// Band-limited 8x reconstruction of the wall around cut sample t0 + UT/2 - 1 (small + hot on purpose:
// called per sample so the JIT optimises it once and keeps it).
function upsample(src, t0, n, up, fine, fo) {
  if (t0 >= 0 && t0 + UT <= n) {
    for (let p = 0; p < UP; p++) {
      let a = 0; const co = p * UT;
      for (let t = 0; t < UT; t++) a += up[co + t] * src[t0 + t];
      fine[fo + p] = a;
    }
  } else {
    for (let p = 0; p < UP; p++) {
      let a = 0; const co = p * UT;
      for (let t = 0; t < UT; t++) { const k = t0 + t; if (k >= 0 && k < n) a += up[co + t] * src[k]; }
      fine[fo + p] = a;
    }
  }
}

// Roll the tip over the reconstructed wall: highest point of (wall + tip circle), refined sub-sample.
function roll(fine, c, cap, M) {
  let best = -1, bk = 0;
  for (let k = -M; k <= M; k++) { const v = fine[c + k] + cap[k + M]; if (v > best) { best = v; bk = k; } }
  if (bk > -M && bk < M) {
    const y0 = fine[c + bk - 1] + cap[bk - 1 + M], y2 = fine[c + bk + 1] + cap[bk + 1 + M];
    const den = y0 - 2 * best + y2;
    if (den < 0) best -= 0.125 * (y2 - y0) * (y2 - y0) / den;
  }
  return best;
}

export class GrooveReader {
  constructor() {
    this.up = makePolyphase(UT, UP, 1, 9);
    this.rec = null;
    this.rScan = 18e-6;
    this.tag = new Int32Array(SLOTS).fill(-1);
    this.blk = Array.from({ length: SLOTS }, () => new Float32Array(2 * DB));
    this.fine = new Float32Array((BS + 80) * UP);
    this.cap = new Float32Array(601);
    this.computed = 0;
  }
  setRecord(rec) { this.rec = rec; this.tag.fill(-1); }
  setScan(r) { if (r !== this.rScan) { this.rScan = r; this.tag.fill(-1); } }

  // Copy dilated wall offsets D[j0 .. j0+len) (grid = 2 per cut sample) for both walls.
  fill(j0, len, outIn, outOut) {
    const nD = this.rec ? 2 * this.rec.n : 0;
    let j = j0, o = 0;
    while (o < len) {
      if (j < 0 || j >= nD) { outIn[o] = 0; outOut[o] = 0; j++; o++; continue; }
      const b = Math.floor(j / DB), s = b & (SLOTS - 1), blk = this.blk[s];
      if (this.tag[s] !== b) { this.compute(b, blk); this.tag[s] = b; }
      const base = j - b * DB, cnt = Math.min(len - o, DB - base);
      for (let k = 0; k < cnt; k++) { outIn[o + k] = blk[base + k]; outOut[o + k] = blk[DB + base + k]; }
      j += cnt; o += cnt;
    }
  }

  compute(b, out) {
    const rec = this.rec, n = rec.n, up = this.up, i0 = b * BS;
    const r = grooveRadius(rec.rTab, (i0 + BS / 2) * TAU / rec.spr);
    const h = TAU * r / rec.spr / UP;                 // metres of groove per fine sample
    const rs = this.rScan, M = Math.min(300, Math.ceil(rs / h));
    const cap = this.cap;
    for (let k = -M; k <= M; k++) cap[k + M] = Math.sqrt(Math.max(0, rs * rs - k * h * k * h)) - rs;
    const m = Math.ceil(M / UP) + 2, ia = i0 - m, cnt = BS + 2 * m;
    if (this.fine.length < cnt * UP) this.fine = new Float32Array(cnt * UP);
    const fine = this.fine;
    for (let wall = 0; wall < 2; wall++) {
      const src = wall ? rec.wallOut : rec.wallIn;
      for (let q = 0; q < cnt; q++) upsample(src, ia + q - UT / 2 + 1, n, up, fine, q * UP);
      const oo = wall * DB;
      for (let jj = 0; jj < DB; jj++) out[oo + jj] = roll(fine, (m + (jj >> 1)) * UP + (jj & 1) * (UP / 2), cap, M);
    }
    this.computed++;
  }
}
