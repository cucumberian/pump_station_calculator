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
  // Изломы T = delay + tr: там ветвь подъёма меняется на ветвь спада, и
  // |Q'| обращается в бесконечность. Шаг поиска пересечений их не пересекает.
  // Начало гидрографа (T = delay) тоже излом: до него слагаемое тождественно
  // нулю, сразу за ним его производная бесконечна.
  const kinks = hydroGFs.flatMap(gf => [gf.delay || 0, (gf.delay || 0) + gf.tr]).filter(k => k > 0).sort((x, y) => x - y);
  // Верхняя оценка |g'| на [t, ближайший правее излом): у каждой ветви
  // гидрографа модуль производной внутри ветви убывает, поэтому значение,
  // снятое в левом конце, ограничивает её на всём шаге (для ветви спада —
  // слагаемое при (T−tr)^(−n), оно больше вычитаемого).
  const slopeAbs = t => {
    let m = 0;
    for (const gf of hydroGFs) {
      const d = gf.delay || 0;
      // Гидрограф, стартующий строго правее, на этом шаге тождественно нулевой
      // (излом delay в hard всегда учтён). Если же t стоит ровно на его старте
      // или на tr — производная бесконечна, и её надо показать большим числом,
      // иначе шаг перескочит весь подъём (это и был потерянный пик).
      if (t < d) continue;
      const u = Math.max(t - d, 1e-9);
      const k = 1 - gf.n;
      const c = gf.Qr * k * Math.pow(gf.tr, -k);
      m += c * Math.pow(u < gf.tr ? u : Math.max(u - gf.tr, 1e-9), k - 1);
    }
    return m;
  };
  const nextKink = t => { for (const k of kinks) if (k > t) return k; return Infinity; };
  // Пересечения ищутся адаптивным шагом: за |f|/|g'| минут функция не успевает
  // сменить знак, значит целый шаг можно пропустить, не вычисляя её. При
  // равномерном шаге 0,2 мин на горизонте суток это десятки тысяч вычислений
  // на каждый вызов (кривая W(Q) — 121 вызов), здесь их сотни.
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
    const MIN_STEP = 1e-6;   // мельче бисекция не различит (её допуск 1e-4)
    let t = a, f0 = gAt(a) - L;
    for (;;) {
      const hard = Math.min(nextKink(t), b);  // шаг не пересекает излом
      const m = slopeAbs(t);
      let s = m > 0 && Number.isFinite(m) ? Math.abs(f0) / m : hard - t;
      // Приток ровно на уровне Qнс (касание вершины либо плато «вне пика»,
      // совпавшее с порогом): оценка «до следующего пересечения» выродилась в
      // ноль. Берём шаг прежнего равномерного перебора — так ход гарантирован,
      // а точность на этом участке ровно как была до адаптивной сетки.
      if (!(s > MIN_STEP)) s = HYDRO_DT;
      if (s > hard - t) s = hard - t;
      if (!(s > 0)) s = MIN_STEP;              // стоим на изломе — протиснуться
      const tc = Math.min(t + s, b);
      if (!(tc > t)) break;
      const f1 = gAt(tc) - L;
      if ((f0 < 0) !== (f1 < 0)) {
        let lo = t, hi = tc, flo = f0;
        for (let k = 0; k < 60 && hi - lo > 1e-4; k++) {
          const mid = (lo + hi) / 2;
          const fm = gAt(mid) - L;
          if ((fm < 0) === (flo < 0)) { lo = mid; flo = fm; } else hi = mid;
        }
        roots.push((lo + hi) / 2);
      }
      t = tc; f0 = f1;
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
    // bounds обязан быть возрастающим: интервал [sa; sb] и признак «выше Qнс»
    // теряют смысл при рассинхронизации. Корни из соседних бисекций могут
    // разойтись на допуск 1e-4, поэтому сортируем (обычно 0–2 элемента).
    const roots = findRoots(a, b, Q - c).sort((x, y) => x - y);
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

// Сумма рядов на общем гриде. Ряды уже отсортированы по t, а грид идёт
// возрастающей — поэтому для каждого ряда держим указатель на его интервал
// и идём им вперёд, а не ищем бинарно каждую точку (на ряду в сутки это
// было ~17 сравнений на точку вместо одного).
function combineSeries(list, dt = HYDRO_DT) {
  const valid = list.filter(Boolean);
  if (!valid.length) return { t: [0], q: [0] };
  const tMax = Math.max(...valid.map(s => s.t[s.t.length - 1]));
  const N = Math.max(2, Math.ceil(tMax / dt));
  const idx = valid.map(() => 0);
  const ts = new Array(N + 1), qs = new Array(N + 1);
  for (let i = 0; i <= N; i++) {
    const t = i * dt;
    ts[i] = t;
    let q = 0;
    for (let j = 0; j < valid.length; j++) {
      const s = valid[j], tsj = s.t, qsj = s.q, last = tsj.length - 1;
      let k = idx[j];
      while (k < last && tsj[k + 1] <= t) k++;
      idx[j] = k;
      if (k >= last) q += t === tsj[last] ? qsj[last] : 0;
      else if (t <= tsj[0]) q += t === tsj[0] ? qsj[0] : 0;
      else {
        const f = (t - tsj[k]) / (tsj[k + 1] - tsj[k]);
        q += qsj[k] + f * (qsj[k + 1] - qsj[k]);
      }
    }
    qs[i] = q;
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

// === Отображаемые серии =====================================================
// Ресамплинг длинных серий для ECharts: при tr ~ 50 ч ряд с шагом HYDRO_DT —
// это десятки тысяч точек (в схеме с tr=3021 мин — 34766), а экран ~1000 px,
// рисовать больше смысла нет. minMax сохраняет пики (важно для Q(T)!),
// среднее по бакету — нет. Численный расчёт и W по-прежнему идут по полной
// серии (numericCalc), здесь только отрисовка; маркеры Tн/Tк/Qнс — из r, не из ряда.
const CHART_MAX_POINTS = 2000;

function resampleForDisplay(s, maxPts = CHART_MAX_POINTS) {
  const n = s.t.length;
  if (!n || n <= maxPts) return s;
  const nb = Math.max(2, Math.floor(maxPts / 2));
  const out = { t: [], q: [] };
  for (let b = 0; b < nb; b++) {
    const i0 = Math.floor(b * (n - 1) / nb), i1 = Math.floor((b + 1) * (n - 1) / nb);
    let mn = Infinity, mx = -Infinity, tMn = s.t[i0], tMx = s.t[i0];
    for (let i = i0; i <= i1; i++) {
      const q = s.q[i];
      if (q < mn) { mn = q; tMn = s.t[i]; }
      if (q > mx) { mx = q; tMx = s.t[i]; }
    }
    // порядок по t: чтобы ломаная не «схлопывалась» назад по оси времени
    if (tMn <= tMx) { out.t.push(tMn, tMx); out.q.push(mn, mx); }
    else { out.t.push(tMx, tMn); out.q.push(mx, mn); }
  }
  const lastT = s.t[n - 1], lastQ = s.q[n - 1];
  if (out.t[out.t.length - 1] !== lastT) { out.t.push(lastT); out.q.push(lastQ); }
  return out;
}

// Мемоизация калькулятора для панелей: одна и та же функция вызывается из
// трёх мест (кривая W(Q), таблица вариантов, tooltip графика), а
// mixedAnalyticCalc/numericCalc стоят 2–11 мс на вызов при длинных сериях.
// Ключ — округление до 0,01 л/с: мельче смысла нет (весь UI в таких шагах).
//
// sig — подпись входов станции (гидрографы + выходы вышестоящих). С ней кэш
// живёт вне результата: перетаскивание Qнс меняет только одну точку, а кривую
// из 121 точки и таблицу из 50 можно не пересчитывать. Без sig — кэш только
// внутри вызова (как было): результаты пересоздаются на каждое изменение
// любого поля схемы, и кэш в них умирал вместе с ними.
const CALC_CACHE_LIMIT = 8;
const calcCacheBySig = new Map();

function memoizeCalc(fn, sig) {
  const map = sig !== undefined && sig !== null && calcCacheBySig.has(sig)
    ? calcCacheBySig.get(sig)
    : new Map();
  if (sig !== undefined && sig !== null) {
    calcCacheBySig.set(sig, map);
    if (calcCacheBySig.size > CALC_CACHE_LIMIT) calcCacheBySig.delete(calcCacheBySig.keys().next().value);
  }
  return q => {
    const k = Math.round(q * 100) / 100;
    let v = map.get(k);
    if (v === undefined) {
      v = fn(k);
      if (map.size > 1024) map.delete(map.keys().next().value);
      map.set(k, v);
    }
    return v;
  };
}

// Строковая подпись набора графовых функций. Плотный ряд (t/q) подписать
// коротко и безопасно нельзя, поэтому для него подпись null — кэш остаётся
// локальным. Ключ обязан совпадать только тогда, когда совпадают и результаты.
function gfSignature(list) {
  const valid = (list || []).filter(Boolean);
  if (!valid.length) return null; // пусто — общий ключ не нужен
  let s = "";
  for (const gf of valid) {
    if (gf.type === "hydrograph") s += `H${gf.Qr},${gf.tr},${gf.n},${gf.delay || 0};`;
    else if (gf.type === "piecewise") s += `P${gf.delay || 0}[${gf.segments.map(x => `${x.q},${x.tStart},${x.tEnd}`).join(";")}]`;
    else return null;
    if (s.length > 8000) return null;
  }
  return s;
}
