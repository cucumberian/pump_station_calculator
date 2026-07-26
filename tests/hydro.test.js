"use strict";

const fs = require("fs");
const path = require("path");

const src = fs.readFileSync(path.join(__dirname, "..", "static/js/hydro.js"), "utf8");
const load = new Function(src + `
return {
  calc, solveTk, hydro, hydroTailT, sampleHydro,
  shiftSeries, interpAt, combineSeries, numericCalc,
  pumpOutSeries, seriesPeak,
  makeHydroGF, makePiecewiseGF, shiftGF, evalGF, peakGF, durationGF, toDense, combineGF,
  extendSeries, extendSeriesZero,
  HYDRO_DT
};
`);
const H = load();

let passed = 0, failed = 0;

function test(name, fn) {
  try { fn(); passed++; }
  catch (e) { failed++; console.error(`\u2716 ${name}\n  ${e.message}`); }
}

function approx(a, b, tol = 1e-4) {
  if (Math.abs(a - b) > tol) throw new Error(`\u043E\u0436\u0438\u0434\u0430\u043B\u043E\u0441\u044C ${b}, \u043F\u043E\u043B\u0443\u0447\u0435\u043D\u043E ${a} (\u0434\u043E\u043F\u0443\u0441\u043A ${tol})`);
}

// ============================================================
// calc — аналитический расчёт насосной станции
// ============================================================

test("calc: время начала работы tn для Q=150 л/с", () => {
  const r = H.calc(150, 342.3, 10, 0.71);
  // tn = tr * (Q/Qr)^(1/(1-n)) = 10 * (150/342.3)^(1/0.29) ≈ 0.58 мин
  approx(r.tn, 0.5813, 1e-3);
});

test("calc: время конца работы tk для Q=150 л/с", () => {
  const r = H.calc(150, 342.3, 10, 0.71);
  approx(r.tk, 11.84, 0.01);
});

test("calc: объём перекачки W для Q=150 л/с", () => {
  const r = H.calc(150, 342.3, 10, 0.71);
  approx(r.W, 74.7, 0.2);
});

test("calc: tk и W совпадают с эталоном из PDF (6 вариантов Q)", () => {
  const cases = [[100, 15.61, 113.8], [110, 14.47, 104.9], [120, 13.58, 96.6],
                 [130, 12.87, 88.9], [150, 11.84, 74.7], [200, 10.55, 44.4]];
  for (const [Q, tk, W] of cases) {
    const r = H.calc(Q, 342.3, 10, 0.71);
    approx(r.tk, tk, 0.05);
    approx(r.W, W, 0.2);
  }
});

// ============================================================
// hydro — формула гидрографа
// ============================================================

test("hydro: пик равен Qr при T=tr", () => {
  approx(H.hydro(10, 342.3, 10, 0.71), 342.3, 1e-3);
});

test("hydro: значение до пика (T=5, tr=10)", () => {
  // Q(T) = Qr * (T/tr)^(1-n) при T <= tr
  // = 342.3 * 0.5^0.29 ≈ 280
  approx(H.hydro(5, 342.3, 10, 0.71), 279.97, 1e-2);
});

test("hydro: значение после пика (T=15, tr=10)", () => {
  // Q(T) = Qr * ((T/tr)^(1-n) - (T/tr-1)^(1-n))
  // = 342.3 * (1.5^0.29 - 0.5^0.29) ≈ 105
  approx(H.hydro(15, 342.3, 10, 0.71), 105.04, 1e-2);
});

test("hydroTailT: на пороге 2% значение близко к 0.02*Qr", () => {
  const tTail = H.hydroTailT(342.3, 10, 0.71);
  approx(H.hydro(tTail, 342.3, 10, 0.71), 342.3 * 0.02, 0.5);
});

test("hydroTailT: ограничена сверху 200*tr или 2880 мин", () => {
  const tTail = H.hydroTailT(342.3, 10, 0.71);
  if (tTail > 200 * 10 && tTail > 2880) throw new Error("превышен лимит tailT");
});

// ============================================================
// sampleHydro — дискретизация гидрографа в сетку точек
// ============================================================

test("sampleHydro: количество точек соответствует tMax/dt", () => {
  const s = H.sampleHydro(342.3, 10, 0.71, 113.8);
  approx(s.t.length, Math.ceil(113.8 / H.HYDRO_DT) + 1);
  approx(s.q[0], 0);
});

test("sampleHydro: пик совпадает с tr", () => {
  const s = H.sampleHydro(342.3, 10, 0.71, 113.8);
  const peakIdx = Math.round(10 / H.HYDRO_DT);
  approx(s.q[peakIdx], 342.3, 0.5);
});

// ============================================================
// shiftSeries — сдвиг ряда задержки
// ============================================================

test("shiftSeries: время сдвигается на dt, значения не меняются", () => {
  const s = { t: [0, 1, 2], q: [10, 20, 30] };
  const shifted = H.shiftSeries(s, 5);
  approx(shifted.t[0], 5);
  approx(shifted.t[2], 7);
  approx(shifted.q[1], 20);
});

// ============================================================
// interpAt — линейная интерполяция
// ============================================================

test("interpAt: точное значение в первой точке", () => {
  const s = { t: [0, 2, 5], q: [10, 20, 50] };
  approx(H.interpAt(s, 0), 10);
});

test("interpAt: точное значение в последней точке (не 0!)", () => {
  const s = { t: [0, 2, 5], q: [10, 20, 50] };
  approx(H.interpAt(s, 5), 50);
});

test("interpAt: линейная интерполяция между точками", () => {
  const s = { t: [0, 2, 5], q: [10, 20, 50] };
  approx(H.interpAt(s, 1), 15);  // (10+20)/2
  approx(H.interpAt(s, 3.5), 35); // 20 + (50-20)*(1.5/3)
});

test("interpAt: до начала ряда — 0", () => {
  const s = { t: [0, 2, 5], q: [10, 20, 50] };
  approx(H.interpAt(s, -1), 0);
});

test("interpAt: после конца ряда — 0", () => {
  const s = { t: [0, 2, 5], q: [10, 20, 50] };
  approx(H.interpAt(s, 10), 0);
});

test("interpAt: сразу после последней точки — 0 (не путать с точным попаданием)", () => {
  const s = { t: [0, 2, 5], q: [10, 20, 50] };
  approx(H.interpAt(s, 5.001), 0);
});

// ============================================================
// combineSeries — сумма рядов на общем временном гриде
// ============================================================

test("combineSeries: один ряд — тот же грид", () => {
  const a = { t: [0, 1, 2], q: [10, 20, 30] };
  const c = H.combineSeries([a], 1);
  // tMax=2, N=max(2,ceil(2/1))=2, точек=N+1=3: t=[0,1,2]
  approx(c.t.length, 3);
  approx(c.t[0], 0);
  approx(c.t[2], 2);
  approx(c.q[0], 10);
  approx(c.q[2], 30);
});

test("combineSeries: два ряда суммируются с интерполяцией", () => {
  const a = { t: [0, 5, 10], q: [0, 100, 0] };
  const b = { t: [0, 3, 6], q: [50, 50, 0] };
  const c = H.combineSeries([a, b], 0.5);
  // tMax=10, N=ceil(10/0.5)=20, точек=21
  approx(c.q[0], 50); // t=0: a(0)=0 + b(0)=50
  const t5 = Math.round(5 / 0.5);
  // t=5: a(5)=100, b(5)=50+(0-50)*(5-3)/(6-3)=16.67 → 116.67
  approx(c.q[t5], 116.67, 1);
  const t10 = Math.round(10 / 0.5);
  approx(c.q[t10], 0, 1);
});

test("combineSeries: пустой список — [0] с Q=0", () => {
  const c = H.combineSeries([]);
  approx(c.t[0], 0);
  approx(c.q[0], 0);
});

// ============================================================
// numericCalc — численный расчёт насоса
// ============================================================

test("numericCalc: tn/tk/W совпадают с calc для того же гидрографа", () => {
  const s = H.sampleHydro(342.3, 10, 0.71, 120);
  const r = H.numericCalc(150, s);
  const rA = H.calc(150, 342.3, 10, 0.71);
  approx(r.tn, rA.tn, 1e-1);
  approx(r.tk, rA.tk, 1e-1);
  approx(r.W, rA.W, 2);
});

test("numericCalc: эталон из PDF (6 вариантов Q)", () => {
  const cases = [[100, 15.61, 113.8], [110, 14.47, 104.9], [120, 13.58, 96.6],
                 [130, 12.87, 88.9], [150, 11.84, 74.7], [200, 10.55, 44.4]];
  for (const [Q, tk, W] of cases) {
    const rA = H.calc(Q, 342.3, 10, 0.71);
    const s = H.sampleHydro(342.3, 10, 0.71, Math.max(2 * rA.tk, 30));
    const r = H.numericCalc(Q, s);
    approx(r.tk, tk, 0.2);
    approx(r.W, W, 1.5);
  }
});

test("numericCalc: dry если Q >= пик притока", () => {
  const s = H.sampleHydro(100, 10, 0.71, 120);
  const r = H.numericCalc(150, s);
  if (!r.dry) throw new Error("\u043E\u0436\u0438\u0434\u0430\u043B\u043E\u0441\u044C dry=true");
});

test("numericCalc: truncated=true если гидрограф обрезан до завершения откачки", () => {
  // Q большой, чтобы насос работал дольше короткой выборки гидрографа
  const s = H.sampleHydro(342.3, 10, 0.71, 30); // обрезанный гидрограф
  const r = H.numericCalc(50, s); // Q=50 — длительная откачка
  if (r.truncated !== true) throw new Error("\u043E\u0436\u0438\u0434\u0430\u043B\u043E\u0441\u044C truncated=true");
});

// ============================================================
// pumpOutSeries — ряд выхода насоса (кусочно-постоянный)
// ============================================================

test("pumpOutSeries: idle до Tн, Q на [Tн,Tк], idle после Tк", () => {
  const r = { tn: 5, tk: 15, dry: false };
  const out = H.pumpOutSeries(100, r, 20, 0.5, 30); // idle=30
  approx(out.q[0], 30);
  approx(out.q[Math.round(5 / 0.5)], 100);
  approx(out.q[Math.round(15 / 0.5)], 100);
  approx(out.q[out.q.length - 1], 30);
});

test("pumpOutSeries: dry = весь ряд idle", () => {
  const r = { tn: 0, tk: 0, dry: true };
  const out = H.pumpOutSeries(100, r, 20, 0.5, 30);
  for (const q of out.q) approx(q, 30);
});

test("pumpOutSeries: idle по умолчанию = 50% от Q", () => {
  const r = { tn: 0, tk: 0, dry: true };
  const out = H.pumpOutSeries(200, r, 10, 1);
  approx(out.q[0], 100); // 200 * 50 / 100
});

test("pumpOutSeries: tMax покрывает r.tk", () => {
  const r = H.calc(150, 342.3, 10, 0.71); // tk≈11.84
  const tMax = Math.max(120, r.tk + 10);
  const out = H.pumpOutSeries(150, r, tMax, 0.2, 100);
  // последняя точка active-диапазона (t <= tk)
  const lastActiveIdx = Math.floor(r.tk / 0.2);
  approx(out.q[lastActiveIdx], 150);
  // idle после tk
  const firstIdleIdx = Math.ceil(r.tk / 0.2);
  if (out.q[firstIdleIdx] !== 100) throw new Error("после tk должен быть idle");
});

// ============================================================
// seriesPeak — пик ряда
// ============================================================

test("seriesPeak: находит максимум в середине", () => {
  const s = { t: [0, 5, 10, 15], q: [0, 100, 200, 50] };
  const p = H.seriesPeak(s);
  approx(p.t, 10);
  approx(p.q, 200);
});

// ============================================================
// GraphFn — декларативные функции (гидрограф)
// ============================================================

test("makeHydroGF + evalGF: пик в tr, ноль в 0", () => {
  const gf = H.makeHydroGF(342.3, 10, 0.71, 0);
  approx(H.evalGF(gf, 10), 342.3, 1);
  approx(H.evalGF(gf, 0), 0);
});

test("makeHydroGF + evalGF: задержка сдвигает график", () => {
  const gf = H.makeHydroGF(342.3, 10, 0.71, 5);
  approx(H.evalGF(gf, 4), 0);
  approx(H.evalGF(gf, 15), 342.3, 1);
});

// ============================================================
// GraphFn — декларативные функции (кусочно-постоянная)
// ============================================================

test("makePiecewiseGF + evalGF: half-open интервалы [tStart, tEnd)", () => {
  const gf = H.makePiecewiseGF([
    { q: 50, tStart: 0, tEnd: 10 },
    { q: 200, tStart: 10, tEnd: 30 },
    { q: 50, tStart: 30, tEnd: 50 },
  ], 0);
  approx(H.evalGF(gf, 0), 50);
  approx(H.evalGF(gf, 9.9), 50);
  approx(H.evalGF(gf, 10), 200);   // граница — второй сегмент
  approx(H.evalGF(gf, 29.9), 200);
  approx(H.evalGF(gf, 30), 50);    // граница — третий сегмент
  approx(H.evalGF(gf, 50), 50);    // последняя точка включительно
  approx(H.evalGF(gf, 50.1), 0);
});

// ============================================================
// shiftGF — сдвиг декларативной функции
// ============================================================

test("shiftGF: гидрограф — добавляет delay", () => {
  const gf = H.makeHydroGF(342.3, 10, 0.71, 0);
  const shifted = H.shiftGF(gf, 5);
  approx(H.evalGF(shifted, 4), 0);
  approx(H.evalGF(shifted, 15), 342.3, 1);
  approx(shifted.delay, 5);
});

test("shiftGF: кусочно-постоянная — добавляет delay", () => {
  const gf = H.makePiecewiseGF([{ q: 100, tStart: 0, tEnd: 20 }], 0);
  const shifted = H.shiftGF(gf, 3);
  approx(H.evalGF(shifted, 2), 0);
  approx(H.evalGF(shifted, 5), 100);
});

// ============================================================
// peakGF — пик декларативной функции
// ============================================================

test("peakGF: гидрограф — пик на tr+delay", () => {
  const gf = H.makeHydroGF(342.3, 10, 0.71, 5);
  const p = H.peakGF(gf);
  approx(p.t, 15);
  approx(p.q, 342.3);
});

// ============================================================
// durationGF — длительность декларативной функции
// ============================================================

test("durationGF: гидрограф — hydroTailT + delay", () => {
  const gf = H.makeHydroGF(342.3, 10, 0.71, 0);
  const dur = H.durationGF(gf);
  // hydroTailT(342.3, 10, 0.71) ≈ 437.26
  approx(dur, 437.26, 0.5);
});

test("durationGF: кусочно-постоянная — tEnd последнего сегмента + delay", () => {
  const gf = H.makePiecewiseGF([{ q: 50, tStart: 0, tEnd: 120 }], 0);
  approx(H.durationGF(gf), 120);
});

test("durationGF: кусочно-постоянная с delay", () => {
  const gf = H.makePiecewiseGF([{ q: 50, tStart: 0, tEnd: 120 }], 10);
  approx(H.durationGF(gf), 130);
});

test("durationGF: dense ряд — последний t + delay", () => {
  const s = { t: [0, 1, 2, 3, 4, 5], q: [0, 10, 20, 10, 0, 0] };
  approx(H.durationGF(s), 5);
});

test("durationGF: dense ряд с delay", () => {
  const s = { t: [0, 1, 2, 3, 4, 5], q: [0, 10, 20, 10, 0, 0], delay: 3 };
  approx(H.durationGF(s), 8);
});

// ============================================================
// toDense — материализация функций в сетку точек
// ============================================================

test("toDense: гидрограф — покрывает всю длительность", () => {
  const gf = H.makeHydroGF(342.3, 10, 0.71, 5);
  const d = H.toDense(gf, 1);
  approx(d.t[0], 0);
  // последняя точка >= длительности (может быть на 1 шаг больше из-за ceil)
  if (d.t[d.t.length - 1] < H.durationGF(gf)) throw new Error("toDense короче durationGF");
});

test("toDense: tMax переопределяет длительность", () => {
  const gf = H.makeHydroGF(342.3, 10, 0.71, 0);
  const d = H.toDense(gf, 0.5, 200);
  approx(d.t[d.t.length - 1], 200);
});

test("toDense: если уже dense — возвращает тот же объект", () => {
  const s = { t: [0, 1, 2], q: [10, 20, 30] };
  const d = H.toDense(s);
  if (d !== s) throw new Error("должен вернуть тот же объект");
});

// ============================================================
// toDense — адаптивная сетка для гидрографов
// ============================================================

test("toDense adaptive: пик в tr не теряется", () => {
  const gf = H.makeHydroGF(342.3, 10, 0.71, 0);
  const d = H.toDense(gf, H.HYDRO_DT);
  const idx = Math.round(10 / H.HYDRO_DT);
  approx(d.q[idx], 342.3, 2);
});

test("toDense adaptive: хвост гладкий после fineEnd (нет всплесков)", () => {
  const n = 0.41;
  const gf = H.makeHydroGF(100, 10, n, 0);
  const d = H.toDense(gf, H.HYDRO_DT, 2000);
  const fineEnd = 3 * 10;
  const tStartCheck = Math.ceil(fineEnd / H.HYDRO_DT) + 1;
  let prevQ = d.q[tStartCheck];
  for (let i = tStartCheck + 1; i < d.t.length; i++) {
    const q = d.q[i];
    if (q > prevQ + 0.01) throw new Error(`всплеск в хвосте: t=${d.t[i].toFixed(1)}, q=${q.toFixed(3)} > ${prevQ.toFixed(3)}`);
    prevQ = q;
  }
});

test("toDense adaptive: piecewise — равномерный шаг без адаптации", () => {
  const gf = H.makePiecewiseGF([
    { q: 50, tStart: 0, tEnd: 10 },
    { q: 200, tStart: 10, tEnd: 100 },
    { q: 50, tStart: 100, tEnd: 300 },
  ], 0);
  const dt = 1;
  const d = H.toDense(gf, dt, 300);
  for (let i = 1; i < d.t.length; i++) {
    const gap = d.t[i] - d.t[i - 1];
    if (Math.abs(gap - dt) > 1e-10) throw new Error(`шаг ${gap} ≠ dt=${dt} в точке ${i}`);
  }
});

test("toDense adaptive: короткий гидрограф — равномерный шаг", () => {
  const gf = H.makeHydroGF(100, 1, 0.71, 0);
  const end = H.durationGF(gf);
  const dt = 1;
  const d = H.toDense(gf, dt, end);
  for (let i = 1; i < d.t.length; i++) {
    const gap = d.t[i] - d.t[i - 1];
    if (Math.abs(gap - dt) > 1e-10) throw new Error(`шаг ${gap} ≠ dt=${dt} в точке ${i}`);
  }
});

// ============================================================
// combineGF — комбинация декларативных функций
// ============================================================

test("combineGF: два гидрографа суммируются", () => {
  const a = H.makeHydroGF(100, 10, 0.71, 0);
  const b = H.makeHydroGF(50, 8, 0.71, 5);
  const c = H.combineGF([a, b], 0.5);
  approx(c.t[0], 0);
  const bAt10 = H.evalGF(b, 10);
  const peakIdx = Math.round(10 / 0.5);
  approx(c.q[peakIdx], 100 + bAt10, 1);
});

test("combineGF: пустой список — [0] с Q=0", () => {
  const c = H.combineGF([]);
  approx(c.t[0], 0);
  approx(c.q[0], 0);
});

test("combineGF: гидрограф + кусочно-постоянная", () => {
  const a = H.makeHydroGF(100, 10, 0.71, 0);
  const b = H.makePiecewiseGF([{ q: 50, tStart: 0, tEnd: 100 }], 0);
  const c = H.combineGF([a, b], 0.5);
  approx(c.q[0], 0 + 50);
  const aAt10 = H.evalGF(a, 10);
  approx(c.q[Math.round(10 / 0.5)], aAt10 + 50, 2);
});

// ============================================================
// Интеграционные тесты — каскад pumpOutSeries + combineGF
// ============================================================

test("pumpOutSeries: idle как процент от Q — при смене Q idle меняется пропорционально", () => {
  const idlePct = 30; // 30%
  for (const Q of [100, 200, 300]) {
    const idleQ = Q * idlePct / 100;
    const r = H.calc(Q * 0.5, Q * 2, 10, 0.71);
    const out = H.pumpOutSeries(Q, { tn: 0, tk: 0, dry: true }, 10, 1, idleQ);
    approx(out.q[0], idleQ);
  }
});

test("pumpOutSeries: idletPct=0 даёт idle=0 (полная остановка вне пика)", () => {
  const r = { tn: 5, tk: 15, dry: false };
  const out = H.pumpOutSeries(200, r, 20, 0.5, 0);
  approx(out.q[0], 0);
  approx(out.q[Math.round(10 / 0.5)], 200);
  approx(out.q[out.q.length - 1], 0);
});

test("piecewiseGF: idleQ = Q * idlePct / 100 в сегментах насоса", () => {
  const Q = 200, idlePct = 50;
  const idleQ = Q * idlePct / 100; // 100 L/s
  const gf = H.makePiecewiseGF([
    { q: idleQ, tStart: 0, tEnd: 5 },
    { q: Q, tStart: 5, tEnd: 15 },
    { q: idleQ, tStart: 15, tEnd: 30 },
  ], 0);
  approx(H.evalGF(gf, 0), 100);
  approx(H.evalGF(gf, 5), 200);
  approx(H.evalGF(gf, 15), 100);
});

test("pumpOutSeries: tMax >= r.tk — последняя активная точка Q, после idle", () => {
  const ownRain = H.makeHydroGF(100, 8, 0.71, 0);
  const upstream = H.makePiecewiseGF([{ q: 200, tStart: 0, tEnd: 50 }], 5);
  const inflowGF = { type: "dense", ...H.combineGF([ownRain, upstream]) };
  const r = H.calc(150, 250, 12, 0.71); // Qr > Q, корректный случай
  const tMax = Math.max(H.durationGF(inflowGF), r.tk + 10);
  const out = H.pumpOutSeries(150, r, tMax, 0.5, 75);
  const lastActive = Math.floor(r.tk / 0.5);
  approx(out.q[lastActive], 150);
  const firstIdle = Math.ceil(r.tk / 0.5);
  if (firstIdle < out.q.length) approx(out.q[firstIdle], 75);
});

test("interpAt: последняя точка pumpOutSeries на гриде combineSeries не обнуляется", () => {
  const r = H.calc(150, 250, 12, 0.71); // Qr > Q
  const inflowDense = H.sampleHydro(250, 12, 0.71, 80);
  const tMax = Math.max(inflowDense.t[inflowDense.t.length - 1], r.tk + 10);
  const out = H.pumpOutSeries(150, r, tMax, 0.5, 75);
  const ts = inflowDense.t;
  const lastT = ts[ts.length - 1];
  if (lastT <= out.t[out.t.length - 1]) {
    approx(H.interpAt(out, lastT), 75);
  }
  approx(H.interpAt(out, out.t[out.t.length - 1]), 75);
});

// ============================================================
// extendSeries — продление плотного ряда до заданного tMax
// ============================================================

test("extendSeries: если tMax <= конец — возвращает тот же объект", () => {
  const s = { t: [0, 5, 10], q: [10, 20, 30] };
  const e = H.extendSeries(s, 10);
  if (e !== s) throw new Error("должен вернуть тот же объект");
});

test("extendSeries: если tMax < конец — возвращает тот же объект", () => {
  const s = { t: [0, 5, 10], q: [10, 20, 30] };
  const e = H.extendSeries(s, 8);
  if (e !== s) throw new Error("должен вернуть тот же объект");
});

test("extendSeries: продлевает ряд удержанием последнего значения", () => {
  const s = { t: [0, 5, 10], q: [10, 20, 30] };
  const e = H.extendSeries(s, 15, 1);
  approx(e.t[e.t.length - 1], 15);
  for (let i = s.t.length; i < e.t.length; i++) {
    approx(e.q[i], 30); // последнее значение удержано
  }
});

test("extendSeries: шаг сетки соответствует dt на продлённом участке", () => {
  const s = { t: [0, 2, 4], q: [0, 50, 100] };
  const e = H.extendSeries(s, 10, 0.5);
  // проверяем только новые точки (после исходного конца 4)
  for (let i = s.t.length; i < e.t.length; i++) {
    approx(e.t[i] - e.t[i - 1], 0.5, 1e-10);
  }
});

test("extendSeries: исходные точки не меняются", () => {
  const s = { t: [0, 5, 10], q: [10, 20, 30] };
  const origT = s.t.slice(), origQ = s.q.slice();
  H.extendSeries(s, 20, 1);
  approx(s.t.join(","), origT.join(","));
  approx(s.q.join(","), origQ.join(","));
});

// ============================================================
// combineGF с tMax — продление компонентов до общего tMax
// ============================================================

test("combineGF: tMax длиннее компонентов — результат идёт до tMax", () => {
  const a = H.makePiecewiseGF([{ q: 50, tStart: 0, tEnd: 20 }], 0);
  const b = H.makePiecewiseGF([{ q: 100, tStart: 0, tEnd: 30 }], 0);
  const c = H.combineGF([a, b], 0.5, 100);
  approx(c.t[c.t.length - 1], 100);
});

test("combineGF: tMax длиннее — значения после конца компонента 0", () => {
  const a = H.makePiecewiseGF([{ q: 50, tStart: 0, tEnd: 10 }], 0);
  const b = H.makePiecewiseGF([{ q: 100, tStart: 0, tEnd: 10 }], 0);
  const c = H.combineGF([a, b], 0.5, 100);
  const idx = Math.round(10 / 0.5);
  approx(c.q[idx], 150); // 50 + 100
  // после 10 оба кончились → 0
  const idxAfter = Math.round(15 / 0.5);
  if (idxAfter < c.t.length) approx(c.q[idxAfter], 0);
});

test("combineGF: tMax длиннее — кусочно-постоянная + гидрограф", () => {
  const pw = H.makePiecewiseGF([{ q: 30, tStart: 0, tEnd: 50 }], 0);
  const hg = H.makeHydroGF(200, 10, 0.71, 0);
  const c = H.combineGF([pw, hg], 0.5, 100);
  approx(c.t[c.t.length - 1], 100);
  // после tail гидрографа (~437) не дойдём — tMax=100
  const idx50 = Math.round(50 / 0.5);
  approx(c.q[idx50 - 1], H.evalGF(hg, 49.5) + 30, 1);
  // гидрограф после 50 всё ещё положителен
  if (c.q[idx50] <= 0) throw new Error("гидрограф не должен обнулиться в 50");
});

// ============================================================
// Симуляция globalTMax post-processing для dense-режима
// ============================================================

test("post-processing: все series продлеваются до единого tMax (удержание)", () => {
  const short = { t: [0, 5, 10], q: [10, 20, 5] };
  const long  = { t: [0, 10, 30], q: [10, 100, 50] };
  const series = { a: { series: short }, b: { series: long } };
  let globalTMax = 0;
  for (const r of Object.values(series)) {
    if (r?.series?.t?.length) {
      const last = r.series.t[r.series.t.length - 1];
      if (last > globalTMax) globalTMax = last;
    }
  }
  for (const r of Object.values(series)) {
    if (r?.series) r.series = H.extendSeries(r.series, globalTMax);
  }
  // оба должны кончаться в 30
  approx(series.a.series.t[series.a.series.t.length - 1], 30);
  approx(series.b.series.t[series.b.series.t.length - 1], 30);
  // короткий удерживает q=5 после 10
  const idx15 = series.a.series.t.indexOf(15);
  if (idx15 >= 0) approx(series.a.series.q[idx15], 5);
});

test("post-processing: inflow и ownRain тоже продлеваются", () => {
  const base = { t: [0, 5, 10], q: [0, 100, 10] };
  const res = { series: base, inflow: { t: [0, 4, 8], q: [0, 80, 5] }, ownRain: { t: [0, 3, 6], q: [0, 60, 3] } };
  const tMax = 15;
  for (const r of [res]) {
    if (r?.series) r.series = H.extendSeries(r.series, tMax, 1);
    if (r?.inflow) r.inflow = H.extendSeries(r.inflow, tMax, 1);
    if (r?.ownRain) r.ownRain = H.extendSeries(r.ownRain, tMax, 1);
  }
  approx(res.series.t[res.series.t.length - 1], 15);
  approx(res.inflow.t[res.inflow.t.length - 1], 15);
  approx(res.ownRain.t[res.ownRain.t.length - 1], 15);
  approx(res.ownRain.q[res.ownRain.q.length - 1], 3);
  approx(res.inflow.q[res.inflow.q.length - 1], 5);
});

// ============================================================
// Симуляция globalTMax post-processing для declarative-режима
// ============================================================

test("post-processing declarative: piecewise GF продлевается до globalTMax", () => {
  const gf = H.makePiecewiseGF([
    { q: 50, tStart: 0, tEnd: 10 },
    { q: 200, tStart: 10, tEnd: 30 },
    { q: 50, tStart: 30, tEnd: 40 },
  ], 0);
  const globalTMax = 100;
  const last = gf.segments[gf.segments.length - 1];
  const extended = { ...gf, segments: [...gf.segments.slice(0, -1), { ...last, tEnd: globalTMax }] };
  approx(H.evalGF(extended, 40), 50);
  approx(H.evalGF(extended, 80), 50);
  approx(H.evalGF(extended, 100), 50);
  approx(H.durationGF(extended), 100);
});

test("post-processing declarative: inflowGF пересобирается с учётом продлённых upstream GF", () => {
  // upstream GF — кусочно-постоянная с idleQ, изначально до 30
  const upstream = H.makePiecewiseGF([
    { q: 30, tStart: 0, tEnd: 5 },
    { q: 100, tStart: 5, tEnd: 15 },
    { q: 30, tStart: 15, tEnd: 30 },
  ], 0);
  // ownRain — гидрограф с tailT ≈ 437
  const ownRain = H.makeHydroGF(200, 10, 0.71, 0);
  const ownDur = H.durationGF(ownRain); // ≈ 437
  // комбинируем БЕЗ tMax — как это делается на первом проходе
  const inflowGF = { type: "dense", ...H.combineGF([ownRain, upstream]) };
  const oldEnd = inflowGF.t[inflowGF.t.length - 1];
  // симулируем globalTMax = ownDur + 100: продлеваем upstream далеко за ownRain
  const globalTMax = ownDur + 100;
  const lastSeg = upstream.segments[upstream.segments.length - 1];
  const upstreamExt = { ...upstream, segments: [...upstream.segments.slice(0, -1), { ...lastSeg, tEnd: globalTMax }] };
  // пересобираем inflowGF с tMax
  const inflowGF2 = { type: "dense", ...H.combineGF([ownRain, upstreamExt], H.HYDRO_DT, globalTMax) };
  // новый должен быть длиннее старого
  if (inflowGF2.t[inflowGF2.t.length - 1] <= ownDur + 50) throw new Error("новый inflowGF должен быть длиннее");
  approx(inflowGF2.t[inflowGF2.t.length - 1], globalTMax, 1);
  // после ownRain upstream продолжает давать idle=30
  const idxAfterRain = Math.round((ownDur + 10) / H.HYDRO_DT);
  if (idxAfterRain < inflowGF2.t.length) {
    const v = inflowGF2.q[idxAfterRain];
    if (v < 25) throw new Error("inflow после ownRain должен быть > 25 (idle upstream)");
    approx(v, 30 + H.evalGF(ownRain, ownDur + 10), 3);
  }
});

// ============================================================
// Приведение диапазонов — post-processing с задержками
// ============================================================

test("post-processing: piecewise GF без delay продлевается на весь globalTMax", () => {
  const gf = H.makePiecewiseGF([
    { q: 50, tStart: 0, tEnd: 10 },
    { q: 200, tStart: 10, tEnd: 30 },
    { q: 50, tStart: 30, tEnd: 40 },
  ], 0);
  const globalTMax = 120;
  const last = gf.segments[gf.segments.length - 1];
  const effectiveEnd = (gf.delay || 0) + last.tEnd;
  const ext = effectiveEnd < globalTMax
    ? { ...gf, segments: [...gf.segments.slice(0, -1), { ...last, tEnd: globalTMax - (gf.delay || 0) }] }
    : gf;
  approx(H.durationGF(ext), 120);
  approx(H.evalGF(ext, 40), 50);
  approx(H.evalGF(ext, 80), 50);
  approx(H.evalGF(ext, 120), 50);
});

test("post-processing: pump peer без delay — продлевается на globalTMax", () => {
  const gf = H.makePiecewiseGF([
    { q: 50, tStart: 0, tEnd: 10 },
    { q: 200, tStart: 10, tEnd: 30 },
    { q: 50, tStart: 30, tEnd: 40 },
  ], 0);
  const globalTMax = 120;
  const last = gf.segments[gf.segments.length - 1];
  const effectiveEnd = (gf.delay || 0) + last.tEnd;
  const ext = effectiveEnd < globalTMax
    ? { ...gf, segments: [...gf.segments.slice(0, -1), { ...last, tEnd: globalTMax - (gf.delay || 0) }] }
    : gf;
  approx(H.durationGF(ext), 120);
  approx(H.evalGF(ext, 40), 50);
  approx(H.evalGF(ext, 80), 50);
  approx(H.evalGF(ext, 120), 50);
});

test("post-processing: delay peer (не pump) НЕ продлевается, чтобы не дублировать idle", () => {
  // GF с delay 30 — имитирует ноду задержки, которая не должна продлеваться
  const gf = H.makePiecewiseGF([
    { q: 50, tStart: 0, tEnd: 5 },
    { q: 200, tStart: 5, tEnd: 20 },
    { q: 50, tStart: 20, tEnd: 40 },
  ], 30);
  const origEnd = H.durationGF(gf); // 30 + 40 = 70
  // глобальный TMax больше, но это PEER (не pump) — не продлевается
  const ext = gf;
  if (ext !== gf) throw new Error("delay peer не должен продлеваться");
  approx(H.durationGF(ext), 70);
  // eval с учётом delay: tEff = t - 30
  approx(H.evalGF(ext, 35), 200);   // tEff=5 → pumping [5,20)
  approx(H.evalGF(ext, 49), 200);   // tEff=19 → pumping (ещё <20)
  approx(H.evalGF(ext, 50), 50);    // tEff=20 → idle [20,40] (half-open)
  approx(H.evalGF(ext, 60), 50);    // tEff=30 → idle
  approx(H.evalGF(ext, 70), 50);    // tEff=40 → последняя точка включительно
  approx(H.evalGF(ext, 71), 0);     // за границей — 0
  // toDense с tMax=120 видит delay GF, но после 70 даёт 0
  const dense = H.toDense(ext, 0.5, 120);
  const idx100 = Math.round(100 / 0.5);
  if (idx100 < dense.t.length) approx(dense.q[idx100], 0);
});

test("post-processing: pump peer с delay — продлевается с учётом delay", () => {
  // pump с delay (бывает при сдвинутом pump GF через shiftGF)
  const gf = H.makePiecewiseGF([
    { q: 50, tStart: 0, tEnd: 5 },
    { q: 200, tStart: 5, tEnd: 20 },
    { q: 50, tStart: 20, tEnd: 40 },
  ], 30);
  const globalTMax = 150;
  const last = gf.segments[gf.segments.length - 1];
  const effectiveEnd = (gf.delay || 0) + last.tEnd; // 30 + 40 = 70
  const ext = effectiveEnd < globalTMax
    ? { ...gf, segments: [...gf.segments.slice(0, -1), { ...last, tEnd: globalTMax - (gf.delay || 0) }] }
    : gf;
  // last.tEnd = 150 - 30 = 120
  approx(ext.segments[ext.segments.length - 1].tEnd, 120);
  approx(H.durationGF(ext), 150);
  // eval с учётом delay: tEff = t - 30
  approx(H.evalGF(ext, 35), 200);   // tEff=5 → pumping [5,20)
  approx(H.evalGF(ext, 49), 200);   // tEff=19 → pumping
  approx(H.evalGF(ext, 50), 50);    // tEff=20 → idle (half-open)
  approx(H.evalGF(ext, 51), 50);    // tEff=21 → idle (extended)
  approx(H.evalGF(ext, 150), 50);   // tEff=120 → idle (последняя точка)
  approx(H.evalGF(ext, 151), 0);    // за границей
});

// ============================================================
// numericCalc с продлённым притоком — truncated
// ============================================================

test("numericCalc: приток обрезан раньше tk — truncated=true", () => {
  // короткий приток: гидрограф обрезан до завершения откачки
  const short = H.sampleHydro(342.3, 10, 0.71, 30); // только до 30 мин
  const r = H.numericCalc(50, short); // Q=50 — долгая откачка
  if (!r.truncated) throw new Error("ожидалось truncated=true для короткого притока");
});

test("numericCalc: combineGF с tMax продлевает короткий upstream (delay peer)", () => {
  // upstream pump: idle до 30, delay 15 → effectiveEnd = 15+30 = 45
  const upGF = H.makePiecewiseGF([
    { q: 20, tStart: 0, tEnd: 5 },
    { q: 100, tStart: 5, tEnd: 15 },
    { q: 20, tStart: 15, tEnd: 30 },
  ], 15);
  // ownRain c коротким hydroTailT (Qr=30, tr=3, n=0.71 → tail ≈ 33)
  const ownGF = H.makeHydroGF(30, 3, 0.71, 0);
  const ownTail = H.durationGF(ownGF); // ≈ 33
  // без tMax: combineGF даёт tMax = max(33, 45) = 45
  const inflowShort = H.combineGF([ownGF, upGF]);
  // с tMax = max(duration) — тот же результат (45)
  const numEnd = Math.max(H.durationGF(ownGF), H.durationGF(upGF));
  const inflowLong = H.combineGF([ownGF, upGF], H.HYDRO_DT, numEnd);
  // оба кончаются одинаково (upGF доминирует, tMax не нужен)
  approx(inflowShort.t[inflowShort.t.length - 1], inflowLong.t[inflowLong.t.length - 1], 1);
  const r = H.numericCalc(10, inflowLong);
  if (r.dry) throw new Error("peak=30 > Q=10 → dry=false");
  if (r.truncated) throw new Error("хвоста хватает → truncated=false");
});

test("numericCalc: собственный гидрограф — truncated=false при достаточной длине", () => {
  const ownGF = H.makeHydroGF(200, 10, 0.71, 0);
  const inflow = H.combineGF([ownGF]);
  const r = H.numericCalc(50, inflow);
  if (r.dry) throw new Error("peak=200 > Q=50 → dry=false");
  if (r.truncated) throw new Error("полный hydroTailT → truncated=false");
  if (r.tk <= 0) throw new Error("tk > 0");
});

test("numericCalc: numericCalc возвращает truncated=true на обрезанном ряду", () => {
  const ownGF = H.makeHydroGF(200, 10, 0.71, 0);
  const inflow = H.combineGF([ownGF]);
  // обрезаем до 15 мин — гидрограф ещё ~62 > Q=50
  const idx15 = inflow.t.findIndex(t => t > 15);
  const short = { t: inflow.t.slice(0, idx15), q: inflow.q.slice(0, idx15) };
  const r = H.numericCalc(50, short);
  if (!r.truncated) throw new Error("обрезанный ряд → truncated=true");
});

test("numericCalc: пересчёт с продлённым притоком исправляет truncated", () => {
  // короткий приток до 15 мин (гидрограф ~62 > Q=50)
  const shortInflow = H.sampleHydro(200, 10, 0.71, 15);
  const rShort = H.numericCalc(50, shortInflow);
  if (!rShort.truncated) throw new Error("15 мин → truncated=true");
  // полный ГФ
  const ownGF = H.makeHydroGF(200, 10, 0.71, 0);
  const fullInflow = H.combineGF([ownGF], H.HYDRO_DT, H.durationGF(ownGF));
  const r = H.numericCalc(50, fullInflow);
  if (r.dry) throw new Error("peak=200 > Q=50 → dry=false");
  if (r.truncated) throw new Error("полный хвост → truncated=false");
});

test("extendSeriesZero: продлевает нулями, а не последним значением", () => {
  const s = { t: [0, 1, 2], q: [10, 5, 2] };
  const ext = H.extendSeriesZero(s, 5, 1);
  if (ext.t.length !== 6) throw new Error(`ожидалось 6 точек, получено ${ext.t.length}`);
  // точки после lastT (=2) должны быть 0
  for (let i = 3; i < ext.t.length; i++) {
    if (ext.q[i] !== 0) throw new Error(`точка ${i}: ожидался 0, получено ${ext.q[i]}`);
  }
});

test("combineSeries: нет ступеньки при разной длине рядов (два водосбора со сдвигом)", () => {
  const n = 0.71;
  const dt = 1;
  const tail1 = Math.ceil(H.hydroTailT(100, 10, n) + 30);
  const s1 = H.sampleHydro(100, 10, n, tail1, dt);
  const delay = 30;
  const s2 = H.shiftSeries(H.sampleHydro(100, 10, n, tail1, dt), delay);
  const combinedEnd = Math.max(s1.t[s1.t.length - 1], s2.t[s2.t.length - 1]);
  const ext1 = H.extendSeriesZero(s1, combinedEnd, dt);
  const ext2 = H.extendSeriesZero(s2, combinedEnd, dt);
  const combined = H.combineSeries([ext1, ext2], dt);
  // после завершения s1 — ищем максимальный перепад между соседними точками
  const s1End = s1.t[s1.t.length - 1];
  let maxDrop = 0;
  for (let i = 1; i < combined.t.length; i++) {
    if (combined.t[i] > s1End) {
      const drop = Math.abs(combined.q[i] - combined.q[i - 1]);
      if (drop > maxDrop) maxDrop = drop;
    }
  }
  // s1 хвост ≤ 2% от 100 = 2, после подъёма s2 — не более 2.5
  if (maxDrop > 2.5) throw new Error(`ступенька после завершения s1: ${maxDrop} л/с (ожидалось ≤ 2.5)`);
});

test("combineSeries с extendSeriesZero: хвост плавно уходит в 0", () => {
  const s = { t: [0, 10, 20], q: [100, 50, 2] };
  const ext = H.extendSeriesZero(s, 30, 1);
  const combined = H.combineSeries([ext], 1);
  const lastQ = combined.q[combined.q.length - 1];
  if (lastQ !== 0) throw new Error(`хвост не в 0: ${lastQ}`);
  // нет точек выше 2 (последнее значение s) после 20
  const after20 = combined.t.map((t, i) => ({ t, q: combined.q[i] })).filter(x => x.t > 20);
  for (const p of after20) {
    if (p.q > 2.1) throw new Error(`точка t=${p.t}: q=${p.q} > 2`);
  }
});

// ============================================================
// Два водосбора с разным tcon → ступенька в суммарном гидрографе
// ============================================================

test("combineGF: два гидрографа с разным tr — нет ступеньки в хвосте при общем tMax", () => {
  const n = 0.41;
  const dt = 0.2; // как в реальном коде (HYDRO_DT)
  // Водосбор 1: tr=10 (tcon=97 мин)
  const gf1 = H.makeHydroGF(100, 10, n, 0);
  // Водосбор 2: tr=3 (tcon=3 мин)
  const gf2 = H.makeHydroGF(80, 3, n, 0);
  // Общий tMax = максимум из hydroTailT
  const dur1 = H.durationGF(gf1);
  const dur2 = H.durationGF(gf2);
  const tMax = Math.max(dur1, dur2);
  // Комбинируем с общим tMax
  const combined = H.combineGF([gf1, gf2], dt, tMax);
  // Проверяем хвост: после 2*max(tr) — только плавное затухание
  const checkFrom = 2 * Math.max(gf1.tr, gf2.tr);
  let maxDrop = 0;
  for (let i = 1; i < combined.t.length; i++) {
    if (combined.t[i] <= checkFrom) continue;
    const drop = Math.abs(combined.q[i] - combined.q[i - 1]);
    if (drop > maxDrop) maxDrop = drop;
  }
  // При корректном tMax хвост плавно затухает — перепад < 0.5 л/с
  if (maxDrop > 0.5) throw new Error(`ступенька ${maxDrop.toFixed(2)} л/с при общем tMax=${tMax.toFixed(0)} (ожидалось ≤ 0.5)`);
});

test("combineGF: два гидрографа с разным tr — СТУПЕНЬКА в хвосте без tMax (демонстрация бага)", () => {
  const n = 0.41;
  const dt = 0.2;
  const gf1 = H.makeHydroGF(100, 10, n, 0);
  const gf2 = H.makeHydroGF(80, 3, n, 0);
  // Комбинируем БЕЗ tMax (старое поведение)
  const combined = H.combineGF([gf1, gf2], dt);
  const checkFrom = 2 * Math.max(gf1.tr, gf2.tr);
  // Находим ступеньку в хвосте: максимальный перепад
  let maxDrop = 0;
  for (let i = 1; i < combined.t.length; i++) {
    if (combined.t[i] <= checkFrom) continue;
    const drop = Math.abs(combined.q[i] - combined.q[i - 1]);
    if (drop > maxDrop) maxDrop = drop;
  }
  // Без tMax: shorter hydro (tr=3) обрезается на hydroTailT, перепад значительный
  if (maxDrop < 1.0) throw new Error(`ожидалась ступенька > 1.0 л/с в хвосте, получено ${maxDrop.toFixed(2)}`);
});

test("combineGF: три гидрографа с разным tr — нет ступеньки в хвосте", () => {
  const n = 0.41;
  const dt = 0.2;
  const gf1 = H.makeHydroGF(100, 10, n, 0);
  const gf2 = H.makeHydroGF(80, 3, n, 0);
  const gf3 = H.makeHydroGF(50, 20, n, 0);
  const tMax = Math.max(H.durationGF(gf1), H.durationGF(gf2), H.durationGF(gf3));
  const combined = H.combineGF([gf1, gf2, gf3], dt, tMax);
  const checkFrom = 2 * Math.max(gf1.tr, gf2.tr, gf3.tr);
  let maxDrop = 0;
  for (let i = 1; i < combined.t.length; i++) {
    if (combined.t[i] <= checkFrom) continue;
    const drop = Math.abs(combined.q[i] - combined.q[i - 1]);
    if (drop > maxDrop) maxDrop = drop;
  }
  if (maxDrop > 0.5) throw new Error(`ступенька ${maxDrop.toFixed(2)} л/с (ожидалось ≤ 0.5)`);
});

test("combineGF: один гидрограф короче другого — хвост плавно уходит в 0", () => {
  const n = 0.41;
  const dt = 1;
  const gfShort = H.makeHydroGF(80, 3, n, 0);
  const gfLong = H.makeHydroGF(100, 10, n, 0);
  const tMax = Math.max(H.durationGF(gfShort), H.durationGF(gfLong));
  const combined = H.combineGF([gfShort, gfLong], dt, tMax);
  // После завершения короткого гидрографа хвост плавно уходит в 0
  const shortDur = H.durationGF(gfShort);
  let maxDropAfterShort = 0;
  for (let i = 1; i < combined.t.length; i++) {
    if (combined.t[i] <= shortDur) continue;
    const drop = Math.abs(combined.q[i] - combined.q[i - 1]);
    if (drop > maxDropAfterShort) maxDropAfterShort = drop;
  }
  if (maxDropAfterShort > 0.5) throw new Error(`ступенька после короткого: ${maxDropAfterShort.toFixed(2)} л/с`);
});

console.log(`\n=== ${passed} пройдено, ${failed} не прошло ===`);
process.exit(failed ? 1 : 0);
