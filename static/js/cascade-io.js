"use strict";

const LS_CASCADE = "kns-cascade";
const LS_N = "kns-cascade-n";
const LS_VIEW = "kns-cascade-view";
const LS_META = "kns-cascade-meta";
const FORMAT = "kns-cascade";
const FORMAT_VERSION = 2;

// Библиотека схем: реестр + отдельный ключ на каждую схему.
const LS_INDEX = "kns-cascade:index";
const LS_SCHEME_PREFIX = "kns-cascade:s:";
const LS_VIEW_PREFIX = "kns-cascade:v:";

// Предел числа схем: раньше предупреждаем о распухании localStorage.
const MAX_SCHEMES = 50;
// Sentinel-идентификатор непреобразованной старой одиночной схемы.
const LEGACY_ID = "legacy";

let viewReady = false;
let cascadeMeta = { custom: [] };
// false — последняя запись схемы не удалась (квота/приватный режим).
let storageOk = true;

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

// ============================================================
// Устойчивость к переполнению localStorage. Квота у origin ~5 МБ, узнать
// остаток синхронно нельзя, поэтому:
//   • запись схемы отделена от записи реестра и вьюпорта — не валим одно
//     другим; провал записи блоба = схема не сохранилась (помечаем и
//     показываем баннер), провал индекса/вьюпорта — мягче;
//   • миграция легаси удаляет старые ключи только после успешной записи
//     копии и проверки её чтением (read-back);
//   • операции create/delete держат реестр и блобы согласованными.
// ============================================================

function isQuotaError(e) {
  return !!e && (e.name === "QuotaExceededError"
    || e.name === "NS_ERROR_DOM_QUOTA_REACHED"
    || e.code === 22 || e.code === 1014);
}

// UI-хуки определяются в cascade-schemes.js (грузится раньше), но в тестах
// их может не быть — отсюда typeof-проверки.
function reportStorageFailure(e) {
  storageOk = false;
  if (typeof showStorageWarn === "function") {
    showStorageWarn(isQuotaError(e)
      ? "Схема не сохраняется: в браузере закончилось место."
      : "Схема не сохраняется: хранилище браузера недоступно.");
  }
}

function clearStorageError() {
  if (storageOk) return;
  storageOk = true;
  if (typeof hideStorageWarn === "function") hideStorageWarn();
}

function writeRaw(key, value) {
  try { localStorage.setItem(key, value); return true; }
  catch (e) { reportStorageFailure(e); return false; }
}

// Запись без пользовательского уведомления (вьюпорт, реестр — не критичны).
function writeQuiet(key, value) {
  try { localStorage.setItem(key, value); return true; }
  catch { return false; }
}

// Запись + проверка чтением: без неё нельзя гарантировать, что копия
// реально легла, прежде чем удалять оригинал (миграция).
function writeVerified(key, value) {
  if (!writeRaw(key, value)) return false;
  let back = null;
  try { back = localStorage.getItem(key); } catch { back = null; }
  if (back !== value) { reportStorageFailure(); return false; }
  return true;
}

function touchItem(it, payload, size) {
  it.updatedAt = Date.now();
  it.nodeCount = (payload.nodes || []).length;
  it.size = size;
}

function requestPersistentStorage() {
  try {
    if (navigator.storage && typeof navigator.storage.persist === "function") {
      navigator.storage.persist();
    }
  } catch { /* не критично */ }
}

async function storageEstimate() {
  try {
    if (navigator.storage && typeof navigator.storage.estimate === "function") {
      return await navigator.storage.estimate();
    }
  } catch { /* не критично */ }
  return null;
}

function saveScheme() {
  const idx = ensureIndex();
  let id = activeId();
  if (!id) {
    id = newSchemeId();
    idx.items.push({ id, name: "", updatedAt: Date.now(), nodeCount: 0, size: 0 });
    idx.active = id;
    writeIndex(idx);
  }
  const payload = serializeScheme();
  const json = JSON.stringify(payload);
  const isLegacy = id === LEGACY_ID;
  const targetId = isLegacy ? newSchemeId() : id;

  if (!writeRaw(schemeKey(targetId), json)) {
    // Схема не сохранилась: помечаем запись (если реестр ещё пишется).
    const it = idx.items.find(x => x.id === id);
    if (it) { it.unsaved = true; touchItem(it, payload, json.length); writeIndex(idx); }
    return;
  }

  if (isLegacy) {
    // Первое успешное сохранение переводит легаси-схему на реальный ключ;
    // только после записи реестра убираем старые ключи.
    const it = idx.items.find(x => x.id === LEGACY_ID);
    if (it) { it.id = targetId; it.unsaved = false; touchItem(it, payload, json.length); }
    idx.active = targetId;
    if (!writeIndex(idx)) {
      try { localStorage.removeItem(schemeKey(targetId)); } catch { /* ignore */ }
      reportStorageFailure();
      return;
    }
    removeLegacyKeys();
    id = targetId;
  } else {
    const it = idx.items.find(x => x.id === id);
    if (it) { it.unsaved = false; touchItem(it, payload, json.length); writeIndex(idx); }
  }

  if (viewReady) {
    writeQuiet(viewKey(id), JSON.stringify({
      x: editor.canvas_x, y: editor.canvas_y, z: editor.zoom,
    }));
  }
  clearStorageError();
}

// ============================================================
// Библиотека схем. Несколько независимых схем в localStorage:
// реестр kns-cascade:index = { active, items: [{id, name, updatedAt,
// nodeCount, size, unsaved}] }, схема — kns-cascade:s:<id> (blob
// serializeScheme), вьюпорт — kns-cascade:v:<id>. Старая одиночная схема
// (ключи kns-cascade / -n / -meta / -view) переносится в реестр, но её
// ключи удаляются только после успешной проверенной записи копии —
// сбой записи не уничтожает работу. Открытие ссылки или импорт заводят
// НОВУЮ схему и не трогают активную. Предел — MAX_SCHEMES.
// ============================================================

function schemeKey(id) { return LS_SCHEME_PREFIX + id; }
function viewKey(id) { return LS_VIEW_PREFIX + id; }

function safeParse(json) {
  try { return JSON.parse(json); } catch { return null; }
}

function newSchemeId() {
  return "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function readIndex() {
  const idx = safeParse(localStorage.getItem(LS_INDEX) || "null");
  return idx && Array.isArray(idx.items) ? idx : null;
}

function writeIndex(idx) {
  try { localStorage.setItem(LS_INDEX, JSON.stringify(idx)); return true; }
  catch { return false; } // квота / приватный режим
}

function removeLegacyKeys() {
  try {
    localStorage.removeItem(LS_CASCADE);
    localStorage.removeItem(LS_N);
    localStorage.removeItem(LS_META);
    localStorage.removeItem(LS_VIEW);
  } catch { /* ignore */ }
}

// Временный реестр для непреобразованной легаси-схемы: пока копию не удалось
// записать, работаем прямо со старым ключом, ничего не удаляя.
function legacyIndex() {
  return {
    active: LEGACY_ID,
    items: [{ id: LEGACY_ID, name: "", updatedAt: Date.now(), nodeCount: 0, size: 0 }],
  };
}

// Старый одиночный ключ → первая схема реестра (однократно).
// Легаси-ключи удаляются ТОЛЬКО после проверенной записи копии и реестра;
// при любом сбое работа остаётся на старом ключе и цела.
function migrateLegacyScheme() {
  const raw = localStorage.getItem(LS_CASCADE);
  if (raw === null) return null;
  const legacy = safeParse(raw);
  if (!legacy || typeof legacy !== "object") return null;
  const id = newSchemeId();
  if (!writeVerified(schemeKey(id), raw)) return legacyIndex();
  const view = safeParse(localStorage.getItem(LS_VIEW) || "null");
  if (view && typeof view.x === "number") writeQuiet(viewKey(id), JSON.stringify(view));
  const idx = {
    active: id,
    items: [{
      id, name: "", updatedAt: Date.now(),
      nodeCount: (legacy.nodes || []).length, size: raw.length,
    }],
  };
  if (!writeIndex(idx)) {
    try { localStorage.removeItem(schemeKey(id)); } catch { /* ignore */ }
    return legacyIndex();
  }
  removeLegacyKeys();
  clearStorageError();
  return idx;
}

function ensureIndex() {
  return readIndex() || migrateLegacyScheme() || { active: null, items: [] };
}

function schemeItem(id) {
  return ensureIndex().items.find(it => it.id === id) || null;
}

function activeId() {
  const idx = ensureIndex();
  if (idx.active && idx.items.some(it => it.id === idx.active)) return idx.active;
  return idx.items[0] ? idx.items[0].id : null;
}

function ensureActiveScheme() {
  const idx = ensureIndex();
  let id = activeId();
  if (id) return id;
  id = newSchemeId();
  idx.items.push({ id, name: "", updatedAt: Date.now(), nodeCount: 0, size: 0 });
  idx.active = id;
  writeIndex(idx);
  return id;
}

function schemeItemPayload(id) {
  // Непреобразованная легаси-схема читается прямо из старого ключа.
  if (id === LEGACY_ID) {
    const moved = safeParse(localStorage.getItem(schemeKey(LEGACY_ID)) || "null");
    if (moved) return moved;
    return safeParse(localStorage.getItem(LS_CASCADE) || "null");
  }
  return safeParse(localStorage.getItem(schemeKey(id)) || "null");
}

function readView(id) {
  const v = safeParse(localStorage.getItem(viewKey(id)) || "null");
  return v && typeof v.x === "number" && typeof v.y === "number" && typeof v.z === "number"
    ? v : null;
}

function applyStoredView(view) {
  editor.canvas_x = view.x;
  editor.canvas_y = view.y;
  editor.zoom = Math.min(editor.zoom_max, Math.max(editor.zoom_min, view.z));
  applyTransform();
}

function defaultSchemeName(id) {
  const i = ensureIndex().items.findIndex(it => it.id === id);
  return "Схема " + (i + 1);
}

function schemeDisplayName(it) {
  if (!it) return "Схема";
  if (it.name) return it.name;
  const p = schemeItemPayload(it.id);
  if (p && p.meta && p.meta.title) return p.meta.title;
  return defaultSchemeName(it.id);
}

function listSchemes() {
  const act = activeId();
  return ensureIndex().items.map(it => ({
    id: it.id,
    name: it.name,
    displayName: schemeDisplayName(it),
    nodeCount: it.nodeCount || 0,
    size: it.size || 0,
    unsaved: !!it.unsaved,
    updatedAt: it.updatedAt || 0,
    active: it.id === act,
  }));
}

function schemeLimitMessage() {
  return `Достигнут предел: ${MAX_SCHEMES} схем. Удалите ненужные или сделайте «Экспорт».`;
}

// Создаёт запись схемы из payload (ссылка, импорт, копия).
// Порядок важен: сначала блоб, только потом запись в реестр — иначе при
// нехватке места появлялась бы «фантомная» пустая схема. Возвращает id или
// null (сообщение пользователю уже показано).
function createSchemeFromPayload(payload, name, activate) {
  const idx = ensureIndex();
  if (idx.items.length >= MAX_SCHEMES) {
    alert(schemeLimitMessage());
    return null;
  }
  const id = newSchemeId();
  const p = payload.scheme && !payload.nodes ? payload.scheme : payload;
  const meta = payload.meta && typeof payload.meta === "object" ? payload.meta : { custom: [] };
  const n = (payload.n > 0 && payload.n < 1) ? payload.n : getGlobalN();
  const blob = {
    format: FORMAT,
    version: FORMAT_VERSION,
    meta,
    n,
    nodes: Array.isArray(p.nodes) ? p.nodes : [],
    connections: Array.isArray(p.connections) ? p.connections : [],
  };
  const json = JSON.stringify(blob);
  if (!writeRaw(schemeKey(id), json)) return null; // баннер уже показан
  idx.items.push({
    id, name: String(name || ""), updatedAt: Date.now(),
    nodeCount: blob.nodes.length, size: json.length,
  });
  if (activate !== false) idx.active = id;
  if (!writeIndex(idx)) {
    try { localStorage.removeItem(schemeKey(id)); } catch { /* ignore */ }
    reportStorageFailure();
    return null;
  }
  clearStorageError();
  return id;
}

function loadActiveIntoEditor() {
  const id = ensureActiveScheme();
  const payload = schemeItemPayload(id);
  closeSidebar();
  editor.clear();
  if (payload) {
    cascadeMeta = { custom: [], ...(payload.meta && typeof payload.meta === "object" ? payload.meta : {}) };
    if (!Array.isArray(cascadeMeta.custom)) cascadeMeta.custom = [];
    if (payload.n > 0 && payload.n < 1) $c("globalN").value = padNum(payload.n);
    rebuildScheme(payload, { allowCycle: true });
  }
  const view = readView(id);
  if (view) applyStoredView(view);
  else fitView();
  flushCascade();
}

function switchScheme(id) {
  const idx = ensureIndex();
  if (!id || !idx.items.some(it => it.id === id)) return false;
  if (id === activeId()) return false;
  saveScheme();
  const fresh = ensureIndex();
  fresh.active = id;
  // Если реестр не записался — переключаемся только в сессии (на F5 active
  // откатится), но работу не блокируем; сообщение уже показано.
  if (!writeIndex(fresh)) reportStorageFailure();
  loadActiveIntoEditor();
  return true;
}

function createScheme() {
  const idx0 = ensureIndex();
  if (idx0.items.length >= MAX_SCHEMES) {
    alert(schemeLimitMessage());
    return null;
  }
  saveScheme();
  const idx = ensureIndex();
  const id = newSchemeId();
  idx.items.push({ id, name: "", updatedAt: Date.now(), nodeCount: 0, size: 0 });
  idx.active = id;
  writeIndex(idx);
  cascadeMeta = { custom: [] };
  closeSidebar();
  editor.clear();
  addNodeOfType("pump", 320, 160);
  fitView();
  flushCascade();
  return id;
}

function renameScheme(id, name) {
  const idx = ensureIndex();
  const it = idx.items.find(x => x.id === id);
  if (!it) return false;
  const prev = it.name;
  it.name = String(name || "").trim();
  it.updatedAt = Date.now();
  if (!writeIndex(idx)) {
    it.name = prev;
    reportStorageFailure();
    return false;
  }
  return true;
}

function duplicateScheme(id) {
  saveScheme();
  const src = schemeItemPayload(id);
  if (!src) return null;
  const base = schemeDisplayName(schemeItem(id)) || "Схема";
  return createSchemeFromPayload(src, base + " (копия)", false);
}

// Сначала фиксируем реестр, и только при успехе чистим блобы: иначе при
// провале записи осталась бы запись без блоба («пустая схема»).
function deleteScheme(id) {
  const idx = ensureIndex();
  if (idx.items.length <= 1) return false;
  const i = idx.items.findIndex(it => it.id === id);
  if (i < 0) return false;
  const wasActive = id === activeId();
  const items = idx.items.slice();
  items.splice(i, 1);
  const nextIdx = {
    active: wasActive ? items[Math.min(i, items.length - 1)].id : idx.active,
    items,
  };
  if (!writeIndex(nextIdx)) {
    reportStorageFailure();
    return false;
  }
  if (id !== LEGACY_ID) {
    try {
      localStorage.removeItem(schemeKey(id));
      localStorage.removeItem(viewKey(id));
    } catch { /* ignore */ }
  }
  if (wasActive) loadActiveIntoEditor();
  // Место могло освободиться — пробуем сохранить активную схему ещё раз;
  // баннер снимется только если запись реально прошла (в saveScheme).
  if (!storageOk) saveScheme();
  return true;
}

// ============================================================
// Шаринг ссылкой: схема пакуется во фрагмент адреса после «#».
// Фрагмент не отправляется на сервер (ни 414 от nginx/Apache с их 8 КБ,
// ни попадание в access-логи), поэтому лимит — только строка адреса
// браузера (мегабайты), а мы держим запас SHARE_LIMIT. Payload без
// значений по умолчанию — их возвращает NODE_DEFAULTS в migrateNodeData
// при загрузке; format/version тоже не нужны — подставляются здесь же.
// Замер (40 водосборов + 20 КНС + 30 участков, русские имена): ~3,3 КБ
// против 19,9 КБ исходного JSON. YAML и tree.d после deflate не helped —
// избыточность сжатие съедает, формат менять не имеет смысла.
// ============================================================

const SHARE_PARAM = "s";
const SHARE_LIMIT = 6000;

function stripSharePayload(payload) {
  return {
    n: payload.n,
    nodes: payload.nodes.map(nd => {
      const def = NODE_DEFAULTS[nd.type] || {};
      const d = {};
      for (const k in nd.data || {}) {
        if (JSON.stringify(nd.data[k]) !== JSON.stringify(def[k])) d[k] = nd.data[k];
      }
      return { id: nd.id, type: nd.type, x: nd.x, y: nd.y, data: d };
    }),
    connections: payload.connections,
  };
}

function bytesToB64url(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function b64urlToBytes(code) {
  const bin = atob(code.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// d — deflate-raw (CompressionStream, Chrome 80+/FF 113+/Safari 16.4+);
// j — без сжатия, деградация для старых браузеров: ссылка длиннее, но живая.
async function encodeShareCode(payload) {
  const json = JSON.stringify(stripSharePayload(payload));
  if (typeof CompressionStream === "function") {
    const stream = new Blob([json]).stream()
      .pipeThrough(new CompressionStream("deflate-raw"));
    return "d." + bytesToB64url(new Uint8Array(await new Response(stream).arrayBuffer()));
  }
  return "j." + bytesToB64url(new TextEncoder().encode(json));
}

async function decodeShareCode(code) {
  let json;
  if (code.startsWith("d.")) {
    if (typeof DecompressionStream !== "function") {
      throw new Error("браузер не поддерживает сжатые ссылки");
    }
    const stream = new Blob([b64urlToBytes(code.slice(2))]).stream()
      .pipeThrough(new DecompressionStream("deflate-raw"));
    json = await new Response(stream).text();
  } else if (code.startsWith("j.")) {
    json = new TextDecoder().decode(b64urlToBytes(code.slice(2)));
  } else {
    throw new Error("неизвестный формат ссылки");
  }
  const p = JSON.parse(json);
  return { format: FORMAT, version: FORMAT_VERSION,
    n: p.n, nodes: p.nodes, connections: p.connections };
}

async function copyToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    try { await navigator.clipboard.writeText(text); return true; } catch { /* ниже fallback */ }
  }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.cssText = "position:fixed;top:0;left:0;opacity:0";
  document.body.append(ta);
  ta.focus();
  ta.select();
  ta.setSelectionRange(0, ta.value.length); // iOS Safari требует явный selection
  let ok = false;
  try { ok = document.execCommand("copy"); } catch { /* устаревший API для старых мобильных */ }
  ta.remove();
  return ok;
}

$c("shareCascade").addEventListener("click", async () => {
  const btn = $c("shareCascade"); // кнопка иконочная: feedback — не текст,
                                   // а класс .copied (CSS меняет значок на галочку)
  try {
    flushCascade(); // в ссылку уходит актуальная схема, не до правок
    const code = await encodeShareCode(serializeScheme());
    if (code.length > SHARE_LIMIT) {
      alert(`Схема велика для ссылки: ${code.length} символов, предел ${SHARE_LIMIT}. ` +
        "Используйте «Экспорт» в JSON-файл.");
      return;
    }
    const url = location.href.split("#")[0] + "#" + SHARE_PARAM + "=" + code;
    // Адрес не трогаем: ссылка живёт только в буфере обмена. Фрагмент,
    // оставленный в адресной строке, приживался там и на F5 после правок
    // перезаписывал бы свежую работу старым снимком (баг).
    if (await copyToClipboard(url)) {
      btn.classList.add("copied");
      setTimeout(() => { btn.classList.remove("copied"); }, 1500);
    } else {
      prompt("Скопируйте ссылку вручную:", url);
    }
  } catch (err) {
    alert("Не удалось подготовить ссылку: " + err.message);
  }
});

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
    // Участки сети раньше хранились фиксированной тройкой l1/v1…l3/v3 —
    // переносим в массив segs. Участки лотка — новый массив trays. В обоих
    // массивах держим только числовые {l, v}, прочие записи сохраняем как есть.
    const norm = arr => Array.isArray(arr)
      ? arr.map(s => ({ l: parseFloat(s?.l), v: parseFloat(s?.v) }))
        .filter(s => Number.isFinite(s.l) && Number.isFinite(s.v))
      : [];
    const legacy = [];
    for (const [l, v] of [[d.l1, d.v1], [d.l2, d.v2], [d.l3, d.v3]]) {
      const L = parseFloat(l), V = parseFloat(v);
      if (L > 0 && V > 0) legacy.push({ l: L, v: V });
    }
    const hasSegs = Object.prototype.hasOwnProperty.call(raw || {}, "segs");
    const segs = norm(d.segs);
    d.segs = hasSegs ? segs : (legacy.length ? legacy : segs);
    d.trays = norm(d.trays);
    for (const k of ["l1", "v1", "l2", "v2", "l3", "v3"]) delete d[k];
    // coeffSource = "table": z_mid/ψ_mid считаются по составу поверхностей
    // zRows = [{ type, F, z? }]; z (ручное переопределение) — только у
    // водонепроницаемых, у прочих видов пусто.
    if (d.coeffSource !== "table") d.coeffSource = "manual";
    d.zRows = Array.isArray(d.zRows)
      ? d.zRows.map(r => {
        const type = String(r?.type || "").trim();
        if (!type) return null;
        const F = parseFloat(r?.F);
        const row = { type, F: Number.isFinite(F) && F >= 0 ? F : 0 };
        const zRaw = r?.z;
        if (zRaw === "" || zRaw === null || zRaw === undefined) row.z = "";
        else {
          const z = parseFloat(zRaw);
          if (Number.isFinite(z)) row.z = z;
        }
        return row;
      }).filter(Boolean)
      : [];
    // Добавочная площадь Fдоб, га: прибавляется к F без коэффициентов.
    const fadd = parseFloat(d.Fadd);
    d.Fadd = Number.isFinite(fadd) && fadd >= 0 ? fadd : 0;
  }
  if (type === "delay") {
    const lOld = parseFloat(d.l ?? d.L);
    const dtOld = parseFloat(d.dt);
    d.v = parseFloat(d.v) > 0 ? parseFloat(d.v) : 1;
    d.l = lOld >= 0 ? lOld : (dtOld >= 0 ? Math.round(dtOld * 60) : 3600);
    delete d.L;
    delete d.dt;
  }
  if (type === "flow") {
    // Drawflow пишет значения как строки из input; "" в t1 и t2 легально —
    // «с начала» и «до конца события». Числа нормализуем, мусор → пустое.
    if (d.mode !== "constant") d.mode = "constant";
    const q = parseFloat(d.q);
    d.q = q >= 0 ? q : NODE_DEFAULTS.flow.q;
    if (d.t1 === "" || d.t1 === null || d.t1 === undefined) d.t1 = "";
    else {
      const t1 = parseFloat(d.t1);
      d.t1 = Number.isFinite(t1) && t1 >= 0 ? t1 : "";
    }
    if (d.t2 === "" || d.t2 === null || d.t2 === undefined) d.t2 = "";
    else {
      const t2 = parseFloat(d.t2);
      d.t2 = Number.isFinite(t2) ? t2 : "";
    }
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

function applyPayload(payload, opts) {
  const o = opts || {};
  // Ссылка и импорт файла заводят отдельную схему — активная не затирается.
  // Если новую схему сохранить не удалось (место/предел) — НЕ трогаем холст:
  // иначе flushCascade() перезаписал бы активную схему чужой.
  if (o.asNewScheme && !createSchemeFromPayload(payload, o.name, true)) return false;
  if (payload.meta && typeof payload.meta === "object") {
    cascadeMeta = { custom: [], ...payload.meta };
    if (!Array.isArray(cascadeMeta.custom)) cascadeMeta.custom = [];
  } else if (o.asNewScheme) {
    cascadeMeta = { custom: [] }; // в ссылке meta нет — не тянем мету прошлой схемы
  }
  if (payload.n > 0 && payload.n < 1) $c("globalN").value = padNum(payload.n);
  closeSidebar();
  rebuildScheme(payload.scheme && !payload.nodes ? payload.scheme : payload);
  flushCascade();
  if (o.fit !== false) fitView();
}

// Фрагмент #s= — одноразовый носитель: доставляет снимок первому открытию
// ссылки и сразу убирается из адреса. Иначе он «приживает» в строке и на F5
// плодил бы дубли схемы при каждом обновлении. Canonical состояние — реестр
// схем в localStorage.
function clearShareFragment() {
  try {
    history.replaceState(history.state, "", location.pathname + location.search);
  } catch {
    // file://: replaceState кидает SecurityError — мягкий путь, то же самое
    // событие без перезагрузки (в адресе может остаться пустая «#»).
    try { location.hash = ""; } catch { /* ignore */ }
  }
}

async function loadInitial() {
  loadMeta();
  requestPersistentStorage(); // best-effort: браузер не вытеснит схемы
  // Ссылка — одноразовый носитель: она заводит ОТДЕЛЬНУЮ схему, поэтому
  // незавершённая работа в активной схеме не теряется. Дальше реестр схем —
  // источник истины, а активную схему пользователь переключает вручную.
  const hash = location.hash || "";
  if (hash.startsWith("#" + SHARE_PARAM + "=")) {
    clearShareFragment();
    try {
      const payload = await decodeShareCode(decodeURIComponent(hash.slice(1 + SHARE_PARAM.length + 1)));
      const errors = validatePayload(payload);
      if (errors.length) {
        alert("Схема из ссылки повреждена:\n" + errors.map(x => "• " + x).join("\n"));
      } else if (applyPayload(payload, { asNewScheme: true, name: shareSchemeName(payload) })) {
        viewReady = true;
        return;
      }
      // Новая схема не сохранилась (место/предел) — падаем в обычную загрузку,
      // активная схема не тронута.
    } catch (err) {
      alert("Не удалось прочитать схему из ссылки: " + err.message);
    }
  }
  const id = ensureActiveScheme();
  const stored = schemeItemPayload(id);
  if (stored && !validatePayload(stored, { allowCycle: true }).length) {
    // allowCycle: старая сохранённая схема могла содержать цикл (дыра, закрытая
    // на импорте) — грузим как есть, о цикле предупредит баннер пересчёта.
    applyPayload(stored, { fit: false });
  } else {
    addNodeOfType("pump", 320, 160);
    fitView();
  }
  const view = readView(id);
  if (view) applyStoredView(view);
  else if (stored) fitView();
  viewReady = true;
  flushCascade();
}

function shareSchemeName(payload) {
  const t = payload && payload.meta && payload.meta.title;
  return t ? String(t) : "Схема из ссылки";
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
    const name = file.name.replace(/\.json$/i, "").slice(0, 80) || "Импортированная схема";
    applyPayload(payload, { asNewScheme: true, name });
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
