// The integration loop. Per output sample: platter + arm kinematics (exact). Per oversampled step:
// stylus tip (2 DOF) on Hertzian unilateral wall contacts with friction, cantilever suspension,
// tonearm (swing + lift), moving-magnet generator, coil/cable resonance, RIAA de-emphasis.
import { TAU, onePole } from './dsp.js';
import {
  ARM_LE as LE, ARM_BETA, PIVOT_X as PX, PIVOT_Y as PY, ALPHA_REST, ALPHA_MIN, R_DISC,
  grooveRadius, thetaForRadius,
} from './geometry.js';
import { warpHeight } from './press.js';

export const DT = 12, PH = 64, WLEN = 128;
const IS2 = Math.SQRT1_2, SQ2 = Math.SQRT2;
const CB = Math.cos(ARM_BETA), SB = Math.sin(ARM_BETA);
const IP = 0.017, KD = 0.4, KB = 10.7, TQMAX = 0.045, COFF = 0.004, BEAR_V = 2e-4, BEAR_C = 3e-4;   // platter drive
const KHAND = IP * 120 * 120, CHAND = 2 * IP * 120;
const Z_UP = 5e-3, Z_DOWN = -2e-3, V_UP = 0.03, V_DOWN = 0.006, WH = 40, VE2 = 1e-6;
const Z_TOP = 0.012, CV = 0.03;   // vertical travel stop, vertical bearing damping (N s/m)
const TINY = 1e-22;   // keeps decaying states out of the (slow) subnormal range

// Signed gap between the tip sphere and one side of the groove cross-section (wall, top corner or
// land), mirrored so the wall is on the x<0 side. Sets the contact normal (gNx, gNz).
let gNx = 0, gNz = 1, W_ = 30e-6, R_ = 18e-6;
function gapTo(x, hc, d) {
  const dist = (x + hc + W_) * IS2 - d;
  if (hc - dist * IS2 <= 0) { gNx = IS2; gNz = IS2; return dist - R_; }
  const xe = SQ2 * d - W_;
  if (x <= xe) { gNx = 0; gNz = 1; return hc - R_; }
  const dx = x - xe, l = Math.sqrt(dx * dx + hc * hc);
  gNx = dx / l; gNz = hc / l; return l - R_;
}

export function process(e, outL, outR, N) {
  const p = e.p, rec = e.rec, OS = e.OS, fsF = e.fsF, dt = 1 / fsF, dtS = 1 / e.fs;
  const C = e.C, H = e.H, NT = e.NT, ringL = e.ringL, ringR = e.ringR, wIn = e.wIn, wOut = e.wOut;
  const rTab = rec ? rec.rTab : null, thetaEnd = rec ? rec.thetaEnd : 0, kD = rec ? 2 * rec.spr / TAU : 0;
  const ex = rec ? rec.ecc[0] : 0, ey = rec ? rec.ecc[1] : 0, warp = rec ? rec.warp : [];
  W_ = rec ? rec.W : 30e-6; R_ = p.R;
  const { kc, k1, c0, mu, kH, mt, mEff, vtf } = p, cH = 1.5 * p.hc;
  const dC = (mt / (dt * dt) / (1.5 * kH)) ** 2, nC = kH * dC * Math.sqrt(dC), kC = 1.5 * kH * Math.sqrt(dC);
  const kmw = 1 - Math.exp(-dt * k1 / p.c1), Ih = mEff * LE * LE, kq = mEff * 9e4, cq = 2 * mEff * 300;
  const tqAS = p.antiskate * LE, CAZ = Math.cos(p.azimuth), SAZ = Math.sin(p.azimuth);
  const [lb0, lb1, lb2, la1, la2] = e.lcr, [rb0, rb1, rb2, ra1, ra2] = e.riaaF, [sb0, sb1, sb2, sa1, sa2] = e.riaaS;
  const kv = onePole(1.5, e.fs), kr1 = onePole(30, e.fs), kr2 = onePole(6, e.fs), kdr = onePole(1.5, e.fs);
  const rumS = p.rumble * 0.1e-6 / (0.289 * Math.sqrt(kr1 * 3 / 16));
  const gain = p.volume / (rec ? rec.Vfs : 1);
  const fz = e.fz, ru = e.ru, rand = e.rand, tel = e.tel, reader = e.reader;
  let l1 = fz[0], l2 = fz[1], l3 = fz[2], l4 = fz[3], r1 = fz[4], r2 = fz[5], r3 = fz[6], r4 = fz[7];
  let s1 = fz[8], s2 = fz[9], s3 = fz[10], s4 = fz[11];
  const S = e.s;
  let thp = S[0], wp = S[1], al = S[2], ald = S[3], zb = S[4], zbd = S[5], xi = S[6], xid = S[7], ze = S[8], zed = S[9], mwx = S[10], mwz = S[11], gn = S[12], xgP = S[13], hcP = S[14], dpIn = S[15], dpOut = S[16], zs = S[17], zcue = S[18], rp = S[19] | 0, wj0 = S[20] | 0, t = S[21], drift = S[22], dragTq = S[23], bs = S[24], vtfS = S[25];

  const motor = e.motor, hpOn = e.hpOn, wSet = e.wSet, flut = p.flutter;
  for (let i = 0; i < N; i++) {
    t += dtS;
    const hOn = e.hOn, hAl = e.hAl;
    // ---------- platter: motor + belt, bearing, stylus drag, a hand on the record ----------
    drift += kdr * ((rand() - 0.5) * 0.07 - drift);
    const wref = wSet * (1 + flut * (2.5e-4 * Math.sin(TAU * 4.6 * t) + drift));
    let tq = -COFF * wp;
    if (motor) {
      bs += (wref - wp) * dtS;
      tq = KB * bs + KD * (wref - wp);
      if (tq > TQMAX) { tq = TQMAX; bs = Math.min(bs, TQMAX / KB); } else if (tq < -TQMAX) { tq = -TQMAX; bs = Math.max(bs, -TQMAX / KB); }
    } else bs = 0;
    tq -= BEAR_V * wp + BEAR_C * wp / (Math.abs(wp) + 0.02) + dragTq;
    if (hpOn) tq += KHAND * (e.hpT - thp) - CHAND * wp;
    wp += tq / IP * dtS; thp += wp * dtS;

    // ---------- cue lever / hand automation ----------
    zcue += Math.max(-V_DOWN * dtS, Math.min(V_UP * dtS, (e.cueUp ? Z_UP : Z_DOWN) - zcue));
    if (e.auto === 1) { if (zb > Z_UP - 5e-4) e.auto = 2; }
    else if (e.auto === 2) {
      e.hAl += Math.max(-0.8 * dtS, Math.min(0.8 * dtS, e.autoAl - e.hAl));
      if (Math.abs(e.autoAl - al) < 2e-4 && Math.abs(ald) < 2e-3) { e.auto = 0; e.hOn = false; e.cueUp = e.autoAl >= ALPHA_REST - 0.02; }
    }

    // ---------- rumble (bearing noise) and knocks on the plinth ----------
    // bearing noise: band-limited (6-30 Hz, 18 dB/oct) displacement of the disc under the stylus
    ru[0] += kr1 * (rand() - 0.5 - ru[0]); ru[1] += kr1 * (ru[0] - ru[1]); ru[2] += kr1 * (ru[1] - ru[2]); ru[3] += kr2 * (ru[2] - ru[3]);
    ru[4] += kr1 * (rand() - 0.5 - ru[4]); ru[5] += kr1 * (ru[4] - ru[5]); ru[6] += kr1 * (ru[5] - ru[6]); ru[7] += kr2 * (ru[6] - ru[7]);
    if (e.kick) { ru[9] += 0.012 * e.kick; e.kick = 0; }
    if (ru[9] !== 0) {                               // plinth on its feet: 12 Hz, damped
      ru[9] += (-5685 * ru[8] - 45 * ru[9]) * dtS; ru[8] += ru[9] * dtS;
      if (Math.abs(ru[8]) < 1e-12 && Math.abs(ru[9]) < 1e-10) { ru[8] = 0; ru[9] = 0; }
    }

    // ---------- exact kinematics: where is the cartridge over the (rotating, off-centre) disc ----------
    const ca = Math.cos(al), sa = Math.sin(al), cp = Math.cos(thp), sp = Math.sin(thp);
    const fx = ca * CB + sa * SB, fy = sa * CB - ca * SB, lx = -fy, ly = fx;       // cartridge axes
    const Cx = ex * cp + ey * sp, Cy = -ex * sp + ey * cp;                          // disc centre
    const qx = PX + LE * ca - Cx + 0.5 * rumS * (ru[6] - ru[7]) + 0.5 * ru[8], qy = PY + LE * sa - Cy;
    const r = Math.hypot(qx, qy), erx = qx / r, ery = qy / r;                       // e_phi = (-ery, erx)
    const th0 = Math.atan2(qy, qx) + thp;
    const Cdx = wp * Cy, Cdy = -wp * Cx;
    const cSr = LE * (-sa * erx + ca * ery), cSph = LE * (sa * ery + ca * erx) / r;
    const eccR = -(Cdx * erx + Cdy * ery), eccPh = (Cdx * ery - Cdy * erx) / r;
    const cLr = lx * erx + ly * ery, cLph = (-lx * ery + ly * erx) / r, cLt = -cLph * r;
    const cFr = fx * erx + fy * ery, cFt = fx * ery - fy * erx;
    // past the rim the arm rides up a ramp (the edge of the lift platform) instead of falling off the disc
    const ramp = Z_DOWN + (Z_UP - Z_DOWN) * Math.min(1, Math.max(0, (r - (R_DISC - 5e-4)) / 0.003));
    const sup = zcue > ramp ? zcue : ramp;
    vtfS += kv * (vtf - vtfS);
    const zsNew = warpHeight(warp, r, th0) + rumS * (ru[2] - ru[3]) + ru[8];
    const dzs = (zsNew - zs) / OS;

    // ---------- which groove is under the tip ----------
    const rT = r + xi * cLr;
    let flat = 1, rg = 0, rg1 = 0, Th = 0;
    if (rTab) {
      if (hcP > R_ + 30e-6) gn = Math.round((thetaForRadius(rTab, rT) - th0) / TAU);
      Th = th0 + TAU * gn;
      if (Th >= thetaEnd) { const k = Math.floor((Th - thetaEnd) / TAU) + 1; gn -= k; Th -= k * TAU; }   // locked groove loops
      if (Th >= 0) {
        rg = grooveRadius(rTab, Th);
        const xg0 = rT - rg;
        if (xg0 > 20e-6) {
          if (Th - TAU >= 0 && xg0 > 0.5 * (grooveRadius(rTab, Th - TAU) - rg)) { gn--; Th -= TAU; rg = grooveRadius(rTab, Th); }
        } else if (xg0 < -20e-6 && Th + TAU < thetaEnd && -xg0 > 0.5 * (rg - grooveRadius(rTab, Th + TAU))) {
          gn++; Th += TAU; rg = grooveRadius(rTab, Th);
        }
        rg1 = (grooveRadius(rTab, Th + 0.02) - rg) * 50;
        flat = 0;
      }
    }
    const vg = r * (wp + cSph * ald + eccPh);        // speed of the vinyl under the tip
    let thB = Th, rB = r, nIn = 0, nOut = 0, dgSum = 0, hc = 0, xg = 0;

    for (let k = 0; k < OS; k++) {
      thB += (wp + cSph * ald + eccPh) * dt; rB += (cSr * ald + eccR) * dt; zs += dzs;
      const thT = thB + xi * cLph;
      xg = rB + xi * cLr - (rg + rg1 * (thT - Th));
      hc = zb + ze - zs;
      let Fr = 0, Fz = 0, Dg = 0; nIn = 0; nOut = 0;
      if (hc < R_ + 2e-6) {
        let din = 0, dout = 0;
        if (!flat && xg < 80e-6 && xg > -80e-6) {    // read the wall geometry under the tip
          const pos = thT * kD, j = Math.floor(pos) | 0;
          if (j - 5 < wj0 || j + 6 >= wj0 + WLEN) { wj0 = (j - 32) | 0; reader.fill(wj0, WLEN, wIn, wOut); }
          const f = (pos - j) * PH, ph = f | 0, g = f - ph, o = ph * DT, ib = (j - 5 - wj0) | 0;
          for (let q = 0; q < DT; q++) {
            let c = C[o + q]; c += g * (C[o + DT + q] - c);
            din += c * wIn[ib + q]; dout += c * wOut[ib + q];
          }
        }
        const vx = (xg - xgP) * fsF, vz = (hc - hcP) * fsF;
        let d1 = flat ? R_ - hc : -gapTo(xg, hc, din);              // inner wall (left channel)
        if (flat) { gNx = 0; gNz = 1; }
        if (d1 > 0) {
          let Nn = d1 < dC ? kH * d1 * Math.sqrt(d1) : nC + kC * (d1 - dC);
          if (dpIn > 0) Nn *= Math.max(0, Math.min(3, 1 + cH * (d1 - dpIn) * fsF));
          const vt = vx * gNz - vz * gNx, vm = Math.sqrt(vg * vg + vt * vt + VE2), Ft = -mu * Nn * vt / vm;
          Fr += Nn * gNx + Ft * gNz; Fz += Nn * gNz - Ft * gNx; Dg += mu * Nn * vg / vm; nIn = Nn;
        }
        dpIn = d1;
        if (!flat) {
          d1 = -gapTo(-xg, hc, dout);                               // outer wall (right channel)
          if (d1 > 0) {
            let Nn = d1 < dC ? kH * d1 * Math.sqrt(d1) : nC + kC * (d1 - dC);
            if (dpOut > 0) Nn *= Math.max(0, Math.min(3, 1 + cH * (d1 - dpOut) * fsF));
            const nx = -gNx, vt = vx * gNz - vz * nx, vm = Math.sqrt(vg * vg + vt * vt + VE2), Ft = -mu * Nn * vt / vm;
            Fr += Nn * nx + Ft * gNz; Fz += Nn * gNz - Ft * nx; Dg += mu * Nn * vg / vm; nOut = Nn;
          }
          dpOut = d1;
        }
      } else { dpIn = -1; dpOut = -1; }
      xgP = xg; hcP = hc; dgSum += Dg;

      // cantilever suspension, tonearm, tip
      const Fsx = kc * xi + k1 * (xi - mwx) + c0 * xid, Fsz = kc * ze + k1 * (ze - mwz) + c0 * zed;
      let Fq = 0;
      if (zb < sup) { Fq = kq * (sup - zb) - cq * zbd; if (Fq < 0) Fq = 0; }
      let ta = LE * (-(Fr * cFr + Dg * cFt) * SB + Fsx * CB) - 1e-5 * ald;
      if (Fq > 0) ta -= Ih * 150 * ald; else ta += tqAS;
      if (hOn) ta += Ih * (WH * WH * (hAl - al) - 2 * WH * ald);
      const aldd = ta / Ih, zbdd = (Fsz - vtfS + Fq - CV * zbd) / mEff;
      xid += ((Fr * cLr + Dg * cLt - Fsx) / mt - LE * aldd * CB) * dt + TINY; xi += xid * dt;
      zed += ((Fz - Fsz) / mt - zbdd) * dt + TINY; ze += zed * dt;
      ald += aldd * dt + TINY; al += ald * dt; zbd += zbdd * dt + TINY; zb += zbd * dt;
      mwx += (xi - mwx) * kmw; mwz += (ze - mwz) * kmw;

      // generator (velocity of tip relative to body on two 45-degree axes), coil+cable, RIAA
      const vxr = xid * CAZ - zed * SAZ, vzr = xid * SAZ + zed * CAZ;
      const eL = (vxr + vzr) * IS2 + 1e-30, eR = (vxr - vzr) * IS2 + 1e-30;
      let y = lb0 * eL + l1; l1 = lb1 * eL - la1 * y + l2; l2 = lb2 * eL - la2 * y;
      let u = rb0 * y + r1; r1 = rb1 * y - ra1 * u + r2; r2 = rb2 * y - ra2 * u;
      ringL[rp] = u; ringL[rp + NT] = u;
      y = lb0 * eR + l3; l3 = lb1 * eR - la1 * y + l4; l4 = lb2 * eR - la2 * y;
      u = rb0 * y + r3; r3 = rb1 * y - ra1 * u + r4; r4 = rb2 * y - ra2 * u;
      ringR[rp] = u; ringR[rp + NT] = u;
      rp++; if (rp === NT) rp = 0;
    }
    if (al > ALPHA_REST) { al = ALPHA_REST; if (ald > 0) ald = 0; }
    if (al < ALPHA_MIN) { al = ALPHA_MIN; if (ald < 0) ald = 0; }
    if (zb > Z_TOP) { zb = Z_TOP; if (zbd > 0) zbd = 0; } else if (zb < -4e-3) { zb = -4e-3; if (zbd < 0) zbd = 0; }   // bearing travel
    dragTq = dgSum / OS * r;

    // ---------- decimate; preamp input noise and hum go through their own RIAA ----------
    let aL = 0, aR = 0;
    for (let q = 0; q < NT; q++) { aL += H[q] * ringL[rp + q]; aR += H[q] * ringR[rp + q]; }
    const hm = p.hum ? p.hum * (3e-5 * Math.sin(TAU * 60 * t) + 1.2e-5 * Math.sin(TAU * 180 * t + 1)) : 0;
    const nl = hm + p.preNoise * 3.46 * (rand() - 0.5), nr = 0.8 * hm + p.preNoise * 3.46 * (rand() - 0.5);
    const yl = sb0 * nl + s1; s1 = sb1 * nl - sa1 * yl + s2; s2 = sb2 * nl - sa2 * yl;
    const yr = sb0 * nr + s3; s3 = sb1 * nr - sa1 * yr + s4; s4 = sb2 * nr - sa2 * yr;
    const oL = (aL + yl) * gain, oR = (aR + yr) * gain;
    outL[i] = oL; outR[i] = oR;

    tel.nIn += nIn; tel.nOut += nOut; tel.cnt++;
    if (!flat && hc < R_ && (nIn === 0 || nOut === 0)) tel.loss++;
    const pk = Math.abs(oL) > Math.abs(oR) ? Math.abs(oL) : Math.abs(oR);
    if (pk > tel.peak) tel.peak = pk;
    if (i === N - 1) { tel.theta = Th; tel.r = rT; tel.err = cLt; tel.vg = vg; tel.hc = hc; tel.xg = flat ? NaN : xg; }
  }

  if (!(Math.abs(xi) < 5e-3) || !(Math.abs(ze) < 5e-3) || !(Math.abs(zb) < 0.05) || !(al === al) || !(Math.abs(wp) < 60)) {
    e.blownWhy = [xi, ze, zb, al, wp, xid, zed];   // numerical blow-up guard: lift and reset the tip
    xi = xid = ze = zed = mwx = mwz = ald = zbd = 0; zb = Z_UP; zcue = Z_UP; e.cueUp = true;
    if (!(al === al)) al = ALPHA_REST;
    if (!(Math.abs(wp) < 60)) { wp = 0; thp = 0; bs = 0; dragTq = 0; }
    l1 = l2 = l3 = l4 = r1 = r2 = r3 = r4 = 0; ringL.fill(0); ringR.fill(0); hcP = 1; e.blown = (e.blown | 0) + 1;
  }
  fz[0] = l1; fz[1] = l2; fz[2] = l3; fz[3] = l4; fz[4] = r1; fz[5] = r2; fz[6] = r3; fz[7] = r4;
  fz[8] = s1; fz[9] = s2; fz[10] = s3; fz[11] = s4;
  S[0] = thp; S[1] = wp; S[2] = al; S[3] = ald; S[4] = zb; S[5] = zbd; S[6] = xi; S[7] = xid; S[8] = ze; S[9] = zed; S[10] = mwx; S[11] = mwz; S[12] = gn; S[13] = xgP; S[14] = hcP; S[15] = dpIn; S[16] = dpOut; S[17] = zs; S[18] = zcue; S[19] = rp; S[20] = wj0; S[21] = t; S[22] = drift; S[23] = dragTq; S[24] = bs; S[25] = vtfS;
}
