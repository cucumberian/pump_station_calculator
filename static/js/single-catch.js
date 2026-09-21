"use strict";

// ============================================================
// Дождь и водосбор в одиночном расчёте — те же вычисления, что в каскаде,
// но без нод: состояние живёт в этом файле, а формулы берутся из
// cascade-catch.js (catchParams) и cascade-rain.js (профиль дождя, A).
// Ничего не дублируется: меняешь таблицу в reference-data.js — меняется
// расчёт и здесь, и в каскаде.
//
// Режим «по водосбору» пишет рассчитанные Qr и tr в поля «Исходных данных»,
// режим «вручную» оставляет их на совести пользователя.
// ============================================================

const $sc = id => document.getElementById(id);
const LS_CATCH = "kns-single-catch";

// Дефолты повторяют контрольный пример ВОДГЕО (2006) и текущие значения
// страницы: F = 3,9 га, z_mid = 0,201, ψ_mid = 0,634, q₂₀ = 80, P = 1,
// m_r = 150, γ = 1,54, n = 0,71, t_con = 3 + t_can = 7 → t_r = 10.
const CATCH_DEFAULTS = {
  coeffMode: "variable", coeffSource: "manual",
  F: 3.9, zMid: 0.201, psiMid: 0.634, tcon: 3, tcan: 7, tp: 0,
  segs: [], trays: [],
  zRows: SURFACE_TYPES.map(t => ({ type: t.key, F: 0, z: "" })),
};

const CATCH_NUM = { catchF: "F", catchZ: "zMid", catchPsi: "psiMid", catchTcon: "tcon", catchTcan: "tcan", catchTp: "tp" };
const RAIN_NUM = { rainQ20: "q20", rainP: "P", rainMr: "mr", rainGamma: "gamma" };
// n живёт в поле #n (оно же у расчёта КНС), профиль дождя лишь зеркалит его
// для формулы A и справки.
const SINGLE_RAIN_RESETS = [["n", "rainResetN"], ["mr", "rainResetMr"], ["gamma", "rainResetGamma"]];

const catchState = { mode: "catch", data: { ...CATCH_DEFAULTS } };
let applying = false;
// Точные (неокруглённые) Qr/tr режима «по водосбору» — их читает расчёт КНС
// в app.js. В полях показываются округлённые значения: поля — витрина.
let singleCatchDerived = null;

function currentN() {
  const v = parseFloat($sc("n").value);
  return Number.isFinite(v) && v > 0 && v < 1 ? v : 0.71;
}

// Профиль дождя — единственный в одиночном расчёте (id 1), живёт в
// rainProfiles из cascade-rain.js: оттуда же normRain и rainHelpBlocks.
function activeRain() {
  const r = normRain(getActiveRain());
  r.n = currentN();
  rainProfiles[0].n = r.n;
  return r;
}

// Чистая часть: состояние → данные нодоподобного объекта → результат.
function singleCatchData(st) {
  return { ...CATCH_DEFAULTS, ...st };
}
function singleCatchCalc(st) {
  const rain = st.rain || activeRain();
  return { p: catchParams(singleCatchData(st.data || catchState.data), rain.n, rain), rain };
}

// ---------- URL и localStorage ----------

function catchUrlParams(p) {
  const r = activeRain();
  p.set("mode", catchState.mode);
  for (const [elId, key] of Object.entries(RAIN_NUM)) p.set("c." + key, r[key]);
  p.set("c.district", r.district === null ? "" : r.district);
  p.set("c.n", currentN());
  const d = catchState.data;
  for (const key of ["F", "zMid", "psiMid", "tcon", "tcan", "tp", "coeffMode", "coeffSource"]) {
    p.set("c." + key, d[key] === "" ? "" : d[key]);
  }
  // Пустые заготовки строк в адрес не тащим; состав поверхностей имеет смысл
  // только в режиме «по составу».
  const okNum = v => Number.isFinite(parseFloat(v)) && parseFloat(v) >= 0;
  const lists = [["segs", ["l", "v"]], ["trays", ["l", "v"]]];
  if (d.coeffSource === "table") lists.push(["zRows", ["F", "type"]]);
  for (const [key, fields] of lists) {
    const rows = (d[key] || []).filter(s => fields.every(f => f === "type" ? !!s?.[f] : okNum(s[f])));
    if (rows.length) p.set("c." + key, JSON.stringify(rows));
  }
}

function catchUrlLoad(p) {
  if (!p.has("mode")) return false;
  catchState.mode = p.get("mode") === "manual" ? "manual" : "catch";
  const r = rainProfiles[0];
  for (const [elId, key] of Object.entries(RAIN_NUM)) {
    const v = parseFloat(p.get("c." + key));
    if (Number.isFinite(v)) r[key] = v;
  }
  r.district = Number.isInteger(parseInt(p.get("c.district"), 10)) && p.get("c.district") !== ""
    ? parseInt(p.get("c.district"), 10) : null;
  return applyCatchParams(p, r);
}

function applyCatchParams(p, r) {
  const n = parseFloat(p.get("c.n"));
  if (Number.isFinite(n)) { $sc("n").value = padNum(n); r.n = n; }
  const d = { ...catchState.data };
  for (const key of ["F", "zMid", "psiMid", "tcon", "tcan", "tp"]) {
    const v = parseFloat(p.get("c." + key));
    if (Number.isFinite(v)) d[key] = v;
  }
  if (p.get("c.coeffMode")) d.coeffMode = p.get("c.coeffMode") === "const" ? "const" : "variable";
  if (p.get("c.coeffSource")) d.coeffSource = p.get("c.coeffSource") === "table" ? "table" : "manual";
  for (const key of ["segs", "trays", "zRows"]) {
    const raw = safeJson(p.get("c." + key));
    if (raw) d[key] = raw;
  }
  catchState.data = d;
  return true;
}

function safeJson(s) {
  try { const v = JSON.parse(s); return Array.isArray(v) ? v : null; } catch { return null; }
}

function saveCatch() {
  try {
    localStorage.setItem(LS_CATCH, JSON.stringify({ mode: catchState.mode, rain: activeRain(), data: catchState.data }));
  } catch { /* приватный режим */ }
}

function loadCatch() {
  let st = null;
  try { st = JSON.parse(localStorage.getItem(LS_CATCH) || "null"); } catch { st = null; }
  if (!st) {
    // Старых сохранённых параметров достаточно, чтобы не менять привычный
    // вручную заданный расчёт: новый режим включаем только на чистой странице.
    let legacy = false;
    try { legacy = !!localStorage.getItem("kns-params"); } catch { legacy = false; }
    catchState.mode = legacy ? "manual" : "catch";
    return;
  }
  catchState.mode = st.mode === "manual" ? "manual" : "catch";
  if (st.rain) {
    Object.assign(rainProfiles[0], normRain(st.rain));
    if (Number.isFinite(st.rain.n)) $sc("n").value = padNum(st.rain.n);
  }
  if (st.data) catchState.data = { ...CATCH_DEFAULTS, ...st.data };
}

// ---------- рендер ----------

function fillInput(el, v) {
  if (!el || document.activeElement === el) return;
  const n = Number(v);
  el.value = v === "" || v === null || v === undefined || !Number.isFinite(n) ? "" : padNum(n);
}

// Производное поле: округлённый показ (заданное число знаков) + точное
// значение в подсказке. Округление здесь — только для глаза.
const roundTo = (v, dec) => (Number.isFinite(v) ? Math.round(v * 10 ** dec) / 10 ** dec : v);
function fillDerived(el, value, dec, unit) {
  if (!el || document.activeElement === el || !Number.isFinite(value)) return;
  el.value = padNum(roundTo(value, dec));
  el.title = derivedTitle(value, unit);
}

function renderRain() {
  const r = activeRain();
  const sel = $sc("rainDistrict");
  if (document.activeElement !== sel) sel.value = r.district === null ? "" : String(r.district);
  for (const [elId, key] of Object.entries(RAIN_NUM)) fillInput($sc(elId), r[key]);
  $sc("rainFormula").innerHTML = rainFormulaHTML(r);
  // В свёрнутом виде в заголовке виден результат расчёта дождя — параметр A.
  $sc("rainHeaderVal").innerHTML = `A = ${fmt(rainA(r))} л/(с·га)`;
  $sc("rainHeaderVal").title = derivedTitle(rainA(r), "л/(с·га)");
  const row = rainRegionRow(r);
  for (const [key, btnId] of SINGLE_RAIN_RESETS) {
    const std = rainRegionValue(row, key, r.P);
    const dev = std !== null && Math.abs(r[key] - std) > 1e-9;
    $sc(btnId).hidden = !dev;
    if (dev) $sc(btnId).title = `Вернуть значение из таблицы Ж.1: ${fmt(std)}`;
  }
}

const segSig = {};
function segSub(i) {
  const subs = "₁₂₃₄₅₆₇₈₉";
  return i < subs.length ? subs[i] : String(i + 1);
}
function rebuildLists(containerId, key, arr, build) {
  const box = $sc(containerId);
  const list = Array.isArray(arr) ? arr : [];
  const sig = `${list.length}|${list.map(s => s?.type || "").join("|")}`;
  if (segSig[containerId] !== sig) {
    box.innerHTML = "";
    list.forEach((s, i) => {
      const row = document.createElement("div");
      row.className = "seg-row";
      row.dataset.list = key;
      row.dataset.idx = String(i);
      row.innerHTML = build(s, i);
      box.append(row);
    });
    segSig[containerId] = sig;
  }
  return list;
}

function renderCatch(p) {
  const d = catchState.data;
  const table = d.coeffSource === "table";
  // В свёрнутом виде в заголовке видны результаты водосбора.
  $sc("catchHeaderVal").innerHTML = p.Qr > 0
    ? `<span>Q<sub>r</sub> = ${fmt(p.Qr, 1)} л/с</span><span>t<sub>r</sub> = ${fmt(p.tr, 1)} мин</span>`
    : `<span class="warn">Q<sub>r</sub> = 0</span>`;
  $sc("catchHeaderVal").title = p.Qr > 0 ? derivedTitleMany([["Qr", p.Qr, "л/с"], ["tr", p.tr, "мин"]]) : "";
  for (const rb of document.querySelectorAll('input[name="qrMode"]')) rb.checked = rb.value === catchState.mode;
  for (const rb of document.querySelectorAll('input[name="catchCoeff"]')) rb.checked = rb.value === (d.coeffMode === "const" ? "const" : "variable");
  for (const rb of document.querySelectorAll('input[name="catchSource"]')) rb.checked = rb.value === (table ? "table" : "manual");
  for (const [elId, key] of Object.entries(CATCH_NUM)) fillInput($sc(elId), d[key]);
  // В режиме «по составу» F, z_mid и Ψ_mid — производные расчёта: показываем
  // посчитанное (а не сохранённое) и уводим точное значение в подсказку.
  if (table) {
    fillDerived($sc("catchF"), p.F, 3, "га");
    fillDerived($sc("catchZ"), p.zMid, 4, "");
    fillDerived($sc("catchPsi"), p.psiMid, 4, "");
  } else {
    for (const id of ["catchF", "catchZ", "catchPsi"]) $sc(id).title = "";
  }
  // В режиме «по составу» F, z_mid и Ψ_mid — производные расчёта.
  $sc("catchF").readOnly = table;
  $sc("catchZ").readOnly = table;
  $sc("catchPsi").readOnly = table;
  $sc("catchZ").disabled = d.coeffMode === "const";
  $sc("catchPsi").disabled = d.coeffMode !== "const";
  $sc("catchSurfBlock").hidden = !table;

  if (table) {
    rebuildLists("catchSurfList", "zRows", d.zRows, (s, i) => {
      const type = SURFACE_BY_KEY[s?.type] ? s.type : "imp";
      const coeffOf = t => `z ${t.z == null ? "по Ж.7" : "= " + fmt(t.z, 3)}, Ψ = ${fmt(t.psi, 2)}`;
      const opts = SURFACE_TYPES.map(t =>
        `<option value="${t.key}"${t.key === type ? " selected" : ""}>${t.label} (${coeffOf(t)})</option>`).join("");
      return `<select data-field="type">${opts}</select>` +
        `<input type="number" step="any" min="0" data-field="F" placeholder="F${segSub(i)}" title="площадь поверхности ${i + 1}, га">` +
        (type === "imp" ? `<input type="number" step="any" min="0" data-field="z" placeholder="z авто" title="z водонепроницаемых; пусто — авто по Ж.7">` : "") +
        `<button class="seg-del" type="button" title="Удалить поверхность">×</button>`;
    });
    const box = $sc("catchSurfList");
    box.querySelectorAll(".seg-row").forEach((row, i) => {
      const s = (d.zRows || [])[i] || {};
      fillInput(row.querySelector('input[data-field="F"]'), parseFloat(s.F));
      fillInput(row.querySelector('input[data-field="z"]'), parseFloat(s.z));
    });
  }

  const lists = [["catchTrayList", "trays"], ["catchSegList", "segs"]];
  for (const [containerId, key] of lists) {
    rebuildLists(containerId, key, d[key], (s, i) =>
      `<input type="number" step="any" min="0" data-field="l" placeholder="l${segSub(i)}" title="длина участка ${i + 1}, м">` +
      `<input type="number" step="any" min="0" data-field="v" placeholder="v${segSub(i)}" title="скорость на участке ${i + 1}, м/с">` +
      `<button class="seg-del" type="button" title="Удалить участок">×</button>`);
    $sc(containerId).querySelectorAll(".seg-row").forEach((row, i) => {
      const s = (d[key] || [])[i] || {};
      for (const field of ["l", "v"]) fillInput(row.querySelector(`input[data-field="${field}"]`), parseFloat(s[field]));
    });
  }

  const note = $sc("catchSurfNote");  if (table) {
    const parts = [];
    if (p.areaSum > 0) {
      if (p.surfaces.some(s => s.type === "imp")) parts.push(`z водонепроницаемых по таблице Ж.7 = ${fmt(p.zImpAuto.z, 3)}`);
      parts.push(`<b>F = ΣFᵢ = ${fmt(p.F, 2)} га</b>`);
      if (p.areaOver) parts.push(`<span class="warn">площадь &gt; 150 га</span>`);
    } else {
      parts.push(`<span class="warn">ΣFᵢ = 0 — задайте площадь</span>`);
      parts.push(`F = 0, z<sub>mid</sub> = Ψ<sub>mid</sub> = 0`);
    }
    note.innerHTML = parts.join("<br>");
    note.hidden = false;
  } else {
    note.hidden = true;
  }
}

function renderOut(p) {
  $sc("catchOut").innerHTML = p.Qr > 0
    ? `A = ${fmt(p.A)} л/(с·га) · t<sub>can</sub> = ${fmt(p.tcan, 1)} · t<sub>p</sub> = ${fmt(p.tp, 1)} мин<br>` +
      `Q<sub>r</sub> = ${fmt(p.Qr, 2)} л/с <br> t<sub>r</sub> = ${fmt(p.tr, 2)} мин`
    : `<span class="warn">⚠ Q<sub>r</sub> = 0 — ${catchErrorReason(catchState.data)}</span>`;
  $sc("catchOut").title = p.Qr > 0
    ? derivedTitleMany([["A", p.A, "л/(с·га)"], ["t_can", p.tcan, "мин"], ["t_p", p.tp, "мин"], ["Qr", p.Qr, "л/с"], ["tr", p.tr, "мин"]])
    : "";
}

function applyMode() {
  const auto = catchState.mode === "catch";
  singleCatchDerived = null;
  for (const id of ["Qr", "tr"]) {
    const el = $sc(id);
    el.readOnly = auto;
    el.classList.toggle("derived", auto);
    if (!auto) el.title = ""; // ручное значение — «точное» показывать нечего
  }
}

function writeComputed(p) {
  applying = true;
  try {
    // Поля показывают округлённое, а расчёт (app.js) берёт точную пару —
    // иначе одиночный расчёт расходится с каскадом (10,05 против 10,051762).
    singleCatchDerived = { Qr: p.Qr, tr: p.tr };
    showDerived($sc("Qr"), p.Qr, "л/с");
    showDerived($sc("tr"), p.tr, "мин");
    // app.js по событию input пересчитает м³/ч и диапазон таблицы вариантов.
    $sc("Qr").dispatchEvent(new Event("input"));
  } finally {
    applying = false;
  }
}

function recompute() {
  const { p } = singleCatchCalc({ data: catchState.data });
  renderRain();
  renderCatch(p);
  renderOut(p);
  applyMode();
  if (catchState.mode === "catch") writeComputed(p);
  saveCatch();
  if (typeof render === "function") render();
}

// ---------- обвязка ----------

function setRain(key, value) {
  rainProfiles[0][key] = value;
}

$sc("rainHelp").addEventListener("click", () => {
  openHelp(rainHelpBlocks(), { title: "Справка: дождь" });
});
$sc("rainQ20Map").addEventListener("click", e => {
  e.stopPropagation();
  openHelp([
    { p: "Значения величины интенсивности дождя q₂₀ (20 мин), л/(с·га) — карта изолиний. Приложение Б (обязательное) рекомендаций НИИ ВОДГЕО (2015); в СП 32.13330.2018 — рисунок Ж.1." },
    { img: "static/img/q20-map.webp", alt: "Карта значений q₂₀, л/(с·га)" },
  ], { title: "Карта q₂₀ (Приложение Б)" });
});

for (const [elId, key] of Object.entries(RAIN_NUM)) {
  $sc(elId).addEventListener("input", () => {
    const v = parseFloat($sc(elId).value);
    if (Number.isFinite(v) && v > 0 && (key !== "n" || v < 1)) setRain(key, v);
    recompute();
  });
}
$sc("n").addEventListener("input", recompute);

const districtSel = $sc("rainDistrict");
districtSel.innerHTML = `<option value="">— вручную —</option>` +
  RAIN_CLIMATE.map((r, i) => `<option value="${i}">${r.district}</option>`).join("");
districtSel.addEventListener("change", () => {
  const idx = parseInt(districtSel.value, 10);
  const row = RAIN_CLIMATE[idx];
  if (!row) {
    setRain("district", null);
  } else {
    const P = parseFloat($sc("rainP").value);
    setRain("district", idx);
    setRain("mr", row.mr);
    setRain("gamma", row.gamma);
    $sc("n").value = padNum(Number.isFinite(P) && P < 1 ? row.nLow : row.nHigh);
  }
  recompute();
});
for (const [key, btnId] of SINGLE_RAIN_RESETS) {
  $sc(btnId).addEventListener("click", e => {
    e.stopPropagation();
    const r = activeRain();
    const std = rainRegionValue(rainRegionRow(r), key, r.P);
    if (std === null) return;
    if (key === "n") $sc("n").value = padNum(std);
    else setRain(key, std);
    recompute();
  });
}

for (const [elId, key] of Object.entries(CATCH_NUM)) {
  $sc(elId).addEventListener("input", () => {
    // Производные поля (F, z_mid, Ψ_mid в режиме «по составу») колесом мыши
    // тоже можно сдвинуть — возвращаем рассчитанное значение.
    if ($sc(elId).readOnly) { recompute(); return; }
    const raw = $sc(elId).value.trim();
    const v = raw === "" ? "" : parseFloat(raw);
    if (raw === "" || Number.isFinite(v)) catchState.data[key] = v;
    recompute();
  });
}
for (const [name, key] of [["catchCoeff", "coeffMode"], ["catchSource", "coeffSource"], ["qrMode", "mode"]]) {
  for (const rb of document.querySelectorAll(`input[name="${name}"]`)) {
    rb.addEventListener("change", () => {
      if (!rb.checked) return;
      if (key === "mode") catchState.mode = rb.value === "manual" ? "manual" : "catch";
      else catchState.data[key] = rb.value;
      recompute();
    });
  }
}

function listCtx(el) {
  const row = el?.closest?.(".seg-row");
  if (!row) return null;
  return { idx: parseInt(row.dataset.idx, 10), key: row.dataset.list };
}
function mutateList(key, mut) {
  const list = Array.isArray(catchState.data[key]) ? catchState.data[key].map(s => ({ ...s })) : [];
  mut(list);
  catchState.data[key] = list;
}
for (const containerId of ["catchSegList", "catchTrayList", "catchSurfList"]) {
  const box = $sc(containerId);
  box.addEventListener("input", e => {
    const inp = e.target.closest('input[data-field]');
    if (!inp) return;
    const ctx = listCtx(inp);
    if (!ctx || ctx.idx < 0) return;
    const raw = inp.value.trim();
    const v = raw === "" ? "" : parseFloat(raw);
    mutateList(ctx.key, list => {
      if (!list[ctx.idx]) return;
      const keep = list[ctx.idx][inp.dataset.field];
      list[ctx.idx][inp.dataset.field] = raw === "" ? "" : (Number.isFinite(v) ? v : keep);
    });
    recompute();
  });
  box.addEventListener("change", e => {
    const sel = e.target.closest('select[data-field="type"]');
    if (!sel) return;
    const ctx = listCtx(sel);
    if (!ctx || ctx.idx < 0) return;
    mutateList("zRows", list => {
      if (!list[ctx.idx]) return;
      list[ctx.idx].type = sel.value;
      if (sel.value !== "imp") list[ctx.idx].z = "";
    });
    delete segSig[containerId];
    recompute();
  });
  box.addEventListener("click", e => {
    const del = e.target.closest(".seg-del");
    if (!del) return;
    e.stopPropagation();
    const ctx = listCtx(del);
    if (!ctx || ctx.idx < 0) return;
    mutateList(ctx.key, list => { list.splice(ctx.idx, 1); });
    delete segSig[containerId];
    recompute();
  });
}
for (const [btnId, key, blank] of [
  ["catchSegAdd", "segs", { l: "", v: "" }],
  ["catchTrayAdd", "trays", { l: "", v: "" }],
  ["catchSurfAdd", "zRows", { type: "imp", F: "", z: "" }],
]) {
  $sc(btnId).addEventListener("click", e => {
    e.stopPropagation();
    mutateList(key, list => { list.push({ ...blank }); });
    delete segSig[containerIdFor(key)];
    recompute();
  });
}
function containerIdFor(key) {
  return key === "segs" ? "catchSegList" : key === "trays" ? "catchTrayList" : "catchSurfList";
}

$sc("catchHelpBtn").addEventListener("click", () => {
  const { p } = singleCatchCalc({ data: catchState.data });
  openHelp(catchHelp(p), { title: "Справка: водосбор" });
});
$sc("catchCoeffHelp").addEventListener("click", e => {
  e.stopPropagation();
  const { p } = singleCatchCalc({ data: catchState.data });
  openHelp(catchCoeffHelp(p), { title: "Справка: площади и коэффициенты" });
});
$sc("catchTrHelpBtn").addEventListener("click", e => {
  e.stopPropagation();
  const { p } = singleCatchCalc({ data: catchState.data });
  openHelp(catchTrHelp(p), { title: "Справка: t_r" });
});

// В режиме «по водосбору» поля Qr/tr только для чтения; колесо мыши их всё
// равно может сдвинуть — возвращаем рассчитанные значения.
for (const id of ["Qr", "tr"]) {
  $sc(id).addEventListener("input", () => {
    if (applying || catchState.mode !== "catch") return;
    writeComputed(singleCatchCalc({ data: catchState.data }).p);
  });
}

for (const [toggleId, sectionId] of [["rainToggle", "rainSection"], ["catchToggle", "catchSection"]]) {
  $sc(toggleId).addEventListener("click", () => $sc(sectionId).classList.toggle("open"));
}

loadCatch();
// Как «Результаты» и «Графики»: на широком экране секции раскрыты, на
// узком — свёрнуты, чтобы не съедать единственный столбец.
if (window.matchMedia("(min-width: 901px)").matches) {
  $sc("rainSection").classList.add("open");
  $sc("catchSection").classList.add("open");
}
// Параметры из ссылки важнее сохранённых: так работает «Поделиться».
catchUrlLoad(new URLSearchParams(location.search));
renderRain();

// ---------- перенос параметров ----------
// Приёмники для конвертов kns-param: дождь и водосбор. Ноды КНС/участка/притока
// сюда не вставляются — сработает общее сообщение о несовместимости.

registerParamTarget("rain", {
  copy: () => ({ data: paramDataOf("rain", activeRain()), name: getActiveRain().name || "Дождь" }),
  paste: data => {
    Object.assign(rainProfiles[0], data);
    if (Number.isFinite(data.n)) $sc("n").value = padNum(data.n);
    recompute();
    return true;
  },
});

registerParamTarget("catch", {
  copy: () => ({ data: paramDataOf("catch", catchState.data), name: "Водосбор" }),
  paste: data => {
    // Берём только поля модели водосбора: имя/описание ноды и наследие
    // q₂₀/P/m_r/γ здесь не нужны — дождь живёт отдельной секцией.
    const next = { ...catchState.data };
    for (const key of Object.keys(next)) if (key in data) next[key] = data[key];
    catchState.data = next;
    recompute();
    return true;
  },
});

bindParamTransfer();
initParamPaste();

// ---------- мост «В каскад» ----------
// Собирает из состояния одиночного расчёта НОВУЮ схему каскада (дождь →
// водосбор → КНС) и открывает её в новой вкладке ссылкой #s= — тем же
// механизмом, что кнопка «Поделиться» в каскаде (share-code.js пишет,
// decodeShareCode в cascade-io.js читает). Ссылка заводит отдельную схему
// и не затирает активную; никакого localStorage-моста не нужно.
function cascadeImportPayload() {
  const rain = { ...normRain(activeRain()), id: 1 };
  const auto = catchState.mode === "catch";
  const derived = singleCatchDerived;
  const num = (v, fallback) => (Number.isFinite(v) ? v : fallback);
  const Qr = derived ? derived.Qr : num(parseFloat($sc("Qr").value), 0);
  const tr = derived ? derived.tr : num(parseFloat($sc("tr").value), 0);
  const Q = num(parseFloat($sc("Q").value), 0);
  const nodes = [];
  const connections = [];
  // В режиме «по водосбору» Qr/tr считает водосбор; в ручном — это исходные
  // данные, источника-водосбора у них нет.
  if (auto) nodes.push({ id: 1, type: "catch", x: 60, y: 80, data: { ...catchState.data } });
  nodes.push({
    id: nodes.length + 1, type: "pump", x: auto ? 360 : 120, y: 80,
    data: { name: "Насосная станция", desc: "", qr: Qr, tr, q: Q, idle: 50, mode: "analytic" },
  });
  if (auto) connections.push({ from: 1, to: 2 });
  return {
    meta: { custom: [], title: "Из одиночного расчёта" },
    name: "Из одиночного расчёта",
    n: currentN(), rains: [rain], rainActive: 1, nodes, connections,
  };
}

$sc("toCascade").addEventListener("click", async () => {
  try {
    const code = await encodeSharePayload(cascadeImportPayload());
    if (code.length > SHARE_LIMIT) {
      alert(`Расчёт велик для ссылки: ${code.length} символов, предел ${SHARE_LIMIT}.`);
      return;
    }
    const url = new URL("cascade.html", location.href);
    url.hash = SHARE_PARAM + "=" + code;
    window.open(url.href, "_blank");
  } catch (err) {
    alert("Не удалось подготовить схему каскада: " + err.message);
  }
});

// После app.js: его loadFromUrl мог проставить Qr/tr из адреса, в режиме
// «по водосбору» рассчитанные значения главнее. Обработчик ползунка n тоже
// вешаем здесь: app.js на то же событие пишет #n и вызывает render(), а наш
// render() до него откатил бы nrange.value — ползунок бы не двигался.
document.addEventListener("DOMContentLoaded", () => {
  $sc("nrange").addEventListener("input", recompute);
  recompute();
});
