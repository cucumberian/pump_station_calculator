"use strict";

// UI библиотеки схем: список хранящихся в браузере схем, переключение,
// переименование, дублирование, удаление. Реестр и хранение — в cascade-io.js
// (listSchemes / switchScheme / createScheme / renameScheme / duplicateScheme /
// deleteScheme). Здесь только отрисовка модалки и биндинг.

function fmtSchemeDate(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  const pad = n => String(n).padStart(2, "0");
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${String(d.getFullYear()).slice(2)} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function schemeNoun(n) {
  const n10 = n % 10, n100 = n % 100;
  if (n10 === 1 && n100 !== 11) return "нода";
  if (n10 >= 2 && n10 <= 4 && (n100 < 10 || n100 >= 20)) return "ноды";
  return "нод";
}

function fmtBytes(n) {
  if (!n) return "0 Б";
  if (n < 1024) return n + " Б";
  if (n < 1024 * 1024) return (n / 1024).toFixed(n < 10 * 1024 ? 1 : 0) + " КБ";
  return (n / 1024 / 1024).toFixed(1) + " МБ";
}

// Баннер «схема не сохраняется» — вызывается из cascade-io.js при сбое записи.
function showStorageWarn(msg) {
  const el = $c("storageWarn");
  if (!el) return;
  $c("storageWarnText").textContent = msg;
  el.hidden = false;
}

function hideStorageWarn() {
  const el = $c("storageWarn");
  if (el) el.hidden = true;
}

async function refreshStorageUsage() {
  const el = $c("schemesUsage");
  if (!el) return;
  const count = listSchemes().length;
  const est = await storageEstimate();
  if (!est || !est.quota) {
    el.textContent = `Схем: ${count} / ${MAX_SCHEMES}`;
    return;
  }
  el.textContent = `Схем: ${count} / ${MAX_SCHEMES} · занято ≈ ${fmtBytes(est.usage || 0)} ` +
    `из ≈ ${fmtBytes(est.quota)}`;
}

function closeSchemesModal() {
  $c("schemesModal").hidden = true;
}

function openSchemesModal() {
  renderSchemesModal();
  $c("schemesModal").hidden = false;
}

function renderSchemesModal() {
  const wrap = $c("schemesList");
  wrap.textContent = "";
  const items = listSchemes();
  const atLimit = items.length >= MAX_SCHEMES;
  const newBtn = $c("schemesNew");
  if (newBtn) {
    newBtn.disabled = atLimit;
    newBtn.title = atLimit
      ? `Достигнут предел: ${MAX_SCHEMES} схем — удалите ненужные`
      : "Создать пустую схему";
  }
  refreshStorageUsage();
  if (!items.length) {
    const p = document.createElement("p");
    p.className = "schemes-empty";
    p.textContent = "Схем пока нет.";
    wrap.append(p);
    return;
  }
  for (const it of items) wrap.append(schemeRow(it, items.length));
}

function schemeRow(it, total) {
  const row = document.createElement("div");
  row.className = "scheme-row" + (it.active ? " active" : "");
  row.dataset.id = it.id;

  const main = document.createElement("button");
  main.type = "button";
  main.className = "scheme-main";
  main.title = it.active ? "Текущая схема" : "Открыть схему";
  const title = document.createElement("div");
  title.className = "scheme-title";
  title.textContent = it.displayName;
  if (it.active) {
    const badge = document.createElement("span");
    badge.className = "scheme-badge";
    badge.textContent = "текущая";
    title.append(badge);
  }
  if (it.unsaved) {
    const warn = document.createElement("span");
    warn.className = "scheme-badge unsaved";
    warn.textContent = "не сохранена";
    title.append(warn);
  }
  const sub = document.createElement("div");
  sub.className = "scheme-sub";
  sub.textContent = `${it.nodeCount} ${schemeNoun(it.nodeCount)}` +
    (it.size ? ` · ${fmtBytes(it.size)}` : "") +
    (it.updatedAt ? ` · ${fmtSchemeDate(it.updatedAt)}` : "");
  main.append(title, sub);
  main.addEventListener("click", () => {
    if (switchScheme(it.id)) renderSchemesModal();
  });

  const acts = document.createElement("div");
  acts.className = "scheme-actions";
  const del = schemeAct("del", "Удалить", "✕", () => {
    if (total <= 1) return;
    if (!confirm(`Удалить схему «${it.displayName}»? Это нельзя отменить.`)) return;
    deleteScheme(it.id);
    renderSchemesModal();
  });
  if (total <= 1) del.disabled = true;
  acts.append(
    schemeAct("rename", "Переименовать", "✎", () => startRename(row, it)),
    schemeAct("dup", "Дублировать", "⧉", () => {
      duplicateScheme(it.id);
      renderSchemesModal();
    }),
    del,
  );

  row.append(main, acts);
  return row;
}

function schemeAct(act, title, glyph, fn) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "scheme-act";
  b.dataset.act = act;
  b.title = title;
  b.setAttribute("aria-label", title);
  b.textContent = glyph;
  b.addEventListener("click", fn);
  return b;
}

// Инлайн-переименование: клик по «✎» меняет заголовок на input; Enter/blur —
// сохранить, Escape — отменить (не закрывая модалку).
function startRename(row, it) {
  const title = row.querySelector(".scheme-title");
  const input = document.createElement("input");
  input.type = "text";
  input.className = "scheme-rename-input";
  input.maxLength = 80;
  input.value = it.name || it.displayName;
  let done = false;
  const commit = () => {
    if (done) return;
    done = true;
    renameScheme(it.id, input.value);
    renderSchemesModal();
  };
  input.addEventListener("keydown", e => {
    if (e.key === "Enter") { e.preventDefault(); commit(); }
    else if (e.key === "Escape") { done = true; e.stopPropagation(); renderSchemesModal(); }
  });
  input.addEventListener("blur", commit);
  title.replaceWith(input);
  input.focus();
  input.select();
}

$c("schemesBtn").addEventListener("click", openSchemesModal);
$c("storageWarnBtn").addEventListener("click", openSchemesModal);
$c("schemesClose").addEventListener("click", closeSchemesModal);
$c("schemesModal").addEventListener("click", e => {
  if (e.target === $c("schemesModal")) closeSchemesModal();
});
$c("schemesNew").addEventListener("click", () => {
  createScheme();
  renderSchemesModal();
});
document.addEventListener("keydown", e => {
  if (e.key === "Escape") closeSchemesModal();
});
