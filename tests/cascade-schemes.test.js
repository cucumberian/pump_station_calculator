"use strict";

// Библиотека схем: несколько независимых схем в localStorage.
// Покрывает реестр kns-cascade:index, миграцию старого одиночного ключа,
// переключение/переименование/дублирование/удаление, вьюпорт на схему и
// создание отдельной схемы из payload (ссылка/импорт) — на реальном коде
// cascade-io.js.

const fs = require("fs");
const path = require("path");

const NODE_PORTS = { pump: [1, 1], delay: [1, 1], catch: [0, 1], flow: [0, 1] };
const NODE_DEFAULTS = {
  pump: { name: "", desc: "", qr: 342.3, tr: 10, q: 100, idle: 50, mode: "analytic" },
  delay: { name: "", desc: "", v: 1, l: 3600, d: "" },
  flow: { name: "", desc: "", mode: "constant", q: 50, t1: 0, t2: "" },
  catch: { name: "", desc: "", F: 3.9, q20: 80, P: 1.0, mr: 150, gamma: 1.54,
    psiMid: 0.634, zMid: 0.201, tcon: 3, tcan: 0,
    l1: 68, v1: 0.7, l2: 133, v2: 1.0, l3: 277, v3: 1.5, coeffMode: "variable" },
};

function makeEl() {
  const el = {
    value: "0.71", hidden: false, textContent: "", innerHTML: "", style: {},
    handlers: {},
    addEventListener(ev, fn) { this.handlers[ev] = fn; },
    removeEventListener() {}, querySelector: () => null,
    _classes: new Set(),
    appendChild: () => {}, append: () => {}, focus: () => {}, click: () => {},
    select: () => {}, setSelectionRange: () => {}, remove: () => {},
  };
  el.classList = {
    add: c => el._classes.add(c),
    remove: c => el._classes.delete(c),
    toggle: c => { el._classes.has(c) ? el._classes.delete(c) : el._classes.add(c); },
    contains: c => el._classes.has(c),
  };
  return el;
}
const elements = new Map();
global.$c = id => {
  if (!elements.has(id)) elements.set(id, makeEl());
  return elements.get(id);
};
global.document = {
  getElementById: global.$c,
  createElement: () => makeEl(),
  addEventListener: () => {}, removeEventListener: () => {},
  querySelector: () => null, querySelectorAll: () => [],
};
global.window = {
  addEventListener: () => {}, innerWidth: 1024, innerHeight: 768,
  matchMedia: () => ({ matches: false }),
};
function quotaError() {
  const e = new Error("quota exceeded");
  e.name = "QuotaExceededError";
  return e;
}
global.localStorage = {
  _store: {},
  failBlob: false,   // падает запись блобов схем (kns-cascade:s:*)
  quotaFull: false,  // падает любая запись
  getItem(k) { return Object.prototype.hasOwnProperty.call(this._store, k) ? this._store[k] : null; },
  setItem(k, v) {
    if (this.quotaFull) throw quotaError();
    if (this.failBlob && k.startsWith("kns-cascade:s:")) throw quotaError();
    this._store[k] = String(v);
  },
  removeItem(k) { delete this._store[k]; },
  clear() { this._store = {}; },
};

const editor = {
  canvas_x: 0, canvas_y: 0, zoom: 1, zoom_min: 0.2, zoom_max: 4, nodeId: 0,
  nodes: [], conns: [],
  clear() { this.nodes = []; this.conns = []; },
  addNode(type, ni, no, x, y, cls, data) {
    this.nodes.push({ id: this.nodeId, type, x, y, data });
    return this.nodes.length - 1;
  },
  addConnection(a, b) { this.conns.push({ a, b }); },
};
global.editor = editor;
global.closeSidebar = () => {};
global.flushCascade = () => {};
global.fitView = () => {};
global.applyTransform = () => {};
global.padNum = v => String(v);
global.addNodeOfType = (type, x, y) => {
  let maxId = 0;
  for (const n of editor.nodes) if (n.id > maxId) maxId = n.id;
  editor.nodeId = maxId + 1;
  editor.addNode(type, 0, 1, x, y, type, { ...NODE_DEFAULTS[type] });
  return editor.nodes.length - 1;
};

const location = {
  _href: "http://site/cascade.html", pathname: "/cascade.html", search: "",
  get hash() { const i = this._href.indexOf("#"); return i < 0 ? "" : this._href.slice(i); },
  set hash(h) {
    const base = this._href.split("#")[0];
    this._href = base + (h === "" ? "" : h.startsWith("#") ? h : "#" + h);
  },
  get href() { return this._href; },
  set href(u) { this._href = u; },
};
global.location = location;
function applyUrl(url) {
  let abs = String(url);
  if (/^\/[^/]/.test(abs)) {
    const m = location._href.match(/^https?:\/\/[^/]+/);
    abs = (m ? m[0] : "") + abs;
  }
  const [beforeHash, h = ""] = abs.split("#");
  location._href = beforeHash + (h ? "#" + h : "");
  const originEnd = beforeHash.indexOf("/", beforeHash.indexOf("//") + 2);
  location.pathname = originEnd < 0 ? "/" : beforeHash.slice(originEnd).split("?")[0];
  const qi = beforeHash.indexOf("?", originEnd + 1);
  location.search = qi >= 0 ? beforeHash.slice(qi) : "";
}
global.history = { replaceState(_s, _t, url) { applyUrl(url); } };
global.alert = () => {};

global.graphData = () => {
  const data = {};
  for (const n of editor.nodes) {
    data[n.id] = { name: n.type, pos_x: n.x, pos_y: n.y, data: n.data, outputs: {} };
  }
  for (const c of editor.conns) {
    const fromNode = editor.nodes[c.a], toNode = editor.nodes[c.b];
    if (!fromNode || !toNode) continue;
    (data[fromNode.id].outputs.output_1 = { connections: [] })
      .connections.push({ node: toNode.id });
  }
  return data;
};

const ioPath = path.join(__dirname, "..", "static/js/cascade-io.js");
const cascadeSrc = fs.readFileSync(ioPath, "utf8");

const ioPrelude = `
const NODE_PORTS = ${JSON.stringify(NODE_PORTS)};
const NODE_DEFAULTS = ${JSON.stringify(NODE_DEFAULTS)};
const NODE_HTML = {};

function getGlobalN() { return parseFloat($c("globalN").value); }

${fs.readFileSync(path.join(__dirname, "..", "static/js/cascade-graph.js"), "utf8")}
`;

const ioMod = new Function(
  ioPrelude + cascadeSrc + `
return {
  validatePayload, serializeScheme, saveScheme, loadInitial, applyPayload,
  listSchemes, activeId, ensureIndex, createScheme, switchScheme,
  renameScheme, duplicateScheme, deleteScheme, schemeItemPayload,
  createSchemeFromPayload, schemeKey, viewKey,
  MAX_SCHEMES, LEGACY_ID,
};
`,
)();

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; }
  catch (e) { failed++; console.error(`\u2716 ${name}\n  ${e.stack || e.message}`); }
}
function eq(a, b) {
  const ja = JSON.stringify(a), jb = JSON.stringify(b);
  if (ja !== jb) throw new Error(`mismatch:\n  ${ja}\n  ${jb}`);
}

function reset() {
  editor.clear();
  editor.canvas_x = 0; editor.canvas_y = 0; editor.zoom = 1;
  applyUrl("http://site/cascade.html");
  localStorage.clear();
  localStorage.failBlob = false;
  localStorage.quotaFull = false;
}

function seedNodes(...types) {
  editor.clear();
  types.forEach((t, i) => {
    editor.nodeId = i + 1;
    editor.addNode(t, 0, 1, 100 + i * 200, 200, t, { ...NODE_DEFAULTS[t] });
  });
}

const SCHEME = {
  format: "kns-cascade", version: 2, n: 0.71,
  nodes: [
    { id: 1, type: "pump", x: 100, y: 200, data: { ...NODE_DEFAULTS.pump, qr: 999 } },
    { id: 2, type: "delay", x: 300, y: 200, data: { ...NODE_DEFAULTS.delay, l: 500 } },
  ],
  connections: [{ from: 1, to: 2 }],
};

(async () => {

await test("миграция: старый ключ kns-cascade становится схемой реестра, легаси удаляются", () => {
  reset();
  localStorage.setItem("kns-cascade", JSON.stringify(SCHEME));
  localStorage.setItem("kns-cascade-view", JSON.stringify({ x: 10, y: 20, z: 1.2 }));
  const items = ioMod.listSchemes();
  eq(items.length, 1);
  eq(items[0].nodeCount, 2);
  if (!items[0].active) throw new Error("мигрированная схема не активна");
  if (localStorage.getItem("kns-cascade") !== null) throw new Error("легаси kns-cascade не удалён");
  if (localStorage.getItem("kns-cascade-view") !== null) throw new Error("легаси view не удалён");
  const p = ioMod.schemeItemPayload(items[0].id);
  eq(p.nodes.length, 2);
  const view = JSON.parse(localStorage.getItem(ioMod.viewKey(items[0].id)));
  eq(view.x, 10);
});

await test("saveScheme: создаёт реестр и активную схему, повторно не плодит записи", () => {
  reset();
  seedNodes("pump", "pump");
  ioMod.saveScheme();
  ioMod.saveScheme();
  const items = ioMod.listSchemes();
  eq(items.length, 1);
  eq(items[0].nodeCount, 2);
  if (!items[0].active) throw new Error("новая схема не активна");
});

await test("переключение схем: холст грузит целевую, её данные сохраняются", () => {
  reset();
  seedNodes("pump", "pump", "catch");
  ioMod.saveScheme();
  const aId = ioMod.activeId();
  ioMod.createScheme();            // B: одна дефолтная КНС
  const bId = ioMod.activeId();
  if (bId === aId) throw new Error("createScheme не сменил активную");
  eq(editor.nodes.length, 1);

  if (!ioMod.switchScheme(aId)) throw new Error("switchScheme(A) вернул false");
  eq(ioMod.activeId(), aId);
  eq(editor.nodes.length, 3);

  ioMod.switchScheme(bId);
  eq(ioMod.activeId(), bId);
  eq(editor.nodes.length, 1);

  eq(ioMod.schemeItemPayload(aId).nodes.length, 3);
  eq(ioMod.schemeItemPayload(bId).nodes.length, 1);
});

await test("переименование меняет отображаемое имя и переживает перечитывание", () => {
  reset();
  seedNodes("pump");
  ioMod.saveScheme();
  const id = ioMod.activeId();
  ioMod.renameScheme(id, "  Объект №5  ");
  eq(ioMod.listSchemes()[0].displayName, "Объект №5");
  eq(ioMod.schemeItemPayload(id).nodes.length, 1);
});

await test("дублирование создаёт копию, не меняя активную схему", () => {
  reset();
  seedNodes("pump", "delay");
  ioMod.saveScheme();
  const aId = ioMod.activeId();
  const dupId = ioMod.duplicateScheme(aId);
  if (!dupId || dupId === aId) throw new Error("копия не создана");
  eq(ioMod.activeId(), aId);
  eq(ioMod.listSchemes().length, 2);
  const dup = ioMod.listSchemes().find(s => s.id === dupId);
  if (!/\(копия\)$/.test(dup.displayName)) throw new Error("имя копии без пометки: " + dup.displayName);
  eq(ioMod.schemeItemPayload(dupId).nodes.length, 2);
});

await test("удаление: последнюю нельзя, неактивную — активная не трогается", () => {
  reset();
  seedNodes("pump");
  ioMod.saveScheme();
  const aId = ioMod.activeId();
  if (ioMod.deleteScheme(aId) !== false) throw new Error("последнюю схему удалось удалить");
  eq(ioMod.listSchemes().length, 1);

  const bId = ioMod.duplicateScheme(aId);
  eq(ioMod.listSchemes().length, 2);
  const activeBefore = ioMod.activeId();
  if (!ioMod.deleteScheme(bId)) throw new Error("неактивная схема не удалилась");
  eq(ioMod.listSchemes().length, 1);
  eq(ioMod.activeId(), activeBefore);
  eq(editor.nodes.length, 1);
});

await test("удаление активной переключает на оставшуюся и грузит её на холст", () => {
  reset();
  seedNodes("pump", "pump", "pump");
  ioMod.saveScheme();
  const aId = ioMod.activeId();
  seedNodes("catch");
  ioMod.createScheme();            // B активна, 1 нода
  eq(editor.nodes.length, 1);
  // делаем активной A (3 ноды) и удаляем её
  ioMod.switchScheme(aId);
  const bId = ioMod.listSchemes().find(s => s.id !== aId).id;
  if (!ioMod.deleteScheme(aId)) throw new Error("активная схема не удалилась");
  eq(ioMod.activeId(), bId);
  eq(ioMod.listSchemes().length, 1);
});

await test("вьюпорт хранится на схему и восстанавливается при переключении", () => {
  reset();
  seedNodes("pump");
  ioMod.saveScheme();
  const aId = ioMod.activeId();
  ioMod.createScheme();
  const bId = ioMod.activeId();
  localStorage.setItem(ioMod.viewKey(aId), JSON.stringify({ x: 111, y: 222, z: 1.5 }));
  ioMod.switchScheme(aId);
  eq(editor.canvas_x, 111);
  eq(editor.canvas_y, 222);
  eq(editor.zoom, 1.5);
  ioMod.switchScheme(bId);
  eq(ioMod.listSchemes().length, 2);
});

await test("applyPayload(asNewScheme): новая активная схема, старая цела", () => {
  reset();
  seedNodes("pump");
  ioMod.saveScheme();
  const aId = ioMod.activeId();
  ioMod.applyPayload(SCHEME, { asNewScheme: true, name: "Из ссылки" });
  const items = ioMod.listSchemes();
  eq(items.length, 2);
  const newId = ioMod.activeId();
  if (newId === aId) throw new Error("новая схема не стала активной");
  eq(ioMod.schemeItemPayload(newId).nodes.length, 2);
  eq(ioMod.schemeItemPayload(aId).nodes.length, 1);
  eq(editor.nodes.length, 2);
});

await test("loadInitial без ссылки грузит активную схему из реестра", async () => {
  reset();
  seedNodes("pump", "catch");
  ioMod.saveScheme();
  const aId = ioMod.activeId();
  editor.clear();
  await ioMod.loadInitial();
  eq(editor.nodes.length, 2);
  eq(ioMod.activeId(), aId);
});

await test("loadInitial: старый одиночный ключ подхватывается через миграцию", async () => {
  reset();
  localStorage.setItem("kns-cascade", JSON.stringify(SCHEME));
  await ioMod.loadInitial();
  eq(editor.nodes.length, 2);
  eq(ioMod.listSchemes().length, 1);
});

// ============================================================
// Переполнение хранилища и пределы
// ============================================================

await test("saveScheme при квоте помечает схему «не сохранена» и снимает пометку после восстановления", () => {
  reset();
  seedNodes("pump");
  ioMod.saveScheme();
  const id = ioMod.activeId();

  localStorage.failBlob = true;
  seedNodes("pump", "pump", "pump");
  ioMod.saveScheme();
  localStorage.failBlob = false;

  const it = ioMod.listSchemes().find(s => s.id === id);
  if (!it || !it.unsaved) throw new Error("нет пометки unsaved при сбое записи");
  // блоб остался от прошлого успешного сохранения — реестр не потерян
  if (ioMod.listSchemes().length !== 1) throw new Error("реестр поехал при сбое");

  ioMod.saveScheme();
  const after = ioMod.listSchemes().find(s => s.id === id);
  if (after.unsaved) throw new Error("пометка unsaved не снята после успешной записи");
});

await test("createSchemeFromPayload при квоте не создаёт «фантомную» схему", () => {
  reset();
  seedNodes("pump");
  ioMod.saveScheme();
  const before = ioMod.listSchemes().length;
  const activeBefore = ioMod.activeId();

  localStorage.failBlob = true;
  const nid = ioMod.createSchemeFromPayload(SCHEME, "Из ссылки", true);
  localStorage.failBlob = false;

  if (nid !== null) throw new Error("ожидался null при нехватке места");
  eq(ioMod.listSchemes().length, before);
  eq(ioMod.activeId(), activeBefore); // активной осталась прежняя схема
});

await test("deleteScheme при провале реестра НЕ удаляет блоб (нет рассинхрона)", () => {
  reset();
  seedNodes("pump");
  ioMod.saveScheme();
  const aId = ioMod.activeId();
  const bId = ioMod.duplicateScheme(aId);
  eq(ioMod.listSchemes().length, 2);

  localStorage.quotaFull = true;
  const ok = ioMod.deleteScheme(bId);
  localStorage.quotaFull = false;

  if (ok !== false) throw new Error("удаление прошло при полной квоте");
  eq(ioMod.listSchemes().length, 2);
  if (!ioMod.schemeItemPayload(bId)) throw new Error("блоб удалён вопреки провалу реестра");
});

await test("миграция при нехватке места не удаляет легаси и остаётся на нём", () => {
  reset();
  localStorage.setItem("kns-cascade", JSON.stringify(SCHEME));
  localStorage.quotaFull = true;
  const items = ioMod.listSchemes();
  localStorage.quotaFull = false;

  eq(items.length, 1);
  eq(items[0].id, ioMod.LEGACY_ID);
  if (localStorage.getItem("kns-cascade") === null) {
    throw new Error("легаси-ключ удалён, хотя копия не записалась");
  }
  // холст читает данные прямо из легаси
  eq(ioMod.schemeItemPayload(ioMod.LEGACY_ID).nodes.length, 2);
});

await test("легаси-схема переезжает на реальный ключ при первом успешном сохранении", () => {
  reset();
  localStorage.setItem("kns-cascade", JSON.stringify(SCHEME));
  // миграция проходит сразу (места хватает)
  const items = ioMod.listSchemes();
  if (items[0].id === ioMod.LEGACY_ID) throw new Error("миграция не выполнилась при свободном месте");
  if (localStorage.getItem("kns-cascade") !== null) throw new Error("легаси не убран после успешной миграции");
  eq(ioMod.listSchemes().length, 1);
  eq(items[0].nodeCount, 2);
});

await test("MAX_SCHEMES: сверх предела схема не создаётся", () => {
  reset();
  const mk = () => ({
    format: "kns-cascade", version: 2, n: 0.71,
    nodes: [{ id: 1, type: "pump", x: 0, y: 0, data: { ...NODE_DEFAULTS.pump } }],
    connections: [],
  });
  for (let i = 0; i < ioMod.MAX_SCHEMES; i++) {
    const id = ioMod.createSchemeFromPayload(mk(), "s" + i, i === 0);
    if (!id) throw new Error("не создалась схема #" + i);
  }
  eq(ioMod.listSchemes().length, ioMod.MAX_SCHEMES);
  const over = ioMod.createSchemeFromPayload(mk(), "over", false);
  if (over !== null) throw new Error("создана схема сверх предела");
  eq(ioMod.listSchemes().length, ioMod.MAX_SCHEMES);
});

console.log(`\n=== ${passed} пройдено, ${failed} не прошло ===`);
process.exit(failed ? 1 : 0);

})();
