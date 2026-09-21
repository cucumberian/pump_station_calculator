"use strict";

// ============================================================
// Перенос параметров между нодами, схемами, страницами и людьми.
//
// Единица переноса — конверт `kns-param` (см. param-schema.js):
//   { format, version, kind, typeVersion, label, name, savedAt, data }
// kind — тип параметров: rain | pump | delay | catch | flow.
// typeVersion — версия интерфейса; при вставке сверяется:
//   меньше текущей  → migrateNodeData конвертирует старую форму;
//   больше текущей  → отказ с сообщением (молча не портим ноду);
//   неизвестный kind → отказ.
//
// Страница регистрирует приёмники: registerParamTarget(kind, { copy, paste }).
// Кнопки размечаются атрибутами (data-param-copy / -paste / -file), общая
// привязка — bindParamTransfer(). Ctrl+V по документу ловит paste-событие.
// ============================================================

const PARAM_TARGETS = {};

function registerParamTarget(kind, handlers) {
  PARAM_TARGETS[kind] = handlers;
}

function paramKindLabel(kind) {
  return PARAM_SCHEMA[kind]?.label || kind;
}

// Всплывающее уведомление об успехе: системные модалки на каждое копирование
// и вставку — лишние клики. Ошибки по-прежнему показываем alert'ом.
let paramToastTimer = null;
let lastParamToast = "";
function paramToastText() { return lastParamToast; } // для тестов и отладки
function paramToast(text) {
  lastParamToast = text;
  if (typeof document === "undefined" || !document.body) return; // не-DOM окружение
  let box = document.getElementById("paramToast");
  if (!box) {
    box = document.createElement("div");
    box.id = "paramToast";
    box.className = "param-toast";
    box.setAttribute("role", "status");
    document.body.append(box);
  }
  box.textContent = text;
  box.classList.add("show");
  clearTimeout(paramToastTimer);
  paramToastTimer = setTimeout(() => box.classList.remove("show"), 2600);
}

// Буфер обмена: Clipboard API с откатом на execCommand (iOS Safari требует
// явный selection — иначе копирование молча не срабатывает).
async function paramCopyText(text) {
  if (navigator.clipboard?.writeText) {
    try { await navigator.clipboard.writeText(text); return true; } catch { /* ниже fallback */ }
  }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.cssText = "position:fixed;top:0;left:0;opacity:0";
  document.body.append(ta);
  ta.focus();
  ta.select();
  ta.setSelectionRange(0, ta.value.length);
  let ok = false;
  try { ok = document.execCommand("copy"); } catch { /* устаревший API, но единственный на старых мобильных */ }
  ta.remove();
  return ok;
}

// Чтение буфера: Clipboard API требует secure context и разрешения, поэтому
// кнопка «Вставить» падает в prompt с ручной вставкой.
async function paramReadText() {
  if (navigator.clipboard?.readText) {
    try {
      const t = await navigator.clipboard.readText();
      if (t && t.trim()) return t;
    } catch { /* нет разрешения — спросим вручную */ }
  }
  return prompt("Вставьте параметры (Ctrl+V / ⌘V):");
}

function paramEnvelope(kind, data, { name = "" } = {}) {
  const schema = PARAM_SCHEMA[kind];
  if (!schema) throw new Error(`неизвестный тип «${kind}»`);
  return {
    format: PARAM_FORMAT,
    version: PARAM_FORMAT_VERSION,
    kind,
    typeVersion: schema.version,
    label: schema.label,
    name: name || "",
    savedAt: new Date().toISOString().slice(0, 19).replace("T", " "),
    data,
  };
}

// Разбор чужого текста. Возвращает { env, data, migrated, fromVersion } либо
// { error } с человекочитаемой причиной.
function parseParamEnvelope(text) {
  if (typeof text !== "string" || !text.trim()) return { error: "буфер обмена пуст" };
  let raw;
  try { raw = JSON.parse(text); } catch { return { error: "в буфере не JSON с параметрами КНС" }; }
  if (!raw || typeof raw !== "object" || raw.format !== PARAM_FORMAT) {
    return { error: "в буфере не параметры КНС" };
  }
  const version = Number(raw.version);
  if (!Number.isFinite(version)) return { error: "не указана версия формата" };
  if (version > PARAM_FORMAT_VERSION) {
    return { error: `формат v${version} новее поддерживаемого (v${PARAM_FORMAT_VERSION}) — обновите приложение` };
  }
  const schema = PARAM_SCHEMA[raw.kind];
  if (!schema) return { error: `неизвестный тип параметров «${raw.kind}»` };
  const typeVersion = Number(raw.typeVersion);
  if (!Number.isFinite(typeVersion) || typeVersion < 0) return { error: `${schema.label}: не указана версия интерфейса` };
  if (typeVersion > schema.version) {
    return { error: `${schema.label}: параметры сделаны в более новой версии интерфейса (v${typeVersion} > v${schema.version}) — обновите приложение` };
  }
  // Сначала проверяем то, что реально пришло (мусор в числовом поле должен
  // дать ошибку, а не тихо подмениться значением по умолчанию), затем
  // прогоняем миграцию исторических форм и накладываем проверенные значения.
  const rawCheck = validateAgainstSchema(raw.kind, raw.data);
  if (rawCheck.errors.length) return { error: `${schema.label}: ${rawCheck.errors.join("; ")}` };
  const data = { ...normalizeParamData(raw.kind, raw.data), ...rawCheck.data };
  return { env: raw, data, fromVersion: typeVersion, migrated: typeVersion < schema.version };
}

// Чужие данные → каноническая форма текущей версии.
function normalizeParamData(kind, data) {
  if (kind === "rain") {
    return typeof normRain === "function" ? normRain({ ...data }) : { ...data };
  }
  return migrateNodeData(kind, data);
}

// Данные для отправки: каноническая форма, только поля текущего интерфейса.
function paramDataOf(kind, raw) {
  const migrated = normalizeParamData(kind, raw);
  const out = {};
  for (const key of Object.keys(PARAM_SCHEMA[kind].fields)) {
    if (key in migrated) out[key] = migrated[key];
  }
  return out;
}

// ctx: { mode: "into" | "new", x, y } — куда вставлять.
function applyParamEnvelope(parsed, ctx = {}) {
  const kind = parsed.env.kind;
  const target = PARAM_TARGETS[kind];
  const label = paramKindLabel(kind);
  if (!target || !target.paste) {
    alert(`${label}: такие параметры сюда вставить нельзя`);
    return false;
  }
  const ok = target.paste(parsed.data, ctx, parsed);
  if (ok === false) return false;
  if (parsed.migrated) paramToast(`${label}: параметры версии v${parsed.fromVersion} сконвертированы в v${PARAM_SCHEMA[kind].version}`);
  else paramToast(`${label}: параметры вставлены`);
  return true;
}

// Вставка из текста (общая для Ctrl+V, кнопки и файла).
function pasteParamText(text, ctx) {
  const parsed = parseParamEnvelope(text);
  if (parsed.error) { alert("Не удалось вставить параметры:\n" + parsed.error); return false; }
  return applyParamEnvelope(parsed, ctx);
}

async function copyParam(kind, data, opts = {}) {
  if (data === null || data === undefined) {
    alert(`${paramKindLabel(kind)}: нечего копировать`);
    return false;
  }
  const text = JSON.stringify(paramEnvelope(kind, data, opts), null, 2);
  const ok = await paramCopyText(text);
  if (!ok) prompt("Скопируйте параметры:", text);
  else paramToast(`${paramKindLabel(kind)}: параметры скопированы${opts.name ? ` («${opts.name}»)` : ""}`);
  return ok;
}

// Имя файла: kns-<kind>[-<имя>].json — по нему видно, что внутри.
function paramFileName(kind, name) {
  const slug = String(name || "")
    .replace(/[^\wа-яёА-ЯЁ\- ]+/g, " ")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 40);
  return `kns-${kind}${slug ? "-" + slug : ""}.json`;
}

function saveParamFile(kind, data, opts = {}) {
  if (data === null || data === undefined) {
    alert(`${paramKindLabel(kind)}: нечего сохранять`);
    return;
  }
  const text = JSON.stringify(paramEnvelope(kind, data, opts), null, 2);
  const blob = new Blob([text], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = opts.file || paramFileName(kind, opts.name);
  a.click();
  URL.revokeObjectURL(a.href);
}

function pickParamFile() {
  return new Promise(resolve => {
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = ".json,application/json";
    inp.style.cssText = "position:fixed;top:0;left:0;opacity:0";
    inp.addEventListener("change", () => {
      const file = inp.files[0] || null;
      inp.remove();
      resolve(file);
    });
    document.body.append(inp);
    inp.click();
  });
}

async function importParamFile(ctx) {
  const file = await pickParamFile();
  if (!file) return false;
  try {
    return pasteParamText(await file.text(), ctx);
  } catch (e) {
    alert("Не удалось прочитать файл: " + e.message);
    return false;
  }
}

// Кнопки с data-param-* внутри root. Приёмники — из PARAM_TARGETS.
function bindParamTransfer(root = document) {
  for (const el of root.querySelectorAll("[data-param-copy]")) {
    el.addEventListener("click", () => {
      const kind = el.dataset.paramCopy;
      const target = PARAM_TARGETS[kind];
      if (!target?.copy) { alert(`${paramKindLabel(kind)}: нечего копировать`); return; }
      const got = target.copy();
      if (!got) return;
      copyParam(kind, got.data, { name: got.name });
    });
  }
  for (const el of root.querySelectorAll("[data-param-paste]")) {
    el.addEventListener("click", async () => {
      const text = await paramReadText();
      if (text) pasteParamText(text);
    });
  }
  for (const el of root.querySelectorAll("[data-param-save]")) {
    el.addEventListener("click", () => {
      const kind = el.dataset.paramSave;
      const target = PARAM_TARGETS[kind];
      if (!target?.copy) { alert(`${paramKindLabel(kind)}: нечего сохранять`); return; }
      const got = target.copy();
      if (got) saveParamFile(kind, got.data, { name: got.name });
    });
  }
  for (const el of root.querySelectorAll("[data-param-file]")) {
    el.addEventListener("click", () => importParamFile());
  }
}

// Ctrl+V по странице. В полях ввода не мешаем: там вставляют текст, а не
// параметры. Если в буфере не конверт КНС — молча ничего не делаем.
function initParamPaste(onCtx) {
  document.addEventListener("paste", e => {
    const el = e.target;
    if (el && (el.closest?.("input, textarea, [contenteditable]") || el.isContentEditable)) return;
    const text = e.clipboardData?.getData("text");
    if (!text) return;
    const parsed = parseParamEnvelope(text);
    if (parsed.error) return; // это не наши параметры — пусть работает как обычно
    e.preventDefault();
    applyParamEnvelope(parsed, onCtx ? onCtx() : {});
  });
}
