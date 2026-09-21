"use strict";

// ============================================================
// Дождь схемы. Климатические параметры в формуле A (q20, P, mr, γ)
// общие для всех водосборов, поэтому вынесены из нод «Водосбор» на
// уровень схемы — как параметр n. Хранятся профилями: rains +
// rainActive в payload схемы. catchParams(d, n, rain) добавляет
// активный профиль третьим аргументом; вызовы без rain (старые и
// тестовые) по-прежнему берут параметры из data ноды.
//
// Панель вешается в левом верхнем углу канваса (rainBtn), редактирует
// активный профиль; переключение профиля пересчитывает всю схему.
// ============================================================

const RAIN_DEFAULTS = { name: "", district: null, n: 0.71, q20: 80, P: 1.0, mr: 150, gamma: 1.54 };
let rainProfiles = [{ id: 1, ...RAIN_DEFAULTS }];
let rainActive = 1;

// num — локальный парсер чисел: в браузере доступен num из cascade-catch.js,
// но rain подключается и в изолированных тестовых окружениях (cascade-io).
function rainNum(x, fallback, min = -Infinity) {
  const v = parseFloat(x);
  return Number.isFinite(v) && v >= min ? v : fallback;
}

function normRain(r) {
  if (!r || typeof r !== "object") return { ...RAIN_DEFAULTS };
  return {
    name: typeof r.name === "string" ? r.name : "",
    district: Number.isInteger(r.district) && r.district >= 0 && r.district < (typeof RAIN_CLIMATE !== "undefined" ? RAIN_CLIMATE.length : 0) ? r.district : null,
    n: rainNum(r.n, RAIN_DEFAULTS.n, 0.01),
    q20: rainNum(r.q20, RAIN_DEFAULTS.q20, 0.01),
    P: rainNum(r.P !== undefined ? r.P : r.p, RAIN_DEFAULTS.P, 0.01),
    mr: rainNum(r.mr, RAIN_DEFAULTS.mr, 1.01),
    gamma: rainNum(r.gamma, RAIN_DEFAULTS.gamma, 0.01),
  };
}

function getActiveRain() {
  const r = rainProfiles.find(x => x.id === rainActive);
  return r ? normRain(r) : { id: 1, ...RAIN_DEFAULTS };
}

// getGlobalN() живёт здесь же: n — параметр активного профиля дождя.
function getGlobalN() {
  const n = getActiveRain().n;
  return n > 0 && n < 1 ? n : 0.71;
}

function rainNextId(existing = rainProfiles) {
  return existing.reduce((m, r) => Math.max(m, r.id || 0), 0) + 1;
}

// Формула A с подставленными значениями активного профиля — живёт в панели
// дождя, не только в справочной модалке. fmt есть в браузере (calc-view.js),
// в изолированных тестовых окружениях (cascade-io) — запасной String().
const rainFmt = (v, d = 2) => (typeof fmt === "function" ? fmt(v, d) : String(v));
const rainA = r => r.q20 * 20 ** r.n * (1 + Math.log(r.P) / Math.log(r.mr)) ** r.gamma;
function rainFormulaHTML(r) {
  const A = rainA(r);
  return `A = q<sub>20</sub>·20<sup>n</sup>·(1 + lg P / lg m<sub>r</sub>)<sup>γ</sup> = ` +
    `${rainFmt(r.q20)}·20<sup>${rainFmt(r.n)}</sup>·(1 + lg ${rainFmt(r.P, 1)} / lg ${rainFmt(r.mr, 0)})<sup>${rainFmt(r.gamma)}</sup> = ` +
    `<b>${rainFmt(A)}</b> л/(с·га)`;
}

// На кнопке дождя — имя профиля жирно, значение A — обычным начертанием.
function updateRainBtn() {
  const r = getActiveRain();
  const btn = $c("rainBtn");
  btn.textContent = "";
  const name = document.createElement("b");
  name.textContent = `🌧 ${r.name.trim() || `Дождь ${r.id}`}`;
  const val = document.createElement("span");
  val.className = "rain-btn-val";
  val.textContent = ` ${rainFmt(rainA(r))} л/(с·га)`;
  btn.append(name, val);
}

// Район таблицы Ж.1 в профиле: подсвечиваем поля, отклонившиеся от табличных,
// и показываем у каждого такого поля «↺» — вернуть табличное значение.
// q₂₀ и P кнопки не имеют: их в таблице Ж.1 нет (q₂₀ — по карте, P — по условиям объекта).
const RAIN_RESETS = [
  ["n", "rainN", "rainResetN"],
  ["mr", "rainMr", "rainResetMr"],
  ["gamma", "rainGamma", "rainResetGamma"],
];
function rainRegionRow(r) {
  return r.district !== null && r.district >= 0 && typeof RAIN_CLIMATE !== "undefined" ? RAIN_CLIMATE[r.district] || null : null;
}
function rainRegionValue(row, key, P) {
  if (!row) return null;
  return key === "n" ? (P < 1 ? row.nLow : row.nHigh) : row[key];
}
function updateRegionHints(act) {
  const row = rainRegionRow(act);
  for (const [key, inputId, btnId] of RAIN_RESETS) {
    const std = rainRegionValue(row, key, act.P);
    const dev = std !== null && Math.abs(act[key] - std) > 1e-9;
    const btn = $c(btnId);
    btn.hidden = !dev;
    if (dev) btn.title = `Вернуть значение из таблицы Ж.1: ${rainFmt(std)}`;
    $c(inputId).classList.toggle("rain-dev", dev);
  }
}

// Профили из payload. Без rains (схема v2 и старше) — миграция: параметры
// первого водосбора, иначе дефолт. Вызывается из loadActiveIntoEditor /
// applyPayload / createScheme (cascade-io.js).
function setRainsFromPayload(payload) {
  // id присваиваем и тем профилям, у которых его нет (приходят из ссылок);
  // дубли id отбрасываются — следующему свободному достаётся следующий свободный.
  const raw = [];
  if (Array.isArray(payload?.rains)) {
    for (const r of payload.rains) {
      const id = r?.id && !raw.some(x => x.id === r.id) ? r.id : rainNextId(raw);
      raw.push({ id, ...normRain(r) });
    }
  }
  rainProfiles = raw.length
    ? raw
    : // Миграция со схем v2 и старше: n был общим параметром схемы, не ноды.
      [{ id: 1, ...normRain({ ...RAIN_DEFAULTS, ...firstCatchData(payload),
        n: rainNum(payload?.n, RAIN_DEFAULTS.n, 0.01) }) }];
  rainActive = raw.length && payload?.rainActive && raw.some(r => r.id === payload.rainActive)
    ? payload.rainActive
    : rainProfiles[0].id;
}

// Данные первого водосбора: миграция со схем v2 и старше, а также
// drawflow-структура (nodes не массив) — тогда профилей нет и берётся дефолт.
function firstCatchData(payload) {
  const nodes = Array.isArray(payload?.nodes) ? payload.nodes : [];
  return nodes.find(nd => nd?.type === "catch")?.data || {};
}

// ---------- панель ----------

const RAIN_FIELDS = { rainN: "n", rainQ20: "q20", rainP: "P", rainMr: "mr", rainGamma: "gamma" };

// force=true — перерисовать селект даже если он в фокусе (после add/dup/del:
// в Safari/Firefox клик по кнопке не забирает фокус у селекта, и без force
// удалённый профиль остался бы в списке).
function renderRainPanel(force = false) {
  const act = rainProfiles.find(x => x.id === rainActive) || rainProfiles[0];
  rainActive = act.id;
  const sel = $c("rainSelect");
  if (force || document.activeElement !== sel) {
    sel.innerHTML = rainProfiles
      .map(r => `<option value="${r.id}">${r.name?.trim() ? r.name : `Дождь ${r.id}`}</option>`)
      .join("");
    sel.value = String(rainActive);
  }
  // Последний профиль не удаляем: дождь нужен для расчёта всегда.
  $c("rainDel").disabled = rainProfiles.length === 1;
  const nameEl = $c("rainName");
  if (document.activeElement !== nameEl) nameEl.value = act.name || "";
  for (const [elId, key] of Object.entries(RAIN_FIELDS)) {
    const el = $c(elId);
    if (document.activeElement !== el) el.value = padNum(act[key]);
  }
  $c("rainFormula").innerHTML = rainFormulaHTML(normRain(act));
  updateRainBtn();
  const nrm = normRain(act);
  $c("rainDistrict").value = nrm.district === null ? "" : String(nrm.district);
  updateRegionHints(nrm);
}

function updateActiveRain(key, value) {
  const r = rainProfiles.find(x => x.id === rainActive);
  if (!r) return;
  r[key] = value;
  $c("rainFormula").innerHTML = rainFormulaHTML(getActiveRain());
  updateRainBtn();
  updateRegionHints(getActiveRain());
  saveScheme();
  computeCascade();
}

function setRainPanel(open) {
  $c("rainPanel").hidden = !open;
  document.body.classList.toggle("rain-open", open);
  // На мобильном панель дождя перекрывает холст — панель нод справа закрываем.
  if (open && window.matchMedia("(max-width: 900px)").matches) closeSidebar();
}

function bindRainPanel() {
  $c("rainClose").innerHTML = XMARK_HTML;
  $c("rainClose").addEventListener("click", e => { e.stopPropagation(); setRainPanel(false); });
  $c("rainBtn").addEventListener("click", e => {
    e.stopPropagation();
    setRainPanel($c("rainPanel").hidden);
  });
  // Клик мимо (по канвасу/палитре) закрывает; клики внутри панели, кнопок дождя
  // и модальных окон (справка/карта) — нет.
  document.addEventListener("click", e => {
    if ($c("rainPanel").hidden) return;
    if (e.target.closest("#rainPanel, #rainBtn, .modal, .img-viewer")) return;
    setRainPanel(false);
  });
  document.addEventListener("keydown", e => {
    if (e.key !== "Escape") return;
    // Пока открыто модальное окно или просмотр карты — Esc закрывает их, а не панель.
    const m = $c("modal"), v = $c("imgViewer");
    if ((m && !m.hidden) || (v && !v.hidden)) return;
    setRainPanel(false);
  });

  $c("rainSelect").addEventListener("change", () => {
    rainActive = parseInt($c("rainSelect").value, 10) || rainActive;
    renderRainPanel();
    saveScheme();
    flushCascade();
  });
  $c("rainAdd").addEventListener("click", e => {
    e.stopPropagation();
    const id = rainNextId();
    rainProfiles.push({ id, ...RAIN_DEFAULTS, name: `Дождь ${rainProfiles.length + 1}` });
    rainActive = id;
    renderRainPanel(true);
    saveScheme();
    flushCascade();
  });
  $c("rainDup").addEventListener("click", e => {
    e.stopPropagation();
    const src = rainProfiles.find(x => x.id === rainActive);
    const id = rainNextId();
    rainProfiles.push({ ...normRain(src), id, name: `${src?.name || `Дождь ${rainActive}`} (копия)` });
    rainActive = id;
    renderRainPanel(true);
    saveScheme();
    flushCascade();
  });
  $c("rainDel").addEventListener("click", e => {
    e.stopPropagation();
    if (rainProfiles.length <= 1) return;
    if (!confirm("Удалить профиль дождя? Ноды вернутся к оставшемуся профилю.")) return;
    const i = rainProfiles.findIndex(x => x.id === rainActive);
    rainProfiles.splice(i, 1);
    rainActive = rainProfiles[Math.max(0, i - 1)].id;
    renderRainPanel(true);
    saveScheme();
    flushCascade();
  });

  // Район по таблице Ж.1: подставляет n (с учётом текущего P), m_r и γ.
  const districtSel = $c("rainDistrict");
  districtSel.innerHTML = `<option value="">— вручную —</option>` +
    RAIN_CLIMATE.map((r, i) => `<option value="${i}">${r.district}</option>`).join("");
  districtSel.addEventListener("change", () => {
    const row = RAIN_CLIMATE[parseInt(districtSel.value, 10)];
    if (!row) { // «вручную»: район сбрасываем, кнопки «↺» прячутся
      updateActiveRain("district", null);
      updateRegionHints(getActiveRain());
      return;
    }
    const P = parseFloat($c("rainP").value);
    updateActiveRain("district", parseInt(districtSel.value, 10));
    updateActiveRain("n", Number.isFinite(P) && P < 1 ? row.nLow : row.nHigh);
    updateActiveRain("mr", row.mr);
    updateActiveRain("gamma", row.gamma);
    saveScheme();
    computeCascade();
    renderRainPanel();
  });
  // «↺» у отклонившегося поля — вернуть табличное значение Ж.1.
  for (const [key, inputId, btnId] of RAIN_RESETS) {
    $c(btnId).addEventListener("click", e => {
      e.stopPropagation();
      const act = getActiveRain();
      const std = rainRegionValue(rainRegionRow(act), key, act.P);
      if (std === null) return;
      updateActiveRain(key, std);
      renderRainPanel();
    });
  }

  const nameEl = $c("rainName");
  nameEl.addEventListener("input", () => {
    updateActiveRain("name", nameEl.value);
    // Имя видно в селекте профилей — обновим, не трогая фокус в поле.
    const opt = $c("rainSelect").selectedOptions?.[0];
    if (opt) opt.textContent = nameEl.value.trim() || `Дождь ${rainActive}`;
  });
  for (const [elId, key] of Object.entries(RAIN_FIELDS)) {
    $c(elId).addEventListener("input", () => {
      const v = parseFloat($c(elId).value);
      if (Number.isFinite(v) && v > 0 && (key !== "n" || v < 1)) updateActiveRain(key, v);
    });
  }

  $c("rainHelp").addEventListener("click", e => {
    e.stopPropagation();
    openHelp(rainHelpBlocks(), { title: "Справка: дождь схемы" });
  });
  // Глобус у q₂₀ — карта изолиний интенсивностей дождя (Приложение Б).
  $c("rainQ20Map").addEventListener("click", e => {
    e.stopPropagation();
    openHelp([
      { p: "Значения величины интенсивности дождя q₂₀ (20 мин), л/(с·га) — карта изолиний (линий равных значений; на картах осадков — изоплеты). Приложение Б (обязательное) рекомендаций НИИ ВОДГЕО (2015); в СП 32.13330.2018 — рисунок Ж.1. Для Сахалинской области, Камчатского края и Крыма — «Таблицы параметров предельной интенсивности дождя»." },
      { img: "static/img/q20-map.webp", alt: "Карта значений q₂₀, л/(с·га)" },
    ], { title: "Карта q₂₀ (Приложение Б)" });
  });
}

// ---------- справка «?» ----------

function rainHelpBlocks() {
  const r = getActiveRain();
  const n = getGlobalN();
  const A = r.q20 * 20 ** n * (1 + Math.log(r.P) / Math.log(r.mr)) ** r.gamma;
  return [
    { h: "Параметры дождя схемы" },
    { p: "Дождь — общий для всех водосборов схемы: n, q₂₀, P, m_r и γ хранятся в дождевом профиле схемы." },
    { p: "Параметр A, характеризующий интенсивность и продолжительность дождя для конкретной местности (п. 5.3.2; формула (1) рекомендаций ВОДГЕО (2015)), с текущими значениями активного профиля:" },
    { tex: `A = q_{20}\\,20^{\\,n}\\left(1+\\frac{\\lg P}{\\lg m_r}\\right)^{\\!\\gamma} = ${fmt(r.q20)}\\cdot20^{${fmt(n)}}\\left(1+\\frac{\\lg ${fmt(r.P, 1)}}{\\lg ${fmt(r.mr, 0)}}\\right)^{${fmt(r.gamma)}} = ${fmt(A)}` },
    { ol: [
      "q₂₀ — интенсивность дождя продолжительностью 20 мин при P = 1 год, л/с с 1 га — рисунок Ж.1 СП 32.13330.2018 (карта; Приложение 2 рекомендаций ВОДГЕО (2015));",
      "n — показатель степени, климатический параметр местности — таблица Ж.1 СП 32.13330.2018 (при P < 1 и P ≥ 1 — разные колонки; хранится в профиле дождя);",
      "m_r — среднее количество дождей за год — таблица Ж.1 СП 32.13330.2018;",
      "P — период однократного превышения расчётной интенсивности дождя, годы — таблицы Ж.2 и Ж.3 СП 32.13330.2018 (или таблица 8 п. 5.3.3 рекомендаций);",
      "γ — показатель степени — таблица Ж.1 СП 32.13330.2018.",
    ] },
    ...rainClimateHelpBlocks(),
    { p: "Несколько профилей хранятся в одной схеме (например, расчётный дождь разной обеспеченности P): активный выбирается в панели и участвует в расчёте всех водосборов. Таблицы коэффициентов поверхностей (Ж.6, Ж.7) — в справке ноды «Водосбор»." },
    ...catchSources(),
  ];
}

// Таблицы Ж.1–Ж.3 СП 32.13330.2018: подбор n/m_r/γ по району и выбор периода
// превышения P. Таблица Ж.1 строится из RAIN_CLIMATE (reference-data.js),
// чтобы справка не расходилась с автоподстановкой в панели.
function rainClimateHelpBlocks() {
  const twoRows = [
    ["Благоприятные и средние / Благоприятные", "0,5", "0,5–1", "1–1,5", "1,5–2"],
    ["Неблагоприятные / Средние", "0,5–1", "1–1,5", "1,5–2", "2–3"],
    ["Особо неблагоприятные / Неблагоприятные", "2–3", "2–3", "3–5", "5–10"],
    ["Особо неблагоприятные / Особо неблагоприятные", "3–5", "3–5", "5–10", "10–20"],
  ];
  return [
    { h: "Таблицы СП 32.13330.2018 (Приложение Ж)" },
    { p: "Таблица Ж.1 — значения параметров n, m_r и γ для определения расчётных расходов в коллекторах дождевой канализации (колонки n: первая — при P ≥ 1, вторая — при P < 1; q₂₀ определяется по рисунку Ж.1 и в таблицу не входит — в панели дождя задаётся вручную):" },
    { table: {
      head: ["Район", "n при P ≥ 1", "n при P < 1", "m_r", "γ"],
      rows: RAIN_CLIMATE.map(r => [r.district, fmt(r.nHigh), fmt(r.nLow), String(r.mr), fmt(r.gamma)]),
    } },
    { p: "Таблица Ж.2 — период однократного превышения расчётной интенсивности дождя P, лет, для поселений и городских округов (столбцы — диапазоны q₂₀; строки — сочетание последствий переполнения и условий расположения коллектора: благоприятные, средние (бассейн свыше 150 га с плоским рельефом), неблагоприятные (коллектор в нижней части склона, бассейн более 150 га), особо неблагоприятные (котловина)):" },
    { table: {
      head: ["Условия расположения коллекторов", "q₂₀ < 60", "60–80", "80–120", "> 120"],
      rows: twoRows,
    } },
    { p: "Таблица Ж.3 — период однократного превышения P, годы, для территории промышленных предприятий (по результату кратковременного переполнения сети):" },
    { table: {
      head: ["Результат кратковременного переполнения сети", "q₂₀ до 70", "70–100", "св. 100"],
      rows: [
        ["Технологические процессы предприятия не нарушаются", "0,5", "0,5–1", "2"],
        ["Технологические процессы предприятия нарушаются", "0,5–1", "1–2", "3–5"],
      ],
    } },
  ];
}
