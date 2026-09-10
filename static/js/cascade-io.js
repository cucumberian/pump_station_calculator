"use strict";

const LS_CASCADE = "kns-cascade";
const LS_N = "kns-cascade-n";
const LS_VIEW = "kns-cascade-view";
const LS_META = "kns-cascade-meta";
const FORMAT = "kns-cascade";
const FORMAT_VERSION = 2;

let viewReady = false;
let cascadeMeta = { custom: [] };

const META_FIELDS = [
  ["metaTitle", "title"],
  ["metaAuthor", "author"],
  ["metaEmail", "email"],
  ["metaOrg", "organization"],
  ["metaObject", "object"],
  ["metaDate", "date"],
  ["metaDesc", "description"],
];

function loadMeta() {
  try {
    const m = JSON.parse(localStorage.getItem(LS_META) || "null");
    if (m && typeof m === "object") cascadeMeta = { custom: [], ...m };
  } catch { /* приватный режим */ }
  if (!Array.isArray(cascadeMeta.custom)) cascadeMeta.custom = [];
}

function saveScheme() {
  try {
    localStorage.setItem(LS_CASCADE, JSON.stringify(serializeScheme()));
    localStorage.setItem(LS_N, $c("globalN").value);
    localStorage.setItem(LS_META, JSON.stringify(cascadeMeta));
    if (viewReady) {
      localStorage.setItem(LS_VIEW, JSON.stringify({
        x: editor.canvas_x,
        y: editor.canvas_y,
        z: editor.zoom,
      }));
    }
  } catch { /* приватный режим */ }
}

function serializeScheme() {
  const data = graphData();
  const nodes = [];
  const connections = [];
  for (const [id, nd] of Object.entries(data)) {
    nodes.push({ id: +id, type: nd.name, x: nd.pos_x, y: nd.pos_y, data: nd.data });
    for (const out of Object.values(nd.outputs || {})) {
      for (const c of out.connections) connections.push({ from: +id, to: +c.node });
    }
  }
  return {
    format: FORMAT,
    version: FORMAT_VERSION,
    meta: cascadeMeta,
    n: getGlobalN(),
    nodes,
    connections,
  };
}

function migrateNodeData(type, raw) {
  const d = { ...NODE_DEFAULTS[type], ...(raw || {}) };
  if (type === "pump") {
    if (d.Qr !== undefined) { d.qr = d.Qr; delete d.Qr; }
    if (d.Q !== undefined) { d.q = d.Q; delete d.Q; }
  }
  if (type === "catch") {
    // Drawflow пишет в данные имя DOM-атрибута, а DOM всегда нижний регистр:
    // ввод в поле F/P плодил в data призрачный ключ "f"/"p" — поле показывало
    // его, а расчёт читал устаревший канонический F/P. При загрузке склеиваем:
    // свежее показанное значение (f/p) становится каноническим, дубликат вон.
    const pf = parseFloat(d.f), pp = parseFloat(d.p);
    if (Number.isFinite(pf) && pf > 0) d.F = pf;
    if (Number.isFinite(pp) && pp > 0) d.P = pp;
    delete d.f;
    delete d.p;
  }
  if (type === "delay") {
    const lOld = parseFloat(d.l ?? d.L);
    const dtOld = parseFloat(d.dt);
    d.v = parseFloat(d.v) > 0 ? parseFloat(d.v) : 1;
    d.l = lOld >= 0 ? lOld : (dtOld >= 0 ? Math.round(dtOld * 60) : 3600);
    delete d.L;
    delete d.dt;
  }
  return d;
}

function rebuildScheme(payload, opts) {
  const errors = validatePayload(payload, opts);
  if (errors.length) throw new Error(errors.join("; "));
  editor.clear();
  let map = {};
  if (Array.isArray(payload.nodes)) {
    for (const nd of payload.nodes) {
      const [ni, no] = NODE_PORTS[nd.type];
      editor.nodeId = nd.id;
      map[nd.id] = editor.addNode(nd.type, ni, no, nd.x, nd.y, nd.type,
        migrateNodeData(nd.type, nd.data), NODE_HTML[nd.type]);
    }
    const usedOut = new Set();
    for (const c of payload.connections || []) {
      if (map[c.from] === undefined || map[c.to] === undefined) continue;
      if (usedOut.has(c.from)) continue;
      const fromType = payload.nodes.find(n => n.id === c.from)?.type;
      const toType = payload.nodes.find(n => n.id === c.to)?.type;
      if (fromType === "catch" && toType === "delay") continue;
      editor.addConnection(map[c.from], map[c.to], "output_1", "input_1");
      usedOut.add(c.from);
    }
  } else {
    const data = payload.drawflow?.Home?.data || {};
    for (const [oldId, nd] of Object.entries(data)) {
      if (!(nd.name in NODE_PORTS)) continue;
      const [ni, no] = NODE_PORTS[nd.name];
      editor.nodeId = +oldId;
      map[oldId] = editor.addNode(nd.name, ni, no, nd.pos_x, nd.pos_y, nd.name,
        migrateNodeData(nd.name, nd.data), NODE_HTML[nd.name]);
    }
    const usedOut = new Set();
    for (const [oldId, nd] of Object.entries(data)) {
      if (!map[oldId]) continue;
      for (const out of Object.values(nd.outputs || {})) {
        for (const conn of out.connections) {
          if (!map[conn.node]) continue;
          if (usedOut.has(oldId)) continue;
          if (nd.name === "catch" && data[conn.node]?.name === "delay") continue;
          editor.addConnection(map[oldId], map[conn.node], "output_1", "input_1");
          usedOut.add(oldId);
        }
      }
    }
  }
}

function validatePayload(p, opts) {
  const errors = [];
  if (!p || typeof p !== "object") return ["файл не является JSON-объектом"];
  if (p.format !== undefined) {
    if (p.format !== FORMAT) errors.push(`неизвестный формат "${p.format}"`);
    if (typeof p.version !== "number") errors.push("отсутствует версия формата");
    else if (p.version > FORMAT_VERSION) errors.push(`версия формата ${p.version} новее поддерживаемой (${FORMAT_VERSION})`);
    if (!Array.isArray(p.nodes)) errors.push("отсутствует массив nodes");
    else {
      for (const nd of p.nodes) {
        if (!nd || typeof nd !== "object") { errors.push("некорректная нода"); continue; }
        if (!(nd.type in NODE_PORTS)) errors.push(`неизвестный тип ноды "${nd.type}"`);
        if (!Number.isFinite(nd.x) || !Number.isFinite(nd.y)) errors.push(`нода ${nd.id}: некорректные координаты`);
        if (nd.data !== undefined && (typeof nd.data !== "object" || nd.data === null)) errors.push(`нода ${nd.id}: data не объект`);
      }
      const ids = new Set(p.nodes.map(n => n.id));
      for (const c of p.connections || []) {
        if (!ids.has(c.from) || !ids.has(c.to)) errors.push(`связь ${c.from}→${c.to}: несуществующая нода`);
      }
      // Цикл, молча севший на холст, делает порядок пересчёта непригодным
      // (formal/Formal/Graph.lean, cascadeCycle_not_topo) — файл с циклом не грузится.
      // opts.allowCycle — снисходительно к старым сохранённым схемам (localStorage).
      if (!(opts && opts.allowCycle) && typeof cycleMessage === "function") {
        const cyc = cycleMessage(p, { validTypes: Object.keys(NODE_PORTS) });
        if (cyc) errors.push(cyc);
      }
    }
    if (p.n !== undefined && !(p.n > 0 && p.n < 1)) errors.push("параметр n вне диапазона (0; 1)");
  } else if (!p.drawflow && !p.scheme) {
    errors.push("неизвестная структура файла: нет ни format, ни drawflow");
  }
  // Для drawflow-структуры (без массива nodes) — та же проверка ацикличности.
  if (p.format === undefined && p.drawflow && !(opts && opts.allowCycle) && typeof cycleMessage === "function") {
    const cyc = cycleMessage(p, { validTypes: Object.keys(NODE_PORTS) });
    if (cyc) errors.push(cyc);
  }
  return errors;
}

function applyPayload(payload) {
  if (payload.meta && typeof payload.meta === "object") {
    cascadeMeta = { custom: [], ...payload.meta };
    if (!Array.isArray(cascadeMeta.custom)) cascadeMeta.custom = [];
  }
  if (payload.n > 0 && payload.n < 1) $c("globalN").value = payload.n;
  closeSidebar();
  rebuildScheme(payload.scheme && !payload.nodes ? payload.scheme : payload);
  flushCascade();
  fitView();
}

function loadInitial() {
  loadMeta();
  let stored = null;
  try { stored = JSON.parse(localStorage.getItem(LS_CASCADE) || "null"); } catch { stored = null; }
  const storedN = parseFloat(localStorage.getItem(LS_N));
  if (storedN > 0 && storedN < 1) $c("globalN").value = storedN;
  if (stored && !validatePayload(stored, { allowCycle: true }).length) {
    // allowCycle: старая сохранённая схема могла содержать цикл (дыра, закрытая
    // на импорте) — грузим как есть, о цикле предупредит баннер пересчёта.
    rebuildScheme(stored, { allowCycle: true });
  } else {
    addNodeOfType("pump", 320, 160);
  }
  let view = null;
  try { view = JSON.parse(localStorage.getItem(LS_VIEW) || "null"); } catch { view = null; }
  if (view && typeof view.x === "number" && typeof view.y === "number" && typeof view.z === "number") {
    editor.canvas_x = view.x;
    editor.canvas_y = view.y;
    editor.zoom = Math.min(editor.zoom_max, Math.max(editor.zoom_min, view.z));
    applyTransform();
  } else {
    fitView();
  }
  flushCascade();
  viewReady = true;
}

function renderMetaCustom() {
  const wrap = $c("metaCustom");
  wrap.innerHTML = "";
  cascadeMeta.custom.forEach((row, i) => {
    const div = document.createElement("div");
    div.className = "meta-custom-row";
    const key = document.createElement("input");
    key.type = "text";
    key.placeholder = "Поле";
    key.value = row.key || "";
    const val = document.createElement("input");
    val.type = "text";
    val.placeholder = "Значение";
    val.value = row.value || "";
    const del = document.createElement("button");
    del.type = "button";
    del.className = "modal-close meta-custom-del";
    del.innerHTML = XMARK_HTML;
    del.title = "Удалить поле";
    key.addEventListener("input", () => { cascadeMeta.custom[i].key = key.value; saveScheme(); });
    val.addEventListener("input", () => { cascadeMeta.custom[i].value = val.value; saveScheme(); });
    del.addEventListener("click", () => { cascadeMeta.custom.splice(i, 1); renderMetaCustom(); saveScheme(); });
    div.append(key, val, del);
    wrap.appendChild(div);
  });
}

function openMetaModal() {
  for (const [elId, key] of META_FIELDS) {
    $c(elId).value = cascadeMeta[key] || "";
  }
  if (!$c("metaDate").value) $c("metaDate").value = new Date().toISOString().slice(0, 10);
  renderMetaCustom();
  $c("metaModal").hidden = false;
}

function bindMetaModal() {
  $c("metaBtn").addEventListener("click", openMetaModal);
  $c("metaClose").addEventListener("click", () => { $c("metaModal").hidden = true; });
  $c("metaModal").addEventListener("click", e => {
    if (e.target === $c("metaModal")) $c("metaModal").hidden = true;
  });
  document.addEventListener("keydown", e => {
    if (e.key === "Escape") $c("metaModal").hidden = true;
  });
  for (const [elId, key] of META_FIELDS) {
    $c(elId).addEventListener("input", () => {
      cascadeMeta[key] = $c(elId).value;
      saveScheme();
    });
  }
  $c("metaAddCustom").addEventListener("click", () => {
    cascadeMeta.custom.push({ key: "", value: "" });
    renderMetaCustom();
  });
}

$c("exportJson").addEventListener("click", () => {
  const payload = serializeScheme();
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "kns-cascade.json";
  a.click();
  URL.revokeObjectURL(a.href);
});
$c("exportReport").addEventListener("click", () => {
  flushCascade(); // в отчёт попадают свежие результаты
  const payload = serializeScheme();
  const md = buildReportMD({ nodes: payload.nodes, connections: payload.connections }, results, { meta: cascadeMeta, n: getGlobalN(), payload });
  downloadTextFile("kns-obosnovanie.md", md);
});
$c("importJson").addEventListener("click", () => $c("importFile").click());
$c("importFile").addEventListener("change", async e => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const payload = JSON.parse(await file.text());
    const data = payload.scheme && !payload.nodes ? payload.scheme : payload;
    const errors = validatePayload(data);
    if (errors.length) {
      alert("Не удалось загрузить файл:\n" + errors.map(x => "• " + x).join("\n"));
      return;
    }
    applyPayload(payload);
  } catch (err) {
    alert("Не удалось загрузить файл: " + (err instanceof SyntaxError ? "невалидный JSON" : err.message));
  } finally {
    e.target.value = "";
  }
});
$c("clearAll").addEventListener("click", () => {
  if (!confirm("Удалить все ноды и связи?")) return;
  closeSidebar();
  editor.clear();
  flushCascade();
});
