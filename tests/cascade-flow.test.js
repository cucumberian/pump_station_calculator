"use strict";

// Нода «Доп. приток» (flow): прямоугольный импульс Q на [t₁; t₂) как
// кусочно-постоянная GF. Покрывает: чистую функцию flowGF, горизонт
// «до конца события» (rainHorizon), сквозной пересчёт computeCascadeNow
// (flow→pump — точная аналитическая ветка, flow→delay→pump — сдвиг на Δt),
// миграцию данных и round-trip сериализации — на реальном коде приложения.

const fs = require("fs");
const path = require("path");

const readSrc = f => fs.readFileSync(path.join(__dirname, "..", "static/js", f), "utf8");

// ---- гидро-модуль ----
const H = new Function(readSrc("hydro.js") + `
return { calc, hydroInt, mixedAnalyticCalc, numericCalc, makeHydroGF, makePiecewiseGF,
  shiftGF, evalGF, peakGF, durationGF, toDense, combineGF, hydroTailT,
  memoizeCalc, gfSignature, HYDRO_DT };
`)();

// ---- flowGF и реестр нод (DOM-мок для cascade-nodes не нужен: он чистый) ----
const N = new Function(readSrc("hydro.js") + readSrc("reference-data.js") + readSrc("param-schema.js") + readSrc("param-transfer.js") + readSrc("cascade-nodes.js") + `
return { flowGF, NODE_DEFAULTS, NODE_PORTS, NODE_TYPE_LABEL, NODE_LABEL, NODE_HTML };
`)();

// ---- rainHorizon + computeCascadeNow из cascade.js на моках графа ----
// Функции извлекаем по скобкам, как в cascade-topo.test.js, чтобы не тащить
// весь DOM-слой.
const cascadeSrc = readSrc("cascade.js");

function extractFn(src, name) {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`function ${name} not found in cascade.js`);
  let depth = 0, end = -1;
  for (let i = src.indexOf("{", start); i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  if (end < 0) throw new Error(`unbalanced braces in ${name}`);
  return src.slice(start, end);
}

const graphSrc = readSrc("cascade-graph.js");
const catchSrc = readSrc("cascade-catch.js");

const RT = new Function(
  readSrc("hydro.js") + readSrc("reference-data.js") + readSrc("param-schema.js") + readSrc("param-transfer.js") + readSrc("cascade-nodes.js") + readSrc("cascade-rain.js") + readSrc("cascade-catch.js") + graphSrc
  + extractFn(cascadeSrc, "rainHorizon") + "\n" + extractFn(cascadeSrc, "computeCascadeNow") + `
const upstreamIds = (id, data) => {
  const nd = data[id]; if (!nd) return [];
  const ids = [];
  for (const inp of Object.values(nd.inputs || {}))
    for (const conn of inp.connections) ids.push(String(conn.node));
  return ids;
};
const topoOrder = (data) => {
  const { order, rest } = kahnParts(Object.keys(data), edgesFromData(data));
  return { order, cyclic: rest };
};
// getGlobalN теперь в cascade-rain.js (n в профиле дождя); эта прокидка в
// расчёт с глобальным RT_N нужна чужой клетки — поэтому просто перекроем.
function getGlobalN() { return RT_N; }
const saveScheme = () => {};
const refreshSidebar = () => {};
const updateSummaries = () => {};
let RT_DATA = {};
function graphData() { return RT_DATA; }
let results = {};
let globalTMax = 0;
let RT_N = 0.71;
function run(data, n = 0.71) { RT_N = n; RT_DATA = data; computeCascadeNow(); return { results, globalTMax }; }
// мок DOM-слоя editor: синк qr/tr от водосбора пишет прямо в данные ноды
const editor = {
  getNodeFromId: id => ({ data: (RT_DATA[id] || {}).data || {} }),
  updateNodeDataFromId: (id, d) => { if (RT_DATA[id]) RT_DATA[id].data = d; },
};
return { rainHorizon, computeCascadeNow, run };
`,
)();

// ---- cascade-io: миграция и сериализация ----
const ioMocks = () => {
  const el = () => ({
    value: "0.71", hidden: false, textContent: "", innerHTML: "", style: {},
    addEventListener: () => {}, removeEventListener: () => {},
    querySelector: () => null,
    classList: { add: () => {}, remove: () => {}, toggle: () => {}, contains: () => false },
    appendChild: () => {}, append: () => {}, focus: () => {}, click: () => {},
  });
  global.$c = el;
  global.document = {
    getElementById: el, createElement: el,
    addEventListener: () => {}, removeEventListener: () => {},
    querySelector: () => null, querySelectorAll: () => [],
  };
  global.window = { addEventListener: () => {}, innerWidth: 1024, innerHeight: 768, matchMedia: () => ({ matches: false }) };
  global.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {} };
};
ioMocks();

const ioMod = new Function(
  `const NODE_PORTS = ${JSON.stringify(N.NODE_PORTS)};
const NODE_DEFAULTS = ${JSON.stringify(N.NODE_DEFAULTS)};
const NODE_HTML = ${JSON.stringify(N.NODE_HTML)};
function getGlobalN() { return 0.71; }

` + readSrc("reference-data.js") + readSrc("param-schema.js") + readSrc("param-transfer.js") + readSrc("cascade-rain.js") + graphSrc + readSrc("cascade-io.js") + `
return { validatePayload, migrateNodeData, serializeScheme };
`,
)();

// ---- helpers ----
let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; }
  catch (e) { failed++; console.error(`\u2716 ${name}\n  ${e.stack || e.message}`); }
}
function approx(a, b, tol = 1e-6) {
  if (!(Math.abs(a - b) <= tol)) throw new Error(`ожидалось ${b}, получено ${a} (допуск ${tol})`);
}
const node = (id, name, data, inputs = [], outputsConn = []) => [String(id), {
  id: +id, name, data: { ...N.NODE_DEFAULTS[name], ...data },
  inputs: { input_1: { connections: inputs.map(n => ({ node: n })) } },
  outputs: { output_1: { connections: outputsConn.map(n => ({ node: n })) } },
}];

// ============================================================
// flowGF — чистая функция
// ============================================================

test("flowGF: Q=50, t₁=10, t₂=40 — piecewise с нулевыми плечами", () => {
  const gf = N.flowGF({ mode: "constant", q: 50, t1: 10, t2: 40 }, 100);
  if (!gf || gf.type !== "piecewise") throw new Error("ожидался piecewise");
  approx(H.durationGF(gf), 40);
  approx(H.evalGF(gf, 0), 0);
  approx(H.evalGF(gf, 9.99), 0);
  approx(H.evalGF(gf, 10), 50);
  approx(H.evalGF(gf, 39.99), 50);
  approx(H.evalGF(gf, 40), 0);    // half-open: в t₂ приток уже выключен
  approx(H.evalGF(gf, 120), 0);   // хвост не продлевается значением q
});

test("flowGF: t₂ пустое — импульс до горизонта (до конца события)", () => {
  const gf = N.flowGF({ mode: "constant", q: 20, t1: 5, t2: "" }, 80);
  approx(H.durationGF(gf), 80);
  approx(H.evalGF(gf, 4.9), 0);
  approx(H.evalGF(gf, 5), 20);
  approx(H.evalGF(gf, 79.9), 20);
  approx(H.evalGF(gf, 80), 0);
});

test("flowGF: t₂ пустое и горизонта нет — GF не строится", () => {
  if (N.flowGF({ mode: "constant", q: 20, t1: 0, t2: "" }, 0) !== null)
    throw new Error("без горизонта пустой t₂ не должен строить GF");
});

test("flowGF: явный t₂ дальше горизонта не обрезается", () => {
  const gf = N.flowGF({ mode: "constant", q: 30, t1: 0, t2: 500 }, 100);
  approx(H.durationGF(gf), 500);
  approx(H.evalGF(gf, 120), 30);
  approx(H.evalGF(gf, 499.9), 30);
  approx(H.evalGF(gf, 500), 0);
});

test("flowGF: невалидные параметры — null", () => {
  if (N.flowGF({ mode: "steps", q: 5, t1: 0, t2: 10 }, 100) !== null) throw new Error("неизвестный режим не null");
  if (N.flowGF({ mode: "constant", q: "", t1: 0, t2: 10 }, 100) !== null) throw new Error("пустой Q не null");
  if (N.flowGF({ mode: "constant", q: -1, t1: 0, t2: 10 }, 100) !== null) throw new Error("отрицательный Q не null");
  if (N.flowGF({ mode: "constant", q: 5, t1: 40, t2: 20 }, 100) !== null) throw new Error("t₂ ≤ t₁ не null");
  if (N.flowGF({ mode: "constant", q: 5, t1: 0, t2: 0 }, 100) !== null) throw new Error("t₂ = t₁ = 0 не null");
  // Q = 0 легален: нулевой ряд, а не ошибка
  const zero = N.flowGF({ mode: "constant", q: 0, t1: 0, t2: 10 }, 100);
  if (!zero) throw new Error("Q = 0 должен строить GF");
});

test("flowGF: подпись gfSignature не null — мемоизация калькулятора жива", () => {
  const gf = N.flowGF({ mode: "constant", q: 50, t1: 10, t2: 40 }, 100);
  const sig = H.gfSignature([gf]);
  if (!sig) throw new Error("gfSignature вернул null для flow-GF");
});

// ============================================================
// rainHorizon — «до конца события»
// ============================================================

const dataWith = (...pairs) => Object.fromEntries(pairs);

test("rainHorizon: по хвосту собственного дождя станции + задержки + 30", () => {
  const data = dataWith(
    node(1, "pump", { qr: 342.3, tr: 10, q: 100 }),
    node(2, "delay", { v: 1, l: 1800 }), // Δt = 30 мин
    node(3, "flow", { q: 50, t1: 0, t2: "" }, [2, 1]),
  );
  const totalDelay = 30;
  const h = RT.rainHorizon(data, 0.71, totalDelay);
  approx(h, H.hydroTailT(342.3, 10, 0.71) + 30 + 30);
});

test("rainHorizon: без дождя и явного t₂ — горизонт 0", () => {
  const data = dataWith(node(1, "flow", { q: 50, t1: 0, t2: "" }));
  approx(RT.rainHorizon(data, 0.71, 0), 0);
});

test("rainHorizon: явный t₂ другого flow-узла задаёт горизонт", () => {
  const data = dataWith(
    node(1, "flow", { q: 10, t1: 0, t2: 240 }),
    node(2, "flow", { q: 50, t1: 0, t2: "" }, [1]),
  );
  approx(RT.rainHorizon(data, 0.71, 0), 240 + 0 + 30);
});

test("rainHorizon: отключённый водосбор в горизонт не входит", () => {
  const d = node(1, "catch", { disabled: true });
  approx(RT.rainHorizon(dataWith(d), 0.71, 0), 0);
});

// ============================================================
// computeCascadeNow — сквозной пересчёт
// ============================================================

test("flow → pump: аналитический расчёт идёт по точной сегментной ветке", () => {
  const data = dataWith(
    node(1, "flow", { q: 80, t1: 0, t2: 60 }, [], [2]),
    node(2, "pump", { qr: 300, tr: 20, q: 200, mode: "analytic" }, [1]),
  );
  const { results } = RT.run(data);
  const r = results[2];
  if (!r) throw new Error("станция не рассчиталась");
  if (r.approx) throw new Error("ушла в приближение — flow не доехал piecewise-веткой");
  if (r.eq) throw new Error("eq должен быть null в сегментной ветке");
  if (r.flowGFs.length !== 1 || r.flowGFs[0].type !== "piecewise")
    throw new Error("flowGFs[0] — не piecewise");
  // сверка с эталоном: mixedAnalyticCalc(Q, [дождь], [импульс])
  const ref = H.mixedAnalyticCalc(200, [H.makeHydroGF(300, 20, 0.71, 0)],
    [N.flowGF({ mode: "constant", q: 80, t1: 0, t2: 60 }, H.hydroTailT(300, 20, 0.71) + 30)]);
  approx(r.r.W, ref.W, 1e-9);
  approx(r.r.tn, ref.tn, 1e-9);
  approx(r.r.tk, ref.tk, 1e-9);
});

test("flow → pump: приток повышает Wнс (монотонность)", () => {
  const base = dataWith(node(2, "pump", { qr: 300, tr: 20, q: 200 }));
  const w0 = RT.run(base).results[2].r.W;
  const withFlow = dataWith(
    node(1, "flow", { q: 80, t1: 0, t2: 60 }, [], [2]),
    node(2, "pump", { qr: 300, tr: 20, q: 200 }, [1]),
  );
  const w1 = RT.run(withFlow).results[2].r.W;
  if (!(w1 > w0)) throw new Error(`W с притоком ${w1} не больше базового ${w0}`);
});

test("flow → pump: сухой вход остаётся сухим, импульс слабее Qнс и дождя нет", () => {
  const data = dataWith(
    node(1, "flow", { q: 10, t1: 0, t2: 60 }, [], [2]),
    node(2, "pump", { qr: 1, tr: 10, q: 100 }),
  );
  const r = RT.run(data).results[2];
  if (!r.r.dry) throw new Error("ожидался dry");
});

test("flow → delay → pump: импульс сдвигается на Δt, W совпадает с эталоном", () => {
  const dt = 20; // L=1200, v=1 → 20 мин
  const data = dataWith(
    node(1, "flow", { q: 80, t1: 10, t2: 70 }, [], [2]),
    node(2, "delay", { v: 1, l: dt * 60 }, [1], [3]),
    node(3, "pump", { qr: 300, tr: 20, q: 200 }, [2]),
  );
  const { results } = RT.run(data);
  const r1 = results[1], r2 = results[2], r3 = results[3];
  if (!r1 || !r2 || !r3) throw new Error("цепочка не рассчиталась");
  approx(H.durationGF(r2.gf), 70 + dt);
  approx(H.evalGF(r2.gf, 29.9), 0);
  approx(H.evalGF(r2.gf, 30), 80);   // t₁ + Δt
  approx(H.evalGF(r2.gf, 90), 0);
  const ref = H.mixedAnalyticCalc(200, [H.makeHydroGF(300, 20, 0.71, 0)],
    [H.shiftGF(N.flowGF({ mode: "constant", q: 80, t1: 10, t2: 70 }, 100 + dt), dt)]);
  approx(r3.r.W, ref.W, 1e-9);
});

test("flow → pump в численном режиме: W численного ≈ W аналитического", () => {
  const analytic = dataWith(
    node(1, "flow", { q: 80, t1: 0, t2: 60 }, [], [2]),
    node(2, "pump", { qr: 300, tr: 20, q: 200, mode: "analytic" }, [1]),
  );
  const numeric = dataWith(
    node(1, "flow", { q: 80, t1: 0, t2: 60 }, [], [2]),
    node(2, "pump", { qr: 300, tr: 20, q: 200, mode: "numeric" }, [1]),
  );
  const wa = RT.run(analytic).results[2].r.W;
  const wn = RT.run(numeric).results[2].r.W;
  approx(wn, wa, Math.max(1, wa * 0.005)); // дискретизация 0,2 мин — доли процента
});

test("flow: пустой t₂ резолвится в горизонт дождя прямого потребителя", () => {
  const data = dataWith(
    node(1, "flow", { q: 40, t1: 0, t2: "" }, [], [2]),
    node(2, "pump", { qr: 342.3, tr: 10, q: 100 }, [1]),
  );
  const { results } = RT.run(data);
  const gf = results[1].gf;
  const expected = H.hydroTailT(342.3, 10, 0.71) + 0 + 30;
  approx(H.durationGF(gf), expected, 1e-9);
  approx(H.evalGF(gf, expected - 1), 40);
});

test("flow: без дождя во всей схеме и без t₂ — ни flow, ни станция не считаются", () => {
  // Станция без собственного дождя (qr/tr ≤ 0) и без водосбора: горизонт 0,
  // приток с пустым t₂ не строится; станция без дождя не считается сама.
  const data = dataWith(
    node(1, "flow", { q: 40, t1: 0, t2: "" }, [], [2]),
    node(2, "pump", { qr: 0, tr: 0, q: 200 }, [1]),
  );
  const { results } = RT.run(data);
  if (results[1] !== null) throw new Error("flow без горизонта должен быть null");
  if (results[2] !== null) throw new Error("станция без дождя не должна считаться");
});

test("flow отключён — станция как без притока", () => {
  const withFlow = dataWith(
    node(1, "flow", { q: 80, t1: 0, t2: 60 }, [], [2]),
    node(2, "pump", { qr: 300, tr: 20, q: 200 }, [1]),
  );
  const disabledFlow = dataWith(
    node(1, "flow", { q: 80, t1: 0, t2: 60, disabled: true }, [], [2]),
    node(2, "pump", { qr: 300, tr: 20, q: 200 }, [1]),
  );
  const base = dataWith(node(2, "pump", { qr: 300, tr: 20, q: 200 }));
  const wFlow = RT.run(withFlow).results[2].r.W;
  const wDis = RT.run(disabledFlow).results[2].r.W;
  const wBase = RT.run(base).results[2].r.W;
  approx(wDis, wBase, 1e-9);
  if (wFlow <= wBase) throw new Error("с включённым flow W должен расти");
});

test("два flow в одну станцию — суммируются в piecewise-сегментации", () => {
  const data = dataWith(
    node(1, "flow", { q: 40, t1: 0, t2: 60 }, [], [3]),
    node(2, "flow", { q: 30, t1: 20, t2: 80 }, [], [3]),
    node(3, "pump", { qr: 300, tr: 20, q: 200 }, [1, 2]),
  );
  const r = RT.run(data).results[3];
  if (!r || r.approx || r.eq) throw new Error("оба flow должны остаться в точной ветке");
  if (r.flowGFs.length !== 2) throw new Error("flowGFs не два");
  const ref = H.mixedAnalyticCalc(200, [H.makeHydroGF(300, 20, 0.71, 0)],
    r.flowGFs);
  approx(r.r.W, ref.W, 1e-9);
});

// ============================================================
// cascade-io: миграция и round-trip
// ============================================================

test("migrateNodeData flow: строки Drawflow → числа, пустые t₁ и t₂ сохраняются", () => {
  const d = ioMod.migrateNodeData("flow", { q: "55", t1: "10", t2: "40" });
  approx(d.q, 55); approx(d.t1, 10); approx(d.t2, 40);
  const e = ioMod.migrateNodeData("flow", { q: "55", t1: "", t2: "" });
  approx(e.q, 55);
  if (e.t1 !== "") throw new Error("пустой t₁ обязан остаться пустой строкой");
  if (e.t2 !== "") throw new Error("пустой t₂ обязан остаться пустой строкой");
  const bad = ioMod.migrateNodeData("flow", { q: "abc", t1: "-5", t2: "xyz" });
  approx(bad.q, N.NODE_DEFAULTS.flow.q);
  if (bad.t1 !== "") throw new Error("нечитаемый t₁ → пустое «с начала события»");
  if (bad.t2 !== "") throw new Error("нечитаемый t₂ → пустое «до конца события»");
});

test("NODE_DEFAULTS.flow: t₁ и t₂ по умолчанию пустые — поток на всём времени", () => {
  if (N.NODE_DEFAULTS.flow.t1 !== "") throw new Error("t₁ по умолчанию должен быть пуст");
  if (N.NODE_DEFAULTS.flow.t2 !== "") throw new Error("t₂ по умолчанию должен быть пуст");
});

test("validatePayload: flow — известный тип; связь flow→pump проходит", () => {
  const p = {
    format: "kns-cascade", version: 2, n: 0.71,
    nodes: [
      { id: 1, type: "flow", x: 0, y: 0, data: { q: 50, t1: 0, t2: 40 } },
      { id: 2, type: "pump", x: 100, y: 0 },
    ],
    connections: [{ from: 1, to: 2 }],
  };
  const errs = ioMod.validatePayload(p);
  if (errs.length) throw new Error(`ошибок не ожидалось, получено: ${errs.join("; ")}`);
});

test("validatePayload: flow → catch отклоняется как цикл невозможного рода не требуется; flow без входов — цикл только из pump", () => {
  // отдельная страховка: flow — источник, циклов создавать не может,
  // но связь pump→flow→pump цикл — и он ловится общий проверкой.
  const p = {
    format: "kns-cascade", version: 2, n: 0.71,
    nodes: [{ id: 1, type: "flow", x: 0, y: 0 }, { id: 2, type: "pump", x: 100, y: 0 }],
    connections: [{ from: 2, to: 1 }, { from: 1, to: 2 }],
  };
  const errs = ioMod.validatePayload(p);
  if (!errs.some(e => e.includes("цикл"))) throw new Error("цикл через flow не пойман");
});

test("NODE_HTML.flow: карточка с df-q/df-t1/df-t2 и без входов", () => {
  const html = N.NODE_HTML.flow || "";
  for (const attr of ["df-q", "df-t1", "df-t2"])
    if (!html.includes(attr)) throw new Error(`в карточке нет ${attr}`);
  if (N.NODE_PORTS.flow[0] !== 0) throw new Error("у flow не должно быть входов");
  if (N.NODE_PORTS.flow[1] !== 1) throw new Error("у flow ровно один выход");
  if (N.NODE_TYPE_LABEL.flow !== "Дополнительный приток") throw new Error("подпись типа не та");
  if (N.NODE_LABEL.flow !== "Доп. приток") throw new Error("короткая метка не та");
});

// ============================================================
// отчёт: секция flow
// ============================================================

const R = new Function("window",
  readSrc("hydro.js") + readSrc("calc-view.js") + graphSrc +
  readSrc("reference-data.js") + readSrc("param-schema.js") + readSrc("param-transfer.js") + readSrc("cascade-nodes.js") + readSrc("cascade-rain.js") + readSrc("cascade-catch.js") + readSrc("cascade-report.js") +
  extractFn(cascadeSrc, "flowSummaryHTML") + `
return { buildNodeReportMD, buildReportMD, reportFmt, flowSummaryHTML };
`)({ addEventListener() {} });

test("отчёт: секция flow содержит Q, границы и сегменты", () => {
  const graph = {
    nodes: [{ id: 1, type: "flow", data: { q: 50, t1: 10, t2: 40, mode: "constant" } }],
    connections: [],
  };
  const gf = N.flowGF({ mode: "constant", q: 50, t1: 10, t2: 40 }, 100);
  const md = R.buildNodeReportMD(1, graph, { 1: { gf } }, { meta: {}, n: 0.71, payload: graph });
  for (const s of ["Доп. приток #1", "50", "10", "40"])
    if (!md.includes(s)) throw new Error(`в отчёте нет «${s}»`);
});

test("отчёт: пустой t₂ описан словами, а не NaN", () => {
  const graph = {
    nodes: [{ id: 1, type: "flow", data: { q: 50, t1: 0, t2: "", mode: "constant" } }],
    connections: [],
  };
  const md = R.buildNodeReportMD(1, graph, { 1: { gf: N.flowGF({ mode: "constant", q: 50, t1: 0, t2: "" }, 200) } },
    { meta: {}, n: 0.71, payload: graph });
  if (!md.includes("до конца расчётного события")) throw new Error("нет пояснения про пустой t₂");
  if (md.includes("NaN")) throw new Error("в отчёте NaN");
});

test("отчёт схемы: таблица нод показывает параметры flow", () => {
  const graph = {
    nodes: [
      { id: 1, type: "flow", data: { q: 25, t1: 5, t2: 65 } },
      { id: 2, type: "pump", data: { q: 100, qr: 300, tr: 20, idle: 50, mode: "analytic" } },
    ],
    connections: [{ from: 1, to: 2 }],
  };
  const results = { 1: { gf: N.flowGF({ mode: "constant", q: 25, t1: 5, t2: 65 }, 200) } };
  const md = R.buildReportMD(graph, results, { meta: {}, n: 0.71 });
  if (!md.includes("Q=25,00 л/с")) throw new Error("в таблице схемы нет параметров flow");
  if (!md.includes("5,00 мин → 65,00 мин")) throw new Error("нет диапазона времени");
});

// ============================================================
// Подсказки итоговой строки flow: пустые t₁ / t₂
// ============================================================

test("flowSummaryHTML: оба времени пусты — поток постоянный на всём времени", () => {
  const d = { mode: "constant", q: 50, t1: "", t2: "" };
  const html = R.flowSummaryHTML(d, { gf: N.flowGF(d, 100) });
  if (!html.includes("Поток постоянный на всём времени расчёта")) throw new Error(`нет подсказки: ${html}`);
});

test("flowSummaryHTML: пусто только t₁ — с начала события до t₂", () => {
  const d = { mode: "constant", q: 50, t1: "", t2: 40 };
  const html = R.flowSummaryHTML(d, { gf: N.flowGF(d, 100) });
  if (!html.includes("с начала события до")) throw new Error(`нет подсказки: ${html}`);
  if (!html.includes("40,00")) throw new Error(`нет t₂: ${html}`);
});

test("flowSummaryHTML: пусто только t₂ — с t₁ до конца события", () => {
  const d = { mode: "constant", q: 50, t1: 10, t2: "" };
  const html = R.flowSummaryHTML(d, { gf: N.flowGF(d, 100) });
  if (!html.includes("до конца события")) throw new Error(`нет подсказки: ${html}`);
  if (!html.includes("10,00")) throw new Error(`нет t₁: ${html}`);
});

test("flowSummaryHTML: оба времени заданы — без подсказки, только интервал", () => {
  const d = { mode: "constant", q: 50, t1: 10, t2: 40 };
  const html = R.flowSummaryHTML(d, { gf: N.flowGF(d, 100) });
  if (html.includes("Поток постоянный")) throw new Error(`лишняя подсказка: ${html}`);
  if (!html.includes("10,00…40,00 мин")) throw new Error(`нет интервала: ${html}`);
});

// ===================
// Насосная с заблокированными параметрами: водосбор сверху не управляет станцией
// ===================

const lockedPumpData = catchDisabled => dataWith(
  node(1, "catch", { q20: 240, P: 1, tcon: 10, disabled: catchDisabled }, [], [2]),
  node(2, "pump", { qr: 222.2, tr: 33.3, q: 100, locked: true }, [1]),
);

test("заблокированный насос: расчёт идёт по водосбору, поля qr/tr персистентны", () => {
  const data = lockedPumpData(false);
  const r2 = RT.run(data).results[2];
  const fromCatch = data["1"].Qr;
  if (Math.abs(r2.Qr - fromCatch) > 1e-9) throw new Error(`расчёт не по водосбору: Qr=${r2.Qr}`);
  if (data["2"].data.qr !== 222.2 || data["2"].data.tr !== 33.3) throw new Error("заблокированные поля qr/tr перезаписаны водосбором");
  // водосбор одни/выключили — расчёт следует за притоком, поля не меняются
  data["1"].data.disabled = true;
  const off = RT.run(data).results[2];
  if (off.lockId !== null) throw new Error("водосбор выкл, а метка источника на месте");
  if (Math.abs(off.Qr - 222.2) > 1e-9) throw new Error("после выключения водосбора расчёт должен идти по своим qr/tr");
  if (data["2"].data.qr !== 222.2 || data["2"].data.tr !== 33.3) throw new Error("поля qr/tr затёрты при выключенном водосборе");
});

test("разблокированный насос: водосбор синхронизирует qr/tr как раньше", () => {
  const data = dataWith(
    node(1, "catch", { q20: 240, P: 1, tcon: 10, zRows: [{ type: "imp", F: 3.9, z: 0.297 }] }, [], [2]),
    node(2, "pump", { qr: 222.2, tr: 33.3, q: 100 }, [1]),
  );
  const r2 = RT.run(data).results[2];
  const fromCatch = data["1"].Qr; // параметры, вычисленные по водосбору
  if (Math.abs(r2.Qr - fromCatch) > 1e-9) throw new Error(`Qr станции ${r2.Qr} ≠ водосбора ${fromCatch}`);
  if (Math.abs(data["2"].data.qr - fromCatch) > 1e-9) throw new Error("поле qr не синхронизировано");
  if (String(r2.lockId) !== "1") throw new Error("не маркирован источник параметров");
});

console.log(`\n=== ${passed} пройдено, ${failed} не прошло ===`);
if (failed > 0) process.exitCode = 1;
