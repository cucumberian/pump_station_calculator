"use strict";

// Чистый графовый слой каскада: без DOM и Drawflow — чтобы тестировать в node
// и сверять напрямую с формальной моделью formal/Formal/Graph.lean.
//
// Инвариант из Lean («пригодный порядок ⇒ ацикличен», cascadeCycle_not_topo):
// вершины, не прошедшие Kahn, нельзя молча дописывать в порядок пересчёта —
// именно это делал старый topoOrder (строка дописывания хвоста). Здесь:
//   kahnParts          — пригодный порядок + «остаток» (циклы и всё, что ниже их);
//   nodesInCycles      — вершины, лежащие НА цикле (достижимы из себя же);
//   cyclePathExample   — замкнутый обход для текста предупреждения;
//   effectiveEdgesOf   — рёбра, которые rebuildScheme действительно создаст;
//   cycleMessage       — готовое сообщение о цикле (для импорта — по эффективным
//                        рёбрам, для живого холста — по фактическим).
//
// Импорт проверяется по эффективным рёбрам, иначе были бы ложные срабатывания
// на файл, который цикла на холсте не создаст: rebuildScheme берёт только
// ПЕРВОЕ соединение каждого «from» (usedOut) и не связывает catch → delay.
// Живой холст (topoOrder в cascade.js) проверяется по фактическим рёбрам —
// там usedOut уже обеспечен редактором.

// --- рёбра ---------------------------------------------------------------

// Home.data-подобный объект: {id: {outputs: {o: {connections: [{node}]}}}}
function edgesFromData(data) {
  const edges = [];
  for (const [id, nd] of Object.entries(data || {})) {
    for (const out of Object.values((nd && nd.outputs) || {})) {
      for (const c of (out && out.connections) || []) {
        if (c && c.node !== undefined && c.node !== null) edges.push({ from: String(id), to: String(c.node) });
      }
    }
  }
  return edges;
}

// Все соединения payload'а (оба формата), как их видит rebuildScheme, в исходном порядке.
function rawEdgesOf(p) {
  if (!p || typeof p !== "object") return [];
  if (Array.isArray(p.connections)) {
    return (p.connections || [])
      .filter(c => c && c.from !== undefined && c.to !== undefined)
      .map(c => ({ from: String(c.from), to: String(c.to) }));
  }
  const data = p.drawflow && p.drawflow.Home && p.drawflow.Home.data;
  return data ? edgesFromData(data) : [];
}

// Рёбра, которые rebuildScheme действительно создаст на холсте:
// только известные ноды, только первое соединение каждого «from» (usedOut),
// без catch → delay. validTypes — массив допустимых имён типов; по умолчанию
// словарь узлов приложения (в браузере вызывать как Object.keys(NODE_PORTS)).
function effectiveEdgesOf(p, validTypes) {
  const types = validTypes && validTypes.length ? new Set(validTypes) : new Set(["pump", "delay", "catch"]);
  if (!p || typeof p !== "object") return [];
  let ids, type, raw;
  if (Array.isArray(p.nodes)) {
    ids = new Set(); type = new Map();
    for (const nd of p.nodes || []) {
      const id = String((nd && nd.id !== undefined ? nd.id : ""));
      if (!id) continue;
      ids.add(id); type.set(id, nd && nd.type);
    }
    raw = (p.connections || [])
      .filter(c => c && c.from !== undefined && c.to !== undefined)
      .map(c => ({ from: String(c.from), to: String(c.to) }));
  } else {
    const data = p.drawflow && p.drawflow.Home && p.drawflow.Home.data;
    if (!data || typeof data !== "object") return [];
    ids = new Set(); type = new Map();
    for (const [id, nd] of Object.entries(data)) {
      if (nd && types.has(nd.name)) { ids.add(id); type.set(id, nd.name); }
    }
    raw = edgesFromData(data);
  }
  const out = [], used = new Set();
  for (const e of raw) {
    if (!ids.has(e.from) || !ids.has(e.to)) continue;
    if (used.has(e.from)) continue;
    if (type.get(e.from) === "catch" && type.get(e.to) === "delay") continue;
    out.push(e);
    used.add(e.from);
  }
  return out;
}

// --- порядок и циклы -----------------------------------------------------

function adjacency(edges) {
  const adj = new Map();
  for (const { from, to } of edges) {
    const f = String(from), t = String(to);
    if (!adj.has(f)) adj.set(f, []);
    if (!adj.has(t)) adj.set(t, []);
    adj.get(f).push(t);
  }
  return adj;
}

// Kahn: `order` — пригодный (все рёбра идут влево — это свойство TopoOrder из
// Formal/Graph.lean), `rest` — вершины, чья входимость не обнулилась: циклы
// и всё, что получает из них поток. rest пуст ⇔ порядок пригоден для
// однопроходного расчёта.
function kahnParts(ids, edges) {
  const S = ids.map(String);
  const adj = new Map(S.map(id => [id, []]));
  const indeg = new Map(S.map(id => [id, 0]));
  for (const { from, to } of edges) {
    const f = String(from), t = String(to);
    if (!adj.has(f) || !adj.has(t)) continue;
    adj.get(f).push(t);
    indeg.set(t, indeg.get(t) + 1);
  }
  const q = S.filter(id => indeg.get(id) === 0);
  const order = [];
  while (q.length) {
    const id = q.shift();
    order.push(id);
    for (const t of adj.get(id)) {
      indeg.set(t, indeg.get(t) - 1);
      if (indeg.get(t) === 0) q.push(t);
    }
  }
  const done = new Set(order);
  return { order, rest: S.filter(id => !done.has(id)) };
}

// Вершины на циклах: обход из вершины возвращается к ней самой.
function nodesInCycles(edges) {
  const adj = adjacency(edges);
  const out = [];
  for (const start of adj.keys()) {
    const seen = new Set();
    const stack = [...adj.get(start)];
    let found = false;
    while (stack.length) {
      const cur = stack.pop();
      if (cur === start) { found = true; break; }
      if (seen.has(cur)) continue;
      seen.add(cur);
      for (const t of adj.get(cur) || []) stack.push(t);
    }
    if (found) out.push(start);
  }
  return out;
}

// Замкнутый обход цикла для сообщения: [a, b, a]. DFS с «серыми» на стеке:
// ребро в серую вершину — начало цикла.
function cyclePathExample(edges) {
  const adj = adjacency(edges);
  const color = new Map(); // отсутствие — white, 1 gray, 2 black
  const path = [];
  let found = null;
  const dfs = u => {
    color.set(u, 1);
    path.push(u);
    for (const v of adj.get(u)) {
      if (color.get(v) === 1) {
        found = path.slice(path.indexOf(v)).concat([v]);
        break;
      }
      if (!color.has(v)) {
        dfs(v);
        if (found) break;
      }
    }
    path.pop();
    color.set(u, 2);
  };
  for (const s of adj.keys()) {
    if (color.has(s)) continue;
    dfs(s);
    if (found) break;
  }
  return found;
}

// Сообщение о цикле. opts.raw — проверять фактические соединения payload'а
// (по умолчанию — эффективные, т.е. то, что появится на холсте).
// opts.validTypes — список типов для legacy drawflow.
function cycleMessage(p, opts) {
  const edges = opts && opts.raw ? rawEdgesOf(p) : effectiveEdgesOf(p, opts && opts.validTypes);
  const cyc = nodesInCycles(edges);
  if (!cyc.length) return null;
  const path = cyclePathExample(edges);
  return `схема содержит цикл: ${path ? path.join(" → ") : cyc.join(", ")} (узлы в цикле: ${cyc.join(", ")})`;
}
