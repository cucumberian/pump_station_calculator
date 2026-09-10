"use strict";

// Тесты чистого графового слоя (static/js/cascade-graph.js) и topoOrder из
// cascade.js — регрессия на молчаливое дописывание циклических узлов в конец
// порядка (дыра, формальный аналог — cascadeCycle_not_topo в Formal/Graph.lean).

const fs = require("fs");
const path = require("path");

const readSrc = f => fs.readFileSync(path.join(__dirname, "..", "static/js", f), "utf8");

// --- cascade-graph целиком (чистый модуль, DOM не нужен) ---
const G = new Function(readSrc("cascade-graph.js") + `
return { kahnParts, nodesInCycles, cyclePathExample, cycleMessage,
  edgesFromData, rawEdgesOf, effectiveEdgesOf };
`)();

// --- topoOrder / updateCycleBanner из cascade.js: извлекаем исходник по скобкам ---
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

const topoOrder = new Function("edgesFromData", "kahnParts",
  extractFn(cascadeSrc, "topoOrder") + "\nreturn topoOrder;")(G.edgesFromData, G.kahnParts);

// --- helpers ---
let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; }
  catch (e) { failed++; console.error(`\u2716 ${name}\n  ${e.stack || e.message}`); }
}

function node(connections) {
  return { outputs: { output_1: { connections: connections.map(node => ({ node })) } } };
}

// порядок пригоден ⟺ каждое ребро идёт влево
function assertValidOrder(order, edges) {
  const pos = new Map(order.map((id, i) => [String(id), i]));
  for (const { from, to } of edges) {
    const a = pos.get(String(from)), b = pos.get(String(to));
    if (a !== undefined && b !== undefined && !(a < b))
      throw new Error(`ребро ${from}→${to} идёт не влево в порядке [${order}]`);
  }
}

const S = arr => arr.map(String).sort().join(",");

// ============================================================
// kahnParts
// ============================================================

test("kahnParts: acyclic chain — полный пригодный порядок, rest пуст", () => {
  const { order, rest } = G.kahnParts(["1", "2", "3"], [{ from: 1, to: 2 }, { from: 2, to: 3 }]);
  if (rest.length) throw new Error(`expected empty rest, got ${rest}`);
  assertValidOrder(order, [{ from: 1, to: 2 }, { from: 2, to: 3 }]);
  if (order.join(",") !== "1,2,3") throw new Error(`expected [1,2,3], got [${order}]`);
});

test("kahnParts: diamond — порядок пригоден", () => {
  const edges = [{ from: 1, to: 2 }, { from: 1, to: 3 }, { from: 2, to: 4 }, { from: 3, to: 4 }];
  const { order, rest } = G.kahnParts(["1", "2", "3", "4"], edges);
  if (rest.length) throw new Error("diamond should be acyclic");
  assertValidOrder(order, edges);
});

test("kahnParts: isolated node stays in order", () => {
  const { order, rest } = G.kahnParts(["1", "2", "9"], [{ from: 1, to: 2 }]);
  if (rest.length) throw new Error("rest should be empty");
  if (!order.includes("9")) throw new Error("isolated node dropped");
});

test("kahnParts: 2-cycle — обе вершины в rest", () => {
  const { order, rest } = G.kahnParts(["1", "2", "3"], [{ from: 1, to: 2 }, { from: 2, to: 3 }, { from: 3, to: 2 }]);
  if (order.join(",") !== "1") throw new Error(`expected [1], got [${order}]`);
  if (S(rest) !== "2,3") throw new Error(`expected rest {2,3}, got {${rest}}`);
});

test("kahnParts: downstream of a cycle is in rest too", () => {
  const { order, rest } = G.kahnParts(["1", "2", "3", "4"],
    [{ from: 1, to: 2 }, { from: 2, to: 3 }, { from: 3, to: 2 }, { from: 3, to: 4 }]);
  if (order.join(",") !== "1") throw new Error(`expected [1], got [${order}]`);
  if (S(rest) !== "2,3,4") throw new Error(`expected rest {2,3,4}, got {${rest}}`);
});

// ============================================================
// nodesInCycles / cyclePathExample
// ============================================================

test("nodesInCycles: только вершины на цикле, не downstream", () => {
  const cyc = G.nodesInCycles([{ from: 2, to: 3 }, { from: 3, to: 2 }, { from: 3, to: 4 }]);
  if (S(cyc) !== "2,3") throw new Error(`expected {2,3}, got {${cyc}}`);
});

test("cyclePathExample: замкнутый обход", () => {
  const path = G.cyclePathExample([{ from: 2, to: 3 }, { from: 3, to: 5 }, { from: 5, to: 2 }]);
  if (path.join(",") !== "2,3,5,2") throw new Error(`expected 2→3→5→2, got ${path.join("→")}`);
});

test("cyclePathExample: self-loop", () => {
  const path = G.cyclePathExample([{ from: 7, to: 7 }]);
  if (path.join(",") !== "7,7") throw new Error(`expected 7→7, got ${path.join("→")}`);
});

test("cyclePathExample: ациклический граф — null", () => {
  if (G.cyclePathExample([{ from: 1, to: 2 }, { from: 2, to: 3 }]) !== null)
    throw new Error("expected null for acyclic graph");
});

// ============================================================
// effectiveEdgesOf — рёбра ровно такие, какие создаст rebuildScheme
// ============================================================

test("effectiveEdgesOf: second connection of same from is dropped (usedOut)", () => {
  const p = {
    nodes: [
      { id: 1, type: "pump" }, { id: 2, type: "pump" }, { id: 3, type: "pump" },
    ],
    connections: [{ from: 1, to: 2 }, { from: 1, to: 3 }],
  };
  const e = G.effectiveEdgesOf(p);
  if (e.length !== 1 || e[0].to !== "2") throw new Error(`expected [1→2], got ${JSON.stringify(e)}`);
});

test("effectiveEdgesOf: catch→delay is skipped", () => {
  const p = {
    nodes: [{ id: 1, type: "catch" }, { id: 2, type: "delay" }],
    connections: [{ from: 1, to: 2 }],
  };
  if (G.effectiveEdgesOf(p).length) throw new Error("catch→delay should be skipped");
});

test("effectiveEdgesOf: dangling connections dropped", () => {
  const p = {
    nodes: [{ id: 1, type: "pump" }],
    connections: [{ from: 1, to: 99 }, { from: 98, to: 1 }],
  };
  if (G.effectiveEdgesOf(p).length) throw new Error("dangling edges should be dropped");
});

test("effectiveEdgesOf: legacy drawflow format", () => {
  const p = { drawflow: { Home: { data: {
    1: { name: "pump", outputs: { output_1: { connections: [{ node: 2 }] } } },
    2: { name: "catch", outputs: { output_1: { connections: [] } } },
  } } } };
  const e = G.effectiveEdgesOf(p, ["pump", "delay", "catch"]);
  if (e.length !== 1 || e[0].from !== "1" || e[0].to !== "2") throw new Error(`expected [1→2], got ${JSON.stringify(e)}`);
});

// ============================================================
// cycleMessage
// ============================================================

const CYCLIC = {
  format: "kns-cascade", version: 2, n: 0.71,
  nodes: [
    { id: 2, type: "pump", x: 0, y: 0 },
    { id: 3, type: "pump", x: 0, y: 0 },
    { id: 5, type: "pump", x: 0, y: 0 },
  ],
  connections: [{ from: 2, to: 3 }, { from: 3, to: 5 }, { from: 5, to: 2 }],
};

test("cycleMessage: содержит путь и узлы цикла", () => {
  const msg = G.cycleMessage(CYCLIC);
  if (!msg) throw new Error("expected a message");
  if (!msg.includes("2 → 3 → 5 → 2") || !msg.includes("узлы в цикле: 2, 3, 5"))
    throw new Error(`unexpected message: ${msg}`);
});

test("cycleMessage: null для ациклической схемы", () => {
  if (G.cycleMessage({ nodes: [{ id: 1, type: "pump", x: 0, y: 0 }], connections: [] }) !== null)
    throw new Error("expected null");
});

// ============================================================
// topoOrder (cascade.js) — регрессия на молчаливое дописывание
// ============================================================

test("topoOrder: acyclic — весь порядок пригоден, cyclic пуст", () => {
  const data = {
    1: node([2, 3]),
    2: node([4]),
    3: node([4]),
    4: node([]),
  };
  const { order, cyclic } = topoOrder(data);
  if (cyclic.length) throw new Error(`acyclic scheme flagged: ${cyclic}`);
  assertValidOrder(order, [{ from: 1, to: 2 }, { from: 1, to: 3 }, { from: 2, to: 4 }, { from: 3, to: 4 }]);
});

test("topoOrder: cycle — циклические узлы НЕ дописаны в конец (регрессия)", () => {
  const data = {
    1: node([2]),
    2: node([3]),
    3: node([2, 4]),
    4: node([]),
  };
  const { order, cyclic } = topoOrder(data);
  if (order.join(",") !== "1") throw new Error(`expected order [1], got [${order}]`);
  if (S(cyclic) !== "2,3,4") throw new Error(`expected cyclic {2,3,4}, got {${cyclic}}`);
});

test("topoOrder: пустой граф", () => {
  const { order, cyclic } = topoOrder({});
  if (order.length || cyclic.length) throw new Error("empty graph should give empty results");
});

// ============================================================
// updateCycleBanner — DOM-заглушка минимальна
// ============================================================

test("updateCycleBanner: цикл — видно текст с узлами; нет цикла — скрыт", () => {
  const el = { hidden: true, textContent: "" };
  const document = { getElementById: () => el };
  const updateCycleBanner = new Function("document", "edgesFromData", "nodesInCycles", "cyclePathExample",
    extractFn(cascadeSrc, "updateCycleBanner") + "\nreturn updateCycleBanner;")(document, G.edgesFromData, G.nodesInCycles, G.cyclePathExample);
  const data = { 2: node([3]), 3: node([2, 4]), 4: node([]) };
  updateCycleBanner(data, ["2", "3", "4"]);
  if (el.hidden) throw new Error("banner should be visible");
  if (!el.textContent.includes("2 → 3 → 2")) throw new Error(`bad text: ${el.textContent}`);
  if (!el.textContent.includes("#4")) throw new Error(`downstream missing: ${el.textContent}`);
  updateCycleBanner({ 1: node([]), 2: node([]) }, []);
  if (!el.hidden) throw new Error("banner should hide when no cycle");
});

test("updateCycleBanner: нет элемента — не падает", () => {
  const document = { getElementById: () => null };
  const updateCycleBanner = new Function("document", "edgesFromData", "nodesInCycles", "cyclePathExample",
    extractFn(cascadeSrc, "updateCycleBanner") + "\nreturn updateCycleBanner;")(document, G.edgesFromData, G.nodesInCycles, G.cyclePathExample);
  updateCycleBanner({ 2: node([2]) }, ["2"]);
});

// ============================================================
// Итог
// ============================================================

console.log(`\n=== ${passed} пройдено, ${failed} не прошло ===`);
process.exit(failed ? 1 : 0);
