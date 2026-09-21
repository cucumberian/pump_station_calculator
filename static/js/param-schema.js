"use strict";

// ============================================================
// Описание интерфейса параметров: единственный источник истины для
//   • значений по умолчанию (NODE_DEFAULTS выводится из схемы),
//   • версии интерфейса каждого типа (version) — она уезжает в файл/буфер
//     и проверяется при вставке,
//   • миграции исторических форм (migrateNodeData),
//   • проверки чужих данных (validateAgainstSchema),
//   • таблицы «Интерфейс» в справках (schemaHelpBlocks).
//
// Разметку нод (NODE_HTML) и подписи в сайдбаре схема НЕ генерирует: там
// свои sub/sup, подсказки и кнопки. Совпадение полей схемы и дефолтов
// проверяется тестом.
//
// Загружается после reference-data.js (нужен SURFACE_TYPES) и до
// cascade-nodes.js: NODE_DEFAULTS живёт здесь.
//
// Версии отражают фактическую историю формата:
//   catch 3 — v1 фиксированная тройка l1..l3 + Fadd, v2 segs/trays,
//             v3 zRows/coeffSource;
//   pump  2 — v1 Qr/Q с большой буквы, v2 qr/q;
//   delay 2 — v1 L/dt, v2 v/l;
//   rain  2 — v1 параметры дождя в ноде, v2 профили схемы;
//   flow  1 — без изменений.
// ============================================================

const PARAM_FORMAT = "kns-param";
const PARAM_FORMAT_VERSION = 1;
const NODE_TYPES = ["pump", "delay", "catch", "flow"];

// Список поверхностей: одинаковый у водосбора и у одиночного расчёта.
const SURFACE_LIST_FIELD = {
  type: "surface-list",
  default: () => SURFACE_TYPES.map(t => ({ type: t.key, F: 0, z: "" })),
  label: "Состав поверхностей стока",
  of: {
    type: { type: "surface", label: "вид поверхности (ключ из таблицы Ж.6)" },
    F: { type: "number", min: 0, unit: "га", label: "Fᵢ — площадь поверхности" },
    z: { type: "number|empty", min: 0, label: "z — коэффициент покрова (пусто = авто по Ж.7)" },
  },
};

const SEG_LIST_FIELD = {
  type: "list",
  default: () => [],
  of: {
    l: { type: "number", min: 0, unit: "м", label: "длина участка" },
    v: { type: "number", min: 0, unit: "м/с", label: "скорость на участке" },
  },
};

const PARAM_SCHEMA = {
  rain: {
    version: 2,
    label: "Дождь",
    accepts: ["single", "cascade"],
    fields: {
      name: { type: "string", default: "", label: "имя профиля" },
      district: { type: "int|empty", default: null, min: 0, label: "район по таблице Ж.1 (пусто = вручную)" },
      n: { type: "number", default: 0.71, min: 0.01, max: 0.99, label: "n — климатический параметр" },
      q20: { type: "number", default: 80, min: 0.01, unit: "л/(с·га)", label: "q₂₀ — интенсивность дождя" },
      P: { type: "number", default: 1.0, min: 0.01, unit: "лет", label: "P — период превышения" },
      mr: { type: "number", default: 150, min: 1.01, unit: "дождей/год", label: "m_r — дождей за год" },
      gamma: { type: "number", default: 1.54, min: 0.01, label: "γ — показатель степени" },
    },
  },

  pump: {
    version: 2,
    label: "Насосная станция",
    accepts: ["cascade"],
    fields: {
      name: { type: "string", default: "", label: "имя ноды" },
      desc: { type: "string", default: "", label: "описание" },
      qr: { type: "number", default: 342.3, min: 0, unit: "л/с", label: "Q_r — макс. расход дождевого стока" },
      tr: { type: "number", default: 10, min: 0, unit: "мин", label: "t_r — расчётная продолжительность дождя" },
      q: { type: "number", default: 100, min: 0, unit: "л/с", label: "Q_нс — производительность станции" },
      idle: { type: "number", default: 50, min: 0, max: 100, unit: "%", label: "работа вне пика" },
      mode: { type: "enum", values: ["analytic", "numeric"], default: "analytic", label: "режим расчёта" },
    },
  },

  delay: {
    version: 2,
    label: "Участок сети",
    accepts: ["cascade"],
    fields: {
      name: { type: "string", default: "", label: "имя ноды" },
      desc: { type: "string", default: "", label: "описание" },
      v: { type: "number", default: 1, min: 0.01, unit: "м/с", label: "скорость течения" },
      l: { type: "number", default: 3600, min: 0, unit: "м", label: "длина участка" },
      d: { type: "number|empty", default: "", min: 0, unit: "мм", label: "диаметр (справочно)" },
    },
  },

  catch: {
    version: 3,
    label: "Водосбор",
    accepts: ["single", "cascade"],
    fields: {
      name: { type: "string", default: "", label: "имя ноды" },
      desc: { type: "string", default: "", label: "описание" },
      // q20/P/mr/gamma — наследие схем v2: тогда дождь хранился в самой ноде.
      // Оставлены как fallback для catchParams(d, n) без профиля дождя.
      q20: { type: "number", default: 80, min: 0.01, legacy: true, unit: "л/(с·га)", label: "q₂₀ (наследие, теперь в профиле дождя)" },
      P: { type: "number", default: 1.0, min: 0.01, legacy: true, unit: "лет", label: "P (наследие)" },
      mr: { type: "number", default: 150, min: 1.01, legacy: true, label: "m_r (наследие)" },
      gamma: { type: "number", default: 1.54, min: 0.01, legacy: true, label: "γ (наследие)" },
      psiMid: { type: "number", default: 0.634, min: 0, label: "Ψ_mid — постоянный коэффициент стока" },
      zMid: { type: "number", default: 0.201, min: 0, label: "z_mid — коэффициент покрова" },
      F: { type: "number", default: 3.9, min: 0, unit: "га", label: "F — площадь водосбора" },
      tcon: { type: "number", default: 3, min: 0, unit: "мин", label: "t_con — поверхностная концентрация" },
      tcan: { type: "number", default: 0, min: 0, unit: "мин", label: "t_can — добавочное время по лоткам" },
      tp: { type: "number", default: 0, min: 0, unit: "мин", label: "t_p — добавочное время по трубам" },
      segs: { ...SEG_LIST_FIELD, label: "Участки дождевой сети (трубы), ф. 17" },
      trays: { ...SEG_LIST_FIELD, label: "Участки лотка, ф. 16" },
      coeffMode: { type: "enum", values: ["variable", "const"], default: "variable", label: "коэффициент стока: переменный z / постоянный Ψ" },
      coeffSource: { type: "enum", values: ["manual", "table"], default: "table", label: "откуда F, z, Ψ: вручную / по составу поверхностей" },
      zRows: SURFACE_LIST_FIELD,
    },
  },

  flow: {
    version: 1,
    label: "Дополнительный приток",
    accepts: ["cascade"],
    fields: {
      name: { type: "string", default: "", label: "имя ноды" },
      desc: { type: "string", default: "", label: "описание" },
      mode: { type: "enum", values: ["constant"], default: "constant", label: "режим притока" },
      q: { type: "number", default: 50, min: 0, unit: "л/с", label: "Q — расход притока" },
      t1: { type: "number|empty", default: "", min: 0, unit: "мин", label: "t₁ — начало (пусто = с начала события)" },
      t2: { type: "number|empty", default: "", min: 0, unit: "мин", label: "t₂ — конец (пусто = до конца события)" },
    },
  },
};

// Значение поля по умолчанию: функции и списки — всегда свежий объект,
// иначе ноды делили бы один массив.
function schemaDefault(field) {
  if (typeof field.default === "function") return field.default();
  if (Array.isArray(field.default)) return field.default.map(v => (v && typeof v === "object" ? { ...v } : v));
  return field.default;
}

function nodeDefaultsOf(type) {
  const out = {};
  for (const [key, field] of Object.entries(PARAM_SCHEMA[type].fields)) out[key] = schemaDefault(field);
  return out;
}

// NODE_DEFAULTS собирается в cascade-nodes.js из этой же схемы. Одиночный
// расчёт cascade-nodes.js не грузит, поэтому здесь — запасной путь с теми же
// значениями: migrateNodeData должен работать на обеих страницах.
function nodeDefaults(type) {
  if (typeof NODE_DEFAULTS !== "undefined" && NODE_DEFAULTS[type]) return NODE_DEFAULTS[type];
  return nodeDefaultsOf(type);
}

// ---------- миграция исторических форм ----------

// Раньше жила в cascade-io.js; переехала сюда, чтобы одиночный расчёт тоже
// принимал водосбор старой версии. Значения по умолчанию берутся из схемы.
function migrateNodeData(type, raw) {
  const d = { ...nodeDefaults(type), ...(raw || {}) };
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
    // Режим берём из самой схемы, а не из NODE_DEFAULTS: старые схемы без
    // поля хранили ручные zMid/psiMid и должны остаться в режиме "manual".
    d.coeffSource = (raw || {}).coeffSource === "table" ? "table" : "manual";
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
    // Убранное поле «добавочная площадь»: чистим у старых схем, чтобы не
    // тащилось в сохранённом JSON и в ссылках.
    delete d.Fadd;
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
    d.q = q >= 0 ? q : nodeDefaults("flow").q;
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

// ---------- проверка чужих данных ----------

const isPlainObject = v => v !== null && typeof v === "object" && !Array.isArray(v);

function coerceField(key, field, value) {
  const label = field.label || key;
  const num = raw => {
    const v = parseFloat(raw);
    return Number.isFinite(v) ? v : null;
  };
  if (field.type === "string") return { value: value === null || value === undefined ? "" : String(value) };
  if (field.type === "number|empty" || field.type === "int|empty") {
    if (value === "" || value === null || value === undefined) return { value: field.type === "int|empty" ? null : "" };
    const v = num(value);
    if (v === null) return { error: `${label}: ожидалось число` };
    if (field.type === "int|empty" && !Number.isInteger(v)) return { error: `${label}: ожидалось целое число` };
    return { value: v };
  }
  if (field.type === "number" || field.type === "int") {
    const v = num(value);
    if (v === null) return { error: `${label}: ожидалось число` };
    if (field.min !== undefined && v < field.min) return { error: `${label}: не меньше ${field.min}` };
    if (field.max !== undefined && v > field.max) return { error: `${label}: не больше ${field.max}` };
    return { value: v };
  }
  if (field.type === "enum") {
    if (!field.values.includes(value)) return { error: `${label}: допустимо ${field.values.join(" / ")}` };
    return { value };
  }
  if (field.type === "list" || field.type === "surface-list") {
    if (!Array.isArray(value)) return { error: `${label}: ожидался список` };
    const out = [];
    for (const [i, item] of value.entries()) {
      if (!isPlainObject(item)) return { error: `${label}, строка ${i + 1}: ожидался объект` };
      const row = {};
      for (const [k, f] of Object.entries(field.of)) {
        const r = coerceField(k, f, item[k]);
        if (r.error) return { error: `${label}, строка ${i + 1} — ${r.error}` };
        row[k] = r.value;
      }
      out.push(row);
    }
    return { value: out };
  }
  return { value };
}

// Разбирает данные чужого формата по схеме типа: чужие поля отбрасываются,
// числа приводятся из строк, нечисловое значение в числовом поле — ошибка.
// Возвращает { data, errors }: при непустых errors данные вставлять нельзя.
function validateAgainstSchema(type, raw) {
  const schema = PARAM_SCHEMA[type];
  if (!schema) return { data: null, errors: [`неизвестный тип «${type}»`] };
  if (!isPlainObject(raw)) return { data: null, errors: [`${schema.label}: ожидался объект с параметрами`] };
  const data = {};
  const errors = [];
  for (const [key, field] of Object.entries(schema.fields)) {
    if (!(key in raw)) continue; // дефолт подставит migrateNodeData
    const r = coerceField(key, field, raw[key]);
    if (r.error) errors.push(r.error);
    else data[key] = r.value;
  }
  return { data, errors };
}

// ---------- справка ----------

const SCHEMA_TYPE_NAMES = { number: "число", int: "целое", "number|empty": "число или пусто", "int|empty": "целое или пусто", string: "текст", enum: "вариант", list: "список", "surface-list": "список", surface: "вид поверхности" };

function schemaDefaultText(field) {
  const v = field.default;
  if (typeof v === "function") return Array.isArray(v()) ? "—" : String(v());
  if (Array.isArray(v)) return v.length ? "—" : "пусто";
  if (v === "") return "пусто";
  if (v === null) return "—";
  return String(v);
}

function schemaHelpBlocks(type) {
  const types = type ? [type] : NODE_TYPES;
  const blocks = [{ h: "Интерфейс параметров" }, {
    p: "Ниже — поля, их версия и значения по умолчанию. Эти же сведения уезжают в файл и буфер обмена вместе с параметрами: при вставке версия сверяется, старая конвертируется, более новая отклоняется с сообщением.",
  }];
  for (const t of types) {
    const s = PARAM_SCHEMA[t];
    if (!s) continue;
    blocks.push({ p: `${s.label} — версия интерфейса v${s.version}.` });
    const rows = [];
    for (const [key, f] of Object.entries(s.fields)) {
      const kind = f.type === "list" || f.type === "surface-list"
        ? `список: ${Object.keys(f.of).join(", ")}`
        : SCHEMA_TYPE_NAMES[f.type] || f.type;
      rows.push([f.label || key, kind, f.unit || "—", schemaDefaultText(f) + (f.legacy ? " (наследие)" : "")]);
    }
    blocks.push({ table: { head: ["Поле", "Тип", "Единица", "По умолчанию"], rows } });
  }
  return blocks;
}
