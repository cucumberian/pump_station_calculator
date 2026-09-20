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

const RAIN_DEFAULTS = { name: "", n: 0.71, q20: 80, P: 1.0, mr: 150, gamma: 1.54 };
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

function renderRainPanel() {
  const act = rainProfiles.find(x => x.id === rainActive);
  const multi = rainProfiles.length > 1;
  $c("rainProfilesRow").hidden = !multi;
  if (multi && document.activeElement !== $c("rainSelect")) {
    const sel = $c("rainSelect");
    sel.innerHTML = rainProfiles
      .map(r => `<option value="${r.id}">${r.name?.trim() ? r.name : `Дождь ${r.id}`}</option>`)
      .join("");
    sel.value = String(rainActive);
  }
  // Summary name field (hidden? name field label) — имя
  const nameEl = $c("rainName");
  if (document.activeElement !== nameEl) nameEl.value = act.name || "";
  for (const [elId, key] of Object.entries(RAIN_FIELDS)) {
    const el = $c(elId);
    if (document.activeElement !== el) el.value = padNum(act[key]);
  }
}

function updateActiveRain(key, value) {
  const r = rainProfiles.find(x => x.id === rainActive);
  if (!r) return;
  r[key] = value;
  saveScheme();
  computeCascade();
}

function bindRainPanel() {
  $c("rainClose").innerHTML = XMARK_HTML;
  $c("rainClose").addEventListener("click", e => { e.stopPropagation(); $c("rainPanel").hidden = true; });
  $c("rainBtn").addEventListener("click", e => {
    e.stopPropagation();
    $c("rainPanel").hidden = !$c("rainPanel").hidden;
  });
  // Клик мимо (по канвасу/палитре) закрывает; клики внутри панели — нет.
  document.addEventListener("click", e => {
    if ($c("rainPanel").hidden) return;
    if (e.target.closest("#rainPanel") || e.target.closest("#rainBtn")) return;
    $c("rainPanel").hidden = true;
  });
  document.addEventListener("keydown", e => {
    if (e.key === "Escape") $c("rainPanel").hidden = true;
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
    renderRainPanel();
    saveScheme();
    flushCascade();
  });
  $c("rainDup").addEventListener("click", e => {
    e.stopPropagation();
    const src = rainProfiles.find(x => x.id === rainActive);
    const id = rainNextId();
    rainProfiles.push({ ...normRain(src), id, name: `${src?.name || `Дождь ${rainActive}`} (копия)` });
    rainActive = id;
    renderRainPanel();
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
    renderRainPanel();
    saveScheme();
    flushCascade();
  });

  // Район по таблице Ж.1: подставляет n (с учётом текущего P), m_r и γ.
  const districtSel = $c("rainDistrict");
  districtSel.innerHTML = `<option value="">— вручную —</option>` +
    RAIN_CLIMATE.map((r, i) => `<option value="${i}">${r.district}</option>`).join("");
  districtSel.addEventListener("change", () => {
    const row = RAIN_CLIMATE[parseInt(districtSel.value, 10)];
    if (!row) return;
    const P = parseFloat($c("rainP").value);
    updateActiveRain("n", Number.isFinite(P) && P < 1 ? row.nLow : row.nHigh);
    updateActiveRain("mr", row.mr);
    updateActiveRain("gamma", row.gamma);
    saveScheme();
    computeCascade();
    renderRainPanel();
  });

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
    openHelp(rainHelpBlocks(), {});
  });
}

// ---------- справка «?» ----------

function rainHelpBlocks() {
  const r = getActiveRain();
  const n = getGlobalN();
  const A = r.q20 * 20 ** n * (1 + Math.log(r.P) / Math.log(r.mr)) ** r.gamma;
  return [
    { h: "Параметры дождя схемы" },
    { p: "Дождь — общий для всех водосборов схемы: n, q₂₀, P, m_r и γ хранятся профилем в самой схеме, а не в нодах «Водосбор»." },
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
