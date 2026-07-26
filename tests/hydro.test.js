"use strict";

const fs = require("fs");
const path = require("path");

const src = fs.readFileSync(path.join(__dirname, "..", "static/js/hydro.js"), "utf8");
const load = new Function(src + `
return {
  calc, solveTk, hydro, hydroTailT, sampleHydro,
  shiftSeries, interpAt, combineSeries, numericCalc,
  pumpOutSeries, seriesPeak, hydroInt, mixedAnalyticCalc,
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

test("calc: Q > Qr → dry=true, W=0 (нет регулирования)", () => {
  const r = H.calc(400, 342.3, 10, 0.71);
  approx(r.W, 0);
  approx(r.tn, 0);
  approx(r.tk, 0);
  if (!r.dry) throw new Error("Q > Qr → dry=true");
});

test("calc: Q == Qr → dry=true, W=0", () => {
  const r = H.calc(342.3, 342.3, 10, 0.71);
  approx(r.W, 0);
  if (!r.dry) throw new Error("Q == Qr → dry=true");
});

test("calc: W(Q) не растёт при Q > Qr", () => {
  const Qr = 342.3, tr = 10, n = 0.71;
  const wAtQr = H.calc(Qr, Qr, tr, n).W;
  for (const q of [Qr + 1, Qr + 50, Qr + 100, Qr * 2]) {
    const r = H.calc(q, Qr, tr, n);
    if (r.W > wAtQr + 0.01) throw new Error(`W(${q}) = ${r.W} > W(${Qr}) = ${wAtQr}`);
    if (!r.dry) throw new Error(`Q=${q} > Qr=${Qr} → dry=true`);
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
  // за пределами — продолжает значение последнего сегмента (продление «в бесконечность»)
  approx(H.evalGF(gf, 50.1), 50);
  approx(H.evalGF(gf, 100), 50);
  approx(H.evalGF(gf, 9999), 50);
});

test("evalGF piecewise: 1 сегмент — продление за пределы", () => {
  const gf = H.makePiecewiseGF([{ q: 100, tStart: 0, tEnd: 20 }], 0);
  approx(H.evalGF(gf, 0), 100);
  approx(H.evalGF(gf, 20), 100);
  approx(H.evalGF(gf, 20.1), 100);
  approx(H.evalGF(gf, 500), 100);
});

test("evalGF piecewise: 2 сегмента — продление за пределы", () => {
  const gf = H.makePiecewiseGF([
    { q: 0, tStart: 0, tEnd: 10 },
    { q: 300, tStart: 10, tEnd: 40 },
  ], 0);
  approx(H.evalGF(gf, 5), 0);
  approx(H.evalGF(gf, 10), 300);
  approx(H.evalGF(gf, 40), 300);
  approx(H.evalGF(gf, 40.1), 300);
  approx(H.evalGF(gf, 200), 300);
});

test("evalGF piecewise: 4 сегмента — продление за пределы", () => {
  const gf = H.makePiecewiseGF([
    { q: 10, tStart: 0, tEnd: 5 },
    { q: 50, tStart: 5, tEnd: 15 },
    { q: 200, tStart: 15, tEnd: 30 },
    { q: 30, tStart: 30, tEnd: 60 },
  ], 0);
  approx(H.evalGF(gf, 3), 10);
  approx(H.evalGF(gf, 5), 50);
  approx(H.evalGF(gf, 15), 200);
  approx(H.evalGF(gf, 30), 30);
  approx(H.evalGF(gf, 60), 30);
  approx(H.evalGF(gf, 60.1), 30);   // продолжает последний сегмент
  approx(H.evalGF(gf, 1000), 30);
});

test("evalGF piecewise: 5 сегментов — ступенчатая функция", () => {
  const gf = H.makePiecewiseGF([
    { q: 0, tStart: 0, tEnd: 10 },
    { q: 100, tStart: 10, tEnd: 20 },
    { q: 0, tStart: 20, tEnd: 30 },
    { q: 150, tStart: 30, tEnd: 50 },
    { q: 25, tStart: 50, tEnd: 70 },
  ], 0);
  approx(H.evalGF(gf, 0), 0);
  approx(H.evalGF(gf, 10), 100);
  approx(H.evalGF(gf, 20), 0);
  approx(H.evalGF(gf, 30), 150);
  approx(H.evalGF(gf, 50), 25);
  approx(H.evalGF(gf, 70), 25);
  approx(H.evalGF(gf, 70.1), 25);   // продолжает q=25
  approx(H.evalGF(gf, 500), 25);
});

test("evalGF piecewise: с delay — продление за пределы с учётом сдвига", () => {
  const gf = H.makePiecewiseGF([
    { q: 60, tStart: 0, tEnd: 10 },
    { q: 120, tStart: 10, tEnd: 25 },
  ], 5);
  // tEff = t - delay
  approx(H.evalGF(gf, 4), 0);       // tEff = -1 < 0
  approx(H.evalGF(gf, 5), 60);      // tEff = 0 — начало первого сегмента
  approx(H.evalGF(gf, 15), 120);    // tEff = 10 — начало второго сегмента
  approx(H.evalGF(gf, 30), 120);    // tEff = 25 — конец второго сегмента
  approx(H.evalGF(gf, 30.1), 120);  // за пределами — продолжает 120
  approx(H.evalGF(gf, 100), 120);
});

test("evalGF piecewise: пустой массив сегментов — возвращает 0", () => {
  const gf = H.makePiecewiseGF([], 0);
  approx(H.evalGF(gf, 0), 0);
  approx(H.evalGF(gf, 100), 0);
});

test("evalGF piecewise: 1 сегмент с q=0 — продление нуля", () => {
  const gf = H.makePiecewiseGF([{ q: 0, tStart: 0, tEnd: 50 }], 0);
  approx(H.evalGF(gf, 0), 0);
  approx(H.evalGF(gf, 50), 0);
  approx(H.evalGF(gf, 51), 0);
});

test("toDense piecewise: плотная сетка с продлением последнего сегмента", () => {
  const gf = H.makePiecewiseGF([
    { q: 50, tStart: 0, tEnd: 10 },
    { q: 200, tStart: 10, tEnd: 30 },
    { q: 50, tStart: 30, tEnd: 50 },
  ], 0);
  const dense = H.toDense(gf, 1, 60);
  // до tEnd — значение последнего сегмента
  approx(dense.q[dense.q.length - 1], 50);
  // t=55 > tEnd=50 — тоже 50
  const idx55 = dense.t.indexOf(55);
  approx(dense.q[idx55], 50);
  // t=60 — конец
  approx(dense.q[dense.q.length - 1], 50);
});

test("toDense piecewise: 2 сегмента — плотная сетка с продлением", () => {
  const gf = H.makePiecewiseGF([
    { q: 0, tStart: 0, tEnd: 20 },
    { q: 100, tStart: 20, tEnd: 40 },
  ], 0);
  const dense = H.toDense(gf, 1, 80);
  // t=40 — 100
  const idx40 = dense.t.indexOf(40);
  approx(dense.q[idx40], 100);
  // t=60 — продолжает 100
  const idx60 = dense.t.indexOf(60);
  approx(dense.q[idx60], 100);
  // t=80 — 100
  approx(dense.q[dense.q.length - 1], 100);
});

test("durationGF piecewise: возвращает tEnd последнего сегмента", () => {
  const gf = H.makePiecewiseGF([
    { q: 10, tStart: 0, tEnd: 20 },
    { q: 50, tStart: 20, tEnd: 45 },
  ], 3);
  approx(H.durationGF(gf), 48);  // delay(3) + tEnd(45)
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
// combineGF с tMax — продление компонентов до общего tMax
// ============================================================

test("combineGF: tMax длиннее компонентов — результат идёт до tMax", () => {
  const a = H.makePiecewiseGF([{ q: 50, tStart: 0, tEnd: 20 }], 0);
  const b = H.makePiecewiseGF([{ q: 100, tStart: 0, tEnd: 30 }], 0);
  const c = H.combineGF([a, b], 0.5, 100);
  approx(c.t[c.t.length - 1], 100);
});

test("combineGF: tMax длиннее — piecewise продолжает последний сегмент", () => {
  const a = H.makePiecewiseGF([{ q: 50, tStart: 0, tEnd: 10 }], 0);
  const b = H.makePiecewiseGF([{ q: 100, tStart: 0, tEnd: 10 }], 0);
  const c = H.combineGF([a, b], 0.5, 100);
  const idx = Math.round(10 / 0.5);
  approx(c.q[idx], 150); // 50 + 100
  // после 10 оба продолжают последний сегмент → 150
  const idxAfter = Math.round(15 / 0.5);
  if (idxAfter < c.t.length) approx(c.q[idxAfter], 150);
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
  approx(H.evalGF(ext, 71), 50);    // за границей — продолжает последний сегмент
  // toDense с tMax=120: piecewise продолжает последний сегмент (50)
  const dense = H.toDense(ext, 0.5, 120);
  const idx100 = Math.round(100 / 0.5);
  if (idx100 < dense.t.length) approx(dense.q[idx100], 50);
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
  approx(H.evalGF(ext, 151), 50);   // за границей — продолжает последний сегмент
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
  // ownRain c коротким hydroTailT (Qr=30, tr=3, n=0.71 → tail ≈ 131)
  const ownGF = H.makeHydroGF(30, 3, 0.71, 0);
  const numEnd = Math.max(H.durationGF(ownGF), H.durationGF(upGF));
  const inflowLong = H.combineGF([ownGF, upGF], H.HYDRO_DT, numEnd);
  const r = H.numericCalc(10, inflowLong);
  if (r.dry) throw new Error("peak=30 > Q=10 → dry=false");
  // upstream продолжает idle=20 после t=45 → инфлюанс выше Q=10 → truncated=true
  if (!r.truncated) throw new Error("upstream idle=20 > Q=10 → truncated=true");
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

// ============================================================
// mixedAnalyticCalc — гидрограф + кусочно-постоянная функция
// ============================================================

test("mixedAnalyticCalc: нулевой piecewise эквивалентен calc", () => {
  const gf = H.makeHydroGF(342.3, 10, 0.71, 0);
  const pw = H.makePiecewiseGF([{ q: 0, tStart: 0, tEnd: 500 }], 0);
  const r = H.mixedAnalyticCalc(150, gf, [pw]);
  const ref = H.calc(150, 342.3, 10, 0.71);
  approx(r.tn, ref.tn, 1e-3);
  approx(r.tk, ref.tk, 1e-3);
  approx(r.W, ref.W, 1e-3);
});

test("mixedAnalyticCalc: постоянный сдвиг c эквивалентен calc с Q−c", () => {
  const gf = H.makeHydroGF(342.3, 10, 0.71, 0);
  const c = 40;
  const pw = H.makePiecewiseGF([{ q: c, tStart: 0, tEnd: 1000 }], 0);
  const r = H.mixedAnalyticCalc(150, gf, [pw]);
  const ref = H.calc(150 - c, 342.3, 10, 0.71);
  approx(r.tn, ref.tn, 1e-3);
  approx(r.tk, ref.tk, 1e-3);
  approx(r.W, ref.W, 1e-3);
});

test("mixedAnalyticCalc: совпадает с numericCalc на суммарном ряде", () => {
  const Qr = 342.3, tr = 10, n = 0.71, Q = 150;
  const gf = H.makeHydroGF(Qr, tr, n, 0);
  const pw = H.makePiecewiseGF([
    { q: 30, tStart: 0, tEnd: 5 },
    { q: 120, tStart: 5, tEnd: 12 },
    { q: 30, tStart: 12, tEnd: 200 },
  ], 0);
  const r = H.mixedAnalyticCalc(Q, gf, [pw]);
  const tMax = Math.max(H.durationGF(gf), H.durationGF(pw));
  const dense = H.combineGF([gf, pw], H.HYDRO_DT, tMax);
  const rn = H.numericCalc(Q, dense);
  approx(r.tn, rn.tn, 0.3);
  approx(r.tk, rn.tk, 0.3);
  approx(r.W, rn.W, 1.0);
});

test("mixedAnalyticCalc: сегмент c >= Q — весь сегмент выше Qнс", () => {
  const gf = H.makeHydroGF(100, 10, 0.71, 0);
  const pw = H.makePiecewiseGF([{ q: 200, tStart: 3, tEnd: 8 }], 0);
  const r = H.mixedAnalyticCalc(150, gf, [pw]);
  if (r.dry) throw new Error("ожидалось наполнение");
  if (r.tn > 3 + 1e-9) throw new Error(`tn=${r.tn} позже начала сегмента 3`);
  if (r.tk < 8 - 1e-9) throw new Error(`tk=${r.tk} раньше конца сегмента 8`);
});

test("mixedAnalyticCalc: два разнесённых интервала превышения — tn первый, tk последний", () => {
  const Qr = 80, tr = 8, n = 0.71, Q = 100;
  const gf = H.makeHydroGF(Qr, tr, n, 0);
  const pw = H.makePiecewiseGF([
    { q: 50, tStart: 2, tEnd: 6 },
    { q: 0, tStart: 6, tEnd: 9 },
    { q: 70, tStart: 9, tEnd: 20 },
  ], 0);
  const r = H.mixedAnalyticCalc(Q, gf, [pw]);
  if (r.dry) throw new Error("ожидалось наполнение");
  if (r.tn > 2 + 1e-9) throw new Error(`tn=${r.tn}, ожидалось 2 (первый интервал)`);
  if (r.tk < 9) throw new Error(`tk=${r.tk}, ожидалось ≥ 9 (второй интервал)`);
  const dense = H.combineGF([gf, pw], H.HYDRO_DT, 40);
  const rn = H.numericCalc(Q, dense);
  approx(r.tn, rn.tn, 0.3);
  approx(r.tk, rn.tk, 0.3);
  approx(r.W, rn.W, 1.0);
});

test("mixedAnalyticCalc: dry если суммарный пик ниже Q", () => {
  const gf = H.makeHydroGF(100, 10, 0.71, 0);
  const pw = H.makePiecewiseGF([{ q: 30, tStart: 0, tEnd: 50 }], 0);
  const r = H.mixedAnalyticCalc(200, gf, [pw]);
  if (!r.dry) throw new Error("ожидался dry");
  if (r.W !== 0) throw new Error("ожидался W=0");
});

test("mixedAnalyticCalc: delay гидрографа сдвигает tn/tk", () => {
  const Qr = 342.3, tr = 10, n = 0.71, Q = 150, delay = 5;
  const gf = H.makeHydroGF(Qr, tr, n, delay);
  const pw = H.makePiecewiseGF([{ q: 0, tStart: 0, tEnd: 1000 }], 0);
  const r = H.mixedAnalyticCalc(Q, gf, [pw]);
  const ref = H.calc(Q, Qr, tr, n);
  approx(r.tn, ref.tn + delay, 1e-3);
  approx(r.tk, ref.tk + delay, 1e-3);
  approx(r.W, ref.W, 1e-3);
});

test("mixedAnalyticCalc: два piecewise складываются", () => {
  const Qr = 200, tr = 10, n = 0.71, Q = 150;
  const gf = H.makeHydroGF(Qr, tr, n, 0);
  const pw1 = H.makePiecewiseGF([{ q: 40, tStart: 0, tEnd: 30 }], 0);
  const pw2 = H.makePiecewiseGF([{ q: 60, tStart: 5, tEnd: 15 }], 0);
  const r = H.mixedAnalyticCalc(Q, gf, [pw1, pw2]);
  const dense = H.combineGF([gf, pw1, pw2], H.HYDRO_DT, 60);
  const rn = H.numericCalc(Q, dense);
  approx(r.tn, rn.tn, 0.3);
  approx(r.tk, rn.tk, 0.3);
  approx(r.W, rn.W, 1.0);
});

test("mixedAnalyticCalc: бак осушается между двумя пиками — W не сумма объёмов", () => {
  const Qr = 120, tr = 4, n = 0.71, Q = 100;
  const gf = H.makeHydroGF(Qr, tr, n, 0);
  const pw = H.makePiecewiseGF([
    { q: 90, tStart: 0, tEnd: 2 },
    { q: 0, tStart: 2, tEnd: 40 },
    { q: 90, tStart: 40, tEnd: 42 },
  ], 0);
  const r = H.mixedAnalyticCalc(Q, gf, [pw]);
  const dense = H.combineGF([gf, pw], H.HYDRO_DT, 80);
  const rn = H.numericCalc(Q, dense);
  approx(r.W, rn.W, 1.0);
});

console.log(`\n=== ${passed} пройдено, ${failed} не прошло ===`);
process.exit(failed ? 1 : 0);
