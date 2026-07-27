"use strict";

const fs = require("fs");
const path = require("path");

const readSrc = f => fs.readFileSync(path.join(__dirname, "..", "static/js", f), "utf8");
const load = new Function("window",
  readSrc("hydro.js") + readSrc("calc-view.js") + readSrc("cascade-nodes.js") +
  readSrc("cascade-catch.js") + readSrc("cascade-report.js") + `
return {
  buildReportMD, buildNodeReportMD, helpBlocksToMD,
  mixedAnalyticCalc, numericCalc, makeHydroGF, makePiecewiseGF, shiftGF,
  calc, catchParams, toDense, combineGF, durationGF, HYDRO_DT, CASCADE_HELP
};
`);
const H = load({ addEventListener() {} });

let passed = 0, failed = 0;

function test(name, fn) {
  try { fn(); passed++; }
  catch (e) { failed++; console.error(`\u2716 ${name}\n  ${e.message}`); }
}

function includes(md, s) {
  if (!md.includes(s)) throw new Error(`в отчёте нет «${s}»`);
}

const N = 0.71;

function makeScheme() {
  const graph = {
    nodes: [
      { id: 1, type: "catch", data: { F: 3.9, q20: 80, P: 1, mr: 150, gamma: 1.54, psiMid: 0.634, tcon: 3, tcan: 0 } },
      { id: 2, type: "delay", data: { l: 600, v: 1 } },
      { id: 3, type: "pump", data: { q: 150, qr: 0, tr: 0, idle: 50, mode: "analytic" } },
    ],
    connections: [{ from: 1, to: 2 }, { from: 2, to: 3 }],
  };
  const p = H.catchParams(graph.nodes[0].data, N);
  const catchRes = { gf: H.makeHydroGF(p.Qr, p.tr, N, 0), Qr: p.Qr, tr: p.tr, params: p, fromCatch: true };
  const delayRes = { gf: H.shiftGF(catchRes.gf, 10), fromCatch: true, Qr: p.Qr, tr: p.tr };
  const ownRainGF = delayRes.gf;
  const rc = H.calc(150, p.Qr, p.tr, N);
  const r = rc.dry ? rc : { ...rc, tn: rc.tn + 10, tk: rc.tk + 10 };
  const pumpRes = {
    gf: null, ownRainGF, inflowGF: ownRainGF, flowGFs: [], hydroGFs: [ownRainGF],
    r, Q: 150, Qr: p.Qr, tr: p.tr, idle: 50, mode: "analytic",
    eq: { Qr: p.Qr, tr: p.tr, n: N }, nEff: N, lockId: 2, lockIds: [2], approx: false,
  };
  const results = { 1: catchRes, 2: delayRes, 3: pumpRes };
  const ctx = { meta: { title: "Тестовая схема", object: "Объект №1", custom: [] }, n: N };
  ctx.payload = { format: "kns-cascade", version: 2, meta: ctx.meta, n: N, nodes: graph.nodes, connections: graph.connections };
  return { graph, results, ctx, p };
}

// ============================================================
// trace в mixedAnalyticCalc и numericCalc
// ============================================================

test("trace: mixedAnalyticCalc возвращает сегменты с ΔV и V", () => {
  const gf = H.makeHydroGF(342.3, 10, N, 0);
  const pw = H.makePiecewiseGF([{ q: 40, tStart: 0, tEnd: 20 }], 0);
  const r = H.mixedAnalyticCalc(150, [gf], [pw], true);
  if (!Array.isArray(r.trace) || !r.trace.length) throw new Error("trace пуст");
  const seg = r.trace[0];
  if (!(seg.a >= 0 && seg.b > seg.a)) throw new Error("некорректные границы сегмента");
  if (seg.c !== 40) throw new Error(`c=${seg.c}, ожидалось 40`);
  if (!seg.subs.length) throw new Error("subs пуст");
  const lastV = seg.subs[seg.subs.length - 1].V;
  if (Math.abs(seg.V - lastV) > 1e-9) throw new Error("V сегмента не совпадает с последним sub");
  const WfromTrace = Math.max(...r.trace.map(s => s.W));
  if (Math.abs(WfromTrace - r.W) > 1e-9) throw new Error(`W из trace ${WfromTrace} ≠ ${r.W}`);
});

test("trace: numericCalc возвращает окна заполнения", () => {
  const Q = 100;
  const gf1 = H.makeHydroGF(150, 4, N, 0);
  const gf2 = H.makeHydroGF(150, 4, N, 40);
  const dense = H.combineGF([gf1, gf2], H.HYDRO_DT, Math.max(H.durationGF(gf1), H.durationGF(gf2)));
  const r = H.numericCalc(Q, dense, true);
  if (!Array.isArray(r.windows) || r.windows.length !== 2) throw new Error(`окон: ${r.windows?.length}, ожидалось 2`);
  for (const w of r.windows) {
    if (!(w.end > w.start && w.maxV > 0)) throw new Error("некорректное окно");
  }
  if (Math.abs(Math.max(...r.windows.map(w => w.maxV)) - r.W) > 1e-9) throw new Error("maxV окон ≠ W");
});

// ============================================================
// helpBlocksToMD
// ============================================================

test("helpBlocksToMD: tex оборачивается в $$, ol — в нумерованный список", () => {
  const md = H.helpBlocksToMD([
    { p: "Текст" },
    { tex: "a^2" },
    { ol: ["первый", "второй"] },
  ]);
  includes(md, "Текст");
  includes(md, "$$\na^2\n$$");
  includes(md, "1. первый");
  includes(md, "2. второй");
});

// ============================================================
// buildReportMD — полный отчёт
// ============================================================

test("buildReportMD: содержит шапку, схему, методику и все ноды", () => {
  const { graph, results, ctx } = makeScheme();
  const md = H.buildReportMD(graph, results, ctx);
  includes(md, "# Обоснование расчёта");
  includes(md, "**Название:** Тестовая схема");
  includes(md, "**Объект:** Объект №1");
  includes(md, "## Схема");
  includes(md, "## Методика расчёта");
  includes(md, "## Водосбор #1");
  includes(md, "## Участок сети #2");
  includes(md, "## КНС #3");
  includes(md, "$$");
  includes(md, "n = 0,71");
});

test("buildReportMD: секция водосбора содержит формулы с подстановкой и результат", () => {
  const { graph, results, ctx, p } = makeScheme();
  const md = H.buildReportMD(graph, results, ctx);
  includes(md, "### Исходные данные");
  includes(md, "Площадь водосбора F");
  includes(md, "Q_r");
  includes(md, `Qr = ${p.Qr.toLocaleString("ru-RU", { maximumFractionDigits: 2 })} л/с`);
});

test("buildReportMD: секция участка содержит формулу задержки", () => {
  const { graph, results, ctx } = makeScheme();
  const md = H.buildReportMD(graph, results, ctx);
  includes(md, "\\Delta t = \\frac{L}{60\\,v}");
  includes(md, "600");
});

test("buildReportMD: КНС чистый дождь — формулы Приложения 8 и результаты", () => {
  const { graph, results, ctx } = makeScheme();
  const md = H.buildReportMD(graph, results, ctx);
  includes(md, "формулы (1)–(3) Приложения 8");
  includes(md, "T_{н}^{\\text{нс}}");
  includes(md, "Wнс");
  includes(md, "### Результаты");
});

test("buildReportMD: КНС по сегментам — таблица сегментов", () => {
  const { graph, results, ctx } = makeScheme();
  const pw = H.makePiecewiseGF([
    { q: 30, tStart: 0, tEnd: 5 },
    { q: 120, tStart: 5, tEnd: 12 },
    { q: 30, tStart: 12, tEnd: 200 },
  ], 0);
  graph.nodes.push({ id: 4, type: "pump", data: { q: 100, qr: 200, tr: 10, idle: 50, mode: "analytic" } });
  graph.connections.push({ from: 4, to: 3 });
  const ownRain = results[3].ownRainGF;
  const r = H.mixedAnalyticCalc(150, [ownRain], [pw]);
  results[4] = {
    gf: null, ownRainGF: H.makeHydroGF(200, 10, N, 0), inflowGF: null, flowGFs: [], hydroGFs: [H.makeHydroGF(200, 10, N, 0)],
    r: H.calc(100, 200, 10, N), Q: 100, Qr: 200, tr: 10, idle: 50, mode: "analytic",
    eq: { Qr: 200, tr: 10, n: N }, nEff: N, lockId: null, lockIds: [], approx: false,
  };
  results[3] = {
    ...results[3], flowGFs: [pw], hydroGFs: [ownRain], eq: null, r, approx: false,
    inflowGF: { type: "dense", ...H.combineGF([ownRain, pw], H.HYDRO_DT, 200) },
  };
  const md = H.buildReportMD(graph, results, ctx);
  includes(md, "по сегментам");
  includes(md, "| Сегмент, мин | c, л/с | Qнс − c, л/с |");
  includes(md, "Q_{нс}-c");
});

test("buildReportMD: численный режим — окна заполнения", () => {
  const { graph, results, ctx } = makeScheme();
  const ownRain = results[3].ownRainGF;
  const dense = H.toDense(ownRain, H.HYDRO_DT, H.durationGF(ownRain));
  const r = H.numericCalc(150, dense);
  results[3] = { ...results[3], mode: "numeric", eq: null, r, inflowGF: ownRain };
  const md = H.buildReportMD(graph, results, ctx);
  includes(md, "Численный режим");
  includes(md, "Окна заполнения резервуара");
  includes(md, "| Окно | Начало, мин | Конец, мин | max V, м³ |");
});

test("buildReportMD: приближение эквивалентным гидрографом — предупреждение", () => {
  const { graph, results, ctx } = makeScheme();
  const dense = { type: "dense", t: [0, 5, 10, 15], q: [0, 100, 250, 50] };
  results[3] = {
    ...results[3], flowGFs: [{ t: [0, 5, 10], q: [0, 100, 0] }], hydroGFs: [dense],
    eq: { Qr: 250, tr: 10, n: N }, approx: true,
    r: H.calc(150, 250, 10, N), inflowGF: dense,
  };
  const md = H.buildReportMD(graph, results, ctx);
  includes(md, "эквивалентным дождевым гидрографом");
  includes(md, "Приближение");
});

// ============================================================
// buildNodeReportMD — одна нода
// ============================================================

test("buildNodeReportMD: только выбранная нода", () => {
  const { graph, results, ctx } = makeScheme();
  const md = H.buildNodeReportMD(3, graph, results, ctx);
  includes(md, "КНС #3");
  if (md.includes("## Водосбор #1")) throw new Error("попала чужая секция водосбора");
  if (md.includes("## Участок сети #2")) throw new Error("попала чужая секция участка");
});

test("buildNodeReportMD: строковый nodeId (из сайдбара) тоже работает", () => {
  const { graph, results, ctx } = makeScheme();
  const md = H.buildNodeReportMD("3", graph, results, ctx);
  includes(md, "КНС #3");
  if (!md.length) throw new Error("пустой отчёт для строкового id");
});

test("buildNodeReportMD: водосбор", () => {
  const { graph, results, ctx } = makeScheme();
  const md = H.buildNodeReportMD(1, graph, results, ctx);
  includes(md, "Водосбор #1");
  if (md.includes("## КНС")) throw new Error("попала чужая секция КНС");
});

// ============================================================
// Mermaid-схема и отключённые ноды
// ============================================================

test("mermaid: схема содержит graph TD, ноды и связи", () => {
  const { graph, results, ctx } = makeScheme();
  const md = H.buildReportMD(graph, results, ctx);
  includes(md, "```mermaid");
  includes(md, "graph TD");
  includes(md, 'N1["Водосбор #1"]');
  includes(md, 'N3["КНС #3"]');
  includes(md, "N1 --> N2");
  includes(md, "N2 --> N3");
});

test("mermaid: отключённая нода выделяется классом disabled", () => {
  const { graph, results, ctx } = makeScheme();
  graph.nodes[2].data.disabled = true;
  results[3] = null;
  const md = H.buildReportMD(graph, results, ctx);
  includes(md, "classDef disabled");
  includes(md, "class N3 disabled");
  includes(md, "отключена — расчёт не выполняется");
  includes(md, "Нода отключена — в расчёте не участвует");
});

test("disabled: секция отключённой КНС без результатов расчёта", () => {
  const { graph, results, ctx } = makeScheme();
  graph.nodes[2].data.disabled = true;
  results[3] = null;
  const md = H.buildNodeReportMD(3, graph, results, ctx);
  includes(md, "Нода отключена");
  if (md.includes("### Результаты")) throw new Error("у отключённой ноды не должно быть результатов");
});

test("disabled: секция отключённого водосбора", () => {
  const { graph, results, ctx } = makeScheme();
  graph.nodes[0].data.disabled = true;
  results[1] = null;
  const md = H.buildNodeReportMD(1, graph, results, ctx);
  includes(md, "Нода отключена");
  if (md.includes("### Расчёт")) throw new Error("у отключённого водосбора не должно быть расчёта");
});

test("disabled: секция отключённого участка", () => {
  const { graph, results, ctx } = makeScheme();
  graph.nodes[1].data.disabled = true;
  const md = H.buildNodeReportMD(2, graph, results, ctx);
  includes(md, "Нода отключена");
  if (md.includes("\\Delta t")) throw new Error("у отключённого участка не должно быть формулы");
});

// ============================================================
// Имена нод (как на канвасе)
// ============================================================

test("mermaid: имя и описание ноды в лейбле", () => {
  const { graph, results, ctx } = makeScheme();
  graph.nodes[2].data.name = "КНС-2 подземная";
  graph.nodes[2].data.desc = "дождевая канализация";
  const md = H.buildReportMD(graph, results, ctx);
  includes(md, 'N3["КНС #3<br/>КНС-2 подземная<br/>дождевая канализация"]');
});

test("mermaid: участок называется «Участок сети» как на канвасе", () => {
  const { graph, results, ctx } = makeScheme();
  const md = H.buildReportMD(graph, results, ctx);
  includes(md, 'N2["Участок сети #2"]');
});

test("имя ноды: в заголовке секции и таблице схемы", () => {
  const { graph, results, ctx } = makeScheme();
  graph.nodes[2].data.name = "КНС-2 подземная";
  graph.nodes[2].data.desc = "дождевая канализация";
  const md = H.buildReportMD(graph, results, ctx);
  includes(md, "## КНС #3 — КНС-2 подземная");
  includes(md, "дождевая канализация");
  includes(md, "| 3 | КНС | КНС-2 подземная — дождевая канализация |");
});

test("имя ноды: без имени заголовок как раньше", () => {
  const { graph, results, ctx } = makeScheme();
  const md = H.buildNodeReportMD(3, graph, results, ctx);
  includes(md, "## КНС #3\n");
});

// ============================================================
// Код схемы (JSON) в отчёте
// ============================================================

test("json: полный отчёт содержит экспортируемый JSON схемы", () => {
  const { graph, results, ctx } = makeScheme();
  const md = H.buildReportMD(graph, results, ctx);
  includes(md, "## Приложение. Код схемы (JSON)");
  includes(md, "```json");
  includes(md, '"format": "kns-cascade"');
  includes(md, '"nodes": [');
  includes(md, '"connections": [');
  includes(md, '"type": "pump"');
});

test("json: без payload в ctx секция отсутствует", () => {
  const { graph, results, ctx } = makeScheme();
  delete ctx.payload;
  const md = H.buildReportMD(graph, results, ctx);
  if (md.includes("```json")) throw new Error("JSON-секция не должна появляться без payload");
});

test("json: отчёт по ноде содержит JSON только её и её связей", () => {
  const { graph, results, ctx } = makeScheme();
  const md = H.buildNodeReportMD(3, graph, results, ctx);
  includes(md, "```json");
  includes(md, '"id": 3');
  if (md.includes('"id": 1,')) throw new Error("в JSON отчёта по ноде попали чужие ноды");
  includes(md, '"from": 2');
  includes(md, '"to": 3');
});

test("json: JSON из отчёта валиден и парсится", () => {
  const { graph, results, ctx } = makeScheme();
  const md = H.buildReportMD(graph, results, ctx);
  const m = md.match(/```json\n([\s\S]+?)\n```/);
  if (!m) throw new Error("json-блок не найден");
  const parsed = JSON.parse(m[1]);
  if (parsed.format !== "kns-cascade") throw new Error("неверный format");
  if (parsed.nodes.length !== 3) throw new Error(`нод в JSON: ${parsed.nodes.length}, ожидалось 3`);
  if (parsed.connections.length !== 2) throw new Error(`связей в JSON: ${parsed.connections.length}, ожидалось 2`);
});

console.log(`\n=== ${passed} пройдено, ${failed} не прошло ===`);
process.exit(failed ? 1 : 0);
