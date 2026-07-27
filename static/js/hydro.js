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

function hydroInt(T, Qr, tr, n) {
  const x = T / tr;
  if (x <= 0) return 0;
  const v = Math.pow(x, 2 - n);
  return Qr * tr / (2 - n) * (x > 1 ? v - Math.pow(x - 1, 2 - n) : v);
}

function mixedAnalyticCalc(Q, hydroGFs, piecewiseGFs, withTrace = false) {
  const tEnd = Math.max(0, ...hydroGFs.map(gf => durationGF(gf)), ...piecewiseGFs.map(gf => durationGF(gf)));
  const bps = new Set([0]);
  for (const gf of piecewiseGFs) {
    const d = gf.delay || 0;
    for (const s of gf.segments) {
      if (d + s.tStart > 0 && d + s.tStart < tEnd) bps.add(d + s.tStart);
      if (d + s.tEnd > 0 && d + s.tEnd < tEnd) bps.add(d + s.tEnd);
    }
  }
  const pts = [...bps].sort((a, b) => a - b);
  pts.push(tEnd);
  const gAt = t => {
    let g = 0;
    for (const gf of hydroGFs) g += evalGF(gf, t);
    return g;
  };
  const gInt = (a, b) => {
    let s = 0;
    for (const gf of hydroGFs) {
      const d = gf.delay || 0;
      s += hydroInt(b - d, gf.Qr, gf.tr, gf.n) - hydroInt(a - d, gf.Qr, gf.tr, gf.n);
    }
    return s;
  };
  const single = hydroGFs.length === 1 ? hydroGFs[0] : null;
  const findRoots = (a, b, L) => {
    if (L <= 0) return [];
    if (single) {
      const { Qr, tr, n } = single;
      const dh = single.delay || 0;
      if (L >= Qr) return [];
      const roots = [];
      const tnE = dh + tr * Math.pow(L / Qr, 1 / (1 - n));
      const tkE = dh + solveTk(L, Qr, tr, n);
      if (tnE > a && tnE < b) roots.push(tnE);
      if (tkE > a && tkE < b) roots.push(tkE);
      return roots;
    }
    const roots = [];
    let t0 = a, f0 = gAt(a) - L;
    for (let t = a + HYDRO_DT; ; t += HYDRO_DT) {
      const tc = Math.min(t, b);
      const f1 = gAt(tc) - L;
      if ((f0 < 0) !== (f1 < 0)) {
        let lo = t0, hi = tc, flo = f0;
        for (let k = 0; k < 60 && hi - lo > 1e-4; k++) {
          const mid = (lo + hi) / 2;
          if ((gAt(mid) - L < 0) === (flo < 0)) { lo = mid; flo = gAt(mid) - L; } else hi = mid;
        }
        roots.push((lo + hi) / 2);
      }
      t0 = tc; f0 = f1;
      if (tc >= b) break;
    }
    return roots;
  };
  let tn = null, tk = null, V = 0, W = 0;
  const trace = withTrace ? [] : null;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    if (b - a < 1e-9) continue;
    let c = 0;
    for (const gf of piecewiseGFs) c += evalGF(gf, (a + b) / 2);
    const roots = findRoots(a, b, Q - c);
    const bounds = [a, ...roots, b];
    const segTrace = trace ? { a, b, c, level: Q - c, roots, subs: [] } : null;
    for (let k = 0; k < bounds.length - 1; k++) {
      const sa = bounds[k], sb = bounds[k + 1];
      if (sb - sa < 1e-9) continue;
      const above = gAt((sa + sb) / 2) + c > Q;
      if (above) {
        if (tn === null) tn = sa;
        tk = sb;
      }
      const dV = 0.06 * (gInt(sa, sb) + (c - Q) * (sb - sa));
      V += dV;
      if (V < 0) V = 0;
      if (V > W) W = V;
      if (segTrace) segTrace.subs.push({ sa, sb, above, dV, V });
    }
    if (segTrace) { segTrace.V = V; segTrace.W = W; trace.push(segTrace); }
  }
  if (tn === null) return { tn: 0, tk: 0, W: 0, dry: true, ...(trace ? { trace } : {}) };
  return { tn, tk, W, ...(trace ? { trace } : {}) };
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

function numericCalc(Q, s, withTrace = false) {
  const { t, q } = s;
  let tn = null, tk = null, V = 0, W = 0;
  const windows = withTrace ? [] : null;
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
    const wasEmpty = V === 0;
    V += 0.06 * (e0 + e1) / 2 * dt;
    if (V < 0) V = 0;
    if (V > W) W = V;
    if (windows) {
      if (wasEmpty && V > 0) windows.push({ start: t[i], end: t[i + 1], maxV: V });
      else if (V > 0 && windows.length) {
        const w = windows[windows.length - 1];
        w.end = t[i + 1];
        if (V > w.maxV) w.maxV = V;
      }
    }
  }
  if (tn === null) return { tn: 0, tk: 0, W: 0, dry: true, ...(windows ? { windows } : {}) };
  return { tn, tk, W, truncated: q[t.length - 2] > Q, ...(windows ? { windows } : {}) };
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
  const dly = Math.min(gf.delay || 0, end);
  const fineEnd = Math.min(end, dly + Math.max(3 * tr, 20 * dt));
  const adaptTs = [0];
  if (dly > 0) adaptTs.push(dly);
  const fineN = Math.max(2, Math.ceil((fineEnd - dly) / dt));
  for (let i = 1; i <= fineN; i++) {
    const t = Math.min(dly + i * dt, fineEnd);
    if (t > adaptTs[adaptTs.length - 1]) adaptTs.push(t);
  }
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
