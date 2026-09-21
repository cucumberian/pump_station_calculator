"use strict";

const editor = new Drawflow($c("drawflow"));
editor.force_first_input = true;
editor.zoom_max = 5.0;
editor.zoom_min = 0.1;
editor.start();

// Свой pinch-зум (cascade-view.js) конфликтует со встроенным мобильным зумом
// Drawflow (pointer-события -> zoom_in/zoom_out). Гасим встроенный.
for (const h of ["onpointerdown", "onpointermove", "onpointerup",
                 "onpointercancel", "onpointerout", "onpointerleave"]) {
  $c("drawflow")[h] = null;
}

let results = {};
let globalTMax = 0;
let sbNodeId = null;

function graphData() {
  return editor.export().drawflow.Home.data;
}

// n — климатический параметр активного профиля дождя (cascade-rain.js);
// объявлена там же — здесь дубль не нужен.

function nextNodeId() {
  const data = graphData();
  let maxId = 0;
  for (const id of Object.keys(data)) {
    const n = parseInt(id, 10);
    if (n > maxId) maxId = n;
  }
  editor.nodeId = maxId + 1;
}

function addNodeOfType(type, x, y) {
  const [ni, no] = NODE_PORTS[type];
  nextNodeId();
  return editor.addNode(type, ni, no, x, y, type, { ...NODE_DEFAULTS[type] }, NODE_HTML[type]);
}

function upstreamIds(id, data) {
  const nd = data[id];
  if (!nd) return [];
  const ids = [];
  for (const inp of Object.values(nd.inputs || {})) {
    for (const conn of inp.connections) ids.push(String(conn.node));
  }
  return ids;
}

function wouldCycle(outId, inId) {
  const data = graphData();
  const stack = [String(inId)];
  const seen = new Set();
  while (stack.length) {
    const cur = stack.pop();
    if (cur === String(outId)) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const out of Object.values(data[cur]?.outputs || {})) {
      for (const conn of out.connections) stack.push(String(conn.node));
    }
  }
  return false;
}

// Порядок пересчёта (Kahn). Возвращает {order, cyclic}: order — пригодный
// топопорядок (все рёбра идут влево), cyclic — узлы на циклах и всё, что
// получает из них поток. Раньше «остаток» молча дописывался в конец —
// непригодный порядок (см. formal/Formal/Graph.lean, cascadeCycle_not_topo);
// теперь он не участвует в расчёте, а computeCascadeNow показывает баннер.
function topoOrder(data) {
  const ids = Object.keys(data);
  const { order, rest } = kahnParts(ids, edgesFromData(data));
  return { order, cyclic: rest };
}

// Пересчёт всего графа — дорогая операция (топосорт, сэмплирование рядов, графики).
// При вводе чисел и протягивании слайдера считаем не по каждому нажатию, а
// через 250 мс после последнего изменения: computeCascade() откладывает,
// flushCascade() — считает немедленно (структурные правки, экспорт, отчёт).
const COMPUTE_DEBOUNCE_MS = 250;
let computeTimer = null;

function computeCascade() {
  if (computeTimer !== null) return;
  computeTimer = setTimeout(() => {
    computeTimer = null;
    computeCascadeNow();
  }, COMPUTE_DEBOUNCE_MS);
}

function flushCascade() {
  if (computeTimer !== null) {
    clearTimeout(computeTimer);
    computeTimer = null;
  }
  computeCascadeNow();
}

// Горизонт расчётного события для нод «Доп. приток» с пустым t₂ («до конца
// события»). Консервативная рамка, как у ряда водосбора (hydroTailT +
// totalDelay + 30): максимум хвостов всех включённых гидрографов схемы
// (водосборы и собственные Qr/tr станций), явно указанных t₂ других
// притоков и суммы задержек. Выходы станций (piecewise) не учитываются —
// иначе петля «горизонт flow → вход станции → выход станции». Ни дождя, ни
// явного t₂ в схеме — горизонт 0, такая нода требует явного t₂.
function rainHorizon(data, nGlob, totalDelay) {
  let h = 0;
  for (const nd of Object.values(data)) {
    if (nd.data?.disabled) continue;
    if (nd.name === "catch") {
      const p = catchParams(nd.data || {}, nGlob, getActiveRain());
      if (p.Qr > 0 && p.tr > 0) h = Math.max(h, hydroTailT(p.Qr, p.tr, nGlob));
    } else if (nd.name === "pump") {
      const Qr = parseFloat(nd.data?.qr), tr = parseFloat(nd.data?.tr);
      if (Qr > 0 && tr > 0) h = Math.max(h, hydroTailT(Qr, tr, nGlob));
    } else if (nd.name === "flow") {
      const t2 = parseFloat(nd.data?.t2);
      if (Number.isFinite(t2)) h = Math.max(h, t2);
    }
  }
  return h > 0 ? h + totalDelay + 30 : 0;
}

// Строка-итоги на ноде «Доп. приток». Пустое t₁ — «с начала события», пустое
// t₂ — «до конца события»; оба пустые — поток постоянный на всём времени
// расчёта. Если GF не построилась (нет горизонта — в схеме нет дождя),
// подсвечиваем причину, а не молчим.
function flowSummaryHTML(d, res) {
  const q = parseFloat(d.q);
  const t1set = !(d.t1 === "" || d.t1 === null || d.t1 === undefined) && Number.isFinite(parseFloat(d.t1));
  const t2set = !(d.t2 === "" || d.t2 === null || d.t2 === undefined) && Number.isFinite(parseFloat(d.t2));
  const t1 = t1set ? parseFloat(d.t1) : 0;
  if (res?.gf) {
    const seg = res.gf.segments.find(s => s.q > 0) || res.gf.segments[0];
    const t2 = seg.tEnd;
    const span = `${fmt(seg.tStart, 0)}…${fmt(t2, 0)} мин`;
    let hint = "";
    if (!t1set && !t2set) hint = "Поток постоянный на всём времени расчёта";
    else if (!t1set) hint = `Поток постоянный с начала события до t<sub>кон</sub> = ${fmt(t2, 0)} мин`;
    else if (!t2set) hint = `Поток постоянный с t<sub>нач</sub> = ${fmt(t1, 0)} мин до конца события`;
    return `Q = <b>${fmt(q, 1)} л/с</b><br>${span}` + (hint ? `<br><span class="hint">${hint}</span>` : "");
  }
  if (!(q >= 0)) return `<span class="warn">задайте Q</span>`;
  if (t2set) return `<span class="warn">проверьте t<sub>нач</sub> и t<sub>кон</sub></span>`;
  return `<span class="warn">укажите t<sub>кон</sub> — в схеме нет дождя</span>`;
}

function computeCascadeNow() {
  const data = graphData();
  const nGlob = getGlobalN();
  const totalDelay = Object.values(data)
    .filter(nd => nd.name === "delay")
    .reduce((s, nd) => s + delayDt(nd.data || {}), 0);

  const { order, cyclic } = topoOrder(data);
  const flowHorizon = rainHorizon(data, nGlob, totalDelay);
  const res = {};
  for (const id of order) {
    const nd = data[id];
    const d = nd.data || {};
    if (d.disabled) { res[id] = null; continue; }
    if (nd.name === "flow") {
      // Дополнительный приток — источник piecewise-импульса; res.gf без
      // series-особенностей, ряд для графиков сделает общий цикл ниже.
      const gf = flowGF(d, flowHorizon);
      res[id] = gf ? { gf, fromCatch: false } : null;
    } else if (nd.name === "catch") {
      const p = catchParams(d, nGlob, getActiveRain());
      if (!(p.Qr > 0 && p.tr > 0)) { res[id] = null; continue; }
      res[id] = {
        gf: makeHydroGF(p.Qr, p.tr, nGlob, 0),
        series: sampleHydro(p.Qr, p.tr, nGlob, hydroTailT(p.Qr, p.tr, nGlob) + totalDelay + 30),
        Qr: p.Qr, tr: p.tr, params: p, fromCatch: true,
      };
    } else if (nd.name === "delay") {
      const srcs = upstreamIds(id, data).map(u => res[u]).filter(Boolean);
      if (!srcs.length) { res[id] = null; continue; }
      const dt = delayDt(d);
      const srcGFs = srcs.map(s => s.gf);
      const combinedGF = srcGFs.length === 1 ? srcGFs[0] : null;
      res[id] = {
        gf: combinedGF ? shiftGF(combinedGF, dt) : null,
        fromCatch: srcs.every(s => s.fromCatch), Qr: srcs[0].Qr, tr: srcs[0].tr,
      };
      if (!res[id].gf) {
        const srcMax = Math.max(...srcGFs.map(gf => durationGF(gf)));
        const combined = combineGF(srcGFs, HYDRO_DT, srcMax);
        res[id].gf = { type: "dense", ...shiftSeries(combined, dt) };
      }
    } else if (nd.name === "pump") {
      const Q = parseFloat(d.q);
      const ups = upstreamIds(id, data).map(u => ({ id: u, r: res[u] })).filter(x => x.r);
      const catchUps = ups.filter(x => x.r.fromCatch);
      const flowUps = ups.filter(x => !x.r.fromCatch);
      let Qr = parseFloat(d.qr), tr = parseFloat(d.tr), lockIds = [], ownRainGF = null, hydroGFs = [];
      if (catchUps.length) {
        lockIds = catchUps.map(x => x.id);
        hydroGFs = catchUps.map(x => x.r.gf);
        if (catchUps.length === 1) {
          Qr = catchUps[0].r.Qr;
          tr = catchUps[0].r.tr;
          ownRainGF = catchUps[0].r.gf;
        } else {
          const catchMax = Math.max(...catchUps.map(x => durationGF(x.r.gf)));
          ownRainGF = { type: "dense", ...combineGF(catchUps.map(x => x.r.gf), HYDRO_DT, catchMax) };
          const ownPeak = peakGF(ownRainGF);
          Qr = ownPeak.q;
          tr = Math.max(ownPeak.t, 0.5);
        }
        // Поля qr/tr перезаписываем только на разблокированной станции:
        // заблокированные значения заданы инженером вручную и персистентны.
        // Сам расчёт при этом ВСЕГДА идёт по гидрографам водосборов —
        // эквивалентный гидрограф точен лишь для одного водосбора, поэтому
        // водосборы (особенно два и более) отключать при блокировке нельзя.
        if (!d.locked) editor.updateNodeDataFromId(id, { ...editor.getNodeFromId(id).data, qr: Qr, tr });
      }
      if (!(Qr > 0 && tr > 0 && Q > 0)) { res[id] = null; continue; }
      let idlePct = parseFloat(d.idle);
      if (!(idlePct >= 0)) idlePct = 50;
      idlePct = Math.min(idlePct, 100);
      const idleQ = Q * idlePct / 100;
      const mode = d.mode === "numeric" ? "numeric" : "analytic";
      let r, eq = null, inflowGF;

      if (!ownRainGF) ownRainGF = makeHydroGF(Qr, tr, nGlob, 0);
      const flowGFs = flowUps.map(x => x.r.gf);
      const pureRain = flowUps.length === 0 && catchUps.length <= 1;
      if (flowGFs.length === 0) {
        inflowGF = ownRainGF;
      } else {
        const inflowMax = Math.max(durationGF(ownRainGF), ...flowGFs.map(gf => durationGF(gf)));
        inflowGF = { type: "dense", ...combineGF([ownRainGF, ...flowGFs], HYDRO_DT, inflowMax) };
      }
      const exactGFs = catchUps.length ? hydroGFs : [ownRainGF];
      if (mode === "analytic") {
        if (pureRain) {
          eq = { Qr, tr, n: nGlob };
          r = Qr <= Q ? { tn: 0, tk: 0, W: 0, dry: true } : calc(Q, Qr, tr, nGlob);
          const dly = ownRainGF.delay || 0;
          if (dly && !r.dry) r = { ...r, tn: r.tn + dly, tk: r.tk + dly };
        } else {
          if (exactGFs.every(gf => gf && gf.type === "hydrograph") && flowGFs.every(gf => gf.type === "piecewise")) {
            r = mixedAnalyticCalc(Q, exactGFs, flowGFs);
          } else {
            const peak = peakGF(inflowGF);
            eq = { Qr: peak.q, tr: Math.max(peak.t, 0.5), n: nGlob };
            r = peak.q <= Q ? { tn: 0, tk: 0, W: 0, dry: true } : calc(Q, eq.Qr, eq.tr, eq.n);
          }
        }
      } else {
        const numEnd = Math.max(durationGF(ownRainGF), ...flowGFs.map(gf => durationGF(gf)));
        const inflowNum = flowGFs.length === 0
          ? toDense(ownRainGF, HYDRO_DT, numEnd)
          : combineGF([ownRainGF, ...flowGFs], HYDRO_DT, numEnd);
        r = numericCalc(Q, inflowNum);
      }
      const tMax = Math.max(durationGF(inflowGF), r.dry ? 0 : r.tk + 10);
      res[id] = {
        gf: makePiecewiseGF([
          { q: idleQ, tStart: 0, tEnd: r.dry ? 0 : r.tn },
          { q: Q, tStart: r.dry ? 0 : r.tn, tEnd: r.dry ? 0 : r.tk },
          { q: idleQ, tStart: r.dry ? 0 : r.tk, tEnd: tMax },
        ], 0),
        ownRainGF, inflowGF, flowGFs, hydroGFs: exactGFs, r, Q, Qr, tr, idle: idlePct, mode, eq, nEff: nGlob, lockId: lockIds[0] || null, lockIds,
        approx: mode === "analytic" && !pureRain && !!eq,
      };
    }
  }
  globalTMax = 0;
  for (const r of Object.values(res)) {
    if (r?.gf) {
      const dur = durationGF(r.gf);
      if (dur > globalTMax) globalTMax = dur;
    }
  }
  for (const [id, r] of Object.entries(res)) {
    if (data[id]?.name !== "pump") continue;
    if (r?.gf?.type === "piecewise" && r.gf.segments.length && globalTMax > 0) {
      const last = r.gf.segments[r.gf.segments.length - 1];
      const effectiveEnd = (r.gf.delay || 0) + last.tEnd;
      if (effectiveEnd < globalTMax) {
        const newEnd = globalTMax - (r.gf.delay || 0);
        r.gf = { ...r.gf, segments: [...r.gf.segments.slice(0, -1), { ...last, tEnd: newEnd }] };
      }
    }
  }
  for (const r of Object.values(res)) {
    // res.series — только для графиков: сразу ресемплим с сохранением пиков
    // (35k точек при tr~50 ч на экран бессмысленны и тормозят ECharts).
    if (r?.gf) r.series = resampleForDisplay(toDense(r.gf, HYDRO_DT));
  }
  for (const [id, r] of Object.entries(res)) {
    if (r?.ownRainGF && data[id]?.name === "pump") {
      const ups = upstreamIds(id, data).map(u => res[u]).filter(Boolean);
      const flowGFs = ups.filter(x => !x.fromCatch).map(x => x.gf).filter(Boolean);
      if (flowGFs.length === 0) {
        r.inflowGF = r.ownRainGF;
      } else {
        r.inflowGF = { type: "dense", ...combineGF([r.ownRainGF, ...flowGFs], HYDRO_DT, globalTMax) };
      }
    }
  }
  // Циклические узлы и их «потомки» в расчёте не участвуют; summary покажет «—».
  for (const id of cyclic) res[id] = null;
  results = res;
  updateSummaries(data);
  saveScheme();
  refreshSidebar();
}

function nodeLocked(id) {
  return !!editor.getNodeFromId(id)?.data?.locked;
}

function nodeDisabled(id) {
  return !!editor.getNodeFromId(id)?.data?.disabled;
}

function updateSummaries(data = graphData()) {
  for (const [id, nd] of Object.entries(data)) {
    const numEl = document.querySelector(`#node-${id} .node-num`);
    if (numEl) numEl.textContent = `#${id}`;
    const nameEl = document.querySelector(`#node-${id} .node-name`);
    if (nameEl) nameEl.textContent = (nd.data?.name || "").trim() || NODE_TYPE_LABEL[nd.name];
    const isLocked = !!nd.data?.locked;
    const isDisabled = !!nd.data?.disabled;
    const lockBtn = document.querySelector(`#node-${id} .node-lock`);
    if (lockBtn) {
      lockBtn.classList.toggle("active", isLocked);
      lockBtn.innerHTML = isLocked ? LOCK_CLOSED_SVG : LOCK_OPEN_SVG;
      lockBtn.title = isLocked ? "Разблокировать параметры" : "Заблокировать параметры";
    }
    const disBtn = document.querySelector(`#node-${id} .node-disable`);
    if (disBtn) {
      disBtn.classList.toggle("active", isDisabled);
      disBtn.innerHTML = isDisabled ? DISABLE_ON_SVG : DISABLE_OFF_SVG;
      disBtn.title = isDisabled ? "Включить ноду" : "Отключить ноду";
    }
    const boxEl = document.querySelector(`#node-${id} .node-box`);
    if (boxEl) boxEl.classList.toggle("disabled", isDisabled);
    for (const inp of document.querySelectorAll(`#node-${id} input`)) {
      inp.disabled = isLocked;
    }
    // Drawflow пишет значения в поля карточек сырыми числами (3.9, 342.3),
    // а после каждого пересчёта перезаписывает их заново — дописываем нули
    // здесь, пока поле не в фокусе (иначе мешает вводу).
    for (const inp of document.querySelectorAll(`#node-${id} input[type="number"]`)) {
      if (document.activeElement === inp) continue;
      const n = parseFloat(inp.value);
      if (Number.isFinite(n)) inp.value = padNum(n);
    }
    if (nd.name === "delay") {
      const out = document.querySelector(`#node-${id} .delay-out`);
      const dt = delayDt(nd.data || {});
      if (out) {
        out.innerHTML = `Δt = <b>${fmt(dt, 1)} мин</b>`;
        out.title = derivedTitle(dt, "мин");
      }
      continue;
    }
    if (nd.name === "flow") {
      const out = document.querySelector(`#node-${id} .flow-out`);
      if (out) out.innerHTML = flowSummaryHTML(nd.data || {}, results[id]);
      continue;
    }
    if (nd.name === "catch") {
      const out = document.querySelector(`#node-${id} .catch-out`);
      const r = results[id];
      // Ошибка расчёта (Qr = 0): иконка у заголовка и — отдельно — у правого
      // края строки результата (не на самом Qr).
      const errReason = !isDisabled && !r ? catchErrorReason(nd.data) : null;
      const warnEl = document.querySelector(`#node-${id} .node-warn`);
      if (warnEl) {
        warnEl.hidden = !errReason;
        warnEl.innerHTML = errReason ? WARN_TRIANGLE_SVG : "";
        warnEl.title = errReason || "";
      }
      const outWarn = errReason
        ? `<span class="catch-warn" title="${errReason}">${WARN_TRIANGLE_SVG}</span>`
        : "";
      if (out) {
        const text = r
          ? `Q<sub>r</sub> = <b>${fmt(r.Qr, 2)} л/с</b> <br> t<sub>r</sub> = <b>${fmt(r.tr, 2)} мин</b>`
          : `Q<sub>r</sub> = 0 <br> t<sub>r</sub> = 0`;
        out.innerHTML = `<span class="catch-res-text">${text}</span>${outWarn}`;
        out.title = r ? derivedTitleMany([["Qr", r.Qr, "л/с"], ["tr", r.tr, "мин"]]) : "";
      }
      // В режиме «по составу поверхностей» площадь производна (F = ΣFᵢ);
      // при пустом составе F = 0, поле остаётся заблокированным.
      const fInp = document.querySelector(`#node-${id} input[df-f]`);
      if (fInp) {
        const derived = nd.data?.coeffSource === "table";
        fInp.disabled = isLocked || derived;
        // Производная площадь: из расчёта, а при его отсутствии — 0.
        if (derived && document.activeElement !== fInp) {
          const fv = r?.params ? Math.round(r.params.F * 1000) / 1000 : 0;
          fInp.value = padNum(fv);
        }
      }
      continue;
    }
    if (nd.name !== "pump") continue;
    const mt = document.querySelector(`#node-${id} .mode-toggle`);
    if (mt) {
      mt.classList.toggle("active", (nd.data?.mode ?? "analytic") === "numeric");
      mt.disabled = isLocked;
    }
    const r = results[id];
    const locked = !!(r && r.lockId);
    const ln = document.querySelector(`#node-${id} .lock-note`);
    if (ln) {
      ln.classList.toggle("on", locked);
      if (locked) {
        const ids = (r.lockIds?.length ? r.lockIds : [r.lockId]).map(x => `#${x}`).join(", ");
        ln.innerHTML = `Q<sub>r</sub>, t<sub>r</sub> ← ${r.lockIds?.length > 1 ? "Водосборы" : "Водосбор"} ${ids}`;
      }
    }
    for (const k of ["qr", "tr"]) {
      const inp = document.querySelector(`#node-${id} input[df-${k}]`);
      if (!inp) continue;
      inp.disabled = isLocked || locked;
      // Заблокированная станция показывает свои персистентные qr/tr, а не
      // пересчитанные от водосбора (расчёт при этом всё равно идёт по притоку).
      if (locked && !isLocked && document.activeElement !== inp) {
        showDerived(inp, k === "qr" ? r.Qr : r.tr, k === "qr" ? "л/с" : "мин");
      } else {
        inp.title = ""; // значение своё, «точное из расчёта» показывать нечего
      }
    }
    const slider = document.querySelector(`#node-${id} .q-range`);
    if (slider && r) {
      // Верх слайдера — пик суммарного притока, а не только собственного дождя:
      // та же методика, что в боковой панели (seriesPeak(inflowFromResult)),
      // иначе на нод со станциями выше слайдер обрезается ниже входов.
      const inflS = inflowFromResult(r);
      const qMax = inflS ? seriesPeak(inflS).q : r.Qr;
      slider.max = Math.ceil(qMax);
      if (document.activeElement !== slider) slider.value = Math.min(r.Q, qMax);
    }
    const el = document.querySelector(`#node-${id} .node-summary`);
    if (!el) continue;
    // В подсказке — точные Tн/Tк/Wнс: на экране они округлены до знаков,
    // а расчёт идёт по полным значениям.
    el.title = r && !r.r.dry
      ? derivedTitleMany([["Tн", r.r.tn, "мин"], ["Tк", r.r.tk, "мин"], ["Wнс", r.r.W, "м³"]])
      : "";
    if (!r) {
      el.innerHTML = `<span class="warn">задайте Q<sub>r</sub>, t<sub>r</sub>, Q<sub>нс</sub></span>`;
    } else if (r.r.dry) {
      el.innerHTML = `<span class="warn">Q<sub>нс</sub> ≥ притока — регулирование не требуется</span>`;
    } else {
      const zn = nearZeroNote(r.r);
      el.innerHTML =
        `T<sub>н</sub> = ${fmt(r.r.tn)} мин, T<sub>к</sub> = ${fmt(r.r.tk)} мин<br>` +
        `W<sub>нс</sub> = <b>${fmt(r.r.W, 1)} м³</b>` +
        (r.r.truncated ? `<br><span class="warn">окно расчёта обрезано — W может быть занижен</span>` : "") +
        (zn ? `<br><span class="hint">${zn}</span>` : "");
    }
  }
}

// Перетаскивание нод из палитры на холст — свой pointer-drag, а не нативный
// HTML5 DnD. У нативного drag-ghost в Chromium заметное отставание от курсора
// (особенно при большом DOM и внутри скролл-контейнера палитры); ghost из
// position:fixed, двигаемый через transform, тянется за курсором 1:1 и
// композитится на GPU. Нативный drag выключаем (draggable=false), иначе он
// перехватывает указатель и гасит pointermove.
const PAL_DRAG_THRESHOLD = 4;
let palDrag = null;

function palPointToCanvas(clientX, clientY) {
  const rect = editor.precanvas.getBoundingClientRect();
  return {
    x: (clientX - rect.x) / editor.zoom,
    y: (clientY - rect.y) / editor.zoom,
  };
}

function palOverCanvas(clientX, clientY) {
  const r = $c("drawflow").getBoundingClientRect();
  return clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom;
}

function palClearDrag() {
  if (!palDrag) return;
  palDrag.ghost.remove();
  document.removeEventListener("pointermove", palDrag.onMove);
  document.removeEventListener("pointerup", palDrag.onUp);
  document.removeEventListener("pointercancel", palDrag.onCancel);
  document.removeEventListener("keydown", palDrag.onKey);
  document.body.classList.remove("pal-dragging");
  palDrag = null;
}

function palMove(e) {
  if (!palDrag) return;
  if (!palDrag.moved) {
    if (Math.hypot(e.clientX - palDrag.startX, e.clientY - palDrag.startY) < PAL_DRAG_THRESHOLD) return;
    palDrag.moved = true;
    document.body.classList.add("pal-dragging");
  }
  palDrag.ghost.style.transform =
    `translate3d(${e.clientX - palDrag.offX}px, ${e.clientY - palDrag.offY}px, 0)`;
  palDrag.ghost.classList.toggle("over", palOverCanvas(e.clientX, e.clientY));
}

function palUp(e) {
  if (!palDrag) return;
  const drag = palDrag;
  const inside = palOverCanvas(e.clientX, e.clientY);
  const moved = drag.moved;
  palClearDrag();
  if (!moved || !inside || !NODE_HTML[drag.type]) return;
  const pos = palPointToCanvas(e.clientX, e.clientY);
  addNodeOfType(drag.type, pos.x, pos.y);
  flushCascade();
}

for (const item of document.querySelectorAll(".pal-node")) {
  item.draggable = false;
  item.addEventListener("pointerdown", e => {
    // Только мышь левой кнопкой; тач — прежний клик с постановкой в центр.
    if (e.pointerType !== "mouse" || e.button !== 0 || palDrag) return;
    e.preventDefault();
    const rect = item.getBoundingClientRect();
    const ghost = item.cloneNode(true);
    ghost.classList.add("pal-ghost");
    ghost.style.width = rect.width + "px";
    ghost.style.transform = `translate3d(${rect.left}px, ${rect.top}px, 0)`;
    document.body.append(ghost);
    palDrag = {
      type: item.dataset.node,
      startX: e.clientX, startY: e.clientY,
      offX: e.clientX - rect.left, offY: e.clientY - rect.top,
      moved: false, ghost,
    };
    palDrag.onMove = ev => palMove(ev);
    palDrag.onUp = ev => palUp(ev);
    palDrag.onCancel = () => palClearDrag();
    palDrag.onKey = ev => { if (ev.key === "Escape") palClearDrag(); };
    document.addEventListener("pointermove", palDrag.onMove);
    document.addEventListener("pointerup", palDrag.onUp);
    document.addEventListener("pointercancel", palDrag.onCancel);
    document.addEventListener("keydown", palDrag.onKey);
  });
  item.addEventListener("click", () => {
    if (!window.matchMedia("(pointer: coarse)").matches) return;
    const rect = $c("drawflow").getBoundingClientRect();
    const x = (rect.width / 2 - editor.canvas_x) / editor.zoom;
    const y = (rect.height / 2 - editor.canvas_y) / editor.zoom;
    addNodeOfType(item.dataset.node, x - 100, y - 60);
    flushCascade();
  });
}
window.addEventListener("blur", palClearDrag);

$c("drawflow").addEventListener("mouseup", scheduleSaveView);
$c("drawflow").addEventListener("touchend", scheduleSaveView);

function resetDragIfStuck(clientX, clientY) {
  if (editor.editor_selected) {
    editor.canvas_x += -(editor.pos_x - clientX);
    editor.canvas_y += -(editor.pos_y - clientY);
    editor.editor_selected = false;
    editor.precanvas.style.transform =
      "translate(" + editor.canvas_x + "px, " + editor.canvas_y + "px) scale(" + editor.zoom + ")";
    scheduleSaveView();
  }
  if (editor.drag) {
    editor.drag = false;
    scheduleSaveView();
  }
}
document.addEventListener("mouseup", e => resetDragIfStuck(e.clientX, e.clientY));
document.addEventListener("touchend", () => resetDragIfStuck(editor.mouse_x, editor.mouse_y));
document.addEventListener("pointercancel", e => resetDragIfStuck(e.clientX, e.clientY));

let mouseDownPos = null;
$c("drawflow").addEventListener("mousedown", e => { mouseDownPos = [e.clientX, e.clientY]; });
$c("drawflow").addEventListener("click", e => {
  const nodeEl = e.target.closest(".drawflow-node");
  if (!nodeEl || !mouseDownPos) return;
  if (Math.hypot(e.clientX - mouseDownPos[0], e.clientY - mouseDownPos[1]) > 5) return;
  const id = nodeEl.id.replace("node-", "");
  if (["pump", "delay", "catch", "flow"].includes(editor.getNodeFromId(id)?.name)) openSidebar(id);
});

function dfKey(el) {
  const attr = [...el.attributes].find(a => a.name.startsWith("df-"));
  if (!attr) return null;
  const key = attr.name.slice(3);
  return { f: "F", p: "P" }[key] || key;
}

window.addEventListener("wheel", e => {
  const el = e.target;
  if (!(el instanceof HTMLInputElement)) return;
  if (el.disabled || el.readOnly) return;
  const inNode = el.closest(".node-box");
  const inSegList = el.closest(".seg-list");
  let step = null;
  if (inNode) {
    step = el.type === "range" ? 1 : NODE_WHEEL_STEPS[dfKey(el)];
  } else if (inSegList) {
    step = parseFloat(el.dataset.step) || 1;
  } else {
    step = SB_WHEEL_STEPS[el.id];
  }
  if (!step) return;
  e.preventDefault();
  e.stopPropagation();
  const dec = (String(step).split(".")[1] || "").length;
  let v = (parseFloat(el.value) || 0) + (e.deltaY < 0 ? step : -step);
  v = +v.toFixed(dec);
  if (el.min !== "" && v < +el.min) v = +el.min;
  if (el.max !== "" && v > +el.max) v = +el.max;
  el.value = el.type === "number" ? v.toFixed(Math.max(dec, 2)) : v;
  if (inNode) {
    const id = el.closest(".drawflow-node").id.replace("node-", "");
    syncNodeParam(id, el.type === "range" ? "q" : dfKey(el), v);
  } else {
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }
}, { capture: true, passive: false });

for (const evName of ["mousedown", "touchstart", "pointerdown"]) {
  $c("drawflow").addEventListener(evName, e => {
    if (e.target.classList?.contains("q-range") ||
        e.target.classList?.contains("mode-toggle") ||
        e.target.closest(".node-lock") ||
        e.target.classList?.contains("catch-info")) e.stopPropagation();
  }, true);
}

$c("drawflow").addEventListener("click", e => {
  const mt = e.target.closest(".mode-toggle");
  if (!mt || mt.disabled) return;
  e.stopPropagation();
  const id = mt.closest(".drawflow-node").id.replace("node-", "");
  const nd = editor.getNodeFromId(id);
  if (!nd) return;
  syncNodeParam(id, "mode", nd.data?.mode === "numeric" ? "analytic" : "numeric");
}, true);

$c("drawflow").addEventListener("click", e => {
  const lb = e.target.closest(".node-lock");
  if (!lb) return;
  e.stopPropagation();
  const id = lb.closest(".drawflow-node").id.replace("node-", "");
  syncNodeParam(id, "locked", !nodeLocked(id));
}, true);

$c("drawflow").addEventListener("click", e => {
  const db = e.target.closest(".node-disable");
  if (!db) return;
  e.stopPropagation();
  const id = db.closest(".drawflow-node").id.replace("node-", "");
  syncNodeParam(id, "disabled", !nodeDisabled(id));
}, true);

$c("drawflow").addEventListener("click", e => {
  const ci = e.target.closest(".catch-info");
  if (!ci) return;
  e.stopPropagation();
  const id = ci.closest(".drawflow-node").id.replace("node-", "");
  if (computeTimer !== null) flushCascade(); // справка по свежим параметрам
  const r = results[id];
  if (r?.params) openHelp(catchHelp(r.params), {});
}, true);

$c("drawflow").addEventListener("input", e => {
  const t = e.target;
  if (t.classList?.contains("q-range")) {
    const id = t.closest(".drawflow-node").id.replace("node-", "");
    syncNodeParam(id, "q", parseFloat(t.value));
    return;
  }
  // DOM всегда отдает имя атрибута в нижнем регистре, поэтому Drawflow пишет
  // поля F/P узла-водосбора в data.f/data.p, а канонические F/P устаревают:
  // расчёт читает канон, а поле при перерисовке возвращается к призраку.
  // Зеркалим введенное значение в канон прямо в живых данных — через
  // updateNodeDataFromId нельзя: он перезапишет поле, в которое вводят,
  // и сломает набор десятичных дробей.
  const key = dfKey(t);
  if (key !== "F" && key !== "P") return;
  const nodeEl = t.closest(".drawflow-node");
  if (!nodeEl) return;
  const d = editor.drawflow?.drawflow?.Home?.data?.[nodeEl.id.slice(5)]?.data;
  if (!d) return;
  const v = parseFloat(t.value);
  if (Number.isFinite(v)) d[key] = v;
  delete d[key === "F" ? "f" : "p"];
});

editor.on("connectionCreated", conn => {
  const outNode = editor.getNodeFromId(conn.output_id);
  const inNode = editor.getNodeFromId(conn.input_id);
  const outConns = outNode?.outputs?.[conn.output_class]?.connections || [];
  if (outConns.length > 1 ||
      wouldCycle(conn.output_id, conn.input_id) ||
      (outNode?.name === "catch" && inNode?.name === "delay")) {
    editor.removeSingleConnection(conn.output_id, conn.input_id, conn.output_class, conn.input_class);
    return;
  }
  flushCascade();
});
editor.on("connectionRemoved", () => flushCascade());
editor.on("nodeRemoved", id => {
  if (String(sbNodeId) === String(id)) closeSidebar();
  flushCascade();
});
editor.on("nodeDataChanged", () => computeCascade());
editor.on("nodeMoved", () => saveScheme());

// Панель дождя схемы (cascade-rain.js): кнопка + профили + параметры.
bindRainPanel();
$c("sbHydroHelp").addEventListener("click", () => openHelp([...CASCADE_HELP, ...schemaHelpBlocks()], {}));

const LS_PALETTE = "kns-palette-collapsed";
function setPaletteCollapsed(collapsed) {
  $c("palette").classList.toggle("collapsed", collapsed);
  const btn = $c("paletteBtn");
  btn.classList.toggle("collapsed", collapsed);
  btn.title = collapsed ? "Развернуть панель нод" : "Свернуть панель нод";
  btn.setAttribute("aria-label", btn.title);
  try { localStorage.setItem(LS_PALETTE, collapsed ? "1" : "0"); } catch { /* приватный режим */ }
}
$c("paletteBtn").addEventListener("click", () => {
  setPaletteCollapsed(!$c("palette").classList.contains("collapsed"));
});
try {
  if (localStorage.getItem(LS_PALETTE) === "1") setPaletteCollapsed(true);
} catch { /* приватный режим */ }

let ctxPos = null, ctxConn = null, ctxNode = null, ctxShownAt = 0, ctxFromTouch = false;
function showCtxMenu(x, y, { nodeEl = null, connEl = null, fromTouch = false } = {}) {
  ctxPos = [x, y];
  ctxConn = null;
  ctxNode = null;
  ctxShownAt = Date.now();
  ctxFromTouch = fromTouch;
  const m = $c("ctxMenu");
  if (nodeEl) {
    ctxNode = nodeEl.id.replace("node-", "");
    m.innerHTML = `
      <button type="button" data-copynode>${ICON_COPY_HTML}Копировать параметры</button>
      <button type="button" data-pastenode>${ICON_PASTE_HTML}Вставить параметры</button>
      <button type="button" data-savenode>${ICON_SAVE_HTML}Сохранить в JSON</button>
      <button type="button" data-dupnode>${ICON_DUPLICATE_HTML}Дублировать ноду</button>
      <button type="button" data-delnode>${XMARK_HTML}Удалить ноду</button>`;
  } else if (connEl) {
    const cls = [...connEl.classList];
    ctxConn = {
      outId: cls.find(c => c.startsWith("node_out_node-"))?.replace("node_out_node-", ""),
      inId: cls.find(c => c.startsWith("node_in_node-"))?.replace("node_in_node-", ""),
      outClass: cls.find(c => /^output_\d+$/.test(c)),
      inClass: cls.find(c => /^input_\d+$/.test(c)),
    };
    m.innerHTML = `<button type="button" data-delconn>${XMARK_HTML}Удалить связь</button>`;
  } else {
    m.innerHTML = `
      <button type="button" data-pastenode>Вставить ноду из буфера</button>
      <button type="button" data-add="pump">Насосная станция</button>
      <button type="button" data-add="delay">Участок сети</button>
      <button type="button" data-add="catch">Водосбор</button>
      <button type="button" data-add="flow">Доп. приток</button>`;
  }
  m.hidden = false;
  m.style.left = Math.min(x, window.innerWidth - 200) + "px";
  m.style.top = Math.min(y, window.innerHeight - 120) + "px";
}
function hideCtxMenu() {
  $c("ctxMenu").hidden = true;
  ctxPos = null;
  ctxConn = null;
  ctxNode = null;
}

$c("drawflow").addEventListener("contextmenu", e => {
  e.preventDefault();
  e.stopPropagation();
  if (ctxFromTouch && Date.now() - ctxShownAt < 800) return;
  showCtxMenu(e.clientX, e.clientY, {
    nodeEl: e.target.closest(".drawflow-node"),
    connEl: e.target.closest(".connection"),
  });
}, true);

let lpTimer = null, lpStart = null;
$c("drawflow").addEventListener("touchstart", e => {
  if (e.touches.length !== 1 || e.target.closest("input, button, select")) {
    clearTimeout(lpTimer);
    lpStart = null;
    return;
  }
  const t = e.touches[0];
  lpStart = [t.clientX, t.clientY];
  const opts = {
    nodeEl: e.target.closest(".drawflow-node"),
    connEl: e.target.closest(".connection"),
    fromTouch: true,
  };
  lpTimer = setTimeout(() => showCtxMenu(t.clientX, t.clientY, opts), 550);
});
$c("drawflow").addEventListener("touchmove", e => {
  if (!lpStart) return;
  const t = e.touches[0];
  if (Math.hypot(t.clientX - lpStart[0], t.clientY - lpStart[1]) > 10) {
    clearTimeout(lpTimer);
    lpStart = null;
  }
});
$c("drawflow").addEventListener("touchend", () => {
  clearTimeout(lpTimer);
  lpStart = null;
});
$c("drawflow").addEventListener("touchcancel", () => {
  clearTimeout(lpTimer);
  lpStart = null;
});
// Вызывается из pinch-жеста, чтобы контекстное меню не всплывало во время зума.
window.cancelLongPress = () => {
  clearTimeout(lpTimer);
  lpStart = null;
};

$c("ctxMenu").addEventListener("click", async e => {
  if (ctxFromTouch && Date.now() - ctxShownAt < 300) return;
  const copyNodeBtn = e.target.closest("[data-copynode]");
  if (copyNodeBtn && ctxNode) {
    const nd = editor.getNodeFromId(ctxNode);
    if (nd && PARAM_SCHEMA[nd.name]) {
      const got = nodeParamsOf(ctxNode, nd.name);
      if (got) copyParam(nd.name, got.data, { name: got.name });
    }
    hideCtxMenu();
    return;
  }
  const saveNodeBtn = e.target.closest("[data-savenode]");
  if (saveNodeBtn && ctxNode) {
    const nd = editor.getNodeFromId(ctxNode);
    if (nd && PARAM_SCHEMA[nd.name]) {
      const got = nodeParamsOf(ctxNode, nd.name);
      if (got) saveParamFile(nd.name, got.data, { name: got.name });
    }
    hideCtxMenu();
    return;
  }
  const pasteNodeBtn = e.target.closest("[data-pastenode]");
  if (pasteNodeBtn) {
    // По ноде — вставляем в неё (её же и открываем), по пустому холсту —
    // создаём ноду в точке вызова контекстного меню.
    const ctx = ctxNode
      ? { mode: "into" }
      : { mode: "new", ...(ctxPos ? palPointToCanvas(ctxPos[0], ctxPos[1]) : canvasCenterPoint()) };
    if (ctxNode) openSidebar(ctxNode);
    hideCtxMenu();
    const text = await paramReadText();
    if (text) pasteParamText(text, ctx);
    return;
  }
  const delNodeBtn = e.target.closest("[data-delnode]");
  if (delNodeBtn && ctxNode) {
    editor.removeNodeId(`node-${ctxNode}`);
    hideCtxMenu();
    return;
  }
  const dupNodeBtn = e.target.closest("[data-dupnode]");
  if (dupNodeBtn && ctxNode) {
    const src = editor.getNodeFromId(ctxNode);
    if (src && NODE_PORTS[src.name]) {
      const [ni, no] = NODE_PORTS[src.name];
      nextNodeId();
      editor.addNode(src.name, ni, no, src.pos_x + 40, src.pos_y + 40,
        src.name, { ...src.data }, NODE_HTML[src.name]);
      flushCascade();
    }
    hideCtxMenu();
    return;
  }
  const delBtn = e.target.closest("[data-delconn]");
  if (delBtn && ctxConn) {
    if (ctxConn.outId && ctxConn.inId && ctxConn.outClass && ctxConn.inClass) {
      editor.removeSingleConnection(ctxConn.outId, ctxConn.inId, ctxConn.outClass, ctxConn.inClass);
    }
    hideCtxMenu();
    return;
  }
  const btn = e.target.closest("[data-add]");
  if (!btn || !ctxPos) return;
  const rect = $c("drawflow").getBoundingClientRect();
  const x = (ctxPos[0] - rect.left - editor.canvas_x) / editor.zoom;
  const y = (ctxPos[1] - rect.top - editor.canvas_y) / editor.zoom;
  addNodeOfType(btn.dataset.add, x, y);
  flushCascade();
  hideCtxMenu();
});
document.addEventListener("click", e => {
  if (ctxFromTouch && Date.now() - ctxShownAt < 400) return;
  if (!e.target.closest("#ctxMenu")) hideCtxMenu();
});
document.addEventListener("keydown", e => { if (e.key === "Escape") hideCtxMenu(); });

$c("menuToggle").addEventListener("click", e => {
  e.stopPropagation();
  $c("headerBtns").classList.toggle("open");
});
document.addEventListener("click", e => {
  if (!e.target.closest("#headerBtns")) $c("headerBtns").classList.remove("open");
});

document.querySelectorAll("#headerBtns .btn").forEach(b => {
  b.addEventListener("click", () => $c("headerBtns").classList.remove("open"));
});

const fsBtn = $c("fullscreen");
// Кнопка иконочная: состояние показываем сменой иконки (стрелки наружу/внутрь),
// а не подписью — подпись уехала в подсказку.
function setFullscreenLabel(on) {
  fsBtn.classList.toggle("fullscreen-on", on);
  fsBtn.title = on ? "Выйти из полноэкранного режима" : "Полноэкранный режим — скрывает адресную строку браузера";
  fsBtn.setAttribute("aria-label", on ? "Выйти из полноэкранного режима" : "Полноэкранный режим");
}
const fsRequest = document.documentElement.requestFullscreen
  ? () => document.documentElement.requestFullscreen()
  : document.documentElement.webkitRequestFullscreen
    ? () => document.documentElement.webkitRequestFullscreen()
    : null;
if (!fsRequest) {
  fsBtn.addEventListener("click", () => {
    document.documentElement.classList.toggle("fs-fallback");
    const on = document.documentElement.classList.contains("fs-fallback");
    setFullscreenLabel(on);
    if (on) window.scrollTo(0, 0);
  });
} else {
  fsBtn.addEventListener("click", () => {
    if (document.fullscreenElement || document.webkitFullscreenElement) {
      (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    } else {
      fsRequest();
    }
  });
  const fsSync = () => {
    setFullscreenLabel(!!(document.fullscreenElement || document.webkitFullscreenElement));
  };
  document.addEventListener("fullscreenchange", fsSync);
  document.addEventListener("webkitfullscreenchange", fsSync);
}

bindModal();
bindMetaModal();
loadInitial();

// ============================================================
// Перенос параметров: копирование из ноды, вставка в ноду или на холст.
// Формат и проверку версий см. param-schema.js / param-transfer.js.
// ============================================================

// Последняя точка курсора над холстом — туда встанет нода при вставке.
let lastCanvasPoint = null;
$c("drawflow").addEventListener("pointermove", e => {
  lastCanvasPoint = palPointToCanvas(e.clientX, e.clientY);
});

function canvasCenterPoint() {
  const rect = $c("drawflow").getBoundingClientRect();
  return palPointToCanvas(rect.left + rect.width / 2, rect.top + rect.height / 2);
}

function selectedNodeKind() {
  if (sbNodeId === null) return null;
  const nd = editor.getNodeFromId(sbNodeId);
  return nd && PARAM_SCHEMA[nd.name] ? nd.name : null;
}

function nodeParamsOf(id, kind) {
  const nd = editor.getNodeFromId(id);
  if (!nd) return null;
  return { data: paramDataOf(kind, nd.data || {}), name: (nd.data?.name || "").trim() || NODE_TYPE_LABEL[kind] };
}

function copySelectedNodeParams() {
  const kind = selectedNodeKind();
  if (!kind) { alert("Сначала выберите ноду"); return; }
  const got = nodeParamsOf(sbNodeId, kind);
  if (got) copyParam(kind, got.data, { name: got.name });
}

// Тот же конверт kns-param, что уходит в буфер, но файлом — файл принимает
// «Импорт ноды» на любой схеме.
function saveSelectedNodeParams() {
  const kind = selectedNodeKind();
  if (!kind) { alert("Сначала выберите ноду"); return; }
  const got = nodeParamsOf(sbNodeId, kind);
  if (got) saveParamFile(kind, got.data, { name: got.name });
}

// Вставка в уже выбранную ноду: тот же путь, что у правки в сайдбаре —
// syncNodeParam обновляет и данные ноды, и поле на карточке холста.
function pasteIntoSelectedNode(kind, data) {
  const id = sbNodeId;
  const nd = id !== null ? editor.getNodeFromId(id) : null;
  if (!nd) { alert("Сначала выберите ноду"); return false; }
  if (nd.name !== kind) {
    alert(`В ноду «${NODE_TYPE_LABEL[nd.name]}» можно вставить только параметры «${NODE_TYPE_LABEL[nd.name]}», а в буфере — «${NODE_TYPE_LABEL[kind] || kind}»`);
    return false;
  }
  for (const [key, value] of Object.entries(data)) syncNodeParam(id, key, value);
  flushCascade();
  refreshSidebar();
  return true;
}

function pasteAsNewNode(kind, data, x, y) {
  if (!NODE_PORTS[kind]) { alert(`Нода «${kind}» не поддерживается`); return false; }
  const pt = (x === undefined || y === undefined) ? canvasCenterPoint() : { x, y };
  const [ni, no] = NODE_PORTS[kind];
  nextNodeId();
  // Drawflow сам заполняет поля карточки из data по атрибутам df-<ключ>.
  const id = editor.addNode(kind, ni, no, pt.x, pt.y, kind, migrateNodeData(kind, data), NODE_HTML[kind]);
  flushCascade();
  openSidebar(id);
  return true;
}

for (const kind of NODE_TYPES) {
  registerParamTarget(kind, {
    copy: () => (selectedNodeKind() === kind ? nodeParamsOf(sbNodeId, kind) : null),
    paste: (data, ctx) => (ctx?.mode === "new"
      ? pasteAsNewNode(kind, data, ctx.x, ctx.y)
      : pasteIntoSelectedNode(kind, data)),
  });
}

// Ctrl+C на выделенной ноде. Текстовое выделение и поля ввода не трогаем.
document.addEventListener("keydown", e => {
  if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return;
  const key = e.key.toLowerCase();
  if (key !== "c" && key !== "с") return; // «с» — та же клавиша в русской раскладке
  if (e.target?.closest?.("input, textarea, select, [contenteditable]")) return;
  const sel = window.getSelection?.();
  if (sel && !sel.isCollapsed) return;
  if (selectedNodeKind() === null) return;
  e.preventDefault();
  copySelectedNodeParams();
});

// «Импорт ноды» из палитры — из файла; вставка из буфера живёт на Ctrl+V
// и в контекстном меню холста.
$c("importNodeBtn").addEventListener("click", () => importParamFile({ mode: "new", ...canvasCenterPoint() }));

$c("sbCopyBtn").addEventListener("click", copySelectedNodeParams);
$c("sbSaveBtn").addEventListener("click", saveSelectedNodeParams);
$c("sbPasteBtn").addEventListener("click", async () => {
  if (selectedNodeKind() === null) { alert("Сначала выберите ноду"); return; }
  const text = await paramReadText();
  if (text) pasteParamText(text, { mode: "into" });
});

bindParamTransfer();
initParamPaste(() => ({ mode: "new", ...(lastCanvasPoint || canvasCenterPoint()) }));
