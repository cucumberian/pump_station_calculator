"use strict";

function solveTk(Q, Qr, tr, n) {
  const f = T => Qr * ((T / tr) ** (1 - n) - (T / tr - 1) ** (1 - n));
  let lo = tr, hi = tr * 2;
  while (f(hi) > Q) hi *= 2;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    if (f(mid) > Q) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

function calc(Q, Qr, tr, n) {
  const tn = tr * (Q / Qr) ** (1 / (1 - n));
  const tk = solveTk(Q, Qr, tr, n);
  const W = 0.06 * Qr * tr / (2 - n) * (
    (tk / tr) ** (2 - n) - (tn / tr) ** (2 - n) - (tk / tr - 1) ** (2 - n)
    - Q / Qr * (2 - n) * (tk / tr - tn / tr)
  );
  return { tn, tk, W: Math.max(W, 0) };
}

function hydro(T, Qr, tr, n) {
  const x = T / tr;
  return Qr * (x ** (1 - n) - (x > 1 ? (x - 1) ** (1 - n) : 0));
}

const HYDRO_DT = 0.2;

function sampleHydro(Qr, tr, n, tMax, dt = HYDRO_DT) {
  const ts = [], qs = [];
  const N = Math.max(2, Math.ceil(tMax / dt));
  for (let i = 0; i <= N; i++) {
    const t = i * dt;
    ts.push(t);
    qs.push(hydro(t, Qr, tr, n));
  }
  return { t: ts, q: qs };
}

function shiftSeries(s, delay) {
  return { t: s.t.map(t => t + delay), q: s.q.slice() };
}

function interpAt(s, t) {
  const { t: ts, q: qs } = s;
  if (t <= ts[0]) return t === ts[0] ? qs[0] : 0;
  if (t >= ts[ts.length - 1]) return 0;
  let lo = 0, hi = ts.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (ts[mid] <= t) lo = mid; else hi = mid;
  }
  const f = (t - ts[lo]) / (ts[hi] - ts[lo]);
  return qs[lo] + f * (qs[hi] - qs[lo]);
}

function combineSeries(list, dt = HYDRO_DT) {
  const valid = list.filter(Boolean);
  if (!valid.length) return { t: [0], q: [0] };
  const tMax = Math.max(...valid.map(s => s.t[s.t.length - 1]));
  const N = Math.max(2, Math.ceil(tMax / dt));
  const ts = [], qs = [];
  for (let i = 0; i <= N; i++) {
    const t = i * dt;
    ts.push(t);
    let q = 0;
    for (const s of valid) q += interpAt(s, t);
    qs.push(q);
  }
  return { t: ts, q: qs };
}

function numericCalc(Q, s) {
  const { t, q } = s;
  let tn = null, tk = null, V = 0, W = 0;
  for (let i = 0; i < t.length - 1; i++) {
    const e0 = q[i] - Q, e1 = q[i + 1] - Q;
    const dt = t[i + 1] - t[i];
    if (e0 > 0 && e1 > 0) {
      if (tn === null) tn = t[i];
      tk = t[i + 1];
    } else if (e0 > 0 || e1 > 0) {
      const tc = t[i] + Math.abs(e0) / (Math.abs(e0) + Math.abs(e1)) * dt;
      if (e1 > 0) {
        if (tn === null) tn = tc;
      } else {
        tk = tc;
      }
    }
    V += 0.06 * (e0 + e1) / 2 * dt;
    if (V < 0) V = 0;
    if (V > W) W = V;
  }
  if (tn === null) return { tn: 0, tk: 0, W: 0, dry: true };
  return { tn, tk, W };
}

function pumpOutSeries(Q, r, tMax, dt = HYDRO_DT, idlePct = 50) {
  const ts = [], qs = [];
  const idle = Q * idlePct / 100;
  const N = Math.max(2, Math.ceil(tMax / dt));
  for (let i = 0; i <= N; i++) {
    const t = i * dt;
    ts.push(t);
    qs.push(!r.dry && t >= r.tn && t <= r.tk ? Q : idle);
  }
  return { t: ts, q: qs };
}

function seriesPeak(s) {
  let iMax = 0;
  for (let i = 1; i < s.q.length; i++) if (s.q[i] > s.q[iMax]) iMax = i;
  return { t: s.t[iMax], q: s.q[iMax] };
}
