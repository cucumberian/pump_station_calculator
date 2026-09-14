"use strict";

// Шаринг ссылкой (фрагмент #s=...): упаковка схемы в адрес без сервера.
// Покрывает: strip дефолтов, round-trip deflate-raw/base64url, валидацию
// восстановленного payload, обработчик кнопки «Поделиться» и загрузку
// loadInitial() из location.hash — на реальном коде cascade-io.js.

const fs = require("fs");
const path = require("path");

// ---- shared mocks (как в cascade-io.test.js) + реестр элементов ----
const NODE_PORTS = { pump: [1, 1], delay: [1, 1], catch: [0, 1] };
const NODE_DEFAULTS = {
  pump: { name: "", desc: "", qr: 342.3, tr: 10, q: 100, idle: 50, mode: "analytic" },
  delay: { name: "", desc: "", v: 1, l: 3600 },
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
global.localStorage = {
  _store: {},
  getItem(k) { return this._store[k] ?? null; },
  setItem(k, v) { this._store[k] = v; },
  removeItem(k) { delete this._store[k]; },
  clear() { this._store = {}; },
};

// Мок страницы: редактор-накопитель + глобальные функции cascade.js.
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
global.padNum = v => String(v);
global.addNodeOfType = () => {};

const location = { href: "http://site/cascade.html", hash: "" };
global.location = location;
global.history = { replaceState(_s, _t, url) {
  location.href = url.split("#")[0];
  location.hash = url.includes("#") ? "#" + url.split("#")[1] : "";
} };
const clipboard = { copied: null, async writeText(t) { this.copied = t; } };
// В Node 24 глобальный navigator — getter-only, перекрываем через defineProperty.
Object.defineProperty(global, "navigator", { value: { clipboard }, configurable: true });
let lastAlert = null;
global.alert = msg => { lastAlert = msg; };

// graphData() — как в cascade.js: узлы editor.nodes keyed by id + связи.
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

// ---- load cascade-io with mocks ----
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
  validatePayload,
  stripSharePayload, encodeShareCode, decodeShareCode,
  serializeScheme, saveScheme, loadInitial, applyPayload,
  SHARE_PARAM, SHARE_LIMIT, FORMAT, FORMAT_VERSION,
};
`,
)();

// ---- test helpers ----
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
  lastAlert = null;
  clipboard.copied = null;
  location.href = "http://site/cascade.html";
  location.hash = "";
  localStorage.clear();
}

// Реалистичная схема: значения и по умолчанию, и отличные; юникод.
const SCHEME = {
  n: 0.71,
  nodes: [
    { id: 1, type: "catch", x: 60, y: 120, data: { name: "", desc: "",
        F: 7.31, q20: 80, P: 0.56, mr: 150, gamma: 1.54, psiMid: 0.634, zMid: 0.201,
        tcon: 3, tcan: 0, l1: 68, v1: 0.7, l2: 133, v2: 1.0, l3: 277, v3: 1.5,
        coeffMode: "variable" } },
    { id: 2, type: "pump", x: 200, y: 400, data: { name: "КНС-1", desc: "",
        qr: 343.29, tr: 10, q: 104.75, idle: 50, mode: "analytic" } },
    { id: 3, type: "delay", x: 300, y: 600, data: { name: "Коллектор к.3",
        desc: "β-сталь Ду500", v: 1.35, l: 2414 } },
    { id: 4, type: "pump", x: 620, y: 400, data: { name: "КНС-2", desc: "",
        qr: 421.5, tr: 12.5, q: 200, idle: 30, mode: "numeric" } },
  ],
  connections: [{ from: 1, to: 2 }, { from: 2, to: 3 }, { from: 3, to: 4 }],
};

(async () => {

await test("stripSharePayload оставляет только отличные от дефолтов", () => {
  const s = ioMod.stripSharePayload(SCHEME);
  eq(s.nodes.find(n => n.id === 2).data, { name: "КНС-1", qr: 343.29, q: 104.75 });
  eq(s.nodes.find(n => n.id === 4).data,
    { name: "КНС-2", qr: 421.5, tr: 12.5, q: 200, idle: 30, mode: "numeric" });
  eq(s.nodes.find(n => n.id === 1).data, { F: 7.31, P: 0.56 });
});

await test("round-trip: encode → decode даёт strip схемы + format/version", async () => {
  const code = await ioMod.encodeShareCode(SCHEME);
  if (!code.startsWith("d.")) throw new Error("ожидался префикс deflate 'd.'");
  const back = await ioMod.decodeShareCode(code);
  eq(back.format, ioMod.FORMAT);
  eq(back.version, ioMod.FORMAT_VERSION);
  eq(back.n, SCHEME.n);
  eq(back.nodes, ioMod.stripSharePayload(SCHEME).nodes);
  eq(back.connections, SCHEME.connections);
});

await test("восстановленный из ссылки payload проходит validatePayload", async () => {
  const back = await ioMod.decodeShareCode(await ioMod.encodeShareCode(SCHEME));
  const errs = ioMod.validatePayload(back);
  if (errs.length) throw new Error(errs.join("; "));
});

await test("код ссылки — только base64url, без percent-encoding", async () => {
  const code = await ioMod.encodeShareCode(SCHEME);
  if (!/^[dj]\.[A-Za-z0-9_-]+$/.test(code)) throw new Error("чужие символы: " + code.slice(0, 40));
  if (code.length > ioMod.SHARE_LIMIT) throw new Error(`типичная схема не влезает: ${code.length}`);
});

await test("ссылка с циклом отклоняется валидатором после decode", async () => {
  const cyc = JSON.parse(JSON.stringify(SCHEME));
  cyc.connections.push({ from: 4, to: 1 });
  const back = await ioMod.decodeShareCode(await ioMod.encodeShareCode(cyc));
  const errs = ioMod.validatePayload(back);
  if (!errs.some(e => /цикл/i.test(e))) throw new Error("цикл не обнаружен: " + errs.join("; "));
});

await test("деградация без сжатия: 'j.' декодируется", async () => {
  const bytes = new TextEncoder().encode(JSON.stringify(ioMod.stripSharePayload(SCHEME)));
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  const code = "j." + btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  const back = await ioMod.decodeShareCode(code);
  eq(back.nodes, ioMod.stripSharePayload(SCHEME).nodes);
});

await test("битый код ссылки — явная ошибка, не тихий мусор", async () => {
  for (const bad of ["x.abc", "d.%%%not-base64%%%", "d.oeW7h"]) {
    let threw = false;
    try { await ioMod.decodeShareCode(bad); } catch { threw = true; }
    if (!threw) throw new Error("не бросил исключение: " + bad);
  }
});

await test("кнопка «Поделиться»: кликабельна, пишет в буфер ссылку #s=", async () => {
  reset();
  editor.nodeId = 0;
  editor.addNode("catch", 0, 1, 60, 120, "catch", { ...NODE_DEFAULTS.catch, F: 7.31 });
  editor.nodeId = 1;
  editor.addNode("pump", 0, 1, 200, 400, "pump", { ...NODE_DEFAULTS.pump, qr: 343.29 });
  editor.addConnection(0, 1);
  const handler = $c("shareCascade").handlers.click;
  if (typeof handler !== "function") throw new Error("обработчик клика не навешан");
  await handler();
  if (!location.hash.startsWith("#s=")) throw new Error("hash не обновлён: " + location.hash);
  const url = clipboard.copied;
  if (!url || !url.includes("#s=")) throw new Error("в буфер не попало: " + url);
  const back = await ioMod.decodeShareCode(url.split("#s=")[1]);
  if (ioMod.validatePayload(back).length) throw new Error("ссылка ведёт на невалидную схему");
  if (back.nodes.length !== 2) throw new Error("в ссылке " + back.nodes.length + " нод");
});

await test("обратная связь — галочка через класс .copied (текст в кнопке не нужен)", async () => {
  // Кнопка иконочная: после копирования JS вешает .copied (CSS меняет значок
  // на галочку), через 1,5 с снимает. Никакого textContent — он стёр бы SVG.
  reset();
  editor.nodeId = 0;
  editor.addNode("pump", 0, 1, 200, 400, "pump", { ...NODE_DEFAULTS.pump, qr: 343.29 });
  const btn = $c("shareCascade");
  await btn.handlers.click();
  if (!btn.classList.contains("copied")) throw new Error(".copied не повешен после копирования");
  if (btn.textContent !== "") throw new Error("в иконочную кнопку записан текст");
  // и в разметке: внутри кнопки нет текста, только два svg; CSS переключает их
  const htmlSrc = fs.readFileSync(path.join(__dirname, "..", "cascade.html"), "utf8");
  const btnTag = htmlSrc.slice(htmlSrc.indexOf('<button class="btn" id="shareCascade"'),
    htmlSrc.indexOf("</button>", htmlSrc.indexOf('id="shareCascade"')));
  // всё вне двух <svg> внутри кнопки должно быть пустым (текста нет);
  // btnTag уже вырезан до </button>
  const inner = btnTag.slice(btnTag.indexOf(">") + 1)
    .replace(/<svg[\s\S]*?<\/svg>/g, "").trim();
  if (inner !== "") throw new Error("в кнопке остался текст: " + JSON.stringify(inner));
  if (!btnTag.includes('class="ic ic-nodes-right"') || !btnTag.includes('class="ic ic-check"'))
    throw new Error("в кнопке нет обеих иконок (nodes-right + галочка)");
  if (!btnTag.includes('aria-label="Поделиться"'))
    throw new Error("у иконочной кнопки нет aria-label");
  const cssSrc = fs.readFileSync(path.join(__dirname, "..", "static/css/cascade.css"), "utf8");
  if (!cssSrc.includes("#shareCascade.copied .ic-check"))
    throw new Error("CSS не переключает иконку по классу .copied");
});

await test("loadInitial читает схему из location.hash в редактор", async () => {
  reset();
  const code = await ioMod.encodeShareCode(SCHEME);
  location.hash = "#s=" + code;
  await ioMod.loadInitial();
  if (lastAlert) throw new Error("alert при загрузке: " + lastAlert);
  if (editor.nodes.length !== SCHEME.nodes.length)
    throw new Error("загружено " + editor.nodes.length + " нод вместо " + SCHEME.nodes.length);
  const p2 = editor.nodes.find(n => n.data && n.data.name === "КНС-1");
  if (!p2) throw new Error("КНС-1 потерялась");
  eq(p2.data.qr, 343.29);
  eq(p2.data.tr, 10); // дефолт восстановлен из NODE_DEFAULTS
});

await test("битый хеш не ломает загрузку: alert + откат на обычную загрузку", async () => {
  reset();
  location.hash = "#s=d.%%%сбой%%%";
  await ioMod.loadInitial(); // не должен бросить
  if (!lastAlert) throw new Error("ожидался alert о битой ссылке");
  // loadInitial откатился на обычную ветку: в редакторе есть нода после addNodeOfType?
  // addNodeOfType — мок no-op, так что проверяем только отсутствие падения и alert.
});

await test("ссылка приоритетнее localStorage (шаринг побеждает локальную копию)", async () => {
  reset();
  // локально лежит одна pump-нода...
  editor.addNode("pump", 0, 1, 320, 160, "pump", { ...NODE_DEFAULTS.pump });
  ioMod.saveScheme();
  editor.clear();
  // ...а в хеше — четырёхузловая SCHEME
  location.hash = "#s=" + await ioMod.encodeShareCode(SCHEME);
  await ioMod.loadInitial();
  eq(editor.nodes.length, 4);
});

await test("большая схема (90 нод) влезает в SHARE_LIMIT", async () => {
  const big = { n: 0.71, nodes: [], connections: [] };
  for (let i = 0; i < 90; i++) {
    const type = i % 3 === 0 ? "catch" : i % 3 === 1 ? "pump" : "delay";
    big.nodes.push({ id: i, type, x: 100 + i * 40, y: 200, data:
      type === "catch" ? { ...NODE_DEFAULTS.catch, F: 2 + (i % 7) * 1.13, P: 0.4 + (i % 5) * 0.2, name: `Водосбор №${i}` }
      : type === "pump" ? { ...NODE_DEFAULTS.pump, qr: 120 + i * 7.5, q: 30 + i * 2.5, name: `КНС-${i}` }
      : { ...NODE_DEFAULTS.delay, l: 600 + i * 91, v: 0.6 + (i % 9) * 0.1, name: `Уч-к ${i}` } });
    if (i > 0) big.connections.push({ from: i - 1, to: i });
  }
  const code = await ioMod.encodeShareCode(big);
  if (code.length > ioMod.SHARE_LIMIT) throw new Error(`90-нодовая схема: ${code.length} > ${ioMod.SHARE_LIMIT}`);
  const back = await ioMod.decodeShareCode(code);
  if (ioMod.validatePayload(back).length) throw new Error("валидация большой схемы упала");
});

console.log(`\n=== ${passed} пройдено, ${failed} не прошло ===`);
process.exit(failed ? 1 : 0);

})();
