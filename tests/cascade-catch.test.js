"use strict";

// Нода «Водосбор»: произвольные списки участков сети (ф. 7, 0,017·Σ(l/v)) и
// участков лотка (ф. 6, 0,021·Σ(l/v)), плюс миграция legacy-тройки l1/v1…l3/v3
// в массив segs — на реальном коде приложения.

const fs = require("fs");
const path = require("path");
const readSrc = f => fs.readFileSync(path.join(__dirname, "..", "static/js", f), "utf8");
const graphSrc = readSrc("cascade-graph.js");

const N = new Function("window",
  readSrc("hydro.js") + readSrc("calc-view.js") + readSrc("cascade-nodes.js") + readSrc("cascade-catch.js") + `
return { catchParams, parseSections, catchHelp, catchTrHelp, NODE_DEFAULTS, NODE_PORTS, NODE_HTML };
`)({ addEventListener() {} });

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; }
  catch (e) { failed++; console.error(`\u2716 ${name}\n  ${e.stack || e.message}`); }
}
function approx(a, b, tol = 1e-9) {
  if (!(Math.abs(a - b) <= tol)) throw new Error(`ожидалось ${b}, получено ${a} (допуск ${tol})`);
}

const n = 0.71;
const base = () => ({ ...N.NODE_DEFAULTS.catch });

// ============================================================
// catchParams
// ============================================================

test("catchParams: пустые списки — tp = 0, t_can = ручное значение", () => {
  const p = N.catchParams({ ...base(), tcan: 4 }, n);
  approx(p.tp, 0);
  approx(p.tcanCalc, 0);
  approx(p.tcan, 4);
  approx(p.tr, p.tcon + 4);
});

test("catchParams: участки сети — tp = 0,017·Σ(l/v) (ф. 7)", () => {
  const p = N.catchParams({ ...base(), tcon: 0, tcan: 0, segs: [{ l: 100, v: 1 }, { l: 200, v: 2 }] }, n);
  approx(p.lvSum, 200);
  approx(p.tp, 0.017 * 200);
  approx(p.tr, 0.017 * 200);
});

test("catchParams: участки лотка — t_can = ручное + 0,021·Σ(l/v) (ф. 6)", () => {
  const p = N.catchParams({ ...base(), tcon: 0, tcan: 2, trays: [{ l: 100, v: 1 }, { l: 50, v: 0.5 }] }, n);
  approx(p.lvTraySum, 200);
  approx(p.tcanManual, 2);
  approx(p.tcanCalc, 0.021 * 200);
  approx(p.tcan, 2 + 0.021 * 200);
  approx(p.tr, p.tcan);
});

test("catchParams: добавочное время по трубам — tp = ручное + 0,017·Σ(l/v)", () => {
  const p = N.catchParams({ ...base(), tcon: 0, tcan: 0, tp: 3, segs: [{ l: 100, v: 1 }] }, n);
  approx(p.tpManual, 3);
  approx(p.tpCalc, 0.017 * 100);
  approx(p.tp, 3 + 1.7);
  approx(p.tr, p.tp);
});

test("catchParams: tp и t_can не пересекаются (сеть и лоток независимы)", () => {
  const p = N.catchParams({ ...base(), tcon: 0, tcan: 0, segs: [{ l: 100, v: 1 }], trays: [{ l: 100, v: 1 }] }, n);
  approx(p.tp, 0.017 * 100);
  approx(p.tcan, 0.021 * 100);
  approx(p.tr, 0.038 * 100);
});

test("parseSections: отбрасывает нулевые и мусорные, приводит к числам", () => {
  const s = N.parseSections([{ l: "10", v: "2" }, { l: 0, v: 1 }, { l: 5, v: 0 }, { l: "x", v: 1 }, null, { l: 3, v: "2" }]);
  if (s.length !== 2) throw new Error(`ожидалось 2 участка, получено ${s.length}`);
  approx(s[0].l, 10); approx(s[0].v, 2);
  approx(s[1].l, 3); approx(s[1].v, 2);
  if (N.parseSections(undefined).length !== 0) throw new Error("undefined должен давать пустой список");
});

test("catchHelp: содержит формулы (6) и (7) с коэффициентами", () => {
  const p = N.catchParams({ ...base(), segs: [{ l: 100, v: 1 }], trays: [{ l: 100, v: 1 }] }, n);
  if (!Number.isFinite(p.A)) throw new Error("catchParams потерял параметр A");
  const txt = JSON.stringify(N.catchHelp(p));
  if (!txt.includes("0{,}021")) throw new Error("нет коэффициента 0,021 для лотков");
  if (!txt.includes("0{,}017")) throw new Error("нет коэффициента 0,017 для труб");
  if (!txt.includes("A = q_{20}")) throw new Error("нет формульной подстановки A");
});

test("catchTrHelp: только t_r — сумма с подстановкой, без A и Q_r", () => {
  const p = N.catchParams({ ...base(), tcon: 3, tcan: 2, tp: 4, segs: [{ l: 100, v: 1 }], trays: [{ l: 50, v: 0.5 }] }, n);
  const txt = JSON.stringify(N.catchTrHelp(p));
  if (!txt.includes("t_r = t_{con}")) throw new Error("нет итоговой формулы t_r");
  if (!txt.includes("0{,}021")) throw new Error("нет формулы лотков (16)");
  if (!txt.includes("0{,}017")) throw new Error("нет формулы труб (17)");
  if (!txt.includes("+ 2,0")) throw new Error("нет ручной добавки t_can");
  if (!txt.includes("+ 4,0")) throw new Error("нет ручной добавки t_p");
  if (txt.includes("A = q_{20}")) throw new Error("в справке t_r не должно быть параметра A");
  if (txt.includes("Q_r =")) throw new Error("в справке t_r не должно быть Q_r");
});

// ============================================================
// migrateNodeData
// ============================================================

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
` + graphSrc + readSrc("cascade-io.js") + `
return { migrateNodeData };
`,
)();

test("migrateNodeData catch: legacy l1/v1… → segs, ключи удалены", () => {
  const d = ioMod.migrateNodeData("catch", { l1: 68, v1: 0.7, l2: 133, v2: 1.0, l3: 277, v3: 1.5, tcan: 5 });
  if (!Array.isArray(d.segs) || d.segs.length !== 3) throw new Error("segs не собраны из legacy");
  approx(d.segs[0].l, 68); approx(d.segs[0].v, 0.7);
  approx(d.segs[1].l, 133); approx(d.segs[1].v, 1.0);
  approx(d.segs[2].l, 277); approx(d.segs[2].v, 1.5);
  for (const k of ["l1", "v1", "l2", "v2", "l3", "v3"])
    if (k in d) throw new Error(`остался legacy-ключ ${k}`);
  approx(d.tcan, 5);
  if (!Array.isArray(d.trays) || d.trays.length) throw new Error("trays должен быть пустым массивом");
});

test("migrateNodeData catch: legacy даёт тот же tp, что и прежняя формула", () => {
  const d = ioMod.migrateNodeData("catch", { l1: 68, v1: 0.7, l2: 133, v2: 1.0, l3: 277, v3: 1.5 });
  const lv = 68 / 0.7 + 133 / 1.0 + 277 / 1.5;
  const p = N.catchParams(d, n);
  approx(p.tp, 0.017 * lv);
});

test("migrateNodeData catch: новый формат segs/trays нормализуется", () => {
  const d = ioMod.migrateNodeData("catch", { segs: [{ l: "10", v: "2" }], trays: [{ l: "3", v: "1" }] });
  approx(d.segs[0].l, 10); approx(d.segs[0].v, 2);
  approx(d.trays[0].l, 3); approx(d.trays[0].v, 1);
});

test("migrateNodeData catch: не-массивы segs/trays → пустые списки", () => {
  const d = ioMod.migrateNodeData("catch", { segs: "x", trays: null });
  if (!Array.isArray(d.segs) || d.segs.length) throw new Error("segs не приведён к []");
  if (!Array.isArray(d.trays) || d.trays.length) throw new Error("trays не приведён к []");
});

test("migrateNodeData catch: явный segs=[] не подменяется legacy", () => {
  const d = ioMod.migrateNodeData("catch", { segs: [], l1: 68, v1: 0.7 });
  if (d.segs.length !== 0) throw new Error("явный пустой segs перетёрт legacy");
});

console.log(`\n=== ${passed} пройдено, ${failed} не прошло ===`);
if (failed > 0) process.exitCode = 1;
