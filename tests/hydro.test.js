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

console.log(`\n=== ${passed} \u043F\u0440\u043E\u0439\u0434\u0435\u043D\u043E, ${failed} \u043D\u0435 \u043F\u0440\u043E\u0448\u043B\u043E ===`);
process.exit(failed ? 1 : 0);
