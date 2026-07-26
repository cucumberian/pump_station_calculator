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
  if (Q >= Qr) return { tn: 0, tk: 0, W: 0, dry: true };
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

function hydroTailT(Qr, tr, n, frac = 0.02) {
  const cap = Math.min(200 * tr, 2880);
  const threshold = frac * Qr;
  let lo = tr, hi = 4 * tr;
  while (hydro(hi, Qr, tr, n) > threshold) {
    lo = hi;
    hi *= 2;
    if (hi >= cap) return cap;
  }
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (hydro(mid, Qr, tr, n) > threshold) lo = mid; else hi = mid;
  }
  return Math.min((lo + hi) / 2, cap);
}

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
  if (t >= ts[ts.length - 1]) return t === ts[ts.length - 1] ? qs[qs.length - 1] : 0;
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
  return { tn, tk, W, truncated: q[t.length - 2] > Q };
}

function pumpOutSeries(Q, r, tMax, dt = HYDRO_DT, idle = Q * 50 / 100) {
  const ts = [], qs = [];
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

// === Declarative graph functions (GraphFn) ===

function makeHydroGF(Qr, tr, n, delay = 0) {
  return { type: "hydrograph", Qr, tr, n, delay };
}

function makePiecewiseGF(segments, delay = 0) {
  return { type: "piecewise", segments: segments.slice(), delay };
}

function shiftGF(gf, dt) {
  return { ...gf, delay: (gf.delay || 0) + dt, segments: gf.segments ? gf.segments.slice() : undefined };
}

function evalGF(gf, t) {
  const tEff = t - (gf.delay || 0);
  if (tEff < 0) return 0;
  switch (gf.type) {
    case "hydrograph":
      return hydro(tEff, gf.Qr, gf.tr, gf.n);
    case "constant":
      return (tEff >= gf.tStart && tEff <= gf.tEnd) ? gf.q : 0;
    case "piecewise":
      for (let i = 0; i < gf.segments.length; i++) {
        const seg = gf.segments[i];
        const isLast = i === gf.segments.length - 1;
        if (tEff >= seg.tStart && (isLast ? tEff <= seg.tEnd : tEff < seg.tEnd)) return seg.q;
      }
      return gf.segments.length ? gf.segments[gf.segments.length - 1].q : 0;
    default:
      return 0;
  }
}

function peakGF(gf) {
  if (gf.type === "hydrograph") {
    return { t: (gf.delay || 0) + gf.tr, q: gf.Qr };
  }
  const dense = toDense(gf);
  return seriesPeak(dense);
}

function durationGF(gf) {
  if (gf.type === "hydrograph") {
    return (gf.delay || 0) + hydroTailT(gf.Qr, gf.tr, gf.n);
  }
  if (gf.type === "piecewise" && gf.segments.length) {
    const last = gf.segments[gf.segments.length - 1];
    return (gf.delay || 0) + last.tEnd;
  }
  if (gf.t && gf.t.length) {
    return gf.t[gf.t.length - 1] + (gf.delay || 0);
  }
  return 0;
}

function toDense(gf, dt = HYDRO_DT, tMax) {
  if (gf.t && gf.q) return gf;
  const end = tMax != null ? tMax : durationGF(gf);
  if (end <= 0) return { t: [0], q: [evalGF(gf, 0)] };
  const isAdaptive = gf.type === "hydrograph" && end > 200 * dt;
  if (!isAdaptive) {
    const N = Math.max(2, Math.ceil(end / dt));
    const ts = [], qs = [];
    for (let i = 0; i <= N; i++) {
      const t = i * dt;
      ts.push(t);
      qs.push(evalGF(gf, t));
    }
    return { t: ts, q: qs };
  }
  const tr = gf.tr;
  const fineEnd = Math.min(end, Math.max(3 * tr, 20 * dt));
  const fineN = Math.max(2, Math.ceil(fineEnd / dt));
  const adaptTs = [0];
  for (let i = 1; i <= fineN; i++) adaptTs.push(Math.min(i * dt, fineEnd));
  if (fineEnd < end) {
    let t = fineEnd, step = dt * 5;
    while (t < end) {
      t = Math.min(t + step, end);
      adaptTs.push(t);
      step = Math.min(step * 1.5, Math.max(dt * 10, (end - t) * 0.1));
    }
  }
  const adaptQs = adaptTs.map(t => evalGF(gf, t));
  const N = Math.max(2, Math.ceil(end / dt));
  const ts = [], qs = [];
  let ai = 0;
  for (let i = 0; i <= N; i++) {
    const t = i * dt;
    ts.push(t);
    while (ai < adaptTs.length - 1 && adaptTs[ai + 1] <= t) ai++;
    if (ai >= adaptTs.length - 1) {
      qs.push(adaptQs[adaptQs.length - 1]);
    } else {
      const f = (t - adaptTs[ai]) / (adaptTs[ai + 1] - adaptTs[ai]);
      qs.push(adaptQs[ai] + f * (adaptQs[ai + 1] - adaptQs[ai]));
    }
  }
  return { t: ts, q: qs };
}

function combineGF(list, dt = HYDRO_DT, tMax) {
  const valid = list.filter(Boolean);
  if (!valid.length) return { t: [0], q: [0] };
  const allDense = valid.map(gf => gf.t && gf.q ? gf : toDense(gf, dt, tMax));
  return combineSeries(allDense, dt);
}
